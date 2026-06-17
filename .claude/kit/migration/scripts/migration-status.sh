#!/usr/bin/env bash
# 迁移进度显示脚本 — 读取 migration-state.json 并输出进度
# 用法: bash migration-status.sh <state-file>

STATE_FILE="$1"

if [ -z "$STATE_FILE" ]; then
  echo "用法: bash migration-status.sh <state-file>"
  exit 1
fi

if [ ! -f "$STATE_FILE" ]; then
  echo "暂无迁移记录（文件不存在：$STATE_FILE）"
  exit 0
fi

# 用 sed 解析 JSON 字段（兼容单行和多行格式）
extract_field() {
  sed -n 's/.*"'"$1"'" *: *"\([^"]*\)".*/\1/p' "$STATE_FILE" | head -1
}

FEATURE_ID=$(extract_field "featureId")
TARGET_ARCH=$(extract_field "targetArch")
CURRENT_STEP=$(extract_field "currentStep")
STARTED_AT=$(extract_field "startedAt")

# 提取 completedSteps 数组内容（兼容单行和多行 JSON）
COMPLETED_RAW=$(sed -n 's/.*"completedSteps" *: *\[\([^]]*\)\].*/\1/p' "$STATE_FILE" | grep -o '"[^"]*"' | tr -d '"')

# 所有步骤（固定顺序）
ALL_STEPS="analyze spec plan execute verify finalize"

echo ""
echo "迁移进度：${FEATURE_ID:-unknown} → ${TARGET_ARCH:-unknown}"
echo "开始时间：${STARTED_AT:-unknown}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━"

for step in $ALL_STEPS; do
  # 检查是否已完成
  is_completed=false
  for cs in $COMPLETED_RAW; do
    if [ "$cs" = "$step" ]; then
      is_completed=true
      break
    fi
  done

  if [ "$is_completed" = true ]; then
    printf "✅ %-10s 完成\n" "$step"
  elif [ "$step" = "$CURRENT_STEP" ]; then
    printf "🔄 %-10s 进行中\n" "$step"
  else
    printf "⬜ %-10s\n" "$step"
  fi
done

echo ""
