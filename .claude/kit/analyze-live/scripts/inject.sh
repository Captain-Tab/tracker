#!/usr/bin/env bash
# 用法: inject.sh <entry-file> <port> <pattern1,pattern2,...>
# 例:   inject.sh pages/_app.tsx 9876 findPage,analyst-ratings,us-stock
#
# 读取 interceptor.template.js 模板，替换 {{PORT}} 和 {{PATTERNS}}，追加到 entry-file 末尾。
# 所有注入行带 // [CAPTURE] 标记，cleanup.sh 按标记清除。

set -euo pipefail

if [ $# -lt 3 ]; then
  echo "Usage: $0 <entry-file> <port> <pattern1,pattern2,...>" >&2
  exit 1
fi

ENTRY="$1"
PORT="$2"
PATTERNS_RAW="$3"

if [ ! -f "$ENTRY" ]; then
  echo "❌ entry file not found: $ENTRY" >&2
  exit 1
fi

# 已注入则跳过
if grep -q "// \[CAPTURE\]" "$ENTRY"; then
  echo "⚠ 已存在 [CAPTURE] 标记，跳过注入。如需重装请先 cleanup.sh"
  exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE="$SCRIPT_DIR/../interceptor.template.js"

# 将逗号分隔的 patterns 转为 JS 字符串数组
IFS=',' read -ra ARR <<< "$PATTERNS_RAW"
JS_ARR="["
for p in "${ARR[@]}"; do
  JS_ARR+="\"$p\","
done
JS_ARR="${JS_ARR%,}]"

# 渲染模板
RENDERED=$(sed -e "s|{{PORT}}|$PORT|g" -e "s|{{PATTERNS}}|$JS_ARR|g" "$TEMPLATE")

# 追加（确保前面有空行）
printf "\n%s\n" "$RENDERED" >> "$ENTRY"

echo "✅ 拦截器已注入: $ENTRY (port=$PORT, patterns=$PATTERNS_RAW)"
echo "ℹ 行数: $(grep -c "// \[CAPTURE\]" "$ENTRY")"
