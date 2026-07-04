// 校验门：decideLeg 四分支（unmappable → mindust → noop → place）。
// v3 预算模型（spec 07/09）删 skip-maxpos/skip-capped——单仓上限由 maxCoinCapital 定额封顶、
// 部署上限由 maxPositions 槽位替代，不再在此做名义百分比校验。would-defend/skip-no-open 由
// orchestrator（planBudgetReconcile）直接产出，不过 decideLeg。总纲 §2.2 顺序铁律：先命中先返回。
import { sub, mul, div, gt, lt, absStr, signOf } from "./precision.mjs";

// caps（v3）：minDeltaPct / minNotional / minOrderSize。desiredLeg：{ coin, size }（带符号目标净仓）；
// current：我方当前同币仓 {size} 或 null（新开=null）。
export function decideLeg(desiredLeg, current, caps, prices) {
  // 1) unmappable：无有效 coin（01/02 已过滤不可映射；此处保险拦截，总纲 §2.2）
  if (!desiredLeg || !desiredLeg.coin) return "skip-unmappable";

  const price = prices?.[desiredLeg.coin];
  // 缺价无法定价名义 → 防御性按 mindust 跳过（reconcile 通常已在上游剔除缺价仓）
  if (price === undefined || price === null || price === "" || !gt(price, "0")) return "skip-mindust";

  const desiredSize = String(desiredLeg.size ?? "0");
  const currentSize = String(current?.size ?? "0");
  const deltaSize = sub(desiredSize, currentSize);
  const absDelta = absStr(deltaSize);
  const orderNotional = mul(absDelta, price); // 本笔变动名义

  // 2) mindust：本笔名义 < 交易所最小名义
  if (lt(orderNotional, String(caps.minNotional))) return "skip-mindust";

  // 3) noop：|delta| < 最小下单量，或 |delta|/|desired| < minDeltaPct（防碎步追单）
  if (lt(absDelta, String(caps.minOrderSize))) return "noop";
  if (gt(absStr(desiredSize), "0") && lt(div(absDelta, absStr(desiredSize)), String(caps.minDeltaPct))) return "noop";

  // 4) place
  return "place";
}

// delta 方向 → 下单 side / reduceOnly（减仓量级缩小=reduceOnly）。供 reconcile 组装 leg。
export function legSideOf(deltaSize, desiredSize, currentSize) {
  const isBuy = signOf(deltaSize) > 0;
  const reduceOnly = gt(absStr(String(currentSize ?? "0")), absStr(String(desiredSize ?? "0")));
  return { isBuy, reduceOnly };
}
