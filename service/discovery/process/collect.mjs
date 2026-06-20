// ① 采集 Collect：windows × pages 拉排行榜，并集去重，剔除已监听地址，截断 poolMax。
import { fetchLeaderboard } from "../api/index.mjs";

/**
 * 采集候选池。
 * @param {object} config - effectiveConfig（用 sampling.windows / sampling.pages / poolMax）
 * @param {Set<string>} excludeAddresses - 已监听地址（小写），命中即剔除（discovery 只发现新地址）
 * @returns {Promise<{candidates:Array<{accountId:string,walletAddress:string,hitWindows:Set<string>,lbPnl:number,lbVolume:number,rank:number}>, excluded:string[]}>}
 */
export async function collect(config, excludeAddresses = new Set()) {
  const windows = config.sampling.windows;
  const pages = config.sampling.pages;
  const poolMax = config.poolMax;

  const byAccount = new Map(); // accountId -> 候选
  const excluded = [];

  for (const windowType of windows) {
    for (let page = 1; page <= pages; page += 1) {
      const { items } = await fetchLeaderboard(windowType, page);
      for (const it of items) {
        const accountId = String(it.account_id);
        const walletAddress = String(it.wallet_address ?? "").toLowerCase();

        // 跳过已监听地址：只发现新地址，不重复评估
        if (walletAddress && excludeAddresses.has(walletAddress)) {
          if (!excluded.includes(walletAddress)) excluded.push(walletAddress);
          continue;
        }

        const existing = byAccount.get(accountId);
        if (existing) {
          existing.hitWindows.add(windowType); // 跨窗持续性：记命中窗集合
          continue;
        }
        byAccount.set(accountId, {
          accountId,
          walletAddress,
          hitWindows: new Set([windowType]),
          lbPnl: Number(it.pnl_usd ?? 0),
          lbVolume: Number(it.volume_usd ?? 0),
          rank: Number(it.rank ?? 0),
        });
      }
    }
  }

  const candidates = Array.from(byAccount.values()).slice(0, poolMax);
  return { candidates, excluded };
}
