#!/bin/bash
# extract-batch.sh - 提取指定批次的步骤 + 跨批次约束
# Usage: bash extract-batch.sh <plan-file> <batch-number>
# 输出：跨批次约束 + 指定批次的步骤内容
# 如果不传 batch-number，输出整个文件

PLAN_FILE="$1"
BATCH_NUM="$2"

if [ -z "$PLAN_FILE" ]; then
  echo "❌ 用法: bash extract-batch.sh <plan-file> [batch-number]"
  exit 1
fi

if [ ! -f "$PLAN_FILE" ]; then
  echo "❌ 文件不存在: $PLAN_FILE"
  exit 1
fi

# 不指定批次，输出整个文件
if [ -z "$BATCH_NUM" ]; then
  cat "$PLAN_FILE"
  exit 0
fi

# 提取跨批次约束（从 <!-- CONSTRAINTS-START --> 到 <!-- CONSTRAINTS-END -->）
CONSTRAINTS=$(sed -n '/<!-- CONSTRAINTS-START -->/,/<!-- CONSTRAINTS-END -->/p' "$PLAN_FILE")

# 提取指定批次（从 <!-- BATCH-N-START --> 到 <!-- BATCH-N-END -->）
BATCH=$(sed -n "/<!-- BATCH-${BATCH_NUM}-START -->/,/<!-- BATCH-${BATCH_NUM}-END -->/p" "$PLAN_FILE")

if [ -z "$BATCH" ]; then
  echo "❌ 未找到批次 $BATCH_NUM"
  exit 1
fi

if [ -n "$CONSTRAINTS" ]; then
  echo "$CONSTRAINTS"
  echo ""
fi

echo "$BATCH"
