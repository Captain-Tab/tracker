#!/bin/bash

# 搜索相似功能（三级匹配策略）
# ⭐⭐⭐ 精准 Title 匹配
# ⭐⭐ 模糊 Title 匹配
# ⭐ Summary 关键词重叠

set -e

# 参数解析
TITLE=""
SUMMARY=""
MODIFIED_FILES=""
CONTEXT_INDEX_FILE=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --title)
            TITLE="$2"
            shift 2
            ;;
        --summary)
            SUMMARY="$2"
            shift 2
            ;;
        --files)
            MODIFIED_FILES="$2"
            shift 2
            ;;
        --index)
            CONTEXT_INDEX_FILE="$2"
            shift 2
            ;;
        *)
            echo "未知参数: $1"
            exit 1
            ;;
    esac
done

# 验证参数
if [ -z "$TITLE" ] || [ -z "$CONTEXT_INDEX_FILE" ]; then
    echo "❌ 缺少必需参数: --title 和 --index"
    exit 1
fi

if [ ! -f "$CONTEXT_INDEX_FILE" ]; then
    echo "❌ 索引文件不存在: $CONTEXT_INDEX_FILE"
    exit 1
fi

CONTEXT_DIR=$(dirname "$CONTEXT_INDEX_FILE")

# 获取所有模块和功能
MODULES=$(jq -r '.modules[] | .id' "$CONTEXT_INDEX_FILE")

# 结果数组
declare -a RESULTS

# ========================================
# ⭐⭐⭐ Level 1: 精准 Title 匹配（不区分大小写）
# ========================================
for module in $MODULES; do
    ROUTER_FILE="$CONTEXT_DIR/router/$module.json"

    if [ ! -f "$ROUTER_FILE" ]; then
        continue
    fi

    # 获取该模块的所有功能
    FEATURE_IDS=$(jq -r '.features | keys[]' "$ROUTER_FILE" 2>/dev/null || echo "")

    for fid in $FEATURE_IDS; do
        FEATURE_TITLE=$(jq -r ".features.\"$fid\".title" "$ROUTER_FILE")

        # 精准匹配（忽略大小写）
        if [ "$(echo "$FEATURE_TITLE" | tr '[:upper:]' '[:lower:]')" = "$(echo "$TITLE" | tr '[:upper:]' '[:lower:]')" ]; then
            RESULTS+=("EXACT|$fid|$module|100")
        fi
    done
done

# 如果找到精准匹配，直接返回
if [ ${#RESULTS[@]} -gt 0 ]; then
    for result in "${RESULTS[@]}"; do
        echo "$result"
    done
    exit 0
fi

# ========================================
# ⭐⭐ Level 2: 模糊 Title 匹配（关键词重叠）
# ========================================

# 提取标题关键词（移除常见词、标点）
extract_keywords() {
    local text="$1"
    echo "$text" | \
        tr '[:upper:]' '[:lower:]' | \
        sed 's/[^a-z0-9一-龥]/ /g' | \
        tr -s ' ' '\n' | \
        grep -v '^$' | \
        grep -v -E '^(the|a|an|and|or|of|to|in|for|is|with|完整|流程|功能|实现|修复|优化|问题)$'
}

TITLE_KEYWORDS=$(extract_keywords "$TITLE")
TITLE_KEYWORD_COUNT=$(echo "$TITLE_KEYWORDS" | wc -l)

for module in $MODULES; do
    ROUTER_FILE="$CONTEXT_DIR/router/$module.json"

    if [ ! -f "$ROUTER_FILE" ]; then
        continue
    fi

    FEATURE_IDS=$(jq -r '.features | keys[]' "$ROUTER_FILE" 2>/dev/null || echo "")

    for fid in $FEATURE_IDS; do
        FEATURE_TITLE=$(jq -r ".features.\"$fid\".title" "$ROUTER_FILE")
        FEATURE_KEYWORDS=$(extract_keywords "$FEATURE_TITLE")

        # 计算关键词重叠数
        OVERLAP_COUNT=0
        for keyword in $TITLE_KEYWORDS; do
            if echo "$FEATURE_KEYWORDS" | grep -q "$keyword"; then
                OVERLAP_COUNT=$((OVERLAP_COUNT + 1))
            fi
        done

        # 计算相似度（重叠数 / 总关键词数）
        if [ $TITLE_KEYWORD_COUNT -gt 0 ]; then
            SIMILARITY=$((OVERLAP_COUNT * 100 / TITLE_KEYWORD_COUNT))

            # 模糊匹配阈值：相似度 >= 50%
            if [ $SIMILARITY -ge 50 ]; then
                RESULTS+=("FUZZY|$fid|$module|$SIMILARITY")
            fi
        fi
    done
done

# 如果找到模糊匹配，按相似度排序并返回
if [ ${#RESULTS[@]} -gt 0 ]; then
    for result in "${RESULTS[@]}"; do
        echo "$result"
    done | sort -t'|' -k4 -rn  # 按相似度降序排序
    exit 0
fi

# ========================================
# Level 3a: Summary Jaccard 高置信度（防命名漂移）
# ========================================
# 场景：标题用词不同（中英差异、改名）但 summary 实质表达同一功能
# 算法：两段 summary 的词集合交并比 ≥ 70% → 判定为实质重复
# 灵感：agentmemory state/schema.ts:jaccardSimilarity（阈值 0.7）
# 排在 Level 3b 之前：jaccard 是更严格的语义指标，命中即"高置信"

jaccard_similarity() {
    local text_a="$1"
    local text_b="$2"
    local words_a words_b inter_count union_count
    words_a=$(extract_keywords "$text_a" | sort -u)
    words_b=$(extract_keywords "$text_b" | sort -u)
    [ -z "$words_a" ] || [ -z "$words_b" ] && { echo 0; return; }
    inter_count=$(comm -12 <(echo "$words_a") <(echo "$words_b") | grep -c . || true)
    union_count=$(printf '%s\n%s\n' "$words_a" "$words_b" | sort -u | grep -c . || true)
    [ "$union_count" -eq 0 ] && { echo 0; return; }
    echo $((inter_count * 100 / union_count))
}

if [ -n "$SUMMARY" ]; then
    for module in $MODULES; do
        ROUTER_FILE="$CONTEXT_DIR/router/$module.json"
        [ -f "$ROUTER_FILE" ] || continue

        FEATURE_IDS=$(jq -r '.features | keys[]?' "$ROUTER_FILE" 2>/dev/null || echo "")
        for fid in $FEATURE_IDS; do
            FEATURE_SUMMARY=$(jq -r ".features.\"$fid\".summary // \"\"" "$ROUTER_FILE")
            [ -z "$FEATURE_SUMMARY" ] && continue
            SCORE=$(jaccard_similarity "$SUMMARY" "$FEATURE_SUMMARY")
            if [ "$SCORE" -ge 70 ]; then
                RESULTS+=("JACCARD|$fid|$module|$SCORE")
            fi
        done
    done

    if [ ${#RESULTS[@]} -gt 0 ]; then
        for result in "${RESULTS[@]}"; do
            echo "$result"
        done | sort -t'|' -k4 -rn
        exit 0
    fi
fi

# ========================================
# ⭐ Level 3b: Summary 关键词重叠（宽松兜底）
# ========================================

if [ -n "$SUMMARY" ]; then
    SUMMARY_KEYWORDS=$(extract_keywords "$SUMMARY" | head -10)  # 只取前 10 个关键词
    SUMMARY_KEYWORD_COUNT=$(echo "$SUMMARY_KEYWORDS" | wc -l)

    for module in $MODULES; do
        ROUTER_FILE="$CONTEXT_DIR/router/$module.json"

        if [ ! -f "$ROUTER_FILE" ]; then
            continue
        fi

        FEATURE_IDS=$(jq -r '.features | keys[]' "$ROUTER_FILE" 2>/dev/null || echo "")

        for fid in $FEATURE_IDS; do
            FEATURE_SUMMARY=$(jq -r ".features.\"$fid\".summary" "$ROUTER_FILE")
            FEATURE_KEYWORDS=$(extract_keywords "$FEATURE_SUMMARY" | head -10)

            # 计算关键词重叠数
            OVERLAP_COUNT=0
            for keyword in $SUMMARY_KEYWORDS; do
                if echo "$FEATURE_KEYWORDS" | grep -q "$keyword"; then
                    OVERLAP_COUNT=$((OVERLAP_COUNT + 1))
                fi
            done

            # 计算相似度
            if [ $SUMMARY_KEYWORD_COUNT -gt 0 ]; then
                SIMILARITY=$((OVERLAP_COUNT * 100 / SUMMARY_KEYWORD_COUNT))

                # Summary 匹配阈值：相似度 >= 30%（较低，因为是辅助）
                if [ $SIMILARITY -ge 30 ]; then
                    RESULTS+=("SUMMARY|$fid|$module|$SIMILARITY")
                fi
            fi
        done
    done

    # 返回 Summary 匹配结果
    if [ ${#RESULTS[@]} -gt 0 ]; then
        for result in "${RESULTS[@]}"; do
            echo "$result"
        done | sort -t'|' -k4 -rn
        exit 0
    fi
fi

# 未找到任何匹配
exit 0
