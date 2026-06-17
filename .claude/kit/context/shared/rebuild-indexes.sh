#!/bin/bash
# rebuild-indexes.sh - 扫描 router/*.json 重建 indexes/files.json 和 indexes/tags.json
#
# 真相源：router/<module>.json 里的 features[*].quickRef.keyFiles / features[*].tags
# 派生：indexes/files.json / indexes/tags.json
#
# 用法:
#   bash rebuild-indexes.sh --project sodex-web [--dry-run]
#
# 退出码:
#   0 = 重建完成
#   1 = 参数错误 / project 目录不存在 / JSON 解析失败

set -e

PROJECT=""
DRY_RUN=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --project)  PROJECT="$2"; shift 2 ;;
        --dry-run)  DRY_RUN=true; shift ;;
        *) echo "未知参数: $1"; exit 1 ;;
    esac
done

if [ -z "$PROJECT" ]; then
    echo "❌ 缺少 --project 参数"
    echo "用法: bash rebuild-indexes.sh --project <name> [--dry-run]"
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# .../soso-kit/.claude/kit/context/shared → 向上 4 级到 soso-kit 根
KIT_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
PROJECT_DIR="$KIT_ROOT/.claude/kit/context/library/$PROJECT"
INDEXES_DIR="$PROJECT_DIR/indexes"
FILES_INDEX="$INDEXES_DIR/files.json"
TAGS_INDEX="$INDEXES_DIR/tags.json"
ROUTER_DIR="$PROJECT_DIR/router"

if [ ! -d "$PROJECT_DIR" ]; then
    echo "❌ 项目目录不存在: $PROJECT_DIR"
    exit 1
fi

if [ ! -d "$ROUTER_DIR" ]; then
    echo "❌ Router 目录不存在: $ROUTER_DIR"
    exit 1
fi

echo "🔄 重建反向索引: $PROJECT"
echo "   真相源: $ROUTER_DIR/*.json"
$DRY_RUN && echo "   模式: DRY-RUN（不写入文件）"
echo ""

# 临时聚合文件
NEW_FILES=$(mktemp)
NEW_TAGS=$(mktemp)
echo '{"meta":{"lastUpdated":"'"$(date +%Y-%m-%d)"'","totalFiles":0,"description":"文件反向索引：file-path → features[]"},"index":{}}' > "$NEW_FILES"
echo '{"meta":{"lastUpdated":"'"$(date +%Y-%m-%d)"'","totalTags":0,"description":"功能标签索引：tag-name → feature-ids[]"},"index":{}}' > "$NEW_TAGS"

FEATURE_COUNT=0
ROUTER_COUNT=0

for router_file in "$ROUTER_DIR"/*.json; do
    [ -f "$router_file" ] || continue
    ROUTER_COUNT=$((ROUTER_COUNT + 1))

    # 校验 router 文件合法性
    if ! jq empty "$router_file" 2>/dev/null; then
        echo "  ⚠️  跳过非法 JSON: $(basename "$router_file")"
        continue
    fi

    # 遍历该 router 中的所有 feature
    FEATURE_IDS=$(jq -r '.features | keys[]?' "$router_file" 2>/dev/null)
    [ -z "$FEATURE_IDS" ] && continue

    for fid in $FEATURE_IDS; do
        FEATURE_COUNT=$((FEATURE_COUNT + 1))

        # 取这个 feature 的 keyFiles / tags / relatedConcepts / updated
        KEY_FILES=$(jq -r ".features[\"$fid\"].quickRef.keyFiles[]? // empty" "$router_file" 2>/dev/null)
        TAGS=$(jq -r ".features[\"$fid\"].tags[]? // empty" "$router_file" 2>/dev/null)
        RELATED=$(jq -r ".features[\"$fid\"].quickRef.relatedConcepts[]? // empty" "$router_file" 2>/dev/null)
        LAST_UPDATE=$(jq -r ".features[\"$fid\"].updated // .features[\"$fid\"].created // empty" "$router_file" 2>/dev/null)
        [ -z "$LAST_UPDATE" ] && LAST_UPDATE=$(date +%Y-%m-%d)

        # 追加到 files index
        while IFS= read -r file_path; do
            [ -z "$file_path" ] && continue
            TMP=$(mktemp)
            jq --arg p "$file_path" --arg fid "$fid" --arg date "$LAST_UPDATE" '
                if .index[$p] then
                    .index[$p].features |= (if index($fid) then . else . + [$fid] end)
                    | .index[$p].lastUpdate = (if (.index[$p].lastUpdate // "") < $date then $date else .index[$p].lastUpdate end)
                else
                    .index[$p] = {features: [$fid], lastUpdate: $date}
                end
            ' "$NEW_FILES" > "$TMP" && mv "$TMP" "$NEW_FILES"
        done <<< "$KEY_FILES"

        # 追加到 tags index（合并 tags + relatedConcepts）
        ALL_TAGS=$(printf '%s\n%s\n' "$TAGS" "$RELATED" | sort -u | grep -v '^$' || true)
        while IFS= read -r tag; do
            [ -z "$tag" ] && continue
            TMP=$(mktemp)
            jq --arg t "$tag" --arg fid "$fid" '
                if .index[$t] then
                    .index[$t] |= (if index($fid) then . else . + [$fid] end)
                else
                    .index[$t] = [$fid]
                end
            ' "$NEW_TAGS" > "$TMP" && mv "$TMP" "$NEW_TAGS"
        done <<< "$ALL_TAGS"
    done
done

# 更新 meta.totalFiles / totalTags
TMP=$(mktemp)
jq '.meta.totalFiles = (.index | length)' "$NEW_FILES" > "$TMP" && mv "$TMP" "$NEW_FILES"
TMP=$(mktemp)
jq '.meta.totalTags = (.index | length)' "$NEW_TAGS" > "$TMP" && mv "$TMP" "$NEW_TAGS"

NEW_FILES_TOTAL=$(jq '.meta.totalFiles' "$NEW_FILES")
NEW_TAGS_TOTAL=$(jq '.meta.totalTags' "$NEW_TAGS")

# Diff 对比
if [ -f "$FILES_INDEX" ]; then
    OLD_FILES_TOTAL=$(jq '.meta.totalFiles // 0' "$FILES_INDEX" 2>/dev/null || echo 0)
else
    OLD_FILES_TOTAL=0
fi
if [ -f "$TAGS_INDEX" ]; then
    OLD_TAGS_TOTAL=$(jq '.meta.totalTags // 0' "$TAGS_INDEX" 2>/dev/null || echo 0)
else
    OLD_TAGS_TOTAL=0
fi

echo "📊 扫描结果"
echo "   Router 文件: $ROUTER_COUNT"
echo "   Feature 数 : $FEATURE_COUNT"
echo ""
echo "   files.json: $OLD_FILES_TOTAL → $NEW_FILES_TOTAL"
echo "   tags.json : $OLD_TAGS_TOTAL → $NEW_TAGS_TOTAL"
echo ""

if [ "$DRY_RUN" = true ]; then
    echo "💡 dry-run 完成，未写入。新索引预览："
    echo "   $NEW_FILES"
    echo "   $NEW_TAGS"
    exit 0
fi

mkdir -p "$INDEXES_DIR"
mv "$NEW_FILES" "$FILES_INDEX"
mv "$NEW_TAGS" "$TAGS_INDEX"

echo "✅ 重建完成"
echo "   $FILES_INDEX"
echo "   $TAGS_INDEX"
