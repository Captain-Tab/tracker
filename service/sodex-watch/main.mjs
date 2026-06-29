#!/usr/bin/env node
// 监听某钱包 address 的 perps 账户变化（事件驱动，非轮询）。
// 当前持仓直接取自 WS accountState 快照；平仓历史/离场挂单在变化时用 REST 拉取。
//
// 依赖 ws 包（npm install ws）；无 SDK、无鉴权。代理(WARP)另需 undici + https-proxy-agent。
//
// 请求控制（防 429/409 限流、防多发/漏发）：
//   1. 指纹去重 — 规范化比对（abs(size)+派生方向+离场单集合+排序），消除表示/顺序漂移误判
//   2. 防抖合并 — 默认 3000ms + maxWait 5000ms 封顶，活跃流不饥饿
//   3. 限流退避 — 429/409 优先 Retry-After，否则指数 2→60s + jitter；模块级共享，一处限流全员退避
//   4. 失败兜底 — 拉取失败不渲染空数据，保留指纹待下次成功（不误报）
//   5. 暂缓重试 — CLOSED 仓位但平仓历史尚无对应记录时等 2s 补拉（positions 索引延迟）
//
// 用法：
//   单地址：node service/watch/main.mjs 0xYourAddress
//   单地址快照：node service/watch/main.mjs 0xYourAddress --snapshot
//   多地址：node service/watch/main.mjs --config=service/watch/config.json
//   Telegram：--tg-token=BOT_TOKEN --tg-chat=CHAT_ID（单地址）
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { isAddress, pickAt } from "../tool/format.mjs";
import { loadSeenAddresses, computeNewAddresses, saveSeen } from "../tool/seenAddresses.mjs";
import { ENVS, log, refreshSymbols, SYMBOLS_REFRESH_MS } from "./api/index.mjs";
import { loadConfig } from "./process/config.mjs";
import { AccountWatcher } from "./process/watcher.mjs";
import { SnapshotMode } from "./process/snapshot.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (const arg of argv) {
    if (arg.startsWith("--")) {
      const [k, v] = arg.slice(2).split("=");
      flags[k] = v === undefined ? true : v;
    } else positional.push(arg);
  }
  return { address: positional[0], flags };
}

async function main() {
  const { address, flags } = parseArgs(process.argv.slice(2));
  const configPath = typeof flags.config === "string" ? flags.config : null;
  const snapshotMode = flags.snapshot === true || flags.snapshot === "true";

  // G7：--config 仅实时 WS 模式，与 --snapshot 互斥（多地址快照本次不做）
  if (configPath && snapshotMode) { console.error("--config 与 --snapshot 互斥（多地址快照本次不做）"); process.exit(1); }

  const env = ENVS[flags.env ?? "production"];
  if (!env) { console.error(`未知 env: ${flags.env}`); process.exit(1); }

  // 多地址模式：读 config，循环建 N 个 watcher
  if (configPath) {
    const cfg = loadConfig(configPath);
    // START WATCH 门控：仅 config 中相比上次新增的地址推 START（避免每次部署对所有地址重推）。
    const seenPath = join(__dirname, ".seen-addresses.json");
    const seen = loadSeenAddresses(seenPath);
    const configAddrs = cfg.watches.map((w) => w.address);
    const newAddrs = computeNewAddresses(configAddrs, seen);
    saveSeen(seenPath, configAddrs, seen);
    log(`START WATCH 门控：新增 ${newAddrs.size} / 已知 ${configAddrs.length - newAddrs.size}（删 ${seenPath} 可强制全部重推）`);
    await refreshSymbols(env).catch((e) => log(`符号列表拉取失败（不阻断）：${e.message}`));
    setInterval(() => refreshSymbols(env).catch(() => {}), SYMBOLS_REFRESH_MS);
    const runners = cfg.watches.map((w) => new AccountWatcher(env, w.address, {
      ...flags,
      "tg-token": w.tgToken ?? cfg.tgToken,
      "tg-chat": w.tgChat ?? null,
      label: w.label ?? null,
      at: pickAt(w.at, flags.at), // 每地址独立镜像时刻：地址项 at > 全局 --at > 默认 20:00
      isNew: newAddrs.has(String(w.address).toLowerCase()),
      // 跟单脏标信号路径（加法）：地址项 copySignalPath > 全局 copySignalDir/<address 小写>.json > 不发
      // 文件名地址**统一小写**——与 copy 侧派生口径一致，避免 checksum/小写不一致导致路径对不上
      "copy-signal-path": w.copySignalPath ?? (cfg.copySignalDir ? join(cfg.copySignalDir, `${String(w.address).toLowerCase()}.json`) : null),
    }));
    log(`模式：多地址实时 WS（${runners.length} 个地址，共享限流${cfg.copySignalDir ? "，跟单信号已开" : ""}）`);
    for (const r of runners) r.start();
    process.on("SIGINT", () => { log("收到 SIGINT，关闭全部"); for (const r of runners) r.close(); process.exit(0); });
    return;
  }

  // 单地址模式（向后兼容）
  if (!isAddress(address)) {
    console.error("用法: node service/watch/main.mjs 0xAddress [模式] [选项]\n" +
      "  多地址：node service/watch/main.mjs --config=service/watch/config.json\n" +
      "  默认实时 WS + 每日 20:00 快照；--snapshot 纯快照模式\n" +
      "  --at=HH:MM  每日快照时间（上海，默认 20:00）\n" +
      "  Telegram：--tg-token=BOT_TOKEN --tg-chat=CHAT_ID\n" +
      "  通用：--history-limit=N（平仓历史条数，默认 2）/ --account-id=N / --raw\n" +
      "  实时模式额外：--debounce-ms=N（短档防抖，默认 3000）/ --max-wait-ms=N（短档封顶，默认 5000）\n" +
      "    分档：开/平/反手/离场单走短档即时；同仓滚仓加减仓走长档合并\n" +
      "    --tier-debounce-ms=N（长档防抖，默认 20000）/ --tier-max-wait-ms=N（长档封顶，默认 90000）\n" +
      "    两个 tier 值设为与短档相同即回退旧的统一防抖行为");
    process.exit(1);
  }

  await refreshSymbols(env).catch((e) => log(`符号列表拉取失败（不阻断）：${e.message}`));
  setInterval(() => refreshSymbols(env).catch(() => {}), SYMBOLS_REFRESH_MS);

  const runner = snapshotMode ? new SnapshotMode(env, address, flags) : new AccountWatcher(env, address, flags);
  log(snapshotMode ? "模式：snapshot（按需 + 每日定时）" : "模式：实时 WS 监听");
  runner.start();

  process.on("SIGINT", () => { log("收到 SIGINT，关闭"); runner.close(); process.exit(0); });
}

// 仅作为入口直接运行时启动；被 import 时不触发 WS/副作用
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error("启动失败:", err); process.exit(1); });
}
