// 单账户按币种切片画像：把平仓真账本按 symbol_id 分组，每组走共享指标内核 deriveMetricsFromClosed，
// 再追加跨币种派生（集中度 pnlShare / 笔数占比 tradeShare）+ 标签（专精档 × 盈亏 × 样本可信度）。
// 集中度口径 = 该币 |净盈亏| 占账户全币种 Σ|净盈亏| 的比例（非笔数占比）。
import { deriveMetricsFromClosed } from "./metrics.mjs";

const SAMPLE_MIN = 8; // 单币种 <8 笔标「样本不足」（统计噪声大），但不淘汰
// 专精档（按 pnlShare）：阈值为描述性分档，可按实测分布校准
const SPECIALIST_TIER = 0.7; // ≥0.7 专精
const MAJOR_TIER = 0.4; // 0.4–0.7 主力；<0.4 涉猎

function concentrationTier(pnlShare) {
  if (pnlShare >= SPECIALIST_TIER) return "专精";
  if (pnlShare >= MAJOR_TIER) return "主力";
  return "涉猎";
}

// 标签：专精档 · 盈利/亏损（+ 样本不足后缀）
function buildLabel(metrics, pnlShare) {
  const tier = concentrationTier(pnlShare);
  const pnl = metrics.netProfit > 0 ? "盈利" : "亏损";
  const suffix = metrics.nTrades < SAMPLE_MIN ? " · 样本不足" : "";
  return `${tier}·${pnl}${suffix}`;
}

/**
 * 单账户按币种切片画像。
 * @param {Array} positions - fetchPositions 原始记录（未过滤）
 * @param {number} now - 当前时间戳 ms
 * @param {Map<number,string>} symbolMap - symbol_id → baseCoin；缺失回退 #<id>
 * @param {{truncated?:boolean}} [opts] - truncated: positions 命中 limit 上限（统计可能截断）
 * @returns {{coins:Array, overall:string, totalClosed:number, truncated:boolean}}
 */
export function sliceByCoin(positions, now, symbolMap, opts = {}) {
  const truncated = Boolean(opts.truncated);
  const closed = (Array.isArray(positions) ? positions : []).filter((p) => Number(p.size) === 0);
  const totalClosed = closed.length;

  // 按 symbol_id 分组
  const bySymbol = new Map();
  for (const p of closed) {
    const sid = Number(p.symbol_id ?? 0);
    if (!bySymbol.has(sid)) bySymbol.set(sid, []);
    bySymbol.get(sid).push(p);
  }

  // 先各币算指标，再求集中度分母 Σ|净盈亏|
  const rawCoins = [];
  for (const [sid, group] of bySymbol) {
    const m = deriveMetricsFromClosed(group, now);
    rawCoins.push({ symbolId: sid, metrics: m });
  }
  const totAbs = rawCoins.reduce((s, c) => s + Math.abs(c.metrics.netProfit), 0);

  const coins = rawCoins.map(({ symbolId, metrics }) => {
    const pnlShare = totAbs > 0 ? Math.abs(metrics.netProfit) / totAbs : 0;
    const tradeShare = totalClosed > 0 ? metrics.nTrades / totalClosed : 0;
    return {
      coin: symbolMap?.get(symbolId) ?? `#${symbolId}`,
      symbolId,
      nTrades: metrics.nTrades,
      winRate: metrics.winRate,
      profitFactor: metrics.profitFactor,
      netProfit: metrics.netProfit,
      recoveryFactor: metrics.recoveryFactor,
      activeSpanDays: metrics.activeSpanDays,
      avgHoldMin: metrics.avgHoldMin,
      maxWin: metrics.maxWin,
      maxLoss: metrics.maxLoss,
      pnlShare,
      tradeShare,
      truncated,
      label: buildLabel(metrics, pnlShare),
    };
  });

  // 按集中度降序（盈亏占比高者在前）
  coins.sort((a, b) => b.pnlShare - a.pnlShare);

  return { coins, overall: buildOverall(coins), totalClosed, truncated };
}

// 整体画像：取 pnlShare 最高且盈利的币种合成一句话；无盈利币种则标无明显盈利主力
function buildOverall(coins) {
  const profitable = coins.filter((c) => c.netProfit > 0);
  if (!profitable.length) return "无明显盈利主力";
  const top = profitable.reduce((a, b) => (b.pnlShare > a.pnlShare ? b : a));
  const pct = Math.round(top.pnlShare * 100);
  const net = Math.round(top.netProfit);
  return `${top.coin} ${concentrationTier(top.pnlShare)}盈利手（占比 ${pct}%，+$${net}）`;
}

export const __internals = { concentrationTier, buildLabel, buildOverall };
