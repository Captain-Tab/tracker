// HYPE 跟单执行器入口（单目标，对账循环）。一期 dry-run：只产 would-place，不签名不下单。
// 用法：node service/HYPE-copy/main.mjs --target=<id> --config=service/HYPE-copy/targets.json
// 通知：每轮对账后把 开/加/减/平 + 告警 合成一条 TG 汇总推送（去重 + 计时）；每动作落 JSONL。
import { loadTargets } from "./process/mapping.mjs";
import { mapSymbol } from "./process/mapping.mjs";
import { computeRatio, computeDesired, MIN_ORDER_NOTIONAL_USD } from "./process/sizing.mjs";
import { recommendMinCapital } from "./process/recommend.mjs";
import { planReconcile } from "./process/reconcile.mjs";
import { add, mul, absStr } from "./process/precision.mjs";
import { ENVS, fetchTargetState, fetchHypePrices, buildHypeAssetIndex, placeDryRun, log } from "./api/index.mjs";
import { recordAction, pushRoundSummary, decidePushLine } from "./notify/index.mjs";
import { buildHeader, buildFooter, buildPositionCards, fmtClock, lineStart, lineStop, buildRoundSummary, classifyMirrorEvent } from "./notify/templates.mjs";
import { watchSignal, makeSingleFlight, DEFAULT_SIGNAL_DIR } from "../lib/copy-signal/index.mjs";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";

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
  phase: "idle",
  anchoredRatio: null,
  lastWouldHold: new Map(), // coin → 带符号 size（上一轮 would-hold）；喂 diffDelta 当 current
  lastAlertFp: new Set(), // "coin:result"：持续告警去重
  wasFollowing: false, // min-capital 仅锚定轮推一次
  pendingStartup: true, // 首轮 = 启动 + 初始镜像同步
  lastCrByCoin: new Map(), // coin → cr（目标累计已实现，平仓快照用）
  lastCfByCoin: new Map(), // coin → cf（目标累计资金费率）
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
  // universe 非空才传入校验（冷启动/失败时 assetIndex 空 → 跳过校验直通，避免误判全不可映射）
  const universe = assetIndex && assetIndex.size > 0 ? assetIndex : undefined;
  const mappable = [];
  for (const p of rawPositions) {
    const coin = mapSymbol(p.symbol, target.source.platform, universe);
    if (coin === null) events.push({ coin: p.symbol, side: "", result: "skip-unmappable", reason: "无 hype 映射" });
    else if (Number(p.szi) !== 0) mappable.push({ coin, szi: p.szi, marginUsed: p.marginUsed, leverage: p.leverage, entryPx: p.entryPx, cr: p.cr, cf: p.cf });
  }

  let targetMappableMargin = "0";
  for (const m of mappable) {
    targetMappableMargin = add(targetMappableMargin, m.marginUsed);
    // 平仓快照：记下本轮 cr/cf（目标平仓后 coin 从 mappable 消失，靠此快照取盈亏）
    state.lastCrByCoin.set(m.coin, String(m.cr ?? "0"));
    state.lastCfByCoin.set(m.coin, String(m.cf ?? "0"));
  }
  const hasMappable = mappable.length > 0 && Number(targetMappableMargin) > 0;
  const prevCoins = new Set(state.lastWouldHold.keys()); // 上轮持仓币种（平仓检测用）

  let desired = [];
  let desiredEnriched = [];
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

    // 增强 desired 仓位元数据（leverage / szDecimals / refPx），供模板卡片展示
    desiredEnriched = desired.map((d) => {
      const m = mappable.find((x) => x.coin === d.coin);
      const meta = assetIndex.get(d.coin);
      return {
        coin: d.coin,
        size: d.size,
        leverage: m?.leverage,
        szDecimals: meta?.szDecimals,
        refPx: prices[d.coin] ?? null,
        marginUsed: m?.marginUsed,
        targetEntryPx: m?.entryPx,
        targetSzi: m?.szi,
        targetCr: m?.cr,
        targetCf: m?.cf,
      };
    });
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
      // skip 类事件：附加上下文供模板展示（仓位名义 / 上限数值）
      const posNotional = a.refPx ? mul(absStr(a.desiredSize ?? "0"), String(a.refPx)) : null;
      events.push({
        ...base, result: a.decision, size: a.size, reason: a.decision,
        szDecimals: assetIndex.get(a.coin)?.szDecimals,
        ...(a.decision === "skip-maxpos" && posNotional ? { positionNotional: posNotional, maxPosNotional: mul(String(avail), String(target.maxPositionPct)), availBalance: avail, maxPositionPct: target.maxPositionPct } : {}),
        ...(a.decision === "skip-capped" ? { wouldDeploy: add(String(caps.currentDeployedNotional), mul(absStr(a.desiredSize ?? "0"), String(a.refPx))), maxDeployNotional: mul(String(avail), String(target.maxDeployPct)) } : {}),
      });
      continue;
    }
    const meta = assetIndex.get(a.coin);
    if (!meta) { events.push({ coin: a.coin, side, result: "skip-unmappable", reason: "hype universe 无此 coin" }); continue; }
    const wp = placeDryRun(
      { coin: a.coin, isBuy: a.isBuy, size: a.size, refPx: a.refPx, reduceOnly: a.reduceOnly },
      { assetIndex: meta.index, szDecimals: meta.szDecimals, slippageBps: MAX_SLIPPAGE_BPS, dryRun: target.dryRun },
    );
    // dry-run fillPx 假定=refPx（总纲 §3.2 ActionResult）→ slippageBps 0、fee 估算 "0"
    events.push({ ...base, result: "place", size: wp.order.s, fillPx: a.refPx, slippageBps: 0, fee: "0", szDecimals: meta.szDecimals });
  }

  // 平仓检测：上轮有、本轮 desired 无 → 目标平仓（仅 anchored 后有效）
  if (ratio != null) {
    const desiredCoins = new Set(desired.map((d) => d.coin));
    for (const coin of prevCoins) {
      if (!desiredCoins.has(coin)) {
        const targetPnl = state.lastCrByCoin.get(coin) ?? "0";
        const targetFee = state.lastCfByCoin.get(coin) ?? "0";
        const meta = assetIndex.get(coin);
        events.push({
          coin, side: "", result: "close",
          szDecimals: meta?.szDecimals,
          targetPnl, targetFee,
          mirrorPnl: mul(targetPnl, String(ratio)),
          mirrorFee: "0", // dry-run 无手续费
          ratio,
          prevSize: state.lastWouldHold.get(coin) ?? "0",
        });
      }
    }
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
    if (startupRound && ev.result === "place") continue; // 首轮 place 由初始镜像同步卡片覆盖，不逐仓推
    const line = decidePushLine(ev, { lastAlertFp: state.lastAlertFp, wasFollowing: state.wasFollowing, newAlertFp });
    if (line) lines.push(line);
  }
  state.lastAlertFp = newAlertFp;
  state.wasFollowing = hasMappable;

  // 更新 would-hold = 本轮 desired 镜像（关闭仓自然从集合移除）
  state.lastWouldHold = new Map(desired.map((d) => [d.coin, String(d.size)]));

  // 构建轮次汇总（卡片式，对齐 watch 风格）
  const clock = fmtClock();
  const headerId = buildHeader(target.id, target.source.address, target.subAccount);
  // banner kind 推导：启动轮 fixed，常规轮根据事件含 close/open 判定
  let kind;
  if (startupRound) {
    kind = hasMappable ? "initial_sync" : "startup";
  } else {
    const hasClose = events.some((e) => e.result === "close");
    const hasOpen = events.some((e) => e.result === "place" && classifyMirrorEvent(e.currentSize ?? "0", e.desiredSize ?? "0") === "open");
    kind = hasClose ? "round_close" : hasOpen ? "round_open" : "round";
  }
  // 仅有效内容时推送（常规轮无变化静默跳过）
  const hasContent = startupRound || (lines && lines.length > 0);
  // 仓位卡片：只要有活跃仓位就展示（不再仅启动轮）
  const activeCards = hasMappable ? buildPositionCards(desiredEnriched) : null;
  if (hasContent) {
    const summary = buildRoundSummary({
      kind,
      clock,
      headerId,
      positionCards: activeCards,
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
  // 跟单推送独立配置：token 走文件根 tgToken，chat 走每目标 tgChat（与 watch 物理分离）
  const push = { token: tgToken, chat: target.tgChat };
  // dry-run 我方可用余额：一期为模拟输入（availBalanceSim）。真实余额拉取留待真实下单阶段。
  const avail = String(target.availBalanceSim ?? flags.avail ?? "");
  if (!avail || !(Number(avail) > 0)) {
    throw new Error("dry-run 需 availBalanceSim（targets.json）或 --avail=<余额> 提供模拟可用余额");
  }

  // single-flight：信号触发 / 180s 兜底 / 启动首轮 全部汇入同一串行入口，
  // 防并发改 state / 双记录 /（实盘）双下单；跑中再触发合并为结束后补跑一次。
  const trigger = makeSingleFlight(async () => {
    try { await reconcileOnce(env, target, avail, push); }
    catch (e) { log(`[${target.id}] 对账失败：${e.message}`); }
  });

  // 信号订阅（事件驱动主触发）：copy 零配置——按 <信号目录>/<source.address>.json 自动派生，
  // 无需在 targets.json 填路径（可选 copySignalPath 覆盖）。信号目录存在=已 setup → 订阅；否则仅轮询兜底。
  // 文件名地址统一小写——与 watch 侧派生口径一致（防 checksum/小写不一致导致路径对不上）
  const signalPath = target.copySignalPath || join(DEFAULT_SIGNAL_DIR, `${String(target.source.address).toLowerCase()}.json`);
  let stopWatch = null;
  if (existsSync(dirname(signalPath))) {
    stopWatch = watchSignal(signalPath, () => trigger(), { interval: SIGNAL_POLL_MS });
    log(`[${target.id}] 订阅跟单信号：${signalPath}（${SIGNAL_POLL_MS}ms 轮询）`);
  } else {
    log(`[${target.id}] 信号目录不存在（${dirname(signalPath)}）→ 仅 ${RECONCILE_INTERVAL_SEC}s 轮询兜底`);
  }

  // 关闭跟单（进程停止）：SIGTERM/SIGINT → 推 ⏹ 后退出（区别于"目标平仓 🏁"）
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

  log(`HYPE-copy 启动：target=${target.id} dryRun=${target.dryRun} avail(sim)=${avail} 兜底=${RECONCILE_INTERVAL_SEC}s`);

  await trigger(); // 启动首轮
  setInterval(trigger, RECONCILE_INTERVAL_SEC * 1000); // 周期兜底（防漏接信号）
}

main().catch((e) => { console.error("HYPE-copy 启动失败:", e.message); process.exit(1); });
