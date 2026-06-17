#!/usr/bin/env node
/**
 * 翻译指定 key（soso-translation 自包含版，零项目脚本依赖）
 *
 * 三层 fallback：主 API（SosoValue Gemini，内联）→ Google Translate → 英文兜底。
 * 同源检测 / 字符集校验 / {{var}} 占位符保护 / 白名单 + shouldKeepText 前置过滤，全部内联。
 *
 * 布局（localesDir / 目标语言）来自 resolve-config.cjs（认 soso-kit 源仓的 projects/<项目>.json）。
 *
 * 用法：
 *   node translate-keys.cjs <namespace> <key1> [key2]...                 # 单 target 项目
 *   node translate-keys.cjs --target <name> <namespace> <key1> [key2]... # monorepo 指定 app
 *   node translate-keys.cjs --locales-dir <abs> <namespace> <key1>...    # 直接指定 locales 目录（绕过配置）
 */

const fs = require("fs");
const path = require("path");

let resolver = null;
try {
  resolver = require("./resolve-config.cjs");
} catch {}

// ---------- 内联主翻译 API（原 scripts/i18n/translate/index.cjs，去项目依赖）----------
const DEFAULT_API_URL = "https://prod-ai-simple-translate.sosovalue.io/translate/gcpgemini";
const DEFAULT_API_KEY = "rrTrCsaJxJFcFPgNezeEyaYyrhQw7N3dqjgEaBXo";

function protectPlaceholders(text) {
  const raw = String(text ?? "");
  const map = [];
  const safe = raw.replace(/\{\{[^}]+\}\}/g, (m) => {
    const token = `__I18N_VAR_${map.length}__`;
    map.push({ token, value: m });
    return token;
  });
  return {
    safeText: safe,
    restore: (translated) => {
      let out = String(translated ?? "");
      for (const item of map) out = out.split(item.token).join(item.value);
      return out;
    },
  };
}

// locales 目录名 → 主 API 语言代码（hk → tc）
function mapToApiLang(lang) {
  const l = String(lang || "").trim();
  if (l === "hk") return "tc";
  return l;
}

const PRIMARY_SUPPORTED = new Set([
  "en", "zh", "tc", "ja", "es", "ko", "ru", "vi", "tr", "fr", "pt", "id", "de",
]);

async function translateWithPrimary(text, targetLang) {
  const apiLang = mapToApiLang(targetLang);
  if (apiLang === "en") return text;
  if (!PRIMARY_SUPPORTED.has(apiLang)) throw new Error(`primary unsupported lang: ${apiLang}`);
  const { safeText, restore } = protectPlaceholders(text);
  const resp = await fetch(DEFAULT_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-Key": DEFAULT_API_KEY },
    body: JSON.stringify({ inputs: { Original: safeText, Language: apiLang } }),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`primary http ${resp.status}: ${body.slice(0, 120)}`);
  }
  const data = await resp.json();
  const r0 = data && Array.isArray(data.result) ? data.result[0] : null;
  const translated = r0 && typeof r0.translated === "string" ? r0.translated : "";
  if (!translated) throw new Error("primary empty translated");
  return restore(translated);
}

// ---------- Google Translate 备用 ----------
async function translateWithGoogle(text, targetLang) {
  const langMap = { hk: "zh-TW", zh: "zh-CN" };
  const googleLang = langMap[targetLang] || targetLang;
  const { safeText, restore } = protectPlaceholders(text);
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=${googleLang}&dt=t&q=${encodeURIComponent(safeText)}`;
  const resp = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
  });
  if (!resp.ok) throw new Error(`google http ${resp.status}`);
  const data = await resp.json();
  if (Array.isArray(data) && Array.isArray(data[0])) {
    return restore(data[0].map((i) => i[0]).join(""));
  }
  throw new Error("google 返回格式异常");
}

// ---------- 失败检测：同源 / 目标字符集缺失 ----------
function detectTargetScript(text, lang) {
  const patterns = {
    ja: /[぀-ゟ゠-ヿ]/,
    ko: /[가-힯]/,
    ru: /[Ѐ-ӿ]/,
    ar: /[؀-ۿ]/,
    th: /[฀-๿]/,
  };
  const pat = patterns[lang];
  return pat ? pat.test(text) : null;
}

function isTranslationFailed(result, source, lang) {
  if (!result || !result.trim()) return true;
  const norm = (s) => s.trim().replace(/\s+/g, " ");
  if (norm(result) === norm(source)) return true;
  const hasScript = detectTargetScript(result, lang);
  if (hasScript === false) {
    const isNormalEnglish = /^[A-Za-z\s.,!?'"()\-:;{}]+$/.test(source.trim());
    const isMultiWord = source.trim().split(/\s+/).length >= 2;
    if (isNormalEnglish && isMultiWord) return true;
  }
  return false;
}

// ---------- 内联 shouldKeepText（原 scripts/i18n/rules.* 核心逻辑）----------
function shouldKeepText(rawText) {
  if (!rawText) return false;
  const cleaned = String(rawText).replace(/\s+/g, " ").trim();
  if (!cleaned) return false;
  if (/[一-龥]/.test(cleaned)) return false; // 含中文
  if (/^[A-Za-z]$/.test(cleaned)) return false; // 单字母
  if (/^https?:\/\/\S+$/i.test(cleaned)) return false; // 纯 URL
  const withoutVars = cleaned.replace(/\{\{[^}]+\}\}/g, "").trim();
  if (/^0x/i.test(withoutVars)) return false; // 地址/哈希
  if (/^#(?:[0-9a-fA-F]{3,8})$/.test(withoutVars)) return false; // 颜色 hex
  // CSS：含花括号 + ≥2 个 prop:value; + 选择器
  if (/[{}]/.test(cleaned)) {
    const decls = cleaned.match(/[a-z-]{2,}\s*:\s*[^;{}]+;/gi) || [];
    const sel = /(^|\s)[.#][A-Za-z0-9_-]+\s*\{/.test(cleaned) || /\b!important\b/i.test(cleaned) || /\bnth-child\(/i.test(cleaned);
    if (decls.length >= 2 && sel) return false;
  }
  // 文件名：xxx.png/svg/... 单 token
  if (!/\s/.test(withoutVars) && /\.[a-z0-9]{2,4}$/i.test(withoutVars)) return false;
  // 驼峰/帕斯卡标识符（无空格、纯字母数字，含大小写交替）→ 类名/错误码
  if (!/\s/.test(withoutVars) && /^[A-Za-z][A-Za-z0-9]*$/.test(withoutVars) && /[a-z][A-Z]|[A-Z]{2,}[a-z]/.test(withoutVars)) {
    return false;
  }
  // 必须含 ≥1 个 3 字母以上英文词
  if (!/[A-Za-z]{2,}/.test(cleaned)) return false;
  return true;
}

let WHITELIST = [];
try {
  WHITELIST = require("./whitelist.cjs");
} catch {}
function isInWhitelist(text) {
  const trimmed = (text || "").trim();
  return WHITELIST.some((item) => (item instanceof RegExp ? item.test(trimmed) : trimmed === item));
}
function shouldTranslate(text) {
  if (!text || !text.trim()) return false;
  if (isInWhitelist(text)) return false;
  return shouldKeepText(text);
}

// ---------- 安全 / IO ----------
const SAFE_NAME = /^[a-zA-Z0-9_-]+$/;
function validateName(n, kind) {
  if (!n || !SAFE_NAME.test(n)) throw new Error(`${kind} 含非法字符: "${n}"`);
}

function readJson(filePath, { mustExist = false } = {}) {
  if (!fs.existsSync(filePath)) {
    if (mustExist) return { ok: false, data: null, error: "文件不存在" };
    return { ok: true, data: {} };
  }
  const raw = fs.readFileSync(filePath, "utf8");
  if (!raw.trim()) return { ok: true, data: {} };
  try {
    return { ok: true, data: JSON.parse(raw) };
  } catch (e) {
    return { ok: false, data: null, error: e.message };
  }
}

function writeSortedJson(filePath, data) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const sorted = Object.keys(data)
    .sort((a, b) => a.localeCompare(b))
    .reduce((o, k) => ((o[k] = data[k]), o), {});
  fs.writeFileSync(filePath, JSON.stringify(sorted, null, 2) + "\n", "utf8");
}

const c = { reset: "\x1b[0m", green: "\x1b[32m", yellow: "\x1b[33m", blue: "\x1b[34m", cyan: "\x1b[36m", dim: "\x1b[2m" };
const log = (color, msg) => console.log(`${color}${msg}${c.reset}`);

// 有界并发池：固定 limit 个 runner 抢任务，任意时刻在飞请求 ≤ limit（控限流）
async function runPool(items, limit, worker, onProgress) {
  const results = new Array(items.length);
  let idx = 0;
  let done = 0;
  async function runner() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await worker(items[i], i);
      done++;
      if (onProgress) onProgress(done, items.length);
    }
  }
  const runners = Array.from({ length: Math.min(limit, items.length || 1) }, runner);
  await Promise.all(runners);
  return results;
}

// 周期纯文本进度（TTY/非 TTY 通用，不用 \r 动画）：约每 10% 打一行
function makeProgress(label, total) {
  const step = Math.max(1, Math.floor(total / 10));
  return (done) => {
    if (done === total || done % step === 0) log(c.dim, `   [${label}] ${done}/${total}`);
  };
}

// ---------- 解析布局：localesDir + 目标语言 ----------
function resolveLayout(args) {
  // 显式 --locales-dir 优先（绕过配置）
  const ldIdx = args.indexOf("--locales-dir");
  if (ldIdx >= 0) {
    const localesAbs = path.resolve(args[ldIdx + 1]);
    args.splice(ldIdx, 2);
    const langs = fs
      .readdirSync(localesAbs, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name !== "en")
      .map((d) => d.name)
      .sort();
    return { localesAbs, langs };
  }
  // 否则走 resolve-config
  let targetName = null;
  const tIdx = args.indexOf("--target");
  if (tIdx >= 0) {
    targetName = args[tIdx + 1];
    args.splice(tIdx, 2);
  }
  if (!resolver) throw new Error("resolve-config.cjs 不可用，请用 --locales-dir 显式指定");
  const r = resolver.loadOrDetect({});
  const target = resolver.pickTarget(r.config, targetName);
  if (!target) {
    throw new Error(
      `项目有多个 target，请用 --target 指定一个: ${(r.config.targets || []).map((t) => t.name).join(", ")}`,
    );
  }
  const localesAbs = path.join(r.projectRoot, target.localesDir);
  const langs = resolver.listTargetLangs(r.projectRoot, target);
  return { localesAbs, langs };
}

// 默认并发数（保守，控限流）；--concurrency N 可调
const DEFAULT_CONCURRENCY = 5;

async function main() {
  const args = process.argv.slice(2);

  let concurrency = DEFAULT_CONCURRENCY;
  const cIdx = args.indexOf("--concurrency");
  if (cIdx >= 0) {
    concurrency = Math.max(1, parseInt(args[cIdx + 1], 10) || DEFAULT_CONCURRENCY);
    args.splice(cIdx, 2);
  }

  if (args.length < 2) {
    log(c.blue, "\n📚 翻译指定 key（自包含）");
    log(c.dim, "用法: node translate-keys.cjs [--target <name>] [--locales-dir <abs>] [--concurrency N] <namespace> <key1> [key2]...");
    process.exit(1);
  }

  let localesAbs, langs;
  try {
    ({ localesAbs, langs } = resolveLayout(args));
  } catch (e) {
    log(c.yellow, `\n❌ ${e.message}`);
    process.exit(1);
  }

  const [namespace, ...keys] = args;
  try {
    validateName(namespace, "namespace");
    for (const l of langs) validateName(l, "lang");
  } catch (e) {
    log(c.yellow, `\n❌ ${e.message}`);
    process.exit(1);
  }

  log(c.blue, "\n📚 翻译指定 key");
  log(c.dim, `   Locales     : ${localesAbs}`);
  log(c.dim, `   Namespace   : ${namespace}`);
  log(c.dim, `   Keys        : ${keys.length} [${keys.join(", ")}]`);
  log(c.dim, `   Languages   : ${langs.length} (${langs.join(", ")})`);
  log(c.dim, `   Concurrency : ${concurrency}\n`);

  const enPath = path.join(localesAbs, "en", `${namespace}.json`);
  const enResult = readJson(enPath, { mustExist: true });
  if (!enResult.ok) {
    log(c.yellow, `\n❌ 英文源文件读取失败: ${enPath}（${enResult.error}）`);
    process.exit(1);
  }
  const enJson = enResult.data;

  const validKeys = keys.filter((k) => {
    if (!enJson[k]) {
      log(c.yellow, `⚠️  Key "${k}" 在英文文件中不存在，跳过`);
      return false;
    }
    return true;
  });

  const toSync = validKeys.filter((k) => !shouldTranslate(enJson[k]));
  const toTranslate = validKeys.filter((k) => shouldTranslate(enJson[k]));

  // 内存累积所有写入：writes[lang][key] = value；末尾每文件写一次（避免并发竞态 + 减少磁盘 IO）
  const writes = {};
  for (const lang of langs) writes[lang] = {};

  // 命中规则/白名单的 key → 各语言写英文原文
  for (const key of toSync) for (const lang of langs) writes[lang][key] = enJson[key];
  if (toSync.length) log(c.yellow, `⏭️  ${toSync.length} 个 key 命中规则/白名单，将同步英文原文`);

  // B 去重：把 (lang, enValue) 相同的合并成一个唯一翻译任务，结果回填到所有共享 key
  const uniq = new Map(); // `${lang} ${enValue}` -> { lang, enValue, keys: [] }
  for (const key of toTranslate) {
    const enValue = enJson[key];
    for (const lang of langs) {
      const ck = `${lang} ${enValue}`;
      if (!uniq.has(ck)) uniq.set(ck, { lang, enValue, keys: [] });
      uniq.get(ck).keys.push(key);
    }
  }
  const tasks = [...uniq.values()];
  const pairTotal = toTranslate.length * langs.length;

  let p1 = 0, p2 = 0;
  const enFallbacks = [];

  if (tasks.length) {
    log(c.cyan, `\n🔵 阶段 1／2  主 API（${tasks.length} 个唯一任务 / 共 ${pairTotal} 条，去重省 ${pairTotal - tasks.length}）`);
    // A 并发：阶段 1 主 API
    const prog1 = makeProgress("主API", tasks.length);
    const retry = [];
    await runPool(tasks, concurrency, async (task) => {
      let result = "";
      try { result = await translateWithPrimary(task.enValue, task.lang); } catch {}
      if (isTranslationFailed(result, task.enValue, task.lang)) {
        retry.push(task);
      } else {
        for (const key of task.keys) writes[task.lang][key] = result;
        p1 += task.keys.length;
      }
    }, prog1);
    log(c.green, `  ✅ 主 API 成功 ${p1} 条，重试 ${retry.length} 个任务`);

    // A 并发：阶段 2 Google 重试 → 英文兜底
    if (retry.length) {
      log(c.cyan, `\n🟡 阶段 2／2  Google 重试（${retry.length} 个任务）`);
      const prog2 = makeProgress("Google", retry.length);
      await runPool(retry, concurrency, async (task) => {
        let result = "";
        try { result = await translateWithGoogle(task.enValue, task.lang); } catch {}
        if (isTranslationFailed(result, task.enValue, task.lang)) {
          for (const key of task.keys) { writes[task.lang][key] = task.enValue; enFallbacks.push({ key, lang: task.lang }); }
        } else {
          for (const key of task.keys) writes[task.lang][key] = result;
          p2 += task.keys.length;
        }
      }, prog2);
      log(c.green, `  🔄 Google 成功 ${p2} 条，英文兜底 ${enFallbacks.length} 条`);
    }
  }

  // 写阶段（串行，每文件读一次/写一次）：结构性免竞态
  let filesWritten = 0;
  for (const lang of langs) {
    const entries = writes[lang];
    if (!Object.keys(entries).length) continue;
    const fp = path.join(localesAbs, lang, `${namespace}.json`);
    const r = readJson(fp);
    if (!r.ok) { log(c.yellow, `⚠️  ${lang}/${namespace}.json 解析失败，跳过写入`); continue; }
    let changed = false;
    for (const [key, val] of Object.entries(entries)) {
      // toSync 仅在缺失时补；翻译结果总是覆盖
      if (toSync.includes(key) && r.data[key]) continue;
      if (r.data[key] !== val) { r.data[key] = val; changed = true; }
    }
    if (changed) { writeSortedJson(fp, r.data); filesWritten++; }
  }

  log(c.blue, `\n翻译报告`);
  log(c.green, `  ✅ 主 API : ${p1}`);
  log(c.cyan, `  🔄 Google : ${p2}`);
  log(c.yellow, `  ⚠️  英文兜底: ${enFallbacks.length}`);
  log(c.dim, `  💾 写入文件: ${filesWritten}`);
  if (enFallbacks.length) {
    const byKey = {};
    for (const { key, lang } of enFallbacks) (byKey[key] = byKey[key] || []).push(lang);
    log(c.yellow, `\n需人工处理（两轮 API 均失败，已写英文兜底避免空白）：`);
    for (const [key, ls] of Object.entries(byKey)) {
      log(c.yellow, `  • ${namespace}.${key} → ${ls.join(", ")}`);
    }
  }
  log(c.green, `\n✨ 完成！\n`);
}

main().catch((err) => {
  console.error(`\n❌ 错误: ${err.message}`);
  process.exit(1);
});
