// ④ 打分 Score：5 维归一×权重求和，降序取 topK（topK 是上限，不凑数）。

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

// 各维归一到 [0,1]
function normalize(profile, persistWindowsLen) {
  const pf = profile.profitFactor;
  const rf = profile.recoveryFactor;
  const dims = {
    profitFactor: Number.isFinite(pf) ? clamp((pf - 1) / 2, 0, 1) : 1, // pf≥3 满分；Infinity 满分
    recoveryFactor: Number.isFinite(rf) ? clamp(rf / 3, 0, 1) : 1, // RF≥3(净盈利=3倍最大回撤) 满分；无回撤满分
    winRate: clamp(profile.winRate, 0, 1),
    persist: persistWindowsLen > 0 ? clamp(profile.hitWindows.size / persistWindowsLen, 0, 1) : 0,
    volume: profile.volume > 0 ? clamp((Math.log10(profile.volume) - 4.7) / 2, 0, 1) : 0, // 5万→0、500万→~0.86
  };
  return dims;
}

/**
 * 打分排序。
 * @param {Array} profiles - evaluate 产出的合格画像
 * @param {object} config - effectiveConfig（用 weights / persistWindows / topK）
 * @returns {Array} ranked - 降序，每项附 score + dims；长度 ≤ topK（合格者不足则更少）
 */
export function score(profiles, config) {
  const weights = config.weights;
  const persistWindowsLen = (config.persistWindows ?? config.sampling.windows).length;

  const scored = profiles.map((p) => {
    const dims = normalize(p, persistWindowsLen);
    const total =
      dims.profitFactor * weights.profitFactor +
      dims.recoveryFactor * weights.recoveryFactor +
      dims.winRate * weights.winRate +
      dims.persist * weights.persist +
      dims.volume * weights.volume;
    return { ...p, dims, score: Math.round(total * 10) / 10 };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, config.topK); // 上限截断，不放宽、不凑数
}

export const __internals = { normalize };
