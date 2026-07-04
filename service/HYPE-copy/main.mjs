// HYPE 跟单执行器入口（单目标，对账循环）。一期 dry-run：只产 would-*，不签名不下单。
// 用法：node service/HYPE-copy/main.mjs --target=<id> --config=service/HYPE-copy/targets.json
// 资金模型 v3（spec 07/09）：每币独立预算 + 生存杠杆 + 逐仓保证金防守；编排走 planBudgetReconcile。
// 只跟部署后新开仓（启动基线快照，spec 09 §3.6）；myPosByCoin/baseline 持久化跨重启。
import { loadTargets, mapSymbol } from "./process/mapping.mjs";
import { planBudgetReconcile } from "./process/reconcile.mjs";
import { add, sub, mul, div, absStr, gt } from "./process/precision.mjs";
import { ENVS, fetchTargetState, fetchHypePrices, buildHypeAssetIndex, placeDryRun, buildWouldUpdateLeverage, buildWouldUpdateMargin, log } from "./api/index.mjs";
import { recordAction, pushRoundSummary, decidePushLine } from "./notify/index.mjs";
import { buildHeader, buildFooter, buildPositionCards, fmtClock, lineStop, buildRoundSummary } from "./notify/templates.mjs";
import { watchSignal, makeSingleFlight, DEFAULT_SIGNAL_DIR } from "../lib/copy-signal/index.mjs";
import { loadCopyState, saveCopyState } from "./tool/copyStateStore.mjs";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// 执行腿参数（blueprint §10.6 建议默认）
const RECONCILE_INTERVAL_SEC = 180; // 周期对账兜底间隔（事件驱动主触发用信号；轮询仅防漏接）
const SIGNAL_POLL_MS = 1000; // fs.watchFile 轮询间隔（信号检测延迟，可调）
const MAX_SLIPPAGE_BPS = 30; // IOC 限价保护偏移
const DEFAULT_MIN_ORDER_SIZE = "0.0001"; // 最小下单量兜底（精确 lot 由 formatSize 按 szDecimals 收口）

function parseArgs(argv) {
  const flags = {};
  for (const arg of argv) {
    if (arg.startsWith("--")) {
      const [k, v] = arg.slice(2).split("=");
      flags[k] = v === undefined ? true : v;
    }
  }
  return flags;
}

// 跟单生命周期 + 通知状态（编排层持有；纯逻辑层不沾状态）
const state = {
  pendingStartup: true, // 首轮 = 启动 + 建基线
  myPosByCoin: new Map(), // coin → {margin,openSize,openTargetSzi,leverage,side,curSize}（spec 09 §3.4）
  baselineCoins: new Set(), // 部署前存量币，永不跟（spec 09 §3.6）
  baselineCaptured: false, // 是否已建基线（区分"确无仓"与"状态丢失"，降级安全）
  lastAlertFp: new Set(), // "coin:result"：持续告警去重
  // 平仓 P&L 快照（目标平仓后 coin 从 mappable 消失，靠此取值；close 卡片用）
  lastCrByCoin: new Map(),
  lastCfByCoin: new Map(),
  lastTargetSziByCoin: new Map(),
  lastLeverageByCoin: new Map(),
};

// 应用 orchestrator 产出的 stateUpdates 到 myPosByCoin（副作用集中此处，纯函数不改 Map）
function applyStateUpdate(su) {
  const { coin, op, payload } = su;
  if (op === "set") state.myPosByCoin.set(coin, { ...payload });
  else if (op === "delete") state.myPosByCoin.delete(coin);
  else if (op === "setCurSize") { const p = state.myPosByCoin.get(coin); if (p) p.curSize = payload.curSize; }
  else if (op === "addMargin") { const p = state.myPosByCoin.get(coin); if (p) p.margin = add(String(p.margin ?? "0"), String(payload.addMargin)); }
  else if (op === "baseline-remove") state.baselineCoins.delete(coin);
}

// 仓位卡片：当前 myPosByCoin（我方镜像现状）+ 目标数据（对齐 watch 双卡片风格）
function buildMirrorCards(mappable, prices, assetIndex) {
  const byCoin = new Map(mappable.map((m) => [m.coin, m]));
  const positions = [];
  for (const [coin, p] of state.myPosByCoin) {
    const m = byCoin.get(coin);
    const meta = assetIndex.get(coin);
    positions.push({
      coin, size: p.curSize, leverage: p.leverage, szDecimals: meta?.szDecimals,
      refPx: prices[coin] ?? null, marginUsed: m?.marginUsed, targetEntryPx: m?.entryPx, targetSzi: m?.szi,
    });
  }
  if (positions.length === 0) return "📊 跟单仓位：无（等待目标新开仓）";
  return buildPositionCards(positions);
}

// 单轮对账（v3 预算模型）。返回收集的事件，由调用方统一记录 + 汇总推送。
async function reconcileOnce(env, target, avail, push, stateDir) {
  const t0 = Date.now();
  const [rawPositions, prices, assetIndex] = await Promise.all([
    fetchTargetState(env, target.source.address),
    fetchHypePrices(env),
    buildHypeAssetIndex(env),
  ]);
  const t1 = Date.now();
  const events = [];

  // 标的映射：不可映射 → skip-unmappable 告警。universe 空时跳过校验直通（冷启动/失败兜底）。
  const universe = assetIndex && assetIndex.size > 0 ? assetIndex : undefined;
  const mappable = [];
  for (const p of rawPositions) {
    const coin = mapSymbol(p.symbol, target.source.platform, universe);
    if (coin === null) events.push({ coin: p.symbol, side: "", result: "skip-unmappable", reason: "无 hype 映射" });
    else if (Number(p.szi) !== 0) mappable.push({ coin, szi: p.szi, marginUsed: p.marginUsed, leverage: p.leverage, entryPx: p.entryPx, lp: p.lp, cr: p.cr, cf: p.cf });
  }
  // 平仓 P&L 快照（目标平仓后 coin 消失，靠此取盈亏）
  for (const m of mappable) {
    state.lastCrByCoin.set(m.coin, String(m.cr ?? "0"));
    state.lastCfByCoin.set(m.coin, String(m.cf ?? "0"));
    state.lastTargetSziByCoin.set(m.coin, String(m.szi ?? "0"));
    state.lastLeverageByCoin.set(m.coin, m.leverage);
  }

  const startupRound = state.pendingStartup;

  // 首次部署 / 状态丢失 → 快照目标当前持仓为 baseline（只跟部署后新开，spec 09 §3.6 安全默认）
  if (!state.baselineCaptured) {
    state.baselineCoins = new Set(mappable.map((m) => m.coin));
    state.baselineCaptured = true;
    saveCopyState(stateDir, target.id, state);
    events.push({ coin: "", side: "", result: "baseline", coins: [...state.baselineCoins] });
    log(`[${target.id}] 建立基线快照（只跟部署后新开）：${[...state.baselineCoins].join(",") || "无存量仓"}`);
  }

  // v3 编排（dry-run getMyLiqPrice 缺省 → planBudgetReconcile 内部用 computeMyLiqPrice 模拟）
  const { actions, stateUpdates, alerts } = planBudgetReconcile({
    mappable, prices, assetIndex,
    myPosByCoin: state.myPosByCoin,
    config: { minOpenCapital: target.minOpenCapital, maxCoinCapital: target.maxCoinCapital, minDeltaPct: target.minDeltaPct, minOrderSize: DEFAULT_MIN_ORDER_SIZE },
    availBalance: avail,
    baselineCoins: state.baselineCoins,
  });

  // 执行 actions → dry-run 构造 + 收集事件（顺序：开仓先 would-update-leverage 再 would-place）
  for (const a of actions) {
    const meta = assetIndex.get(a.coin);
    if (a.decision === "place") {
      if (!meta) { events.push({ coin: a.coin, result: "skip-unmappable", reason: "hype universe 无此 coin" }); continue; }
      if (a.reason === "open" && a.openLeverage != null) {
        buildWouldUpdateLeverage({ assetIndex: meta.index, leverage: a.openLeverage, dryRun: target.dryRun });
        events.push({ coin: a.coin, result: "leverage", leverage: a.openLeverage, reason: "open" });
      }
      const wp = placeDryRun(
        { coin: a.coin, isBuy: a.isBuy, size: a.size, refPx: a.refPx, reduceOnly: a.reduceOnly },
        { assetIndex: meta.index, szDecimals: meta.szDecimals, slippageBps: MAX_SLIPPAGE_BPS, dryRun: target.dryRun },
      );
      if (a.reason === "target-gone" || a.reason === "reverse-close") {
        // 平仓：出富 close 卡片（用上轮快照的目标 cr/cf 折算我方 P&L；权威 closedPnl 留 Part B userFills）
        const tCr = state.lastCrByCoin.get(a.coin) ?? "0";
        const tSzi = state.lastTargetSziByCoin.get(a.coin) ?? "0";
        const ratio = gt(absStr(tSzi), "0") ? div(absStr(a.currentSize ?? "0"), absStr(tSzi)) : "0";
        events.push({
          coin: a.coin, result: "close", szDecimals: meta.szDecimals,
          targetPnl: tCr, targetFee: state.lastCfByCoin.get(a.coin) ?? "0",
          mirrorPnl: mul(tCr, ratio), mirrorFee: "0",
          prevSize: a.currentSize, targetPrevSzi: tSzi, leverage: state.lastLeverageByCoin.get(a.coin),
        });
      } else {
        events.push({
          coin: a.coin, side: a.isBuy ? "buy" : "sell", result: "place",
          currentSize: a.currentSize, desiredSize: a.desiredSize, deltaSize: sub(String(a.desiredSize ?? "0"), String(a.currentSize ?? "0")),
          size: wp.order.s, refPx: a.refPx, fillPx: a.refPx, slippageBps: 0, fee: "0",
          szDecimals: meta.szDecimals, reason: a.reason, openLeverage: a.openLeverage, M0: a.M0,
        });
      }
    } else if (a.decision === "would-defend") {
      if (!meta) continue;
      buildWouldUpdateMargin({ assetIndex: meta.index, isBuy: a.isBuy, amountUsd: a.wouldAddMargin, dryRun: target.dryRun });
      events.push({ coin: a.coin, result: "would-defend", wouldAddMargin: a.wouldAddMargin, ntli: a.ntli, liqBefore: a.liqBefore, liqAfter: a.liqAfter, exhausted: a.exhausted, targetLp: a.targetLp, size: a.size });
    } else {
      // skip-unmappable / skip-mindust / skip-no-open / noop
      events.push({ coin: a.coin, side: "", result: a.decision, reason: a.reason, targetLp: a.targetLp });
    }
  }
  // alerts → 告警事件（top-N 超限 / 认栽封顶）
  for (const al of alerts) {
    if (al.type === "max-positions") events.push({ coin: "", result: "alert", reason: `资金仅够跟 ${al.maxPositions} 个币，未跟：${(al.dropped || []).join(",") || "-"}` });
    else if (al.type === "defend-exhausted") events.push({ coin: al.coin, result: "alert", reason: `${al.coin} 已达单币上限 $${al.maxCoinCapital}，强平价 ${al.newLiqPx} 仍早于目标 lp ${al.targetLp}` });
  }

  // 应用状态更新 + 落盘（副作用集中）
  for (const su of stateUpdates) applyStateUpdate(su);
  saveCopyState(stateDir, target.id, state);

  const t2 = Date.now();
  const fullMs = t2 - t0;
  const execMs = t2 - t1;

  // 记录（每动作一条 JSONL + journald，始终）+ 收集推送行（去重）
  state.pendingStartup = false;
  const lines = [];
  const newAlertFp = new Set();
  for (const ev of events) {
    recordAction({ targetId: target.id, dryRun: target.dryRun, fullMs, execMs, ...ev });
    if (ev.result === "baseline" || ev.result === "leverage") continue; // 基线/杠杆内部记录，不单独推
    if (startupRound && ev.result === "place") continue; // 首轮 place 由启动卡片覆盖，不逐仓推
    const line = decidePushLine(ev, { lastAlertFp: state.lastAlertFp, wasFollowing: !startupRound, newAlertFp });
    if (line) lines.push(line);
  }
  state.lastAlertFp = newAlertFp;

  // banner kind：启动轮 startup；常规轮据 actions 含开/平判定
  const hasOpen = actions.some((a) => a.decision === "place" && a.reason === "open");
  const hasClose = actions.some((a) => a.decision === "place" && (a.reason === "target-gone" || a.reason === "reverse-close"));
  const kind = startupRound ? "startup" : hasClose ? "round_close" : hasOpen ? "round_open" : "round";

  const cards = buildMirrorCards(mappable, prices, assetIndex);
  const hasContent = startupRound || lines.length > 0;
  if (hasContent) {
    const summary = buildRoundSummary({
      kind,
      clock: fmtClock(),
      headerId: buildHeader(target.id, target.source.address, target.subAccount),
      positionCards: cards,
      startupExtra: startupRound ? `只跟部署后新开仓${state.baselineCoins.size ? `（忽略存量：${[...state.baselineCoins].join(",")}）` : ""}` : "",
      lines,
      footer: buildFooter(execMs, fullMs),
    });
    await pushRoundSummary(null, [summary], null, push);
  }
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const configPath = flags.config ?? "service/HYPE-copy/targets.json";
  const { tgToken, target } = loadTargets(configPath);
  if (flags.target && flags.target !== target.id) {
    throw new Error(`--target=${flags.target} 与 targets.json 实例 id=${target.id} 不符`);
  }

  const env = ENVS.production;
  const push = { token: tgToken, chat: target.tgChat };
  // dry-run 我方可用余额：仍为模拟输入（availBalanceSim）。真实余额（clearinghouseState）留 Part B B-1。
  const avail = String(target.availBalanceSim ?? flags.avail ?? "");
  if (!avail || !(Number(avail) > 0)) {
    throw new Error("dry-run 需 availBalanceSim（targets.json）或 --avail=<余额> 提供模拟可用余额");
  }

  // 状态持久化目录：--state-dir 覆盖，默认 HYPE-copy/state。重启恢复 baseline + myPos（spec 09 §3.6）。
  const stateDir = flags["state-dir"] || join(__dirname, "state");
  const restored = loadCopyState(stateDir, target.id);
  state.baselineCaptured = restored.baselineCaptured;
  state.baselineCoins = restored.baselineCoins;
  state.myPosByCoin = restored.myPos;
  if (restored.baselineCaptured) log(`[${target.id}] 恢复状态：baseline ${restored.baselineCoins.size} 币 / 在跟 ${restored.myPos.size} 币`);

  // single-flight：信号触发 / 180s 兜底 / 启动首轮 汇入同一串行入口，防并发改 state / 双记录 /（实盘）双下单。
  const trigger = makeSingleFlight(async () => {
    try { await reconcileOnce(env, target, avail, push, stateDir); }
    catch (e) { log(`[${target.id}] 对账失败：${e.message}`); }
  });

  // 信号订阅（事件驱动主触发）：按 <信号目录>/<source.address 小写>.json 自动派生。
  const signalPath = target.copySignalPath || join(DEFAULT_SIGNAL_DIR, `${String(target.source.address).toLowerCase()}.json`);
  let stopWatch = null;
  if (existsSync(dirname(signalPath))) {
    stopWatch = watchSignal(signalPath, () => trigger(), { interval: SIGNAL_POLL_MS });
    log(`[${target.id}] 订阅跟单信号：${signalPath}（${SIGNAL_POLL_MS}ms 轮询）`);
  } else {
    log(`[${target.id}] 信号目录不存在（${dirname(signalPath)}）→ 仅 ${RECONCILE_INTERVAL_SEC}s 轮询兜底`);
  }

  // 关闭跟单（进程停止）：SIGTERM/SIGINT → 推 ⏹ 后退出
  let shuttingDown = false;
  const header = buildHeader(target.id, target.source.address, target.subAccount);
  const shutdown = async (sig) => {
    if (shuttingDown) return;
    shuttingDown = true;
    if (stopWatch) stopWatch();
    log(`[${target.id}] 收到 ${sig}，关闭跟单`);
    try { await pushRoundSummary(header, [lineStop()], null, push); } catch {}
    process.exit(0);
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  log(`HYPE-copy 启动：target=${target.id} dryRun=${target.dryRun} avail(sim)=${avail} 预算 M0=${target.minOpenCapital}/max=${target.maxCoinCapital} 兜底=${RECONCILE_INTERVAL_SEC}s`);

  await trigger(); // 启动首轮
  setInterval(trigger, RECONCILE_INTERVAL_SEC * 1000); // 周期兜底（防漏接信号）
}

main().catch((e) => { console.error("HYPE-copy 启动失败:", e.message); process.exit(1); });
