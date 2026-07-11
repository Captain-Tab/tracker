// ③ 评估 Evaluate：对粗筛幸存者拉 userFills，**按仓位周期聚合 fill 成"交易"**后做深评。
// 为什么必须聚合（关键）：HYPE 一笔交易常拆成数十个 fill 执行（实测 #1 是 10 笔交易拆成 529 个 fill），
// fill 级算 PF/胜率/频率/单笔利润**全部失真**（#1 fill 级 PF=155万/胜率99.8%/19笔每天 → 聚合后真实为
// 10 笔交易/单笔中位$2072/0.36笔每天的低频大单账号）。故所有指标必须在「交易级」算。
// 仓位周期：按 coin 跟踪持仓（startPosition+sz±），持仓归 0 = 一笔交易完成。
// 局限：userFills 2000/次上限 → 活跃账号近期画像（capped 标记，见 docs/api-confidence/hype.md §六）。
import { fetchUserFills, fetchUserFunding } from "../api/index.mjs";

const MS_PER_DAY = 86_400_000;

// 默认门槛（交易级；阈值基于 dry-run 20 样本分布初定，待更大样本校准）
const DEFAULTS = {
  maxTradesPerDay: 20,   // HFT 上限（交易级开平频率）
  minTrades: 5,          // 交易样本下限（低频大单天然样本少，不宜过高）
  minActiveDays: 7,      // 活跃跨度下限：剔"近期高频爆发、样本期过短"（如活跃仅1天的账号）
  minMedNotional: 10000, // 中位交易名义下限：剔极小单（如名义中位 $1858 的漏网小单）
  minMedTradePnl: 100,   // 中位单笔利润下限：剔"名义够但单笔微利"的做市残留（如中位单笔 $17/$79，跟一笔赚几块）
  minProfitFactor: 1.5,  // 沿用 sodex balanced
  minRecoveryFactor: 1.0,
};

function pct(arr, p) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}

// 按 coin 重建仓位周期：持仓从 startPosition 出发，逐 fill 累加方向量，归 0 即一笔交易完成。
// 每笔交易 = { pnl: 周期净额(Σ closedPnl − Σ fee，fee 为正成本), notional: 名义累加, fills: 拆单数, openMs/closeMs }
export function aggregateTrades(fills) {
  const sorted = [...fills].sort((a, b) => Number(a.time) - Number(b.time));
  const open = {}; // coin -> 累计中的周期
  const trades = [];
  for (const f of sorted) {
    const coin = f.coin;
    const sz = Number(f.sz);
    const px = Number(f.px);
    const signed = f.side === "B" ? sz : -sz; // B=buy(+) / A=sell(-)
    const startPos = Number(f.startPosition);
    const endPos = startPos + signed;
    if (!open[coin]) open[coin] = { coin, pnl: 0, notional: 0, fills: 0, openMs: Number(f.time) };
    const cur = open[coin];
    cur.pnl += Number(f.closedPnl ?? 0) - Number(f.fee ?? 0); // 净额：已实现盈亏减手续费（fee 为正成本）
    cur.notional += Math.abs(sz * px);
    cur.fills += 1;
    cur.closeMs = Number(f.time);
    if (Math.abs(endPos) < 1e-9) { trades.push(cur); delete open[coin]; } // 持仓归 0 → 周期结束
  }
  return trades; // 未平仓周期（open 里残留）= 当前活跃仓位，不计入（未结束）
}

// 从交易级序列算画像
function deriveTradeMetrics(fills) {
  const nFills = fills.length;
  const capped = nFills >= 2000;
  const times = fills.map((f) => Number(f.time)).filter(Number.isFinite).sort((a, b) => a - b);
  const spanDays = times.length >= 2 ? (times[times.length - 1] - times[0]) / MS_PER_DAY : 0;

  const trades = aggregateTrades(fills);
  const nTrades = trades.length;
  const tradesPerDay = spanDays > 0 ? nTrades / spanDays : nTrades; // 交易级开平频率（HFT 判据）

  // 按时间排序的交易盈亏 → PF/胜率/回撤
  const ordered = [...trades].sort((a, b) => a.closeMs - b.closeMs);
  let wins = 0, sumProfit = 0, sumLossAbs = 0, maxWin = 0, maxLoss = 0, cum = 0, peak = 0, maxDD = 0;
  for (const t of ordered) {
    if (t.pnl > 0) { wins += 1; sumProfit += t.pnl; if (t.pnl > maxWin) maxWin = t.pnl; }
    else if (t.pnl < 0) { const l = Math.abs(t.pnl); sumLossAbs += l; if (l > maxLoss) maxLoss = l; }
    cum += t.pnl;
    if (cum > peak) peak = cum;
    if (peak - cum > maxDD) maxDD = peak - cum;
  }
  const winRate = nTrades > 0 ? wins / nTrades : 0;
  const profitFactor = sumLossAbs > 0 ? sumProfit / sumLossAbs : (sumProfit > 0 ? Infinity : 0);
  const netProfit = sumProfit - sumLossAbs;
  const recoveryFactor = maxDD > 0 ? netProfit / maxDD : (netProfit > 0 ? Infinity : 0);

  // 下注规模（交易级名义，非 fill 级）+ 中位单笔交易净利
  const notionals = trades.map((t) => t.notional).filter((x) => x > 0);
  const medNotional = pct(notionals, 0.5);
  const maxNotional = notionals.length ? Math.max(...notionals) : 0;
  const tradePnls = trades.map((t) => t.pnl);
  const medTradePnl = pct(tradePnls.filter((x) => x > 0), 0.5); // 中位盈利交易净利

  return {
    nFills, capped, nTrades, tradesPerDay, winRate, profitFactor, netProfit, maxDD, recoveryFactor,
    maxWin, maxLoss, medNotional, maxNotional, medTradePnl, activeDays: Math.round(spanDays),
    trades, // 逐笔交易（含 coin/pnl/closeMs），供 ⑥ observing 取「近期精彩」；output 序列化前剔除
  };
}

/**
 * 深度画像 + 硬门槛。盈亏/频率/单笔全部在「交易级」（聚合 fill 后）算。
 * @param {Array} survivors - 粗筛幸存者（含 address）
 * @param {object} config - effectiveConfig（用 config.evaluate 门槛）
 * @returns {Promise<{profiles:Array, eliminated:Array<{address:string,stage:string,reason:string}>}>}
 */
export async function evaluate(survivors, config) {
  const g = { ...DEFAULTS, ...(config.evaluate ?? {}) };
  const profiles = [];
  const eliminated = [];

  // 拉 userFills + userFunding（funding 用于真实 PnL 修正，不在 closedPnl 内）
  const results = await Promise.all(
    survivors.map(async (s) => {
      try {
        const fills = await fetchUserFills(s.address);
        // funding 与 fills 对齐同一时间窗：startTime 取最早 fill 时间（活跃账号 fills 被 2000 截断时 funding 也只算近期窗口）
        let funding = [];
        if (Array.isArray(fills) && fills.length >= 2) {
          const startTime = Math.min(...fills.map((f) => Number(f.time)).filter(Number.isFinite));
          if (Number.isFinite(startTime)) funding = await fetchUserFunding(s.address, startTime);
        }
        return { s, fills, funding, error: null };
      } catch (err) { return { s, fills: null, funding: null, error: err }; }
    }),
  );

  for (const { s, fills, funding, error } of results) {
    if (error) { eliminated.push({ address: s.address, stage: "evaluate", reason: `画像拉取失败: ${error.message}` }); continue; }
    if (!Array.isArray(fills) || fills.length < 2) { eliminated.push({ address: s.address, stage: "evaluate", reason: "成交记录不足" }); continue; }

    const pm = deriveTradeMetrics(fills);
    const fail = (reason) => eliminated.push({ address: s.address, stage: "evaluate", reason });

    if (pm.nTrades < g.minTrades) { fail(`完整交易样本不足 ${pm.nTrades} < ${g.minTrades}（多为未平仓/单边）`); continue; }
    if (pm.activeDays < g.minActiveDays) { fail(`活跃跨度过短 ${pm.activeDays}天 < ${g.minActiveDays}（样本期不足/近期爆发）`); continue; }
    if (pm.medNotional < g.minMedNotional) { fail(`中位名义过小 $${pm.medNotional.toFixed(0)} < $${g.minMedNotional}（小单，非可跟单规模）`); continue; }
    if (pm.medTradePnl < g.minMedTradePnl) { fail(`中位单笔利润过小 $${pm.medTradePnl.toFixed(0)} < $${g.minMedTradePnl}（微利，做市残留）`); continue; }
    if (pm.tradesPerDay > g.maxTradesPerDay) { fail(`HFT ${pm.tradesPerDay.toFixed(1)} 笔交易/天 > ${g.maxTradesPerDay}`); continue; }
    if (!(pm.profitFactor >= g.minProfitFactor)) { fail(`盈亏比不足 ${pm.profitFactor === Infinity ? "∞" : pm.profitFactor.toFixed(2)} < ${g.minProfitFactor}`); continue; }
    if (!(pm.recoveryFactor >= g.minRecoveryFactor)) { fail(`回撤恢复比不足 ${Number.isFinite(pm.recoveryFactor) ? pm.recoveryFactor.toFixed(2) : "∞"} < ${g.minRecoveryFactor}`); continue; }

    // funding 真实 PnL 修正（账户级，非逐笔）：Σ delta.usdc（正=净收/负=净付）
    const fundingTotal = Array.isArray(funding)
      ? funding.reduce((sum, x) => sum + Number(x?.delta?.usdc ?? 0), 0)
      : 0;
    const truePnl = pm.netProfit + fundingTotal; // 真实已实现 = Σ(closedPnl−fee) + Σ funding

    profiles.push({ ...s, ...pm, fundingTotal, truePnl });
  }

  return { profiles, eliminated };
}

export const __internals = { aggregateTrades, deriveTradeMetrics };
