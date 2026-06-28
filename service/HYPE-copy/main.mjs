// HYPE 跟单执行器入口（单目标，对账循环）。一期 dry-run：只打印 would-place，不签名不下单。
// 用法：node service/HYPE-copy/main.mjs --target=<id> --config=service/HYPE-copy/targets.json
// 推送 / JSONL 落盘成形归 04；本阶段对账产出 would-place + skip 告警，先 console.log。
import { loadTargets } from "./process/mapping.mjs";
import { mapSymbol } from "./process/mapping.mjs";
import { computeRatio, computeDesired, MIN_ORDER_NOTIONAL_USD } from "./process/sizing.mjs";
import { recommendMinCapital } from "./process/recommend.mjs";
import { planReconcile } from "./process/reconcile.mjs";
import { add } from "./process/precision.mjs";
import { ENVS, fetchTargetState, fetchHypePrices, buildHypeAssetIndex, placeDryRun, log } from "./api/index.mjs";

// 执行腿参数（blueprint §10.6 建议默认）
const RECONCILE_INTERVAL_SEC = 15; // 周期对账兜底间隔
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

// 跟单目标生命周期（总纲 §2.1）：anchored 时锚定 ratio，following 固定，flat 重锚。
const state = { phase: "idle", anchoredRatio: null };

// 单轮对账（事件触发 + 周期触发共用，幂等）。顺序铁律见总纲 §2.2。
async function reconcileOnce(env, target, avail) {
  const platform = target.source.platform;
  const [rawPositions, prices, assetIndex] = await Promise.all([
    fetchTargetState(env, target.source.address),
    fetchHypePrices(env),
    buildHypeAssetIndex(env),
  ]);

  // 标的映射：sodex 走映射表（不可映射 → skip-unmappable 告警，不计 ratio 分母）；hype 同所直通。
  const mappable = [];
  const unmappable = [];
  for (const p of rawPositions) {
    const coin = mapSymbol(p.symbol, platform);
    if (coin === null) unmappable.push(p.symbol);
    else if (Number(p.szi) !== 0) mappable.push({ coin, szi: p.szi, marginUsed: p.marginUsed, leverage: p.leverage });
  }

  // ratio 分母：Σ 可映射仓 marginUsed
  let targetMappableMargin = "0";
  for (const m of mappable) targetMappableMargin = add(targetMappableMargin, m.marginUsed);

  if (mappable.length === 0 || !(Number(targetMappableMargin) > 0)) {
    state.phase = state.anchoredRatio == null ? "idle" : "flat";
    state.anchoredRatio = null; // flat → 下轮重锚
    log(`[${target.id}] 目标无可映射净仓（phase=${state.phase}），不部署${unmappable.length ? `；跳过不可映射：${unmappable.join(",")}` : ""}`);
    return;
  }

  // 锚定 ratio：首次出现可映射仓时锚定，following 期固定（总纲 §2.1）
  if (state.anchoredRatio == null) {
    state.anchoredRatio = computeRatio(avail, target.initialDeployPct, targetMappableMargin);
    state.phase = "anchored";
    log(`[${target.id}] 锚定 ratio=${state.anchoredRatio}（avail=${avail} × ${target.initialDeployPct} / margin=${targetMappableMargin}）`);
  }
  const ratio = state.anchoredRatio;
  state.phase = "following";

  // 最低本金建议（开跟轮，供 04 推送）
  const rec = recommendMinCapital(mappable, prices, target.initialDeployPct, ratio);
  log(`[${target.id}] 推荐最低本金=${rec.minCapital}，ratioMin=${rec.ratioMin}；可跟 ${rec.perLeg.filter((l) => l.canFollow).map((l) => l.coin).join(",") || "-"}`);

  // 算 desired（缺价仓标记跳过 → 告警）
  const desiredRaw = computeDesired(mappable, ratio, prices);
  const desired = desiredRaw.filter((d) => !d.skipped);
  for (const d of desiredRaw) if (d.skipped) log(`[${target.id}] skip-${d.reason}：${d.coin}（缺价，跳过本轮）`);

  // 校验门 + would-place（dry-run current 恒空 → 每轮 desired 即全量；总纲 §03）
  const caps = {
    maxDeployPct: target.maxDeployPct,
    maxPositionPct: target.maxPositionPct,
    minDeltaPct: target.minDeltaPct,
    minNotional: MIN_ORDER_NOTIONAL_USD,
    minOrderSize: DEFAULT_MIN_ORDER_SIZE,
    currentDeployedNotional: "0",
    availBalance: avail,
  };
  const { actions } = planReconcile(desired, [], caps, prices);

  for (const a of actions) {
    if (a.decision !== "place") {
      log(`[${target.id}] ${a.decision}：${a.coin} delta=${a.deltaSize}`);
      continue;
    }
    const meta = assetIndex.get(a.coin);
    if (!meta) { log(`[${target.id}] skip-unmappable：${a.coin}（hype universe 无此 coin）`); continue; }
    const wp = placeDryRun(
      { coin: a.coin, isBuy: a.isBuy, size: a.size, refPx: a.refPx, reduceOnly: a.reduceOnly },
      { assetIndex: meta.index, szDecimals: meta.szDecimals, slippageBps: MAX_SLIPPAGE_BPS, dryRun: target.dryRun },
    );
    log(`[${target.id}] [DRY-RUN] would-place ${a.coin} ${a.isBuy ? "buy" : "sell"} ${wp.order.s} @ ${wp.order.p}（IOC，ratio=${ratio}）`);
  }
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const configPath = flags.config ?? "service/HYPE-copy/targets.json";
  const { target } = loadTargets(configPath);
  if (flags.target && flags.target !== target.id) {
    throw new Error(`--target=${flags.target} 与 targets.json 实例 id=${target.id} 不符`);
  }

  const env = ENVS.production;
  // dry-run 我方可用余额：一期为模拟输入（availBalanceSim）。
  // 真实余额（hype clearinghouseState.withdrawable）拉取留待真实下单阶段接入。
  const avail = String(target.availBalanceSim ?? flags.avail ?? "");
  if (!avail || !(Number(avail) > 0)) {
    throw new Error("dry-run 需 availBalanceSim（targets.json）或 --avail=<余额> 提供模拟可用余额");
  }

  log(`HYPE-copy 启动：target=${target.id} dryRun=${target.dryRun} avail(sim)=${avail} 间隔=${RECONCILE_INTERVAL_SEC}s`);

  const tick = async () => {
    try { await reconcileOnce(env, target, avail); }
    catch (e) { log(`[${target.id}] 对账失败：${e.message}`); }
  };
  await tick();
  setInterval(tick, RECONCILE_INTERVAL_SEC * 1000);
}

main().catch((e) => { console.error("HYPE-copy 启动失败:", e.message); process.exit(1); });
