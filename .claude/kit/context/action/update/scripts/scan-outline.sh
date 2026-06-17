#!/bin/bash
# scan-outline.sh - 扫描 keyFiles 的符号骨架（零 AI token）
# 用法1: bash scan-outline.sh <feature-id> [target-repo-path]
# 用法2: bash scan-outline.sh --doc-path <doc-path> [target-repo-path]
# 输出: 人类可读的 outline 报告 + 机器可读变量（末尾）

DOC_PATH=""
FEATURE_ID=""
TARGET_REPO=""

# 解析参数
while [[ $# -gt 0 ]]; do
    case "$1" in
        --doc-path)
            DOC_PATH="$2"
            shift 2
            ;;
        --*)
            echo "❌ 未知参数: $1"
            exit 1
            ;;
        *)
            if [ -z "$FEATURE_ID" ] && [ -z "$DOC_PATH" ]; then
                FEATURE_ID="$1"
            elif [ -z "$TARGET_REPO" ]; then
                TARGET_REPO="$1"
            fi
            shift
            ;;
    esac
done

if [ -z "$FEATURE_ID" ] && [ -z "$DOC_PATH" ]; then
    echo "❌ 缺少参数"
    echo "用法1: bash scan-outline.sh <feature-id> [target-repo-path]"
    echo "用法2: bash scan-outline.sh --doc-path <doc-path> [target-repo-path]"
    exit 1
fi

# 定位 KIT_ROOT
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KIT_ROOT="$(cd "$SCRIPT_DIR/../../../../../.." && pwd)"

source "$KIT_ROOT/.claude/kit/context/context-lib.sh"
init_context_config

# 从 soso-kit 主仓库运行时修正 PROJECT_NAME
if [ "$PROJECT_NAME" = "soso-kit" ]; then
    export PROJECT_NAME=sodex-web
    export CONTEXT_PROJECT_DIR="$CONTEXT_LIBRARY_DIR/sodex-web"
fi

# ── 1. 获取 keyFiles ────────────────────────────────────────────────────────
TITLE=""
UPDATED="-"
KEY_FILES=""

if [ -n "$DOC_PATH" ]; then
    # doc-path 模式：从文档中提取 src/ 路径（用于 record Step 4.5）
    if [ ! -f "$DOC_PATH" ]; then
        echo "❌ 文档不存在: $DOC_PATH"
        exit 1
    fi
    KEY_FILES=$(grep -oE 'src/[a-zA-Z0-9/_.-]+\.(ts|tsx)' "$DOC_PATH" | sort -u)
    TITLE="(doc: $(basename "$DOC_PATH"))"
    if [ -z "$KEY_FILES" ]; then
        echo "❌ 文档中未找到 src/ 路径"
        exit 1
    fi
else
    # feature-id 模式：从 router JSON 读取 keyFiles（用于 update Step 2.5）
    FEATURE_JSON=""
    for router_file in "$CONTEXT_PROJECT_DIR/router/"*.json; do
        data=$(jq -c ".features[\"$FEATURE_ID\"] // empty" "$router_file" 2>/dev/null)
        if [ -n "$data" ]; then
            FEATURE_JSON="$data"
            break
        fi
    done

    if [ -z "$FEATURE_JSON" ]; then
        echo "❌ 未找到功能: $FEATURE_ID"
        echo "使用 /k/context list 查看所有功能 ID"
        exit 1
    fi

    TITLE=$(echo "$FEATURE_JSON" | jq -r '.title')
    UPDATED=$(echo "$FEATURE_JSON" | jq -r '.updated')
    KEY_FILES=$(echo "$FEATURE_JSON" | jq -r '.quickRef.keyFiles[]' 2>/dev/null)

    if [ -z "$KEY_FILES" ]; then
        echo "❌ 该 context 没有 keyFiles，无法扫描"
        exit 1
    fi
fi

# ── 2. 自动检测目标代码库路径 ─────────────────────────────────────────────
if [ -z "$TARGET_REPO" ]; then
    KIT_PARENT="$(cd "$KIT_ROOT/.." && pwd)"
    for candidate in \
        "$KIT_PARENT/sodex-web" \
        "$HOME/Documents/code/sodex-web" \
        "$HOME/code/sodex-web" \
        "$HOME/sodex-web"; do
        if [ -d "$candidate/.git" ]; then
            TARGET_REPO="$candidate"
            break
        fi
    done
fi

if [ -z "$TARGET_REPO" ] || [ ! -d "$TARGET_REPO/.git" ]; then
    if [ -n "$FEATURE_ID" ]; then
        echo "❌ 未找到目标代码库，请手动指定路径："
        echo "   bash scan-outline.sh $FEATURE_ID /path/to/sodex-web"
    else
        echo "⚠️  目标代码库未找到，跳过 outline 扫描"
        echo "FILE_TOKENS_TOTAL=0"
    fi
    exit 1
fi

# ── 3. 输出报告头部 ───────────────────────────────────────────────────────
echo "🔍 Outline 扫描"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [ -n "$FEATURE_ID" ]; then
    echo "  功能 ID  : $FEATURE_ID"
    echo "  标题     : $TITLE"
    echo "  文档更新 : $UPDATED"
else
    echo "  模式     : doc-path"
    echo "  文档     : $TITLE"
fi
echo "  代码库   : $TARGET_REPO"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ── 4. 统计变量 ────────────────────────────────────────────────────────────
TOTAL_FILES=0
TOTAL_EXPORTS=0
TOTAL_INTERNAL=0
FILE_TOKENS_TOTAL=0

# ── 5. 逐文件执行 outline ─────────────────────────────────────────────────
while IFS= read -r file; do
    [ -z "$file" ] && continue
    TOTAL_FILES=$((TOTAL_FILES + 1))

    FULL_PATH="$TARGET_REPO/$file"
    if [ ! -f "$FULL_PATH" ]; then
        echo "⚠️  文件不存在: $file"
        echo ""
        continue
    fi

    # 执行 outline
    OUTLINE_OUTPUT=$(bash "$KIT_ROOT/.claude/kit/context/tools/outline.sh" "$file" "$TARGET_REPO" 2>/dev/null)

    if [ -z "$OUTLINE_OUTPUT" ]; then
        echo "⚠️  无法解析: $file"
        echo ""
        continue
    fi

    echo "$OUTLINE_OUTPUT"
    echo ""

    # 统计导出和内部符号数
    EXPORTS_COUNT=$(echo "$OUTLINE_OUTPUT" | grep -c "\[exported\]" || echo "0")
    INTERNAL_COUNT=$(echo "$OUTLINE_OUTPUT" | grep -c "^  ƒ " | grep -v "\[exported\]" || echo "0")
    TOTAL_EXPORTS=$((TOTAL_EXPORTS + EXPORTS_COUNT))
    TOTAL_INTERNAL=$((TOTAL_INTERNAL + INTERNAL_COUNT))

    # 累计 token 估算
    file_tokens=$(echo "$OUTLINE_OUTPUT" | grep -oE '~[0-9]+ tokens' | grep -oE '[0-9]+' | head -1)
    [ -n "$file_tokens" ] && FILE_TOKENS_TOTAL=$((FILE_TOKENS_TOTAL + file_tokens))

done <<< "$KEY_FILES"

# ── 6. 输出汇总 ────────────────────────────────────────────────────────────
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📊 汇总"
echo "  扫描文件  : $TOTAL_FILES"
echo "  导出符号  : $TOTAL_EXPORTS"
echo "  内部符号  : $TOTAL_INTERNAL"
echo "  全量读取估算: ~$FILE_TOKENS_TOTAL tokens"
echo ""
echo "SCAN_RESULT=completed"
echo "SCAN_FILES=$TOTAL_FILES"
echo "SCAN_EXPORTS=$TOTAL_EXPORTS"
echo "FILE_TOKENS_TOTAL=$FILE_TOKENS_TOTAL"
