// HYPE-copy 纯函数单测（Node 22 内置 node:test，零依赖）。运行: node --test service/HYPE-copy/test/domain.test.mjs
// 阶段 1：mapSymbol（sodex 映射表 / hype 直通）+ loadTargets（单目标校验 + 默认值填充）。
// 后续阶段追加 case 到本文件。
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mapSymbol, loadTargets } from "../process/mapping.mjs";
import { add, sub, mul, div, gt, lt, maxStr, formatSize, formatPrice, applySlippage } from "../process/precision.mjs";
import { normalizeTargetPositions, parseHypeMeta, placeDryRun } from "../api/index.mjs";
import { computeRatio, computeDesired } from "../process/sizing.mjs";
import { recommendMinCapital } from "../process/recommend.mjs";
import { decideLeg } from "../process/risk.mjs";
import { diffDelta, planReconcile } from "../process/reconcile.mjs";
import { toLogLine, decidePushLine } from "../notify/index.mjs";
import { lineFor, classifyMirrorEvent, escapeHtml, buildHeader, buildFooter, buildPositionCards, buildRoundSummary, fmtDisplaySize, fmtDisplayUsd } from "../notify/templates.mjs";
import { aggregateStats } from "../process/stats.mjs";

const ADDR = "0x321f7193eadbacb67eff00f76b975a487e5b1c84";

// 写一份临时 targets.json，返回路径（loadTargets 读文件，单测需落盘）。
function writeTargets(obj) {
  const dir = mkdtempSync(join(tmpdir(), "hype-copy-"));
  const path = join(dir, "targets.json");
  writeFileSync(path, typeof obj === "string" ? obj : JSON.stringify(obj));
  return path;
}

function singleTarget(extra = {}) {
  return {
    tgToken: "tok",
    targets: [{ id: "t1", source: { platform: "sodex", address: ADDR }, exchange: "hype", ...extra }],
  };
}

// ---------- mapSymbol ----------
test("mapSymbol: sodex 源可映射，归一为大写 coin", () => {
  assert.equal(mapSymbol("ETH-USD", "sodex"), "ETH");
  assert.equal(mapSymbol("BTC/USDC", "sodex"), "BTC");
  assert.equal(mapSymbol("eth-usd", "sodex"), "ETH"); // 大小写归一
  assert.equal(mapSymbol("  sol-usd  ", "sodex"), "SOL"); // 去空白
});

test("mapSymbol: sodex 源不可映射（股票/商品 perp）返回 null", () => {
  assert.equal(mapSymbol("PLTR-USD", "sodex"), null);
  assert.equal(mapSymbol("USTECH-USD", "sodex"), null);
  assert.equal(mapSymbol("XAUT-USD", "sodex"), null);
  assert.equal(mapSymbol("COPPER-USD", "sodex"), null);
  assert.equal(mapSymbol("pltr-usd", "sodex"), null); // 大小写归一后命中黑名单
});

test("mapSymbol: hype 源同所直通", () => {
  assert.equal(mapSymbol("ETH", "hype"), "ETH");
  assert.equal(mapSymbol("BTC", "hype"), "BTC");
  assert.equal(mapSymbol("PLTR", "hype"), "PLTR"); // hype 直通不过黑名单
});

test("mapSymbol: 非法入参安全返回 null（不抛错）", () => {
  assert.equal(mapSymbol(null, "sodex"), null);
  assert.equal(mapSymbol("", "sodex"), null);
  assert.equal(mapSymbol("   ", "sodex"), null);
  assert.equal(mapSymbol(123, "hype"), null);
  assert.equal(mapSymbol(undefined, "hype"), null);
});

test("mapSymbol: hype universe 校验（第3参，coin 不在 universe → null）", () => {
  const uni = new Set(["ETH", "BTC"]); // hype 当前 universe
  assert.equal(mapSymbol("ETH-USD", "sodex", uni), "ETH"); // 在 universe
  assert.equal(mapSymbol("SOL-USD", "sodex", uni), null); // 不在 universe → 不可映射
  assert.equal(mapSymbol("ETH", "hype", uni), "ETH"); // hype 源同样校验
  assert.equal(mapSymbol("DOGE", "hype", uni), null); // hype 源不在 universe → null
  // Map（buildHypeAssetIndex 返回形态）也支持
  assert.equal(mapSymbol("BTC-USD", "sodex", new Map([["BTC", { index: 0 }]])), "BTC");
  // 数组也支持
  assert.equal(mapSymbol("ETH-USD", "sodex", ["ETH"]), "ETH");
  // 不提供 universe → 向后兼容直通（不拦）
  assert.equal(mapSymbol("SOL-USD", "sodex"), "SOL");
  // 黑名单优先于 universe：PLTR 即使在 universe 也因黑名单 null（sodex 源）
  assert.equal(mapSymbol("PLTR-USD", "sodex", new Set(["PLTR"])), null);
});

// ---------- loadTargets ----------
test("loadTargets: 单目标返回 {tgToken, target} + 默认值填充", () => {
  const path = writeTargets(singleTarget());
  const { tgToken, target } = loadTargets(path);
  assert.equal(tgToken, "tok");
  assert.equal(target.id, "t1");
  assert.equal(target.initialDeployPct, 0.5);
  assert.equal(target.maxDeployPct, 0.9);
  assert.equal(target.dryRun, true);
});

test("loadTargets: 显式字段不被默认值覆盖", () => {
  const path = writeTargets(singleTarget({ initialDeployPct: 0.3, dryRun: true, maxDeployPct: 0.8 }));
  const { target } = loadTargets(path);
  assert.equal(target.initialDeployPct, 0.3);
  assert.equal(target.maxDeployPct, 0.8);
});

test("loadTargets: ≥2 目标抛错，信息含「单目标」", () => {
  const cfg = singleTarget();
  cfg.targets.push({ id: "t2", source: { platform: "hype", address: ADDR }, exchange: "hype" });
  const path = writeTargets(cfg);
  assert.throws(() => loadTargets(path), /单目标/);
});

test("loadTargets: 缺/非法 source.address 抛错", () => {
  const path = writeTargets(singleTarget({ source: { platform: "sodex", address: "0xnope" } }));
  assert.throws(() => loadTargets(path), /address/);
});

test("loadTargets: 缺 id 抛错", () => {
  const path = writeTargets({ tgToken: "tok", targets: [{ source: { platform: "sodex", address: ADDR }, exchange: "hype" }] });
  assert.throws(() => loadTargets(path), /id/);
});

test("loadTargets: exchange 非 hype 抛错", () => {
  const path = writeTargets(singleTarget({ exchange: "sodex" }));
  assert.throws(() => loadTargets(path), /hype/);
});

test("loadTargets: 空 targets 数组抛错", () => {
  const path = writeTargets({ tgToken: "tok", targets: [] });
  assert.throws(() => loadTargets(path), /非空/);
});

test("loadTargets: JSON 解析失败抛错", () => {
  const path = writeTargets("{ not json");
  assert.throws(() => loadTargets(path), /解析失败/);
});

test("loadTargets: tgToken 缺失不抛错，返回 null", () => {
  const path = writeTargets({ targets: [{ id: "t1", source: { platform: "sodex", address: ADDR }, exchange: "hype" }] });
  const { tgToken } = loadTargets(path);
  assert.equal(tgToken, null);
});

// ---------- precision（Phase0 底座，ROUND_DOWN）----------
test("precision: 算术返回精确字符串（无浮点误差）", () => {
  assert.equal(add("0.1", "0.2"), "0.3"); // 裸 0.1+0.2=0.30000000000000004
  assert.equal(sub("4000", "250"), "3750");
  assert.equal(mul("250", "5"), "1250");
  assert.equal(div("1250", "8000"), "0.15625");
});

test("precision: 比较 + maxStr 不走 parseFloat", () => {
  assert.equal(gt("0.2", "0.000125"), true);
  assert.equal(lt("3.125", "10"), true);
  assert.equal(maxStr(["0.000125", "0.2", "0.05"]), "0.2");
  assert.equal(maxStr([]), "0"); // 空数组安全零值
});

test("precision: formatSize ROUND_DOWN 到 szDecimals（向零截断，防超额）", () => {
  assert.equal(formatSize("0.15625", 4), "0.1562"); // 截断非四舍五入
  assert.equal(formatSize("0.15625", 2), "0.15");
  assert.equal(formatSize("-0.15625", 4), "-0.1562"); // 负向（空）同样向零截断
  assert.equal(formatSize("1.20000", 4), "1.2"); // 去尾零
});

test("precision: formatPrice 限 5 位有效数字 + perps 小数上限，ROUND_DOWN", () => {
  assert.equal(formatPrice("3000.123456", 2), "3000.1"); // 5 sig figs 截断
  assert.equal(formatPrice("65820.99", 2), "65820"); // 5 位有效数字封顶
  assert.equal(formatPrice("1.2345678", 2), "1.2345"); // 5 sig figs 绑定（小数上限 6-2=4 不绑）
  assert.equal(formatPrice("0.123456789", 4), "0.12"); // 小数上限 6-4=2 更严，绑定
});

test("precision: applySlippage 买加卖减，再走 formatPrice", () => {
  // 买：3000×(1+50/1e4)=3015 → formatPrice
  assert.equal(applySlippage("3000", 50, true, 2), "3015");
  // 卖：3000×(1-50/1e4)=2985
  assert.equal(applySlippage("3000", 50, false, 2), "2985");
});

// ---------- api 横切纯逻辑 ----------
test("api: normalizeTargetPositions 归一已证实字段 + 派生 marginUsed", () => {
  // 显式 marginUsed 缺失 → 派生 |sz|×ep/leverage
  const out = normalizeTargetPositions([{ s: "ETH-USD", sz: "10", ep: "2000", l: 5 }]);
  assert.equal(out.length, 1);
  assert.equal(out[0].symbol, "ETH-USD");
  assert.equal(out[0].szi, "10");
  assert.equal(out[0].leverage, 5);
  assert.equal(out[0].marginUsed, "4000"); // 10×2000/5
  assert.equal(out[0].entryPx, "2000");
});

test("api: normalizeTargetPositions 显式 marginUsed 优先、非数组安全空", () => {
  const out = normalizeTargetPositions([{ s: "BTC-USD", sz: "-1", ep: "60000", l: 10, mu: "12345" }]);
  assert.equal(out[0].marginUsed, "12345"); // 显式优先于派生
  assert.equal(out[0].szi, "-1"); // 带符号保留（空头）
  assert.deepEqual(normalizeTargetPositions(null), []);
  assert.deepEqual(normalizeTargetPositions("x"), []);
});

test("api: parseHypeMeta universe 下标即 asset index", () => {
  const map = parseHypeMeta({ universe: [{ name: "BTC", szDecimals: 5 }, { name: "ETH", szDecimals: 4 }] });
  assert.equal(map.get("BTC").index, 0);
  assert.equal(map.get("ETH").index, 1);
  assert.equal(map.get("ETH").szDecimals, 4);
  assert.equal(parseHypeMeta({}).size, 0); // 空 universe 安全
});

test("api: placeDryRun 构造 would-place（IOC 限价 + ROUND_DOWN，不签名）", () => {
  const log = placeDryRun(
    { coin: "ETH", isBuy: true, size: "0.15625", refPx: "3000", reduceOnly: false },
    { assetIndex: 1, szDecimals: 4, slippageBps: 50, dryRun: true },
  );
  assert.equal(log.action, "would-place");
  assert.equal(log.coin, "ETH");
  assert.equal(log.dryRun, true);
  assert.equal(log.order.a, 1);
  assert.equal(log.order.b, true);
  assert.equal(log.order.p, "3015"); // 3000×(1+50/1e4)
  assert.equal(log.order.s, "0.1562"); // 0.15625 截断到 4 位
  assert.equal(log.order.r, false);
  assert.deepEqual(log.order.t, { limit: { tif: "Ioc" } });
});

test("api: placeDryRun 真实提交口子占位抛错", () => {
  assert.throws(
    () => placeDryRun({ coin: "ETH", isBuy: true, size: "1", refPx: "3000" }, { assetIndex: 1, szDecimals: 4, slippageBps: 50, dryRun: false }),
    /后续阶段/,
  );
});

// ---------- 02 资金模型 sizing ----------
test("sizing: computeRatio = (avail×deployPct)/margin；分母<=0 → 0", () => {
  assert.equal(computeRatio(500, 0.5, 4000), 0.0625); // 总纲场景1
  assert.equal(computeRatio(500, 0.5, 0), 0); // 分母 0
  assert.equal(computeRatio(500, 0.5, -1), 0); // 分母负
});

test("sizing: computeDesired 保证金等比→名义→size，方向沿用 szi 符号", () => {
  const out = computeDesired(
    [{ coin: "ETH", szi: "10", marginUsed: "4000", leverage: 5 }],
    0.0625,
    { ETH: "8000" },
  );
  // desiredMargin=250 → notional=1250 → size=1250/8000=0.15625（做多）
  assert.deepEqual(out, [{ coin: "ETH", size: "0.15625" }]);
});

test("sizing: computeDesired 空头 szi 负号 + 缺价标记跳过、不中断整批", () => {
  const out = computeDesired(
    [
      { coin: "BTC", szi: "-2", marginUsed: "1000", leverage: 10 },
      { coin: "DOGE", szi: "100", marginUsed: "50", leverage: 5 },
    ],
    0.0625,
    { BTC: "60000" }, // DOGE 缺价
  );
  // BTC: margin 1000×0.0625=62.5 → notional 625 → size 625/60000≈0.010416… 取负
  assert.equal(out[0].coin, "BTC");
  assert.ok(out[0].size.startsWith("-"), `空头应为负: ${out[0].size}`);
  assert.deepEqual(out[1], { coin: "DOGE", size: null, skipped: true, reason: "no-price" });
});

test("sizing: 空仓边界 → []", () => {
  assert.deepEqual(computeDesired([], 0, { ETH: "8000" }), []);
  assert.deepEqual(computeDesired(null, 0, {}), []);
});

// ---------- 02 最低本金 recommend ----------
test("recommend: 最低本金反解 + 小仓判定跳过（子件 02 场景2）", () => {
  const positions = [
    { coin: "ETH", szi: "10", marginUsed: "4000", leverage: 5 }, // targetNotional=10×8000=80000
    { coin: "DOGE", szi: "1000", marginUsed: "200", leverage: 5 }, // targetNotional=1000×0.05=50
  ];
  const prices = { ETH: "8000", DOGE: "0.05" };
  // targetMappableMargin=4200；currentRatio=0.0625
  const out = recommendMinCapital(positions, prices, 0.5, 0.0625);
  assert.equal(out.ratioMin, 0.2); // max(10/80000, 10/50)=0.2（DOGE 卡门槛）
  assert.equal(out.minCapital, 1680); // 0.2×4200/0.5
  const eth = out.perLeg.find((l) => l.coin === "ETH");
  const doge = out.perLeg.find((l) => l.coin === "DOGE");
  assert.equal(eth.canFollow, true); // 80000×0.0625=5000≥10
  assert.equal(eth.reason, "ok");
  assert.equal(doge.canFollow, false); // 50×0.0625=3.125<10
  assert.equal(doge.reason, "below-min-notional");
});

test("recommend: 缺 currentRatio → reason no-ratio；缺价 → no-price 不入 ratioMin", () => {
  const positions = [
    { coin: "ETH", szi: "10", marginUsed: "4000", leverage: 5 },
    { coin: "X", szi: "1", marginUsed: "100", leverage: 5 },
  ];
  const out = recommendMinCapital(positions, { ETH: "8000" }, 0.5); // 无 currentRatio、X 缺价
  assert.equal(out.perLeg.find((l) => l.coin === "ETH").reason, "no-ratio");
  const x = out.perLeg.find((l) => l.coin === "X");
  assert.equal(x.reason, "no-price");
  assert.equal(x.legRatioMin, null);
  assert.equal(out.ratioMin, 0.000125); // 仅 ETH 计入 max（10/80000）
});

test("recommend: 无可映射仓 → 安全零值", () => {
  assert.deepEqual(recommendMinCapital([], { ETH: "8000" }, 0.5), { minCapital: 0, ratioMin: 0, perLeg: [] });
});

// ---------- 03 diffDelta（净仓做差）----------
test("diffDelta: 开仓/增仓/减仓/平仓四类", () => {
  const desired = [{ coin: "ETH", size: "12.5" }, { coin: "BTC", size: "1" }];
  const current = [{ coin: "ETH", size: "8" }, { coin: "SOL", size: "5" }];
  const out = diffDelta(desired, current);
  const eth = out.find((d) => d.coin === "ETH"); // 增仓 8→12.5
  const btc = out.find((d) => d.coin === "BTC"); // 开仓 0→1
  const sol = out.find((d) => d.coin === "SOL"); // 平仓 5→0
  assert.equal(eth.deltaSize, "4.5");
  assert.equal(btc.deltaSize, "1");
  assert.equal(sol.deltaSize, "-5");
  assert.equal(sol.side, -1);
});

test("diffDelta: dry-run current 恒空 → delta 即 desired", () => {
  const out = diffDelta([{ coin: "ETH", size: "0.625" }], []);
  assert.equal(out.length, 1);
  assert.equal(out[0].deltaSize, "0.625");
});

// ---------- 03 decideLeg 六分支（顺序铁律）----------
const baseCaps = { maxDeployPct: 0.9, maxPositionPct: 0.5, minDeltaPct: 0.003, minNotional: 10, minOrderSize: "0.0001", currentDeployedNotional: "0", availBalance: "500" };

test("decideLeg: place（正常开仓）", () => {
  // ETH 0.625 @ 3000，名义 1875；单仓上限 500×0.5=250 → 注意会被 maxpos 拦
  // 用小仓避免 maxpos：0.05 @ 3000 名义 150 < 250，delta 全量，未触顶
  assert.equal(decideLeg({ coin: "ETH", size: "0.05" }, null, baseCaps, { ETH: "3000" }), "place");
});

test("decideLeg: skip-unmappable（无 coin）", () => {
  assert.equal(decideLeg({ coin: null, size: "1" }, null, baseCaps, {}), "skip-unmappable");
});

test("decideLeg: skip-mindust（本笔名义 < $10）", () => {
  // 0.002 @ 3000 = 6 < 10
  assert.equal(decideLeg({ coin: "ETH", size: "0.002" }, null, baseCaps, { ETH: "3000" }), "skip-mindust");
});

test("decideLeg: skip-maxpos（单仓名义 > 余额×maxPositionPct，仅拦加仓）", () => {
  // 0.1 @ 3000 = 300 > 250；从 0 加仓 → maxpos
  assert.equal(decideLeg({ coin: "ETH", size: "0.1" }, null, baseCaps, { ETH: "3000" }), "skip-maxpos");
});

test("decideLeg: skip-capped（部署需求超顶，仅拦加仓）", () => {
  // 场景2：ETH 需求名义 562.5 > 余额×maxDeploy=450；放宽 maxPositionPct 排除 maxpos 先命中
  const caps = { ...baseCaps, maxPositionPct: 2 };
  assert.equal(decideLeg({ coin: "ETH", size: "0.1875" }, null, caps, { ETH: "3000" }), "skip-capped");
});

test("decideLeg: capped 时减仓/平仓放行（不阻止降风险，场景3）", () => {
  // 已触顶（currentDeployed 高），但目标减仓：current 10 → desired 8（量级缩小=减仓）
  const caps = { ...baseCaps, maxPositionPct: 2, currentDeployedNotional: "100000" };
  // delta=-2 名义 6000 > 10、未碰 minDelta；减仓方向 isIncrease=false → 不 capped → place
  assert.equal(decideLeg({ coin: "ETH", size: "8" }, { size: "10" }, caps, { ETH: "3000" }), "place");
});

test("decideLeg: noop（|delta|/|desired| < minDeltaPct，碎步追单）", () => {
  // 需绕开 mindust（本笔名义≥$10）：desired 2 @3000 名义 6000，delta 0.005 名义 15≥10；
  // 相对变动 0.005/2=0.0025 < minDeltaPct 0.003 → noop。放宽 maxPos/avail 排除 maxpos/capped。
  const caps = { ...baseCaps, maxPositionPct: 1, availBalance: "100000" };
  assert.equal(decideLeg({ coin: "ETH", size: "2" }, { size: "1.995" }, caps, { ETH: "3000" }), "noop");
});

// ---------- 03 planReconcile（滚仓一步对齐）----------
test("planReconcile: 滚仓 100→…→200，对账一步对齐到最新 desired（中间态不独立 would-place）", () => {
  // 目标历经做多跳，对账只看最新 desired=12.5；current=8（上轮）→ delta +4.5 一次性对齐
  const caps = { ...baseCaps, maxPositionPct: 5, availBalance: "100000" };
  const { actions } = planReconcile([{ coin: "ETH", size: "12.5" }], [{ coin: "ETH", size: "8" }], caps, { ETH: "3000" });
  assert.equal(actions.length, 1);
  assert.equal(actions[0].decision, "place");
  assert.equal(actions[0].deltaSize, "4.5");
  assert.equal(actions[0].isBuy, true);
  assert.equal(actions[0].size, "4.5");
});

test("planReconcile: skip 类不进 would-place（顺序铁律）", () => {
  // 一仓 mindust、一仓正常 → 仅正常仓 decision=place
  const caps = { ...baseCaps, maxPositionPct: 5 };
  const { actions } = planReconcile(
    [{ coin: "DUST", size: "0.001" }, { coin: "ETH", size: "0.05" }],
    [],
    caps,
    { DUST: "1", ETH: "3000" },
  );
  const dust = actions.find((a) => a.coin === "DUST");
  const eth = actions.find((a) => a.coin === "ETH");
  assert.equal(dust.decision, "skip-mindust");
  assert.equal(eth.decision, "place");
  assert.equal(actions.filter((a) => a.decision === "place").length, 1);
});

// ---------- 04 通知增强：事件分类 ----------
test("classifyMirrorEvent: 开/加/减/平/不变", () => {
  assert.equal(classifyMirrorEvent("0", "0.5"), "open"); // 0→有
  assert.equal(classifyMirrorEvent("0.5", "0.625"), "add"); // 量级增
  assert.equal(classifyMirrorEvent("0.625", "0.5"), "reduce"); // 量级减
  assert.equal(classifyMirrorEvent("0.5", "0"), "close"); // 有→0
  assert.equal(classifyMirrorEvent("0.5", "0.5"), "same"); // 不变
  assert.equal(classifyMirrorEvent("-0.5", "-1"), "add"); // 空头加仓（量级增）
});

// ---------- 04 通知增强：lineFor 文案 + icon ----------
test("lineFor: 开/加/减/平 带正确 icon + 方向 + 量价", () => {
  const open = lineFor({ result: "place", coin: "SOL", side: "buy", currentSize: "0", desiredSize: "2", deltaSize: "2", refPx: "150", ratio: 0.0625 });
  assert.match(open, /🆕 SOL 做多 \| 新开 2 张 @ \$150  ratio 6\.25%/);
  const addL = lineFor({ result: "place", coin: "ETH", side: "buy", currentSize: "0.5", desiredSize: "0.74", deltaSize: "0.24", refPx: "3000" });
  assert.match(addL, /⏫ ETH 做多 \| \+0\.24 → 持 0\.74 张 @ \$3000/);
  const reduceL = lineFor({ result: "place", coin: "ETH", side: "sell", currentSize: "0.74", desiredSize: "0.5", deltaSize: "-0.24", refPx: "3000" });
  assert.match(reduceL, /⏬ ETH 做多 \| -0\.24 → 持 0\.5 张 @ \$3000/);
  const closeL = lineFor({ result: "place", coin: "BTC", side: "sell", currentSize: "0.1", desiredSize: "0", deltaSize: "-0.1", refPx: "60000" });
  assert.match(closeL, /🏁 BTC 做多 \| 目标已清仓，平仓/);
});

test("lineFor: 空头方向 + 告警/最低本金/noop", () => {
  const shortOpen = lineFor({ result: "place", coin: "ETH", side: "sell", currentSize: "0", desiredSize: "-1", deltaSize: "-1", refPx: "3000" });
  assert.match(shortOpen, /🆕 ETH 做空 \| 新开 1 张 @ \$3000/);
  assert.match(lineFor({ result: "skip-unmappable", coin: "PLTR" }), /⛔.*无 hype 映射/);
  assert.match(lineFor({ result: "skip-capped", coin: "ETH" }), /⛔.*加仓拦截/);
  assert.match(lineFor({ result: "min-capital", minCapital: 1680, canFollowCoins: "ETH" }), /💡 最低本金下界：\$1680（仅保证最大仓 ≥ \$10 名义，可跟 ETH）/);
  assert.match(lineFor({ result: "error", coin: "ETH", reason: "x" }), /⚠️ ETH 执行失败/);
  assert.equal(lineFor({ result: "noop", coin: "ETH" }), null);
});

test("escapeHtml: < > & 转义", () => {
  assert.equal(escapeHtml("a<b>&c"), "a&lt;b&gt;&amp;c");
  assert.match(lineFor({ result: "error", coin: "ETH", reason: "x<y>" }), /x&lt;y&gt;/);
});

test("buildHeader / buildFooter", () => {
  assert.equal(buildHeader("demo-1", "0x321f7193eadbacb67eff00f76b975a487e5b1c84", "s1"), "跟 0x32...1c84 🎯demo-1 → s1  [DRY-RUN]");
  assert.equal(buildHeader("demo-1", "0x321f7193eadbacb67eff00f76b975a487e5b1c84", ""), "跟 0x32...1c84 🎯demo-1  [DRY-RUN]"); // 无子账户
  assert.equal(buildFooter(12, 340), "⏱ 执行 12ms｜完整 340ms");
});

// ---------- 04 通知增强：display 格式化 ----------
test("fmtDisplaySize: 按 szDecimals 截断 + 默认 4 位", () => {
  assert.equal(fmtDisplaySize("0.123456789", 2), "0.12");
  assert.equal(fmtDisplaySize("715.34851779787", 0), "715");
  assert.equal(fmtDisplaySize("715.34851779787"), "715.3485"); // 默认 4 位
  assert.equal(fmtDisplaySize(null, 2), "0"); // null → "0"
  assert.equal(fmtDisplaySize("", 2), "0"); // 空串 → "0"
});

test("fmtDisplayUsd: 2 位小数 + 空值安全", () => {
  assert.equal(fmtDisplayUsd("1234.56789"), "1234.56"); // ROUND_DOWN
  assert.equal(fmtDisplayUsd(4.0679), "4.06");
  assert.equal(fmtDisplayUsd(null), "0");
  assert.equal(fmtDisplayUsd(undefined), "0");
});

test("buildPositionCards: 空输入 + 单仓位双卡片", () => {
  const empty = buildPositionCards([]);
  assert.match(empty, /无可映射仓/);

  const cards = buildPositionCards([
    { coin: "ETH", size: "0.5", leverage: 10, szDecimals: 2, refPx: "3000", targetEntryPx: "2950", targetSzi: "50", marginUsed: "15000" },
  ]);
  // 目标卡片
  assert.match(cards, /🎯 目标仓位：ETH 10x 做多/);
  assert.match(cards, /持仓量  50 张/);
  assert.match(cards, /开仓价  \$2950/);
  assert.match(cards, /保证金  \$15000/);
  // 跟单卡片（空行后）
  assert.match(cards, /📊 跟单仓位：ETH 10x 做多/);
  assert.match(cards, /持仓量  0\.5 张/);
  assert.match(cards, /仓位价值  \$1500/);
});

test("buildRoundSummary: initial_sync 含卡片 + footer", () => {
  const summary = buildRoundSummary({
    kind: "initial_sync",
    clock: "2026/06/29 12:05:03",
    headerId: "跟 0x26...66 🎯demo-1  [DRY-RUN]",
    positionCards: "📊 （测试卡片）",
    lines: ["💡 最低本金参考：$4.07（可跟 ETH）"],
    footer: "⏱ 执行 25ms｜完整 775ms",
  });
  assert.match(summary, /▶ 跟单启动/);
  assert.match(summary, /🕐 2026\/06\/29 12:05:03/);
  assert.match(summary, /📡 跟 0x26...66/);
  assert.match(summary, /📊 （测试卡片）/);
  assert.match(summary, /最低本金参考/);
  assert.match(summary, /⏱ 执行 25ms/);
});

test("buildRoundSummary: round 无卡片只有变化行", () => {
  const summary = buildRoundSummary({
    kind: "round",
    clock: "2026/06/29 12:15:00",
    headerId: "跟 0x26...66 🎯demo-1  [DRY-RUN]",
    lines: ["🆕 ETH 做多 | 新开 0.5 张 @ $3,000.50  ratio 1.98%"],
    footer: "⏱ 执行 30ms｜完整 650ms",
  });
  assert.match(summary, /⏫ 跟单对账/);
  assert.match(summary, /新开 0\.5 张/);
  assert.match(summary, /ratio 1\.98%/);
});

// ---------- 04 通知增强：去重决策 decidePushLine ----------
test("decidePushLine: 持续告警进入推一次，状态不变静默", () => {
  const lastAlertFp = new Set();
  const r1 = new Set();
  // 第 1 轮：PLTR 不可映射 → 推
  assert.ok(decidePushLine({ result: "skip-unmappable", coin: "PLTR" }, { lastAlertFp, newAlertFp: r1 }));
  // 第 2 轮：lastAlertFp 含上轮键 → 静默
  const r2 = new Set();
  assert.equal(decidePushLine({ result: "skip-unmappable", coin: "PLTR" }, { lastAlertFp: r1, newAlertFp: r2 }), null);
});

test("decidePushLine: min-capital 仅锚定轮（wasFollowing=false）推", () => {
  assert.ok(decidePushLine({ result: "min-capital", minCapital: 1680, canFollowCoins: "ETH" }, { wasFollowing: false }));
  assert.equal(decidePushLine({ result: "min-capital", minCapital: 1680 }, { wasFollowing: true }), null);
});

test("decidePushLine: noop 不推、place/error 直推", () => {
  assert.equal(decidePushLine({ result: "noop", coin: "ETH" }, {}), null);
  assert.ok(decidePushLine({ result: "place", coin: "ETH", side: "buy", currentSize: "0", desiredSize: "1", deltaSize: "1", refPx: "3000" }, {}));
  assert.ok(decidePushLine({ result: "error", coin: "ETH", reason: "boom" }, {}));
});

// ---------- 04 toLogLine（含计时字段）----------
test("toLogLine: action/side 映射 + 缺省 + fullMs/execMs", () => {
  const place = toLogLine({ targetId: "x", coin: "ETH", side: "buy", size: "0.625", refPx: "3000", result: "place", dryRun: true, fullMs: 340, execMs: 12 });
  assert.equal(place.action, "place");
  assert.equal(place.side, "long"); // buy → long
  assert.equal(place.fillPx, "3000"); // dry-run would-fill = refPx
  assert.equal(place.fee, "0"); // 缺省落 "0"
  assert.equal(place.slippageBps, 0);
  assert.equal(place.fullMs, 340);
  assert.equal(place.execMs, 12);
  assert.equal(toLogLine({ result: "skip-capped", coin: "ETH" }).action, "cap-warn");
  assert.equal(toLogLine({ result: "noop", coin: "ETH" }).action, "skip");
  assert.equal(toLogLine({ result: "error", coin: "ETH", side: "sell" }).action, "error");
  assert.equal(toLogLine({ result: "place", side: "sell", coin: "ETH" }).side, "short"); // sell → short
  assert.equal(toLogLine({ result: "place", coin: "ETH" }).fullMs, 0); // 缺省 0
});

// ---------- 04 stats 聚合 ----------
test("stats: 聚合笔数/Σfee/滑点分布/净收益（04 场景4）", () => {
  const lines = [
    { result: "place", fee: "1.2", slippageBps: 12, dryRun: true },
    { result: "place", fee: "0.8", slippageBps: 8, dryRun: true },
    { result: "place", fee: "1.0", slippageBps: 20, dryRun: true },
    { result: "noop", fee: "0", slippageBps: 0, dryRun: true },
    { result: "noop", fee: "0", slippageBps: 0, dryRun: true },
    { result: "skip-capped", fee: "0", slippageBps: 0, dryRun: true },
  ];
  const s = aggregateStats(lines);
  assert.equal(s.trades, 3); // 只计 place/ok
  assert.equal(s.totalFee, "3"); // 1.2+0.8+1.0 精度累加
  assert.equal(s.slippage.min, 8);
  assert.equal(s.slippage.median, 12);
  assert.equal(s.slippage.max, 20);
  assert.equal(s.netProfit, -3); // dry-run fee erosion 估算 = -Σfee
  assert.equal(s.dryRun, true);
});

test("stats: 空输入安全零值", () => {
  const s = aggregateStats([]);
  assert.equal(s.trades, 0);
  assert.equal(s.totalFee, "0");
  assert.deepEqual(s.slippage, { min: 0, median: 0, max: 0, count: 0 });
});
