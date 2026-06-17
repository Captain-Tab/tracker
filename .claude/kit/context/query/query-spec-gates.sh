#!/bin/bash
# query-spec-gates.sh - 在 spec 阶段按 trigger 关键词匹配 gate 检查项
# Usage: bash query-spec-gates.sh "关键词1,关键词2,..."
# 无匹配时静默退出（零 token 消耗）
#
# 与 query-pitfall-gates.sh 的区别：
#   - pitfall-gates: plan 阶段，按 tags 匹配
#   - spec-gates: spec 阶段，按 trigger 匹配 spec 内容关键词
#
# 依赖环境变量: CONTEXT_PROJECT_DIR（由 init_context_config 导出）

KEYWORDS_INPUT="$1"
INDEX="${CONTEXT_PROJECT_DIR}/pitfalls/index.json"

[ -z "$KEYWORDS_INPUT" ] && exit 0
[ ! -f "$INDEX" ] && exit 0

# 无 gate:true 条目时静默退出
GATE_COUNT=$(jq '[.pitfalls[] | select(.gate == true) | select(.trigger != null)] | length' "$INDEX" 2>/dev/null)
[ "$GATE_COUNT" = "0" ] && exit 0

# 按 trigger 匹配：spec 关键词命中任一 trigger 即匹配
IFS=',' read -ra KW_ARRAY <<< "$KEYWORDS_INPUT"

# 构建 jq 过滤表达式
JQ_FILTER='.pitfalls[] | select(.gate == true) | select(.trigger != null) | select(any(.trigger[]; '
FIRST=true
for kw in "${KW_ARRAY[@]}"; do
  kw=$(echo "$kw" | xargs) # trim
  kw_lower=$(echo "$kw" | tr '[:upper:]' '[:lower:]')
  if [ "$FIRST" = true ]; then
    JQ_FILTER+="(ascii_downcase | contains(\"${kw_lower}\"))"
    FIRST=false
  else
    JQ_FILTER+=" or (ascii_downcase | contains(\"${kw_lower}\"))"
  fi
done
JQ_FILTER+='))'

MATCHES=$(jq -c "$JQ_FILTER" "$INDEX" 2>/dev/null)

[ -z "$MATCHES" ] && exit 0

# 输出 spec gate 检查项
MATCH_COUNT=$(echo "$MATCHES" | wc -l | tr -d ' ')
echo ""
echo "🔍 Spec Gate 检查（${MATCH_COUNT} 条匹配）"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "$MATCHES" | jq -r '"  ⚠️  [\(.severity)] \(.id)\n     规则: \(.gate_rule)\n     触发词: \(.trigger | join(", "))"'
echo ""
echo "📋 请检查验收场景是否已覆盖以上问题，未覆盖的须补充到反问中"
