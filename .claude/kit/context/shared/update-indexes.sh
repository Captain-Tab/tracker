#!/bin/bash
# update-indexes.sh - 维护文件反向索引和标签索引
# 使用方式: bash update-indexes.sh --project sodex-web --feature-id vault-deposit-01

set -e

# 加载辅助函数
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RECORD_HELPERS="$SCRIPT_DIR/../action/record/scripts/record-helpers.sh"
if [ -f "$RECORD_HELPERS" ]; then
    source "$RECORD_HELPERS"
fi

# 参数解析
PROJECT=""
FEATURE_ID=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --project)
      PROJECT="$2"
      shift 2
      ;;
    --feature-id)
      FEATURE_ID="$2"
      shift 2
      ;;
    *)
      echo "未知参数: $1"
      exit 1
      ;;
  esac
done

if [ -z "$PROJECT" ] || [ -z "$FEATURE_ID" ]; then
  echo "错误: 缺少必需参数"
  echo "使用方式: bash update-indexes.sh --project sodex-web --feature-id vault-deposit-01"
  exit 1
fi

# 路径定义
LIBRARY_DIR=".claude/kit/context/library"
PROJECT_DIR="$LIBRARY_DIR/$PROJECT"
INDEXES_DIR="$PROJECT_DIR/indexes"
FILES_INDEX="$INDEXES_DIR/files.json"
TAGS_INDEX="$INDEXES_DIR/tags.json"

# 确保索引目录存在
mkdir -p "$INDEXES_DIR"

# 初始化索引文件（如果不存在）
if [ ! -f "$FILES_INDEX" ]; then
  echo '{
  "meta": {
    "lastUpdated": "'$(date +%Y-%m-%d)'",
    "totalFiles": 0,
    "description": "文件反向索引：file-path → features[]，用于快速查询「这个文件涉及哪些功能」"
  },
  "index": {}
}' > "$FILES_INDEX"
fi

if [ ! -f "$TAGS_INDEX" ]; then
  echo '{
  "meta": {
    "lastUpdated": "'$(date +%Y-%m-%d)'",
    "totalTags": 0,
    "description": "功能标签索引：tag-name → feature-ids[]，用于查询「哪些功能使用了状态机/桥接模式等概念」"
  },
  "index": {}
}' > "$TAGS_INDEX"
fi

# 查找功能所属的 module
MODULE=""
for router_file in "$PROJECT_DIR"/router/*.json; do
  if [ ! -f "$router_file" ]; then
    continue
  fi

  # 检查此 router 文件是否包含该 feature-id
  if jq -e ".features.\"$FEATURE_ID\"" "$router_file" > /dev/null 2>&1; then
    MODULE=$(jq -r '.module' "$router_file")
    ROUTER_FILE="$router_file"
    break
  fi
done

if [ -z "$MODULE" ]; then
  echo "警告: 未找到 feature-id=$FEATURE_ID 对应的 module，跳过索引更新"
  exit 0
fi

# 批量备份 + ERR trap
CONTEXT_INDEX="$PROJECT_DIR/context-index.json"
if type backup_batch &>/dev/null; then
    BATCH_BACKUP_DIR=$(backup_batch "$FILES_INDEX" "$TAGS_INDEX" "$CONTEXT_INDEX")
    echo "📦 批量备份: $BATCH_BACKUP_DIR"

    rollback_on_error() {
        echo ""
        echo "⚠️  写入失败，正在回滚..."
        rollback_batch "$BATCH_BACKUP_DIR" "$FILES_INDEX" "$TAGS_INDEX" "$CONTEXT_INDEX"
        echo "↩️  已回滚到备份状态"
    }
    trap rollback_on_error ERR
fi

echo "📋 更新索引: feature-id=$FEATURE_ID, module=$MODULE"

# 提取功能数据
FEATURE_DATA=$(jq ".features.\"$FEATURE_ID\"" "$ROUTER_FILE")
KEY_FILES=$(echo "$FEATURE_DATA" | jq -r '.quickRef.keyFiles[]?' 2>/dev/null || echo "")
TAGS=$(echo "$FEATURE_DATA" | jq -r '.tags[]?' 2>/dev/null || echo "")
RELATED_CONCEPTS=$(echo "$FEATURE_DATA" | jq -r '.quickRef.relatedConcepts[]?' 2>/dev/null || echo "")
LAST_UPDATE=$(echo "$FEATURE_DATA" | jq -r '.updated // .created' 2>/dev/null || date +%Y-%m-%d)

# 0. 无条件 prune：清掉当前 feature 在两个反向索引里的所有旧引用
#    场景：用户在 update 时删除某个 keyFile / tag，必须同步清空旧映射，否则查询会指错
TMP_PRUNE=$(mktemp)
jq --arg fid "$FEATURE_ID" '
  .index = (.index | with_entries(.value.features = [(.value.features // [])[] | select(. != $fid)]))
  | .index = (.index | with_entries(select(.value.features | length > 0)))
  | .meta.totalFiles = (.index | length)
' "$FILES_INDEX" > "$TMP_PRUNE" && mv "$TMP_PRUNE" "$FILES_INDEX"

TMP_PRUNE=$(mktemp)
jq --arg fid "$FEATURE_ID" '
  .index = (.index | with_entries(.value = [(.value // [])[] | select(. != $fid)]))
  | .index = (.index | with_entries(select(.value | length > 0)))
  | .meta.totalTags = (.index | length)
' "$TAGS_INDEX" > "$TMP_PRUNE" && mv "$TMP_PRUNE" "$TAGS_INDEX"

# 1. 更新文件反向索引
if [ -n "$KEY_FILES" ]; then
  echo "  更新文件索引..."
  TEMP_FILES_INDEX=$(mktemp)
  TEMP_FILES_INDEX_NEW=$(mktemp)

  # 读取现有索引（已被 prune 过）
  cp "$FILES_INDEX" "$TEMP_FILES_INDEX"

  # 遍历每个文件路径
  for file_path in $KEY_FILES; do
    # 检查文件是否已存在
    if jq -e ".index.\"$file_path\"" "$TEMP_FILES_INDEX" > /dev/null 2>&1; then
      # 文件已存在，添加 feature-id 到 features 数组（如果尚未包含）
      jq \
        --arg file "$file_path" \
        --arg fid "$FEATURE_ID" \
        --arg date "$LAST_UPDATE" \
        '.index[$file].features |= (if . | index($fid) then . else . + [$fid] end) |
         .index[$file].lastUpdate = $date' \
        "$TEMP_FILES_INDEX" > "$TEMP_FILES_INDEX_NEW"
      mv "$TEMP_FILES_INDEX_NEW" "$TEMP_FILES_INDEX"
    else
      # 新文件，创建条目
      jq \
        --arg file "$file_path" \
        --arg fid "$FEATURE_ID" \
        --arg date "$LAST_UPDATE" \
        '.index[$file] = {features: [$fid], lastUpdate: $date}' \
        "$TEMP_FILES_INDEX" > "$TEMP_FILES_INDEX_NEW"
      mv "$TEMP_FILES_INDEX_NEW" "$TEMP_FILES_INDEX"
    fi
  done

  # 更新 meta
  TOTAL_FILES=$(jq '.index | length' "$TEMP_FILES_INDEX")
  jq \
    --arg date "$(date +%Y-%m-%d)" \
    --argjson total "$TOTAL_FILES" \
    '.meta.lastUpdated = $date | .meta.totalFiles = $total' \
    "$TEMP_FILES_INDEX" > "$FILES_INDEX"

  rm "$TEMP_FILES_INDEX" "$TEMP_FILES_INDEX_NEW" 2>/dev/null || true
  echo "    ✅ 文件索引已更新 ($TOTAL_FILES 个文件)"
fi

# 2. 更新标签索引
ALL_TAGS=$(echo -e "$TAGS\n$RELATED_CONCEPTS" | sort -u | grep -v '^$')

if [ -n "$ALL_TAGS" ]; then
  echo "  更新标签索引..."
  TEMP_TAGS_INDEX=$(mktemp)
  TEMP_TAGS_INDEX_NEW=$(mktemp)

  # 读取现有索引（已被外层 prune 过）
  cp "$TAGS_INDEX" "$TEMP_TAGS_INDEX"

  # 遍历每个标签
  for tag in $ALL_TAGS; do
    # 检查标签是否已存在
    if jq -e ".index.\"$tag\"" "$TEMP_TAGS_INDEX" > /dev/null 2>&1; then
      # 标签已存在，添加 feature-id（如果尚未包含）
      jq \
        --arg tag "$tag" \
        --arg fid "$FEATURE_ID" \
        '.index[$tag] |= (if . | index($fid) then . else . + [$fid] end)' \
        "$TEMP_TAGS_INDEX" > "$TEMP_TAGS_INDEX_NEW"
      mv "$TEMP_TAGS_INDEX_NEW" "$TEMP_TAGS_INDEX"
    else
      # 新标签，创建条目
      jq \
        --arg tag "$tag" \
        --arg fid "$FEATURE_ID" \
        '.index[$tag] = [$fid]' \
        "$TEMP_TAGS_INDEX" > "$TEMP_TAGS_INDEX_NEW"
      mv "$TEMP_TAGS_INDEX_NEW" "$TEMP_TAGS_INDEX"
    fi
  done

  # 更新 meta
  TOTAL_TAGS=$(jq '.index | length' "$TEMP_TAGS_INDEX")
  jq \
    --arg date "$(date +%Y-%m-%d)" \
    --argjson total "$TOTAL_TAGS" \
    '.meta.lastUpdated = $date | .meta.totalTags = $total' \
    "$TEMP_TAGS_INDEX" > "$TAGS_INDEX"

  rm "$TEMP_TAGS_INDEX" "$TEMP_TAGS_INDEX_NEW" 2>/dev/null || true
  echo "    ✅ 标签索引已更新 ($TOTAL_TAGS 个标签)"
fi

# 3. 更新 context-index.json recentQueue
CONTEXT_INDEX="$PROJECT_DIR/context-index.json"
if [ -f "$CONTEXT_INDEX" ]; then
  echo "  更新 recentQueue..."

  FEATURE_TITLE=$(echo "$FEATURE_DATA"   | jq -r '.title // ""')
  FEATURE_MODULE=$(echo "$FEATURE_DATA"  | jq -r '.module // ""')
  FEATURE_SUMMARY=$(echo "$FEATURE_DATA" | jq -r '.summary // ""')
  FEATURE_UPDATED=$(echo "$FEATURE_DATA" | jq -r '.updated // .created // ""')
  FEATURE_TYPE=$(echo "$FEATURE_DATA"    | jq -r '.type // "docs"')

  # summary 截断到 80 字（用 python3 按 Unicode 字符数截断，避免汉字多字节被截断）
  SHORT_SUMMARY=$(echo "$FEATURE_SUMMARY" | python3 -c "import sys; s=sys.stdin.read().rstrip('\n'); print(s[:80])")

  NEW_ENTRY=$(jq -n \
    --arg id      "$FEATURE_ID" \
    --arg module  "$FEATURE_MODULE" \
    --arg date    "$FEATURE_UPDATED" \
    --arg type    "$FEATURE_TYPE" \
    --arg summary "$SHORT_SUMMARY" \
    '{id: $id, module: $module, date: $date, type: $type, summary: $summary}')

  TMP_INDEX=$(mktemp)
  # 移除同 id 的旧条目，头部插入新条目，保持最多 10 条
  # 使用 (.recentQueue // []) 防止 recentQueue 字段缺失时报错
  if jq --argjson entry "$NEW_ENTRY" \
        --arg id "$FEATURE_ID" \
        '.recentQueue = [$entry] + [(.recentQueue // [])[] | select(.id != $id)] | .recentQueue = .recentQueue[0:10]' \
        "$CONTEXT_INDEX" > "$TMP_INDEX" 2>/dev/null; then
    mv "$TMP_INDEX" "$CONTEXT_INDEX"
    echo "    ✅ recentQueue 已更新"
  else
    rm -f "$TMP_INDEX"
    echo "    ⚠️  recentQueue 更新失败（跳过，不影响其他索引）"
  fi
fi

# 跨文件一致性校验
if type validate_integrity &>/dev/null; then
    echo ""
    if ! validate_integrity "$PROJECT_DIR"; then
        echo "⚠️  一致性校验发现问题（不阻塞，仅警告）"
    fi
fi

# 写入成功，解除 trap
trap - ERR 2>/dev/null || true
echo "✅ 索引更新完成"
