#!/bin/bash

# 合并 spec 文档，生成符合 context 规范的 history 文档

set -e

# 加载辅助函数
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/record-helpers.sh"

# 参数解析
SPEC_DIR=""
OUTPUT_PATH=""
FEATURE_ID=""
RECORD_TYPE=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --spec-dir)
            SPEC_DIR="$2"
            shift 2
            ;;
        --output-path)
            OUTPUT_PATH="$2"
            shift 2
            ;;
        --feature-id)
            FEATURE_ID="$2"
            shift 2
            ;;
        --type)
            RECORD_TYPE="$2"
            shift 2
            ;;
        *)
            echo "未知参数: $1"
            exit 1
            ;;
    esac
done

# 验证必需参数
if [ -z "$SPEC_DIR" ] || [ -z "$OUTPUT_PATH" ] || [ -z "$FEATURE_ID" ]; then
    echo "❌ 缺少必需参数"
    echo "用法: $0 --spec-dir <dir> --output-path <path> --feature-id <id> [--type <type>]"
    exit 1
fi

# 读取 spec 内容
SPEC_CONTENT=$(read_spec_content "$SPEC_DIR")

if [ -z "$SPEC_CONTENT" ]; then
    echo "❌ 无法读取 spec 内容"
    exit 1
fi

# 提取标题（从 spec 第一行或 FEATURE_ID）
TITLE=$(echo "$SPEC_CONTENT" | head -1 | sed 's/^# //')
if [ -z "$TITLE" ]; then
    TITLE="$FEATURE_ID"
fi

# 提取核心需求
CORE_REQUIREMENT=$(echo "$SPEC_CONTENT" | awk '
    /## (核心需求|Core Requirement|问题描述|背景|Background)/ { flag=1; next }
    /^##/ { if (flag) exit }
    flag { print }
' | sed '/^$/d')

# 如果没有找到，使用前几段
if [ -z "$CORE_REQUIREMENT" ]; then
    CORE_REQUIREMENT=$(echo "$SPEC_CONTENT" | sed -n '2,20p' | grep -v '^#')
fi

# 提取解决方案
SOLUTION=$(echo "$SPEC_CONTENT" | awk '
    /## (解决方案|Solution|实现方案|核心逻辑)/ { flag=1; next }
    /^##/ { if (flag) exit }
    flag { print }
')

# 提取流程图
FLOWCHARTS=$(extract_core_flowcharts "$SPEC_CONTENT")

# 提取组件列表
COMPONENTS=$(extract_core_components "$SPEC_CONTENT")

# 提取文件列表
FILES=$(extract_file_paths "$SPEC_CONTENT")

# 生成符合 context 规范的 history 文档
MERGED_CONTENT=$(cat <<EOF
# ${TITLE}

## 核心需求

${CORE_REQUIREMENT}

---

## 核心流程图

${FLOWCHARTS:-"暂无流程图"}

---

## 核心组件

| 组件 | 路径 | 作用 |
|------|------|------|
$(echo "$COMPONENTS" | head -10 | awk '{print "| "$0" | | |"}')

---

## 解决方案

${SOLUTION:-"详见下方完整规范"}

---

## 核心文件

$(echo "$FILES" | head -10 | awk '{print "- "$0}')

---

## 完整规范

${SPEC_CONTENT}

---

## 更新记录

- $(date +%Y-%m-%d) 初始版本

EOF
)

# 确保输出目录存在
OUTPUT_DIR=$(dirname "$OUTPUT_PATH")
mkdir -p "$OUTPUT_DIR"

# 写入合并文档
echo "$MERGED_CONTENT" > "$OUTPUT_PATH"

echo "✅ 文档合并完成: $OUTPUT_PATH"
echo "📄 文档格式符合 context history 规范"
