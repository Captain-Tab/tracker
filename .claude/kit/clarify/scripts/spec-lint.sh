#!/usr/bin/env bash

# spec-lint.sh <filepath>
# 对 spec 文档做结构核查：占位符 / 场景编号连续性 / 章节完整性
# 工序级 lint，只输出问题，0 问题时静默单行确认
# 用法: bash spec-lint.sh path/to/spec.md
#
# 原则依据：.claude/kit/principles/strict-vs-cumbersome.md §4.1（工序层严格，输出层简洁）

FILEPATH="${1:-}"

if [ -z "$FILEPATH" ] || [ ! -f "$FILEPATH" ]; then
    echo "❌ spec-lint: 文件不存在 — $FILEPATH"
    exit 1
fi

ISSUES=""

# 检查 1：未替换的占位符
PLACEHOLDERS=$(grep -nE '\[功能名称\]|\[YYYY-MM-DD\]|\[文件路径\]|\[N\]|🔴未开始|🟡进行中' "$FILEPATH" 2>/dev/null)
if [ -n "$PLACEHOLDERS" ]; then
    ISSUES="${ISSUES}⚠️ 未替换的占位符：\n${PLACEHOLDERS}\n\n"
fi

# 检查 2：验收场景编号连续性（"### 场景 N：" 格式）
SCENARIO_LINES=$(grep -nE "^### 场景 [0-9]+" "$FILEPATH")
if [ -n "$SCENARIO_LINES" ]; then
    EXPECTED=1
    BREAKS=""
    while IFS= read -r line; do
        N=$(echo "$line" | grep -oE "场景 [0-9]+" | grep -oE "[0-9]+")
        LINENO=$(echo "$line" | cut -d: -f1)
        if [ "$N" != "$EXPECTED" ]; then
            BREAKS="${BREAKS}  line ${LINENO}: 期望「场景 ${EXPECTED}」实际「场景 ${N}」\n"
        fi
        EXPECTED=$((N + 1))
    done <<< "$SCENARIO_LINES"
    if [ -n "$BREAKS" ]; then
        ISSUES="${ISSUES}⚠️ 验收场景编号断裂或重复：\n${BREAKS}\n"
    fi
fi

# 检查 3：必要章节存在性
REQUIRED_SECTIONS=("背景与目的" "选定方案" "设计概要" "边界与约束" "集成点" "验收标准")
MISSING=""
for SEC in "${REQUIRED_SECTIONS[@]}"; do
    if ! grep -qE "^## ${SEC}" "$FILEPATH"; then
        MISSING="${MISSING}  缺少章节：## ${SEC}\n"
    fi
done
if [ -n "$MISSING" ]; then
    ISSUES="${ISSUES}⚠️ 缺少必要章节：\n${MISSING}\n"
fi

# 输出规则：0 问题 → 单行；有问题 → 详细报告
if [ -z "$ISSUES" ]; then
    echo "✅ spec-lint 通过（0 问题）：$FILEPATH"
    exit 0
else
    echo "spec-lint 发现问题：$FILEPATH"
    echo ""
    echo -e "$ISSUES"
    exit 1
fi
