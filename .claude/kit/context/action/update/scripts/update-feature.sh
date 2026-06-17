#!/bin/bash
# update-feature.sh - 更新指定功能的元数据
# 支持修改: 标题 / 摘要 / 标签 / 关键文件(keyFiles)
# 使用方式: /k/context update <feature-id>

FEATURE_ID="$1"

if [ -z "$FEATURE_ID" ]; then
    echo "❌ 缺少参数: 功能 ID"
    echo "使用方式: /k/context update <feature-id>"
    exit 1
fi

# ── 加载配置 ──────────────────────────────────────────────────────────────
# KIT_ROOT 由调用方（context_update 函数）通过环境变量传入
if [ -z "$KIT_ROOT" ]; then
    # fallback: 从脚本位置向上推算
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    KIT_ROOT="$(cd "$SCRIPT_DIR/../../../../.." && pwd)"
fi

source "$KIT_ROOT/.claude/kit/context/context-lib.sh"
init_context_config

# 从 soso-kit 主仓库运行时修正 PROJECT_NAME
if [ "$PROJECT_NAME" = "soso-kit" ]; then
    export PROJECT_NAME=sodex-web
    export CONTEXT_PROJECT_DIR="$CONTEXT_LIBRARY_DIR/sodex-web"
    export CONTEXT_INDEX_FILE="$CONTEXT_PROJECT_DIR/context-index.json"
fi

# ── 1. 从 router JSON 查找 feature（不从 recentQueue，recentQueue 字段不全）──
FEATURE_JSON=""
ROUTER_FILE=""
for rf in "$CONTEXT_PROJECT_DIR/router/"*.json; do
    data=$(jq -c ".features[\"$FEATURE_ID\"] // empty" "$rf" 2>/dev/null)
    if [ -n "$data" ]; then
        FEATURE_JSON="$data"
        ROUTER_FILE="$rf"
        break
    fi
done

if [ -z "$FEATURE_JSON" ]; then
    echo "❌ 未找到功能: $FEATURE_ID"
    echo "使用 /k/context list 查看所有功能 ID"
    exit 1
fi

# ── 2. 提取当前字段 ───────────────────────────────────────────────────────
MODULE=$(echo  "$FEATURE_JSON" | jq -r '.module')
TITLE=$(echo   "$FEATURE_JSON" | jq -r '.title')
SUMMARY=$(echo "$FEATURE_JSON" | jq -r '.summary')
TAGS=$(echo    "$FEATURE_JSON" | jq -r '.tags | join(", ")')
CREATED=$(echo "$FEATURE_JSON" | jq -r '.created')
UPDATED=$(echo "$FEATURE_JSON" | jq -r '.updated')

# keyFiles 存于 quickRef.keyFiles（非顶层 .files）
KEY_FILES=$(echo "$FEATURE_JSON" | jq -r '.quickRef.keyFiles[]' 2>/dev/null)
KEY_FILES_COUNT=$(echo "$KEY_FILES" | grep -c . || echo 0)

# ── 3. 展示当前信息 ───────────────────────────────────────────────────────
echo "📝 更新功能元数据: $FEATURE_ID"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  模块    : $MODULE"
echo "  创建    : $CREATED  更新: $UPDATED"
echo ""
echo "  📌 标题:"
echo "     $TITLE"
echo ""
echo "  📝 摘要:"
echo "     $SUMMARY"
echo ""
echo "  🏷️  标签:"
echo "     $TAGS"
echo ""
echo "  📁 关键文件 ($KEY_FILES_COUNT 个):"
echo "$KEY_FILES" | sed 's/^/     /'
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ── 4. 交互式菜单 ─────────────────────────────────────────────────────────
echo "选择要修改的字段（输入数字，直接回车跳过）:"
echo "  1. 标题 (Title)"
echo "  2. 摘要 (Summary)"
echo "  3. 标签 (Tags)"
echo "  4. 关键文件 (keyFiles)"
echo "  5. 保存"
echo "  0. 取消"
echo ""
echo -n "选择 [1-5/0]: "
read -r CHOICE

case "$CHOICE" in
    "1")
        echo ""
        echo "当前标题: $TITLE"
        echo -n "新标题（直接回车保持不变）: "
        read -r NEW_TITLE
        [ -n "$NEW_TITLE" ] && TITLE="$NEW_TITLE" && echo "✓ 已更新"
        ;;
    "2")
        echo ""
        echo "当前摘要: $SUMMARY"
        echo -n "新摘要（直接回车保持不变）: "
        read -r NEW_SUMMARY
        [ -n "$NEW_SUMMARY" ] && SUMMARY="$NEW_SUMMARY" && echo "✓ 已更新"
        ;;
    "3")
        echo ""
        echo "当前标签: $TAGS"
        echo -n "新标签（逗号分隔，直接回车保持不变）: "
        read -r NEW_TAGS
        [ -n "$NEW_TAGS" ] && TAGS="$NEW_TAGS" && echo "✓ 已更新"
        ;;
    "4")
        echo ""
        echo "当前文件列表:"
        echo "$KEY_FILES" | nl | sed 's/^/  /'
        echo ""
        echo "输入新文件列表（逗号分隔，直接回车保持不变）:"
        echo "示例: src/hooks/useXxx.ts, src/pages/xxx/index.tsx"
        echo -n "> "
        read -r NEW_FILES_INPUT
        if [ -n "$NEW_FILES_INPUT" ]; then
            KEY_FILES=$(echo "$NEW_FILES_INPUT" | tr ',' '\n' | sed 's/^ *//;s/ *$//' | grep -v '^$')
            echo "✓ 已更新 ($(echo "$KEY_FILES" | grep -c .) 个文件)"
        fi
        ;;
    "5")
        echo ""
        echo "✓ 保存当前信息（无修改）"
        ;;
    "0")
        echo ""
        echo "已取消"
        exit 0
        ;;
    *)
        echo ""
        echo "❌ 无效选择"
        exit 1
        ;;
esac

# ── 5. 写入 router JSON ────────────────────────────────────────────────────
echo ""
echo "🔄 更新 router 配置..."

TODAY=$(date +%Y-%m-%d)

# 标签: 逗号分隔字符串 → JSON 数组
TAGS_JSON=$(echo "$TAGS" | tr ',' '\n' | sed 's/^ *//;s/ *$//' | grep -v '^$' | jq -R . | jq -s .)

# 关键文件: 换行分隔字符串 → JSON 数组
KEYFILES_JSON=$(echo "$KEY_FILES" | grep -v '^$' | jq -R . | jq -s .)

TMP_FILE=$(mktemp)

# features 是 object，用 .features[$id] 路径（不是 .features[] | select()）
jq --arg id      "$FEATURE_ID" \
   --arg title   "$TITLE" \
   --arg summary "$SUMMARY" \
   --arg today   "$TODAY" \
   --argjson tags     "$TAGS_JSON" \
   --argjson keyfiles "$KEYFILES_JSON" \
   '.features[$id].title                  = $title   |
    .features[$id].summary                = $summary |
    .features[$id].tags                   = $tags    |
    .features[$id].quickRef.keyFiles      = $keyfiles |
    .features[$id].updated                = $today' \
   "$ROUTER_FILE" > "$TMP_FILE"

mv "$TMP_FILE" "$ROUTER_FILE"
echo "✓ router/${MODULE}.json 已更新"

# ── 6. 更新反向索引 ───────────────────────────────────────────────────────
echo ""
echo "🔄 更新索引..."

bash "$KIT_ROOT/.claude/kit/context/shared/update-indexes.sh" \
    --project "$PROJECT_NAME" \
    --feature-id "$FEATURE_ID" 2>/dev/null || true

echo ""
echo "✅ 更新完成！"
echo "   /k/context load $FEATURE_ID"
