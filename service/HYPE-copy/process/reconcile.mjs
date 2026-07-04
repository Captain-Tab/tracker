// 收敛对账纯逻辑：diffDelta（净仓做差，非逐 fill）+ planReconcile（旧 ratio，@deprecated）
// + planBudgetReconcile（v3 预算模型顶层编排，spec 07 §3.7 / spec 09 §3.3）。
// 总纲 §2.2 顺序：算 desired → decideLeg 校验门 → 仅 place 进 would-place。
// 精度走 precision.mjs（禁裸 parseFloat）。下单 px/sz 字符串化在 placeDryRun（api）。
import { sub, add, mul, div, gt, lt, signOf, absStr } from "./precision.mjs";
import { decideLeg, legSideOf } from "./risk.mjs";
import { selectLeverage, planOpen, planFollow, planDefend, computeMyLiqPrice, sideOf } from "./allocation.mjs";
import { MIN_ORDER_NOTIONAL_USD } from "./sizing.mjs";

// diffDelta(desired[], current[]) → delta[]：按净仓做差（coin = desired ∪ current）。
// dry-run current 恒空 → delta 即 desired 全量（每轮 first-class would-place）。
// 天然吸收滚仓中间态：只看最新 desired 与 current 做差，一步对齐（滚仓三层之①）。
export function diffDelta(desired, current) {
  const desiredMap = new Map((Array.isArray(desired) ? desired : []).filter((d) => d && d.coin && d.size != null).map((d) => [d.coin, String(d.size)]));
  const currentMap = new Map((Array.isArray(current) ? current : []).filter((c) => c && c.coin).map((c) => [c.coin, String(c.size ?? "0")]));
  const coins = new Set([...desiredMap.keys(), ...currentMap.keys()]);
  const out = [];
  for (const coin of coins) {
    const targetDesiredSize = desiredMap.get(coin) ?? "0";
    const currentSize = currentMap.get(coin) ?? "0";
    const deltaSize = sub(targetDesiredSize, currentSize);
    out.push({ coin, deltaSize, side: signOf(deltaSize), targetDesiredSize, currentSize });
  }
  return out;
}

// planReconcile(desired[], current[], caps, prices) → { actions[] }
// actions 每项：{ coin, decision, deltaSize, isBuy, reduceOnly, desiredSize, currentSize, refPx }
// 顺序铁律：先 diffDelta，再逐仓 decideLeg；place 项可直接喂 placeDryRun（main 注入 assetMeta）。
export function planReconcile(desired, current, caps, prices) {
  const currentByCoin = new Map((Array.isArray(current) ? current : []).filter((c) => c && c.coin).map((c) => [c.coin, c]));
  const deltas = diffDelta(desired, current);
  const desiredByCoin = new Map((Array.isArray(desired) ? desired : []).filter((d) => d && d.coin).map((d) => [d.coin, d]));

  const actions = [];
  // 跨腿累加已部署名义：place 的加仓腿计入，使后续加仓腿能正确触发 capped（总纲 §3.3 部署上限）。
  let deployed = String(caps?.currentDeployedNotional ?? "0");
  for (const d of deltas) {
    const desiredLeg = desiredByCoin.get(d.coin) ?? { coin: d.coin, size: d.targetDesiredSize };
    const cur = currentByCoin.get(d.coin) ?? null;
    const decision = decideLeg(desiredLeg, cur, { ...caps, currentDeployedNotional: deployed }, prices);
    const { isBuy, reduceOnly } = legSideOf(d.deltaSize, d.targetDesiredSize, d.currentSize);
    const price = prices?.[d.coin];
    if (decision === "place" && isBuy && price != null) {
      deployed = add(deployed, mul(absStr(d.targetDesiredSize), String(price)));
    }
    actions.push({
      coin: d.coin,
      decision,
      deltaSize: d.deltaSize,
      isBuy,
      reduceOnly,
      desiredSize: d.targetDesiredSize,
      currentSize: d.currentSize,
      refPx: prices?.[d.coin] ?? null,
      size: absStr(d.deltaSize), // 下单量级（方向走 isBuy）
    });
  }
  return { actions };
}

// mm（维持保证金率）= 1/(2×maxLeverage)（07-budget-alloc §3.2）。maxLeverage 来自 hype meta。
function mmFromMaxLeverage(maxLeverage) {
  const lev = Math.max(1, Number(maxLeverage) || 1);
  return 1 / (2 * lev);
}

// planBudgetReconcile：v3 预算模型一轮编排（纯函数，spec 07 §3.7 伪代码 / spec 09 §3.3/§3.6）。
// 替换 planReconcile 的 ratio 链路。副作用留 main：本函数只产 actions + stateUpdates + alerts。
// 入参：
//   mappable       [{coin, szi, leverage, entryPx, lp, marginUsed}]（目标可映射仓，szi≠0）
//   prices         coin→mid(str)
//   assetIndex     coin→{index, szDecimals, maxLeverage}
//   myPosByCoin    Map<coin,{margin, openSize, openTargetSzi, leverage, side, curSize}>（只读，dry-run 模拟/实盘真实）
//   config         {minOpenCapital, maxCoinCapital, minDeltaPct?, minOrderSize?}
//   availBalance   我方可用余额(str)
//   getMyLiqPrice? ({coin, entryPx, margin, size, side, mm})→liqPx；缺省用 computeMyLiqPrice（dry-run）
//   baselineCoins  Set<coin> 部署前存量，永不跟（spec 09 §3.6）
// 返回 { actions, stateUpdates, alerts }。
export function planBudgetReconcile({ mappable, prices, assetIndex, myPosByCoin, config, availBalance, getMyLiqPrice, baselineCoins }) {
  const actions = [];
  const stateUpdates = [];
  const alerts = [];
  const baseline = baselineCoins instanceof Set ? baselineCoins : new Set(baselineCoins || []);
  const pos = myPosByCoin instanceof Map ? myPosByCoin : new Map();
  const minOpenCapital = String(config?.minOpenCapital ?? "0");
  const maxCoinCapital = String(config?.maxCoinCapital ?? "0");
  const caps = { minNotional: MIN_ORDER_NOTIONAL_USD, minOrderSize: String(config?.minOrderSize ?? "0.0001"), minDeltaPct: String(config?.minDeltaPct ?? "0") };
  const liqOf = typeof getMyLiqPrice === "function" ? getMyLiqPrice : (p) => computeMyLiqPrice(p);

  const targetByCoin = new Map((Array.isArray(mappable) ? mappable : []).map((m) => [m.coin, m]));

  // maxPositions = floor(avail / maxCoinCapital)（每槽预留满额，无跨币抢占，§3.2）
  const maxPositions = gt(maxCoinCapital, "0") ? Math.floor(Number(div(String(availBalance), maxCoinCapital))) : 0;

  // baseline 币已从目标消失 → 移出（将来再开算新开）
  for (const coin of baseline) {
    if (!targetByCoin.has(coin)) stateUpdates.push({ coin, op: "baseline-remove" });
  }

  // 已跟仓但目标已无 → 平仓（reduceOnly，绕过 decideLeg 以确保能平）
  for (const [coin, P] of pos) {
    if (targetByCoin.has(coin)) continue;
    const meta = assetIndex.get(coin);
    actions.push({ coin, decision: "place", reduceOnly: true, isBuy: signOf(P.curSize) < 0, desiredSize: "0", currentSize: P.curSize, size: absStr(P.curSize), refPx: prices?.[coin] ?? null, szDecimals: meta?.szDecimals, reason: "target-gone" });
    stateUpdates.push({ coin, op: "delete" });
  }

  // 新开候选（top-N）：非 baseline、未持仓、目标有仓；现有跟仓占槽，剩余槽给目标名义降序 top-N
  const notionalOf = (m) => { const px = prices?.[m.coin]; return px ? Number(mul(absStr(m.szi), String(px))) : 0; };
  const openCandidates = (Array.isArray(mappable) ? mappable : [])
    .filter((m) => !baseline.has(m.coin) && !pos.has(m.coin) && Number(m.szi) !== 0)
    .sort((a, b) => notionalOf(b) - notionalOf(a));
  const freeSlots = Math.max(0, maxPositions - pos.size);
  const openAllowed = new Set(openCandidates.slice(0, freeSlots).map((m) => m.coin));
  if (openCandidates.length > freeSlots) {
    alerts.push({ type: "max-positions", maxPositions, followed: pos.size, dropped: openCandidates.slice(freeSlots).map((m) => m.coin) });
  }

  // 逐目标币分派（§3.7）
  for (const m of mappable) {
    const coin = m.coin;
    if (baseline.has(coin)) continue; // 基线仓：不开、不跟增减、不防守
    const meta = assetIndex.get(coin);
    if (!meta) { actions.push({ coin, decision: "skip-unmappable", reason: "hype universe 无此 coin" }); continue; }
    const refPx = prices?.[coin] ?? null;
    if (refPx == null || !gt(String(refPx), "0")) { actions.push({ coin, decision: "skip-mindust", reason: "缺价" }); continue; }
    const mm = mmFromMaxLeverage(meta.maxLeverage);
    const side = sideOf(m.szi);
    const P = pos.get(coin);

    if (!P) {
      // 未持仓 → 新开
      if (!openAllowed.has(coin)) continue; // 槽位不足，本轮不开（已 alert）
      const lev = selectLeverage({ entryPx: m.entryPx, targetLp: m.lp, mm, maxLeverage: meta.maxLeverage, side, targetLeverage: m.leverage });
      if (lev.leverage == null) { actions.push({ coin, decision: "skip-no-open", reason: "开仓价已越目标 lp 侧", targetLp: m.lp }); continue; }
      const open = planOpen({ minOpenCapital, openLeverage: lev.leverage, entryPx: m.entryPx, targetSzi: m.szi, szDecimals: meta.szDecimals });
      if (open.skip) { actions.push({ coin, decision: "skip-mindust", reason: "本金太小/名义<$10", M0: open.M0 }); continue; }
      const decision = decideLeg({ coin, size: open.size }, null, caps, prices);
      if (decision !== "place") { actions.push({ coin, decision, reason: decision }); continue; }
      actions.push({ coin, decision: "place", isBuy: signOf(open.size) > 0, reduceOnly: false, desiredSize: open.size, currentSize: "0", size: absStr(open.size), refPx, openLeverage: lev.leverage, M0: open.M0, assetIndex: meta.index, szDecimals: meta.szDecimals, defendableToTargetLp: lev.defendableToTargetLp, reason: "open" });
      stateUpdates.push({ coin, op: "set", payload: { margin: open.M0, openSize: open.size, openTargetSzi: String(m.szi), leverage: lev.leverage, side, curSize: open.size } });
      continue;
    }

    // 已持仓，反手（方向翻转）→ 先平原仓，下轮走开仓（重置 S0/T0/leverage）
    if (P.side !== side) {
      actions.push({ coin, decision: "place", reduceOnly: true, isBuy: signOf(P.curSize) < 0, desiredSize: "0", currentSize: P.curSize, size: absStr(P.curSize), refPx, szDecimals: meta.szDecimals, reason: "reverse-close" });
      stateUpdates.push({ coin, op: "delete" });
      continue;
    }

    // 同向：① size 跟随（planFollow，[0,S0] 区间跟目标减/平/回补）
    const follow = planFollow({ openSize: P.openSize, openTargetSzi: P.openTargetSzi, targetSzi: m.szi, szDecimals: meta.szDecimals });
    const desiredSize = follow.desiredSize;
    const sizeDecision = decideLeg({ coin, size: desiredSize }, { size: P.curSize }, caps, prices);
    let curSizeAfter = P.curSize;
    if (sizeDecision === "place") {
      const deltaSize = sub(desiredSize, P.curSize);
      const reduceOnly = lt(absStr(desiredSize), absStr(P.curSize));
      actions.push({ coin, decision: "place", isBuy: signOf(deltaSize) > 0, reduceOnly, desiredSize, currentSize: P.curSize, size: absStr(deltaSize), refPx, szDecimals: meta.szDecimals, followRatio: follow.followRatio, reason: "follow" });
      curSizeAfter = desiredSize;
      stateUpdates.push({ coin, op: "setCurSize", payload: { curSize: desiredSize } });
    }

    // ② 防守（planDefend，与 size 正交，只补保证金 size 不变）
    const defendSize = curSizeAfter;
    if (gt(absStr(defendSize), "0")) {
      const myLiqPx = liqOf({ coin, entryPx: m.entryPx, margin: P.margin, size: defendSize, side, mm });
      const d = planDefend({ entryPx: m.entryPx, size: defendSize, side, myLiqPx, targetLp: m.lp, currentMargin: P.margin, maxCoinCapital, mm });
      if (gt(d.wouldAddMargin, "0")) {
        actions.push({ coin, decision: "would-defend", wouldAddMargin: d.wouldAddMargin, ntli: Math.round(Number(d.wouldAddMargin) * 1e6), isBuy: side === "long", liqBefore: String(myLiqPx), liqAfter: d.newLiqPx, exhausted: d.exhausted, targetLp: m.lp, myLiqPx: String(myLiqPx), mm, assetIndex: meta.index, size: defendSize, reason: "defend" });
        stateUpdates.push({ coin, op: "addMargin", payload: { addMargin: d.wouldAddMargin } });
        if (d.exhausted) alerts.push({ type: "defend-exhausted", coin, maxCoinCapital, newLiqPx: d.newLiqPx, targetLp: m.lp });
      }
    }
  }

  return { actions, stateUpdates, alerts };
}
