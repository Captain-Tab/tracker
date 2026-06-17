#!/bin/zsh

# 获取当前分支
BRANCH=$(git branch --show-current)

echo ""
echo "📦 请在 GitHub Actions 手动触发构建"
echo ""
echo "   1. 打开链接（已复制到剪贴板）"
echo "   2. 点击 'Run workflow'"
echo "   3. 选择分支: $BRANCH"
echo "   4. Environment: preview"
echo "   5. 点击 'Run workflow'"
echo ""

# 复制链接到剪贴板
URL="https://github.com/sosovalue-tech/sodex-next/actions/workflows/build.yml"
echo "$URL" | pbcopy

echo "🔗 $URL"
echo ""
echo "（链接已复制到剪贴板，直接粘贴到浏览器）"
echo ""

# 尝试打开浏览器
open "$URL" 2>/dev/null || true
