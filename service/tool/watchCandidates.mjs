// 候选地址历史记录：所有曾加入 watch 的地址（追加不删）。sodex-watch / HYPE-watch 各自维护。
// discovery 排除"当前监听 + 历史候选"并集，防止已移除的地址在下一轮重新出现。
// 文件格式：{ "0xabc...": { "date": "2026-06-23", "reason": "discovery #1" }, ... }
import { readFileSync, writeFileSync } from "node:fs";

// 读历史候选集 → Map<address, {date, reason}>（地址小写归一）。文件缺失/解析失败 → 空 Map。
export function loadCandidates(path) {
  try {
    const obj = JSON.parse(readFileSync(path, "utf8"));
    if (obj == null || typeof obj !== "object" || Array.isArray(obj)) return new Map();
    const map = new Map();
    for (const [addr, v] of Object.entries(obj)) {
      if (!addr) continue;
      const entry = typeof v === "string"
        ? { date: v, reason: "" }       // 兼容旧格式：纯日期字符串
        : { date: v?.date ?? "", reason: v?.reason ?? "" };
      if (entry.date) map.set(String(addr).toLowerCase(), entry);
    }
    return map;
  } catch {
    return new Map();
  }
}

// 并集落盘（已有 key 保持原值，新 key 追加）。写失败仅告警不阻断。
export function saveCandidates(path, map) {
  try {
    const obj = {};
    for (const [addr, entry] of map) {
      obj[addr] = { date: entry.date, reason: entry.reason || "" };
    }
    writeFileSync(path, JSON.stringify(obj, null, 2), "utf8");
  } catch (e) {
    console.error(`写入 watch-candidates.json 失败：${e.message}`);
  }
}

// 并集：现有 map + 新地址列表（{address, date, reason}）。已有 key 保持原值。返回新 Map（纯函数）。
export function mergeCandidates(existing, addrs) {
  const next = new Map(existing);
  for (const item of addrs) {
    if (!item?.address) continue;
    const key = String(item.address).toLowerCase();
    if (!next.has(key)) next.set(key, { date: item.date ?? "", reason: item.reason ?? "" });
  }
  return next;
}

// 提取地址集（小写归一），供 discovery 排除用
export function candidateAddresses(map) {
  const s = new Set();
  for (const addr of map.keys()) s.add(String(addr).toLowerCase());
  return s;
}

export const __internals = { loadCandidates, saveCandidates, mergeCandidates, candidateAddresses };
