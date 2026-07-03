// 资金分配 v3（每币独立预算 + 生存杠杆 + 逐仓保证金防守）。纯函数、无副作用。
// 完全替换 sizing.mjs 的 ratio 模型；公式 SSOT 见 07-budget-alloc.md §3.3 / docs/copy/allocation.md §五。
// 精度全程走 precision.mjs（ROUND_DOWN/ROUND_UP，禁裸 parseFloat 算术/比较）。
import { add, sub, mul, div, gt, gte, lt, lte, signOf, absStr, toNumber, formatSize, ceilTo } from "./precision.mjs";
import { MIN_ORDER_NOTIONAL_USD } from "./sizing.mjs";

// 仓位方向：净张符号 <0 = short（做空，价涨亏），否则 long。
export function sideOf(szi) {
  return signOf(String(szi ?? "0")) < 0 ? "short" : "long";
}

// computeMyLiqPrice：MM-aware 真实强平价（与实盘 clearinghouseState.liquidationPx 同口径）。
// short：(margin + |size|×entry) / (|size|×(1+mm))
// long ：(|size|×entry − margin) / (|size|×(1−mm))
// 强平在「保证金 + 持仓盈亏 = 维持保证金(名义×mm)」时触发，解 liqPx 即上式。
export function computeMyLiqPrice({ entryPx, margin, size, side, mm }) {
  const sz = absStr(size ?? "0");
  if (!gt(sz, "0")) return "0";
  const mmStr = String(mm);
  const notionalAtEntry = mul(sz, String(entryPx));
  if (side === "short") {
    return div(add(String(margin), notionalAtEntry), mul(sz, add("1", mmStr)));
  }
  return div(sub(notionalAtEntry, String(margin)), mul(sz, sub("1", mmStr)));
}

// selectLeverage：floor(L*) 生存杠杆（整数），使我方强平价开仓即 ≥ 目标 lp。
// L*(short)=entry/(targetLp×(1+mm)−entry)；L*(long)=entry/(entry−targetLp×(1−mm))。
// 返回 {leverage, defendableToTargetLp}：
//   leverage=null → 开仓价已越目标 lp 侧（L*≤0），不开（skip-no-open）
//   targetLp="0" → 目标无强平风险，取 clamp(目标杠杆)，不防守
//   defendableToTargetLp=false → floor(L*)<1（目标 lp 太远），1x 仍可能早于目标
export function selectLeverage({ entryPx, targetLp, mm, maxLeverage, side, targetLeverage }) {
  const maxLev = Math.max(1, Math.trunc(Number(maxLeverage) || 1));
  // lp=0：无强平风险，不按 lp 反推 → 取目标杠杆 clamp（仅跟开/平，不防守）
  if (!gt(String(targetLp ?? "0"), "0")) {
    const lev = Math.max(1, Math.min(maxLev, Math.trunc(Number(targetLeverage) || maxLev)));
    return { leverage: lev, defendableToTargetLp: true };
  }
  const mmStr = String(mm);
  const denom = side === "short"
    ? sub(mul(String(targetLp), add("1", mmStr)), String(entryPx)) // targetLp×(1+mm)−entry
    : sub(String(entryPx), mul(String(targetLp), sub("1", mmStr))); // entry−targetLp×(1−mm)
  // L*≤0：开仓价已越目标 lp 侧（目标已近强平）→ 不开
  if (!gt(denom, "0")) return { leverage: null, defendableToTargetLp: false };
  const lStar = toNumber(div(String(entryPx), denom));
  const flooredLStar = Math.floor(lStar);
  const leverage = Math.max(1, Math.min(maxLev, flooredLStar));
  // floor(L*)≥1 → 选定杠杆 ≤ L* → 强平价 ≥ 目标 lp；floor=0 → 1x 仍够不着
  return { leverage, defendableToTargetLp: flooredLStar >= 1 };
}

// planOpen：定开仓 size + M0。size = signOf(targetSzi) × ROUND_DOWN(M0×杠杆/价, szDecimals)。
// 名义 < 最小名义($10) 或 size 截断到 0 → skip-mindust。
export function planOpen({ minOpenCapital, openLeverage, entryPx, targetSzi, szDecimals }) {
  const M0 = String(minOpenCapital);
  const magnitude = formatSize(div(mul(M0, String(openLeverage)), String(entryPx)), szDecimals); // ROUND_DOWN
  const size = signOf(String(targetSzi)) < 0 ? mul(magnitude, "-1") : magnitude;
  const notional = mul(absStr(size), String(entryPx));
  if (!gt(absStr(size), "0") || lt(notional, String(MIN_ORDER_NOTIONAL_USD))) {
    return { size: null, M0, notional, skip: "skip-mindust" };
  }
  return { size, M0, notional };
}

// planDefend：维持「我方真实强平价越过目标 lp」，缺口补保证金（size 不变），封顶 maxCoinCapital。
// needMargin = |size| × |targetLp×(1±mm) − entry|（short:+mm / long:−mm），ROUND_UP 保证补足。
export function planDefend({ entryPx, size, side, myLiqPx, targetLp, currentMargin, maxCoinCapital, mm }) {
  const cur = String(currentMargin ?? "0");
  // lp=0（无强平风险）或我方强平价已越过目标 → 无需补
  if (!gt(String(targetLp ?? "0"), "0")) return { wouldAddMargin: "0", newLiqPx: String(myLiqPx ?? "0"), exhausted: false };
  const crossed = side === "short" ? gte(String(myLiqPx), String(targetLp)) : lte(String(myLiqPx), String(targetLp));
  if (crossed) return { wouldAddMargin: "0", newLiqPx: String(myLiqPx), exhausted: false };

  const sz = absStr(size ?? "0");
  const factor = side === "short" ? add("1", String(mm)) : sub("1", String(mm));
  const perUnit = absStr(sub(mul(String(targetLp), factor), String(entryPx)));
  const needMargin = ceilTo(mul(sz, perUnit), 6); // ROUND_UP 到 micro-USD
  const gap = sub(needMargin, cur);
  const headroom = sub(String(maxCoinCapital), cur);
  const wouldAddMargin = lte(gap, "0") ? "0" : (lte(gap, headroom) ? gap : (gt(headroom, "0") ? headroom : "0"));
  const newMargin = add(cur, wouldAddMargin);
  const newLiqPx = computeMyLiqPrice({ entryPx, margin: newMargin, size, side, mm });
  const exhausted = lt(newMargin, needMargin); // 补到上限仍追不上目标 lp
  return { wouldAddMargin, newLiqPx, exhausted };
}
