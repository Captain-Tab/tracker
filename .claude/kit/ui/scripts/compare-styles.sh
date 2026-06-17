#!/bin/zsh
# 样式差异对比脚本（zsh 版本）
# 用法: compare-styles.sh <target.tsx> [figma-styles.json]

set -e

TARGET_FILE="$1"
FIGMA_JSON="$2"

# Tailwind → 实际值映射函数
tw_to_value() {
    local class="$1"
    
    case "$class" in
        # Padding
        p-1|px-1|py-1|pt-1|pb-1|pl-1|pr-1) echo "4px" ;;
        p-2|px-2|py-2|pt-2|pb-2|pl-2|pr-2) echo "8px" ;;
        p-3|px-3|py-3|pt-3|pb-3|pl-3|pr-3) echo "12px" ;;
        p-4|px-4|py-4|pt-4|pb-4|pl-4|pr-4) echo "16px" ;;
        p-5|px-5|py-5|pt-5|pb-5|pl-5|pr-5) echo "20px" ;;
        p-6|px-6|py-6|pt-6|pb-6|pl-6|pr-6) echo "24px" ;;
        p-8|px-8|py-8|pt-8|pb-8|pl-8|pr-8) echo "32px" ;;
        # Margin
        m-1|mx-1|my-1|mt-1|mb-1|ml-1|mr-1) echo "4px" ;;
        m-2|mx-2|my-2|mt-2|mb-2|ml-2|mr-2) echo "8px" ;;
        m-3|mx-3|my-3|mt-3|mb-3|ml-3|mr-3) echo "12px" ;;
        m-4|mx-4|my-4|mt-4|mb-4|ml-4|mr-4) echo "16px" ;;
        # Gap
        gap-1) echo "4px" ;;
        gap-2) echo "8px" ;;
        gap-3) echo "12px" ;;
        gap-4) echo "16px" ;;
        gap-6) echo "24px" ;;
        # Rounded
        rounded-none) echo "0" ;;
        rounded-sm) echo "2px" ;;
        rounded) echo "4px" ;;
        rounded-md) echo "6px" ;;
        rounded-lg) echo "8px" ;;
        rounded-xl) echo "12px" ;;
        rounded-2xl) echo "16px" ;;
        rounded-full) echo "9999px" ;;
        # Font size
        text-xs) echo "12px" ;;
        text-sm) echo "14px" ;;
        text-base) echo "16px" ;;
        text-lg) echo "18px" ;;
        text-xl) echo "20px" ;;
        text-2xl) echo "24px" ;;
        # Border
        border) echo "1px" ;;
        border-0) echo "0" ;;
        border-2) echo "2px" ;;
        border-t) echo "border-top: 1px" ;;
        border-b) echo "border-bottom: 1px" ;;
        # 任意值 [Xpx] 格式
        *\[*px\]*) 
            echo "$class" | sed 's/.*\[\([0-9]*\)px\].*/\1px/'
            ;;
        # 默认返回原值
        *) echo "$class" ;;
    esac
}

# 属性类型分类
classify_property() {
    local class="$1"
    
    case "$class" in
        p-*|px-*|py-*|pt-*|pb-*|pl-*|pr-*) echo "padding" ;;
        m-*|mx-*|my-*|mt-*|mb-*|ml-*|mr-*) echo "margin" ;;
        gap-*) echo "gap" ;;
        rounded*) echo "border-radius" ;;
        text-*) echo "font-size" ;;
        border*) echo "border" ;;
        bg-*) echo "background" ;;
        font-*) echo "font" ;;
        *) echo "other" ;;
    esac
}

# 显示用法
show_usage() {
    echo "用法: compare-styles.sh <target.tsx> [figma-styles.json]"
    echo ""
    echo "参数:"
    echo "  target.tsx        - 要分析的 React/TSX 文件"
    echo "  figma-styles.json - (可选) Figma 样式 JSON"
}

# ====================
# 主逻辑
# ====================

if [[ -z "$TARGET_FILE" ]]; then
    show_usage
    exit 1
fi

if [[ ! -f "$TARGET_FILE" ]]; then
    echo "❌ 文件不存在: $TARGET_FILE"
    exit 1
fi

echo "## 📊 样式分析报告"
echo ""
echo "**目标文件**: \`$(basename $TARGET_FILE)\`"
echo ""

# Step 1: 提取样式类
echo "### 当前代码样式"
echo ""
echo "| 类名 | 属性类型 | 实际值 |"
echo "|------|---------|--------|"

# 提取 className 中的类，过滤出样式相关
grep -oE 'className="[^"]*"' "$TARGET_FILE" 2>/dev/null | \
    sed 's/className="//g; s/"//g' | \
    tr ' ' '\n' | \
    grep -E '^(p-|px-|py-|pt-|pb-|pl-|pr-|m-|mx-|my-|mt-|mb-|gap-|rounded|text-\[|text-xs|text-sm|text-base|text-lg|border|bg-)' | \
    sort -u | \
    while read class; do
        if [[ -n "$class" ]]; then
            prop_type=$(classify_property "$class")
            value=$(tw_to_value "$class")
            echo "| \`$class\` | $prop_type | $value |"
        fi
    done

echo ""

# Step 2: Figma 对比提示
if [[ -n "$FIGMA_JSON" ]] && [[ -f "$FIGMA_JSON" ]]; then
    echo "### Figma 设计样式"
    echo ""
    cat "$FIGMA_JSON"
    echo ""
else
    echo "### Figma 样式（待 AI 填充）"
    echo ""
    echo "| 属性 | Figma 值 |"
    echo "|------|---------|"
    echo "| padding | ? |"
    echo "| gap | ? |"
    echo "| border-radius | ? |"
    echo "| font-size | ? |"
    echo ""
    echo "> AI 调用 \`get_design_context\` 后填充上表"
fi

echo ""
echo "---"
echo ""
echo "**下一步**: 对比两表，输出「修改清单」"
