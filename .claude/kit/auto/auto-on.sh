#!/bin/bash
KIT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
mkdir -p "$KIT_ROOT/.claude/kit/spec"
touch "$KIT_ROOT/.claude/kit/spec/AUTO"
echo "✅ Auto 模式已开启（/k:spec 和 /k:clarify 将自动搜索 context）"
