// 单 HYPE 地址按币种切片画像：把 userFills 按 coin 分组，每币算 Σ closedPnl 净利 + 集中度 + 标签。
// 与 sodex coinSlice 对称，但 HYPE 特化：盈利源是逐笔 closedPnl（权威，官方计算），
// 且**不展示 PF/胜率**——实测每币完整仓位周期常仅 1~2 笔（大仓滚仓 + 2000 笔上限截断），trade 级 PF/胜率失真。
// nTrades（完整周期数）复用 aggregateTrades，仅作展示（是否滚仓型）。
import { aggregateTrades } from "./evaluate.mjs";

// 专精档（按集中度 pnlShare）：描述性分档，可校准（与 sodex 对称）
const SPECIALIST_TIER = 0.7;
const MAJOR_TIER = 0.4;
const FILLS_CAP = 2000; // userFills 单次上限；命中即近期窗口画像

function concentrationTier(pnlShare) {
  if (pnlShare >= SPECIALIST_TIER) return "专精";
  if (pnlShare >= MAJOR_TIER) return "主力";
  return "涉猎";
}

// 标签：专精档 · 盈利/亏损（HYPE 不含 PF/胜率/样本不足档）
function buildLabel(netPnl, pnlShare) {
  return `${concentrationTier(pnlShare)}·${netPnl > 0 ? "盈利" : "亏损"}`;
}

function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/**
 * 单地址按币种切片画像。
 * @param {Array} fills - fetchUserFills 原始逐笔（含 coin / closedPnl / fee / sz / px / side / startPosition / time）
 * @returns {{coins:Array, overall:string, totalFills:number, capped:boolean}}
 */
export function sliceByCoin(fills) {
  const list = Array.isArray(fills) ? fills : [];
  const totalFills = list.length;
  const capped = totalFills >= FILLS_CAP;

  // 按 coin 分组
  const byCoin = new Map();
  for (const f of list) {
    const coin = f.coin ?? "?";
    if (!byCoin.has(coin)) byCoin.set(coin, []);
    byCoin.get(coin).push(f);
  }

  // 先各币算净利，再求集中度分母 Σ|netPnl|
  const raw = [];
  for (const [coin, group] of byCoin) {
    const netPnl = group.reduce((s, f) => s + Number(f.closedPnl ?? 0), 0);
    const feeTotal = group.reduce((s, f) => s + Number(f.fee ?? 0), 0);
    const trades = aggregateTrades(group); // 完整仓位周期（窗口内未平周期不计入）
    const medNotional = median(trades.map((t) => t.notional).filter((x) => x > 0));
    raw.push({ coin, netPnl, feeTotal, nFills: group.length, nTrades: trades.length, medNotional });
  }
  const totAbs = raw.reduce((s, c) => s + Math.abs(c.netPnl), 0);

  const coins = raw.map((c) => {
    const pnlShare = totAbs > 0 ? Math.abs(c.netPnl) / totAbs : 0;
    return { ...c, pnlShare, label: buildLabel(c.netPnl, pnlShare) };
  });

  coins.sort((a, b) => b.pnlShare - a.pnlShare);

  return { coins, overall: buildOverall(coins), totalFills, capped };
}

// 整体画像：取 pnlShare 最高且盈利的币种；无盈利币种则标无明显盈利主力
function buildOverall(coins) {
  const profitable = coins.filter((c) => c.netPnl > 0);
  if (!profitable.length) return "无明显盈利主力";
  const top = profitable.reduce((a, b) => (b.pnlShare > a.pnlShare ? b : a));
  return `${top.coin} ${concentrationTier(top.pnlShare)}盈利手（占比 ${Math.round(top.pnlShare * 100)}%，+$${Math.round(top.netPnl)}）`;
}

export const __internals = { concentrationTier, buildLabel, buildOverall, median };
