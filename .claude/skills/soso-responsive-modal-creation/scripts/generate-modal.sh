#!/usr/bin/env bash

# generate-modal.sh - 生成响应式弹窗组件模板
# 使用方式: bash generate-modal.sh <ModalName> <OutputPath>
#
# 示例:
#   bash generate-modal.sh TransferModal src/pages/spot/main/modals/TransferModal.tsx
#   bash generate-modal.sh ConfirmModal src/components/modals/ConfirmModal.tsx

set -e

MODAL_NAME="$1"
OUTPUT_PATH="$2"

# 颜色输出
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# 参数验证
if [ -z "$MODAL_NAME" ]; then
    echo -e "${RED}❌ 缺少参数: ModalName${NC}"
    echo ""
    echo "使用方式: bash generate-modal.sh <ModalName> <OutputPath>"
    echo "示例:     bash generate-modal.sh TransferModal src/pages/modals/TransferModal.tsx"
    exit 1
fi

if [ -z "$OUTPUT_PATH" ]; then
    echo -e "${RED}❌ 缺少参数: OutputPath${NC}"
    echo ""
    echo "使用方式: bash generate-modal.sh <ModalName> <OutputPath>"
    echo "示例:     bash generate-modal.sh TransferModal src/pages/modals/TransferModal.tsx"
    exit 1
fi

# 检查输出文件是否已存在
if [ -f "$OUTPUT_PATH" ]; then
    echo -e "${YELLOW}⚠️  文件已存在: $OUTPUT_PATH${NC}"
    echo -n "是否覆盖？(y/N): "
    read -r CONFIRM
    if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
        echo "取消生成"
        exit 0
    fi
fi

# 创建输出目录
OUTPUT_DIR="$(dirname "$OUTPUT_PATH")"
mkdir -p "$OUTPUT_DIR"

# 生成组件内容
cat > "$OUTPUT_PATH" << TEMPLATE
import React, { useState, useEffect } from "react";
import { observer } from "mobx-react-lite";
import { type InjectModalProps } from "@/utils/modal/createModal";

interface Props extends InjectModalProps {
  // TODO: 添加外部传入的 props
  // initialValue?: string;
  // onSuccess?: () => void;
}

const ${MODAL_NAME}: React.FC<Props> = (props) => {
  const { resolve, onClose } = props;

  // ⚠️ 关键：状态初始化
  // const [value, setValue] = useState(props.initialValue || "");

  // ⚠️ 关键：弹窗打开时重置状态（避免数据残留）
  // useEffect(() => {
  //   setValue(props.initialValue || "");
  // }, [props.initialValue]);

  const handleConfirm = async () => {
    // TODO: 业务逻辑
    // props.onSuccess?.();
    resolve?.(); // 关闭弹窗并 resolve Promise
  };

  const handleClose = () => {
    // TODO: 清理状态（如果需要）
    onClose?.();
  };

  return (
    <div>
      {/* TODO: 弹窗内容 */}

      <button onClick={handleClose}>取消</button>
      <button onClick={handleConfirm}>确认</button>
    </div>
  );
};

export default observer(${MODAL_NAME});
TEMPLATE

echo -e "${GREEN}✅ 组件生成成功: $OUTPUT_PATH${NC}"
echo ""
echo -e "${BLUE}📋 后续步骤:${NC}"
echo ""
echo "1. 在 modals/index.tsx 导出弹窗实例:"
echo ""
echo "   import { createResponsiveModal } from \"@/utils/modal/createResponsiveModal\";"
echo "   import ${MODAL_NAME} from \"./${MODAL_NAME}\";"
echo "   import i18n from \"@/i18n\";"
echo ""
echo "   export const $(echo "${MODAL_NAME}" | sed 's/\(.\)/\L\1/' | sed 's/Modal$/Modal/') = createResponsiveModal({"
echo "     Component: ${MODAL_NAME},"
echo "     options: {"
echo "       title: () => i18n.t(\"namespace:modal_title\"),"
echo "       classes: { root: \"w-[420px]\" },"
echo "     },"
echo "   });"
echo ""
echo "2. 使用弹窗:"
echo "   modalInstance.open({ ...props });"
echo ""
echo -e "${BLUE}🔍 验证组件:${NC}"
echo "   bash \$(dirname \$0)/check-modal.sh $OUTPUT_PATH"
