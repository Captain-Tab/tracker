#!/bin/bash
# query-file.sh - 查询文件涉及的功能
# 使用方式: bash query-file.sh <file-path>

FILE_PATH="$1"

if [ -z "$FILE_PATH" ]; then
  echo "❌ 缺少参数: 文件路径"
  echo "使用方式: /k/context file <file-path>"
  exit 1
fi

# 读取文件反向索引
FILES_INDEX="$CONTEXT_PROJECT_DIR/indexes/files.json"

if [ ! -f "$FILES_INDEX" ]; then
  echo "❌ 索引文件不存在: $FILES_INDEX"
  exit 1
fi

# 查询文件
FEATURES=$(jq -r ".index[\"$FILE_PATH\"].features[]?" "$FILES_INDEX" 2>/dev/null)

if [ -z "$FEATURES" ]; then
  echo "ℹ️  Context 索引中未找到: $FILE_PATH"
  echo "   （该文件尚未录入 context library）"
  echo ""

  # 即使不在索引里，也展示文件符号骨架
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  OUTLINE_SH="$SCRIPT_DIR/../tools/outline.sh"
  if [ -f "$OUTLINE_SH" ]; then
    echo "🔍 文件符号骨架"
    bash "$OUTLINE_SH" "$FILE_PATH" "$(pwd)"
  fi
  exit 0
fi

echo "📁 文件涉及的功能"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "文件: $FILE_PATH"
echo ""

# 遍历每个功能 ID，显示详细信息
for feature_id in $FEATURES; do
  # 从 context-index.json 获取功能信息
  FEATURE_INFO=$(jq -r ".recentQueue[] | select(.id==\"$feature_id\")" "$CONTEXT_INDEX_FILE")

  if [ -n "$FEATURE_INFO" ]; then
    MODULE=$(echo "$FEATURE_INFO" | jq -r '.module')
    SUMMARY=$(echo "$FEATURE_INFO" | jq -r '.summary')
    DATE=$(echo "$FEATURE_INFO" | jq -r '.date')

    echo "  ✓ $feature_id ($MODULE)"
    echo "    $SUMMARY"
    echo "    更新: $DATE"
    echo ""
  fi
done

echo "💡 查看详情: /k/context load <feature-id>"

# 附加文件符号骨架
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTLINE_SH="$SCRIPT_DIR/../tools/outline.sh"

if [ -f "$OUTLINE_SH" ]; then
    echo ""
    echo "──────────────────────────────────────"
    echo "🔍 文件符号骨架 (无需读全文可定位函数)"
    bash "$OUTLINE_SH" "$FILE_PATH" "$(pwd)"
fi
