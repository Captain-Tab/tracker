// ① 采集 Collect：流式拉 leaderboard → 逐行展平 + 排除已监听 + 内联门槛 → 只留通过者。
// 流式内联门槛 = 39k 候选不落地，内存峰值压到几十 MB（见 spec 03 NFR）。
import { streamLeaderboardRows, log } from "../api/index.mjs";
import { passesThreshold } from "./filter.mjs";

// 单行展平：windowPerformances [["day",{pnl,roi,vlm}],...] → perf 对象。纯函数，便于测试。
// 字段缺失/非数字 → 该窗口为 null（门槛端按 null 跳过，不崩）。
export function flattenRow(row) {
  if (!row || !row.ethAddress) return null;
  const perf = {};
  for (const entry of Array.isArray(row.windowPerformances) ? row.windowPerformances : []) {
    const [name, m] = entry;
    if (!name || !m) continue;
    perf[name] = { pnl: Number(m.pnl), roi: Number(m.roi), vlm: Number(m.vlm) };
  }
  return {
    address: String(row.ethAddress).toLowerCase(),
    displayName: row.displayName ?? null,
    accountValue: Number(row.accountValue),
    perf,
  };
}

// 流式采集：展平 + 排除已监听 + 门槛，只 push 通过者。limit>0 时扫够 limit 行即停。
// 返回 { survivors, scanned, excludedCount, eliminatedCount }。leaderboard 失败抛错（由 main 跳过本轮）。
export async function collect(env, excludeAddresses, config, limit = 0) {
  const survivors = [];
  let scanned = 0;
  let excludedCount = 0;
  let eliminatedCount = 0;

  await streamLeaderboardRows(env, (row) => {
    scanned++;
    const c = flattenRow(row);
    if (!c) { eliminatedCount++; return; }
    if (excludeAddresses.has(c.address)) { excludedCount++; return; }
    if (passesThreshold(c, config)) survivors.push(c);
    else eliminatedCount++;
    if (limit > 0 && scanned >= limit) return false; // 提前停止
  });

  log(`   leaderboard 扫描条目：${scanned}`);
  return { survivors, scanned, excludedCount, eliminatedCount };
}
