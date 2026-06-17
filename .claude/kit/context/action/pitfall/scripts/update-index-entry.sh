#!/bin/bash
# update-index-entry.sh - 更新 index.json 中指定 pitfall 的元数据字段并重算 token
# Usage: bash update-index-entry.sh <id>
# 脚本自动重算 estimatedTokens，更新 lastUpdated
# 其他字段（tags/summary/severity/related_feature）由调用方通过环境变量传入（可选）
#
# 环境变量（可选，不传则保持原值）:
#   UPDATE_TAGS_CSV   - 新 tags（逗号分隔）
#   UPDATE_SUMMARY    - 新 summary
#   UPDATE_SEVERITY   - 新 severity
#   UPDATE_RELATED    - 新 related_feature
#   UPDATE_GATE       - 新 gate（true/false）
#   UPDATE_GATE_RULE  - 新 gate_rule
#
# 依赖环境变量: CONTEXT_PROJECT_DIR

ID="$1"
INDEX_JSON="${CONTEXT_PROJECT_DIR}/pitfalls/index.json"
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
  jq -r '.pitfalls[].id' "$INDEX_JSON"
  exit 1
fi

# 重算 estimatedTokens
if [ -f "$PITFALL_FILE" ]; then
  CHARS=$(wc -c < "$PITFALL_FILE" | tr -d ' ')
  TOKENS=$(( CHARS / 4 ))
else
  TOKENS=$(jq -r --arg id "$ID" '.pitfalls[] | select(.id == $id) | .estimatedTokens' "$INDEX_JSON")
fi

TODAY=$(date +%Y-%m-%d)

# 构建 jq 更新表达式（只更新传入的字段）
JQ_FILTER='.pitfalls = [.pitfalls[] | if .id == $id then . + {"estimatedTokens": $tokens} else . end] | .meta.lastUpdated = $today'

TMP=$(jq --arg id "$ID" --argjson tokens "$TOKENS" --arg today "$TODAY" "$JQ_FILTER" "$INDEX_JSON")

# 可选字段更新
if [ -n "$UPDATE_TAGS_CSV" ]; then
  TAGS_JSON=$(echo "$UPDATE_TAGS_CSV" | tr ',' '\n' | jq -R . | jq -s .)
  TMP=$(echo "$TMP" | jq --arg id "$ID" --argjson tags "$TAGS_JSON" \
    '.pitfalls = [.pitfalls[] | if .id == $id then .tags = $tags else . end]')
fi

if [ -n "$UPDATE_SUMMARY" ]; then
  TMP=$(echo "$TMP" | jq --arg id "$ID" --arg summary "$UPDATE_SUMMARY" \
    '.pitfalls = [.pitfalls[] | if .id == $id then .summary = $summary else . end]')
fi

if [ -n "$UPDATE_SEVERITY" ]; then
  TMP=$(echo "$TMP" | jq --arg id "$ID" --arg severity "$UPDATE_SEVERITY" \
    '.pitfalls = [.pitfalls[] | if .id == $id then .severity = $severity else . end]')
fi

if [ -n "$UPDATE_RELATED" ]; then
  TMP=$(echo "$TMP" | jq --arg id "$ID" --arg related "$UPDATE_RELATED" \
    '.pitfalls = [.pitfalls[] | if .id == $id then .related_feature = $related else . end]')
fi

if [ -n "$UPDATE_GATE" ]; then
  if [ "$UPDATE_GATE" = "true" ]; then
    GATE_BOOL="true"
  else
    GATE_BOOL="false"
  fi
  TMP=$(echo "$TMP" | jq --arg id "$ID" --argjson gate "$GATE_BOOL" \
    '.pitfalls = [.pitfalls[] | if .id == $id then .gate = $gate else . end]')
fi

if [ -n "$UPDATE_GATE_RULE" ]; then
  TMP=$(echo "$TMP" | jq --arg id "$ID" --arg gate_rule "$UPDATE_GATE_RULE" \
    '.pitfalls = [.pitfalls[] | if .id == $id then .gate_rule = $gate_rule else . end]')
fi

echo "$TMP" > "$INDEX_JSON"

echo "✅ 已更新 pitfall: $ID"
echo "   estimatedTokens: ~${TOKENS}"
echo "   index.json 已同步"
