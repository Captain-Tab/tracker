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

// ---------- loadTargets ----------
test("loadTargets: 单目标返回 {tgToken, target} + 默认值填充", () => {
  const path = writeTargets(singleTarget());
  const { tgToken, target } = loadTargets(path);
  assert.equal(tgToken, "tok");
  assert.equal(target.id, "t1");
  assert.equal(target.initialDeployPct, 0.5);
  assert.equal(target.maxDeployPct, 0.9);
  assert.equal(target.sizeMultiplier, 1);
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
  // desiredMargin=250 → notional=1250 → size=1250/8000=0.15625（多）
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
