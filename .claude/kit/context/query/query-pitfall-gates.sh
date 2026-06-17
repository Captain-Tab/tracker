#!/bin/bash
# query-pitfall-gates.sh - 查询匹配当前任务的 gate 检查项
# Usage: bash query-pitfall-gates.sh [tag1,tag2,...]
# 无参数时列出所有 gate:true 的条目
# 有参数时按 tags 匹配 gate:true 的条目
# 无匹配时静默退出（零 token 消耗）
#
# 依赖环境变量: CONTEXT_PROJECT_DIR（由 init_context_config 导出）

TAGS_INPUT="$1"
INDEX="${CONTEXT_PROJECT_DIR}/pitfalls/index.json"

[ ! -f "$INDEX" ] && exit 0

# 无 gate:true 条目时静默退出
GATE_COUNT=$(jq '[.pitfalls[] | select(.gate == true)] | length' "$INDEX" 2>/dev/null)
[ "$GATE_COUNT" = "0" ] && exit 0

if [ -z "$TAGS_INPUT" ]; then
  # 无参数：列出所有 gate:true 条目
  MATCHES=$(jq -c '.pitfalls[] | select(.gate == true)' "$INDEX" 2>/dev/null)
else
  # 按 tags 匹配：任一 tag 命中即匹配（用 any 避免重复输出）
  IFS=',' read -ra TAG_ARRAY <<< "$TAGS_INPUT"

  # 构建 jq 过滤表达式（用 any 确保每条 pitfall 最多输出一次）
  JQ_FILTER='.pitfalls[] | select(.gate == true) | select(any(.tags[]; '
  FIRST=true
  for tag in "${TAG_ARRAY[@]}"; do
    tag=$(echo "$tag" | xargs) # trim
    tag_lower=$(echo "$tag" | tr '[:upper:]' '[:lower:]')
    if [ "$FIRST" = true ]; then
      JQ_FILTER+="(ascii_downcase | contains(\"${tag_lower}\"))"
      FIRST=false
    else
      JQ_FILTER+=" or (ascii_downcase | contains(\"${tag_lower}\"))"
    fi
  done
  JQ_FILTER+='))'

  MATCHES=$(jq -c "$JQ_FILTER" "$INDEX" 2>/dev/null)
fi

[ -z "$MATCHES" ] && exit 0

# 输出门检查项
MATCH_COUNT=$(echo "$MATCHES" | wc -l | tr -d ' ')
echo ""
echo "⛔ Pitfall 门检查（${MATCH_COUNT} 条匹配）"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "$MATCHES" | jq -r '"  ⚠️  [\(.severity)] \(.id)\n     规则: \(.gate_rule)\n     tags: \(.tags | join(", "))"'
echo ""
echo "📋 请在计划中标注如何避免以上问题"
