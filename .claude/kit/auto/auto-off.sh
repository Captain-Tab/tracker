#!/bin/bash
KIT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
rm -f "$KIT_ROOT/.claude/kit/spec/AUTO"
echo "✅ Auto 模式已关闭（恢复标准模式）"
