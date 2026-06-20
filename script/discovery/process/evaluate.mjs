// ③ 评估 Evaluate：positions(limit=200) 是「逐笔真账本」，交易形态 + 时效全部基于它（权威已实现）。
// 为什么不用 overview 的短窗字段：overview 窗口额基于账户净值快照(deposit-accounting)，混入转入/提现，
// 与本系统开篇要消灭的「榜单 pnl 误导」同源——短窗噪声大（实测 192916 overview7D=−39805 实为提现误记，
// 真账本近期两笔全盈利）。positions.realized_pnl 才是逐笔权威；limit=200 只截断旧记录，近窗完整可靠。
import { fetchPositions } from "../api/index.mjs";

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

// 从全捕获平仓记录算交易质量形态 + 近 7 天逐笔实现（时效）
function derivePositionMetrics(positions, now) {
  const closed = (Array.isArray(positions) ? positions : []).filter((p) => Number(p.size) === 0);

  const nTrades = closed.length;
  let wins = 0;
  let sumProfit = 0;
  let sumLossAbs = 0;
  let sumHoldMin = 0;
  let maxWin = 0; // 最大单笔盈利
  let maxLoss = 0; // 最大单笔亏损（绝对值，正数）
  for (const p of closed) {
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
  const ordered = [...closed].sort((a, b) => Number(a.updated_at ?? 0) - Number(b.updated_at ?? 0));
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
  const byDay = dailyNetMap(closed);
  const dayNets = Array.from(byDay.values());
  const sumPositiveDays = dayNets.filter((x) => x > 0).reduce((s, x) => s + x, 0);
  const maxDay = dayNets.length ? Math.max(...dayNets) : 0;
  const maxDayShare = sumPositiveDays > 0 ? maxDay / sumPositiveDays : 1;

  // 时效：近 7 天逐笔实现额（权威已实现，非快照口径）
  const freshStart = now - FRESHNESS_DAYS * MS_PER_DAY;
  const freshNet = closed
    .filter((p) => Number(p.updated_at ?? 0) >= freshStart)
    .reduce((s, p) => s + Number(p.realized_pnl ?? 0), 0);

  return { nTrades, winRate, profitFactor, avgHoldMin, netProfit, maxDD, recoveryFactor, activeSpanDays, maxDayShare, freshNet, maxWin, maxLoss, blowupRatio };
}

// 交易资格双通道（D3）：中频路（nTrades≥minTrades）或 低频精准路（nTrades≥8 且 PF≥3 且 win≥70%）
function classifyTradeEligibility(nTrades, profitFactor, winRate, config) {
  const midFreq = nTrades >= config.gates.minTrades;
  const lowFreq =
    nTrades >= config.lowFreq.minTrades &&
    profitFactor >= config.lowFreq.minPF &&
    winRate >= config.lowFreq.minWin;
  return { eligible: midFreq || lowFreq, lowFreqPrecision: !midFreq && lowFreq };
}

/**
 * 深度画像 + 硬门槛。交易形态用 positions 全捕获平仓记录，时效用 overview 7D 权威窗口额。
 * @param {Array} survivors - filter 产出的幸存者（含 overview）
 * @param {object} config - effectiveConfig
 * @returns {Promise<{profiles:Array, eliminated:Array<{accountId:string,stage:string,reason:string}>}>}
 */
export async function evaluate(survivors, config) {
  const profiles = [];
  const eliminated = [];
  const now = Date.now();

  const results = await Promise.all(
    survivors.map(async (s) => {
      try {
        const positions = await fetchPositions(s.accountId, config.positionsLimit);
        return { s, positions, error: null };
      } catch (err) {
        return { s, positions: null, error: err };
      }
    }),
  );

  for (const { s, positions, error } of results) {
    if (error) {
      // 单候选画像失败 → 跳过，不污染池
      eliminated.push({ accountId: s.accountId, stage: "evaluate", reason: `画像拉取失败: ${error.message}` });
      continue;
    }

    const pm = derivePositionMetrics(positions, now);
    const perpsPnl = Number(s.overview.perps_closed_pnl_usd ?? 0);
    const volume = Number(s.overview.volume_usd ?? 0);

    const profile = {
      accountId: s.accountId,
      walletAddress: s.walletAddress,
      hitWindows: s.hitWindows,
      rank: s.rank,
      overview: s.overview,
      perpsPnl,
      volume,
      activeDays: Math.round(pm.activeSpanDays),
      maxDayShare: pm.maxDayShare,
      maxDD: pm.maxDD,
      netProfit: pm.netProfit,
      recoveryFactor: pm.recoveryFactor,
      maxWin: pm.maxWin,
      maxLoss: pm.maxLoss,
      blowupRatio: pm.blowupRatio,
      freshNet: pm.freshNet,
      nTrades: pm.nTrades,
      winRate: pm.winRate,
      profitFactor: pm.profitFactor,
      avgHoldMin: pm.avgHoldMin,
    };

    const fail = (reason) => eliminated.push({ accountId: s.accountId, stage: "evaluate", reason });

    // 基础门槛：活跃跨度（首末交易间隔，衡量持续记录，不惩罚低频）
    if (!(pm.activeSpanDays >= config.gates.minActiveDays)) {
      fail(`活跃跨度不足 ${pm.activeSpanDays.toFixed(0)}天 < ${config.gates.minActiveDays}`);
      continue;
    }
    // D3 交易资格双通道
    const { eligible, lowFreqPrecision } = classifyTradeEligibility(pm.nTrades, pm.profitFactor, pm.winRate, config);
    if (!eligible) {
      fail(`交易资格双通道未过 nTrades=${pm.nTrades} PF=${pm.profitFactor === Infinity ? "∞" : pm.profitFactor.toFixed(2)} win=${(pm.winRate * 100).toFixed(0)}%`);
      continue;
    }
    profile.lowFreqPrecision = lowFreqPrecision;
    // preset 门槛
    if (!(pm.profitFactor >= config.minProfitFactor)) {
      fail(`盈亏比不足 ${pm.profitFactor === Infinity ? "∞" : pm.profitFactor.toFixed(2)} < ${config.minProfitFactor}`);
      continue;
    }
    // Recovery Factor 替代 ddRatio：净盈利须 ≥ minRecoveryFactor 倍最大回撤
    if (!(pm.recoveryFactor >= config.minRecoveryFactor)) {
      fail(`回撤恢复比不足 RF=${Number.isFinite(pm.recoveryFactor) ? pm.recoveryFactor.toFixed(2) : "∞"} < ${config.minRecoveryFactor}`);
      continue;
    }
    if (!(pm.maxDayShare <= config.maxDayShare)) {
      fail(`单日集中度超标 ${(pm.maxDayShare * 100).toFixed(0)}% > ${(config.maxDayShare * 100).toFixed(0)}%`);
      continue;
    }
    // qualityFilters（默认开）
    if (config.qualityFilters) {
      const netDeposit = Number(s.overview.net_deposit_usd ?? 0);
      // antiAirdrop：净入金为负且合约几乎不赚 → 空投/转入提走
      if (netDeposit < 0 && Math.abs(perpsPnl) < config.gates.minPerpsPnl) {
        fail(`疑似空投农民 netDeposit=${netDeposit.toFixed(0)} perpsClosed≈0`);
        continue;
      }
      // freshness：近 7 天逐笔实现 < 0（正在亏）才淘汰；休眠(=0)放行（不误杀近期没出手的高手）
      if (pm.freshNet < 0) {
        fail(`时效不过 近7天逐笔实现=${pm.freshNet.toFixed(0)} < 0（正在回撤）`);
        continue;
      }
    }

    profiles.push(profile);
  }

  return { profiles, eliminated };
}

export const __internals = { derivePositionMetrics, classifyTradeEligibility, dailyNetMap };
