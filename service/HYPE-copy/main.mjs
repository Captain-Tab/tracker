// HYPE 跟单执行器入口（单目标，对账循环）。一期 dry-run：只产 would-place，不签名不下单。
// 用法：node service/HYPE-copy/main.mjs --target=<id> --config=service/HYPE-copy/targets.json
// 通知：每轮对账后把 开/加/减/平 + 告警 合成一条 TG 汇总推送（去重 + 计时）；每动作落 JSONL。
import { loadTargets } from "./process/mapping.mjs";
import { mapSymbol } from "./process/mapping.mjs";
import { computeRatio, computeDesired, MIN_ORDER_NOTIONAL_USD } from "./process/sizing.mjs";
import { recommendMinCapital } from "./process/recommend.mjs";
import { planReconcile } from "./process/reconcile.mjs";
import { add } from "./process/precision.mjs";
import { ENVS, fetchTargetState, fetchHypePrices, buildHypeAssetIndex, placeDryRun, log } from "./api/index.mjs";
import { recordAction, pushRoundSummary, decidePushLine } from "./notify/index.mjs";
import { buildHeader, buildFooter, lineInitialSync, lineStart, lineStop } from "./notify/templates.mjs";

// 执行腿参数（blueprint §10.6 建议默认）
const RECONCILE_INTERVAL_SEC = 60; // 周期对账间隔（dry-run 轮询；事件驱动下一档降为 180s 兜底）
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
  phase: "idle",
  anchoredRatio: null,
  lastWouldHold: new Map(), // coin → 带符号 size（上一轮 would-hold）；喂 diffDelta 当 current
  lastAlertFp: new Set(), // "coin:result"：持续告警去重
  wasFollowing: false, // min-capital 仅锚定轮推一次
  pendingStartup: true, // 首轮 = 启动 + 初始镜像同步
};

// 单轮对账（顺序铁律见总纲 §2.2）。返回收集的事件，由调用方统一记录 + 汇总推送。
async function reconcileOnce(env, target, avail, push) {
  const t0 = Date.now();
  const [rawPositions, prices, assetIndex] = await Promise.all([
    fetchTargetState(env, target.source.address),
    fetchHypePrices(env),
    buildHypeAssetIndex(env),
  ]);
  const t1 = Date.now();

  const events = []; // 待记录 + 待推送的动作；顺序即推送顺序

  // 标的映射：不可映射 → skip-unmappable 告警，不计 ratio 分母
  const mappable = [];
  for (const p of rawPositions) {
    const coin = mapSymbol(p.symbol, target.source.platform);
    if (coin === null) events.push({ coin: p.symbol, side: "", result: "skip-unmappable", reason: "无 hype 映射" });
    else if (Number(p.szi) !== 0) mappable.push({ coin, szi: p.szi, marginUsed: p.marginUsed, leverage: p.leverage });
  }

  let targetMappableMargin = "0";
  for (const m of mappable) targetMappableMargin = add(targetMappableMargin, m.marginUsed);
  const hasMappable = mappable.length > 0 && Number(targetMappableMargin) > 0;

  let desired = [];
  let ratio = null;
  if (hasMappable) {
    if (state.anchoredRatio == null) {
      state.anchoredRatio = computeRatio(avail, target.initialDeployPct, targetMappableMargin);
      log(`[${target.id}] 锚定 ratio=${state.anchoredRatio}（avail=${avail} × ${target.initialDeployPct} / margin=${targetMappableMargin}）`);
    }
    state.phase = "following";
    ratio = state.anchoredRatio;

    const rec = recommendMinCapital(mappable, prices, target.initialDeployPct, ratio);
    const canFollowCoins = rec.perLeg.filter((l) => l.canFollow).map((l) => l.coin).join(",") || "-";
    events.push({ coin: "", side: "", result: "min-capital", minCapital: rec.minCapital, canFollowCoins, ratio });

    const desiredRaw = computeDesired(mappable, ratio, prices);
    desired = desiredRaw.filter((d) => !d.skipped);
    for (const d of desiredRaw) if (d.skipped) events.push({ coin: d.coin, side: "", result: "skip-no-price", reason: d.reason });
  } else {
    state.phase = state.lastWouldHold.size > 0 ? "flat" : "idle";
    state.anchoredRatio = null; // flat → 下轮重锚
  }

  // 对账：current = 上一轮 would-hold（非空）→ 产 开/加/减/平 + skip（总纲 §2.2）
  const current = [...state.lastWouldHold].map(([coin, size]) => ({ coin, size }));
  const caps = {
    maxDeployPct: target.maxDeployPct,
    maxPositionPct: target.maxPositionPct,
    minDeltaPct: target.minDeltaPct,
    minNotional: MIN_ORDER_NOTIONAL_USD,
    minOrderSize: DEFAULT_MIN_ORDER_SIZE,
    currentDeployedNotional: "0",
    availBalance: avail,
  };
  const { actions } = planReconcile(desired, current, caps, prices);

  for (const a of actions) {
    const side = a.isBuy ? "buy" : "sell";
    const base = { coin: a.coin, side, currentSize: a.currentSize, desiredSize: a.desiredSize, deltaSize: a.deltaSize, refPx: a.refPx, ratio };
    if (a.decision !== "place") {
      events.push({ ...base, result: a.decision, size: a.size, reason: a.decision });
      continue;
    }
    const meta = assetIndex.get(a.coin);
    if (!meta) { events.push({ coin: a.coin, side, result: "skip-unmappable", reason: "hype universe 无此 coin" }); continue; }
    const wp = placeDryRun(
      { coin: a.coin, isBuy: a.isBuy, size: a.size, refPx: a.refPx, reduceOnly: a.reduceOnly },
      { assetIndex: meta.index, szDecimals: meta.szDecimals, slippageBps: MAX_SLIPPAGE_BPS, dryRun: target.dryRun },
    );
    // dry-run fillPx 假定=refPx（总纲 §3.2 ActionResult）→ slippageBps 0、fee 估算 "0"
    events.push({ ...base, result: "place", size: wp.order.s, fillPx: a.refPx, slippageBps: 0, fee: "0" });
  }

  const t2 = Date.now();
  const fullMs = t2 - t0;
  const execMs = t2 - t1;

  // 记录（每动作一条 JSONL + journald，始终）+ 收集推送行（去重）
  const startupRound = state.pendingStartup;
  state.pendingStartup = false;
  const lines = [];
  const newAlertFp = new Set();
  for (const ev of events) {
    recordAction({ targetId: target.id, dryRun: target.dryRun, fullMs, execMs, ...ev });
    if (startupRound && ev.result === "place") continue; // 首轮 place 由初始镜像同步行覆盖，不逐仓推
    const line = decidePushLine(ev, { lastAlertFp: state.lastAlertFp, wasFollowing: state.wasFollowing, newAlertFp });
    if (line) lines.push(line);
  }
  state.lastAlertFp = newAlertFp;
  state.wasFollowing = hasMappable;

  // 首轮：启动 + 初始镜像同步（不逐仓当开仓洪水）
  if (startupRound) {
    if (hasMappable) lines.unshift(lineInitialSync(desired.map((d) => ({ coin: d.coin, size: d.size }))));
    else lines.unshift(lineStart("待锚定，目标无可映射仓"));
  }

  // 更新 would-hold = 本轮 desired 镜像（关闭仓自然从集合移除）
  state.lastWouldHold = new Map(desired.map((d) => [d.coin, String(d.size)]));

  const header = buildHeader(target.id, target.source.address, target.subAccount);
  await pushRoundSummary(header, lines, buildFooter(execMs, fullMs), push);
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const configPath = flags.config ?? "service/HYPE-copy/targets.json";
  const { tgToken, target } = loadTargets(configPath);
  if (flags.target && flags.target !== target.id) {
    throw new Error(`--target=${flags.target} 与 targets.json 实例 id=${target.id} 不符`);
  }

  const env = ENVS.production;
  // 跟单推送独立配置：token 走文件根 tgToken，chat 走每目标 tgChat（与 watch 物理分离）
  const push = { token: tgToken, chat: target.tgChat };
  // dry-run 我方可用余额：一期为模拟输入（availBalanceSim）。真实余额拉取留待真实下单阶段。
  const avail = String(target.availBalanceSim ?? flags.avail ?? "");
  if (!avail || !(Number(avail) > 0)) {
    throw new Error("dry-run 需 availBalanceSim（targets.json）或 --avail=<余额> 提供模拟可用余额");
  }

  // 关闭跟单（进程停止）：SIGTERM/SIGINT → 推 ⏹ 后退出（区别于"目标平仓 🏁"）
  let shuttingDown = false;
  const header = buildHeader(target.id, target.source.address, target.subAccount);
  const shutdown = async (sig) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`[${target.id}] 收到 ${sig}，关闭跟单`);
    try { await pushRoundSummary(header, [lineStop()], null, push); } catch {}
    process.exit(0);
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  log(`HYPE-copy 启动：target=${target.id} dryRun=${target.dryRun} avail(sim)=${avail} 间隔=${RECONCILE_INTERVAL_SEC}s`);

  const tick = async () => {
    try { await reconcileOnce(env, target, avail, push); }
    catch (e) { log(`[${target.id}] 对账失败：${e.message}`); }
  };
  await tick();
  setInterval(tick, RECONCILE_INTERVAL_SEC * 1000);
}

main().catch((e) => { console.error("HYPE-copy 启动失败:", e.message); process.exit(1); });
