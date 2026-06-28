// 最低本金算法：反解「让每仓我方名义都 ≥ 最小名义($10)」所需最低本金 + 可跟/跳过清单。
// 纯函数；精度走 precision.mjs（ROUND_DOWN，禁裸 parseFloat）。总纲 §3.2/§3.3、子件 02。
import { mul, div, add, gte, gt, maxStr, absStr, toNumber } from "./precision.mjs";
import { MIN_ORDER_NOTIONAL_USD } from "./sizing.mjs";

// recommendMinCapital(可映射仓[], prices, initialDeployPct, currentRatio?) → {minCapital, ratioMin, perLeg}
// 总纲 §3.2 核心签名为前三参；子件 02 要求 canFollow 用「当前实际 ratio」评估——由调用方
// 传 currentRatio（第 4 参，附加输入，不破坏三参核心契约）；未传则 canFollow 标 reason="no-ratio"。
// ratioMin = max(MIN/目标名义[coin])；minCapital = ratioMin × Σ可映射保证金 / initialDeployPct。
export function recommendMinCapital(positions, prices, initialDeployPct, currentRatio) {
  if (!Array.isArray(positions) || positions.length === 0) {
    return { minCapital: 0, ratioMin: 0, perLeg: [] };
  }

  // Σ 可映射仓 marginUsed（与 computeRatio 分母同源）
  let targetMappableMargin = "0";
  for (const pos of positions) targetMappableMargin = add(targetMappableMargin, pos.marginUsed);

  const legRatioMinsPriced = [];
  const perLeg = positions.map((pos) => {
    const px = prices?.[pos.coin];
    if (px === undefined || px === null || px === "" || !gt(px, "0")) {
      return { coin: pos.coin, targetNotional: null, legRatioMin: null, canFollow: false, reason: "no-price" };
    }
    const targetNotional = mul(absStr(pos.szi), String(px));
    const legRatioMin = div(String(MIN_ORDER_NOTIONAL_USD), targetNotional);
    legRatioMinsPriced.push(legRatioMin);

    let canFollow = false;
    let reason;
    if (currentRatio === undefined || currentRatio === null) {
      reason = "no-ratio";
    } else if (gte(mul(targetNotional, String(currentRatio)), String(MIN_ORDER_NOTIONAL_USD))) {
      canFollow = true;
      reason = "ok";
    } else {
      reason = "below-min-notional";
    }
    return {
      coin: pos.coin,
      targetNotional: toNumber(targetNotional),
      legRatioMin: toNumber(legRatioMin),
      canFollow,
      reason,
    };
  });

  // 缺价仓无法计 legRatioMin，排除出 ratioMin（max）取值
  const ratioMinStr = legRatioMinsPriced.length ? maxStr(legRatioMinsPriced) : "0";
  const minCapitalStr = gt(initialDeployPct, "0")
    ? div(mul(ratioMinStr, targetMappableMargin), String(initialDeployPct))
    : "0";

  return { minCapital: toNumber(minCapitalStr), ratioMin: toNumber(ratioMinStr), perLeg };
}
