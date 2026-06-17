#!/usr/bin/env bash

# Kit 工作流前置检查脚本
# 用于检查工作流执行的前置条件
# 包括：spec 目录文档检测

set -e

JSON_MODE=false
SPEC_DIR=""

while [ $# -gt 0 ]; do
    case "$1" in
        --json) JSON_MODE=true ;;
        --spec)
            shift
            SPEC_DIR="$1"
            ;;
        --help|-h)
            echo "Usage: $0 [--json] [--spec <dir>]"
            echo ""
            echo "检查 Kit 工作流的前置条件"
            echo ""
            echo "Options:"
            echo "  --json              输出 JSON 格式"
            echo "  --spec <dir>        指定 spec 目录路径"
            echo "  --help              显示帮助信息"
            exit 0
            ;;
    esac
    shift
done

# 获取脚本所在目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KIT_DIR="$(dirname "$SCRIPT_DIR")"

# 尝试获取项目根目录
if git rev-parse --show-toplevel >/dev/null 2>&1; then
    PROJECT_ROOT=$(git rev-parse --show-toplevel)
else
    PROJECT_ROOT="$(dirname "$(dirname "$(dirname "$KIT_DIR")")")"
fi

# 默认 spec 目录为 k/spec/
if [ -z "$SPEC_DIR" ]; then
    SPEC_DIR="$KIT_DIR/spec"
fi

# 检查 spec 目录（需求文档）
SPEC_DIR_EXISTS=false
SPEC_FILES=()
SPEC_HAS_SPEC_MD=false

if [ -d "$SPEC_DIR" ]; then
    SPEC_DIR_EXISTS=true
    # 获取 spec 目录下的 .md 文件
    while IFS= read -r -d '' file; do
        filename="$(basename "$file")"
        SPEC_FILES+=("$filename")
        # 检查是否有 spec.md 文件
        if [ "$filename" = "spec.md" ]; then
            SPEC_HAS_SPEC_MD=true
        fi
    done < <(find "$SPEC_DIR" -maxdepth 2 -name "*.md" -print0 2>/dev/null)
fi

SPEC_COUNT=${#SPEC_FILES[@]}

# 确定需求来源
if [ "$SPEC_HAS_SPEC_MD" = true ] || [ $SPEC_COUNT -gt 0 ]; then
    SPEC_SOURCE="spec"
else
    SPEC_SOURCE="prompt"
fi

# ============================================
# 输出结果
# ============================================
if $JSON_MODE; then
    # JSON 输出
    printf '{'
    printf '"PROJECT_ROOT":"%s",' "$PROJECT_ROOT"
    printf '"KIT_DIR":"%s",' "$KIT_DIR"

    # Spec 目录信息
    printf '"SPEC_DIR":"%s",' "$SPEC_DIR"
    printf '"SPEC_DIR_EXISTS":%s,' "$SPEC_DIR_EXISTS"
    printf '"SPEC_COUNT":%d,' "$SPEC_COUNT"
    printf '"SPEC_HAS_SPEC_MD":%s,' "$SPEC_HAS_SPEC_MD"
    printf '"SPEC_FILES":['
    first=true
    for file in "${SPEC_FILES[@]}"; do
        if $first; then first=false; else printf ','; fi
        printf '"%s"' "$file"
    done
    printf '],'

    # 需求来源
    printf '"SPEC_SOURCE":"%s"' "$SPEC_SOURCE"
    printf '}\n'
else
    # 普通输出
    echo "=== Kit 工作流检查 ==="
    echo ""
    echo "PROJECT_ROOT: $PROJECT_ROOT"
    echo "KIT_DIR: $KIT_DIR"
    echo ""

    echo "--- Spec 目录 ---"
    echo "SPEC_DIR: $SPEC_DIR"
    echo "SPEC_DIR_EXISTS: $SPEC_DIR_EXISTS"
    echo "SPEC_COUNT: $SPEC_COUNT"
    echo "SPEC_HAS_SPEC_MD: $SPEC_HAS_SPEC_MD"
    if [ $SPEC_COUNT -gt 0 ]; then
        echo "SPEC_FILES:"
        for file in "${SPEC_FILES[@]}"; do
            echo "  - $file"
        done
    fi
    echo ""

    echo "--- 需求来源 ---"
    if [ "$SPEC_SOURCE" = "spec" ]; then
        echo "SPEC_SOURCE: 📄 spec 目录文档"
    else
        echo "SPEC_SOURCE: 📝 prompt 输入"
    fi
fi
