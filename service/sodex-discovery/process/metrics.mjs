// 共享指标内核：从一组「已平仓位记录」（size=0 已过滤）算交易质量形态 + 近 7 天逐笔实现（时效）。
// evaluate（全币种合并）与 coinSlice（按币种切片）共用，签名是 SSOT——输入口径必须是「已过滤的平仓数组」。
// 盈利/形态全部基于 positions.realized_pnl 逐笔真账本（权威），不读 overview 聚合字段（充提污染）。
const MS_PER_MIN = 60_000;
const MS_PER_DAY = 86_400_000;
const FRESHNESS_DAYS = 7; // 时效窗口：近 7 天逐笔实现 < 0（正在亏）才淘汰；休眠(=0)放行

// 按日历日聚合单日实现盈亏（用于单日集中度 anti-one-shot）
function dailyNetMap(closed) {
  const byDay = new Map();
  for (const p of closed) {
    const day = Math.floor(Number(p.updated_at ?? 0) / MS_PER_DAY);
    byDay.set(day, (byDay.get(day) ?? 0) + Number(p.realized_pnl ?? 0));
  }
  return byDay;
}

/**
 * 从一组已平仓位记录算交易质量指标。
 * @param {Array} closed - 已过滤的平仓记录（size=0）。调用方负责过滤（全币种或按 symbol_id 切片）
 * @param {number} now - 当前时间戳（ms），用于时效窗口
 * @returns {{nTrades:number,winRate:number,profitFactor:number,avgHoldMin:number,netProfit:number,maxDD:number,recoveryFactor:number,activeSpanDays:number,maxDayShare:number,freshNet:number,maxWin:number,maxLoss:number,blowupRatio:number,medMargin:number,maxMargin:number}}
 */
export function deriveMetricsFromClosed(closed, now) {
  const list = Array.isArray(closed) ? closed : [];

  const nTrades = list.length; // 已平仓位数，非成交笔数：一个仓位可由数十笔成交构成（滚仓型尤甚）
  let wins = 0;
  let sumProfit = 0;
  let sumLossAbs = 0;
  let sumHoldMin = 0;
  let maxWin = 0; // 最大单笔盈利
  let maxLoss = 0; // 最大单笔亏损（绝对值，正数）
  for (const p of list) {
    const pnl = Number(p.realized_pnl ?? 0);
    if (pnl > 0) {
      wins += 1;
      sumProfit += pnl;
      if (pnl > maxWin) maxWin = pnl;
    } else if (pnl < 0) {
      const loss = Math.abs(pnl);
      sumLossAbs += loss;
      if (loss > maxLoss) maxLoss = loss;
    }
    const created = Number(p.created_at ?? 0);
    const updated = Number(p.updated_at ?? 0);
    if (updated > created) sumHoldMin += (updated - created) / MS_PER_MIN;
  }
  const winRate = nTrades > 0 ? wins / nTrades : 0;
  // 盈亏比：无亏损且有盈利 → Infinity（评分 clamp 满分，门槛恒过）
  const profitFactor = sumLossAbs > 0 ? sumProfit / sumLossAbs : sumProfit > 0 ? Infinity : 0;
  const avgHoldMin = nTrades > 0 ? sumHoldMin / nTrades : 0;
  const netProfit = sumProfit - sumLossAbs;
  // 爆仓比：最大单笔亏损 / 净盈利。>1 表示一笔巨亏即可吞掉全部净盈利（脆弱，尾部风险大）
  const blowupRatio = netProfit > 0 ? maxLoss / netProfit : Infinity;

  // 最大回撤：按时间升序累计实现曲线的峰值回落（纯实现额，无浮盈噪声）
  const ordered = [...list].sort((a, b) => Number(a.updated_at ?? 0) - Number(b.updated_at ?? 0));
  let cum = 0;
  let peak = 0;
  let maxDD = 0;
  for (const p of ordered) {
    cum += Number(p.realized_pnl ?? 0);
    if (cum > peak) peak = cum;
    const dd = peak - cum;
    if (dd > maxDD) maxDD = dd;
  }
  // Recovery Factor：净盈利 / 最大回撤。maxDD→0(无回撤) 即满分；永不因分母趋零爆炸（替代 D2 同病的 ddRatio）
  const recoveryFactor = maxDD > 0 ? netProfit / maxDD : netProfit > 0 ? Infinity : 0;

  // 活跃跨度：首末交易间隔天数（衡量"有持续记录"，不惩罚低频；单笔/闪现账户 span=0 被淘汰）
  const ts = ordered.map((p) => Number(p.updated_at ?? 0));
  const activeSpanDays = ts.length >= 2 ? (ts[ts.length - 1] - ts[0]) / MS_PER_DAY : 0;

  // 单日集中度：最大单日实现 / Σ正单日实现（anti-one-shot，一把梭）
  const byDay = dailyNetMap(list);
  const dayNets = Array.from(byDay.values());
  const sumPositiveDays = dayNets.filter((x) => x > 0).reduce((s, x) => s + x, 0);
  const maxDay = dayNets.length ? Math.max(...dayNets) : 0;
  const maxDayShare = sumPositiveDays > 0 ? maxDay / sumPositiveDays : 1;

  // 时效：近 7 天逐笔实现额（权威已实现，非快照口径）
  const freshStart = now - FRESHNESS_DAYS * MS_PER_DAY;
  const freshNet = list
    .filter((p) => Number(p.updated_at ?? 0) >= freshStart)
    .reduce((s, p) => s + Number(p.realized_pnl ?? 0), 0);

  // 保证金投入规模（展示用，非门槛）：平仓历史 initial_margin 已清零(=0)，用 名义÷杠杆 推算；
  // CROSS 模式下为近似占用、非精确保证金。max_size/均价缺失或 leverage=0 兜底为跳过。
  const margins = list
    .map((p) => {
      const noml = Math.abs(Number(p.max_size) * Number(p.avg_entry_price));
      const lev = Math.max(1, Number(p.leverage) || 1);
      return Number.isFinite(noml) ? noml / lev : 0;
    })
    .filter((m) => m > 0)
    .sort((a, b) => a - b);
  const medMargin = margins.length ? margins[Math.floor(margins.length / 2)] : 0;
  const maxMargin = margins.length ? margins[margins.length - 1] : 0;

  return { nTrades, winRate, profitFactor, avgHoldMin, netProfit, maxDD, recoveryFactor, activeSpanDays, maxDayShare, freshNet, maxWin, maxLoss, blowupRatio, medMargin, maxMargin };
}

export const __internals = { dailyNetMap };
