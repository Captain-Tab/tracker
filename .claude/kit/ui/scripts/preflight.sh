#!/bin/bash
# UI 需求确认前置检查脚本
# 功能：解析参数、检查规范文件、输出加载指令

set -e

ARGS="$*"
KIT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
FIGMA_REFS_DIR="$KIT_ROOT/.claude/kit/figma/references"
RULES_DIR="$KIT_ROOT/.claude/rules"

# 解析 --figma 参数
FIGMA_URL=""
HAS_FIGMA=false

if echo "$ARGS" | grep -q "\-\-figma"; then
    HAS_FIGMA=true
    # 提取 --figma 后面的 URL（支持多种格式）
    FIGMA_URL=$(echo "$ARGS" | grep -oE 'https://[^ ]*figma\.com[^ ]*' | head -1)
fi

echo "## 🔍 UI 需求前置检查"
echo ""

# 1. 参数解析结果
echo "### 参数解析"
echo ""
if [ "$HAS_FIGMA" = true ]; then
    echo "- 模式：**Figma 对照模式**"
    if [ -n "$FIGMA_URL" ]; then
        echo "- Figma URL：\`$FIGMA_URL\`"
        
        # 解析 fileKey 和 nodeId
        FILE_KEY=$(echo "$FIGMA_URL" | sed -n 's|.*figma.com/design/\([^/]*\)/.*|\1|p')
        NODE_ID=$(echo "$FIGMA_URL" | sed -n 's|.*node-id=\([^&]*\).*|\1|p' | tr '-' ':')
        
        if [ -n "$FILE_KEY" ]; then
            echo "- fileKey：\`$FILE_KEY\`"
        fi
        if [ -n "$NODE_ID" ]; then
            echo "- nodeId：\`$NODE_ID\`"
        fi
    else
        echo "- ⚠️ 未提供 Figma URL，请补充"
    fi
else
    echo "- 模式：**纯文字描述模式**"
fi
echo ""

# 2. 检查共享规范文件
echo "### 规范文件检查"
echo ""

REQUIRED_FILES=(
    "specification.md:样式规范:必需"
    "specification-project.md:项目Token:必需"
    "components.md:组件目录:必需"
)

# --figma 模式额外需要 patterns.md
if [ "$HAS_FIGMA" = true ]; then
    REQUIRED_FILES+=("patterns.md:设计模式:Figma模式需要")
fi

ALL_EXIST=true
LOAD_FILES=""

# figma-style-mapping.md 仅在官方 Figma MCP 模式下加载
if [ "$HAS_FIGMA" = true ]; then
    STYLE_MAPPING="$RULES_DIR/figma-style-mapping.md"
    if [ -f "$STYLE_MAPPING" ]; then
        echo "- ✅ figma-style-mapping.md (样式映射·单一数据源)"
        LOAD_FILES="$LOAD_FILES $STYLE_MAPPING"
    else
        echo "- ❌ figma-style-mapping.md (样式映射) - 文件不存在"
        ALL_EXIST=false
    fi
fi

for item in "${REQUIRED_FILES[@]}"; do
    FILE=$(echo "$item" | cut -d: -f1)
    DESC=$(echo "$item" | cut -d: -f2)
    NOTE=$(echo "$item" | cut -d: -f3)

    FULL_PATH="$FIGMA_REFS_DIR/$FILE"

    if [ -f "$FULL_PATH" ]; then
        echo "- ✅ $FILE ($DESC)"
        LOAD_FILES="$LOAD_FILES $FULL_PATH"
    else
        echo "- ❌ $FILE ($DESC) - 文件不存在"
        ALL_EXIST=false
    fi
done
echo ""

# 3. 输出加载指令
echo "### 加载指令"
echo ""

if [ "$ALL_EXIST" = true ]; then
    echo "请读取以下文件作为样式参考："
    echo ""
    echo "\`\`\`"
    for f in $LOAD_FILES; do
        echo "$f"
    done
    echo "\`\`\`"
else
    echo "⚠️ 部分规范文件缺失，请检查 .claude/kit/figma/references/ 是否完整"
fi
echo ""

# 4. Figma 模式额外提示
if [ "$HAS_FIGMA" = true ]; then
    echo "### Figma 模式提示"
    echo ""
    echo "1. 调用 \`user-Figma-get_screenshot\` 获取设计稿截图"
    echo "2. 对比当前实现与设计稿差异"
    echo "3. 优先命中 patterns.md 中的已有模式"
    echo ""
fi

echo "---"
