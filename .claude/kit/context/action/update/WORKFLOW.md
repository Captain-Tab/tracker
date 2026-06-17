---
description: 【已归档】更新已有 Context 文档（差量更新，保留人工内容）
---

# Update: 更新已有 Context（归档参考文件）

> ⚠️ **此文件已归档，不再作为运行时 prompt。**
> 完整工作流已内联至 `/commands/k/context-update.md`。
> 本文件仅作为历史记录和对照参考保留。

---

基于 spec 文档 / 用户 prompt / git commit 记录，对已有 context 进行差量更新。

> ⚠️ **强制完整执行**：所有 Step 0-8 必须按顺序执行完毕，不得在 Step 4 后停止。
> 更新 reference 文档只是中间步骤，**必须继续执行 Step 5（路由）、Step 6（历史）、Step 7（索引）**。

**Token 策略**：
- 变化 ≤ 50%：差量更新，只改动涉及的章节
- 变化 > 50%：建议改用 `learn` 完整重建，提示用户确认

**调用来源**：
- 用户直接调用：`/k/context update <feature-id>`
- `audit` 确认后触发：自动传入 `UPDATE_SOURCE=audit`

---

## Step 0: 环境准备与权限校验

```bash
source "$KIT_ROOT/.cursor/kit/context/context-lib.sh"
init_context_config

if ! check_write_permission; then
    echo "❌ 只读模式：请在 soso-kit 主仓库中执行"
    exit 1
fi

# 从 soso-kit 主仓库运行时修正 PROJECT_NAME
if [ "$PROJECT_NAME" = "soso-kit" ]; then
    export PROJECT_NAME=sodex-web
    export CONTEXT_PROJECT_DIR="$CONTEXT_LIBRARY_DIR/sodex-web"
    export CONTEXT_INDEX_FILE="$CONTEXT_PROJECT_DIR/context-index.json"
fi

if [ -z "$UPDATE_FEATURE_ID" ]; then
    echo "❌ 缺少参数: feature-id"
    echo "用法: /k/context update <feature-id>"
    exit 1
fi
```

---

## Step 1: 加载现有 Context

**使用 Bash 工具**读取 router JSON 中的 feature 完整数据：

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

# 提取关键字段
echo "$FEATURE_JSON" | jq '{
    title,
    summary,
    updated,
    "sections_count": (.sections | length),
    "keyFiles": .quickRef.keyFiles,
    referencePath
}'
```

再用 **Read 工具**读取 reference 文档全文：

```bash
REF_PATH=$(echo "$FEATURE_JSON" | jq -r '.referencePath')
DOC_PATH="$CONTEXT_PROJECT_DIR/$REF_PATH"
```

读取 `$DOC_PATH` 的完整内容（不截断）。

将当前 context 的章节数记为 `TOTAL_SECTIONS`。

**检测 coreLogic 基线质量**：

```bash
CORE_LOGIC=$(echo "$FEATURE_JSON" | jq -r '.quickRef.coreLogic[]' 2>/dev/null | head -1)
if echo "$CORE_LOGIC" | grep -qE 'L[0-9]+-[0-9]+'; then
    CORELOGIC_QUALITY="high"   # 含行号，来自 learn 或经过 outline 增强的 record
else
    CORELOGIC_QUALITY="low"    # 纯文本推断，来自未增强的 record
fi
```

若 `CORELOGIC_QUALITY=low`，在 Step 2.5 的符号比对中，以 outline **当前状态**作为新基线（所有现有函数视为"已确认存在"，不报告为新增），只关注真正的删除和签名变化。

---

## Step 2: 获取变更描述

### 来源 A：由 audit 触发（`UPDATE_SOURCE=audit`）

自动获取 git commits：

```bash
UPDATED=$(echo "$FEATURE_JSON" | jq -r '.updated')
KEY_FILES=$(echo "$FEATURE_JSON" | jq -r '.quickRef.keyFiles[]')

# 获取自 updated 以来的所有 commits
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

展示 commits 后，询问用户：

```
以上是自文档上次更新以来的代码变更。

是否有额外的修改说明？（可直接回车跳过）
```

等待用户回复，将 commits + 用户补充说明合并为 `CHANGE_DESC`。

### 来源 B：用户直接调用

询问用户：

```
请提供变更来源（任选其一）：

  1. spec 文档路径（如 .claude/specs/xxx.md）
  2. 直接描述变更内容

请输入：
```

等待用户输入，记录为 `CHANGE_DESC`。

**判断输入类型**：
- 若输入以 `/`、`./`、`../` 开头，或以 `.md`、`.txt`、`.json` 等扩展名结尾 → 视为文件路径，用 **Read 工具**读取文件内容作为 `CHANGE_DESC`
- 否则 → 直接将用户输入作为 `CHANGE_DESC`

---

## Step 2.5: Outline 扫描（AST 符号对比，零 token）

**目的**：通过 AST 解析 keyFiles，精确识别新增/删除/修改的函数、类、接口，避免遗漏细节。

**Token 策略**：shell 脚本执行，零 AI token 消耗。

### 2.5a. 运行 outline 扫描脚本

**使用 Bash 工具执行**：

```bash
bash "$KIT_ROOT/.cursor/kit/context/action/update/scripts/scan-outline.sh" \
    "$UPDATE_FEATURE_ID"
```

脚本会输出所有 keyFiles 的符号骨架（函数、类、接口及行号）。

将脚本完整输出展示给用户，**不做任何 AI 分析**，仅呈现原始数据。

### 2.5b. AI 分析符号变更

基于脚本输出，对比现有文档中记录的函数/接口，识别：

| 变更类型 | 说明 |
|----------|------|
| ➕ 新增 | outline 中存在但文档未记录的函数/类/接口 |
| ➖ 删除 | 文档中记录但 outline 中已不存在的符号 |
| ✏️ 修改 | 函数签名变化（参数、返回类型） |

> **低精度基线处理**（`CORELOGIC_QUALITY=low`）：若 Step 1 检测到 coreLogic 无行号（推断型），以 outline 当前状态作为新基线，只识别**删除**和**签名变化**，不将所有现有函数标为"新增"。

**输出格式**：

```
📊 Outline 符号变更
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  useDeposit.ts:
    ➕ normalizeCoinSymbol      L44
    ➕ buildFlashBridgeCallConfig L53-86

  useFundingToken.ts:
    ✏️ withLogoRemoteNativeTokenList (返回类型变化)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
新增: <X>  删除: <X>  修改: <X>
```

记录变更数量：`OUTLINE_ADDED=<X>  OUTLINE_REMOVED=<X>  OUTLINE_MODIFIED=<X>`

将符号变更信息追加到 `CHANGE_DESC`，供后续步骤使用。

---

## Step 3: 评估变更幅度（50% 阈值）

基于 `CHANGE_DESC`（含 git commits + outline 符号变更）与现有 reference 文档内容，逐章节评估：

对每个 section，判断：
- `需要修改`：变更涉及该章节的核心逻辑/接口/流程，或 outline 发现新增/删除的符号属于该章节
- `无需修改`：变更与该章节无关

**重点关注 outline 发现的符号变更**：
- 新增函数 → 需要在对应章节补充文档
- 删除函数 → 需要从文档中移除相关描述
- 签名变化 → 需要更新函数说明和示例代码

统计 `AFFECTED_SECTIONS` / `TOTAL_SECTIONS`。

**输出评估报告：**

```
📊 变更幅度评估
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  总章节数    : <TOTAL_SECTIONS>
  受影响章节  : <AFFECTED_SECTIONS>
  变化幅度    : <百分比>%

  受影响章节列表：
    ✏️  <章节名> - <一句话说明变化>
    ✏️  <章节名> - ...
    ✅  <章节名> - 无需修改
    ...
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**阈值判断：**

- **变化 ≤ 50%** → 继续 Step 4（差量更新）
- **变化 > 50%** → 告知用户：

```
⚠️ 变化幅度超过 50%，差量更新可能不够充分。

建议改用 learn 完整重建文档（会重新分析所有代码）：
  /k/context learn <keyFiles 主目录>

是否仍然继续差量更新？（yes/no）
```

若用户选 `no` → 结束，建议执行 `learn`。
若用户选 `yes` → 继续 Step 4。

---

## Step 4: 差量更新 Reference 文档

**只修改受影响的章节**，使用 **Edit 工具**（不用 Write，避免覆盖全文）。

对每个标记为`需要修改`的章节：
1. 定位该章节在文档中的位置（`## <章节名>` 到下一个 `## `）
2. 基于 `CHANGE_DESC` + outline 符号信息重写该章节内容
3. 用 Edit 工具替换对应段落

**Outline 驱动的文档更新**：
- 新增函数：添加函数说明、参数、用途、示例代码（使用 outline 提供的行号范围引用）
- 删除函数：移除相关描述，避免文档与代码不一致
- 签名变化：更新参数列表、返回类型说明

**代码引用格式**（使用 outline 行号）：
```markdown
### `buildFlashBridgeCallConfig` (L53-86)

根据币种类型路由到对应的 bridge 合约函数...
```

保留所有`无需修改`章节的原文，包括人工写的注释和补充。

更新文档末尾的`## 更新记录`章节，追加：

```markdown
### <YYYY-MM-DD>: <简要标题>

<变更说明>
```

> ✅ Step 4 完成。**现在立即输出标题 `## 执行 Step 5：更新 Router JSON`，然后继续执行。**

---

## Step 5: 更新 Router JSON

**使用 Bash 工具**执行以下步骤：

### 5a. 重新扫描 sections lineRange

```bash
bash "$KIT_ROOT/.cursor/kit/context/action/record/scripts/validate-sections.sh" \
    --doc-path "$DOC_PATH" \
    --fix > /tmp/sections_raw.json
```

脚本输出的 `summary` 字段均为 `"TODO: 添加章节摘要"` 占位符。

**AI 处理**：读取 `/tmp/sections_raw.json` 内容，参照已读取的 reference 文档，为每个 section 填写实际 `summary`（一句话概括该章节，≤30字）。用 **Write 工具**将填写后的 JSON 写入 `/tmp/sections_final.json`。

### 5b. 更新 router 字段

```bash
TODAY=$(date +%Y-%m-%d)

bash "$KIT_ROOT/.cursor/kit/context/action/update/scripts/update-router-fields.sh" \
    --router-file "$ROUTER_FILE" \
    --feature-id "$UPDATE_FEATURE_ID" \
    --updated "$TODAY" \
    --sections-file /tmp/sections_final.json
    # 以下参数仅在有实际变化时追加：
    # --summary "<新摘要>"
    # --tags "<tag1,tag2,...>"
    # --core-logic "<逻辑1|逻辑2|...>"
    # --key-components "<组件1|组件2|...>"
    # --related-concepts "<概念1,概念2,...>"
```

> 所有字段均为可选（除 `--router-file`、`--feature-id`），只传实际发生变化的字段。

> ✅ Step 5 完成后**立即继续 Step 6**。

---

## Step 6: 写入 History 条目

### 6a. 检查同日期 history 文件是否已存在

**使用 Bash 工具**执行：

```bash
TODAY=$(date +%Y-%m-%d)
MODULE=$(echo "$FEATURE_JSON" | jq -r '.module')
HISTORY_DIR="$CONTEXT_PROJECT_DIR/history/${MODULE}/${UPDATE_FEATURE_ID}"

# 查找今天是否已有 history 文件
EXISTING_HISTORY=$(find "$HISTORY_DIR" -name "${TODAY}-*.md" 2>/dev/null | head -1)

echo "EXISTING_HISTORY=$EXISTING_HISTORY"
```

### 6b. 创建或更新 markdown history 文件

**若 `EXISTING_HISTORY` 非空（同日期文件已存在）**：
用 **Edit 工具**在该文件末尾追加本次变更内容（在 `## 文件变更列表` 前新增一个 `## 追加变更` 章节）。
`HISTORY_REL_PATH` 设为该文件相对于 `$CONTEXT_PROJECT_DIR` 的路径。

**若 `EXISTING_HISTORY` 为空（今日无 history 文件）**：

```bash
# slug：从变更标题生成，连字符连接，全小写
# 例：币种优先排序 → coin-priority-sort
HISTORY_SLUG="<slug>"
HISTORY_REL_PATH="history/${MODULE}/${UPDATE_FEATURE_ID}/${TODAY}-${HISTORY_SLUG}.md"
HISTORY_ABS_PATH="$CONTEXT_PROJECT_DIR/$HISTORY_REL_PATH"
mkdir -p "$HISTORY_DIR"
```

用 **Write 工具**写入以下格式的新文件：

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

- **Reference**: `.cursor/kit/context/library/sodex-web/reference/<module>/<feature-id>-guide.md`
```

### 6c. 追加 JSON 条目到 router

**使用 Bash 工具**执行：

```bash
bash "$KIT_ROOT/.cursor/kit/context/action/update/scripts/append-history.sh" \
    --router-file "$ROUTER_FILE" \
    --feature-id "$UPDATE_FEATURE_ID" \
    --date "$TODAY" \
    --type "<feat|fix|refactor|docs>" \
    --summary "<本次更新的简要说明，≤80字>" \
    --files "<受影响的 keyFiles 短名，逗号分隔，仅列出有变化的>" \
    --history-path "$HISTORY_REL_PATH"
```

> ✅ Step 6 完成后**立即继续 Step 7**。

---

## Step 7: 更新索引

```bash
bash "$KIT_ROOT/.cursor/kit/context/shared/update-indexes.sh" \
    --project "$PROJECT_NAME" \
    --feature-id "$UPDATE_FEATURE_ID"
```

`update-indexes.sh` 会同步更新：
- `indexes/files.json`
- `indexes/tags.json`
- `context-index.json` 的 `recentQueue`

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
  ✅ Step 7 indexes 已更新

验证：
  /k/context load <UPDATE_FEATURE_ID>
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

流程结束。
