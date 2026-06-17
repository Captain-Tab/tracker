#!/usr/bin/env node
/**
 * 扫描未翻译文案（soso-translation 自包含版，零项目依赖）
 *
 * 轻量正则自检，覆盖：
 *   - sonner toast / notify 双轨
 *   - JSX 属性 / Modal options（含 label，覆盖静态常量盲区）
 *   - 三元字符串
 *   - logic return 英文（盲区①：containers/*.ts return "..."）
 *   - JSX 文本节点（盲区②：私有子组件 <Tag>Text</Tag>）
 *
 * 召回有限（不懂 AST），仅作「编辑当下预警」。IGNORE 规则与可翻译属性白名单全部内联，
 * 不再 require 项目 scripts/i18n/config.*。
 *
 * 用法：
 *   node scan-untranslated.cjs <file_or_dir>
 */

const fs = require("fs");
const path = require("path");

// 内联：可翻译 JSX 属性名
const TRANSLATABLE_JSX_ATTR_NAMES = [
  "title", "description", "label", "placeholder", "tips", "tooltip", "message",
  "emptyText", "confirmText", "cancelText", "okText", "loadingText",
  "successMessage", "errorMessage", "aria-label",
];

// 内联：忽略文本 / 正则
const IGNORE_TEXTS = ["...", "OK", "ID", "URL", "API", "FAQ"];
const IGNORE_REGEXES = [
  /^[A-Z_]+$/,                       // 全大写常量
  /^\d+$/,                           // 纯数字
  /^https?:\/\//,                    // URL
  /^[a-z]+:[a-z]/i,                  // namespace:key
  /^#[0-9a-fA-F]{3,8}$/,            // 颜色
  /^0x/i,                            // 地址
  /^[A-Z][a-z]+(?:[A-Z][a-z]+)+$/,  // PascalCase 组件名
  /^[a-z]+(?:[A-Z][a-z]+)+$/,       // camelCase 变量名
  /\.[a-z0-9]{2,4}$/i,             // 文件名后缀（无空格时）
];

let WHITELIST = [];
try { WHITELIST = require("./whitelist.cjs"); } catch {}

const ROOT_DIR = process.cwd();
const colors = { reset: "\x1b[0m", green: "\x1b[32m", yellow: "\x1b[33m", red: "\x1b[31m", cyan: "\x1b[36m", dim: "\x1b[2m" };
function log(color, ...a) { console.log(color, ...a, colors.reset); }

const ignoreTextsLower = new Set(IGNORE_TEXTS.map((t) => String(t).toLowerCase()));
function isIgnoredText(text) {
  const s = String(text || "").trim();
  if (!s) return true;
  if (ignoreTextsLower.has(s.toLowerCase())) return true;
  // 文件名后缀规则仅在无空格时生效
  for (const re of IGNORE_REGEXES) {
    if (re === IGNORE_REGEXES[IGNORE_REGEXES.length - 1] && /\s/.test(s)) continue;
    if (re.test(s)) return true;
  }
  for (const item of WHITELIST) {
    if (item instanceof RegExp ? item.test(s) : s === item) return true;
  }
  if (!/[A-Za-z]{3,}/.test(s)) return true; // 必须含 ≥3 字母英文词
  return false;
}

function isLineWrappedByT(line) {
  if (/\bt\s*\(\s*[`'"]/.test(line)) return true;
  if (/\bTrans\b[^>]*\bi18nKey\s*=/.test(line)) return true;
  if (/\bi18nKey\s*=\s*[`'"]/.test(line)) return true;
  if (/\bi18n\.t\s*\(\s*[`'"]/.test(line)) return true;
  return false;
}

const SCAN_RULES = [
  { name: "sonner toast", pattern: /\btoast(?:\.(?:success|error|info|warning|loading|message|promise))?\s*\(\s*[`'"]([^`'"]+)[`'"]/g },
  { name: "notify", pattern: /\bnotify\.(?:success|error|warning|loading|info)\s*\(\s*[`'"]([^`'"]+)[`'"]/g },
  { name: "Modal options", pattern: /\b(?:title|description|secondTitle|step2Text|reason|message|content|label)\s*:\s*[`'"]([^`'"]+)[`'"]/g },
  { name: "logic return 英文", pattern: /\breturn\s+[`'"]([A-Z][A-Za-z][A-Za-z0-9\s.,!?'"()\-:;{}]{2,})[`'"]/g },
  { name: "JSX 文本节点", pattern: />([A-Z][a-z][A-Za-z0-9 .,!?'"()\-:;]{2,})</g },
  {
    name: "JSX prop",
    buildPattern: () => {
      const names = TRANSLATABLE_JSX_ATTR_NAMES.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
      return new RegExp(`\\b(?:${names})\\s*=\\s*\\{?\\s*[\`'"]([^\`'"]+)[\`'"]`, "g");
    },
  },
  { name: "三元字符串", pattern: /[?:]\s*[`'"]([A-Z][A-Za-z][A-Za-z\s.,!?'"()\-:;]{2,})[`'"]/g },
];

function compilePattern(rule) {
  if (rule.pattern) return rule.pattern;
  if (rule.buildPattern) return rule.buildPattern();
  return null;
}

function scanFile(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split(/\r?\n/);
  const findings = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line || /^\s*\/\//.test(line) || /^\s*\*/.test(line)) continue;
    if (isLineWrappedByT(line)) continue;
    for (const rule of SCAN_RULES) {
      const pattern = compilePattern(rule);
      if (!pattern) continue;
      pattern.lastIndex = 0;
      let m;
      while ((m = pattern.exec(line)) !== null) {
        const text = m[1];
        if (isIgnoredText(text)) continue;
        if (findings.some((f) => f.line === i + 1 && f.scene === rule.name && f.text === text)) continue;
        findings.push({ line: i + 1, scene: rule.name, text });
      }
    }
  }
  return findings;
}

function isCodeFile(name) { return /\.(tsx?|jsx?)$/.test(name) && !name.endsWith(".d.ts"); }

function collectFiles(target) {
  const stat = fs.statSync(target);
  if (stat.isFile()) return isCodeFile(target) ? [target] : [];
  const out = [];
  const stack = [target];
  while (stack.length) {
    const dir = stack.pop();
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.name.startsWith(".")) continue;
      if (["node_modules", "__fixtures__", "__tests__", "stories"].includes(ent.name)) continue;
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) stack.push(abs);
      else if (isCodeFile(ent.name)) out.push(abs);
    }
  }
  return out;
}

function printReport(filePath, findings) {
  const rel = path.relative(ROOT_DIR, filePath);
  if (findings.length === 0) { log(colors.green, `✅ ${rel}：无遗漏`); return; }
  log(colors.yellow, `\n⚠️  ${rel}：发现 ${findings.length} 处可疑硬编码文案`);
  console.log("\n| Line | 场景 | 内容 |");
  console.log("|------|------|------|");
  for (const f of findings) {
    const text = f.text.length > 60 ? f.text.slice(0, 57) + "..." : f.text;
    console.log(`| ${f.line} | ${f.scene} | ${JSON.stringify(text)} |`);
  }
  console.log("");
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    log(colors.cyan, "\n📚 扫描未翻译文案（自包含）");
    log(colors.dim, "用法: node scan-untranslated.cjs <file_or_dir>");
    process.exit(1);
  }
  const target = path.resolve(args[0]);
  if (!fs.existsSync(target)) { log(colors.red, `❌ 路径不存在: ${target}`); process.exit(1); }
  const files = collectFiles(target);
  if (files.length === 0) { log(colors.yellow, "⚠️  未找到 .ts/.tsx/.js/.jsx 文件"); return; }
  log(colors.cyan, `\n🔍 扫描 ${files.length} 个文件...\n`);
  let total = 0, dirty = 0;
  for (const f of files) {
    const findings = scanFile(f);
    if (findings.length) { dirty++; total += findings.length; }
    printReport(f, findings);
  }
  console.log("");
  if (total === 0) log(colors.green, `✨ 全部通过：${files.length} 个文件，0 处遗漏`);
  else {
    log(colors.yellow, `📊 汇总：${dirty}/${files.length} 个文件含可疑文案，共 ${total} 处`);
    log(colors.dim, "提示：本扫描召回有限，PR 前请用 /check-i18n（若项目有）做最终验收。");
  }
}

main();
