// 入口：单 HYPE 地址按币种交易画像。输入地址 → 拉 userFills → 按 coin 切片 → 各币种净利+集中度+标签。
// 定位：分析/情报工具。盈利源用逐笔 closedPnl（权威）；不展示 PF/胜率（每币完整周期稀疏失真，见 coinSlice 注释）。
// 用法：
//   node service/HYPE-discovery/profile.mjs --address=0xd05808946809c180d190608e13f473db30aa8524
//   node service/HYPE-discovery/profile.mjs --address=0x... --save   # 额外写 log/profile-<addr>-<ts>.json
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { fetchUserFills } from "./api/index.mjs";
import { sliceByCoin } from "./process/coinSlice.mjs";
import { fmtUsd, isAddress } from "../tool/format.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const flags = {};
  for (const arg of argv) {
    if (arg.startsWith("--")) { const [k, v] = arg.slice(2).split("="); flags[k] = v === undefined ? true : v; }
  }
  return flags;
}

// 人读表：每币种一行（按集中度降序）+ 整体画像。无 PF/胜率列（HYPE 周期稀疏失真）。
function renderProfile(address, result) {
  const lines = [];
  lines.push(`🪙 ${address} 币种画像｜成交 ${result.totalFills} 笔${result.capped ? " ⚠近期窗口(capped，命中 2000 上限)" : ""}`);
  lines.push(`📌 整体：${result.overall}`);
  lines.push("");
  if (!result.coins.length) {
    lines.push("（无成交记录）");
    return lines.join("\n");
  }
  lines.push("币种        净利          手续费      成交  完整交易  中位名义       集中度  标签");
  for (const c of result.coins) {
    lines.push([
      c.coin.padEnd(10),
      fmtUsd(c.netPnl, true).padStart(12),
      fmtUsd(c.feeTotal).padStart(10),
      String(c.nFills).padStart(5),
      String(c.nTrades).padStart(8),
      fmtUsd(c.medNotional).padStart(12),
      `${Math.round(c.pnlShare * 100)}%`.padStart(6),
      ` ${c.label}`,
    ].join("  "));
  }
  return lines.join("\n");
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const address = flags.address ? String(flags.address) : null;
  if (!address || !isAddress(address)) { console.error("用法：--address=<0x...>（合法 HYPE 钱包地址）"); process.exit(1); }

  const fills = await fetchUserFills(address);
  if (!Array.isArray(fills) || fills.length < 2) {
    console.log(`🪙 ${address}：成交记录不足（${Array.isArray(fills) ? fills.length : 0} 笔），无法画像`);
    return;
  }

  const result = sliceByCoin(fills);
  console.log(renderProfile(address, result));

  if (flags.save) {
    const logDir = join(__dirname, "log");
    mkdirSync(logDir, { recursive: true });
    // 时间戳 YYYY-MM-DD-HHMM
    const iso = new Date().toISOString();
    const ts = `${iso.slice(0, 10)}-${iso.slice(11, 13)}${iso.slice(14, 16)}`;
    const jsonPath = join(logDir, `profile-${address}-${ts}.json`);
    writeFileSync(jsonPath, JSON.stringify({ address, generatedAt: new Date(), ...result }, null, 2), "utf8");
    console.log(`\n💾 ${jsonPath}`);
  }
}

main().catch((e) => { console.error(`运行失败：${e.message}`); process.exit(1); });
