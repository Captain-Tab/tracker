#!/usr/bin/env bash
# 用法: cleanup.sh <project-root> [--keep-log]
# 例:   cleanup.sh /Users/soso/Documents/code/sosovalue-pc
#
# 完成 4 步清理:
# 1. 删除所有 // [CAPTURE] 标记的拦截器行
# 2. 报告 [CAPTURE-TEMP] 临时配置改动（不自动回滚，需人工 Edit 还原以保安全）
# 3. 停止 debug 服务
# 4. 删除 debug.log

set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Usage: $0 <project-root> [--keep-log]" >&2
  exit 1
fi

PROJECT_ROOT="$1"
KEEP_LOG=false
[ "${2:-}" = "--keep-log" ] && KEEP_LOG=true

if [ ! -d "$PROJECT_ROOT" ]; then
  echo "❌ project root not found: $PROJECT_ROOT" >&2
  exit 1
fi

echo "── 1. 删除 [CAPTURE] 拦截器行 ──"
FILES=$(grep -rln "// \[CAPTURE\]" "$PROJECT_ROOT" \
  --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" \
  --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.next 2>/dev/null || true)

if [ -n "$FILES" ]; then
  echo "$FILES" | while IFS= read -r f; do
    sed -i '' '/\/\/ \[CAPTURE\]/d' "$f"
    echo "  ✅ $f"
  done
else
  echo "  ℹ 无拦截器行"
fi

# 验证无残留
LEFT=$(grep -rn "// \[CAPTURE\]" "$PROJECT_ROOT" \
  --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" \
  --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.next 2>/dev/null | wc -l | tr -d ' ')

if [ "$LEFT" != "0" ]; then
  echo "  ❌ 仍有 $LEFT 行残留" >&2
  exit 1
fi

echo "── 2. 检测 [CAPTURE-TEMP] 临时配置改动 ──"
TEMP_FILES=$(grep -rln "\[CAPTURE-TEMP\]" "$PROJECT_ROOT" \
  --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" \
  --include="*.json" --include="*.env*" \
  --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.next 2>/dev/null || true)

if [ -n "$TEMP_FILES" ]; then
  echo "⚠ 检测到以下文件含 [CAPTURE-TEMP] 标记，请人工 Edit 还原（避免误删生产配置）:"
  echo "$TEMP_FILES" | while IFS= read -r f; do
    echo "  ⚠ $f"
    grep -n "\[CAPTURE-TEMP\]" "$f" | sed 's/^/      /'
  done
else
  echo "  ℹ 无临时配置标记"
fi

echo "── 3. 停止 debug 服务 ──"
KIT_ROOT="$(git -C "$PROJECT_ROOT" rev-parse --show-toplevel 2>/dev/null || dirname "$(dirname "$(dirname "${BASH_SOURCE[0]}")")")"
START_SERVER="$KIT_ROOT/.claude/kit/debug/scripts/start-server.sh"
if [ ! -f "$START_SERVER" ]; then
  START_SERVER="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../debug/scripts" && pwd)/start-server.sh"
fi
if [ -f "$START_SERVER" ]; then
  bash "$START_SERVER" stop "$PROJECT_ROOT" 2>/dev/null || echo "  ℹ 服务未运行或已停止"
else
  echo "  ⚠ start-server.sh 未找到，跳过"
fi

echo "── 4. 删除 debug.log ──"
if [ "$KEEP_LOG" = true ]; then
  echo "  ℹ --keep-log 选项启用，保留 $PROJECT_ROOT/debug.log"
else
  rm -f "$PROJECT_ROOT/debug.log"
  echo "  ✅ 已删除"
fi

echo ""
echo "✅ Cleanup 完成"
