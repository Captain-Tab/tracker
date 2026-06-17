#!/bin/bash

# 智能推荐 Type（feat/fix/refactor）
# 逻辑：
# 1. 分析 spec 关键词
# 2. 读取最近的 commit message
# 3. 综合判断

set -e

# 参数解析
SPEC_FILE=""
SPEC_CONTENT=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --spec-file)
            SPEC_FILE="$2"
            shift 2
            ;;
        --spec-content)
            SPEC_CONTENT="$2"
            shift 2
            ;;
        *)
            echo "未知参数: $1"
            exit 1
            ;;
    esac
done

# 读取 spec 内容
if [ -n "$SPEC_FILE" ] && [ -f "$SPEC_FILE" ]; then
    SPEC_CONTENT=$(cat "$SPEC_FILE")
fi

if [ -z "$SPEC_CONTENT" ]; then
    echo "feat"  # 默认值
    exit 0
fi

# ========================================
# 方法 1: 分析 spec 关键词
# ========================================

SUGGESTED_TYPE=""

# 检查是否包含修复相关关键词
if echo "$SPEC_CONTENT" | grep -qiE "(修复|fix|bug|问题|错误|异常|失败)"; then
    SUGGESTED_TYPE="fix"
fi

# 检查是否包含重构关键词
if echo "$SPEC_CONTENT" | grep -qiE "(重构|refactor|优化|改进|restructure)"; then
    # 如果同时有修复和重构，优先 fix
    if [ "$SUGGESTED_TYPE" != "fix" ]; then
        SUGGESTED_TYPE="refactor"
    fi
fi

# 检查是否包含新功能关键词
if echo "$SPEC_CONTENT" | grep -qiE "(新增|添加|实现|feat|feature|功能|新建)"; then
    # 如果没有其他明确类型，设为 feat
    if [ -z "$SUGGESTED_TYPE" ]; then
        SUGGESTED_TYPE="feat"
    fi
fi

# ========================================
# 方法 2: 读取最近的 commit message（辅助）
# ========================================

RECENT_COMMIT=$(git log -1 --pretty=%B 2>/dev/null || echo "")

if [ -n "$RECENT_COMMIT" ]; then
    # 检查 commit message 中的前缀
    if echo "$RECENT_COMMIT" | grep -qiE "^fix"; then
        SUGGESTED_TYPE="fix"
    elif echo "$RECENT_COMMIT" | grep -qiE "^feat"; then
        if [ -z "$SUGGESTED_TYPE" ]; then
            SUGGESTED_TYPE="feat"
        fi
    elif echo "$RECENT_COMMIT" | grep -qiE "^refactor"; then
        if [ -z "$SUGGESTED_TYPE" ]; then
            SUGGESTED_TYPE="refactor"
        fi
    fi
fi

# ========================================
# 默认值
# ========================================

if [ -z "$SUGGESTED_TYPE" ]; then
    SUGGESTED_TYPE="feat"
fi

echo "$SUGGESTED_TYPE"
