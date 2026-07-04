// 仓位状态持久化工具：服务重启后恢复 lastPositions，避免重启丢基线。
// sodex-watch / HYPE-watch 共用（各自传不同路径）。
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

// 归一化地址为文件安全名
function safeAddr(address) {
  return String(address).toLowerCase().replace(/[^a-f0-9]/g, "");
}

// 读取持久化的仓位快照。文件缺失/损坏/过期 → []（不阻断启动）。
export function loadLastPositions(path, address) {
  const file = `${path}/lastPositions-${safeAddr(address)}.json`;
  try {
    const raw = readFileSync(file, "utf8");
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.positions)) return [];
    // positions 中只需保留 diffPositions 所需的 coin/dir/size 三个字段
    return data.positions.map((p) => ({
      coin: String(p.coin ?? ""),
      dir: String(p.dir ?? ""),
      size: Number(p.size ?? 0),
    }));
  } catch {
    return [];
  }
}

// 写入仓位快照。自动创建目录，写失败仅告警不阻断。
export function saveLastPositions(path, address, positions) {
  const file = `${path}/lastPositions-${safeAddr(address)}.json`;
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({
      positions: positions.map((p) => ({
        coin: String(p.coin),
        dir: String(p.dir),
        size: Number(p.size),
      })),
      updatedAt: Date.now(),
    }, null, 2), "utf8");
  } catch (e) {
    console.error(`lastPositions 写入失败（不阻断）：${e.message}`);
  }
}

// 读取持久化的 accountId（sodex-watch REST 兜底用）。文件缺失 → null。
export function loadAccountId(path, address) {
  const file = `${path}/accountId-${safeAddr(address)}.json`;
  try {
    const data = JSON.parse(readFileSync(file, "utf8"));
    return typeof data?.accountId === "string" ? data.accountId : null;
  } catch {
    return null;
  }
}

// 写入 accountId。自动创建目录，写失败仅告警不阻断。
export function saveAccountId(path, address, accountId) {
  const file = `${path}/accountId-${safeAddr(address)}.json`;
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ accountId: String(accountId), updatedAt: Date.now() }, null, 2), "utf8");
  } catch (e) {
    console.error(`accountId 写入失败（不阻断）：${e.message}`);
  }
}
