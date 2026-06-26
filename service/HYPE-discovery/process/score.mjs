// ④ 打分 Score：3 维归一×权重求和，降序取 topK（topK 是上限，不凑数）。
// 维度复用 sodex 已验证的核心质量轴（PF/RF/胜率）；下注规模（medNotional/marginUsed）走 output 展示，
// 不进 score——HYPE 名义规模锚点尚未校准，避免拍脑袋（待后续拉分布校准再纳入，见 hype.md §六）。

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

const DEFAULT_WEIGHTS = { profitFactor: 30, recoveryFactor: 20, winRate: 20, netProfit: 30 }; // 和=100

function normalize(profile) {
  const pf = profile.profitFactor;
  const rf = profile.recoveryFactor;
  // 规模口径优先用真实 PnL（Σ(closedPnl−fee)+funding）；无 truePnl 时回退 netProfit
  const pnlScale = profile.truePnl ?? profile.netProfit;
  return {
    profitFactor: Number.isFinite(pf) ? clamp((pf - 1) / 2, 0, 1) : 1, // PF≥3 满分；∞ 满分
    recoveryFactor: Number.isFinite(rf) ? clamp(rf / 3, 0, 1) : 1,     // RF≥3 满分；无回撤满分
    winRate: clamp(profile.winRate, 0, 1),
    // 净额规模：对数归一，$1万→0 / $100万→1。区分一堆 PF∞/满分账号（瑕疵4），让真大户排前
    netProfit: pnlScale > 0 ? clamp((Math.log10(pnlScale) - 4) / 2, 0, 1) : 0,
  };
}

/**
 * 打分排序，降序取 topK。
 * @param {Array} profiles - evaluate 产出的合格画像
 * @param {object} config - effectiveConfig（用 weights / topK）
 * @returns {{ranked:Array, truncated:number}} - 与原 rankTopK 返回形态一致，便于 main 兼容
 */
export function score(profiles, config) {
  const weights = config.weights ?? DEFAULT_WEIGHTS;
  const topK = config.topK ?? 20;

  const scored = profiles.map((p) => {
    const dims = normalize(p);
    const raw =
      dims.profitFactor * weights.profitFactor +
      dims.recoveryFactor * weights.recoveryFactor +
      dims.winRate * weights.winRate +
      dims.netProfit * (weights.netProfit ?? 0);
    // capped（userFills 2000 上限、仅近期画像）降权 10%：PF∞/高胜率是近期乐观估计，全史未覆盖（瑕疵1）
    const total = raw * (p.capped ? 0.9 : 1);
    return { ...p, dims, score: Math.round(total * 10) / 10 };
  });

  scored.sort((a, b) => b.score - a.score);
  return { ranked: scored.slice(0, topK), truncated: Math.max(0, scored.length - topK) };
}

export const __internals = { normalize };
