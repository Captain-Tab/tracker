#!/usr/bin/env bash

# check-modal.sh - 验证响应式弹窗组件是否符合规范
# 使用方式: bash check-modal.sh <FilePath>
#
# 示例:
#   bash check-modal.sh src/pages/spot/main/modals/TransferModal.tsx
#   bash check-modal.sh src/components/modals/ConfirmModal.tsx

FILE_PATH="$1"

# 颜色输出
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# 参数验证
if [ -z "$FILE_PATH" ]; then
    echo -e "${RED}❌ 缺少参数: FilePath${NC}"
    echo ""
    echo "使用方式: bash check-modal.sh <FilePath>"
    echo "示例:     bash check-modal.sh src/pages/modals/TransferModal.tsx"
    exit 1
fi

if [ ! -f "$FILE_PATH" ]; then
    echo -e "${RED}❌ 文件不存在: $FILE_PATH${NC}"
    exit 1
fi

echo -e "${BLUE}🔍 检查弹窗组件: $FILE_PATH${NC}"
echo ""

PASS_COUNT=0
WARN_COUNT=0
FAIL_COUNT=0

check_item() {
    local label="$1"
    local pattern="$2"
    local level="$3"  # pass/warn/fail
    local tip="$4"

    if grep -qE "$pattern" "$FILE_PATH"; then
        echo -e "  ${GREEN}✅ $label${NC}"
        PASS_COUNT=$((PASS_COUNT + 1))
    else
        if [ "$level" = "fail" ]; then
            echo -e "  ${RED}❌ $label${NC}"
            [ -n "$tip" ] && echo -e "     ${YELLOW}提示: $tip${NC}"
            FAIL_COUNT=$((FAIL_COUNT + 1))
        else
            echo -e "  ${YELLOW}⚠️  $label${NC}"
            [ -n "$tip" ] && echo -e "     ${YELLOW}提示: $tip${NC}"
            WARN_COUNT=$((WARN_COUNT + 1))
        fi
    fi
}

echo "【必须项】"
check_item \
    "继承 InjectModalProps 类型" \
    "InjectModalProps" \
    "fail" \
    "添加: interface Props extends InjectModalProps { ... }"

check_item \
    "使用 observer 包装组件" \
    "observer\(" \
    "fail" \
    "添加: export default observer(YourModal)"

check_item \
    "调用 resolve?.() 关闭弹窗" \
    "resolve\?\.\(\)" \
    "fail" \
    "确认按钮需调用 resolve?.() 关闭弹窗并 resolve Promise"

echo ""
echo "【推荐项】"
check_item \
    "使用 useEffect 重置状态" \
    "useEffect" \
    "warn" \
    "建议添加 useEffect 监听关键 props 变化并重置状态，避免数据残留"

check_item \
    "处理 onClose 回调" \
    "onClose" \
    "warn" \
    "建议在取消/关闭时调用 onClose?.()"

check_item \
    "有 loading 状态（异步操作）" \
    "loading|isLoading|Loading" \
    "warn" \
    "如果有异步操作，建议添加 loading 状态"

echo ""
echo "【代码质量】"
check_item \
    "使用 TypeScript（有类型注解）" \
    ": React\.FC|: FC|interface Props|type Props" \
    "warn" \
    "建议为组件 Props 添加 TypeScript 类型"

check_item \
    "从 props 解构关键字段" \
    "const \{.*resolve|const \{.*onClose" \
    "warn" \
    "建议解构 resolve 和 onClose: const { resolve, onClose } = props"

# 输出统计
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "检查结果: ${GREEN}通过 $PASS_COUNT${NC} | ${YELLOW}警告 $WARN_COUNT${NC} | ${RED}失败 $FAIL_COUNT${NC}"
echo ""

if [ "$FAIL_COUNT" -gt 0 ]; then
    echo -e "${RED}❌ 存在 $FAIL_COUNT 个必须修复的问题${NC}"
    echo "   参考: .claude/skills/soso-responsive-modal-creation/SKILL.md"
    exit 1
elif [ "$WARN_COUNT" -gt 0 ]; then
    echo -e "${YELLOW}⚠️  存在 $WARN_COUNT 个建议优化的问题${NC}"
    echo "   参考: .claude/skills/soso-responsive-modal-creation/SKILL.md"
    exit 0
else
    echo -e "${GREEN}✅ 组件符合规范！${NC}"
    exit 0
fi
