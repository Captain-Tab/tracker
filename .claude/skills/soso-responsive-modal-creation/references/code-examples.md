# 项目代码示例参考

## 简单弹窗示例

来源：`src/pages/spot/main/position/tab/transferHistory/modals/`

### 弹窗定义（index.tsx）

```tsx
import Refund from "./Refund";
import Failed from "./Failed";
import { createResponsiveModal } from "@/utils/modal/createResponsiveModal";
import i18n from "@/i18n";

export const refundModal = createResponsiveModal({
  Component: Refund,
  options: {
    title: () => i18n.t("spot:refund_address"),
    desc: () => i18n.t("spot:we_will_return_the_tokens_to"),
    classes: {
      root: "w-[420px]",
    },
  },
});

export const failedModal = createResponsiveModal({
  Component: Failed,
  options: {
    classes: {
      root: "w-[400px]",
    },
  },
});
```

### 弹窗组件（Refund.tsx）

```tsx
import React, { useState } from "react";
import { MergedTransferRecord } from "@/models/spotOrder";
import VStack from "@/components_tw/VStack";
import CheckBox from "@/components_tw/CheckBox";
import StyledOutlinedInput from "@/components_tw/StyledOutlinedInput";
import ContainedButton from "@/components_tw/ContainedButton";
import { useAutoAnimate } from "@formkit/auto-animate/react";
import { custodyRefund } from "@/http/deposit";
import { observer } from "mobx-react-lite";
import { useOptimizedStore } from "@/models";
import { notify } from "@/utils/notify";
import { Collapse } from "@mui/material";
import { type InjectModalProps } from "@/utils/modal/createModal";
import { toDefaultNumber } from "@/utils/utils";
import { useTranslation } from "react-i18next";

interface Props extends InjectModalProps {
  record: MergedTransferRecord;
  onSuccess: () => void;
}

const Refund: React.FC<Props> = (props) => {
  const { t } = useTranslation(["spot", "common"]);
  const { record, resolve, onSuccess } = props;
  
  // 状态：使用空字符串和 false 作为默认值
  const [address, setAddress] = useState("");
  const [useSameAddress, setUseSameAddress] = useState(false);
  const [formRef] = useAutoAnimate();
  const { user } = useOptimizedStore(["user"]);
  
  const handleCustodyRefund = async () => {
    if (!user.address) return;
    const to = useSameAddress ? record.sender : address;
    const result = await custodyRefund({
      account: user.address!,
      chain: record.network,
      token: record.token,
      txHash: record.txHash!,
      to,
    });
    if (toDefaultNumber(result.code) === 0) {
      notify.success(t("spot:refund_application_has_been_submitted_funds"), {
        autoClose: 5000,
      });
      onSuccess();
      resolve?.();  // 关闭弹窗
    }
  };
  
  const updateUseSameAddress = (checked: boolean) => {
    setUseSameAddress(checked);
    if (checked) {
      setAddress("");  // 选择相同地址时清空输入
    }
  };
  
  return (
    <VStack gap={5}>
      <VStack gap={2} ref={formRef}>
        <CheckBox
          checked={useSameAddress}
          onChange={(e) => updateUseSameAddress(e.target.checked)}
          label={t("spot:same_address_as_deposit")}
        />
        <Collapse in={!useSameAddress}>
          <StyledOutlinedInput
            classes={{
              root: "bg-background-background-primary-white-900",
            }}
            value={address}
            placeholder={t("common:address")}
            onChange={(e) => setAddress(e.target.value)}
          />
        </Collapse>
      </VStack>
      <ContainedButton
        disabled={!useSameAddress && !address}
        onAsyncClick={handleCustodyRefund}
      >
        {t("common:confirm")}
      </ContainedButton>
    </VStack>
  );
};

export default observer(Refund);
```

## 复杂弹窗示例（带状态重置）

来源：`src/components_tw/modals/stakeSoso/StakeSoso.tsx`

### 关键状态管理代码片段

```tsx
const StakeSoso: React.FC<InjectModalProps> = () => {
  const modal = useModal();
  
  // 多个状态
  const [amount, setAmount] = useState("0");
  const [showReview, setShowReview] = useState(false);
  const [processStatus, setProcessStatus] = useState<ProcessStatus>("approving");
  const [hasAutoFilled, setHasAutoFilled] = useState(false);
  
  // ⚠️ 关键：弹窗打开时重置状态
  useEffect(() => {
    if (address && user.id) {
      balances.refetchBoostTotalUSDTAmount();
      spotAsset.fetchBalanceList();
      // 重置自动填入标志
      setHasAutoFilled(false);
    }
  }, [address, user.id]);
  
  // 根据数据自动填入金额（仅在特定条件下）
  useEffect(() => {
    // 防止重复自动填入
    if (hasAutoFilled || (amount && amount !== "0" && amount !== ".")) {
      return;
    }
    // ... 自动填入逻辑
    if (Number.isFinite(sosoAmount) && sosoAmount > 0) {
      setAmount(formattedAmount.toFixed(4));
      setHasAutoFilled(true);  // 标记已自动填入
    }
  }, [/* dependencies */]);
  
  // 处理失败：重置状态并关闭弹窗
  const handleStakeFailure = (error: any) => {
    setProcessStatus("failed");
    notify.error(error?.message || "Stake failed");
    modal.hide();
    // 打开失败弹窗
    setTimeout(() => {
      import("./index").then((module) => {
        module.createStakeFailedModal.open();
      });
    }, 100);
  };
  
  // 根据状态渲染不同视图
  if (showReview) {
    return <StakeReview status={processStatus} />;
  }
  
  return (
    <div>
      {/* 主界面 */}
    </div>
  );
};
```

## 移动端适配的高级配置

来源：`src/components_tw/modals/stakeSoso/index.tsx`

```tsx
import React from "react";
import { Slide, Grow, useMediaQuery } from "@mui/material";
import { createModal, type CreateModalProps } from "@/utils/modal/createModal";

// 移动端从底部弹出的过渡动画
const SlideUpTransition = React.forwardRef(function Transition(
  props: any,
  ref,
) {
  return <Slide direction="up" ref={ref} {...props} />;
});

// 条件 Transition：仅在移动端使用 SlideUpTransition，PC 端使用 Grow
const ConditionalTransition = React.forwardRef(function Transition(
  props: any,
  ref,
) {
  const isMobile = useMediaQuery("(max-width: 767px)");
  if (isMobile) {
    return <SlideUpTransition ref={ref} {...props} />;
  }
  return <Grow ref={ref} {...props} />;
});

// 通用移动端样式配置
const commonMobileStyles = {
  paper: "mobile:!w-full mobile:!max-w-full mobile:!m-0 mobile:!p-0",
  sx: {
    "& .MuiDialog-container": {
      alignItems: "flex-end",
      padding: 0,
      "@media (min-width: 768px)": {
        alignItems: "center",
        padding: "24px",
      },
    },
  },
  paperSx: {
    margin: 0,
    maxHeight: "90vh",
    "@media (max-width: 767px)": {
      width: "100% !important",
      borderRadius: "16px 16px 0 0",
    },
  },
};

// 通用移动端 root 样式
const commonMobileRootStyles =
  "mobile:w-full mobile:max-w-none mobile:rounded-t-2xl mobile:rounded-b-none mobile:px-4 mobile:pt-6 mobile:pb-6 mobile:max-h-[90vh] mobile:overflow-y-auto";

// 创建移动端弹窗配置的辅助函数
const createMobileModalConfig = <T extends React.FunctionComponent<any>>({
  Component,
  width,
  padding = "p-6",
  bgColor = "#171717",
}): CreateModalProps<T> => ({
  Component,
  options: {
    classes: {
      root: `${width} ${padding} bg-[${bgColor}] border border-solid border-[#262626] rounded-xl ${commonMobileRootStyles}`,
      paper: commonMobileStyles.paper,
    },
    transition: ConditionalTransition,
    sx: commonMobileStyles.sx,
    paper: { sx: commonMobileStyles.paperSx },
    onlyAllowCloseByManual: false,
  },
});

// 使用辅助函数创建弹窗
export const createStakeSosoModal = createModal(
  createMobileModalConfig({
    Component: StakeSoso,
    width: "w-[420px]",
  }),
);
```

## 使用弹窗

```tsx
// 基础使用
import { refundModal } from "./modals";

const handleRefund = () => {
  refundModal.open({
    record: currentRecord,
    onSuccess: () => {
      refreshList();
    },
  });
};

// 等待结果
const result = await myModal.open<boolean>({
  data: someData,
});
if (result) {
  // 用户确认了
}

// 手动关闭
myModal.close();
```
