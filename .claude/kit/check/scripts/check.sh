#!/bin/bash
# check.sh - 代码检查核心脚本
# 使用方式: bash check.sh [--r]

set -e

# 获取 soso-kit 根目录
if [ -f ".claude/kit/cli/config.sh" ]; then
    KIT_ROOT="$(pwd)"
elif [ -f "../.claude/kit/cli/config.sh" ]; then
    KIT_ROOT="$(cd .. && pwd)"
elif [ -f "../../.claude/kit/cli/config.sh" ]; then
    KIT_ROOT="$(cd ../.. && pwd)"
else
    echo "❌ 未找到 soso-kit 配置"
    echo "请确保在 soso-kit 项目或其子目录中执行此命令"
    exit 1
fi

# 检查是否有 --r 参数
HAS_RECORD_FLAG=false
if echo "$@" | grep -q "\--r"; then
    HAS_RECORD_FLAG=true
fi

# 加载 checklist 模板
TEMPLATE_FILE="$KIT_ROOT/.claude/kit/check/templates/checklist.md"

if [ ! -f "$TEMPLATE_FILE" ]; then
    echo "❌ 未找到检查模板: $TEMPLATE_FILE"
    exit 1
fi

# 检测当前项目名
export SOSO_KIT_ROOT="$KIT_ROOT"
source "$KIT_ROOT/.claude/kit/cli/identify.sh"
CURRENT_PROJECT=$(identify_project "$(pwd)" 2>/dev/null || basename "$(git rev-parse --show-toplevel 2>/dev/null || echo 'soso-kit')")

# 按项目过滤 checklist：移除不属于当前项目的 <!-- project: xxx --> 块
filter_checklist() {
    local in_block=false
    local block_match=false

    while IFS= read -r line; do
        # 检测 <!-- project: ... --> 开始标记
        if echo "$line" | grep -q "^<!-- project:"; then
            in_block=true
            local projects=$(echo "$line" | sed 's/<!-- project: *//;s/ *-->//')
            if echo "$projects" | grep -qw "$CURRENT_PROJECT"; then
                block_match=true
            else
                block_match=false
            fi
            continue
        fi

        # 检测 <!-- /project --> 结束标记
        if echo "$line" | grep -q "^<!-- /project -->"; then
            in_block=false
            block_match=false
            continue
        fi

        # 输出逻辑：不在块内 → 输出；在块内且匹配 → 输出
        if [ "$in_block" = false ] || [ "$block_match" = true ]; then
            echo "$line"
        fi
    done < "$TEMPLATE_FILE"
}

# 显示过滤后的模板内容
filter_checklist

# 执行 git 分析
echo ""
echo "---"
echo ""
echo "## Git 状态分析"
echo ""

# 1. Git status
echo "### 未跟踪文件"
echo ""
echo "\`\`\`bash"
git status --short | grep "^??" || echo "无未跟踪文件"
echo "\`\`\`"
echo ""

# 2. Git diff
echo "### 变更内容"
echo ""
echo "\`\`\`bash"
git diff --stat || echo "无未提交变更"
echo "\`\`\`"
echo ""

# 3. Git log
echo "### 最近提交记录（参考 commit 风格）"
echo ""
echo "\`\`\`bash"
git log --oneline -5
echo "\`\`\`"
echo ""

echo "---"
echo ""
echo "## 下一步操作"
echo ""
echo "1. 请根据上述 checklist 逐项检查代码"
echo "2. 完成检查后，生成检查报告"
echo "3. 如果所有检查通过，生成 Git Commit 建议"
echo ""

# 如果有 --r 参数，提示将在检查完成后自动记录
if [ "$HAS_RECORD_FLAG" = true ]; then
    echo "---"
    echo ""
    echo "⚠️  **检测到 --r 参数**"
    echo ""
    echo "检查完成后，将自动执行 \`/k/context-record\` 记录到 Context Library"
    echo ""
fi

echo "💡 准备好后，告诉 AI：\"我已检查完成，请生成检查报告和 commit 建议\""
