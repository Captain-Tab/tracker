#!/bin/bash
# remove-from-index.sh - 从 index.json、index.md 中移除 pitfall，并删除文件
# Usage: bash remove-from-index.sh <id>
# ⚠️  调用前应已获得用户确认，此脚本直接执行删除
#
# 依赖环境变量: CONTEXT_PROJECT_DIR

ID="$1"
INDEX_JSON="${CONTEXT_PROJECT_DIR}/pitfalls/index.json"
INDEX_MD="${CONTEXT_PROJECT_DIR}/pitfalls/index.md"
PITFALL_FILE="${CONTEXT_PROJECT_DIR}/pitfalls/${ID}.md"

if [ -z "$ID" ]; then
  echo "❌ 缺少参数: pitfall ID"
  exit 1
fi

if [ ! -f "$INDEX_JSON" ]; then
  echo "❌ index.json 不存在"
  exit 1
fi

# 校验 ID 存在
EXISTS=$(jq -r --arg id "$ID" '.pitfalls[] | select(.id == $id) | .id' "$INDEX_JSON" 2>/dev/null)
if [ -z "$EXISTS" ]; then
  echo "❌ 未找到 pitfall ID: $ID"
  exit 1
fi

TODAY=$(date +%Y-%m-%d)

# 从 index.json 移除条目
jq --arg id "$ID" --arg today "$TODAY" \
  '.pitfalls = [.pitfalls[] | select(.id != $id)] | .meta.lastUpdated = $today' \
  "$INDEX_JSON" > "${INDEX_JSON}.tmp" && mv "${INDEX_JSON}.tmp" "$INDEX_JSON"

# 从 index.md 移除对应行
if [ -f "$INDEX_MD" ]; then
  grep -v "^| ${ID} " "$INDEX_MD" > "${INDEX_MD}.tmp" && mv "${INDEX_MD}.tmp" "$INDEX_MD"
fi

# 删除 pitfall 文件
if [ -f "$PITFALL_FILE" ]; then
  rm "$PITFALL_FILE"
  echo "✅ 已删除文件: ${ID}.md"
fi

echo "✅ 已移除 pitfall: $ID"
echo "   index.json + index.md 已同步"
