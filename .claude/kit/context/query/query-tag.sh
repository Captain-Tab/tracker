#!/bin/bash
# query-tag.sh - 查询使用某标签的功能
# 使用方式: bash query-tag.sh <tag-name>

TAG_NAME="$1"

if [ -z "$TAG_NAME" ]; then
  echo "❌ 缺少参数: 标签名"
  echo "使用方式: /k/context tag <tag-name>"
  exit 1
fi

# 读取标签索引
TAGS_INDEX="$CONTEXT_PROJECT_DIR/indexes/tags.json"

if [ ! -f "$TAGS_INDEX" ]; then
  echo "❌ 索引文件不存在: $TAGS_INDEX"
  exit 1
fi

# 查询标签
FEATURES=$(jq -r ".index[\"$TAG_NAME\"][]?" "$TAGS_INDEX" 2>/dev/null)

if [ -z "$FEATURES" ]; then
  echo "ℹ️  未找到标签: $TAG_NAME"
  echo ""
  echo "💡 可用标签:"
  jq -r '.index | keys[]' "$TAGS_INDEX" | head -10
  exit 0
fi

echo "🏷️  使用标签 '$TAG_NAME' 的功能"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# 遍历每个功能 ID
for feature_id in $FEATURES; do
  FEATURE_INFO=$(jq -r ".recentQueue[] | select(.id==\"$feature_id\")" "$CONTEXT_INDEX_FILE")

  if [ -n "$FEATURE_INFO" ]; then
    MODULE=$(echo "$FEATURE_INFO" | jq -r '.module')
    SUMMARY=$(echo "$FEATURE_INFO" | jq -r '.summary')

    echo "  ✓ $feature_id ($MODULE)"
    echo "    $SUMMARY"
    echo ""
  fi
done

echo "💡 查看详情: /k/context load <feature-id>"
