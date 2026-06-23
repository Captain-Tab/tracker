// ② 筛选 Filter：门槛判定（passesThreshold，流式内联调用）+ 排序取 topK（rankTopK）。纯函数。
// 门槛只用 pnl/vlm（绝对额，口径明确）；roi 受充提污染（未验证），不作筛选依据（见 spec 总纲 §选定方案）。

// 取候选在主窗口的 pnl/vlm；窗口缺失或 NaN → null。
export function windowMetric(candidate, window) {
  const m = candidate.perf?.[window];
  if (!m || !Number.isFinite(m.pnl) || !Number.isFinite(m.vlm)) return null;
  return m;
}

// 门槛判定（流式 collect 内联调用，只留通过者，避免 39k 候选落地）。
export function passesThreshold(candidate, config) {
  const window = config.window ?? "month";
  const minPnl = config.thresholds?.minPnlUsd?.[window] ?? 0;
  const minVlm = config.thresholds?.minVlmUsd?.[window] ?? 0;
  const m = windowMetric(candidate, window);
  return !!(m && m.pnl >= minPnl && m.vlm >= minVlm);
}

// 门槛阈值取值（供日志展示）。
export function gateOf(config) {
  const window = config.window ?? "month";
  return { window, minPnl: config.thresholds?.minPnlUsd?.[window] ?? 0, minVlm: config.thresholds?.minVlmUsd?.[window] ?? 0 };
}

// 通过门槛者按主窗口 pnl 降序取 topK。
export function rankTopK(survivors, config) {
  const window = config.window ?? "month";
  const topK = config.topK ?? 20;
  const sorted = [...survivors].sort((a, b) => b.perf[window].pnl - a.perf[window].pnl);
  return { ranked: sorted.slice(0, topK), truncated: Math.max(0, sorted.length - topK) };
}
