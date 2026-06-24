// 入口编排：CLI → 加载 config + 展开 riskPreset → 只读 watch.config 得 excludeAddresses → 串行五阶段。
// 用法：
//   node service/discovery/main.mjs --dry-run            # 干跑：只 stdout，不落盘不推 TG
//   node service/discovery/main.mjs --top=10             # 正式：写 log/ + 推 TG（不动 watch.config）
//   node service/discovery/main.mjs --pages=4            # 看前 200 名
//   node service/discovery/main.mjs --config=service/discovery/config.json
//   node service/discovery/main.mjs --limit=20 --no-push  # 测试：仅扫前 20，落盘但不推 TG
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, isAbsolute, resolve } from "node:path";

import { collect } from "./process/collect.mjs";
import { filter } from "./process/filter.mjs";
import { evaluate } from "./process/evaluate.mjs";
import { score } from "./process/score.mjs";
import { output } from "./process/output.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// riskPreset 展开映射：字符串 → 门槛 + 权重
// 风险调整由 Recovery Factor(净盈利/最大回撤) 承担，替代不稳定的 ddRatio 与低信号的日级 Sharpe。
const PRESETS = {
  // betSize=下注规模权重（保守派看重低、激进派看重高）；conservative/aggressive 为 balanced 同思路类比
  conservative: {
    minProfitFactor: 2.0, minRecoveryFactor: 2.0, maxDayShare: 0.5,
    weights: { profitFactor: 33, recoveryFactor: 28, winRate: 9, persist: 14, volume: 8, betSize: 8 },
  },
  balanced: {
    minProfitFactor: 1.5, minRecoveryFactor: 1.0, maxDayShare: 0.7,
    weights: { profitFactor: 28, recoveryFactor: 22, winRate: 18, persist: 12, volume: 8, betSize: 12 },
  },
  aggressive: {
    minProfitFactor: 1.2, minRecoveryFactor: 0.7, maxDayShare: 0.9,
    weights: { profitFactor: 22, recoveryFactor: 13, winRate: 22, persist: 17, volume: 11, betSize: 15 },
  },
};

// 固定参数（硬编码，不读 config）
const FIXED = {
  sortBy: "pnl",
  positionsLimit: 1000, // 拉全历史平仓：实测最多 445 条/单账户(~220KB)，1000 足够覆盖、内存安全；
  poolMax: 1000,        // 200 会截断 318/445 条的长历史账户，致 activeSpan/netProfit/maxDD 失真
  concurrency: 4,
  httpTimeoutMs: 10_000,
};

const DEFAULT_LOW_FREQ = { minTrades: 8, minPF: 3, minWin: 0.7 };

function parseArgs(argv) {
  const flags = {};
  for (const arg of argv) {
    if (arg.startsWith("--")) {
      const [k, v] = arg.slice(2).split("=");
      flags[k] = v === undefined ? true : v;
    }
  }
  return flags;
}

function loadConfig(path) {
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch (e) {
    console.error(`配置文件读取失败：${path}（${e.message}）`);
    process.exit(1);
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    console.error(`配置文件 JSON 解析失败：${e.message}`);
    process.exit(1);
  }
}

// 只读 watch.config.json：取 watches[].address 小写归一为排除集；缺失/解析失败 → 空集，不阻断
function loadWatchConfig(path) {
  try {
    const cfg = JSON.parse(readFileSync(path, "utf8"));
    const addrs = new Set();
    for (const w of Array.isArray(cfg.watches) ? cfg.watches : []) {
      if (w?.address) addrs.add(String(w.address).toLowerCase());
    }
    return { excludeAddresses: addrs, tgToken: cfg.tgToken ?? null };
  } catch {
    return { excludeAddresses: new Set(), tgToken: null };
  }
}

// 把 config + CLI 覆盖 + preset 展开 + 固定参数 合并为 effectiveConfig
function buildEffectiveConfig(rawConfig, flags, watchTgToken) {
  const riskPreset = rawConfig.riskPreset ?? "balanced";
  const preset = PRESETS[riskPreset] ?? PRESETS.balanced;

  const sampling = {
    windows: rawConfig.sampling?.windows ?? ["7D", "30D"],
    pages: flags.pages !== undefined ? Number(flags.pages) : (rawConfig.sampling?.pages ?? 2),
  };

  return {
    ...FIXED,
    riskPreset,
    style: rawConfig.style ?? "any",
    sampling,
    gates: {
      minPerpsPnl: rawConfig.gates?.minPerpsPnl ?? 200,
      minVolume: rawConfig.gates?.minVolume ?? 50000,
      minActiveDays: rawConfig.gates?.minActiveDays ?? 15,
      minTrades: rawConfig.gates?.minTrades ?? 20,
    },
    qualityFilters: rawConfig.qualityFilters ?? true,
    topK: flags.top !== undefined ? Number(flags.top) : (rawConfig.topK ?? 10),
    // --limit=N：测试用，限定候选池规模（覆盖固定 poolMax）
    poolMax: flags.limit !== undefined ? Number(flags.limit) : FIXED.poolMax,
    // preset 展开（门槛 + 权重），高级字段可覆盖
    minProfitFactor: preset.minProfitFactor,
    minRecoveryFactor: preset.minRecoveryFactor,
    maxDayShare: preset.maxDayShare,
    weights: rawConfig.weights ?? preset.weights,
    lowFreq: rawConfig.lowFreqException ?? DEFAULT_LOW_FREQ,
    persistWindows: rawConfig.persistWindows ?? sampling.windows,
    output: {
      tgChat: rawConfig.output?.tgChat ?? null,
      tgToken: rawConfig.output?.tgToken ?? watchTgToken ?? null,
    },
  };
}

const log = (msg) => console.log(msg);

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const dryRun = flags["dry-run"] === true;
  const noPush = flags["no-push"] === true; // 落盘但不推 TG（测试用）

  const configPath = flags.config
    ? (isAbsolute(flags.config) ? flags.config : resolve(process.cwd(), flags.config))
    : join(__dirname, "config.json");
  const watchConfigPath = join(__dirname, "..", "watch", "config.json");
  const logDir = join(__dirname, "log");

  const rawConfig = loadConfig(configPath);
  const { excludeAddresses, tgToken: watchTgToken } = loadWatchConfig(watchConfigPath);
  const config = buildEffectiveConfig(rawConfig, flags, watchTgToken);

  log(`🔭 跟单候选发现启动｜preset=${config.riskPreset} windows=${config.sampling.windows.join(",")} pages=${config.sampling.pages} topK=${config.topK}${dryRun ? " [dry-run]" : ""}`);
  log(`   已监听排除集：${excludeAddresses.size} 个地址`);

  // ① 采集
  const { candidates, excluded } = await collect(config, excludeAddresses);
  log(`① 采集：候选 ${candidates.length} 个（排除已监听 ${excluded.length} 个）`);

  // ② 筛选
  const { survivors, eliminated: filterElim } = await filter(candidates, config);
  log(`② 筛选：幸存 ${survivors.length} 个（淘汰 ${filterElim.length} 个）`);

  // ③ 评估
  const { profiles, eliminated: evalElim } = await evaluate(survivors, config);
  log(`③ 评估：合格 ${profiles.length} 个（淘汰 ${evalElim.length} 个）`);

  // ④ 打分
  const ranked = score(profiles, config);
  log(`④ 打分：推荐 ${ranked.length} 个（topK=${config.topK}，不足不凑数）`);

  // ⑤ 输出
  const summary = {
    scanned: candidates.length + excluded.length,
    candidates: candidates.length,
    excluded: excluded.length,
    passed: profiles.length,
    recommended: ranked.length,
  };
  const ctx = {
    summary,
    eliminated: [...filterElim, ...evalElim],
    generatedAt: new Date(),
    dryRun,
    noPush,
    logDir,
    tgToken: config.output.tgToken,
    tgChat: config.output.tgChat,
  };
  const { mdPath, jsonPath } = await output(ranked, ctx, config);
  if (dryRun) {
    log(`⑤ 输出：dry-run 仅打印 md，不落盘不推 TG`);
  } else {
    log(`⑤ 输出：${jsonPath}`);
    log(`         ${mdPath}`);
    log(noPush ? `         TG 跳过推送（--no-push）` : `         TG 已推送至 ${config.output.tgChat ?? "(未配置 tgChat)"}`);
  }
}

main().catch((e) => {
  console.error(`运行失败：${e.message}`);
  process.exit(1);
});
