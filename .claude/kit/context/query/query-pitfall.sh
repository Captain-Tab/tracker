#!/bin/bash
# query-pitfall.sh - 按 tag 搜索 pitfall，或加载指定 pitfall 完整内容
# Usage:
#   bash query-pitfall.sh              # 列出所有 pitfall
#   bash query-pitfall.sh <tag>        # 按 tag 搜索
#   bash query-pitfall.sh --id <id>    # 加载指定 pitfall 完整内容
#
# 依赖环境变量: CONTEXT_PROJECT_DIR（由 init_context_config 导出）

PARAM="$1"
PARAM2="$2"
INDEX="${CONTEXT_PROJECT_DIR}/pitfalls/index.json"

if [ ! -f "$INDEX" ]; then
  echo "❌ Pitfall 索引不存在: $INDEX"
  exit 1
fi

# --id <id>: 加载完整 pitfall 文件
if [ "$PARAM" = "--id" ] && [ -n "$PARAM2" ]; then
  PATH_REL=$(jq -r --arg id "$PARAM2" '.pitfalls[] | select(.id == $id) | .path' "$INDEX" 2>/dev/null)
  if [ -z "$PATH_REL" ] || [ "$PATH_REL" = "null" ]; then
    echo "❌ 未找到 pitfall ID: $PARAM2"
    echo ""
    echo "💡 可用 IDs:"
    jq -r '.pitfalls[].id' "$INDEX"
    exit 1
  fi
  FULL_PATH="${CONTEXT_PROJECT_DIR}/${PATH_REL}"
  if [ ! -f "$FULL_PATH" ]; then
    echo "❌ 文件不存在: $FULL_PATH"
    exit 1
  fi
  # 从实际文件大小计算 token（chars / 4）
  CHARS=$(wc -c < "$FULL_PATH" | tr -d ' ')
  TOKENS=$(( CHARS / 4 ))
  echo "⚠️  Pitfall: $PARAM2"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  cat "$FULL_PATH"
  echo ""
  echo "📊 ~${TOKENS} tokens 已加载"
  exit 0
fi

# 无参数: 列出所有
if [ -z "$PARAM" ]; then
  COUNT=$(jq '.pitfalls | length' "$INDEX")
  TOTAL=$(jq '[.pitfalls[].estimatedTokens] | add // 0' "$INDEX")
  echo "⚠️  所有 Pitfalls（共 ${COUNT} 条，全部加载约 ~${TOTAL} tokens）"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  jq -r '.pitfalls[] | "  · [\(.severity)] \(.id)  ~\(.estimatedTokens) tokens\n    \(.summary)\n    tags: \(.tags | join(", ")) | feature: \(.related_feature)"' "$INDEX"
  echo ""
  echo "💡 加载详情: /k/context-pitfall load <id>"
  exit 0
fi

# 按 tag 搜索
MATCHES=$(jq -c --arg tag "$PARAM" '.pitfalls[] | select(.tags[] | contains($tag))' "$INDEX" 2>/dev/null)

if [ -z "$MATCHES" ]; then
  echo "ℹ️  未找到 tag '$PARAM' 的 pitfall"
  echo ""
  echo "💡 可用 tags:"
  jq -r '[.pitfalls[].tags[]] | unique | .[]' "$INDEX"
  exit 0
fi

MATCH_TOKENS=$(echo "$MATCHES" | jq -s '[.[].estimatedTokens] | add // 0')
echo "⚠️  匹配 Pitfalls（tag: $PARAM，全部加载约 ~${MATCH_TOKENS} tokens）"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "$MATCHES" | jq -r '"  · [\(.severity)] \(.id)  ~\(.estimatedTokens) tokens — \(.summary)\n    feature: \(.related_feature)"'
echo ""
echo "💡 加载详情: /k/context-pitfall load <id>"
