---
name: soso-translation
description: "通用 i18n 自动翻译工具（自包含，零项目脚本依赖）。适用 sodex-web / sodex-next / exp-ads-feature 等任何带 locales 目录的项目。Use when adding/modifying i18n keys, translating locale files, or working with public/locales / public/assets/locales in any supported project."
license: MIT
metadata:
  author: soso-kit
  version: "1.0.0"
  project: universal
---

# 通用 i18n 自动翻译工具

把「加 key → 同步结构 → 翻译全语言 → 漏翻自检」串成自动流程。**完全自包含**：翻译 API、规则、布局解析全部内置，不依赖任何项目的 `scripts/i18n/*` 或 `pnpm i18n` / `soso-i18n` CLI。

> 合并自旧的 `soso-translation-auto`（sodex-web）+ `soso-translation-next`（sodex-next），新增对 exp-ads-feature（monorepo）等任意项目的通用支持。

---

## 一、布局配置（项目首次自动探测，之后复用）

不同项目的 locales 路径 / 源码结构 / namespace 映射不同，统一由配置驱动。

**配置存放在 soso-kit 源仓内**（看得见、可管理、活过 `sosokit-install`）：

```
<soso-kit 源仓>/.claude/skills/soso-translation/projects/<项目名>.json
```

每次执行前，`resolve-config.cjs` 自动：
1. 反查 soso-kit 源仓根（`sosokit-install` 软链 / `SOSO_KIT_ROOT` env）
2. 识别当前项目名（git 主仓 basename → package.json → cwd）
3. 读 `projects/<项目名>.json`；**不存在则探测目录布局并写入**，提示你 review namespace 映射

```bash
# 查看当前项目解析到的布局
node .claude/skills/soso-translation/scripts/resolve-config.cjs

# 强制重新探测（目录结构变了）
node .claude/skills/soso-translation/scripts/resolve-config.cjs --reinit
```

### 配置结构

```jsonc
{
  "version": 1,
  "projectName": "exp-ads-feature",
  "targets": [                              // monorepo 多 app；单仓只有一个
    {
      "name": "web",
      "localesDir": "apps/web/public/assets/locales",
      "srcDir": "apps/web/src",
      "namespaceRoots": ["features"],        // 这些目录的子目录 = ns 候选
      "namespaceMap": {                      // 路径前缀 → ns 的显式覆盖
        "features/ads-center": "ads-center",
        "features/auth": "common"
      },
      "fallbackNamespace": "common",
      "manualNamespaces": []                 // 只能手工加 key、不参与自动映射的 ns
    }
  ]
}
```

> **目标语言不写进配置**，每次扫 `localesDir` 子目录（除 en）动态获取——各项目语言集差异（如 landing 有 pt、web 有 de/ko）天然适配，永不过期。

### namespace 解析规则（AI 据此为修改文件定 ns）

给定修改文件相对 `srcDir` 的路径：
1. 命中 `namespaceMap` 的最长前缀 → 用映射值
2. 否则取 `namespaceRoots/<子目录>` 的子目录名作为 ns（前提：`en/<子目录>.json` 存在）
3. 都不命中 → `fallbackNamespace`
4. 复杂 HTML/Trans 富文本 → 归 `manualNamespaces` 中的 `manual`（若有）

---

## 二、核心工作流（加文案，最常用）

> 收到「加这条文案 / 翻译」指令时执行。仅依赖 skill 自带脚本。

```
步骤 1：确定 ns —— 按上面「namespace 解析规则」对照配置（注意 ns 名 ≠ 目录名，例 sodex-next features/trade → spot）

步骤 2：编辑 en 源文件，添加 snake_case 英文 key
        <localesDir>/en/<ns>.json
        - key 命名见「Key 命名规范」
        - 含变量用 {{variable}}（语义化驼峰，禁止 {{a}}）
        - 复杂 HTML 结构归 manual ns

步骤 3：同步 key 结构到所有语言（占位，不翻译）
        node .claude/skills/soso-translation/scripts/sync-keys.cjs <ns>
        # monorepo: 加 --target <web|landing>

步骤 4：翻译这一条 key（三层 fallback：主 API → Google → en 兜底）
        node .claude/skills/soso-translation/scripts/translate-keys.cjs <ns> <key1> [key2]...
        # monorepo: 加 --target <name>

步骤 5：漏翻自检（feature 根目录，覆盖未改动的兄弟文件）
        node .claude/skills/soso-translation/scripts/scan-untranslated.cjs <feature 根目录>

步骤 6：源码使用 t() 引用
        const { t } = useTranslation(["<ns>", ...])
        t("<ns>:<key>", { variable: value })

步骤 7：输出检查报告（见下方格式）
        若项目自带 i18n 类型生成 / check 命令，提示用户 PR 前自行运行（skill 不依赖它们）
```

> **批量替换硬编码**：旧 skill 依赖项目 CLI 的 `--replace`（AST 重写）。本通用版不内置 AST，改由 **AI 直接编辑源码**把硬编码字符串换成 `t()` 调用（顺带选对 ns、查重避免同义 key），再走步骤 2-5。

---

## 三、翻译前置约束（强制）

执行任何翻译前**必须依次读取**：

1. **[references/glossary.md](./references/glossary.md)** — 术语规定译法（必须使用，不可自译）
2. **[scripts/whitelist.cjs](./scripts/whitelist.cjs)** — 不翻译词表（品牌、代币符号、版本号正则）
3. **[references/specification.md](./references/specification.md)** — 完整性检查规范

关键规则：
- glossary 规定译法的术语**必须使用规定译法**
- whitelist 词汇**保持原文**
- 时间范围（24H/7D/30D/All-time）按 glossary 规定翻译
- `{{variable}}` / `<span>` 等占位符 / HTML 标签**保持完整**（脚本已自动保护 `{{var}}`）

---

## 四、翻译能力（自包含三层 fallback）

`translate-keys.cjs` 内置完整 fallback，AI 不需手动重试：

| 层 | 来源 | 触发 |
|---|---|---|
| L1 主 API | SosoValue Gemini（`prod-ai-simple-translate.sosovalue.io`，内联） | 默认 |
| L2 Google | 直连 `translate.googleapis.com` | L1 同源/抛错/字符集校验失败/语言不支持 |
| L3 英文兜底 | 直接写 en 原文（避免界面空白，报告中标注） | L2 仍失败 |

附加机制（全部内联，零项目依赖）：
- **同源检测**：返回 = 输入原文 → 视为失败进重试
- **字符集校验**：ja/ko/ru/ar/th 检查目标字符是否存在
- **白名单 + shouldKeepText 前置过滤**：命中者直接同步 en，不调 API
- **`{{var}}` 占位符保护**：调 API 前替换为 token，还原后写回

---

## 五、Key 命名规范

格式：**全小写 snake_case**

| 类型 | 格式 | 示例 |
|---|---|---|
| UI 标签 | `<名词>_label` | `amount_label` |
| 按钮/动作 | `<动词>_<名词>` | `submit_order` |
| 标题 | `<名词>_title` | `deposit_title` |
| 提示 | `<名词>_hint` / `_placeholder` | `amount_hint` |
| 成功 | `<动作>_success` | `deposit_success` |
| 错误 | `<动作>_failed` / `<名词>_error` | `network_switch_failed` |
| 状态 | `<名词>_<状态>` | `order_pending` |
| 空态 | `<名词>_empty` | `history_empty` |

**避免重复**：加 key 前先 `grep -i "success\|complete\|done" <localesDir>/en/<ns>.json`，避免 `deposit_success / deposit_completed / deposit_done` 同义堆叠。

---

## 六、Trans 组件（含 HTML / 多变量）

复杂结构归 `manual` ns：

```tsx
import { Trans, useTranslation } from "react-i18next";
const { t } = useTranslation(["spot", "common", "manual"]);

<Trans
  t={t}
  i18nKey="manual:deposit_at_least"
  components={{ span: <span className="text-status-up" /> }}
  values={{ amount: "10", coin: "USDT" }}
/>
```
对应 `en/manual.json`：
```json
{ "deposit_at_least": "Deposit at Least <span>{{amount}} {{coin}}</span>." }
```
要点：必须传 `t`；`i18nKey` 带 namespace；`{{var}}` / HTML 标签翻译时保持完整。

---

## 七、三类历史盲区（scan 已自动覆盖）

| 盲区 | 示例 | 修复原则 |
|---|---|---|
| ① 逻辑文件返回英文 | `containers/xxxLogic.ts` 中 `return "Minimum withdraw is X"` | logic 返回错误码结构体，由 container hook 翻译，**别把 `t` 传进 logic** |
| ② 私有子组件 JSX 文本 | `<div>Total Deposits</div>` | 直接给子组件加 `useTranslation`，不通过父组件传参 |
| ③ 静态常量 label | `const TABS = [{ label: "TVL" }]` | 移入组件内 `useMemo([t])` 动态生成 |

---

## 八、检查报告格式（流程末尾必须输出）

```markdown
## 翻译检查报告

**扫描范围**：<file_or_dir>
**扫描结果**：✅ 无遗漏 / ⚠️ 发现 N 处

| Line | 场景 | 内容 |
|------|------|------|
| 45 | sonner toast | "Loading..." |
| 78 | JSX placeholder | "Enter amount" |
```

---

## 九、命令清单（速查）

```bash
# 布局：查看 / 重探
node .claude/skills/soso-translation/scripts/resolve-config.cjs [--reinit] [--json]

# 同步 key 结构（替代 pnpm i18n --sync-by-en）
node .claude/skills/soso-translation/scripts/sync-keys.cjs [--target <name>] <ns> [--prune]
node .claude/skills/soso-translation/scripts/sync-keys.cjs --all [--target <name>]

# 翻译指定 key（自包含三层 fallback）
node .claude/skills/soso-translation/scripts/translate-keys.cjs [--target <name>] <ns> <key1> [key2]...

# 漏翻扫描
node .claude/skills/soso-translation/scripts/scan-untranslated.cjs <file_or_dir>

# 绕过配置直接指定 locales 目录（任意项目应急用）
node .../translate-keys.cjs --locales-dir <abs-locales-dir> <ns> <key>
```

---

## 十、新增 Namespace

1. `echo "{}" > <localesDir>/en/<new-ns>.json`
2. `node .../sync-keys.cjs <new-ns>`（建各语言空文件）
3. 在项目 i18n 初始化代码（`src/i18n.ts` 等）的 ns 数组注册 `<new-ns>`
4. 若该 ns 对应新源码目录，更新 `projects/<项目>.json` 的 `namespaceMap`
5. 项目若有 TS 类型生成命令，提示用户运行

---

## 参考文档

| 文件 | 用途 | 时机 |
|---|---|---|
| [references/glossary.md](./references/glossary.md) | 术语词汇表 | **翻译前必读** |
| [scripts/whitelist.cjs](./scripts/whitelist.cjs) | 不翻译词表 | **翻译前必读** |
| [references/specification.md](./references/specification.md) | 完整性检查规范 | 翻译完成后 |
| [references/i18n-sop.md](./references/i18n-sop.md) | 翻译 SOP | 完整流程参考 |
| [references/translate-api.md](./references/translate-api.md) | 翻译 API 背景（旧版，仅参考） | 排查翻译问题时 |
| `projects/<项目>.json` | **本项目布局 SSOT** | 每次流程自动读取 |
