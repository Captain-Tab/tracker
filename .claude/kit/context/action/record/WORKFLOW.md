---
description: 【已归档】记录功能到 Context Library（按 context v2.2 规范）
---

# 记录功能: Record（归档参考文件）

> ⚠️ **此文件已归档，不再作为运行时 prompt。**
> 完整工作流已内联至 `/commands/k/context-record.md`。
> 本文件仅作为历史记录和对照参考保留。

---

## 核心目的

1. 检测 spec 状态
2. 判断是更新 reference 还是 history
3. 自动生成 quickRef 和 sections
4. 更新 router 配置和 context-index.json

---

## Step 0: 环境准备

```bash
# 加载配置和工具库
source .cursor/kit/config.sh
source .cursor/kit/context/context-lib.sh
source .cursor/kit/context/record/scripts/record-helpers.sh

# 初始化上下文
init_context_config

# 检查权限（只在 soso-kit 主仓库执行）
if ! check_write_permission; then
    echo "❌ 只读模式：当前在 worktree 中，无法修改 context library"
    echo ""
    echo "💡 如需更新 context，请在 soso-kit 主仓库中执行："
    echo "   cd $(find_kit_root)"
    echo "   /k/record"
    exit 1
fi

echo "📝 Context Record - 记录功能到 Context Library"
echo "项目: $PROJECT_NAME"
echo ""
```

---

## Step 1: 检测前置条件

使用 check-prerequisites.sh 检测 spec 和 history 状态：

```bash
echo "🔍 检测 spec 状态..."
echo ""

# 执行检测脚本
PREREQ_OUTPUT=$(bash .cursor/kit/scripts/check-prerequisites.sh 2>&1)

# 提取关键信息
SPEC_DIR=$(echo "$PREREQ_OUTPUT" | grep "SPEC_DIR:" | cut -d: -f2- | xargs)
SPEC_SOURCE=$(echo "$PREREQ_OUTPUT" | grep "SPEC_SOURCE:" | cut -d: -f2- | xargs)

echo "📋 检测结果："
echo "  - Spec 来源: $SPEC_SOURCE"
echo "  - Spec 目录: $SPEC_DIR"
echo ""

# 验证 spec 存在
if [ -z "$SPEC_DIR" ] || [ ! -d "$SPEC_DIR" ]; then
    echo "❌ 未找到 spec 文档"
    echo "请先创建 spec 文档（使用 /k/spec）"
    exit 1
fi
```

---

## Step 2: 智能检测与用户确认

自动提取信息并搜索相似功能，引导用户选择：

```bash
echo "🔍 分析 spec 文档..."
echo ""

# ========================================
# 2.1 自动提取 Title 和 Summary
# ========================================

# 读取 spec 内容
SPEC_FILE=$(find "$SPEC_DIR" -name "*.md" -type f | head -1)
if [ -z "$SPEC_FILE" ]; then
    echo "❌ 未找到 spec 文件"
    exit 1
fi

SPEC_CONTENT=$(cat "$SPEC_FILE")

# 提取 Title（第一行）
TITLE=$(echo "$SPEC_CONTENT" | head -1 | sed 's/^# *//' | sed 's/功能规范[：:] *//')

if [ -z "$TITLE" ]; then
    echo "❌ 无法从 spec 提取标题"
    echo "请确保 spec 第一行为 '# 标题'"
    exit 1
fi

# 提取 Summary（从核心需求章节或前几段）
SUMMARY=$(echo "$SPEC_CONTENT" | awk '
    /## (核心需求|概述|问题描述|背景)/ { flag=1; next }
    /^##/ { if (flag) exit }
    flag && NF > 0 { print; count++ }
    count >= 3 { exit }
' | tr '\n' ' ' | sed 's/  */ /g' | cut -c1-150)

if [ -z "$SUMMARY" ]; then
    # 降级：使用前几段
    SUMMARY=$(echo "$SPEC_CONTENT" | sed -n '2,10p' | grep -v '^#' | grep -v '^$' | head -3 | tr '\n' ' ' | cut -c1-150)
fi

echo "📋 从 spec 检测到："
echo "  标题: $TITLE"
echo "  摘要: ${SUMMARY:0:80}..."
echo ""

# 获取修改的文件列表
MODIFIED_FILES=$(git diff --name-only HEAD 2>/dev/null || echo "")

# ========================================
# 2.2 搜索相似功能（三级匹配）
# ========================================

echo "🔎 搜索相似功能..."

MATCHES=$(bash .cursor/kit/context/record/scripts/search-similar.sh \
    --title "$TITLE" \
    --summary "$SUMMARY" \
    --files "$MODIFIED_FILES" \
    --index "$CONTEXT_INDEX_FILE" 2>/dev/null || echo "")

# ========================================
# 2.3 展示匹配结果，让用户选择
# ========================================

FEATURE_ID=""
MODULE=""
CHANGE_TYPE=""
UPDATE_EXISTING=false
CREATE_NEW=false

if [ -n "$MATCHES" ]; then
    echo ""
    echo "🎯 检测到可能相关的功能："
    echo ""

    # 解析匹配结果并构建选项
    declare -a OPTIONS
    declare -a FEATURE_IDS
    declare -a MODULES

    while IFS='|' read -r match_type fid module score; do
        # 读取功能详细信息
        ROUTER_FILE="$CONTEXT_PROJECT_DIR/router/$module.json"
        FEATURE_TITLE=$(jq -r ".features.\"$fid\".title" "$ROUTER_FILE" 2>/dev/null)

        # 构建选项文本
        if [ "$match_type" = "EXACT" ]; then
            OPTIONS+=("✅ $fid ($module) - $FEATURE_TITLE [精准匹配]")
        elif [ "$match_type" = "FUZZY" ]; then
            OPTIONS+=("🔗 $fid ($module) - $FEATURE_TITLE [相似度: $score%]")
        else
            OPTIONS+=("📝 $fid ($module) - $FEATURE_TITLE [关键词匹配: $score%]")
        fi

        FEATURE_IDS+=("$fid")
        MODULES+=("$module")
    done <<< "$MATCHES"

    # 添加"创建新功能"选项
    OPTIONS+=("🆕 创建新功能")

    # 显示菜单
    PS3="请选择操作 (输入序号): "
    select opt in "${OPTIONS[@]}"; do
        if [ -n "$opt" ]; then
            if [[ "$opt" == "🆕 创建新功能" ]]; then
                CREATE_NEW=true
                echo ""
                echo "➡️  将创建新功能"
            else
                # 用户选择了现有功能
                OPTION_INDEX=$((REPLY - 1))
                FEATURE_ID="${FEATURE_IDS[$OPTION_INDEX]}"
                MODULE="${MODULES[$OPTION_INDEX]}"
                UPDATE_EXISTING=true
                echo ""
                echo "➡️  将更新功能: $FEATURE_ID"
            fi
            break
        else
            echo "⚠️  无效选择，请重新输入"
        fi
    done
else
    echo ""
    echo "💡 未检测到相似功能，将创建新功能"
    CREATE_NEW=true
fi

echo ""

# ========================================
# 2.4 分支处理：更新现有功能
# ========================================

if [ "$UPDATE_EXISTING" = true ]; then
    echo "📝 更新现有功能: $FEATURE_ID"
    echo ""

    # 自动读取现有配置
    ROUTER_FILE="$CONTEXT_PROJECT_DIR/router/$MODULE.json"
    TITLE=$(jq -r ".features.\"$FEATURE_ID\".title" "$ROUTER_FILE")

    # 显示基本信息
    echo "  功能 ID: $FEATURE_ID"
    echo "  模块: $MODULE"
    echo "  标题: $TITLE"
    echo ""

    # 选择变更类型（智能推荐）
    SUGGESTED_TYPE=$(bash .cursor/kit/context/record/scripts/suggest-type.sh \
        --spec-content "$SPEC_CONTENT")

    echo "💡 建议变更类型: $SUGGESTED_TYPE"
    echo ""
    echo "变更类型说明："
    echo "  fix      - 修复 bug"
    echo "  refactor - 重构优化"
    echo "  feat     - 功能增强"
    echo ""
    PS3="选择变更类型 (输入序号): "
    select CHANGE_TYPE in fix refactor feat; do
        if [ -n "$CHANGE_TYPE" ]; then
            echo "  ✅ 变更类型: $CHANGE_TYPE"
            break
        fi
    done

    echo ""

    # 最终确认
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "📋 更新信息汇总"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  Feature ID: $FEATURE_ID"
    echo "  模块: $MODULE"
    echo "  标题: $TITLE"
    echo "  变更类型: $CHANGE_TYPE"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""

    read -p "确认更新? (Y/n): " CONFIRM
    if [[ ! "$CONFIRM" =~ ^[Yy]?$ ]]; then
        echo "❌ 已取消"
        exit 0
    fi
fi

# ========================================
# 2.5 分支处理：创建新功能
# ========================================

if [ "$CREATE_NEW" = true ]; then
    echo "🆕 创建新功能"
    echo ""

    # 2.5.1 Feature ID（智能推荐 + 用户确认）
    SUGGESTED_ID=$(bash .cursor/kit/context/record/scripts/suggest-feature-id.sh \
        --title "$TITLE" \
        --spec-file "$SPEC_FILE" \
        --index "$CONTEXT_INDEX_FILE")

    echo "💡 建议 Feature ID: $SUGGESTED_ID"
    read -p "确认或修改 [回车使用建议]: " INPUT_ID
    FEATURE_ID=${INPUT_ID:-$SUGGESTED_ID}

    # 检查 ID 是否已存在
    while true; do
        ID_EXISTS=false
        for router_file in "$CONTEXT_PROJECT_DIR"/router/*.json; do
            if [ -f "$router_file" ]; then
                if jq -e ".features.\"$FEATURE_ID\"" "$router_file" >/dev/null 2>&1; then
                    ID_EXISTS=true
                    break
                fi
            fi
        done

        if [ "$ID_EXISTS" = true ]; then
            echo "⚠️  功能 $FEATURE_ID 已存在"
            read -p "请输入不同的 Feature ID: " FEATURE_ID
        else
            break
        fi
    done

    echo "  ✅ Feature ID: $FEATURE_ID"
    echo ""

    # 2.5.2 Module 选择（智能推荐 + 菜单）
    SUGGESTED_MODULE=$(bash .cursor/kit/context/record/scripts/suggest-module.sh \
        --files "$MODIFIED_FILES")

    echo "💡 建议模块: $SUGGESTED_MODULE (基于修改的文件)"
    echo ""
    PS3="选择模块 (输入序号): "
    select MODULE in vault stake network points shared; do
        if [ -n "$MODULE" ]; then
            echo "  ✅ 模块: $MODULE"
            break
        fi
    done

    # 验证模块配置存在
    MODULE_CONFIG_PATH="$CONTEXT_PROJECT_DIR/router/$MODULE.json"
    if [ ! -f "$MODULE_CONFIG_PATH" ]; then
        echo "❌ 模块配置不存在: $MODULE_CONFIG_PATH"
        exit 1
    fi

    echo ""

    # 2.5.3 固定类型为 feat（新功能）
    CHANGE_TYPE="feat"
    echo "💡 记录类型: feat (新功能)"
    echo ""

    # 2.5.4 最终确认
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "📋 新功能信息汇总"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  Feature ID: $FEATURE_ID"
    echo "  模块: $MODULE"
    echo "  标题: $TITLE"
    echo "  摘要: ${SUMMARY:0:80}..."
    echo "  类型: feat (新功能)"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""

    read -p "确认创建? (Y/n): " CONFIRM
    if [[ ! "$CONFIRM" =~ ^[Yy]?$ ]]; then
        echo "❌ 已取消"
        exit 0
    fi
fi

echo ""
echo "✅ 功能信息确认完成"
echo ""
```

---

## Step 3: 判断记录类型

根据检测结果决定操作：

```bash
echo "🎯 判断记录类型..."
echo ""

RECORD_TYPE="unknown"
NEED_ADD_TO_ROUTER=false

# 检查功能是否已存在
FEATURE_EXISTS=$(jq -r ".features.\"$FEATURE_ID\" // null" "$MODULE_CONFIG_PATH")

if [ "$FEATURE_EXISTS" = "null" ]; then
    # 新功能
    NEED_ADD_TO_ROUTER=true

    if [ "$CHANGE_TYPE" = "feat" ]; then
        RECORD_TYPE="new_feature_reference"
        echo "📄 新功能 → 创建 reference + router 配置"
    else
        RECORD_TYPE="new_feature_history"
        echo "📄 新功能（非 feat）→ 创建 history + router 配置"
    fi
else
    # 增量更新
    RECORD_TYPE="update_history"
    echo "📝 已有功能 → 追加 history 记录"
fi

echo ""
```

---

## Step 4: 合并 spec + history

```bash
echo "📄 合并文档..."
echo ""

# 确定输出路径
if [ "$RECORD_TYPE" = "new_feature_reference" ]; then
    # reference 路径
    FEATURE_SLUG=$(extract_feature_slug "$FEATURE_ID")
    OUTPUT_FILENAME="${FEATURE_SLUG}-guide.md"
    OUTPUT_DIR="$CONTEXT_PROJECT_DIR/reference/$MODULE"
    OUTPUT_PATH="$OUTPUT_DIR/$OUTPUT_FILENAME"
    RELATIVE_PATH="reference/$MODULE/$OUTPUT_FILENAME"
else
    # history 路径
    FEATURE_SLUG=$(extract_feature_slug "$FEATURE_ID")
    OUTPUT_FILENAME=$(generate_doc_filename "$FEATURE_SLUG" "$CHANGE_TYPE")
    OUTPUT_DIR="$CONTEXT_PROJECT_DIR/history/$MODULE/$FEATURE_SLUG"
    OUTPUT_PATH="$OUTPUT_DIR/$OUTPUT_FILENAME"
    RELATIVE_PATH="history/$MODULE/$FEATURE_SLUG/$OUTPUT_FILENAME"
fi

# 调用合并脚本
bash .cursor/kit/context/record/scripts/merge-spec-history.sh \
    --spec-dir "$SPEC_DIR" \
    --output-path "$OUTPUT_PATH" \
    --feature-id "$FEATURE_ID" \
    --type "$RECORD_TYPE"

if [ $? -ne 0 ]; then
    echo "❌ 文档合并失败"
    exit 1
fi

echo "✅ 文档已生成: $RELATIVE_PATH"
echo ""
```

---

## Step 4.5: Outline 扫描 keyFiles（可选，零 token）

**目的**：在生成 quickRef 之前，扫描文档引用的真实代码文件，获取精确函数签名和行号，使 coreLogic 质量与 `learn` 命令产出一致。

**使用 Bash 工具执行**：

```bash
OUTLINE_MAP=$(bash "$KIT_ROOT/.cursor/kit/context/action/update/scripts/scan-outline.sh" \
    --doc-path "$OUTPUT_PATH" 2>/dev/null)

# 提取机器可读字段
FILE_TOKENS_TOTAL=$(echo "$OUTLINE_MAP" | grep "^FILE_TOKENS_TOTAL=" | cut -d= -f2)
```

将 `$OUTLINE_MAP` 完整输出展示给用户。若脚本退出码非 0（代码库未找到），设 `OUTLINE_MAP=""` 继续流程。

---

## Step 5: 分析文档生成索引

```bash
echo "🔍 分析文档并生成索引..."
echo ""

# 调用分析脚本
ANALYSIS_JSON=$(bash .cursor/kit/context/action/record/scripts/analyze-document.sh \
    --doc-path "$OUTPUT_PATH" \
    --feature-id "$FEATURE_ID" \
    --module "$MODULE")

if [ $? -ne 0 ]; then
    echo "❌ 文档分析失败"
    exit 1
fi

# 解析结果
QUICK_REF=$(echo "$ANALYSIS_JSON" | jq '.quickRef')
SECTIONS=$(echo "$ANALYSIS_JSON" | jq '.sections')
TAGS=$(echo "$ANALYSIS_JSON" | jq -r '.tags | join(",")')

echo "✅ 已生成 quickRef 和 sections"
echo ""
```

**生成 `quickRef.coreLogic` 时，优先使用 Step 4.5 的 outline 输出**：

- **`$OUTLINE_MAP` 可用时**：从 outline 提取导出函数签名（含参数类型、返回类型、行号），格式：
  `函数名(参数类型): 返回类型  L起始-结束  一句话描述`
  选取 3-5 条最核心的导出函数。
- **`$OUTLINE_MAP` 不可用时**：基于 spec 文本推断，在每条 coreLogic 末尾追加 `[推断，无行号]` 标注，提示精度较低。

# 验证 sections（v2.5.5 新增）
echo "🔍 验证 sections 配置..."
bash .cursor/kit/context/action/record/scripts/validate-sections.sh \
    --doc-path "$OUTPUT_PATH" \
    --sections "$SECTIONS"

if [ $? -ne 0 ]; then
    echo "⚠️  sections 验证发现问题，请手动检查 lineRange"
fi
echo ""
```

---

## Step 6: 更新 router 配置

```bash
if [ "$NEED_ADD_TO_ROUTER" = true ]; then
    echo "📝 更新 router 配置..."
    echo ""

    # 提取文件列表
    FILES=$(extract_file_paths "$(cat "$OUTPUT_PATH")" | tr '\n' ',' | sed 's/,$//')

    # 调用更新脚本
    bash .cursor/kit/context/action/record/scripts/update-router.sh \
        --module "$MODULE" \
        --feature-id "$FEATURE_ID" \
        --type "$CHANGE_TYPE" \
        --title "$TITLE" \
        --summary "$SUMMARY" \
        --quick-ref "$QUICK_REF" \
        --sections "$SECTIONS" \
        --tags "$TAGS" \
        --reference-path "${RECORD_TYPE#new_feature_reference:+$RELATIVE_PATH}" \
        --history-path "${RECORD_TYPE#new_feature_history:+$RELATIVE_PATH}${RECORD_TYPE#update_history:+$RELATIVE_PATH}" \
        --files "$FILES" \
        --context-dir "$CONTEXT_PROJECT_DIR"

    if [ $? -ne 0 ]; then
        echo "❌ Router 更新失败"
        exit 1
    fi

    echo "✅ Router 配置已更新"
    echo ""
else
    echo "📝 追加 history 记录到 router..."
    echo ""

    # 提取文件列表
    FILES=$(extract_file_paths "$(cat "$OUTPUT_PATH")" | tr '\n' ',' | sed 's/,$//')

    # 调用更新脚本（只更新 history 部分）
    bash .cursor/kit/context/record/scripts/update-router.sh \
        --module "$MODULE" \
        --feature-id "$FEATURE_ID" \
        --type "$CHANGE_TYPE" \
        --summary "$SUMMARY" \
        --history-path "$RELATIVE_PATH" \
        --files "$FILES" \
        --context-dir "$CONTEXT_PROJECT_DIR"

    if [ $? -ne 0 ]; then
        echo "❌ History 更新失败"
        exit 1
    fi

    echo "✅ History 记录已追加"
    echo ""
fi
```

---

## Step 7: 更新 context-index.json

```bash
echo "📝 更新 context-index.json..."
echo ""

# 调用更新脚本
bash .cursor/kit/context/record/scripts/update-index.sh \
    --feature-id "$FEATURE_ID" \
    --module "$MODULE" \
    --type "$CHANGE_TYPE" \
    --summary "$SUMMARY" \
    --add-to-queue \
    --index-file "$CONTEXT_INDEX_FILE"

if [ $? -ne 0 ]; then
    echo "❌ 索引更新失败"
    exit 1
fi

echo "✅ 索引已更新"
echo ""

# 更新文件反向索引和标签索引
bash .cursor/kit/context/record/scripts/update-indexes.sh \
    --project "$PROJECT_NAME" \
    --feature-id "$FEATURE_ID"

if [ $? -ne 0 ]; then
    echo "⚠️  反向索引更新失败（非致命错误）"
fi
```

---

## Step 8: 验证结构

```bash
echo "🔍 验证 JSON 结构..."
echo ""

# 验证 context-index.json
bash .cursor/kit/context/record/scripts/validate-structure.sh \
    --index "$CONTEXT_INDEX_FILE"

# 验证 router 配置
bash .cursor/kit/context/record/scripts/validate-structure.sh \
    --router "$MODULE_CONFIG_PATH"

if [ $? -ne 0 ]; then
    echo "⚠️  验证失败，但文件已更新"
fi

echo ""
```

---

## Step 9: 完成输出

```bash
echo "✅ 记录完成"
echo ""
echo "📊 更新摘要："
echo "  - 功能 ID: $FEATURE_ID"
echo "  - 模块: $MODULE"
echo "  - 类型: $RECORD_TYPE"
echo "  - 文档: $RELATIVE_PATH"
echo ""
echo "🔍 验证："

# 使用 context_load 验证
echo ""
echo "查看记录："
echo "  /k/context load $FEATURE_ID"
echo ""
echo "💡 提示: 如需修改，请直接编辑以下文件："
echo "  - 文档: $OUTPUT_PATH"
echo "  - Router: $MODULE_CONFIG_PATH"
echo "  - 索引: $CONTEXT_INDEX_FILE"
echo ""
```

---

## 完成

记录流程已完成。Context Library 已按照 v2.2 规范更新。
