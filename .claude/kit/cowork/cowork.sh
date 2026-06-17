#!/usr/bin/env bash
# /k:cowork 子命令：按名精确 cat 指令片段；空参或未命中则列出可用子命令
KIT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
DIR="$KIT_ROOT/.claude/kit/cowork/prompts"
ARG="${1%% *}"   # 只取第一个词作为子命令，忽略块ID等后续参数

list() { for f in "$DIR"/*.md; do [ -e "$f" ] && basename "$f" .md; done; }

if [ -z "$ARG" ]; then
  echo "用法：/k:cowork <子命令>。可用子命令："
  list
elif [ -f "$DIR/$ARG.md" ]; then
  cat "$DIR/$ARG.md"
else
  echo "❌ 没有子命令 '$ARG'。可用子命令："
  list
fi
