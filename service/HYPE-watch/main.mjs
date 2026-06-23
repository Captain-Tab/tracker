#!/usr/bin/env node
// 监听若干 Hyperliquid 钱包 address 的 perps 账户变化（事件驱动）。
// 当前持仓取自 WS clearinghouseState 快照；离场单/平仓在变化时用 info REST 拉取。
// 仅多地址 --config 模式（不做单地址 CLI / 纯快照模式）。
//
// 依赖 ws 包（npm install ws）；无 SDK、无鉴权。代理(WARP)另需 undici + https-proxy-agent。
//
// 用法：
//   node service/HYPE-watch/main.mjs --config=service/HYPE-watch/config.json
//   通用：--history-limit=N（平仓历史条数，默认 2）/ --debounce-ms=N / --max-wait-ms=N / --at=HH:MM
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { pickAt } from "../tool/format.mjs";
import { loadSeenAddresses, computeNewAddresses, saveSeen } from "../tool/seenAddresses.mjs";
import { ENVS, log, refreshMeta, META_REFRESH_MS } from "./api/index.mjs";
import { loadConfig } from "./process/config.mjs";
import { AccountWatcher } from "./process/watcher.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const flags = {};
  for (const arg of argv) {
    if (arg.startsWith("--")) {
      const [k, v] = arg.slice(2).split("=");
      flags[k] = v === undefined ? true : v;
    }
  }
  return { flags };
}

async function main() {
  const { flags } = parseArgs(process.argv.slice(2));
  const configPath = typeof flags.config === "string" ? flags.config : null;

  if (!configPath) {
    console.error("用法: node service/HYPE-watch/main.mjs --config=service/HYPE-watch/config.json\n" +
      "  仅多地址实时 WS + 每日镜像（默认 20:00 上海）\n" +
      "  --at=HH:MM 每日镜像时间 / --history-limit=N（默认 2）/ --debounce-ms=N / --max-wait-ms=N");
    process.exit(1);
  }

  const env = ENVS[flags.env ?? "production"];
  if (!env) { console.error(`未知 env: ${flags.env}`); process.exit(1); }

  const cfg = loadConfig(configPath);
  // START WATCH 门控：仅 config 中相比上次新增的地址推 START（避免每次部署对所有地址重推）。
  const seenPath = join(__dirname, ".seen-addresses.json");
  const seen = loadSeenAddresses(seenPath);
  const configAddrs = cfg.watches.map((w) => w.address);
  const newAddrs = computeNewAddresses(configAddrs, seen);
  saveSeen(seenPath, configAddrs, seen);
  log(`START WATCH 门控：新增 ${newAddrs.size} / 已知 ${configAddrs.length - newAddrs.size}（删 ${seenPath} 可强制全部重推）`);
  await refreshMeta(env).catch((e) => log(`meta 拉取失败（不阻断）：${e.message}`));
  setInterval(() => refreshMeta(env).catch(() => {}), META_REFRESH_MS);

  const runners = cfg.watches.map((w) => new AccountWatcher(env, w.address, {
    ...flags,
    "tg-token": w.tgToken ?? cfg.tgToken,
    "tg-chat": w.tgChat ?? null,
    label: w.label ?? null,
    at: pickAt(w.at, flags.at), // 每地址独立镜像时刻：地址项 at > 全局 --at > 默认 20:00
    isNew: newAddrs.has(String(w.address).toLowerCase()),
  }));
  log(`模式：多地址实时 WS（${runners.length} 个地址，共享限流）`);
  for (const r of runners) r.start();
  process.on("SIGINT", () => { log("收到 SIGINT，关闭全部"); for (const r of runners) r.close(); process.exit(0); });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error("启动失败:", err); process.exit(1); });
}
