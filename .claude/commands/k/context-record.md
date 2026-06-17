---
description: 将 spec 文档记录到 Context Library（新功能入库）
---

# Context Record

## 用户输入

```text
$ARGUMENTS
```

---

## Step 0: 初始化

**使用 Bash 工具**找到 KIT_ROOT：

```bash
dir=$(pwd); KIT_ROOT=""; for i in 1 2 3 4 5; do [ -d "$dir/.claude/kit/context/library" ] && KIT_ROOT="$dir" && break; dir="$(dirname "$dir")"; done && echo "KIT_ROOT=$KIT_ROOT"
```

若 KIT_ROOT 为空，输出 `❌ 未找到 context library，请确认 .cursor 目录已同步` 后结束。

**使用 Bash 工具**校验权限并初始化：

```bash
source "$KIT_ROOT/.claude/kit/context/context-lib.sh"
init_context_config

if ! check_write_permission; then
    echo "❌ 只读模式：当前在 worktree 中，无法修改 context library"
    echo "💡 请在 soso-kit 主仓库中执行"
    exit 1
fi

if [ "$PROJECT_NAME" = "soso-kit" ]; then
    export PROJECT_NAME=sodex-web
    export CONTEXT_PROJECT_DIR="$CONTEXT_LIBRARY_DIR/sodex-web"
    export CONTEXT_INDEX_FILE="$CONTEXT_PROJECT_DIR/context-index.json"
fi

echo "📝 Context Record - 记录功能到 Context Library"
echo "项目: $PROJECT_NAME"
```

---

## ⚠️ 执行契约（开始前确认）

本命令必须完成以下全部操作，**缺一不可**：

- [ ] Step 4: 生成文档（reference 或 history）
- [ ] Step 5: 分析文档，生成 quickRef + sections
- [ ] Step 6: 更新 router 配置
- [ ] Step 7: 更新 context-index.json + 反向索引
- [ ] Step 8: 验证结构
- [ ] Step 9: 输出完成报告

在输出 Step 9 之前，必须逐项确认以上步骤均已执行。

---

## Step 1: 检测前置条件

**使用 Bash 工具**检测 spec 状态：

```bash
PREREQ_OUTPUT=$(bash "$KIT_ROOT/.claude/kit/scripts/check-prerequisites.sh" 2>&1)

SPEC_DIR=$(echo "$PREREQ_OUTPUT" | grep "SPEC_DIR:" | cut -d: -f2- | xargs)
SPEC_SOURCE=$(echo "$PREREQ_OUTPUT" | grep "SPEC_SOURCE:" | cut -d: -f2- | xargs)

echo "📋 检测结果："
echo "  - Spec 来源: $SPEC_SOURCE"
echo "  - Spec 目录: $SPEC_DIR"

if [ -z "$SPEC_DIR" ] || [ ! -d "$SPEC_DIR" ]; then
    echo "❌ 未找到 spec 文档，请先创建（使用 /k/spec）"
    exit 1
fi
```

---

## Step 2: 智能检测与用户确认

**使用 Bash 工具**提取 spec 信息并搜索相似功能：

```bash
SPEC_FILE=$(find "$SPEC_DIR" -name "*.md" -type f | head -1)
SPEC_CONTENT=$(cat "$SPEC_FILE")
SPEC_TOKENS=$(awk '{chars+=length($0)+1} END{printf "%d", chars/4}' "$SPEC_FILE")
echo "📊 spec 文档: ~$SPEC_TOKENS tokens"

TITLE=$(echo "$SPEC_CONTENT" | head -1 | sed 's/^# *//' | sed 's/功能规范[：:] *//')
SUMMARY=$(echo "$SPEC_CONTENT" | awk '
    /## (核心需求|概述|问题描述|背景)/ { flag=1; next }
    /^##/ { if (flag) exit }
    flag && NF > 0 { print; count++ }
    count >= 3 { exit }
' | tr '\n' ' ' | sed 's/  */ /g' | cut -c1-150)

[ -z "$SUMMARY" ] && SUMMARY=$(echo "$SPEC_CONTENT" | sed -n '2,10p' | grep -v '^#' | grep -v '^$' | head -3 | tr '\n' ' ' | cut -c1-150)

MODIFIED_FILES=$(git -C "$KIT_ROOT" diff --name-only HEAD 2>/dev/null || echo "")

echo "📋 从 spec 检测到："
echo "  标题: $TITLE"
echo "  摘要: ${SUMMARY:0:80}..."

MATCHES=$(bash "$KIT_ROOT/.claude/kit/context/record/scripts/search-similar.sh" \
    --title "$TITLE" \
    --summary "$SUMMARY" \
    --files "$MODIFIED_FILES" \
    --index "$CONTEXT_INDEX_FILE" 2>/dev/null || echo "")
```

**AI 处理**：展示匹配结果，询问用户选择：
- 若有匹配 → 显示候选列表，让用户选择"更新现有功能"或"创建新功能"
- 若无匹配 → 直接创建新功能

根据用户选择确定：`FEATURE_ID`、`MODULE`、`CHANGE_TYPE`（fix/refactor/feat）、`UPDATE_EXISTING`/`CREATE_NEW`

**若更新现有功能（`UPDATE_EXISTING=true`）**：

```bash
ROUTER_FILE="$CONTEXT_PROJECT_DIR/router/$MODULE.json"
TITLE=$(jq -r ".features.\"$FEATURE_ID\".title" "$ROUTER_FILE")

SUGGESTED_TYPE=$(bash "$KIT_ROOT/.claude/kit/context/record/scripts/suggest-type.sh" \
    --spec-content "$SPEC_CONTENT")
echo "💡 建议变更类型: $SUGGESTED_TYPE"
```

询问用户确认变更类型（fix/refactor/feat），记为 `CHANGE_TYPE`。

**若创建新功能（`CREATE_NEW=true`）**：

```bash
SUGGESTED_ID=$(bash "$KIT_ROOT/.claude/kit/context/record/scripts/suggest-feature-id.sh" \
    --title "$TITLE" \
    --spec-file "$SPEC_FILE" \
    --index "$CONTEXT_INDEX_FILE")
echo "💡 建议 Feature ID: $SUGGESTED_ID"
```

询问用户确认或修改 Feature ID，验证不重复。

```bash
SUGGESTED_MODULE=$(bash "$KIT_ROOT/.claude/kit/context/record/scripts/suggest-module.sh" \
    --files "$MODIFIED_FILES")
echo "💡 建议模块: $SUGGESTED_MODULE"
```

询问用户确认模块（vault/stake/trade/shared/core/network/points），`CHANGE_TYPE="feat"`。

---

## Step 3: 判断记录类型

**使用 Bash 工具**：

```bash
MODULE_CONFIG_PATH="$CONTEXT_PROJECT_DIR/router/$MODULE.json"
FEATURE_EXISTS=$(jq -r ".features.\"$FEATURE_ID\" // null" "$MODULE_CONFIG_PATH")

if [ "$FEATURE_EXISTS" = "null" ]; then
    NEED_ADD_TO_ROUTER=true
    if [ "$CHANGE_TYPE" = "feat" ]; then
        RECORD_TYPE="new_feature_reference"
        echo "📄 新功能 → 创建 reference + router 配置"
    else
        RECORD_TYPE="new_feature_history"
        echo "📄 新功能（非 feat）→ 创建 history + router 配置"
    fi
else
    NEED_ADD_TO_ROUTER=false
    RECORD_TYPE="update_history"
    echo "📝 已有功能 → 追加 history 记录"
fi
```

---

## Step 4: 合并 spec + history 生成文档

**使用 Bash 工具**确定输出路径并生成文档：

```bash
FEATURE_SLUG=$(echo "$FEATURE_ID" | sed 's/[^a-z0-9-]/-/g')

if [ "$RECORD_TYPE" = "new_feature_reference" ]; then
    OUTPUT_FILENAME="${FEATURE_SLUG}-guide.md"
    OUTPUT_DIR="$CONTEXT_PROJECT_DIR/reference/$MODULE"
    RELATIVE_PATH="reference/$MODULE/$OUTPUT_FILENAME"
else
    TODAY=$(date +%Y-%m-%d)
    OUTPUT_FILENAME="${TODAY}-${CHANGE_TYPE}.md"
    OUTPUT_DIR="$CONTEXT_PROJECT_DIR/history/$MODULE/$FEATURE_SLUG"
    RELATIVE_PATH="history/$MODULE/$FEATURE_SLUG/$OUTPUT_FILENAME"
fi

OUTPUT_PATH="$OUTPUT_DIR/$OUTPUT_FILENAME"
mkdir -p "$OUTPUT_DIR"

bash "$KIT_ROOT/.claude/kit/context/record/scripts/merge-spec-history.sh" \
    --spec-dir "$SPEC_DIR" \
    --output-path "$OUTPUT_PATH" \
    --feature-id "$FEATURE_ID" \
    --type "$RECORD_TYPE"

echo "✅ 文档已生成: $RELATIVE_PATH"
```

> ✅ Step 4 完成。**现在立即继续 Step 4.5，不得停止。**

---

## Step 4.5: Outline 扫描 keyFiles（零 AI token）

**使用 Bash 工具**：

```bash
OUTLINE_MAP=$(bash "$KIT_ROOT/.claude/kit/context/action/update/scripts/scan-outline.sh" \
    --doc-path "$OUTPUT_PATH" 2>/dev/null)

FILE_TOKENS_TOTAL=$(echo "$OUTLINE_MAP" | grep "^FILE_TOKENS_TOTAL=" | cut -d= -f2)
echo "$OUTLINE_MAP"
```

若脚本退出码非 0（代码库未找到），设 `OUTLINE_MAP=""` 继续流程。

---

## Step 5: 分析文档生成索引

**使用 Bash 工具**：

```bash
ANALYSIS_JSON=$(bash "$KIT_ROOT/.claude/kit/context/action/record/scripts/analyze-document.sh" \
    --doc-path "$OUTPUT_PATH" \
    --feature-id "$FEATURE_ID" \
    --module "$MODULE")

QUICK_REF=$(echo "$ANALYSIS_JSON" | jq '.quickRef')
SECTIONS=$(echo "$ANALYSIS_JSON" | jq '.sections')
TAGS=$(echo "$ANALYSIS_JSON" | jq -r '.tags | join(",")')

echo "✅ 已生成 quickRef 和 sections"
```

**生成 `quickRef.coreLogic` 时**：
- `$OUTLINE_MAP` 可用 → 从 outline 提取导出函数签名（含参数类型、返回类型、行号），选 3-5 条最核心的
- `$OUTLINE_MAP` 不可用 → 基于 spec 文本推断，追加 `[推断，无行号]` 标注

**同时为每个 section 生成 `summary`（≤30字）替换 "TODO: 生成摘要"，得到 `CORRECTED_SECTIONS`**：
- `$OUTLINE_MAP` 可用 → 结合 section `title` + outline 中对应模块的函数名
- `$OUTLINE_MAP` 不可用 → 仅基于 section `title` 推断
- 直接输出填好的 JSON 数组，格式与 `$SECTIONS` 相同，不解释过程
- **Step 6 使用 `CORRECTED_SECTIONS` 替代 `$SECTIONS` 传入 `--sections` 参数**

**使用 Bash 工具**验证 sections：

```bash
bash "$KIT_ROOT/.claude/kit/context/action/record/scripts/validate-sections.sh" \
    --doc-path "$OUTPUT_PATH" \
    --sections "$SECTIONS"
```

> ✅ Step 5 完成。**现在立即继续 Step 6。**

---

## Step 6: 更新 router 配置

**使用 Bash 工具**：

```bash
FILES=$(grep -oE 'src/[a-zA-Z0-9/_.-]+\.(ts|tsx)' "$OUTPUT_PATH" | sort -u | tr '\n' ',' | sed 's/,$//')

if [ "$NEED_ADD_TO_ROUTER" = "true" ]; then
    bash "$KIT_ROOT/.claude/kit/context/action/record/scripts/update-router.sh" \
        --module "$MODULE" \
        --feature-id "$FEATURE_ID" \
        --type "$CHANGE_TYPE" \
        --title "$TITLE" \
        --summary "$SUMMARY" \
        --quick-ref "$QUICK_REF" \
        --sections "$SECTIONS" \
        --tags "$TAGS" \
        --reference-path "$RELATIVE_PATH" \
        --files "$FILES" \
        --context-dir "$CONTEXT_PROJECT_DIR"
    echo "✅ Router 配置已更新（新功能入库）"
else
    bash "$KIT_ROOT/.claude/kit/context/record/scripts/update-router.sh" \
        --module "$MODULE" \
        --feature-id "$FEATURE_ID" \
        --type "$CHANGE_TYPE" \
        --summary "$SUMMARY" \
        --history-path "$RELATIVE_PATH" \
        --files "$FILES" \
        --context-dir "$CONTEXT_PROJECT_DIR"
    echo "✅ History 记录已追加"
fi
```

> ✅ Step 6 完成。**现在立即继续 Step 7。**

---

## Step 7: 更新 context-index.json + 反向索引

**使用 Bash 工具**：

```bash
bash "$KIT_ROOT/.claude/kit/context/record/scripts/update-index.sh" \
    --feature-id "$FEATURE_ID" \
    --module "$MODULE" \
    --type "$CHANGE_TYPE" \
    --summary "$SUMMARY" \
    --add-to-queue \
    --index-file "$CONTEXT_INDEX_FILE"

echo "✅ 索引已更新"

bash "$KIT_ROOT/.claude/kit/context/record/scripts/update-indexes.sh" \
    --project "$PROJECT_NAME" \
    --feature-id "$FEATURE_ID"
```

> ✅ Step 7 完成。**现在立即继续 Step 8。**

---

## Step 8: 验证结构

**使用 Bash 工具**：

```bash
bash "$KIT_ROOT/.claude/kit/context/record/scripts/validate-structure.sh" \
    --index "$CONTEXT_INDEX_FILE"

bash "$KIT_ROOT/.claude/kit/context/record/scripts/validate-structure.sh" \
    --router "$MODULE_CONFIG_PATH"

bash "$KIT_ROOT/.claude/kit/context/action/record/scripts/validate-structure.sh" \
    --integrity "$CONTEXT_PROJECT_DIR"

echo "✅ 结构验证 + 一致性校验完成"
```

---

## Step 9: 完成输出

在输出以下报告前，逐项确认各步骤已执行（未执行的步骤须立即返回补做）：

```
✅ Context Record 完成！
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Feature ID : <FEATURE_ID>
  模块       : <MODULE>
  类型       : <RECORD_TYPE>

步骤确认：
  ✅ Step 4 文档已生成  : <RELATIVE_PATH>
  ✅ Step 5 quickRef 已生成
  ✅ Step 6 router 已更新 : <MODULE_CONFIG_PATH>
  ✅ Step 7 index 已更新  : context-index.json
  ✅ Step 8 结构验证通过

📊 Token 成本
  outline 扫描       : ~0 tokens（零消耗，shell 脚本）
  keyFiles 参考体积  : ~<FILE_TOKENS_TOTAL> tokens（outline 估算，AI 未读取源码）
  spec 文档读取      : ~<SPEC_TOKENS> tokens
  AI 分析与写作      : ~<估算>
  ─────────────────────────────
  本次总计           : ~<后两项合计> tokens

验证：
  /k/context load <FEATURE_ID>
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```
