#!/usr/bin/env node
/**
 * 同步 key 结构（soso-translation 自包含版，替代 pnpm i18n --sync-by-en）
 *
 * 以 en/<ns>.json 为准，给所有目标语言补齐缺失 key（占位英文原文，待 translate-keys 覆盖），
 * 可选 --prune 删除各语言中 en 已不存在的孤儿 key。不调用任何项目脚本。
 *
 * 用法：
 *   node sync-keys.cjs [--target <name>] [--locales-dir <abs>] <namespace> [--prune]
 *   node sync-keys.cjs --all [--target <name>]            # 遍历该 target 下所有 ns
 */

const fs = require("fs");
const path = require("path");

let resolver = null;
try {
  resolver = require("./resolve-config.cjs");
} catch {}

const c = { reset: "\x1b[0m", green: "\x1b[32m", yellow: "\x1b[33m", blue: "\x1b[34m", dim: "\x1b[2m" };
const log = (color, msg) => console.log(`${color}${msg}${c.reset}`);

function readJson(fp) {
  if (!fs.existsSync(fp)) return {};
  const raw = fs.readFileSync(fp, "utf8");
  if (!raw.trim()) return {};
  try { return JSON.parse(raw); } catch { return null; }
}
function writeSortedJson(fp, data) {
  const dir = path.dirname(fp);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const sorted = Object.keys(data).sort((a, b) => a.localeCompare(b)).reduce((o, k) => ((o[k] = data[k]), o), {});
  fs.writeFileSync(fp, JSON.stringify(sorted, null, 2) + "\n", "utf8");
}

function resolveLayout(args) {
  const ldIdx = args.indexOf("--locales-dir");
  if (ldIdx >= 0) {
    const localesAbs = path.resolve(args[ldIdx + 1]);
    args.splice(ldIdx, 2);
    const langs = fs.readdirSync(localesAbs, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name !== "en").map((d) => d.name).sort();
    return { localesAbs, langs };
  }
  let targetName = null;
  const tIdx = args.indexOf("--target");
  if (tIdx >= 0) { targetName = args[tIdx + 1]; args.splice(tIdx, 2); }
  if (!resolver) throw new Error("resolve-config.cjs 不可用，请用 --locales-dir 显式指定");
  const r = resolver.loadOrDetect({});
  const target = resolver.pickTarget(r.config, targetName);
  if (!target) throw new Error(`多 target，请用 --target 指定: ${(r.config.targets || []).map((t) => t.name).join(", ")}`);
  const localesAbs = path.join(r.projectRoot, target.localesDir);
  const langs = resolver.listTargetLangs(r.projectRoot, target);
  return { localesAbs, langs };
}

function syncOne(localesAbs, langs, ns, prune) {
  const enJson = readJson(path.join(localesAbs, "en", `${ns}.json`));
  if (enJson === null) { log(c.yellow, `⚠️  en/${ns}.json 解析失败，跳过`); return { added: 0, pruned: 0 }; }
  const enKeys = Object.keys(enJson);
  let added = 0, pruned = 0;
  for (const lang of langs) {
    const fp = path.join(localesAbs, lang, `${ns}.json`);
    const data = readJson(fp);
    if (data === null) { log(c.yellow, `⚠️  ${lang}/${ns}.json 解析失败，跳过`); continue; }
    let changed = false;
    for (const k of enKeys) {
      if (!(k in data)) { data[k] = enJson[k]; added++; changed = true; } // 占位英文，待翻译覆盖
    }
    if (prune) {
      for (const k of Object.keys(data)) {
        if (!(k in enJson)) { delete data[k]; pruned++; changed = true; }
      }
    }
    if (changed || !fs.existsSync(fp)) writeSortedJson(fp, data);
  }
  return { added, pruned };
}

function main() {
  const args = process.argv.slice(2);
  const prune = args.includes("--prune");
  if (prune) args.splice(args.indexOf("--prune"), 1);
  const all = args.includes("--all");
  if (all) args.splice(args.indexOf("--all"), 1);

  let localesAbs, langs;
  try { ({ localesAbs, langs } = resolveLayout(args)); }
  catch (e) { log(c.yellow, `\n❌ ${e.message}`); process.exit(1); }

  let namespaces;
  if (all) {
    const enDir = path.join(localesAbs, "en");
    namespaces = fs.readdirSync(enDir).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));
  } else {
    if (!args[0]) { log(c.yellow, "❌ 缺少 namespace（或用 --all）"); process.exit(1); }
    namespaces = [args[0]];
  }

  log(c.blue, `\n🔄 同步 key 结构  locales=${localesAbs}  langs=${langs.length}  prune=${prune}`);
  let totalAdded = 0, totalPruned = 0;
  for (const ns of namespaces) {
    const { added, pruned } = syncOne(localesAbs, langs, ns, prune);
    totalAdded += added; totalPruned += pruned;
    log(c.dim, `  • ${ns}: +${added} key${prune ? ` / -${pruned}` : ""}`);
  }
  log(c.green, `\n✨ 完成：补齐 ${totalAdded} key${prune ? ` / 删除 ${totalPruned} 孤儿` : ""}\n`);
}

main();
