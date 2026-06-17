---
description: 差量更新已有 Context 文档（保留人工内容）
---

# Context Update

## 用户输入（Feature ID）

```text
$ARGUMENTS
```

---

## Step 0: 初始化

`UPDATE_FEATURE_ID` = `$ARGUMENTS`

**使用 Bash 工具**找到 KIT_ROOT：

```bash
dir=$(pwd); KIT_ROOT=""; for i in 1 2 3 4 5; do [ -d "$dir/.claude/kit/context/library" ] && KIT_ROOT="$dir" && break; dir="$(dirname "$dir")"; done && echo "KIT_ROOT=$KIT_ROOT"
```

若 KIT_ROOT 为空，输出 `❌ 未找到 context library，请确认 .cursor 目录已同步` 后结束。

**使用 Bash 工具**校验权限：

```bash
source "$KIT_ROOT/.claude/kit/context/context-lib.sh"
init_context_config

if ! check_write_permission; then
    echo "❌ 只读模式：请在 soso-kit 主仓库中执行"
    exit 1
fi

if [ "$PROJECT_NAME" = "soso-kit" ]; then
    export PROJECT_NAME=sodex-web
    export CONTEXT_PROJECT_DIR="$CONTEXT_LIBRARY_DIR/sodex-web"
    export CONTEXT_INDEX_FILE="$CONTEXT_PROJECT_DIR/context-index.json"
fi
```

---

## ⚠️ 执行契约（开始前确认）

本命令必须完成以下全部操作，**缺一不可**：

- [ ] Step 4: 更新 reference 文档（含 4d 写入前骨架校验，结构漂移须拒绝定稿）
- [ ] Step 5: 更新 router JSON（含 updated 日期）
- [ ] Step 6: 写入 history 条目（markdown 文件 + JSON 条目，含 sections/symbols 结构化字段）
- [ ] Step 7: 更新 indexes
- [ ] Step 8: 输出完成报告（含各步骤确认）

在输出 Step 8 之前，必须逐项确认以上步骤均已执行。

---

## Step 1: 加载 Context 元数据

**使用 Bash 工具**读取 router JSON：

```bash
FEATURE_JSON=""
ROUTER_FILE=""
for rf in "$CONTEXT_PROJECT_DIR/router/"*.json; do
    data=$(jq -c ".features[\"$UPDATE_FEATURE_ID\"] // empty" "$rf" 2>/dev/null)
    if [ -n "$data" ]; then
        FEATURE_JSON="$data"
        ROUTER_FILE="$rf"
        break
    fi
done

if [ -z "$FEATURE_JSON" ]; then
    echo "❌ 未找到 context: $UPDATE_FEATURE_ID"
    exit 1
fi

# 提取元数据 + sections（含 lineRange，供 Step 3/4 使用）
echo "$FEATURE_JSON" | jq '{
    title,
    summary,
    updated,
    "sections_count": (.sections | length),
    "sections": [.sections[] | {title, summary, lineRange, estimatedTokens}],
    "keyFiles": .quickRef.keyFiles,
    referencePath
}'
```

将以下变量记录在上下文中：
- `DOC_PATH` = `"$CONTEXT_PROJECT_DIR/" + referencePath`
- `TOTAL_SECTIONS` = sections_count
- `SECTIONS_LIST` = sections 数组（title + summary + lineRange）

> ⚠️ **不读取 reference 文档全文**。sections 的 title/summary 已足够 Step 3 评估，全文读取延迟到 Step 4 按需执行。

**检测 coreLogic 基线质量**：

```bash
CORE_LOGIC=$(echo "$FEATURE_JSON" | jq -r '.quickRef.coreLogic[]' 2>/dev/null | head -1)
if echo "$CORE_LOGIC" | grep -qE 'L[0-9]+-[0-9]+'; then
    CORELOGIC_QUALITY="high"
else
    CORELOGIC_QUALITY="low"
fi
echo "CORELOGIC_QUALITY=$CORELOGIC_QUALITY"
```

---

## Step 2: 获取变更描述

### 来源 A：由 audit 触发（`UPDATE_SOURCE=audit`）

```bash
UPDATED=$(echo "$FEATURE_JSON" | jq -r '.updated')
KEY_FILES=$(echo "$FEATURE_JSON" | jq -r '.quickRef.keyFiles[]')

TARGET_REPO=""
KIT_PARENT="$(cd "$KIT_ROOT/.." && pwd)"
for candidate in "$KIT_PARENT/sodex-web" "$HOME/Documents/code/sodex-web"; do
    [ -d "$candidate/.git" ] && TARGET_REPO="$candidate" && break
done

echo "📋 自 $UPDATED 以来的代码变更："
while IFS= read -r file; do
    [ -z "$file" ] && continue
    git -C "$TARGET_REPO" log --since="$UPDATED" --format="  %h %s" -- "$file" 2>/dev/null
done <<< "$KEY_FILES"
```

展示 commits，询问用户是否有额外说明，合并为 `CHANGE_DESC`。

### 来源 B：用户直接调用

询问用户：

```
请提供变更来源（任选其一）：
  1. spec 文档路径（如 .claude/specs/xxx.md）
  2. 直接描述变更内容
```

- 若输入为文件路径 → 用 **Read 工具**读取内容作为 `CHANGE_DESC`
- 否则 → 直接作为 `CHANGE_DESC`

---

## Step 2.5: Outline 扫描（零 AI token）

**使用 Bash 工具执行**：

```bash
bash "$KIT_ROOT/.claude/kit/context/action/update/scripts/scan-outline.sh" \
    "$UPDATE_FEATURE_ID"
```

将完整输出展示给用户（不做 AI 分析）。

**AI 对比符号变更**（基于脚本输出 vs `SECTIONS_LIST` 中记录的函数）：

| 变更类型 | 说明 |
|----------|------|
| ➕ 新增 | outline 中存在但文档未记录 |
| ➖ 删除 | 文档有记录但 outline 中已不存在 |
| ✏️ 修改 | 函数签名变化 |

> `CORELOGIC_QUALITY=low` 时：以 outline 当前状态为新基线，只识别删除和签名变化。

输出格式：

```
📊 Outline 符号变更
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  useDeposit.ts:
    ➕ normalizeCoinSymbol      L44
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
新增: <X>  删除: <X>  修改: <X>
```

记录 `OUTLINE_ADDED / OUTLINE_REMOVED / OUTLINE_MODIFIED`，将符号变更追加到 `CHANGE_DESC`。

---

## Step 3: 评估变更幅度（50% 阈值）

> ✅ **使用 `SECTIONS_LIST`（来自 router JSON）评估**，无需读取 reference 文档。
> 每个 section 的 title + summary 已足够判断变更是否涉及该章节。

对 `SECTIONS_LIST` 中每个 section，基于 `CHANGE_DESC` + outline 符号变更判断：
- `需要修改`：变更涉及该章节，或 outline 有新增/删除的符号属于该章节
- `无需修改`：变更与该章节无关

统计 `AFFECTED_SECTIONS` / `TOTAL_SECTIONS`，**记录每个受影响章节的 `lineRange`**（供 Step 4 局部读取使用）。

同时计算：
- `AFFECTED_TOKENS`：受影响章节 `estimatedTokens` 之和（实际读取消耗）
- `SAVED_TOKENS`：未读章节 `estimatedTokens` 之和（通过局部读取节省）

输出评估报告：

```
📊 变更幅度评估
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  总章节数    : <TOTAL_SECTIONS>
  受影响章节  : <AFFECTED_SECTIONS>
  变化幅度    : <百分比>%

  受影响章节列表（含行范围）：
    ✏️  <章节名> [L<start>-<end>] - <一句话说明变化>
    ✅  <章节名> - 无需修改
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**阈值判断：**
- 变化 ≤ 50% → 继续 Step 4
- 变化 > 50% → 提示用户改用 `learn` 完整重建，询问是否继续差量更新

---

## Step 4: 差量更新 Reference 文档

对每个标记为`需要修改`的章节，**按需局部读取后编辑**：

### 4a. 局部读取受影响章节

使用 **Read 工具**，传入 `offset` 和 `limit` 参数，只读取该章节内容：

```
offset = lineRange[0]       （章节起始行号）
limit  = lineRange[1] - lineRange[0] + 5   （多读 5 行防止边界截断）
```

> 仅读取受影响章节，跳过无需修改的章节，节省 token。

### 4b. 编辑章节内容

基于读取到的章节内容 + `CHANGE_DESC` + outline 符号信息，用 **Edit 工具**替换该章节。

**Outline 驱动的更新规则**：
- 新增函数 → 添加说明、参数、用途（使用 outline 行号格式 `L53-86`）
- 删除函数 → 移除相关描述
- 签名变化 → 更新参数列表、返回类型

保留所有`无需修改`章节的原文（包括人工注释）。

**⚠️ 完整块纪律（防改写丢内容）**：被修改章节必须输出**该章节的完整新内容**——先在 `old_string` 完整覆盖 4a 读取到的原文，再在其上增删；**禁止**用省略号 / `...（保持不变）` / 局部片段替换。本次变更未涉及的句子、人工注释、边界 case 说明必须**逐字保留**。

**行数兜底自检**：每个被修改章节 Edit 后，对比新内容行数与原 `lineRange` 跨度（`lineRange[1] - lineRange[0]`）。若本次**非删除型**变更却使章节显著缩短（新行数 < 原跨度 × 0.7）→ 视为疑似丢内容，回读原章节核对，确认确实是精简而非误删后才继续。

### 4c. 更新记录

在文档末尾的 `## 更新记录` 章节追加：

```markdown
### <YYYY-MM-DD>: <简要标题>

<变更说明>
```

### 4d. 写入前结构校验（防 AI 改坏文档骨架）

所有受影响章节 Edit 完成后、进入 Step 5 之前，校验文档骨架未被破坏。**使用 Bash 工具**拿改写后的章节标题集：

```bash
echo "📐 改写后章节标题："
grep "^## " "$DOC_PATH" | sed 's/^## //'
```

将输出与 `SECTIONS_LIST`（Step 1 记录的原标题集合）对比：

| 对比结果 | 判定 | 处理 |
|---------|------|------|
| 标题集合一致 | ✅ 骨架完好 | 继续 Step 5 |
| 出现非预期的**新增 / 消失**标题 | ⚠️ 结构漂移 | 多半是 Edit 误删 `## ` 标题或写错层级——**拒绝定稿**，回 4b 核对受影响章节，修复后重跑本步 |

> 例外：本次变更**显式**增删章节时，新标题集合即为预期，确认后继续。
> 此步只校验骨架（章节标题层级），不校验正文，零 AI token。

> ✅ Step 4 完成。**现在立即输出标题 `## 执行 Step 5：更新 Router JSON`，然后继续执行。**

---

## Step 5: 更新 Router JSON

### 5a. 重新扫描 sections lineRange

```bash
bash "$KIT_ROOT/.claude/kit/context/action/record/scripts/validate-sections.sh" \
    --doc-path "$DOC_PATH" \
    --fix > /tmp/sections_raw.json
```

读取 `/tmp/sections_raw.json`，按以下规则填写每个 section 的 `summary`（≤30字），用 **Write 工具**写入 `/tmp/sections_final.json`：

| 章节类型 | summary 来源 | 处理规则 |
|---------|------------|---------|
| 在 `AFFECTED_SECTIONS` 中 | Step 4b 已读取的当前内容 | **重新生成** |
| 不在 `AFFECTED_SECTIONS` 中 | `SECTIONS_LIST` 中的旧 summary | 核对旧 summary 是否仍准确（若引用了已变更符号或概念则重新生成；否则直接复用） |

> **复用条件**：旧 summary 不包含任何 `OUTLINE_ADDED / OUTLINE_REMOVED / OUTLINE_MODIFIED` 中变更的函数名或概念词 → 可安全复用，无需读取文档。

### 5b. 更新 router 字段

```bash
TODAY=$(date +%Y-%m-%d)

bash "$KIT_ROOT/.claude/kit/context/action/update/scripts/update-router-fields.sh" \
    --router-file "$ROUTER_FILE" \
    --feature-id "$UPDATE_FEATURE_ID" \
    --updated "$TODAY" \
    --sections-file /tmp/sections_final.json
    # 仅在有实际变化时追加：
    # --summary "<新摘要>"
    # --tags "<tag1,tag2,...>"
    # --core-logic "<逻辑1|逻辑2|...>"
    # --key-components "<组件1|组件2|...>"
    # --related-concepts "<概念1,概念2,...>"
```

> ✅ Step 5 完成后**立即继续 Step 6**。

---

## Step 6: 写入 History 条目

### 6a. 检查同日期文件

```bash
TODAY=$(date +%Y-%m-%d)
MODULE=$(echo "$FEATURE_JSON" | jq -r '.module')
HISTORY_DIR="$CONTEXT_PROJECT_DIR/history/${MODULE}/${UPDATE_FEATURE_ID}"
EXISTING_HISTORY=$(find "$HISTORY_DIR" -name "${TODAY}-*.md" 2>/dev/null | head -1)
echo "EXISTING_HISTORY=$EXISTING_HISTORY"
```

### 6b. 创建或追加 history 文件

**若同日期文件已存在**：用 **Edit 工具**追加 `## 追加变更` 章节。

**若不存在**：

```bash
HISTORY_SLUG="<slug>"   # 从变更标题生成，连字符，全小写
HISTORY_REL_PATH="history/${MODULE}/${UPDATE_FEATURE_ID}/${TODAY}-${HISTORY_SLUG}.md"
HISTORY_ABS_PATH="$CONTEXT_PROJECT_DIR/$HISTORY_REL_PATH"
mkdir -p "$HISTORY_DIR"
```

用 **Write 工具**写入新文件：

```markdown
# <变更标题>

**日期**: <TODAY> | **类型**: <feat|fix|refactor|docs> | **范围**: <module>

---

## 变更概述

<1-2 句话描述本次变更目标>

---

## 核心变更

### 1. <变更点>

**文件**: `<文件路径>`

<变更说明 + 关键代码片段>

---

## 文件变更列表

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `<path>` | 修改/新增/删除 | <说明> |

---

## 关联文档

- **Reference**: `.claude/kit/context/library/sodex-web/reference/<module>/<feature-id>-guide.md`
```

### 6c. 追加 JSON 条目（结构化）

先构造 section 级操作与 outline 符号 diff 两个临时文件——数据**直接复用前面算好的产物**，无需新计算：

- `sections`：来自 Step 3 的 `AFFECTED_SECTIONS`。每个受影响章节一条 `{title, op}`；`op` 取值——本次修改的现有章节为 `MODIFIED`，4d 中显式新增的章节为 `ADDED`，删除的为 `REMOVED`。
- `symbols`：来自 Step 2.5 的 `OUTLINE_ADDED / OUTLINE_REMOVED / OUTLINE_MODIFIED`。

用 **Write 工具**写入以下两个文件（内容为**纯 JSON，不含注释**）：

`/tmp/history_sections.json`：
```json
[{ "title": "数据获取", "op": "MODIFIED" }, { "title": "符号映射", "op": "ADDED" }]
```

`/tmp/history_symbols.json`：
```json
{ "added": ["normalizeCoinSymbol"], "removed": [], "modified": [] }
```

再调用脚本（结构化字段为可选，缺省即向后兼容）：

```bash
bash "$KIT_ROOT/.claude/kit/context/action/update/scripts/append-history.sh" \
    --router-file "$ROUTER_FILE" \
    --feature-id "$UPDATE_FEATURE_ID" \
    --date "$TODAY" \
    --type "<feat|fix|refactor|docs>" \
    --summary "<本次更新的简要说明，≤80字>" \
    --files "<受影响的 keyFiles 短名，逗号分隔>" \
    --history-path "$HISTORY_REL_PATH" \
    --sections-file /tmp/history_sections.json \
    --symbols-file /tmp/history_symbols.json
```

> 这样 history 条目除「改了哪些**代码文件**」外，还机器可查「动了哪些**文档 section**、加删了哪些**符号**」——支持「某 section 历来被哪几次变更动过」「某符号哪次引入」的溯源查询。

> ✅ Step 6 完成后**立即继续 Step 7**。

---

## Step 7: 更新索引

```bash
bash "$KIT_ROOT/.claude/kit/context/shared/update-indexes.sh" \
    --project "$PROJECT_NAME" \
    --feature-id "$UPDATE_FEATURE_ID"
```

---

## Step 8: 完成输出

在输出以下报告前，逐项确认各步骤已执行（未执行的步骤须立即返回补做）：

```
✅ Context 更新完成！
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Feature ID  : <UPDATE_FEATURE_ID>
  更新章节    : <AFFECTED_SECTIONS> / <TOTAL_SECTIONS>
  Outline 符号: ➕<OUTLINE_ADDED> ➖<OUTLINE_REMOVED> ✏️<OUTLINE_MODIFIED>

步骤确认：
  ✅ Step 4 reference 已更新 : <DOC_PATH>
  ✅ Step 5 router.json 已更新: updated = <TODAY>
  ✅ Step 6 history 已写入   : <HISTORY_ABS_PATH>
  ✅ Step 7 indexes 已更新（含一致性校验）

📊 Token 成本
  outline 扫描       : ~0 tokens（零消耗，shell 脚本）
  局部读取节省       : ~<SAVED_TOKENS> tokens（<TOTAL_SECTIONS - AFFECTED_SECTIONS> 章节未读取）
  受影响章节读取     : ~<AFFECTED_TOKENS> tokens（<AFFECTED_SECTIONS> 章节）
  AI 分析与写作      : ~<估算>
  ─────────────────────────────
  本次总计           : ~<后两项合计> tokens

验证：
  /k/context load <UPDATE_FEATURE_ID>
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```
