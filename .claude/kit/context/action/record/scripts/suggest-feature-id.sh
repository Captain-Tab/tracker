#!/bin/bash

# 智能推荐 Feature ID
# 逻辑：
# 1. 从 spec 文件名提取（如 vault-deposit.md → vault-deposit-01）
# 2. 从标题生成（如 "Vault Deposit 流程" → vault-deposit-01）
# 3. 检查已有功能，自动递增编号

set -e

# 参数解析
TITLE=""
SPEC_FILE=""
CONTEXT_INDEX_FILE=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --title)
            TITLE="$2"
            shift 2
            ;;
        --spec-file)
            SPEC_FILE="$2"
            shift 2
            ;;
        --index)
            CONTEXT_INDEX_FILE="$2"
            shift 2
            ;;
        *)
            echo "未知参数: $1"
            exit 1
            ;;
    esac
done

# 验证参数
if [ -z "$TITLE" ] || [ -z "$CONTEXT_INDEX_FILE" ]; then
    echo "❌ 缺少必需参数"
    exit 1
fi

CONTEXT_DIR=$(dirname "$CONTEXT_INDEX_FILE")

# ========================================
# 生成基础 ID（从标题或文件名）
# ========================================

generate_base_id() {
    local text="$1"

    # 转小写，提取关键词，用 - 连接
    echo "$text" | \
        tr '[:upper:]' '[:lower:]' | \
        sed 's/功能规范[：:]*//g' | \
        sed 's/[^a-z0-9\u4e00-\u9fa5]/ /g' | \
        tr -s ' ' | \
        sed 's/^ //;s/ $//' | \
        sed 's/ /-/g' | \
        sed 's/--*/-/g'
}

# 优先从 spec 文件名提取
BASE_ID=""
if [ -n "$SPEC_FILE" ] && [ -f "$SPEC_FILE" ]; then
    FILENAME=$(basename "$SPEC_FILE" .md)
    # 如果文件名有意义（不是日期格式），使用它
    if ! echo "$FILENAME" | grep -qE '^[0-9]{8}'; then
        BASE_ID=$(generate_base_id "$FILENAME")
    fi
fi

# 如果文件名无效，从标题生成
if [ -z "$BASE_ID" ]; then
    BASE_ID=$(generate_base_id "$TITLE")
fi

# 移除常见无意义词
BASE_ID=$(echo "$BASE_ID" | sed -E 's/-(完整|流程|功能|实现|修复|优化|问题)//g')
BASE_ID=$(echo "$BASE_ID" | sed 's/--*/-/g' | sed 's/^-//;s/-$//')

# ========================================
# 检查 ID 是否已存在，自动递增编号
# ========================================

feature_exists() {
    local fid="$1"

    # 在所有 router/*.json 中查找
    for router_file in "$CONTEXT_DIR"/router/*.json; do
        if [ -f "$router_file" ]; then
            if jq -e ".features.\"$fid\"" "$router_file" >/dev/null 2>&1; then
                return 0  # 存在
            fi
        fi
    done

    return 1  # 不存在
}

# 查找已有的同前缀功能，获取最大编号
find_max_number() {
    local prefix="$1"
    local max_num=0

    for router_file in "$CONTEXT_DIR"/router/*.json; do
        if [ -f "$router_file" ]; then
            # 查找形如 prefix-01, prefix-02 的功能
            EXISTING=$(jq -r '.features | keys[]' "$router_file" 2>/dev/null | grep "^${prefix}-[0-9]" || echo "")

            for fid in $EXISTING; do
                # 提取编号
                NUM=$(echo "$fid" | sed "s/^${prefix}-0*//" | grep -E '^[0-9]+$' || echo "0")
                if [ "$NUM" -gt "$max_num" ]; then
                    max_num=$NUM
                fi
            done
        fi
    done

    echo "$max_num"
}

# 生成带编号的 ID
SUGGESTED_ID="${BASE_ID}-01"

# 如果已存在，自动递增
if feature_exists "$SUGGESTED_ID"; then
    MAX_NUM=$(find_max_number "$BASE_ID")
    NEXT_NUM=$((MAX_NUM + 1))
    SUGGESTED_ID=$(printf "%s-%02d" "$BASE_ID" "$NEXT_NUM")
fi

# 输出结果
echo "$SUGGESTED_ID"
