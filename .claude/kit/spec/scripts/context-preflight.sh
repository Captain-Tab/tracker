#!/usr/bin/env bash

# context-preflight.sh - 为 /k/spec --c 加载历史 Context
# 输出结果由 AI 读取，决定后续的语义匹配或直接加载
# 用法: bash context-preflight.sh "$ARGUMENTS"

ARGUMENTS="$*"
SEP="━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── 1. 检查是否有 --c 标志 ────────────────────────────────────────────
if ! echo "$ARGUMENTS" | grep -q -- "--c"; then
    exit 0  # 无 --c，静默退出，不输出任何内容
fi

# ── 2. 查找 KIT_ROOT 并加载 context-lib ──────────────────────────────
KIT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
CONTEXT_LIB="$KIT_ROOT/.claude/kit/context/context-lib.sh"

if [ ! -f "$CONTEXT_LIB" ]; then
    echo "⚠️  未找到 context library，跳过 Context 预加载"
    exit 0
fi

# shellcheck source=/dev/null
source "$CONTEXT_LIB"
init_context_config || exit 0

# ── 3. 提取 --c 后面的关键词（第一个单词） ───────────────────────────
# 格式: --c <keyword> <requirement> 或 --c（无关键词）
KEYWORD=$(echo "$ARGUMENTS" | sed -n 's/.*--c \([^ ]*\).*/\1/p')

# 若关键词以 -- 开头，视为另一个 flag，关键词为空（智能模式）
if echo "$KEYWORD" | grep -q "^--"; then
    KEYWORD=""
fi

# ── 4A. 智能模式：--c 无关键词 ───────────────────────────────────────
if [ -z "$KEYWORD" ]; then
    echo ""
    echo "$SEP"
    echo "📚 Context 预加载 [智能匹配模式]"
    echo "$SEP"
    echo ""
    echo "以下是所有已记录功能的概览（L1 索引）"
    echo "AI 请根据需求语义进行匹配，然后展示候选给用户确认"
    echo ""
    context_list
    echo ""
    echo "$SEP"
    echo "⚡ 执行指令（Step 0 后续操作）："
    echo "   1. 基于上方 L1 索引 + 需求描述，语义匹配最相关的 1-3 个功能"
    echo "   2. 展示候选列表给用户确认（见 spec.md Step 0 格式）"
    echo "   3. 用户确认后再调用 context_load <id>"
    echo "$SEP"
    echo ""
    exit 0
fi

# ── 4B. 关键词模式：--c <keyword> ────────────────────────────────────
echo ""
echo "$SEP"
echo "📚 Context 预加载 [关键词模式: \"$KEYWORD\"]"
echo "$SEP"
echo ""

# 第一层：Index 搜索（标题/摘要/标签）
INDEX_OUTPUT=$(context_search "$KEYWORD" 2>/dev/null)
HAS_INDEX_RESULT=false
if echo "$INDEX_OUTPUT" | grep -q "^\["; then
    HAS_INDEX_RESULT=true
fi

# 第二层：Document 搜索（全文 grep）
DOC_FILES=""
if [ -d "$CONTEXT_PROJECT_DIR" ]; then
    DOC_FILES=$(grep -rl "$KEYWORD" "$CONTEXT_PROJECT_DIR" \
        --include="*.md" 2>/dev/null | \
        grep -v "context-index.json" | head -5)
fi
HAS_DOC_RESULT=false
if [ -n "$DOC_FILES" ]; then
    HAS_DOC_RESULT=true
fi

# ── 无结果：输出反问模板 ──────────────────────────────────────────────
if ! $HAS_INDEX_RESULT && ! $HAS_DOC_RESULT; then
    echo "❌ 未找到关键词 \"$KEYWORD\" 的匹配结果"
    echo ""
    echo "$SEP"
    echo "❓ 请直接展示以下内容给用户："
    echo "$SEP"
    echo ""
    echo "未找到与「$KEYWORD」相关的历史 Context。"
    echo ""
    echo "以下是所有已记录功能，可选择参考："
    echo ""
    context_list
    echo ""
    echo "请选择："
    echo "  A. 从以上列表中选择相关功能（回复功能名称或关键词）"
    echo "  B. 补充更多关键词，重新搜索"
    echo "  C. 跳过历史参考，直接开始"
    echo ""
    exit 0
fi

# ── 有结果：输出供 AI 直接加载 ────────────────────────────────────────
if $HAS_INDEX_RESULT; then
    echo "🔍 Index 搜索命中："
    echo "$INDEX_OUTPUT" | grep "^\[" | while IFS= read -r line; do
        echo "  $line"
    done
    echo ""
fi

if $HAS_DOC_RESULT; then
    echo "📄 Document 搜索命中："
    echo "$DOC_FILES" | while IFS= read -r f; do
        PARENT=$(basename "$(dirname "$f")")
        BASENAME=$(basename "$f")
        echo "  - $PARENT/$BASENAME"
    done
    echo ""
fi

echo "$SEP"
echo "⚡ 执行指令（Step 0 后续操作）："
echo "   已找到匹配结果，直接加载（无需反问用户）"
echo "   使用 context_load <feature-id> 加载对应文档"
echo "$SEP"
echo ""
