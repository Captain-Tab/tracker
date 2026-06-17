#!/bin/bash
# check-feature-pitfalls.sh - 获取 feature 关联的 pitfall（懒加载提示，不输出内容）
# Usage: bash check-feature-pitfalls.sh <feature-id>
# 依赖环境变量: CONTEXT_PROJECT_DIR（由 init_context_config 导出）
# 静默退出：无 pitfall 时不输出任何内容

FEATURE_ID="$1"
INDEX="${CONTEXT_PROJECT_DIR}/pitfalls/index.json"

[ -z "$FEATURE_ID" ] && exit 0
[ ! -f "$INDEX" ] && exit 0

MATCHES=$(jq -r --arg fid "$FEATURE_ID" \
  '.pitfalls[] | select(.related_feature == $fid) | "  · [\(.severity)] \(.id) — \(.summary)"' \
  "$INDEX" 2>/dev/null)

[ -z "$MATCHES" ] && exit 0

echo ""
echo "⚠️  已知 Pitfalls（懒加载，不影响当前 token）"
echo "$MATCHES"
echo "💡 查看详情: /k/context pitfall <id>"
