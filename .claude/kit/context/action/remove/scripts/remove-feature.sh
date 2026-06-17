#!/bin/bash
# remove-feature.sh - 删除指定功能
# 使用方式: bash remove-feature.sh <feature-id>

FEATURE_ID="$1"

if [ -z "$FEATURE_ID" ]; then
  echo "❌ 缺少参数: 功能 ID"
  echo "使用方式: /k/context remove <feature-id>"
  exit 1
fi

# 加载配置
source "$KIT_ROOT/.claude/kit/context/context-lib.sh"
init_context_config

# Step 1: 查询功能信息
echo "🗑️  删除功能"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# 从 context-index.json 获取功能信息
FEATURE_INFO=$(jq -r ".recentQueue[] | select(.id==\"$FEATURE_ID\")" "$CONTEXT_INDEX_FILE")

if [ -z "$FEATURE_INFO" ]; then
  echo "❌ 未找到功能: $FEATURE_ID"
  echo ""
  echo "💡 使用 /k/context list 查看所有功能 ID"
  exit 1
fi

# 提取功能信息
MODULE=$(echo "$FEATURE_INFO" | jq -r '.module')
TITLE=$(echo "$FEATURE_INFO" | jq -r '.title')
SUMMARY=$(echo "$FEATURE_INFO" | jq -r '.summary')
CREATED=$(echo "$FEATURE_INFO" | jq -r '.created')
TAGS=$(echo "$FEATURE_INFO" | jq -r '.tags | join(", ")')

# Step 2: 显示功能详情（防止误删）
echo "功能信息："
echo ""
echo "  ID: $FEATURE_ID"
echo "  模块: $MODULE"
echo "  标题: $TITLE"
echo "  创建日期: $CREATED"
echo ""
echo "  摘要: $SUMMARY"
echo ""
echo "  标签: $TAGS"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Step 3: 二次确认
echo "⚠️  警告：删除后无法恢复（文档会移动到 .archive/）"
echo ""
echo -n "确认删除？(输入 'yes' 确认，其他取消): "
read CONFIRM

if [ "$CONFIRM" != "yes" ]; then
  echo ""
  echo "❌ 已取消删除"
  exit 0
fi

echo ""
echo "🔄 开始删除..."

# Step 4: 删除 router 中的 feature 条目
ROUTER_FILE="$CONTEXT_PROJECT_DIR/router/${MODULE}.json"

if [ -f "$ROUTER_FILE" ]; then
  echo "  ✓ 从 router 删除功能配置"

  # features 是 object（key=feature-id），用 del 删 key；同时清理 history 同名 key
  TMP_FILE=$(mktemp)
  jq --arg id "$FEATURE_ID" 'del(.features[$id]) | (if .history? then del(.history[$id]) else . end)' "$ROUTER_FILE" > "$TMP_FILE"
  mv "$TMP_FILE" "$ROUTER_FILE"
else
  echo "  ⚠️  Router 文件不存在: $ROUTER_FILE"
fi

# Step 5: 从 context-index.json 删除引用
echo "  ✓ 从索引删除引用"

# 同时清理 recentQueue 与 modules[].features 数组，并重算 totalFeatures
TMP_FILE=$(mktemp)
jq --arg id "$FEATURE_ID" '
  .recentQueue = [(.recentQueue // [])[] | select(.id != $id)]
  | .modules = [.modules[] | .features = [(.features // [])[] | select(. != $id)]]
  | .meta.totalFeatures = ([.modules[].features | length] | add)
' "$CONTEXT_INDEX_FILE" > "$TMP_FILE"
mv "$TMP_FILE" "$CONTEXT_INDEX_FILE"

# Step 6: 清理反向索引（files.json 和 tags.json）
FILES_INDEX="$CONTEXT_PROJECT_DIR/indexes/files.json"
TAGS_INDEX="$CONTEXT_PROJECT_DIR/indexes/tags.json"

if [ -f "$FILES_INDEX" ]; then
  echo "  ✓ 清理文件索引"

  TMP_FILE=$(mktemp)
  # 从所有文件的 features 数组中移除该功能 ID
  jq --arg id "$FEATURE_ID" '
    .index = (.index | with_entries(.value.features = [.value.features[] | select(. != $id)]))
    | .index = (.index | with_entries(select(.value.features | length > 0)))
    | .meta.totalFiles = (.index | length)
  ' "$FILES_INDEX" > "$TMP_FILE"
  mv "$TMP_FILE" "$FILES_INDEX"
fi

if [ -f "$TAGS_INDEX" ]; then
  echo "  ✓ 清理标签索引"

  TMP_FILE=$(mktemp)
  # 从所有标签的数组中移除该功能 ID
  jq --arg id "$FEATURE_ID" '
    .index = (.index | with_entries(.value = [.value[] | select(. != $id)]))
    | .index = (.index | with_entries(select(.value | length > 0)))
    | .meta.totalTags = (.index | length)
  ' "$TAGS_INDEX" > "$TMP_FILE"
  mv "$TMP_FILE" "$TAGS_INDEX"
fi

# Step 7: 归档文档（可选）
DOC_DIR="$CONTEXT_PROJECT_DIR/reference/$MODULE"
ARCHIVE_DIR="$CONTEXT_PROJECT_DIR/.archive/$MODULE"

if [ -d "$DOC_DIR" ]; then
  # 查找可能的文档文件
  DOC_FILE=$(find "$DOC_DIR" -name "*${FEATURE_ID}*.md" 2>/dev/null | head -1)

  if [ -n "$DOC_FILE" ] && [ -f "$DOC_FILE" ]; then
    echo "  ✓ 归档文档到 .archive/"

    mkdir -p "$ARCHIVE_DIR"
    ARCHIVE_FILE="$ARCHIVE_DIR/$(basename "$DOC_FILE").$(date +%Y%m%d)"
    mv "$DOC_FILE" "$ARCHIVE_FILE"

    echo "    文档已移动到: $ARCHIVE_FILE"
  fi
fi

echo ""
echo "✅ 功能已删除！"
echo ""
echo "💡 使用 /k/context list 查看剩余功能"
