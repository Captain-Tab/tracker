#!/bin/bash
# tools/outline.sh - 文件符号骨架提取工具（shell 包装器）
# 用法: bash outline.sh <file-path> [project-root]

FILE_PATH="$1"
PROJECT_ROOT="${2:-$(pwd)}"

if [ -z "$FILE_PATH" ]; then
  echo "❌ 缺少参数: 文件路径"
  echo "用法: /k/context outline <file-path>"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTLINE_JS="$SCRIPT_DIR/outline.js"

if [ ! -f "$OUTLINE_JS" ]; then
  echo "❌ 未找到 outline.js: $OUTLINE_JS"
  exit 1
fi

node "$OUTLINE_JS" "$FILE_PATH" "$PROJECT_ROOT"
