// ③ 评估 Evaluate：positions(limit=1000) 是「逐笔真账本」，交易形态 + 时效 + 合约盈利全部基于它（权威已实现）。
// 为什么不用 overview 的短窗字段：overview 窗口额基于账户净值快照(deposit-accounting)，混入转入/提现，
// 与本系统开篇要消灭的「榜单 pnl 误导」同源——短窗噪声大（实测 192916 overview7D=−39805 实为提现误记，
// 真账本近期两笔全盈利）。positions.realized_pnl 才是逐笔权威；limit=1000 覆盖全历史（实测最多 445 条/账户）。
import { fetchPositions } from "../api/index.mjs";
import { deriveMetricsFromClosed } from "./metrics.mjs";

// 从全捕获平仓记录算交易质量形态：先过滤已平仓位（size=0），再走共享内核 deriveMetricsFromClosed。
function derivePositionMetrics(positions, now) {
  const closed = (Array.isArray(positions) ? positions : []).filter((p) => Number(p.size) === 0);
  return deriveMetricsFromClosed(closed, now);
}

// 交易资格双通道（D3）：中频路（nTrades≥minTrades）或 低频精准路（nTrades≥8 且 PF≥3 且 win≥70%）
// nTrades=已平仓位数（非成交频率）。滚仓型（持仓不平、仓位数少但成交频繁）可能因 nTrades<8 被误杀——
// 已知盲区，彻底解需 trades 逐笔回放，因未观测到样本暂不实现，见 docs/api-confidence/sodex.md §六
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
    // 合约盈利取逐笔真账本净额（权威），不用 overview.perps_closed_pnl_usd（充提污染）
    const perpsPnl = pm.netProfit;
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
      medMargin: pm.medMargin,
      maxMargin: pm.maxMargin,
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
      // antiAirdrop：净入金为负且合约几乎不赚（逐笔真账本净额）→ 空投/转入提走
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

export const __internals = { derivePositionMetrics, classifyTradeEligibility };
