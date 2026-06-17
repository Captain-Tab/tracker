#!/bin/bash

# 统一更新 Context Library 的 4 个索引文件
# 替代 context-learn Step 5-7 中的多次 Read/Edit 操作
#
# 用法:
#   bash update-all-indexes.sh \
#     --context-dir <CONTEXT_PROJECT_DIR> \
#     --module <module> \
#     --feature <feature.json> \
#     [--date <YYYY-MM-DD>]
#
# feature.json 需包含:
#   id, module, type, title, summary, quickRef, referencePath, sections, tags
#   keyFiles (数组), history (对象: date/type/summary/files)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/record-helpers.sh"

# 参数解析
CONTEXT_DIR=""
MODULE=""
FEATURE_FILE=""
DATE=$(date +%Y-%m-%d)

while [[ $# -gt 0 ]]; do
    case $1 in
        --context-dir) CONTEXT_DIR="$2"; shift 2 ;;
        --module)      MODULE="$2"; shift 2 ;;
        --feature)     FEATURE_FILE="$2"; shift 2 ;;
        --date)        DATE="$2"; shift 2 ;;
        *) echo "未知参数: $1"; exit 1 ;;
    esac
done

if [ -z "$CONTEXT_DIR" ] || [ -z "$MODULE" ] || [ -z "$FEATURE_FILE" ]; then
    echo "❌ 用法: bash update-all-indexes.sh --context-dir <dir> --module <mod> --feature <file.json>"
    exit 1
fi

if [ ! -f "$FEATURE_FILE" ]; then
    echo "❌ feature 文件不存在: $FEATURE_FILE"
    exit 1
fi

# 提取基本信息
FEATURE_ID=$(jq -r '.id' "$FEATURE_FILE")
FEATURE_TYPE=$(jq -r '.type // "feature"' "$FEATURE_FILE")

echo "📚 更新索引: $FEATURE_ID → $MODULE"
echo "   日期: $DATE"
echo ""

# ─── Step 5: 更新 router/<module>.json ───

ROUTER_FILE="$CONTEXT_DIR/router/$MODULE.json"

if [ ! -f "$ROUTER_FILE" ]; then
    echo "❌ Router 文件不存在: $ROUTER_FILE"
    exit 1
fi

echo "Step 5: 更新 router JSON"

# 构建 feature 条目（排除 keyFiles 和 history）
FEATURE_ENTRY=$(jq --arg date "$DATE" \
    'del(.keyFiles, .history) | .created = $date | .updated = $date' \
    "$FEATURE_FILE")

# 插入 feature
jq --arg fid "$FEATURE_ID" --argjson entry "$FEATURE_ENTRY" \
    '.features[$fid] = $entry' \
    "$ROUTER_FILE" > "$ROUTER_FILE.tmp" && mv "$ROUTER_FILE.tmp" "$ROUTER_FILE"

# 插入 history
HAS_HISTORY=$(jq '.history // null' "$FEATURE_FILE")
if [ "$HAS_HISTORY" != "null" ]; then
    HISTORY_ENTRY=$(jq '.history' "$FEATURE_FILE")
    jq --arg fid "$FEATURE_ID" --argjson entry "$HISTORY_ENTRY" \
        '.history[$fid] = [$entry]' \
        "$ROUTER_FILE" > "$ROUTER_FILE.tmp" && mv "$ROUTER_FILE.tmp" "$ROUTER_FILE"
fi

echo "  ✅ router/$MODULE.json: feature + history 已更新"

# ─── Step 6: 更新 context-index.json ───

INDEX_FILE="$CONTEXT_DIR/context-index.json"

echo "Step 6: 更新 context-index.json"

# 截断 summary 到 80 字
SUMMARY=$(jq -r '.summary' "$FEATURE_FILE" | cut -c1-80)

# 添加 featureId 到 module.features（去重）
jq --arg mod "$MODULE" --arg fid "$FEATURE_ID" \
    '(.modules[] | select(.id == $mod) | .features) |= (if index($fid) then . else . + [$fid] end)' \
    "$INDEX_FILE" > "$INDEX_FILE.tmp" && mv "$INDEX_FILE.tmp" "$INDEX_FILE"

# 更新 totalFeatures
jq '.meta.totalFeatures = ([.modules[].features | length] | add)' \
    "$INDEX_FILE" > "$INDEX_FILE.tmp" && mv "$INDEX_FILE.tmp" "$INDEX_FILE"

# 更新 lastUpdated
jq --arg date "${DATE}T00:00:00Z" '.meta.lastUpdated = $date' \
    "$INDEX_FILE" > "$INDEX_FILE.tmp" && mv "$INDEX_FILE.tmp" "$INDEX_FILE"

# 更新 recentQueue（移除同 id → 头部插入 → 保持 ≤10）
QUEUE_ENTRY=$(jq -n \
    --arg id "$FEATURE_ID" \
    --arg mod "$MODULE" \
    --arg date "$DATE" \
    --arg type "$FEATURE_TYPE" \
    --arg summary "$SUMMARY" \
    '{id: $id, module: $mod, date: $date, type: $type, summary: $summary}')

jq --arg fid "$FEATURE_ID" --argjson entry "$QUEUE_ENTRY" \
    '.recentQueue = ([$entry] + [.recentQueue[] | select(.id != $fid)])[0:10]' \
    "$INDEX_FILE" > "$INDEX_FILE.tmp" && mv "$INDEX_FILE.tmp" "$INDEX_FILE"

TOTAL=$(jq '.meta.totalFeatures' "$INDEX_FILE")
echo "  ✅ context-index.json: totalFeatures=$TOTAL, recentQueue 已更新"

# ─── Step 7: 更新反向索引 ───

echo "Step 7: 更新反向索引"

# --- files.json ---
FILES_INDEX="$CONTEXT_DIR/indexes/files.json"
KEY_FILES=$(jq -r '.keyFiles[]' "$FEATURE_FILE")
NEW_FILE_COUNT=0
APPEND_COUNT=0

while IFS= read -r filepath; do
    [ -z "$filepath" ] && continue
    EXISTS=$(jq -r --arg p "$filepath" '.index[$p] // null' "$FILES_INDEX")
    if [ "$EXISTS" = "null" ]; then
        # 新增
        jq --arg p "$filepath" --arg fid "$FEATURE_ID" --arg date "$DATE" \
            '.index[$p] = {features: [$fid], lastUpdate: $date}' \
            "$FILES_INDEX" > "$FILES_INDEX.tmp" && mv "$FILES_INDEX.tmp" "$FILES_INDEX"
        NEW_FILE_COUNT=$((NEW_FILE_COUNT + 1))
    else
        # 追加（去重）
        jq --arg p "$filepath" --arg fid "$FEATURE_ID" --arg date "$DATE" \
            '.index[$p].features |= (if index($fid) then . else . + [$fid] end) | .index[$p].lastUpdate = $date' \
            "$FILES_INDEX" > "$FILES_INDEX.tmp" && mv "$FILES_INDEX.tmp" "$FILES_INDEX"
        APPEND_COUNT=$((APPEND_COUNT + 1))
    fi
done <<< "$KEY_FILES"

# 更新 totalFiles（用实际 key 数量）
jq '.meta.totalFiles = (.index | keys | length) | .meta.lastUpdated = "'$DATE'"' \
    "$FILES_INDEX" > "$FILES_INDEX.tmp" && mv "$FILES_INDEX.tmp" "$FILES_INDEX"

TOTAL_FILES=$(jq '.meta.totalFiles' "$FILES_INDEX")
echo "  ✅ files.json: +$NEW_FILE_COUNT new, $APPEND_COUNT appended (total: $TOTAL_FILES)"

# --- tags.json ---
TAGS_INDEX="$CONTEXT_DIR/indexes/tags.json"
TAGS=$(jq -r '.tags[]' "$FEATURE_FILE")
NEW_TAG_COUNT=0
TAG_APPEND_COUNT=0

while IFS= read -r tag; do
    [ -z "$tag" ] && continue
    EXISTS=$(jq -r --arg t "$tag" '.index[$t] // null' "$TAGS_INDEX")
    if [ "$EXISTS" = "null" ]; then
        # 新增
        jq --arg t "$tag" --arg fid "$FEATURE_ID" \
            '.index[$t] = [$fid]' \
            "$TAGS_INDEX" > "$TAGS_INDEX.tmp" && mv "$TAGS_INDEX.tmp" "$TAGS_INDEX"
        NEW_TAG_COUNT=$((NEW_TAG_COUNT + 1))
    else
        # 追加（去重）
        jq --arg t "$tag" --arg fid "$FEATURE_ID" \
            '.index[$t] |= (if index($fid) then . else . + [$fid] end)' \
            "$TAGS_INDEX" > "$TAGS_INDEX.tmp" && mv "$TAGS_INDEX.tmp" "$TAGS_INDEX"
        TAG_APPEND_COUNT=$((TAG_APPEND_COUNT + 1))
    fi
done <<< "$TAGS"

# 更新 totalTags
jq '.meta.totalTags = (.index | keys | length) | .meta.lastUpdated = "'$DATE'"' \
    "$TAGS_INDEX" > "$TAGS_INDEX.tmp" && mv "$TAGS_INDEX.tmp" "$TAGS_INDEX"

TOTAL_TAGS=$(jq '.meta.totalTags' "$TAGS_INDEX")
echo "  ✅ tags.json: +$NEW_TAG_COUNT new, $TAG_APPEND_COUNT appended (total: $TOTAL_TAGS)"

# ─── Step 7b: 验证 JSON ───

echo ""
echo "Step 7b: 验证 JSON"

ALL_OK=true
for f in "$ROUTER_FILE" "$INDEX_FILE" "$FILES_INDEX" "$TAGS_INDEX"; do
    if validate_json "$f"; then
        echo "  ✅ $(basename "$f") 格式正确"
    else
        echo "  ❌ $(basename "$f") 格式错误"
        ALL_OK=false
    fi
done

if [ "$ALL_OK" = true ]; then
    echo ""
    echo "✅ 全部完成！$FEATURE_ID 已入库"
else
    echo ""
    echo "❌ 存在格式错误，请检查"
    exit 1
fi
