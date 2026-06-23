#!/usr/bin/env node
// 入口编排：CLI → 加载 config + 只读 HYPE-watch/config 得 excludeAddresses → collect→filter→output。
// 第一步只做 leaderboard 粗筛（pnl/vlm 门槛），逐笔深度评估留第二步。
// 用法：
//   node service/HYPE-discovery/main.mjs --dry-run         # 干跑：只 stdout，不落盘不推
//   node service/HYPE-discovery/main.mjs --no-push         # 落盘但不推 TG
//   node service/HYPE-discovery/main.mjs --limit=50        # 仅取前 50 候选（测试）
//   node service/HYPE-discovery/main.mjs --config=...
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, isAbsolute, resolve } from "node:path";

import { ENVS, log } from "./api/index.mjs";
import { collect } from "./process/collect.mjs";
import { rankTopK, gateOf } from "./process/filter.mjs";
import { output } from "./process/output.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const flags = {};
  for (const arg of argv) {
    if (arg.startsWith("--")) { const [k, v] = arg.slice(2).split("="); flags[k] = v === undefined ? true : v; }
  }
  return flags;
}

function loadConfig(path) {
  let raw;
  try { raw = readFileSync(path, "utf8"); }
  catch (e) { console.error(`配置文件读取失败：${path}（${e.message}）`); process.exit(1); }
  try { return JSON.parse(raw); }
  catch (e) { console.error(`配置文件 JSON 解析失败：${e.message}`); process.exit(1); }
}

// 只读 HYPE-watch/config.json：watches[].address 小写归一为排除集；缺失/失败 → 空集，不阻断
function loadWatchConfig(path) {
  try {
    const cfg = JSON.parse(readFileSync(path, "utf8"));
    const addrs = new Set();
    for (const w of Array.isArray(cfg.watches) ? cfg.watches : []) if (w?.address) addrs.add(String(w.address).toLowerCase());
    return addrs;
  } catch { return new Set(); }
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const dryRun = flags["dry-run"] === true;
  const noPush = flags["no-push"] === true;

  const configPath = flags.config
    ? (isAbsolute(flags.config) ? flags.config : resolve(process.cwd(), flags.config))
    : join(__dirname, "config.json");
  const watchConfigPath = join(__dirname, "..", "HYPE-watch", "config.json");
  const logDir = join(__dirname, "log");

  const raw = loadConfig(configPath);
  const env = ENVS[flags.env ?? "production"];
  if (!env) { console.error(`未知 env: ${flags.env}`); process.exit(1); }

  const window = raw.window ?? "month";
  const config = {
    window,
    thresholds: raw.thresholds ?? { minPnlUsd: {}, minVlmUsd: {} },
    topK: flags.top !== undefined ? Number(flags.top) : (raw.topK ?? 20),
  };
  const excludeAddresses = (raw.excludeWatched !== false) ? loadWatchConfig(watchConfigPath) : new Set();

  log(`🔭 HYPE 跟单候选粗筛启动｜窗口=${window} topK=${config.topK}${dryRun ? " [dry-run]" : ""}`);
  log(`   已监听排除集：${excludeAddresses.size} 个地址`);

  const gate = gateOf(config);
  const limit = flags.limit !== undefined ? Number(flags.limit) : 0; // --limit：扫够 N 行即停（测试）

  // ① 采集（流式 + 内联门槛；leaderboard 拉取失败 → 跳过本轮，不崩）
  let survivors, scanned, excludedCount, eliminatedCount;
  try {
    ({ survivors, scanned, excludedCount, eliminatedCount } = await collect(env, excludeAddresses, config, limit));
  } catch (e) {
    console.error(`leaderboard 采集失败，跳过本轮：${e.message}`);
    process.exit(0);
  }
  log(`① 采集：扫描 ${scanned} 行（排除已监听 ${excludedCount}）`);
  log(`② 筛选：通过门槛 ${survivors.length} 个（淘汰 ${eliminatedCount}；门槛 pnl≥${gate.minPnl} vlm≥${gate.minVlm}）`);

  // ③ 排序取 topK（不静默截断：truncated 显式记日志）
  const { ranked, truncated } = rankTopK(survivors, config);
  if (truncated > 0) log(`   topK=${config.topK} 截断：另有 ${truncated} 个过门槛者未列入（按 pnl 取前 ${config.topK}）`);

  // ④ 输出
  const summary = { scanned, excluded: excludedCount, passed: survivors.length, recommended: ranked.length, topK: config.topK, truncated };
  const ctx = {
    summary, generatedAt: new Date(), dryRun, noPush, logDir,
    tgToken: raw.tgToken ?? null, tgChat: raw.tgChat ?? null,
    window, gate,
  };
  const { mdPath, jsonPath } = await output(ranked, ctx);
  if (dryRun) log(`④ 输出：dry-run 仅打印 md`);
  else { log(`④ 输出：${jsonPath}`); log(`         ${mdPath}`); log(noPush ? `         TG 跳过（--no-push）` : `         TG → ${ctx.tgChat ?? "(未配置)"}`); }
}

main().catch((e) => { console.error(`运行失败：${e.message}`); process.exit(1); });
