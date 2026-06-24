// 入口：单账户按币种交易画像。输入 account_id / address → 拉平仓真账本 → 按币种切片 → 各币种质量+标签。
// 定位：分析/情报工具（非跟单赚钱机器）。只读公开数据，唯一接口 positions（按币种切片自同一份数据派生，零额外请求）。
// 用法：
//   node service/sodex-discovery/profile.mjs --account=3602
//   node service/sodex-discovery/profile.mjs --address=0x5847...7027
//   node service/sodex-discovery/profile.mjs --account=3602 --save   # 额外写 log/profile-<id>-<ts>.json
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { fetchPositions, refreshSymbols, resolveAccountId } from "./api/index.mjs";
import { sliceByCoin } from "./process/coinSlice.mjs";
import { fmtUsd, isAddress } from "../tool/format.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

const POSITIONS_LIMIT = 1000; // 拉全历史平仓（对齐 discovery；命中即标截断）
const PF_INF = "∞";

function parseArgs(argv) {
  const flags = {};
  for (const arg of argv) {
    if (arg.startsWith("--")) { const [k, v] = arg.slice(2).split("="); flags[k] = v === undefined ? true : v; }
  }
  return flags;
}

const fmtPf = (pf) => (pf === Infinity ? PF_INF : Number(pf).toFixed(2));
const fmtPct = (x) => `${Math.round(x * 100)}%`;

// 人读表：每币种一行 + 整体画像。币名右侧标签直接表达专精档/盈亏/样本不足。
function renderProfile(accountId, result) {
  const lines = [];
  lines.push(`🪙 账户 ${accountId} 币种画像｜已平仓位 ${result.totalClosed} 个${result.truncated ? " ⚠截断(命中 limit，统计可能不全)" : ""}`);
  lines.push(`📌 整体：${result.overall}`);
  lines.push("");
  if (!result.coins.length) {
    lines.push("（无已平仓位记录）");
    return lines.join("\n");
  }
  lines.push("币种    笔数  胜率   盈亏比   净盈亏        集中度  活跃天  标签");
  for (const c of result.coins) {
    const row = [
      c.coin.padEnd(6),
      String(c.nTrades).padStart(4),
      fmtPct(c.winRate).padStart(5),
      fmtPf(c.profitFactor).padStart(7),
      fmtUsd(c.netProfit, true).padStart(12),
      fmtPct(c.pnlShare).padStart(6),
      String(Math.round(c.activeSpanDays)).padStart(5),
      ` ${c.label}`,
    ].join("  ");
    lines.push(row);
  }
  return lines.join("\n");
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));

  // 解析账户：--account 直接用；--address 经链上解析
  let accountId = flags.account ? String(flags.account) : null;
  if (!accountId && flags.address) {
    if (!isAddress(String(flags.address))) { console.error(`非法地址：${flags.address}`); process.exit(1); }
    accountId = await resolveAccountId(String(flags.address));
    if (!accountId) { console.error(`地址未解析到 accountId：${flags.address}`); process.exit(1); }
  }
  if (!accountId) { console.error("用法：--account=<id> 或 --address=<0x...>"); process.exit(1); }

  const [positions, symbolMap] = await Promise.all([
    fetchPositions(accountId, POSITIONS_LIMIT),
    refreshSymbols(),
  ]);
  const truncated = Array.isArray(positions) && positions.length >= POSITIONS_LIMIT;

  const result = sliceByCoin(positions, Date.now(), symbolMap, { truncated });
  console.log(renderProfile(accountId, result));

  if (flags.save) {
    const logDir = join(__dirname, "log");
    mkdirSync(logDir, { recursive: true });
    // 时间戳 YYYY-MM-DD-HHMM：日期保留连字符，与时分用 - 分隔（避免日与时分粘连）
    const iso = new Date().toISOString(); // 2026-06-24T13:08:...
    const ts = `${iso.slice(0, 10)}-${iso.slice(11, 13)}${iso.slice(14, 16)}`;
    const jsonPath = join(logDir, `profile-${accountId}-${ts}.json`);
    writeFileSync(jsonPath, JSON.stringify({ accountId, generatedAt: new Date(), ...result }, null, 2), "utf8");
    console.log(`\n💾 ${jsonPath}`);
  }
}

main().catch((e) => { console.error(`运行失败：${e.message}`); process.exit(1); });
