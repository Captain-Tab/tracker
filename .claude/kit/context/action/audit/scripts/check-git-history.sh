#!/bin/bash
# check-git-history.sh - 检查单个 context 的 git 历史变更
# 用法: bash check-git-history.sh <feature-id> [target-repo-path]
# 输出: 人类可读的审计报告（零 AI token 消耗）

FEATURE_ID="$1"
TARGET_REPO="$2"

if [ -z "$FEATURE_ID" ]; then
    echo "❌ 缺少参数: feature-id"
    echo "用法: /k/context audit <feature-id>"
    exit 1
fi

# 定位 KIT_ROOT
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KIT_ROOT="$(cd "$SCRIPT_DIR/../../../../../.." && pwd)"

source "$KIT_ROOT/.claude/kit/context/context-lib.sh"
init_context_config

# 从 soso-kit 主仓库运行时，PROJECT_NAME 被检测为 soso-kit
# audit 目标是 sodex-web 的 context，需要修正
if [ "$PROJECT_NAME" = "soso-kit" ]; then
    export PROJECT_NAME=sodex-web
    export CONTEXT_PROJECT_DIR="$CONTEXT_LIBRARY_DIR/sodex-web"
    export CONTEXT_INDEX_FILE="$CONTEXT_PROJECT_DIR/context-index.json"
fi

# ── 1. 在所有 router JSON 中查找 feature ──────────────────────────────────
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
REF_PATH=$(echo "$FEATURE_JSON" | jq -r '.referencePath')
MODULE=$(echo "$FEATURE_JSON" | jq -r '.module')

# ── 2. 读取 keyFiles ──────────────────────────────────────────────────────
KEY_FILES_JSON=$(echo "$FEATURE_JSON" | jq -r '.quickRef.keyFiles[]' 2>/dev/null)

if [ -z "$KEY_FILES_JSON" ]; then
    echo "❌ 该 context 没有 keyFiles，无法检测"
    exit 1
fi

# ── 3. 自动检测目标代码库路径 ─────────────────────────────────────────────
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
    echo "❌ 未找到目标代码库，请手动指定路径："
    echo "   bash check-git-history.sh $FEATURE_ID /path/to/sodex-web"
    exit 1
fi

# ── 4. 输出报告头部 ───────────────────────────────────────────────────────
echo "🔍 Context Audit"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  功能 ID  : $FEATURE_ID"
echo "  标题     : $TITLE"
echo "  文档更新 : $UPDATED"
echo "  代码库   : $TARGET_REPO"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📋 文件变更 (自 $UPDATED 起):"
echo ""

# ── 5. 逐文件检查 git log ────────────────────────────────────────────────
TOTAL_COMMITS=0
HOT_COMMITS=0  # feat / fix / refactor / perf

while IFS= read -r file; do
    [ -z "$file" ] && continue

    commits=$(git -C "$TARGET_REPO" log \
        --since="$UPDATED" \
        --format="%h %s" \
        -- "$file" 2>/dev/null)

    if [ -n "$commits" ]; then
        file_count=$(echo "$commits" | wc -l | tr -d ' ')
        TOTAL_COMMITS=$((TOTAL_COMMITS + file_count))

        echo "  📄 $file  ($file_count commits)"

        while IFS= read -r commit; do
            # 判断 commit 类型
            if echo "$commit" | grep -qE " (feat|fix|refactor|perf)(\(.+\))?:"; then
                icon="🔴"
                HOT_COMMITS=$((HOT_COMMITS + 1))
            elif echo "$commit" | grep -qE " (chore|style|test|docs|ci)(\(.+\))?:"; then
                icon="⚪"
            else
                icon="🟡"
            fi
            echo "    $icon $commit"
        done <<< "$commits"
        echo ""
    else
        echo "  ✅ $file  (无改动)"
    fi

done <<< "$KEY_FILES_JSON"

# ── 6. 汇总与结论 ─────────────────────────────────────────────────────────
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ "$TOTAL_COMMITS" -eq 0 ]; then
    echo "✅ 文档是最新的，无需更新"
    echo "   自 $UPDATED 以来关键文件无任何 commits"
    echo ""
    echo "AUDIT_RESULT=up_to_date"

elif [ "$HOT_COMMITS" -gt 0 ]; then
    echo "⚠️  建议更新文档"
    echo "   共 $TOTAL_COMMITS 个 commits，其中 $HOT_COMMITS 个为 feat/fix/refactor/perf"
    echo ""
    echo "  图例: 🔴 feat/fix/refactor/perf  🟡 unknown  ⚪ chore/style/test"
    echo "  文档 : $CONTEXT_PROJECT_DIR/$REF_PATH"
    echo ""
    echo "AUDIT_RESULT=needs_update"
    echo "AUDIT_HOT=$HOT_COMMITS"
    echo "AUDIT_TOTAL=$TOTAL_COMMITS"

else
    echo "💡 改动较轻微，按需更新"
    echo "   共 $TOTAL_COMMITS 个 commits，均为 chore/style/test 类型"
    echo "   这类改动通常不影响核心文档"
    echo ""
    echo "AUDIT_RESULT=minor_changes"
    echo "AUDIT_TOTAL=$TOTAL_COMMITS"
fi
