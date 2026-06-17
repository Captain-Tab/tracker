#!/bin/bash
# 返回 0 = auto 模式开启，1 = 关闭
KIT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
if [ -f "$KIT_ROOT/.claude/kit/spec/AUTO" ]; then
  echo "AUTO_MODE=on"
  exit 0
else
  echo "AUTO_MODE=off"
  exit 1
fi
