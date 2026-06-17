---
name: fix-i18n
description: |
  根据 .i18n-check/*.md 报告交互式修复 i18n 问题。支持参数：模块名、目录路径、文件路径、或 fuzzy 文件名片段。
  ACTIVATE 当用户输入 /fix-i18n、/fix-i18n <module>、/fix-i18n <dir>、/fix-i18n <file>、或在 check 完成后想自动应用修复时。
  按 Auto / Confirm / Skip 三档处理；新增翻译用 Sonnet 4.6 翻译到所有目标语言。
---

# Fix i18n

读 `.i18n-check/*.md` 报告，分类修复命中项。**前台可见**地落每一处改动。

## 入口参数

| 调用                 | 行为                                                                               |
| -------------------- | ---------------------------------------------------------------------------------- |
| `/fix-i18n`          | 处理所有 `.i18n-check/*.md`（README 除外）                                         |
| `/fix-i18n <module>` | 仅处理 `.i18n-check/<module>.md`（如 `auth`、`shared`、`vault`）                   |
| `/fix-i18n <dir>`    | **仅处理该目录下文件的命中**（子目录递归包含）                                     |
| `/fix-i18n <file>`   | **仅处理该文件的命中**（其他文件不动）。`<file>` 支持完整路径或文件名片段（fuzzy） |

### `<arg>` 参数识别规则

按优先级判断（先做 FS 检测，可识别有/无尾斜杠的目录）：

1. **以 `/` 结尾** 或 **FS 检测为目录**：视为目录前缀，过滤 `hit.file` 以该路径开头
2. **以 `.ts` / `.tsx` 结尾**：视为文件名
3. **含 `/`（且 FS 检测非目录）**：视为文件路径
4. **完全匹配已知模块名** (`auth` / `shared` / `app` / `misc` / `vault` / `trade` / ...)：视为模块
5. **其他**：视为 fuzzy 文件名片段，在 `.i18n-check/*.md` 报告里搜文件路径包含该片段的命中

示例：

```
/fix-i18n trade
  → 处理 trade.md 全部命中

/fix-i18n src/features/trade/components/PositionTabs/
  → 仅处理该子目录下所有文件的命中（子目录递归包含）

/fix-i18n src/features/trade/components/PositionTabs
  → 同上（FS 检测目录，无需尾斜杠）

/fix-i18n src/features/trade/containers/positionTabsLogic.ts
  → 在所有模块报告里搜该 file 的命中并处理

/fix-i18n positionTabsLogic
  → fuzzy 匹配：搜文件路径含 "positionTabsLogic" 的命中

/fix-i18n positionTabsLogic.ts
  → 同 fuzzy（也走 .ts 路径）
```

### 文件 / 目录参数下的工作流调整

- **0 步前置**：先解析 `<arg>` 类型（FS 检测 + 后缀判断），确定过滤策略
- **1 步分类**：从所有 `.i18n-check/*.md` 中只挑出匹配范围的命中（其他全跳过）
- **目录归一**：若目录正好对应某 module 顶层（如 `src/features/trade/`），等价 `/fix-i18n trade`
- **若 0 命中**：打印"该文件/目录无 i18n 命中"并退出，不创建空白结果
- **若多模块匹配**：合并所有匹配的命中（如 `src/shared/` 跨多个模块时）

## 工作流（必须按顺序执行）

### 0. 前置检查 + 入参解析

- 验证 `.i18n-check/README.md` 存在；不存在则提示用户先跑 `pnpm i18n:auto_check`
- 解析 `<arg>`（按上述识别规则确定类型 = 模块 / 目录 / 文件 / fuzzy / 空）：
  - **模块名** → 验证 `.i18n-check/<module>.md` 存在
  - **目录前缀** → 用 `fs.statSync(<arg>).isDirectory()` 确认；归一化为以 `/` 结尾的路径用于 `startsWith` 过滤；读所有 `.i18n-check/*.md`，后续按文件路径前缀过滤
  - **文件路径 / fuzzy** → 读所有 `.i18n-check/*.md`（不含 README/\_parity/\_keyrefs），后续按文件过滤
  - **无参数** → 读所有 `.i18n-check/*.md`
- 读 `.i18n-check/_parity.md`（若存在）→ 解析跨 locale 缺失/空值清单
  - **若 `<arg>` 是文件 / 目录参数**：只关心范围内涉及的 key（看不出 → 跳过 parity 队列）
  - **若 `<arg>` 是模块参数**：parity 全部入 Confirm
  - **无参数**：parity 全部入 Confirm

### 1. 读取报告并分类命中项

读对应模块的 `.md`（或全部 .md），把每条「命中」分到三档：

#### Auto（机械可自动改，直接 Edit 落地）

- **B1** — useEffect/useMemo/useCallback 等 deps 缺 `t`：直接在 deps 数组追加 `t`
- **A1 / A2 / A4 with existing key** — 报告 "建议修复" 已给出具体的 `t("ns:key")`，且该 key 已存在于 `public/locales/en/<ns>.json`
- **D1 — 顶层 `i18n.t` 但调用方已有 `useTranslation`** — 移到组件内 `useMemo([...], [t])`，并删除 `import i18n from "i18next"`（如未被其他处使用）

#### Confirm（需要新增翻译 key，先翻译再落地）

- **A1 / A2 / A4 without existing key** — 报告里"建议修复"提到要新增 key，或英文裸字符串无现成 key
- **A3 — 常量数组中的展示文案** — 改为 `getXxx(t)` 函数或 `useMemo([...], [t])`
- **A5 — 模板字符串拼接** — 改为 `t("k", { name })` + 占位符
- **D1 — 顶层 `i18n.t` 但调用方未引入 `useTranslation`** — 需要先引入 hook 再改

→ **批量翻译后逐项 Confirm**（见步骤 3）

#### Parity（跨 locale 缺失/空值，源自 `_parity.md`）

- 缺失 key（en 有但其他 locale 没条目）→ 先建议用户跑 `pnpm i18n --sync-all-by-en` 把 key 推到所有 locale（值为空）
- 空值（条目存在但 value === ""）→ 直接进入 Confirm 翻译队列
  - 待翻译条目: `{ key: "common:continue", en: "<en value>", targetLang: "zh", context: "（自动）跨 locale parity 修复" }`
  - 不需要新 key，仅填充已有空值
  - 翻译模型仍用 Sonnet 4.6
- 翻译完后写入对应 `public/locales/<lang>/<ns>.json`，**只覆盖该空值**，其他键不动

#### Skip（架构问题或判断题，仅列出供用户决策）

- **D2 误用** — 把翻译值当 reject reason / type discriminator（应改为稳定 enum，但需要确认上游 catch 分支）
- **modal title freeze** — `open*()` 工厂内 `i18n.t()` 取标题（需要 modalManager Shell 改造）
- **跨文件配置不一致** — 如 `LanguageSelector` 改了 lang code 但 `i18n` 配置 `supportedLngs` 未同步
- **C3 占位符不对应** — 需要确认是改源码还是改 JSON
- **报告中"上下文建议"节的所有项** — 都归入 Skip，列出文件:行号

### 2. 应用 Auto 类（无翻译需求）

对每个 Auto 项：

1. 读对应文件
2. 用 Edit 工具落地（exact match）
3. 在终端打印 `✓ <module>/<file>:<line> — <type>: <brief>`

### 3. 处理 Confirm 类（先批量翻译，再逐项落地）

#### 3a. 收集所有 Confirm 项的待翻译条目

构造数组：

```ts
[
  { hitId: "auth#5", key: "common:keep_trading_enabled_hint", en: "Keep trading enabled so you won't need to enable it again next time.", context: "对话框描述" },
  ...
]
```

key 命名规则（自行推断）：

- snake_case，全小写，≤ 40 字符
- namespace 选择：通用按钮/状态用 `common`；交易相关 `spot`；钱包/链上 `manual`；客服 `aicustomer`；其他参考 `public/locales/en/` 已有 namespace
- 优先用文本去掉标点的简短改写（如 "Keep trading enabled..." → `keep_trading_enabled_hint`）
- 若已有相似 key，用相似命名风格

#### 3b. 批量调用 Sonnet 4.6 翻译

用 Bash 调用 `claude -p`：

\`\`\`bash
claude -p --model claude-sonnet-4-6 --output-format json --permission-mode bypassPermissions <<'EOF'
任务：把英文 UI 文案翻译成多种语言。

源语言: en
目标语言: zh (简体中文), hk (繁體中文), ja (日本語), ko (한국어), ru (Русский), tr (Türkçe), vi (Tiếng Việt), de (Deutsch), es (Español), fr (Français)

待翻译条目：
<JSON 数组>

要求：

- 保留 {{...}} 占位符（如 {{address}}、{{count}}、{{name}}）原文不译
- 保留 markdown / HTML 标签（如 <a>、<strong>）原文不译
- 文案应符合各语言的习惯用法，按钮简洁、提示语自然
- 大小写遵循目标语言习惯（如英文标题大写在德语不一定保留）

返回严格 JSON（不带任何解释、不带 markdown fence），格式：
{
"<key>": {
"zh": "...", "hk": "...", "ja": "...", "ko": "...",
"ru": "...", "tr": "...", "vi": "...",
"de": "...", "es": "...", "fr": "..."
},
...
}
EOF
\`\`\`

> 一次跑完所有 Confirm 项，避免多次启动 Claude 的开销。

解析 JSON 结果。

#### 3c. 逐项询问用户后落地

对每个 Confirm 项，用 AskUserQuestion 展示：

```
[Confirm] auth/StaySignedInDialog/index.tsx:55
  原文: Keep trading enabled so you won't need to enable it again next time.
  新增 key: common:keep_trading_enabled_hint
  翻译预览（zh）: 保持交易功能启用，下次无需再次开启
  翻译预览（ja）: 取引を有効にしたままにすると、次回再度有効化する必要はありません
  ...

  ▢ 接受并落地（key + 10 语言翻译 + 改源码）
  ▢ 修改 key 名后落地
  ▢ 跳过
```

收到 "接受" 后：

1. 把 en 写入 `public/locales/en/<ns>.json`（按字母序插入）
2. 把 10 个翻译值写入对应 `public/locales/<lang>/<ns>.json`（按字母序）
3. Edit 源文件应用 `t("ns:key")` 替换

### 4. Skip 类汇总展示（不落地）

把 Skip 类按文件:行号列成一个 markdown 列表，让用户自己看：

```
## 待人工决策（共 N 项）

### 架构类
- src/features/.../X.tsx:42 — modal title freeze（4 处类似，建议统一改 modalManager Shell）
- src/features/.../Y.tsx:18 — `reject(t(...))` 把翻译值当 reject reason

### 占位符不一致 (C3)
- ...
```

### 5. 收尾

1. 全部 Auto + Confirm 落地后，跑 `pnpm i18n --sort` 把新加的 key 按字母序排好（已加但插入位置不严的情况）
2. 重新生成类型定义：`pnpm i18next-resources`（让 TS 类型识别新 key）
3. 打印总结：

```
✓ i18n 修复完成
  - Auto 落地: <X> 项
  - Confirm 落地: <Y> 项（含 <Z> 个新 key + 10 语言翻译）
  - Skip 待人工: <M> 项

下一步建议：
  - 跑 pnpm lint 验证
  - 启动 dev 跑过涉及组件
```

## 硬规则

- **不要批量自动改 Skip 类** — 一律列出待人工
- **新加 key 必须按字母序插入** — 找前后相邻的现有 key 用 Edit 精确插入；最后跑 `pnpm i18n --sort` 兜底
- **翻译失败不要回退到机器翻译占位** — Sonnet 调用失败则报错让用户重跑
- **占位符 `{{xxx}}` 必须保留**，不可被翻译；翻译后用 grep 校验
- **A4 中误把翻译值当 type discriminator 的（如 `parseAccount(from, t("common:spot"))`）一律 Skip**，不要自动改
- **`/fix-i18n` 不接受参数时不要默认全量** — 列出可修复模块让用户确认范围

### UI 文案 vs 业务标识判断（A3 / A4 误报防御）

字符串常量是否需要翻译，按 `docs/i18n.md` "F. 判断信号" 表逐项核对：

| 信号     | UI 文案（必须 t()）         | 业务标识（绝不翻译）         |
| -------- | --------------------------- | ---------------------------- |
| 类型     | `Record<K, string>`         | `Set<EnumKey>` / `EnumKey[]` |
| 变量名   | `*_LABELS` / `*_TEXT`       | `*_KEYS` / `*_TYPES`         |
| 值形态   | 大写带空格 `"Open Orders"`  | 小驼峰 `"openOrders"`        |
| 下游用法 | 渲染 / `record[k]` 取值显示 | `.has()` / 分支判断          |

**只要满足"业务标识"任一硬信号（如 `Set<EnumKey>` 类型 + 小驼峰值），无论 AI 报告里怎么标注，都判 Skip 不动。**

### `xxxLogic.ts` 文件的 A3 特殊修复模式

按 CLAUDE.md §6，`xxxLogic.ts` **禁止 import `react`**，所以**不能**在文件内 `useTranslation()` / `useMemo([t])`。

A3 修复必须改为"形参注入"模式：

1. 把 `const XXX_LABELS = {...}` 删除
2. 给消费它的导出函数签名加形参 `baseLabels: Record<K, string>`（或 `t: TFunction`）
3. 找到所有调用方（`grep` 该函数名），逐个改为传入 `useTranslation` + `useMemo([t])` 求值后的 labels

> **判定流程**：识别 A3 + 文件名以 `Logic.ts` 结尾 → 升级到 Confirm 类（不是 Auto），且修复涉及多文件（Logic + 1+ caller）。
> 完整范例见 `docs/i18n.md` "F. 判断信号" → "`xxxLogic.ts` 中的 A3 特殊修复模式"。

## 安全护栏

- 落地前若 `git status` 显示工作树有大量未保存改动，先警告用户
- 每个 Edit 都用 exact match，不用 replace_all（防止误伤同名字符串）
- 翻译写入 locale JSON 后立即 `JSON.parse(readFileSync(path))` 校验合法
