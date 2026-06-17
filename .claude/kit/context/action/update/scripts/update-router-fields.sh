#!/bin/bash
# update-router-fields.sh - 用 jq 原子更新 router JSON 中的 feature 字段
#
# 用法:
#   bash update-router-fields.sh \
#     --router-file <path> \
#     --feature-id  <id> \
#     [--updated    <YYYY-MM-DD>]           # 默认今天
#     [--summary    <text>]                 # 顶层摘要
#     [--sections-file <json-file-path>]    # sections 数组（写入临时文件传入，避免转义问题）
#     [--tags       <tag1,tag2,...>]        # 逗号分隔的标签列表
#     [--core-logic <item1|item2|...>]      # quickRef.coreLogic，竖线分隔
#     [--key-components <item1|item2|...>]  # quickRef.keyComponents，竖线分隔
#     [--related-concepts <c1,c2,...>]      # quickRef.relatedConcepts，逗号分隔
#     [--callers <item1|item2|...>]         # quickRef.callers，竖线分隔
#     [--related-features <id1,id2,...>]    # quickRef.relatedFeatures，逗号分隔（feature id 列表）
#     [--pitfalls <id1,id2,...>]            # quickRef.pitfalls，逗号分隔（pitfall id 列表）
#     [--side-effects-file <json-file>]     # quickRef.sideEffects 对象，{emits, invalidates, writes}
#     [--last-verified <YYYY-MM-DD>]        # 顶层 lastVerified；不传则 sourceCommit/内容变更时不动

set -e

ROUTER_FILE=""
FEATURE_ID=""
UPDATED=""
SUMMARY=""
SECTIONS_FILE=""
TAGS=""
CORE_LOGIC=""
KEY_COMPONENTS=""
RELATED_CONCEPTS=""
CALLERS=""
RELATED_FEATURES=""
PITFALLS=""
SIDE_EFFECTS_FILE=""
LAST_VERIFIED=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --router-file)       ROUTER_FILE="$2";       shift 2 ;;
        --feature-id)        FEATURE_ID="$2";        shift 2 ;;
        --updated)           UPDATED="$2";           shift 2 ;;
        --summary)           SUMMARY="$2";           shift 2 ;;
        --sections-file)     SECTIONS_FILE="$2";     shift 2 ;;
        --tags)              TAGS="$2";              shift 2 ;;
        --core-logic)        CORE_LOGIC="$2";        shift 2 ;;
        --key-components)    KEY_COMPONENTS="$2";    shift 2 ;;
        --related-concepts)  RELATED_CONCEPTS="$2";  shift 2 ;;
        --callers)           CALLERS="$2";           shift 2 ;;
        --related-features)  RELATED_FEATURES="$2";  shift 2 ;;
        --pitfalls)          PITFALLS="$2";          shift 2 ;;
        --side-effects-file) SIDE_EFFECTS_FILE="$2"; shift 2 ;;
        --last-verified)     LAST_VERIFIED="$2";     shift 2 ;;
        *) echo "未知参数: $1"; exit 1 ;;
    esac
done

# ── 参数校验 ─────────────────────────────────────────────────
if [ -z "$ROUTER_FILE" ] || [ ! -f "$ROUTER_FILE" ]; then
    echo "❌ router 文件不存在: $ROUTER_FILE"
    exit 1
fi
if [ -z "$FEATURE_ID" ]; then
    echo "❌ 缺少 --feature-id 参数"
    exit 1
fi
if [ -z "$UPDATED" ]; then
    UPDATED=$(date +%Y-%m-%d)
fi
if ! jq -e ".features[\"$FEATURE_ID\"]" "$ROUTER_FILE" > /dev/null 2>&1; then
    echo "❌ 未找到 feature: $FEATURE_ID (文件: $ROUTER_FILE)"
    exit 1
fi
if [ -n "$SECTIONS_FILE" ] && [ ! -f "$SECTIONS_FILE" ]; then
    echo "❌ sections 文件不存在: $SECTIONS_FILE"
    exit 1
fi
if [ -n "$SIDE_EFFECTS_FILE" ] && [ ! -f "$SIDE_EFFECTS_FILE" ]; then
    echo "❌ side-effects 文件不存在: $SIDE_EFFECTS_FILE"
    exit 1
fi

# ── 构建 jq 更新表达式（只更新传入的字段）────────────────────
FID="$FEATURE_ID"
BASE=".features[\"$FID\"]"
JQ_FILTER="$BASE.updated = \$updated"

[ -n "$SUMMARY" ]           && JQ_FILTER="$JQ_FILTER | $BASE.summary = \$summary"
[ -n "$SECTIONS_FILE" ]     && JQ_FILTER="$JQ_FILTER | $BASE.sections = \$sections"
[ -n "$TAGS" ]              && JQ_FILTER="$JQ_FILTER | $BASE.tags = \$tags"
[ -n "$CORE_LOGIC" ]        && JQ_FILTER="$JQ_FILTER | $BASE.quickRef.coreLogic = \$coreLogic"
[ -n "$KEY_COMPONENTS" ]    && JQ_FILTER="$JQ_FILTER | $BASE.quickRef.keyComponents = \$keyComponents"
[ -n "$RELATED_CONCEPTS" ]  && JQ_FILTER="$JQ_FILTER | $BASE.quickRef.relatedConcepts = \$relatedConcepts"
[ -n "$CALLERS" ]           && JQ_FILTER="$JQ_FILTER | $BASE.quickRef.callers = \$callers"
[ -n "$RELATED_FEATURES" ]  && JQ_FILTER="$JQ_FILTER | $BASE.quickRef.relatedFeatures = \$relatedFeatures"
[ -n "$PITFALLS" ]          && JQ_FILTER="$JQ_FILTER | $BASE.quickRef.pitfalls = \$pitfalls"
[ -n "$SIDE_EFFECTS_FILE" ] && JQ_FILTER="$JQ_FILTER | $BASE.quickRef.sideEffects = \$sideEffects"
[ -n "$LAST_VERIFIED" ]     && JQ_FILTER="$JQ_FILTER | $BASE.lastVerified = \$lastVerified"

# ── 转换分隔符格式为 JSON 数组 ───────────────────────────────
to_json_array_comma() { echo "$1" | tr ',' '\n' | sed 's/^ *//;s/ *$//' | jq -R . | jq -s .; }
to_json_array_pipe()  { echo "$1" | tr '|'  '\n' | sed 's/^ *//;s/ *$//' | jq -R . | jq -s .; }

TAGS_JSON="[]";             [ -n "$TAGS" ]             && TAGS_JSON=$(to_json_array_comma "$TAGS")
CORE_LOGIC_JSON="[]";       [ -n "$CORE_LOGIC" ]       && CORE_LOGIC_JSON=$(to_json_array_pipe "$CORE_LOGIC")
KEY_COMPONENTS_JSON="[]";   [ -n "$KEY_COMPONENTS" ]   && KEY_COMPONENTS_JSON=$(to_json_array_pipe "$KEY_COMPONENTS")
RELATED_JSON="[]";          [ -n "$RELATED_CONCEPTS" ] && RELATED_JSON=$(to_json_array_comma "$RELATED_CONCEPTS")
SECTIONS_JSON="[]";         [ -n "$SECTIONS_FILE" ]    && SECTIONS_JSON=$(cat "$SECTIONS_FILE")
CALLERS_JSON="[]";          [ -n "$CALLERS" ]          && CALLERS_JSON=$(to_json_array_pipe "$CALLERS")
RELATED_FEATURES_JSON="[]"; [ -n "$RELATED_FEATURES" ] && RELATED_FEATURES_JSON=$(to_json_array_comma "$RELATED_FEATURES")
PITFALLS_JSON="[]";         [ -n "$PITFALLS" ]         && PITFALLS_JSON=$(to_json_array_comma "$PITFALLS")
SIDE_EFFECTS_JSON='{"emits":[],"invalidates":[],"writes":[]}'
[ -n "$SIDE_EFFECTS_FILE" ] && SIDE_EFFECTS_JSON=$(cat "$SIDE_EFFECTS_FILE")

# ── 执行更新 ─────────────────────────────────────────────────
TMP_FILE=$(mktemp)
jq \
    --arg     updated          "$UPDATED" \
    --arg     summary          "$SUMMARY" \
    --argjson sections         "$SECTIONS_JSON" \
    --argjson tags             "$TAGS_JSON" \
    --argjson coreLogic        "$CORE_LOGIC_JSON" \
    --argjson keyComponents    "$KEY_COMPONENTS_JSON" \
    --argjson relatedConcepts  "$RELATED_JSON" \
    --argjson callers          "$CALLERS_JSON" \
    --argjson relatedFeatures  "$RELATED_FEATURES_JSON" \
    --argjson pitfalls         "$PITFALLS_JSON" \
    --argjson sideEffects      "$SIDE_EFFECTS_JSON" \
    --arg     lastVerified     "$LAST_VERIFIED" \
    "$JQ_FILTER" \
    "$ROUTER_FILE" > "$TMP_FILE"

mv "$TMP_FILE" "$ROUTER_FILE"

# ── 输出更新摘要 ──────────────────────────────────────────────
echo "✅ router 字段已更新: $FEATURE_ID"
echo "   updated=$([ -n "$UPDATED" ] && echo "$UPDATED")"
[ -n "$SUMMARY" ]           && echo "   summary 已更新"
[ -n "$SECTIONS_FILE" ]     && echo "   sections 已更新 ($(jq 'length' "$SECTIONS_FILE") 个章节)"
[ -n "$TAGS" ]              && echo "   tags=$(echo "$TAGS_JSON" | jq -r 'join(", ")')"
[ -n "$CORE_LOGIC" ]        && echo "   quickRef.coreLogic 已更新"
[ -n "$KEY_COMPONENTS" ]    && echo "   quickRef.keyComponents 已更新"
[ -n "$RELATED_CONCEPTS" ]  && echo "   quickRef.relatedConcepts 已更新"
[ -n "$CALLERS" ]           && echo "   quickRef.callers 已更新"
[ -n "$RELATED_FEATURES" ]  && echo "   quickRef.relatedFeatures 已更新"
[ -n "$PITFALLS" ]          && echo "   quickRef.pitfalls 已更新"
[ -n "$SIDE_EFFECTS_FILE" ] && echo "   quickRef.sideEffects 已更新"
[ -n "$LAST_VERIFIED" ]     && echo "   lastVerified=$LAST_VERIFIED"
