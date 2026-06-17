#!/bin/bash
# update-step.sh - 更新计划文件中的 checkbox 状态
# Usage: bash update-step.sh <plan-file> <step-id> <status>
# status: completed | in_progress | pending
# 示例: bash update-step.sh .claude/kit/plan/plan-temp.md "2.1" "completed"

PLAN_FILE="$1"
STEP_ID="$2"
STATUS="$3"

if [ -z "$PLAN_FILE" ] || [ -z "$STEP_ID" ] || [ -z "$STATUS" ]; then
  echo "❌ 用法: bash update-step.sh <plan-file> <step-id> <status>"
  echo "  status: completed | in_progress | pending"
  exit 1
fi

if [ ! -f "$PLAN_FILE" ]; then
  echo "❌ 文件不存在: $PLAN_FILE"
  exit 1
fi

case "$STATUS" in
  completed)
    # - [ ] X.Y ... → - [x] X.Y ... ✅
    sed -i '' "s/- \[[ x]\] ${STEP_ID} \(.*\)✅\{0,1\}/- [x] ${STEP_ID} \1✅/" "$PLAN_FILE"
    # 确保有 ✅ 标记
    sed -i '' "/- \[x\] ${STEP_ID}/{ /✅/!s/$/ ✅/; }" "$PLAN_FILE"
    ;;
  in_progress)
    # - [ ] X.Y ... → - [ ] X.Y ... 🔄
    sed -i '' "s/- \[[ x]\] ${STEP_ID} \(.*\)[✅🔄]\{0,1\}/- [ ] ${STEP_ID} \1🔄/" "$PLAN_FILE"
    # 确保有 🔄 标记
    sed -i '' "/- \[ \] ${STEP_ID}/{ /🔄/!s/$/ 🔄/; }" "$PLAN_FILE"
    ;;
  pending)
    # 恢复为未开始状态
    sed -i '' "s/- \[[ x]\] ${STEP_ID} \(.*\)[✅🔄]\{0,1\}/- [ ] ${STEP_ID} \1/" "$PLAN_FILE"
    ;;
  *)
    echo "❌ 无效状态: $STATUS (使用 completed | in_progress | pending)"
    exit 1
    ;;
esac

echo "✅ ${STEP_ID} → ${STATUS}"
