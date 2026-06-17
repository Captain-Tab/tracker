#!/bin/bash
# tools/unfold.sh - 按符号名提取函数/方法完整实现（shell 包装器）
# 用法: bash unfold.sh <file-path> <symbol-name> [project-root]

FILE_PATH="$1"
SYMBOL_NAME="$2"
PROJECT_ROOT="${3:-$(pwd)}"

if [ -z "$FILE_PATH" ] || [ -z "$SYMBOL_NAME" ]; then
  echo "❌ 缺少参数"
  echo "用法: /k/context unfold <file-path> <symbol-name>"
  echo "示例: /k/context unfold src/stores/VaultStore.ts VaultStore.deposit"
  echo "      /k/context unfold src/hooks/useVault.ts useVault"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UNFOLD_JS="$SCRIPT_DIR/unfold.js"

if [ ! -f "$UNFOLD_JS" ]; then
  echo "❌ 未找到 unfold.js: $UNFOLD_JS"
  exit 1
fi

node "$UNFOLD_JS" "$FILE_PATH" "$SYMBOL_NAME" "$PROJECT_ROOT"
