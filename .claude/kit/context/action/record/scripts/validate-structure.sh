#!/bin/bash

# 验证 context JSON 结构符合 v2.2 规范

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/record-helpers.sh"

# 参数解析
CONTEXT_INDEX_FILE=""
ROUTER_FILE=""
INTEGRITY_DIR=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --index)
            CONTEXT_INDEX_FILE="$2"
            shift 2
            ;;
        --router)
            ROUTER_FILE="$2"
            shift 2
            ;;
        --integrity)
            INTEGRITY_DIR="$2"
            shift 2
            ;;
        *)
            echo "未知参数: $1"
            exit 1
            ;;
    esac
done

# 独立一致性校验模式
if [ -n "$INTEGRITY_DIR" ]; then
    if validate_integrity "$INTEGRITY_DIR"; then
        exit 0
    else
        exit 1
    fi
fi

ERRORS=0

# 验证 context-index.json
if [ -n "$CONTEXT_INDEX_FILE" ] && [ -f "$CONTEXT_INDEX_FILE" ]; then
    echo "🔍 验证 context-index.json"

    # 检查 meta 字段
    if ! jq -e '.meta.version' "$CONTEXT_INDEX_FILE" >/dev/null 2>&1; then
        echo "❌ 缺少 meta.version"
        ERRORS=$((ERRORS + 1))
    fi

    if ! jq -e '.meta.project' "$CONTEXT_INDEX_FILE" >/dev/null 2>&1; then
        echo "❌ 缺少 meta.project"
        ERRORS=$((ERRORS + 1))
    fi

    # 检查 modules 数组
    if ! jq -e '.modules | type == "array"' "$CONTEXT_INDEX_FILE" >/dev/null 2>&1; then
        echo "❌ modules 不是数组"
        ERRORS=$((ERRORS + 1))
    fi

    # 检查每个模块的必需字段
    MODULE_COUNT=$(jq '.modules | length' "$CONTEXT_INDEX_FILE")
    for i in $(seq 0 $(($MODULE_COUNT - 1))); do
        MODULE_ID=$(jq -r ".modules[$i].id" "$CONTEXT_INDEX_FILE")

        if ! jq -e ".modules[$i].configPath" "$CONTEXT_INDEX_FILE" >/dev/null 2>&1; then
            echo "❌ 模块 $MODULE_ID 缺少 configPath"
            ERRORS=$((ERRORS + 1))
        fi

        if ! jq -e ".modules[$i].features | type == \"array\"" "$CONTEXT_INDEX_FILE" >/dev/null 2>&1; then
            echo "❌ 模块 $MODULE_ID 的 features 不是数组"
            ERRORS=$((ERRORS + 1))
        fi
    done

    # 检查 recentQueue
    if ! jq -e '.recentQueue | type == "array"' "$CONTEXT_INDEX_FILE" >/dev/null 2>&1; then
        echo "❌ recentQueue 不是数组"
        ERRORS=$((ERRORS + 1))
    fi
fi

# 验证 router/*.json
if [ -n "$ROUTER_FILE" ] && [ -f "$ROUTER_FILE" ]; then
    echo "🔍 验证 router 配置"

    # 检查必需字段
    if ! jq -e '.module' "$ROUTER_FILE" >/dev/null 2>&1; then
        echo "❌ 缺少 module 字段"
        ERRORS=$((ERRORS + 1))
    fi

    if ! jq -e '.features | type == "object"' "$ROUTER_FILE" >/dev/null 2>&1; then
        echo "❌ features 不是对象"
        ERRORS=$((ERRORS + 1))
    fi

    if ! jq -e '.history | type == "object"' "$ROUTER_FILE" >/dev/null 2>&1; then
        echo "❌ history 不是对象"
        ERRORS=$((ERRORS + 1))
    fi

    # 检查每个 feature 的结构
    FEATURE_IDS=$(jq -r '.features | keys[]' "$ROUTER_FILE" 2>/dev/null || echo "")
    for FEATURE_ID in $FEATURE_IDS; do
        # 检查必需字段
        for FIELD in "id" "title" "summary" "quickRef" "tags"; do
            if ! jq -e ".features.\"$FEATURE_ID\".$FIELD" "$ROUTER_FILE" >/dev/null 2>&1; then
                echo "❌ 功能 $FEATURE_ID 缺少 $FIELD"
                ERRORS=$((ERRORS + 1))
            fi
        done

        # 检查 quickRef 结构（必填）
        for SUBFIELD in "coreLogic" "keyComponents" "keyFiles" "relatedConcepts"; do
            if ! jq -e ".features.\"$FEATURE_ID\".quickRef.$SUBFIELD | type == \"array\"" "$ROUTER_FILE" >/dev/null 2>&1; then
                echo "⚠️  功能 $FEATURE_ID 的 quickRef.$SUBFIELD 不是数组"
            fi
        done

        # 可选扩展字段：仅做类型检查，不存在不报错（兼容旧 feature 不强制回填）
        for OPT_FIELD in "callers" "relatedFeatures" "pitfalls"; do
            if jq -e ".features.\"$FEATURE_ID\".quickRef.$OPT_FIELD" "$ROUTER_FILE" >/dev/null 2>&1; then
                if ! jq -e ".features.\"$FEATURE_ID\".quickRef.$OPT_FIELD | type == \"array\"" "$ROUTER_FILE" >/dev/null 2>&1; then
                    echo "⚠️  功能 $FEATURE_ID 的 quickRef.$OPT_FIELD 不是数组"
                fi
            fi
        done
        if jq -e ".features.\"$FEATURE_ID\".quickRef.sideEffects" "$ROUTER_FILE" >/dev/null 2>&1; then
            if ! jq -e ".features.\"$FEATURE_ID\".quickRef.sideEffects | type == \"object\"" "$ROUTER_FILE" >/dev/null 2>&1; then
                echo "⚠️  功能 $FEATURE_ID 的 quickRef.sideEffects 不是对象"
            fi
        fi
    done
fi

# 输出结果
if [ $ERRORS -eq 0 ]; then
    echo "✅ 验证通过"
    exit 0
else
    echo "❌ 发现 $ERRORS 个错误"
    exit 1
fi
