// ② 筛选 Filter：每候选打 1 个 overview(30D)，绝对额粗筛砍 ~90%（省钱关键）。
import { fetchOverview } from "../api/index.mjs";

/**
 * 粗筛候选。
 * @param {Array} candidates - collect 产出的候选
 * @param {object} config - effectiveConfig（用 gates.minPerpsPnl / gates.minVolume / perpsMustDominate）
 * @returns {Promise<{survivors:Array, eliminated:Array<{accountId:string,stage:string,reason:string}>}>}
 *   - survivors 每项附 overview 数据下传
 */
export async function filter(candidates, config) {
  const { minPerpsPnl, minVolume } = config.gates;
  const perpsMustDominate = config.perpsMustDominate;

  const survivors = [];
  const eliminated = [];

  const results = await Promise.all(
    candidates.map(async (cand) => {
      try {
        const overview = await fetchOverview(cand.accountId, "30D");
        return { cand, overview, error: null };
      } catch (err) {
        return { cand, overview: null, error: err };
      }
    }),
  );

  for (const { cand, overview, error } of results) {
    if (error || !overview) {
      eliminated.push({ accountId: cand.accountId, stage: "filter", reason: `overview 拉取失败: ${error?.message ?? "空响应"}` });
      continue;
    }

    const perpsClosed = Number(overview.perps_closed_pnl_usd ?? 0);
    const spotPnl = Number(overview.spot_pnl_usd ?? 0);
    const volume = Number(overview.volume_usd ?? 0);

    // 合约真赚（绝对额，D2 不用 tradeRatio）
    if (!(perpsClosed > minPerpsPnl)) {
      eliminated.push({ accountId: cand.accountId, stage: "filter", reason: `合约盈利不足 perpsClosed=${perpsClosed.toFixed(0)} <= ${minPerpsPnl}` });
      continue;
    }
    // perps 主导（非现货/空投赚的）
    if (perpsMustDominate && !(perpsClosed >= Math.abs(spotPnl))) {
      eliminated.push({ accountId: cand.accountId, stage: "filter", reason: `非合约主导 perpsClosed=${perpsClosed.toFixed(0)} < |spot|=${Math.abs(spotPnl).toFixed(0)}` });
      continue;
    }
    // 真实成交量
    if (!(volume >= minVolume)) {
      eliminated.push({ accountId: cand.accountId, stage: "filter", reason: `成交量不足 volume=${volume.toFixed(0)} < ${minVolume}` });
      continue;
    }

    survivors.push({ ...cand, overview });
  }

  return { survivors, eliminated };
}
