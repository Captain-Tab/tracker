#!/bin/bash

# 分析文档并生成 quickRef 和 sections

set -e

# 加载辅助函数
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/record-helpers.sh"

# 参数解析
DOC_PATH=""
FEATURE_ID=""
MODULE=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --doc-path)
            DOC_PATH="$2"
            shift 2
            ;;
        --feature-id)
            FEATURE_ID="$2"
            shift 2
            ;;
        --module)
            MODULE="$2"
            shift 2
            ;;
        *)
            echo "未知参数: $1"
            exit 1
            ;;
    esac
done

# 验证参数
if [ -z "$DOC_PATH" ] || [ ! -f "$DOC_PATH" ]; then
    echo "❌ 文档文件不存在: $DOC_PATH"
    exit 1
fi

# 读取文档内容
CONTENT=$(cat "$DOC_PATH")

# 提取核心逻辑（从特定章节）
CORE_LOGIC=$(echo "$CONTENT" | awk '
    /## (核心需求|核心逻辑|解决方案|Core Logic)/ { flag=1; next }
    /^##/ { if (flag) exit }
    flag && /^[-*]/ { print }
' | head -5 | sed 's/^[-*] //')

# 如果没找到，尝试提取前几个要点
if [ -z "$CORE_LOGIC" ]; then
    CORE_LOGIC=$(echo "$CONTENT" | grep -E "^[-*] " | head -4 | sed 's/^[-*] //')
fi

# 提取关键组件
KEY_COMPONENTS=$(echo "$CONTENT" | awk '
    /## (核心组件|关键组件|Key Components|组件列表)/ { flag=1; next }
    /^##/ { if (flag) exit }
    flag && /[-*]/ { print }
' | head -5 | sed 's/^[-*] //')

# 提取文件路径
KEY_FILES=$(extract_file_paths "$CONTENT")

# 提取标签
TAGS=$(extract_tags "$CONTENT" "$MODULE")

# 提取 sections（按二级标题分段）
# 改进版：清理 emoji，准确计算行号范围
SECTIONS=$(echo "$CONTENT" | awk '
BEGIN {
    section_num = 0
    in_section = 0
    start_line = 0
}
/^## / {
    if (in_section && section_num > 0) {
        # 输出上一个 section
        end_line = NR - 1
        tokens = int((end_line - start_line + 1) * 15)
        printf "{\"title\":\"%s\",\"summary\":\"TODO: 生成摘要\",\"lineRange\":[%d,%d],\"estimatedTokens\":%d},",
            prev_title, start_line, end_line, tokens
    }
    # 开始新 section
    prev_title = substr($0, 4)
    # 清理 emoji 和特殊字符
    gsub(/[📋🪙🔗📜🎯🏗️🔄🛡️🚫📁🎨📝📍📅🎓💡⚠️✅❌🔍💎📊🔧⚡🌐💰🔒🎉]+ ?/, "", prev_title)
    gsub(/"/, "\\\"", prev_title)
    gsub(/^ +| +$/, "", prev_title)
    start_line = NR
    in_section = 1
    section_num++
    next
}
END {
    if (in_section && section_num > 0) {
        end_line = NR
        tokens = int((end_line - start_line + 1) * 15)
        printf "{\"title\":\"%s\",\"summary\":\"TODO: 生成摘要\",\"lineRange\":[%d,%d],\"estimatedTokens\":%d}",
            prev_title, start_line, end_line, tokens
    }
}
' | sed 's/,$//')

# 构建 JSON 输出
cat <<EOF
{
  "quickRef": {
    "coreLogic": [
$(echo "$CORE_LOGIC" | head -4 | awk '{printf "      \"%s\"%s\n", $0, (NR<4 ? "," : "")}')
    ],
    "keyComponents": [
$(echo "$KEY_COMPONENTS" | head -4 | awk '{printf "      \"%s\"%s\n", $0, (NR<4 ? "," : "")}')
    ],
    "keyFiles": [
$(echo "$KEY_FILES" | head -4 | awk '{printf "      \"%s\"%s\n", $0, (NR<4 ? "," : "")}')
    ],
    "relatedConcepts": [
$(echo "$TAGS" | head -5 | awk '{printf "      \"%s\"%s\n", $0, (NR<5 ? "," : "")}')
    ],
    "callers": [],
    "sideEffects": {
      "emits": [],
      "invalidates": [],
      "writes": []
    },
    "relatedFeatures": [],
    "pitfalls": []
  },
  "sections": [
${SECTIONS}
  ],
  "tags": [
$(echo "$TAGS" | head -8 | awk '{printf "    \"%s\"%s\n", $0, (NR<8 ? "," : "")}')
  ]
}
EOF
