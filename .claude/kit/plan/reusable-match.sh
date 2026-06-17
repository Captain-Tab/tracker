#!/bin/bash
# reusable-match.sh <reusable_file> <tags>
# 输入逗号分隔的 tags，输出匹配的区块
# 无匹配时无输出

REUSABLE_FILE="$1"
TAGS="$2"

if [ -z "$REUSABLE_FILE" ] || [ -z "$TAGS" ] || [ ! -f "$REUSABLE_FILE" ]; then
  exit 0
fi

# 将 tags 转为 grep 正则: "金额|余额|价格"
PATTERN=$(echo "$TAGS" | sed 's/,/|/g')

# 找到匹配的 <!-- tags: --> 行号
MATCHED_LINES=$(grep -n "<!-- tags:.*" "$REUSABLE_FILE" | grep -iE "$PATTERN" | cut -d: -f1)

if [ -z "$MATCHED_LINES" ]; then
  exit 0
fi

# 获取所有 tag 行号（用于确定区块边界）
ALL_TAG_LINES=$(grep -n "^<!-- tags:" "$REUSABLE_FILE" | cut -d: -f1)
TOTAL_LINES=$(wc -l < "$REUSABLE_FILE")

echo "📏 **复用提示**（自动匹配）"
echo ""

for LINE in $MATCHED_LINES; do
  # 找下一个 tag 行作为区块结束
  END_LINE="$TOTAL_LINES"
  for TAG_LINE in $ALL_TAG_LINES; do
    if [ "$TAG_LINE" -gt "$LINE" ]; then
      END_LINE=$((TAG_LINE - 1))
      break
    fi
  done

  # 输出区块（跳过 <!-- tags: --> 行本身）
  sed -n "$((LINE + 1)),${END_LINE}p" "$REUSABLE_FILE" | sed '/^$/d' | head -20
  echo ""
done
