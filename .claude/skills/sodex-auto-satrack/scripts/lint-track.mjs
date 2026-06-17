#!/usr/bin/env node
// satrack 契约 lint —— 把 skill「硬约束自检」里可确定性化的部分变成机器门禁。
//
// 覆盖 4 类检查（全部零判断、纯静态）：
//   ① 列契约：每个 track() payload 的 key 必须 ∈ AllowedColumn（sample.json 列 − SystemColumn）
//   ② 内联字面量：禁止 track(name, 具名变量) 转发（会绕过 tsc excess-property check）
//   ③ manifest 计数：events/*.ts 顶部「· N 事件」必须等于文件内 track() 事件数
//   ④ 文档同步：events/*.ts 的每个事件名必须出现在 docs/track-events-inventory.md
//
// 语义判断（埋不埋 / 叫什么 / 带哪些维度）不在此，归 skill + 人。
// 退出码：0 = 全过；1 = 有 error。用法：node lint-track.mjs [项目根]

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT =
  process.argv[2] ??
  join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

const EVENTS_DIR = join(ROOT, "src/shared/track/events");
const SAMPLE = join(
  ROOT,
  "src/shared/track/__fixtures__/sensors-event-schema.sample.json",
);
const CONTRACT = join(ROOT, "src/shared/track/eventContract.ts");
const INVENTORY = join(ROOT, "docs/track-events-inventory.md");

const errors = [];
const warnings = [];
const err = (m) => errors.push(m);
const warn = (m) => warnings.push(m);

// ── AllowedColumn = sample.json keys − SystemColumn ──────────────
function loadAllowedColumns() {
  const sample = JSON.parse(readFileSync(SAMPLE, "utf8"));
  const sampleKeys = new Set(Object.keys(sample));
  const contract = readFileSync(CONTRACT, "utf8");
  // 抓 `type SystemColumn = ... ;` 段里所有字符串字面量
  const m = contract.match(/type\s+SystemColumn\s*=([\s\S]*?);/);
  if (!m) throw new Error("eventContract.ts 未找到 SystemColumn 定义");
  const systemCols = new Set(
    [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]),
  );
  const allowed = new Set([...sampleKeys].filter((k) => !systemCols.has(k)));
  return allowed;
}

// ── 深度感知：从 `(` 起匹配到配对 `)`，返回内部文本 ──────────────
function matchBalanced(src, openIdx) {
  let depth = 0;
  let str = null; // 当前所在字符串引号
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i];
    if (str) {
      if (c === "\\") i++;
      else if (c === str) str = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") str = c;
    else if (c === "(" || c === "{" || c === "[") depth++;
    else if (c === ")" || c === "}" || c === "]") {
      depth--;
      if (depth === 0) return { inner: src.slice(openIdx + 1, i), end: i };
    }
  }
  return null;
}

// ── 按顶层逗号切分（尊重括号 / 字符串）──────────────────────────
function splitTopLevel(s) {
  const parts = [];
  let depth = 0;
  let str = null;
  let last = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (str) {
      if (c === "\\") i++;
      else if (c === str) str = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") str = c;
    else if (c === "(" || c === "{" || c === "[") depth++;
    else if (c === ")" || c === "}" || c === "]") depth--;
    else if (c === "," && depth === 0) {
      parts.push(s.slice(last, i));
      last = i + 1;
    }
  }
  parts.push(s.slice(last));
  return parts;
}

// ── 从内联对象字面量取顶层 key（跳过 spread）────────────────────
function extractKeys(objText) {
  const inner = objText.trim().replace(/^\{/, "").replace(/\}$/, "");
  const keys = [];
  for (const entry of splitTopLevel(inner)) {
    const t = entry.trim();
    if (!t || t.startsWith("...")) continue;
    const m = t.match(/^("?)([$\w]+)\1\s*:/);
    if (m) keys.push(m[2]);
  }
  return keys;
}

// ── 解析一个 events 文件里的所有 track() 调用 ───────────────────
function parseTrackCalls(src, file) {
  const calls = [];
  const re = /saTrackService\.track\s*\(/g;
  let m;
  while ((m = re.exec(src))) {
    const openIdx = src.indexOf("(", m.index + "saTrackService.track".length);
    const bal = matchBalanced(src, openIdx);
    if (!bal) {
      err(`${file}: track() 括号未配对（解析失败，靠近偏移 ${m.index}）`);
      continue;
    }
    const args = splitTopLevel(bal.inner).map((a) => a.trim());
    const nameArg = args[0] ?? "";
    const nameMatch = nameArg.match(/^"([^"]+)"$/);
    const eventName = nameMatch ? nameMatch[1] : null;
    const payload = args[1];
    calls.push({ eventName, payload, raw: nameArg });
  }
  return calls;
}

// ── 主流程 ──────────────────────────────────────────────────────
let allowed;
try {
  allowed = loadAllowedColumns();
} catch (e) {
  console.error(`✗ 无法加载 AllowedColumn: ${e.message}`);
  process.exit(1);
}

const inventory = (() => {
  try {
    return readFileSync(INVENTORY, "utf8");
  } catch {
    err(`缺少 ${INVENTORY}（文档同步检查无法进行）`);
    return "";
  }
})();

const files = readdirSync(EVENTS_DIR).filter(
  (f) => f.endsWith(".ts") && f !== "index.ts" && f !== "types.ts",
);

const allEventNames = new Set();

for (const f of files) {
  const path = join(EVENTS_DIR, f);
  const src = readFileSync(path, "utf8");
  const calls = parseTrackCalls(src, f);

  // ③ manifest 计数
  const header = src.match(/·\s*(\d+)\s*事件/);
  const eventCountInFile = new Set(
    calls.map((c) => c.eventName).filter(Boolean),
  ).size;
  if (header) {
    const declared = Number(header[1]);
    if (declared !== eventCountInFile) {
      err(
        `${f}: manifest「· ${declared} 事件」与实际 track 事件数 ${eventCountInFile} 不符`,
      );
    }
  } else {
    warn(`${f}: 顶部缺少「· N 事件」manifest 计数行`);
  }

  for (const c of calls) {
    if (!c.eventName) {
      // 事件名非字符串字面量（动态拼名）——埋点不该动态拼名
      err(`${f}: track() 首参非字符串字面量（事件名应固定）：${c.raw}`);
      continue;
    }
    allEventNames.add(c.eventName);

    // ② 内联字面量
    if (c.payload !== undefined) {
      const p = c.payload.trim();
      if (!p.startsWith("{")) {
        err(
          `${f} [${c.eventName}]: payload 是变量转发「${p}」而非内联字面量 → 绕过列契约校验，改写成 track(name, { ... })`,
        );
        continue; // 变量转发无法静态取 key
      }
      // ① 列契约
      for (const key of extractKeys(p)) {
        if (!allowed.has(key)) {
          err(
            `${f} [${c.eventName}]: 列「${key}」不在 AllowedColumn（sample.json 无此列）`,
          );
        }
      }
    }

    // ④ 文档同步
    if (inventory && !inventory.includes(c.eventName)) {
      err(
        `${c.eventName}（${f}）未出现在 docs/track-events-inventory.md → 漏同步盘点文档`,
      );
    }
  }
}

// ── 报告 ────────────────────────────────────────────────────────
console.log(
  `satrack-lint: 扫描 ${files.length} 个 events 文件，${allEventNames.size} 个事件，AllowedColumn ${allowed.size} 列`,
);
for (const w of warnings) console.log(`  ⚠ ${w}`);
if (errors.length === 0) {
  console.log("✓ 契约 / 内联 / 计数 / 文档同步 全部通过");
  process.exit(0);
}
console.error(`✗ ${errors.length} 个问题：`);
for (const e of errors) console.error(`  - ${e}`);
process.exit(1);
