// 校验门：decideLeg 六分支（unmappable → mindust → maxpos → capped → noop → place）。
// 总纲 §2.2 顺序铁律：先命中先返回，互斥。精度走 precision.mjs（禁裸 parseFloat）。
import { sub, add, mul, div, gt, lt, absStr, signOf } from "./precision.mjs";

// caps（从 02/targets 透传）：
//   maxDeployPct / maxPositionPct / minDeltaPct / minNotional / minOrderSize /
//   currentDeployedNotional / availBalance
// desiredLeg：{ coin, size }（size=带符号目标净仓）；current：我方当前同币仓 {size} 或 null（dry-run 恒 null）。
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

  // 加仓判定：目标净仓绝对值 > 当前绝对值（量级增大）。capped/maxpos 仅拦加仓方向。
  const isIncrease = gt(absStr(desiredSize), absStr(currentSize));

  const orderNotional = mul(absDelta, price); // 本笔变动名义
  const positionNotional = mul(absStr(desiredSize), price); // 目标净仓名义

  // 2) mindust：本笔名义 < 交易所最小名义
  if (lt(orderNotional, String(caps.minNotional))) return "skip-mindust";

  // 3) maxpos：单仓名义 > 余额×maxPositionPct（仅拦加仓部分，防目标高杠杆单仓打爆）
  const maxPosNotional = mul(String(caps.availBalance), String(caps.maxPositionPct));
  if (isIncrease && gt(positionNotional, maxPosNotional)) return "skip-maxpos";

  // 4) capped：部署需求（已部署 + 本仓名义）> 余额×MAX_DEPLOY_PCT → 仅拦加仓，放行减仓/平仓
  const maxDeployNotional = mul(String(caps.availBalance), String(caps.maxDeployPct));
  const wouldDeploy = add(String(caps.currentDeployedNotional ?? "0"), positionNotional);
  if (isIncrease && gt(wouldDeploy, maxDeployNotional)) return "skip-capped";

  // 5) noop：|delta| < 最小下单量，或 |delta|/|desired| < minDeltaPct（防碎步追单，滚仓三层之③）
  if (lt(absDelta, String(caps.minOrderSize))) return "noop";
  if (gt(absStr(desiredSize), "0") && lt(div(absDelta, absStr(desiredSize)), String(caps.minDeltaPct))) return "noop";

  // 6) place
  return "place";
}

// delta 方向 → 下单 side / reduceOnly（减仓量级缩小=reduceOnly）。供 reconcile 组装 leg。
export function legSideOf(deltaSize, desiredSize, currentSize) {
  const isBuy = signOf(deltaSize) > 0;
  const reduceOnly = gt(absStr(String(currentSize ?? "0")), absStr(String(desiredSize ?? "0")));
  return { isBuy, reduceOnly };
}
