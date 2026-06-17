#!/bin/bash
# report.sh — Context 健康报告
# 输出：过期检测 + 共享文件风险 + 最近活动 + 模块覆盖

set -eo pipefail

# ── 定位 KIT_ROOT，自引导 context-lib.sh ───────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KIT_ROOT="$(cd "$SCRIPT_DIR/../../../../../.." && pwd)"

source "$KIT_ROOT/.claude/kit/context/context-lib.sh"
init_context_config

# 从 soso-kit 主仓库执行时，PROJECT_NAME 被检测为 soso-kit，修正为 sodex-web
if [ "$PROJECT_NAME" = "soso-kit" ]; then
    export PROJECT_NAME=sodex-web
    export CONTEXT_PROJECT_DIR="$CONTEXT_LIBRARY_DIR/sodex-web"
    export CONTEXT_INDEX_FILE="$CONTEXT_PROJECT_DIR/context-index.json"
fi

check_index_file || exit 1

TODAY=$(date +%Y-%m-%d)

# macOS / Linux 兼容的天数计算
_days_since() {
    local d="$1"
    local d_epoch t_epoch
    d_epoch=$(date -j -f "%Y-%m-%d" "$d" +%s 2>/dev/null) || \
    d_epoch=$(date -d "$d" +%s 2>/dev/null) || { echo "?"; return; }
    t_epoch=$(date +%s)
    echo $(( (t_epoch - d_epoch) / 86400 ))
}

TOTAL_FEATURES=$(jq '.meta.totalFeatures' "$CONTEXT_INDEX_FILE")

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║         Context Health Report — $TODAY            ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo "  Project: $PROJECT_NAME  |  Features: $TOTAL_FEATURES"
echo ""

# ── 1. Feature 列表 + 过期检测 ─────────────────────────────────
echo "┌─ Features ─────────────────────────────────────────────────┐"
printf "  %-26s %-12s %-5s %-12s %s\n" "ID" "Updated" "Days" "Cost" "Status"
echo "  ──────────────────────────────────────────────────────────"

for router_file in "$CONTEXT_PROJECT_DIR/router/"*.json; do
    jq -r '.features | to_entries[] | [.key, (.value.updated // "?"), (.value.discovery_cost // "?")] | @tsv' "$router_file"
done | sort | while IFS=$'\t' read -r fid updated cost_raw; do
    cost="${cost_raw:0:12}"
    feat_days=""
    feat_flag=""
    if [ "$updated" = "?" ]; then
        feat_days="?"
        feat_flag="❓ no date"
    else
        feat_days=$(_days_since "$updated")
        if   [ "$feat_days" = "?" ];          then feat_flag="❓ parse err"
        elif [ "$feat_days" -gt 30 ];         then feat_flag="⚠️  stale"
        elif [ "$feat_days" -gt 14 ];         then feat_flag="⏰ aging"
        else                                       feat_flag="✅ fresh"
        fi
    fi
    printf "  %-26s %-12s %-5s %-12s %s\n" "$fid" "$updated" "${feat_days}d" "$cost" "$feat_flag"
done

echo "└────────────────────────────────────────────────────────────┘"
echo ""

# ── 2. 高风险共享文件 ──────────────────────────────────────────
FILES_INDEX="$CONTEXT_PROJECT_DIR/indexes/files.json"
if [ -f "$FILES_INDEX" ]; then
    echo "┌─ 高风险共享文件 ───────────────────────────────────────────┐"
    shared_count=$(jq '[.index | to_entries[] | select(.value.features | length > 1)] | length' "$FILES_INDEX")

    if [ "$shared_count" -eq 0 ]; then
        echo "  ✅ 无共享文件"
    else
        jq -r '
            .index | to_entries[]
            | select(.value.features | length > 1)
            | [(.value.features | length | tostring), .key, (.value.features | join(", "))]
            | @tsv
        ' "$FILES_INDEX" | sort -rn | while IFS=$'\t' read -r count fpath features; do
            fname=$(basename "$fpath")
            echo "  [${count}×] $fname"
            echo "       → $features"
            echo "       $fpath"
        done
    fi

    echo "└────────────────────────────────────────────────────────────┘"
    echo ""
fi

# ── 3. 最近活动（recentQueue）─────────────────────────────────
echo "┌─ 最近活动 ─────────────────────────────────────────────────┐"
recent_count=$(jq '.recentQueue | length' "$CONTEXT_INDEX_FILE" 2>/dev/null || echo 0)

if [ "$recent_count" -eq 0 ]; then
    echo "  (暂无记录)"
else
    jq -r '.recentQueue[] | "  \(.date)  [\(.id)]  \(.summary)"' "$CONTEXT_INDEX_FILE" 2>/dev/null \
        | head -5 \
        | while IFS= read -r line; do
            [ ${#line} -gt 80 ] && echo "${line:0:77}..." || echo "$line"
        done
fi

echo "└────────────────────────────────────────────────────────────┘"
echo ""

# ── 4. 模块覆盖 ────────────────────────────────────────────────
echo "┌─ 模块覆盖 ─────────────────────────────────────────────────┐"
jq -r '.modules[] | "  \(.emoji) \(.name) (\(.id)): \(.features | length) features"' "$CONTEXT_INDEX_FILE" \
    | while IFS= read -r line; do
        echo "$line" | grep -q ": 0 features" && echo "$line  ← 空模块" || echo "$line"
    done
echo "└────────────────────────────────────────────────────────────┘"
echo ""
echo "  提示: ⚠️ stale = 超过30天未更新  ⏰ aging = 超过14天"
echo ""
