#!/bin/bash
# add-to-index.sh - 新增 pitfall 条目到 index.json 和 index.md
# Usage: bash add-to-index.sh <id> <tags_csv> <title> <summary> <related_feature> <severity> <date> [gate] [gate_rule] [trigger_csv]
# Example: bash add-to-index.sh "my-bug" "mobx,react" "MobX 问题" "组件不渲染" "trade-feerate" "high" "2026-03-26" "true" "新建 store 时确认 makeObservable" "store,mobx,observable"
#
# 依赖环境变量: CONTEXT_PROJECT_DIR

ID="$1"
TAGS_CSV="$2"
TITLE="$3"
SUMMARY="$4"
RELATED_FEATURE="$5"
SEVERITY="$6"
DATE="$7"
GATE="${8:-false}"
GATE_RULE="${9:-}"
TRIGGER_CSV="${10:-}"

INDEX_JSON="${CONTEXT_PROJECT_DIR}/pitfalls/index.json"
INDEX_MD="${CONTEXT_PROJECT_DIR}/pitfalls/index.md"
PITFALL_FILE="${CONTEXT_PROJECT_DIR}/pitfalls/${ID}.md"

# 参数校验
if [ -z "$ID" ] || [ -z "$TAGS_CSV" ] || [ -z "$TITLE" ] || [ -z "$SUMMARY" ] || [ -z "$RELATED_FEATURE" ] || [ -z "$SEVERITY" ] || [ -z "$DATE" ]; then
  echo "❌ 缺少参数"
  echo "用法: bash add-to-index.sh <id> <tags_csv> <title> <summary> <related_feature> <severity> <date>"
  exit 1
fi

if [ ! -f "$INDEX_JSON" ]; then
  echo "❌ index.json 不存在: $INDEX_JSON"
  exit 1
fi

# 检查 ID 是否已存在
EXISTS=$(jq -r --arg id "$ID" '.pitfalls[] | select(.id == $id) | .id' "$INDEX_JSON" 2>/dev/null)
if [ -n "$EXISTS" ]; then
  echo "❌ Pitfall ID 已存在: $ID（如需修改请用 update-index-entry.sh）"
  exit 1
fi

# 计算 estimatedTokens（文件字节数 / 4）
if [ -f "$PITFALL_FILE" ]; then
  CHARS=$(wc -c < "$PITFALL_FILE" | tr -d ' ')
  TOKENS=$(( CHARS / 4 ))
else
  TOKENS=0
fi

# 将 tags csv 转为 JSON 数组
TAGS_JSON=$(echo "$TAGS_CSV" | tr ',' '\n' | jq -R . | jq -s .)

# 将 trigger csv 转为 JSON 数组（可选）
if [ -n "$TRIGGER_CSV" ]; then
  TRIGGER_JSON=$(echo "$TRIGGER_CSV" | tr ',' '\n' | jq -R . | jq -s .)
else
  TRIGGER_JSON="null"
fi

TODAY=$(date +%Y-%m-%d)

# 更新 index.json（追加条目 + 更新 lastUpdated）
# gate 转为 JSON boolean
if [ "$GATE" = "true" ]; then
  GATE_BOOL="true"
else
  GATE_BOOL="false"
fi

jq --arg id "$ID" \
   --argjson tags "$TAGS_JSON" \
   --arg title "$TITLE" \
   --arg summary "$SUMMARY" \
   --arg related_feature "$RELATED_FEATURE" \
   --arg severity "$SEVERITY" \
   --arg date "$DATE" \
   --arg path "pitfalls/${ID}.md" \
   --argjson tokens "$TOKENS" \
   --argjson gate "$GATE_BOOL" \
   --arg gate_rule "$GATE_RULE" \
   --argjson trigger "$TRIGGER_JSON" \
   --arg today "$TODAY" \
   '.pitfalls += [{
     "id": $id,
     "tags": $tags,
     "title": $title,
     "summary": $summary,
     "related_feature": $related_feature,
     "severity": $severity,
     "date": $date,
     "path": $path,
     "estimatedTokens": $tokens,
     "gate": $gate,
     "gate_rule": $gate_rule,
     "trigger": $trigger
   }] | .meta.lastUpdated = $today' \
   "$INDEX_JSON" > "${INDEX_JSON}.tmp" && mv "${INDEX_JSON}.tmp" "$INDEX_JSON"

# 更新 index.md（追加表格行）
TAGS_DISPLAY=$(echo "$TAGS_CSV" | tr ',' ',')
echo "| ${ID} | ${TAGS_DISPLAY} | ${TITLE} | ${SUMMARY} |" >> "$INDEX_MD"

echo "✅ 已添加 pitfall: $ID"
echo "   estimatedTokens: ~${TOKENS}"
echo "   index.json + index.md 已同步"
