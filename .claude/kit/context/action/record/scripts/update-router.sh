#!/bin/bash

# 更新 router 配置文件

set -e

# 加载辅助函数
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/record-helpers.sh"

# 参数解析
MODULE=""
FEATURE_ID=""
CHANGE_TYPE=""
TITLE=""
SUMMARY=""
QUICK_REF_JSON=""
SECTIONS_JSON=""
TAGS=""
REFERENCE_PATH=""
HISTORY_PATH=""
FILES=""
CONTEXT_PROJECT_DIR=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --module)
            MODULE="$2"
            shift 2
            ;;
        --feature-id)
            FEATURE_ID="$2"
            shift 2
            ;;
        --type)
            CHANGE_TYPE="$2"
            shift 2
            ;;
        --title)
            TITLE="$2"
            shift 2
            ;;
        --summary)
            SUMMARY="$2"
            shift 2
            ;;
        --quick-ref)
            QUICK_REF_JSON="$2"
            shift 2
            ;;
        --sections)
            SECTIONS_JSON="$2"
            shift 2
            ;;
        --tags)
            TAGS="$2"
            shift 2
            ;;
        --reference-path)
            REFERENCE_PATH="$2"
            shift 2
            ;;
        --history-path)
            HISTORY_PATH="$2"
            shift 2
            ;;
        --files)
            FILES="$2"
            shift 2
            ;;
        --context-dir)
            CONTEXT_PROJECT_DIR="$2"
            shift 2
            ;;
        *)
            echo "未知参数: $1"
            exit 1
            ;;
    esac
done

# 验证必需参数
if [ -z "$MODULE" ] || [ -z "$FEATURE_ID" ] || [ -z "$CONTEXT_PROJECT_DIR" ]; then
    echo "❌ 缺少必需参数"
    exit 1
fi

ROUTER_FILE="$CONTEXT_PROJECT_DIR/router/$MODULE.json"

# 检查 router 文件是否存在
if [ ! -f "$ROUTER_FILE" ]; then
    echo "❌ Router 配置不存在: $ROUTER_FILE"
    exit 1
fi

# 备份
BACKUP=$(backup_file "$ROUTER_FILE")
if [ -n "$BACKUP" ]; then
    echo "📦 已备份: $BACKUP"
fi

# 内容哈希去重检测
HASH_INPUT=$(jq -n --arg s "$SUMMARY" --arg t "$TAGS" --arg f "$FILES" '{summary: $s, tags: $t, files: $f}')
NEW_HASH=$(compute_content_hash "$HASH_INPUT")

FEATURE_EXISTS=$(jq -r ".features.\"$FEATURE_ID\" // null" "$ROUTER_FILE")

if [ "$FEATURE_EXISTS" != "null" ]; then
    EXISTING_ENTRY=$(jq -Sc ".features.\"$FEATURE_ID\" | {summary, tags, files: .quickRef.keyFiles}" "$ROUTER_FILE")
    EXISTING_HASH=$(compute_content_hash "$EXISTING_ENTRY")

    if [ "$NEW_HASH" = "$EXISTING_HASH" ]; then
        echo "⏭️  内容哈希相同($NEW_HASH)，跳过重复写入"
        exit 0
    fi
    echo "🔄 内容已变更 ($EXISTING_HASH → $NEW_HASH)"
else
    echo "🆕 新功能 ($NEW_HASH)"
fi

if [ "$FEATURE_EXISTS" = "null" ]; then
    # 新增功能
    echo "➕ 新增功能: $FEATURE_ID"

    # 准备 tags 数组
    TAGS_ARRAY=$(echo "$TAGS" | tr ',' '\n' | awk '{printf "\"%s\",", $0}' | sed 's/,$//')

    # 构建新功能 JSON
    NEW_FEATURE=$(cat <<EOF
{
  "id": "$FEATURE_ID",
  "module": "$MODULE",
  "type": "feature",
  "title": "$TITLE",
  "summary": "$SUMMARY",
  "quickRef": $QUICK_REF_JSON,
  "referencePath": "$REFERENCE_PATH",
  "sections": $SECTIONS_JSON,
  "tags": [$TAGS_ARRAY],
  "created": "$(date +%Y-%m-%d)",
  "updated": "$(date +%Y-%m-%d)",
  "lastVerified": "$(date +%Y-%m-%d)"
}
EOF
)

    # 使用 jq 添加到 features
    jq ".features.\"$FEATURE_ID\" = $NEW_FEATURE" "$ROUTER_FILE" > "$ROUTER_FILE.tmp"
    mv "$ROUTER_FILE.tmp" "$ROUTER_FILE"
fi

# 添加历史记录（如果提供了 history_path）
if [ -n "$HISTORY_PATH" ]; then
    echo "📝 添加历史记录"

    # 准备 files 数组
    FILES_ARRAY=$(echo "$FILES" | tr ',' '\n' | awk '{printf "\"%s\",", $0}' | sed 's/,$//')

    # 构建历史记录 JSON
    HISTORY_ENTRY=$(cat <<EOF
{
  "date": "$(date +%Y-%m-%d)",
  "type": "$CHANGE_TYPE",
  "summary": "$SUMMARY",
  "files": [$FILES_ARRAY],
  "historyPath": "$HISTORY_PATH"
}
EOF
)

    # 使用 jq 添加到 history
    jq ".history.\"$FEATURE_ID\" |= (if . then [($HISTORY_ENTRY)] + . else [$HISTORY_ENTRY] end)" "$ROUTER_FILE" > "$ROUTER_FILE.tmp"
    mv "$ROUTER_FILE.tmp" "$ROUTER_FILE"
fi

# 验证 JSON
if ! validate_json "$ROUTER_FILE"; then
    echo "⚠️  JSON 格式错误，回滚"
    if [ -n "$BACKUP" ]; then
        cp "$BACKUP" "$ROUTER_FILE"
    fi
    exit 1
fi

echo "✅ Router 配置已更新: $ROUTER_FILE"
