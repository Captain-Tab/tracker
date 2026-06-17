#!/usr/bin/env bash

# sync-tailwind-tokens.sh
# 检查 tailwind.config.js 是否变更，决定是否需要重新提取 Design Tokens
#
# 逻辑：
#   - tailwind.config 无变更 → 直接用缓存 specification-project.md
#   - tailwind.config 有变更 → 输出 config 内容，指示 AI 提取并更新文件

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FIGMA_DIR="$(dirname "$SCRIPT_DIR")"
SPEC_PROJECT_FILE="$FIGMA_DIR/references/specification-project.md"
SEP="━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# 获取项目根目录
PROJECT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)

# 查找 tailwind.config（支持 .ts / .js / .cjs / .mjs）
TAILWIND_CONFIG=""
for name in tailwind.config.ts tailwind.config.js tailwind.config.cjs tailwind.config.mjs; do
    if [ -f "$PROJECT_ROOT/$name" ]; then
        TAILWIND_CONFIG="$PROJECT_ROOT/$name"
        TAILWIND_FILENAME="$name"
        break
    fi
done

echo ""
echo "$SEP"
echo "📦 Tailwind Token 检查"
echo "$SEP"

# 未找到 config
if [ -z "$TAILWIND_CONFIG" ]; then
    echo "⚠️  未找到 tailwind.config，跳过 Token 提取"
    echo "   将使用 specification.md 通用映射"
    echo "$SEP"
    echo ""
    exit 0
fi

echo "📄 找到: $TAILWIND_FILENAME"

# 获取 tailwind.config 的最新 git commit hash
CURRENT_HASH=$(git log -1 --format="%H" -- "$TAILWIND_CONFIG" 2>/dev/null)
if [ -z "$CURRENT_HASH" ]; then
    CURRENT_HASH="untracked-$(date +%s)"
fi

# 读取 specification-project.md 中存储的 hash
STORED_HASH=""
if [ -f "$SPEC_PROJECT_FILE" ]; then
    STORED_HASH=$(grep "^<!-- tailwind-config-hash:" "$SPEC_PROJECT_FILE" 2>/dev/null \
        | sed 's/<!-- tailwind-config-hash: \(.*\) -->/\1/' | xargs)
fi

# Hash 相同 → 使用缓存
if [ "$CURRENT_HASH" = "$STORED_HASH" ] && [ -f "$SPEC_PROJECT_FILE" ]; then
    echo "✅ tailwind.config 无变更（hash: ${CURRENT_HASH:0:8}）"
    echo "   使用缓存：references/specification-project.md"
    echo ""
    echo "⚡ Step 0 指令："
    echo "   读取 references/specification-project.md 作为项目专属 Token 映射"
    echo "   优先级高于 specification.md 通用映射，继续执行 Step 1"
    echo "$SEP"
    echo ""
    exit 0
fi

# Hash 不同 → 输出 config 内容，要求 AI 提取
if [ -n "$STORED_HASH" ]; then
    echo "🔄 tailwind.config 已变更"
    echo "   旧 hash: ${STORED_HASH:0:8}"
    echo "   新 hash: ${CURRENT_HASH:0:8}"
else
    echo "🆕 首次提取 tailwind.config tokens"
    echo "   hash: ${CURRENT_HASH:0:8}"
fi

echo ""
echo "── tailwind.config 内容 ──────────────────────"
echo ""
cat "$TAILWIND_CONFIG"
echo ""
echo "───────────────────────────────────────────────"
echo ""
echo "⚡ Step 0 指令（必须执行）："
echo "   1. 从上方 tailwind.config 内容中提取以下 token："
echo "      - theme.colors / theme.extend.colors"
echo "      - theme.spacing / theme.extend.spacing"
echo "      - theme.borderRadius / theme.extend.borderRadius"
echo "      - theme.screens（断点配置）"
echo "      - theme.fontFamily / theme.extend.fontFamily"
echo "   2. 将提取的 token 写入格式化的映射表"
echo "   3. 写入文件：references/specification-project.md"
echo "      第一行必须是：<!-- tailwind-config-hash: $CURRENT_HASH -->"
echo "      参考格式见下方模板"
echo "   4. 完成后继续执行 Step 1"
echo ""
echo "📋 specification-project.md 格式模板："
echo ""
cat << 'TEMPLATE'
<!-- tailwind-config-hash: {HASH} -->
# 项目专属 Design Token 映射

> 自动从 tailwind.config 提取，优先级高于 specification.md

## 颜色映射

| Figma 颜色 | Token 名 | Tailwind 类 |
|-----------|---------|------------|
| #XXXXXX | brand-primary | text-brand-primary / bg-brand-primary |

## 间距映射

| Figma 数值 | Tailwind 类 |
|-----------|------------|
| 16px | p-4 / m-4 / gap-4 |

## 断点配置

| 断点名 | 最小宽度 | 前缀 |
|-------|---------|------|
| mobile | max-759px | mobile: |
| pc | min-759px | pc: |

## 圆角映射

| Figma 圆角 | Tailwind 类 |
|-----------|------------|
| 8px | rounded-lg |
TEMPLATE

echo "$SEP"
echo ""
