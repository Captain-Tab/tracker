// ② 筛选 Filter：每候选打 1 个 overview(30D)，用可信的 volume 粗筛砍量（省钱关键）。
// 不用 perps_closed_pnl_usd 做盈利门槛——实测该字段混入充提/资金费会误杀真盈利账户
// （2566 近30天逐笔真账本 +$3072，该字段却记 -$6129）。盈利判定交 evaluate 逐笔真账本。
import { fetchOverview } from "../api/index.mjs";

/**
 * 粗筛候选。
 * @param {Array} candidates - collect 产出的候选
 * @param {object} config - effectiveConfig（用 gates.minVolume）
 * @returns {Promise<{survivors:Array, eliminated:Array<{accountId:string,stage:string,reason:string}>}>}
 *   - survivors 每项附 overview 数据下传
 */
export async function filter(candidates, config) {
  const { minVolume } = config.gates;

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

    const volume = Number(overview.volume_usd ?? 0);

    // 真实成交量（粗筛唯一门槛）：overview.volume 实测可信。
    // 合约盈利 / perps 主导判定不在此做——原依据 perps_closed_pnl_usd 已证污染（见文件头）；
    // 是否真赚、是否合约主导（evaluate 只算 perps 平仓逐笔）由 evaluate 用真账本判定。
    if (!(volume >= minVolume)) {
      eliminated.push({ accountId: cand.accountId, stage: "filter", reason: `成交量不足 volume=${volume.toFixed(0)} < ${minVolume}` });
      continue;
    }

    survivors.push({ ...cand, overview });
  }

  return { survivors, eliminated };
}
