#!/bin/bash
# append-history.sh - 在 router JSON 的 history[feature-id] 数组头部插入新条目
# 用法:
#   bash append-history.sh \
#     --router-file <path> \
#     --feature-id <id> \
#     --date <YYYY-MM-DD> \
#     --type <docs|feat|fix> \
#     --summary <text> \
#     --files <file1,file2,...> \
#     [--history-path <relative-path-to-md>]
#     [--sections-file <json-file>]  # section 级操作数组 [{title, op}]，op ∈ ADDED/MODIFIED/REMOVED
#     [--symbols-file <json-file>]   # outline 符号 diff 对象 {added, removed, modified}

set -e

ROUTER_FILE=""
FEATURE_ID=""
DATE=""
TYPE="docs"
SUMMARY=""
FILES=""
HISTORY_PATH=""
SECTIONS_FILE=""
SYMBOLS_FILE=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --router-file)   ROUTER_FILE="$2";   shift 2 ;;
        --feature-id)    FEATURE_ID="$2";    shift 2 ;;
        --date)          DATE="$2";          shift 2 ;;
        --type)          TYPE="$2";          shift 2 ;;
        --summary)       SUMMARY="$2";       shift 2 ;;
        --files)         FILES="$2";         shift 2 ;;
        --history-path)  HISTORY_PATH="$2";  shift 2 ;;
        --sections-file) SECTIONS_FILE="$2"; shift 2 ;;
        --symbols-file)  SYMBOLS_FILE="$2";  shift 2 ;;
        *) echo "未知参数: $1"; exit 1 ;;
    esac
done

# 参数校验
if [ -z "$ROUTER_FILE" ] || [ ! -f "$ROUTER_FILE" ]; then
    echo "❌ router 文件不存在: $ROUTER_FILE"
    exit 1
fi
if [ -z "$FEATURE_ID" ]; then
    echo "❌ 缺少 --feature-id 参数"
    exit 1
fi
if [ -z "$SUMMARY" ]; then
    echo "❌ 缺少 --summary 参数"
    exit 1
fi
if [ -z "$DATE" ]; then
    DATE=$(date +%Y-%m-%d)
fi

# 可选 sections / symbols 文件校验
if [ -n "$SECTIONS_FILE" ] && [ ! -f "$SECTIONS_FILE" ]; then
    echo "❌ sections 文件不存在: $SECTIONS_FILE"
    exit 1
fi
if [ -n "$SYMBOLS_FILE" ] && [ ! -f "$SYMBOLS_FILE" ]; then
    echo "❌ symbols 文件不存在: $SYMBOLS_FILE"
    exit 1
fi

# 将逗号分隔的文件列表转为 JSON 数组
FILES_JSON="[]"
if [ -n "$FILES" ]; then
    FILES_JSON=$(echo "$FILES" | tr ',' '\n' | jq -R . | jq -s .)
fi

# section 级操作与 outline 符号 diff（缺省为空结构，保持向后兼容）
SECTIONS_JSON="[]"
[ -n "$SECTIONS_FILE" ] && SECTIONS_JSON=$(cat "$SECTIONS_FILE")
SYMBOLS_JSON='{"added":[],"removed":[],"modified":[]}'
[ -n "$SYMBOLS_FILE" ] && SYMBOLS_JSON=$(cat "$SYMBOLS_FILE")

# 构建新的 history 条目；historyPath 仅在提供时写入
NEW_ENTRY=$(jq -n \
    --arg     date        "$DATE" \
    --arg     type        "$TYPE" \
    --arg     summary     "$SUMMARY" \
    --argjson files       "$FILES_JSON" \
    --argjson sections    "$SECTIONS_JSON" \
    --argjson symbols     "$SYMBOLS_JSON" \
    --arg     historyPath "$HISTORY_PATH" \
    '{date: $date, type: $type, summary: $summary, files: $files, sections: $sections, symbols: $symbols}
     + (if $historyPath != "" then {historyPath: $historyPath} else {} end)')

TMP_FILE=$(mktemp)

# 在 history[feature-id] 数组头部插入（若不存在则初始化为空数组）
jq \
    --arg fid "$FEATURE_ID" \
    --argjson entry "$NEW_ENTRY" \
    '.history[$fid] = [$entry] + (.history[$fid] // [])' \
    "$ROUTER_FILE" > "$TMP_FILE"

mv "$TMP_FILE" "$ROUTER_FILE"

if [ -n "$HISTORY_PATH" ]; then
    echo "✅ history 条目已追加: $FEATURE_ID ($DATE) → $HISTORY_PATH"
else
    echo "✅ history 条目已追加: $FEATURE_ID ($DATE)"
fi
