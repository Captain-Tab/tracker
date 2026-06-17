#!/bin/bash
# learn-from-code.sh - 代码结构扫描（Step 1a 辅助工具）
#
# 对目标路径运行 outline 扫描，输出：
#   - 每个文件的符号骨架（函数/类/行号）
#   - 按读取优先级排列的文件列表
#   - FILE_TOKENS_TOTAL（供 discovery_cost 计算）
#
# 用法: bash learn-from-code.sh <code-path>

CODE_PATH="$1"

if [ -z "$CODE_PATH" ]; then
  echo "❌ 缺少参数: 代码路径"
  echo "用法: bash learn-from-code.sh <code-path>"
  exit 1
fi

if [ ! -e "$CODE_PATH" ]; then
  echo "❌ 路径不存在: $CODE_PATH"
  exit 1
fi

# 定位 KIT_ROOT
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KIT_ROOT="$(cd "$SCRIPT_DIR/../../../../../.." && pwd)"
OUTLINE_SH="$KIT_ROOT/.claude/kit/context/tools/outline.sh"

if [ ! -f "$OUTLINE_SH" ]; then
  echo "❌ 未找到 outline.sh: $OUTLINE_SH"
  exit 1
fi

# ── 收集文件列表 ─────────────────────────────────────────────────────────────

if [ -f "$CODE_PATH" ]; then
  IS_SINGLE=true
  ALL_FILES="$CODE_PATH"
  FILE_COUNT=1
else
  IS_SINGLE=false
  ALL_FILES=$(find "$CODE_PATH" -type f \( -name "*.ts" -o -name "*.tsx" \) \
    ! -path "*/node_modules/*" ! -path "*/.next/*" ! -path "*/dist/*" \
    | sort)
  FILE_COUNT=$(echo "$ALL_FILES" | grep -c . 2>/dev/null || echo 0)
fi

if [ "$FILE_COUNT" -eq 0 ]; then
  echo "❌ 未找到 TS/TSX 文件: $CODE_PATH"
  exit 1
fi

# ── 按优先级排序文件（供 Step 1b 读取顺序参考） ──────────────────────────────
# 优先级: hooks(1) > index(2) > tsx(3) > types(4) > ts(5)

SORTED_FILES=""
while IFS= read -r f; do
  [ -z "$f" ] && continue
  base="$(basename "$f")"
  if [[ "$base" == use*.ts || "$base" == use*.tsx ]]; then
    SORTED_FILES+="1_$f"$'\n'
  elif [[ "$base" == index.ts || "$base" == index.tsx ]]; then
    SORTED_FILES+="2_$f"$'\n'
  elif [[ "$base" == *.tsx ]]; then
    SORTED_FILES+="3_$f"$'\n'
  elif [[ "$base" == types.ts || "$base" == *.type.ts ]]; then
    SORTED_FILES+="4_$f"$'\n'
  else
    SORTED_FILES+="5_$f"$'\n'
  fi
done <<< "$ALL_FILES"

SORTED_FILES=$(echo "$SORTED_FILES" | sort | sed 's/^[1-9]_//')

# ── 输出报告头 ───────────────────────────────────────────────────────────────

echo "📚 代码结构扫描: $CODE_PATH"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  文件数量 : $FILE_COUNT"
echo "  扫描方式 : outline (TS Compiler API → regex fallback)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ── 逐文件执行 outline ───────────────────────────────────────────────────────

FILE_TOKENS_TOTAL=0

while IFS= read -r file; do
  [ -z "$file" ] && continue

  if [ "$IS_SINGLE" = true ]; then
    PROJECT_ROOT="$(dirname "$CODE_PATH")"
  else
    PROJECT_ROOT="$CODE_PATH"
  fi

  OUTLINE_OUTPUT=$(bash "$OUTLINE_SH" "$file" "$PROJECT_ROOT" 2>/dev/null)

  if [ -n "$OUTLINE_OUTPUT" ]; then
    echo "$OUTLINE_OUTPUT"
  else
    echo "⚠️  无法解析: $file"
    echo ""
  fi

  # 累计 token 估算（从 outline 的 "~N tokens 如全量读取" 提取）
  file_tokens=$(echo "$OUTLINE_OUTPUT" | grep -oE '~[0-9]+ tokens' | grep -oE '[0-9]+' | head -1)
  [ -n "$file_tokens" ] && FILE_TOKENS_TOTAL=$((FILE_TOKENS_TOTAL + file_tokens))

done <<< "$SORTED_FILES"

# ── Step 1b 读取顺序 ─────────────────────────────────────────────────────────

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📋 Step 1b 读取顺序（按优先级）"
echo ""
i=1
while IFS= read -r file; do
  [ -z "$file" ] && continue
  echo "  $i. $file"
  i=$((i + 1))
done <<< "$SORTED_FILES"
echo ""

# ── 汇总 ─────────────────────────────────────────────────────────────────────

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📊 扫描汇总"
echo "  文件数量            : $FILE_COUNT"
echo "  全量读取 token 估算 : ~$FILE_TOKENS_TOTAL tokens（用于 discovery_cost）"
echo ""
echo "  💡 按需精读（节省 token）："
echo "     /k/context unfold <file> <symbol>  # 精确取出单个函数"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "FILE_TOKENS_TOTAL=$FILE_TOKENS_TOTAL"
echo "SCAN_FILES=$FILE_COUNT"
