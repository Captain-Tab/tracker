#!/bin/bash

# 智能推荐 Module
# 逻辑：基于修改的文件路径分析模块归属

set -e

# 参数解析
MODIFIED_FILES=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --files)
            MODIFIED_FILES="$2"
            shift 2
            ;;
        *)
            echo "未知参数: $1"
            exit 1
            ;;
    esac
done

# 如果没有提供文件列表，尝试从 git 获取
if [ -z "$MODIFIED_FILES" ]; then
    MODIFIED_FILES=$(git diff --name-only HEAD 2>/dev/null || echo "")
fi

# 如果仍然没有文件，返回空
if [ -z "$MODIFIED_FILES" ]; then
    echo ""
    exit 0
fi

# ========================================
# 文件路径 → 模块映射规则
# ========================================

# 模块计数器
declare -A MODULE_COUNTS
MODULE_COUNTS[vault]=0
MODULE_COUNTS[stake]=0
MODULE_COUNTS[network]=0
MODULE_COUNTS[points]=0
MODULE_COUNTS[shared]=0

# 分析每个文件
while IFS= read -r file; do
    # 跳过空行
    if [ -z "$file" ]; then
        continue
    fi

    # 规则 1: 精准路径匹配
    if echo "$file" | grep -qi "vault"; then
        MODULE_COUNTS[vault]=$((MODULE_COUNTS[vault] + 1))
    elif echo "$file" | grep -qi "stake"; then
        MODULE_COUNTS[stake]=$((MODULE_COUNTS[stake] + 1))
    elif echo "$file" | grep -qi "network"; then
        MODULE_COUNTS[network]=$((MODULE_COUNTS[network] + 1))
    elif echo "$file" | grep -qi "point"; then
        MODULE_COUNTS[points]=$((MODULE_COUNTS[points] + 1))
    fi

    # 规则 2: 共享基础设施识别
    if echo "$file" | grep -qE "(components/shared|hooks/shared|utils|models|types|constants)"; then
        MODULE_COUNTS[shared]=$((MODULE_COUNTS[shared] + 1))
    fi

    # 规则 3: 特定文件名识别
    case "$(basename "$file")" in
        *transfer*)
            MODULE_COUNTS[shared]=$((MODULE_COUNTS[shared] + 1))
            ;;
        *balance*)
            MODULE_COUNTS[shared]=$((MODULE_COUNTS[shared] + 1))
            ;;
        *modal*)
            # Modal 可能属于任何模块，权重降低
            ;;
    esac
done <<< "$MODIFIED_FILES"

# ========================================
# 找出计数最多的模块
# ========================================

MAX_COUNT=0
SUGGESTED_MODULE=""

for module in "${!MODULE_COUNTS[@]}"; do
    count=${MODULE_COUNTS[$module]}
    if [ $count -gt $MAX_COUNT ]; then
        MAX_COUNT=$count
        SUGGESTED_MODULE=$module
    fi
done

# 如果没有明确模块，默认 shared
if [ -z "$SUGGESTED_MODULE" ] || [ $MAX_COUNT -eq 0 ]; then
    SUGGESTED_MODULE="shared"
fi

# 输出结果
echo "$SUGGESTED_MODULE"
