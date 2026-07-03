// 下单精度 + 金额精度运算（ROUND_DOWN 自实现，依赖 decimal.js）。
// 总纲 §3.3/§3.4：禁裸 parseFloat 做算术/比较，禁用 tool/format 做精度（其仅展示）。
// blueprint §8.3：px/sz 是字符串，SDK 不做 tick/lot 舍入，调用方自舍入——
//   formatPrice = 5 位有效数字 + perps 小数上限(6-szDecimals)，ROUND_DOWN；
//   formatSize  = szDecimals 位，ROUND_DOWN（向零截断，防超额）。
import Decimal from "decimal.js";

// HL 价格规则常量（blueprint §8.3）：有效数字上限 + perps 名义小数上限。
const MAX_PRICE_SIG_FIGS = 5;
const PERP_MAX_PRICE_DECIMALS = 6; // 实际小数上限 = PERP_MAX_PRICE_DECIMALS - szDecimals

const D = (v) => new Decimal(v);

// ---------- 精度算术（全程 Decimal，返回字符串保精度；比较返回 boolean）----------
export const add = (a, b) => D(a).plus(b).toString();
export const sub = (a, b) => D(a).minus(b).toString();
export const mul = (a, b) => D(a).times(b).toString();
export const div = (a, b) => D(a).dividedBy(b).toString();

export const gt = (a, b) => D(a).greaterThan(b);
export const gte = (a, b) => D(a).greaterThanOrEqualTo(b);
export const lt = (a, b) => D(a).lessThan(b);
export const lte = (a, b) => D(a).lessThanOrEqualTo(b);
export const eq = (a, b) => D(a).equals(b);

export const absStr = (a) => D(a).abs().toString();
export const signOf = (a) => D(a).comparedTo(0); // +1 / -1 / 0
export const toNumber = (a) => D(a).toNumber();

// 取数组（字符串/数字）最大值，返回字符串；空数组返回 "0"。禁用 Math.max(...parseFloat)。
export function maxStr(values) {
  if (!Array.isArray(values) || values.length === 0) return "0";
  let max = D(values[0]);
  for (let i = 1; i < values.length; i++) {
    const cur = D(values[i]);
    if (cur.greaterThan(max)) max = cur;
  }
  return max.toString();
}

// ---------- 下单精度（ROUND_DOWN）----------

// size 舍入：szDecimals 位，向零截断（ROUND_DOWN，防超额跟单）。返回无尾零字符串。
export function formatSize(value, szDecimals) {
  const dec = Number.isFinite(Number(szDecimals)) ? Number(szDecimals) : 0;
  return D(value).toDecimalPlaces(dec, Decimal.ROUND_DOWN).toString();
}

// 金额向上取整：needMargin 等"补足"场景必须 ROUND_UP，向下会差一点补不到目标 lp。默认 6 位（micro-USD，对齐 ntli×1e6）。
export function ceilTo(value, decimals = 6) {
  const dec = Number.isFinite(Number(decimals)) ? Number(decimals) : 6;
  return D(value).toDecimalPlaces(dec, Decimal.ROUND_UP).toString();
}

// price 舍入：先限 5 位有效数字，再限 perps 小数上限(6-szDecimals)，取更严者；ROUND_DOWN。
export function formatPrice(value, szDecimals = 0) {
  const dec = Number.isFinite(Number(szDecimals)) ? Number(szDecimals) : 0;
  const maxDecimals = Math.max(0, PERP_MAX_PRICE_DECIMALS - dec);
  return D(value)
    .toSignificantDigits(MAX_PRICE_SIG_FIGS, Decimal.ROUND_DOWN)
    .toDecimalPlaces(maxDecimals, Decimal.ROUND_DOWN)
    .toString();
}

// IOC 滑点保护价：买 ref×(1+bps/1e4)、卖 ref×(1-bps/1e4)，再走 formatPrice（blueprint §10.5）。
export function applySlippage(refPx, slippageBps, isBuy, szDecimals = 0) {
  const factor = D(slippageBps).dividedBy(10_000);
  const adjusted = isBuy ? D(refPx).times(D(1).plus(factor)) : D(refPx).times(D(1).minus(factor));
  return formatPrice(adjusted, szDecimals);
}
