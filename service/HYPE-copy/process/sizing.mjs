// 资金模型：computeRatio（锚定 ratio）+ computeDesired（保证金等比 → 名义 → size 折算）。
// 纯函数、无副作用：prices/avail 显式入参，不拉数据、不读 session。总纲 §3.2/§3.3。
// 精度全程走 precision.mjs（ROUND_DOWN，禁裸 parseFloat 算术/比较）。
import { mul, div, gt, signOf, toNumber } from "./precision.mjs";

// 交易所最小名义（总纲 §3.3）；本常量规范归属本阶段，03 校验门 / 04 经 caps 复用。
export const MIN_ORDER_NOTIONAL_USD = 10;

// @deprecated 由 v3 预算模型（process/allocation.mjs）替换（07-budget-alloc §0）。保留防 import 历史断裂，新代码勿用。
// computeRatio(avail, deployPct, targetMappableMargin) → number
// ratio = (avail × deployPct) / targetMappableMargin；分母 ≤0 → 0（无可映射仓，等价 idle）。
export function computeRatio(avail, deployPct, targetMappableMargin) {
  if (!gt(targetMappableMargin, "0")) return 0;
  return toNumber(div(mul(avail, deployPct), targetMappableMargin));
}

// @deprecated 由 v3 预算模型（process/allocation.mjs planOpen）替换（07-budget-alloc §0）。保留防 import 历史断裂，新代码勿用。
// computeDesired(可映射仓[], ratio, prices) → {coin, size}[]（size 带符号张数，沿用 szi 方向）。
// 每仓：desiredMargin=marginUsed×ratio → desiredNotional=×leverage → size=/price。
// 缺价该仓标记跳过（reason="no-price"），不抛错、不中断整批；不做 mindust/触顶（那是 03）。
export function computeDesired(positions, ratio, prices) {
  if (!Array.isArray(positions)) return [];
  const ratioStr = String(ratio);
  return positions.map((pos) => {
    const px = prices?.[pos.coin];
    if (px === undefined || px === null || px === "" || !gt(px, "0")) {
      return { coin: pos.coin, size: null, skipped: true, reason: "no-price" };
    }
    const desiredMargin = mul(pos.marginUsed, ratioStr);
    const desiredNotional = mul(desiredMargin, String(pos.leverage));
    const magnitude = div(desiredNotional, String(px));
    const size = signOf(pos.szi) < 0 ? mul(magnitude, "-1") : magnitude;
    return { coin: pos.coin, size };
  });
}
