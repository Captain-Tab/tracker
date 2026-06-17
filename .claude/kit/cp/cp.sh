#!/usr/bin/env bash
# /k:cp 快捷 prompt：按名精确 cat 片段；空参或未命中则列出可用片段
KIT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
DIR="$KIT_ROOT/.claude/kit/cp/prompts"
ARG="${1:-}"

# 仅列 .md 片段名，无文件时不报错
list() { for f in "$DIR"/*.md; do [ -e "$f" ] && basename "$f" .md; done; }

if [ -z "$ARG" ]; then
  echo "用法：/k:cp <名字>。可用片段："
  list
elif [ -f "$DIR/$ARG.md" ]; then
  cat "$DIR/$ARG.md"
else
  echo "❌ 没有片段 '$ARG'。可用片段："
  list
fi
