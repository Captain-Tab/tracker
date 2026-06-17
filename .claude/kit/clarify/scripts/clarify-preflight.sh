#!/usr/bin/env bash

# clarify-preflight.sh
# 扫描 .claude/kit/clarify/ 目录下的 .md 输入文件
# 用法: bash clarify-preflight.sh
# 输出: JSON { found, files[], dir }

KIT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
CLARIFY_DIR="$KIT_ROOT/.claude/kit/clarify"

# 目录不存在
if [ ! -d "$CLARIFY_DIR" ]; then
    echo '{"found":false,"files":[],"dir":""}'
    exit 0
fi

# 收集 .md 文件
FILES=()
while IFS= read -r -d '' file; do
    FILES+=("$(basename "$file")")
done < <(find "$CLARIFY_DIR" -maxdepth 1 -name "*.md" -print0 2>/dev/null)

if [ ${#FILES[@]} -eq 0 ]; then
    echo "{\"found\":false,\"files\":[],\"dir\":\"$CLARIFY_DIR\"}"
    exit 0
fi

# 构建 JSON 数组
JSON_FILES="["
FIRST=true
for f in "${FILES[@]}"; do
    if $FIRST; then FIRST=false; else JSON_FILES="$JSON_FILES,"; fi
    JSON_FILES="$JSON_FILES\"$f\""
done
JSON_FILES="$JSON_FILES]"

echo "{\"found\":true,\"files\":$JSON_FILES,\"dir\":\"$CLARIFY_DIR\"}"
