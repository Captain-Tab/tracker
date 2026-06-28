// 周期统计聚合（纯函数）：读 JSONL 行数组 → 笔数 / Σfee / 净收益(fee erosion) / 滑点分布。
// 总纲 §3.3 精度铁律：金额累加走 precision.mjs（禁裸 parseFloat/+）。dry-run 口径需标注。
import { add, sub, toNumber } from "./precision.mjs";

// 计入笔数的有效成交动作（result）。noop / skip-* / min-capital / error 不计活跃笔数。
const TRADE_RESULTS = new Set(["place", "ok"]);

// 滑点分布：min / median / max（bps）。median 取排序中位（偶数取两中位均值）。
function slippageDistribution(values) {
  if (values.length === 0) return { min: 0, median: 0, max: 0, count: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const mid = Math.floor(n / 2);
  const median = n % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return { min: sorted[0], median, max: sorted[n - 1], count: n };
}

// aggregateStats(lines[]) → { trades, totalFee, netProfit, slippage, dryRun }
// netProfit 为 fee erosion 估算口径：dry-run 无真实成交收益，净收益估为 -Σfee（纯成本侵蚀），标注 dryRun。
export function aggregateStats(lines) {
  const rows = Array.isArray(lines) ? lines : [];
  const trades = rows.filter((r) => TRADE_RESULTS.has(r?.result));

  let totalFee = "0";
  for (const r of trades) totalFee = add(totalFee, String(r.fee ?? "0"));

  const slippageValues = trades
    .map((r) => Number(r.slippageBps ?? 0))
    .filter((v) => Number.isFinite(v));

  const dryRun = rows.some((r) => r?.dryRun === true);
  // dry-run 估算净收益：名义收益视为 0（无真实成交），净 = 0 − Σfee
  const netProfit = toNumber(sub("0", totalFee));

  return {
    trades: trades.length,
    totalFee,
    netProfit,
    slippage: slippageDistribution(slippageValues),
    dryRun,
  };
}
