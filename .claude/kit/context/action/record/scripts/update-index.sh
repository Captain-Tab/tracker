#!/bin/bash

# 更新 context-index.json

set -e

# 加载辅助函数
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/record-helpers.sh"

# 参数解析
FEATURE_ID=""
MODULE=""
CHANGE_TYPE=""
SUMMARY=""
ADD_TO_QUEUE=false
CONTEXT_INDEX_FILE=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --feature-id)
            FEATURE_ID="$2"
            shift 2
            ;;
        --module)
            MODULE="$2"
            shift 2
            ;;
        --type)
            CHANGE_TYPE="$2"
            shift 2
            ;;
        --summary)
            SUMMARY="$2"
            shift 2
            ;;
        --add-to-queue)
            ADD_TO_QUEUE=true
            shift
            ;;
        --index-file)
            CONTEXT_INDEX_FILE="$2"
            shift 2
            ;;
        *)
            echo "未知参数: $1"
            exit 1
            ;;
    esac
done

# 验证必需参数
if [ -z "$FEATURE_ID" ] || [ -z "$MODULE" ] || [ -z "$CONTEXT_INDEX_FILE" ]; then
    echo "❌ 缺少必需参数"
    exit 1
fi

# 检查索引文件是否存在
if [ ! -f "$CONTEXT_INDEX_FILE" ]; then
    echo "❌ 索引文件不存在: $CONTEXT_INDEX_FILE"
    exit 1
fi

# 备份
BACKUP=$(backup_file "$CONTEXT_INDEX_FILE")
if [ -n "$BACKUP" ]; then
    echo "📦 已备份: $BACKUP"
fi

# 更新 meta.lastUpdated
jq ".meta.lastUpdated = \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"" "$CONTEXT_INDEX_FILE" > "$CONTEXT_INDEX_FILE.tmp"
mv "$CONTEXT_INDEX_FILE.tmp" "$CONTEXT_INDEX_FILE"

# 检查功能是否已在模块的 features 数组中
FEATURE_IN_MODULE=$(jq -r ".modules[] | select(.id==\"$MODULE\") | .features[] | select(.==\"$FEATURE_ID\")" "$CONTEXT_INDEX_FILE")

if [ -z "$FEATURE_IN_MODULE" ]; then
    echo "➕ 添加功能到模块: $MODULE"

    # 添加功能 ID 到模块的 features 数组
    jq "(.modules[] | select(.id==\"$MODULE\") | .features) += [\"$FEATURE_ID\"]" "$CONTEXT_INDEX_FILE" > "$CONTEXT_INDEX_FILE.tmp"
    mv "$CONTEXT_INDEX_FILE.tmp" "$CONTEXT_INDEX_FILE"

    # 更新 totalFeatures
    jq ".meta.totalFeatures = (.modules | map(.features | length) | add)" "$CONTEXT_INDEX_FILE" > "$CONTEXT_INDEX_FILE.tmp"
    mv "$CONTEXT_INDEX_FILE.tmp" "$CONTEXT_INDEX_FILE"
fi

# 添加到 recentQueue（如果指定）
if [ "$ADD_TO_QUEUE" = true ] && [ -n "$CHANGE_TYPE" ] && [ -n "$SUMMARY" ]; then
    echo "📝 添加到 recentQueue"

    # 构建 recentQueue 条目
    QUEUE_ENTRY=$(cat <<EOF
{
  "id": "$FEATURE_ID",
  "module": "$MODULE",
  "date": "$(date +%Y-%m-%d)",
  "type": "$CHANGE_TYPE",
  "summary": "$SUMMARY"
}
EOF
)

    # 添加到 recentQueue 开头，保留最多 10 条
    jq ".recentQueue = [$QUEUE_ENTRY] + .recentQueue | .recentQueue |= .[0:10]" "$CONTEXT_INDEX_FILE" > "$CONTEXT_INDEX_FILE.tmp"
    mv "$CONTEXT_INDEX_FILE.tmp" "$CONTEXT_INDEX_FILE"
fi

# 验证 JSON
if ! validate_json "$CONTEXT_INDEX_FILE"; then
    echo "⚠️  JSON 格式错误，回滚"
    if [ -n "$BACKUP" ]; then
        cp "$BACKUP" "$CONTEXT_INDEX_FILE"
    fi
    exit 1
fi

echo "✅ 索引已更新: $CONTEXT_INDEX_FILE"
