// START WATCH 门控：跨部署记录"已通知过 START 的地址"，只对 config 中相比上次新增的地址推 START。
// sodex-watch / HYPE-watch 共用（各自传不同 .seen-addresses.json 路径）。
import { readFileSync, writeFileSync } from "node:fs";

// 读已记录地址集合（小写归一）。文件缺失 / 解析失败 / 结构异常 → 空集（不阻断）。
export function loadSeenAddresses(path) {
  try {
    const arr = JSON.parse(readFileSync(path, "utf8"));
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.map((a) => String(a).toLowerCase()));
  } catch {
    return new Set();
  }
}

// 新增地址 = configAddrs − seen（均小写归一）。纯函数。
export function computeNewAddresses(configAddrs, seen) {
  const out = new Set();
  for (const a of configAddrs) {
    const key = String(a).toLowerCase();
    if (!seen.has(key)) out.add(key);
  }
  return out;
}

// 并集落盘（seen ∪ configAddrs，小写归一去重）。写失败仅告警不阻断。
export function saveSeen(path, configAddrs, seen = new Set()) {
  const union = new Set(seen);
  for (const a of configAddrs) union.add(String(a).toLowerCase());
  try {
    writeFileSync(path, JSON.stringify([...union], null, 2), "utf8");
  } catch (e) {
    console.error(`seen-addresses 写入失败（不阻断）：${e.message}`);
  }
}
