#!/usr/bin/env bash

# load-rules.sh - 检测任务涉及的文件类型，输出适用的规范列表
# 输出结果由 AI 读取，按列表顺序加载规范文件内容
# 使用方式: bash load-rules.sh [rules_dir]

RULES_DIR="${1:-.claude/rules}"

if [ ! -d "$RULES_DIR" ]; then
    echo "⚠️  规范目录不存在: $RULES_DIR（跳过规范检查）"
    exit 0
fi

echo "📋 规范检查"
echo ""

# 检测 git 状态中修改的文件类型
CHANGED_FILES=$(git status --short 2>/dev/null | awk '{print $NF}')

HAS_TSX=false
HAS_TS=false
HAS_SH=false

if echo "$CHANGED_FILES" | grep -qE "\.(tsx|jsx)$"; then HAS_TSX=true; fi
if echo "$CHANGED_FILES" | grep -qE "\.(ts|js)$";  then HAS_TS=true;  fi
if echo "$CHANGED_FILES" | grep -qE "\.sh$";        then HAS_SH=true;  fi

# 输出必读规范
echo "必读:"
echo "  $RULES_DIR/regular.mdc"
echo ""

# 输出匹配规范
MATCHED=""

if $HAS_TSX && [ -f "$RULES_DIR/react.mdc" ]; then
    echo "匹配:"
    echo "  $RULES_DIR/react.mdc       ← 检测到 .tsx/.jsx 文件"
    MATCHED="yes"
fi

if $HAS_TS && [ -f "$RULES_DIR/clean-code.mdc" ]; then
    if [ -z "$MATCHED" ]; then echo "匹配:"; fi
    echo "  $RULES_DIR/clean-code.mdc  ← 检测到 .ts/.js 文件"
    MATCHED="yes"
fi

if $HAS_SH && [ -f "$RULES_DIR/regular.mdc" ]; then
    if [ -z "$MATCHED" ]; then echo "匹配:"; fi
    echo "  $RULES_DIR/regular.mdc     ← 检测到 .sh 文件（注意：禁止使用分隔符）"
    MATCHED="yes"
fi

if [ -z "$MATCHED" ]; then
    echo "匹配: 无额外规范（仅 regular.mdc）"
fi

echo ""
echo "💡 依次读取以上规范文件内容，理解后执行任务"
