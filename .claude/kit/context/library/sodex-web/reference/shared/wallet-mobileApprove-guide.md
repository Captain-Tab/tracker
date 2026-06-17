# 钱包签名交互统一规范

## 架构概览

统一项目内所有钱包签名相关交互，根据钱包类型（injected 插件钱包 / walletConnect 扫码钱包）自动切换文案和交互方式。

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          钱包签名交互架构                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────────────┐      ┌──────────────────────┐                     │
│  │  useWalletApproveText │◀────│   user.connectorType  │                     │
│  │  (文案统一源)          │      │  "injected" | "walletConnect" │             │
│  └──────────┬───────────┘      └──────────────────────┘                     │
│             │                                                               │
│             │ 返回 4 种文案                                                  │
│             ▼                                                               │
│  ┌──────────────────────────────────────────────────────────────┐          │
│  │  wallet    → 通用审批（Enable Trading 按钮 loading）          │          │
│  │  signature → 签名语义（两步弹窗副标题）                        │          │
│  │  spending  → 授权 spending cap（ERC-20 approve）              │          │
│  │  confirm   → 二次确认操作                                     │          │
│  └──────────────────────────────────────────────────────────────┘          │
│             │                                                               │
│             ▼                                                               │
│  ┌──────────────────────────────────────────────────────────────┐          │
│  │                    三种交互场景                               │          │
│  ├──────────────────────────────────────────────────────────────┤          │
│  │  1. 一步签名        → 按钮 loading 时显示 wallet 文案         │          │
│  │  2. 两步+签名       → 副标题显示 signature 文案               │          │
│  │  3. 小按钮/移动端   → 弹出 WalletConnectSigningHint 弹窗      │          │
│  └──────────────────────────────────────────────────────────────┘          │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## 核心逻辑

### useWalletApproveText Hook

根据 `connectorType` 返回适配的签名提示文案。

```typescript
// src/hooks/useWalletApproveText.tsx  L12-66
const useWalletApproveText = () => {
  const { user } = useStore();

  const textMap: Record<Common.ConnectorType, {
    wallet: React.ReactNode;      // 通用审批
    spending: React.ReactNode;    // 授权 spending cap
    confirm: React.ReactNode;     // 二次确认
    signature: React.ReactNode;   // 签名语义（副标题用）
  }> = {
    injected: {
      wallet: t("manual:approve_in_wallet"),           // "Please approve in wallet"
      spending: t("manual:approve_spending_cap_in_wallet"),
      confirm: t("manual:confirm_in_wallet"),
      signature: t("manual:approve_in_wallet"),
    },
    walletConnect: {
      wallet: <HStack><Text>{t("spot:approve_on_mobile")}</Text><MobileIcon /></HStack>,
      spending: <HStack><Text>{t("spot:approve_spending_cap_on_mobile")}</Text><MobileIcon /></HStack>,
      confirm: <HStack><Text>{t("spot:confirm_on_mobile")}</Text><MobileIcon /></HStack>,
      signature: <HStack><span className="text-[12px] text-[#A3A3A3]">{t("spot:approve_on_mobile")}</span><MobileIcon /></HStack>
    },
  };

  return textMap[user.connectorType] || textMap.injected;
};
```

### useEnableTrading Hook

统一的 Enable Trading 流程，支持签名弹窗开关和回调处理。

```typescript
// src/hooks/useEnableTrading.ts  L17-34
interface UseEnableTradingOptions {
  skipBalanceCheck?: boolean;
  skipGuide?: boolean;
  skipDepositCheck?: boolean;
  onSignSuccess?: () => void | Promise<void>;
  onSignFailed?: (reason: "cancel" | "failed" | "error") => void;
  onEnableTradingSuccess?: () => void;
  showWalletConnectSigningModal?: boolean;  // 小按钮签名弹窗开关
  onFinish?: () => void;
}
```

关键流程（L98-196）：

```
enableTrading()
    │
    ├─► 检查 showWalletConnectSigningModal && connectorType === "walletConnect"
    │       └─► 是：walletConnectSigningHintModal.open()
    │
    ├─► 执行签名 signMessage() / signMessageMobile()
    │
    ├─► 签名结果判断
    │       ├─► "success" → onSignSuccess() → showStaySignedInModal()
    │       ├─► "cancel"  → onSignFailed("cancel") 静默关闭
    │       └─► "failed"  → notify.error() → onSignFailed("failed")
    │
    └─► 关闭签名提示弹窗
```

### WalletConnectSigningHint 组件

小尺寸按钮签名时的提示弹窗。

```typescript
// src/components_tw/modals/spot/WalletConnectSigningHint.tsx  L7-39
const WalletConnectSigningHint: React.FC = () => {
  const approveText = useWalletApproveText();
  return (
    <div className="flex flex-col">
      <h2>{t("common:enable_trading_to_continue")}</h2>
      <div className="flex items-center gap-3">
        <CircleProcessing spinning={true}>
          <Wallet icon />
        </CircleProcessing>
        <div>{approveText.wallet}</div>
      </div>
    </div>
  );
};
```

## 关键实现

### 1. 一步签名按钮 loading 文案

```typescript
// 示例：VaultPreTradeButton.tsx  L148-155
<ContainedButton loading={isEnableTradingLoading} onAsyncClick={preTradeFn}>
  {isEnableTradingLoading ? walletApproveText.wallet : ENABLE_TRADING_TEXT}
</ContainedButton>

// 示例：CreateReferralCodeModal.tsx  L265-268
{isSaving ? (
  <span className="whitespace-nowrap">{walletApproveText.wallet}</span>
) : (
  <span>{t("common:confirm")}</span>
)}
```

### 2. 两步签名副标题提示

```typescript
// 示例：DepositProcessIndicator.tsx  L93-100
<ProcessBar
  isActive={status === "approving"}
  subtitle={status === "approving" ? walletApproveText.signature : undefined}
>
  {approveTextMap[status]}
</ProcessBar>

// 示例：TermsUse.tsx  L144-146
<span className="truncate">
  {loading ? approveText.signature : t("spot:accept")}
</span>
```

### 3. 小按钮签名弹窗

```typescript
// 示例：MainnetPreTradeButton.tsx  L66-71
const { enableTrading: doEnableTrading } = useEnableTrading({
  showWalletConnectSigningModal,  // 通过 props 传入
  onEnableTradingSuccess: () => {
    onEnableTradingSuccessRef.current?.();
  },
});

// 调用方：btnNav/index.tsx  L50-72
<PreTradeButton showWalletConnectSigningModal>
  {({ exsitsPreTradeFn }) => (
    <PrimaryButton onClick={async () => {
      const result = await exsitsPreTradeFn?.();
      if (result) transferModal.open();
    }}>
      {t("common:transfer")}
    </PrimaryButton>
  )}
</PreTradeButton>
```

## 文件结构

```
src/
├── hooks/
│   ├── useWalletApproveText.tsx      # 文案统一源 Hook
│   └── useEnableTrading.ts           # Enable Trading 流程 Hook
│
├── components_tw/
│   └── modals/
│       └── spot/
│           ├── WalletConnectSigningHint.tsx  # 签名提示弹窗
│           ├── TermsUse.tsx                  # 条款确认弹窗
│           └── index.tsx                     # 弹窗导出
│
├── pages/
│   ├── _components/
│   │   ├── common/
│   │   │   └── DepositProcessIndicator.tsx   # 两步流程指示器
│   │   └── withdraw/
│   │       └── WithdrawModal.tsx             # 提现弹窗
│   │
│   ├── account/assets/components/
│   │   └── btnNav/index.tsx                  # 资产页操作按钮
│   │
│   ├── referrals/components/
│   │   ├── CreateReferralCodeModal.tsx       # 邀请码创建弹窗
│   │   └── InviteToSoDEXModal.tsx            # 邀请弹窗
│   │
│   ├── spot/main/components/preTradeButton/
│   │   └── MainnetPreTradeButton.tsx         # 主站交易按钮
│   │
│   └── vault/components/modals/funding/deposit/
│       └── VaultPreTradeButton.tsx           # Vault 存款按钮
│
└── models/
    └── user.ts                               # connectorType 来源
```

## 关键设计决策

### 为什么根据 connectorType 区分文案？

| 钱包类型 | 用户场景 | 文案需求 |
|----------|----------|----------|
| injected | 浏览器插件（MetaMask 等） | "Please approve in wallet" |
| walletConnect | 手机扫码连接 | "Please approve on mobile" + 手机图标 |

WalletConnect 用户在 PC 端触发签名后，需要在手机上操作，必须明确提示用户切换设备。

### 为什么小按钮使用弹窗而非按钮文案？

1. **空间限制**：Swap/Transfer 等按钮宽度不足，无法稳定展示长文案
2. **移动端兼容**：移动端按钮点击后页面跳转到钱包 App，loading 状态可能不可见
3. **用户体验**：弹窗更醒目，用户不会错过操作提示

### 签名失败的三种状态为什么要区分？

| reason | 含义 | 处理方式 |
|--------|------|----------|
| `cancel` | 用户主动拒绝签名 | 静默关闭，**不显示** error toast |
| `failed` | 签名返回失败结果 | 显示 error toast，关闭弹窗 |
| `error` | 异常（网络/代码错误） | 显示 error toast，关闭弹窗 |

用户主动取消是正常操作，不应该受到错误提示。

## 开发修改指南

### 新增签名按钮时

```typescript
// 1. 引入 Hook
import useWalletApproveText from "@/hooks/useWalletApproveText";
import { useEnableTrading } from "@/hooks/useEnableTrading";

// 2. 获取文案
const walletApproveText = useWalletApproveText();

// 3. 根据场景选择
const { enableTrading, loading } = useEnableTrading({
  showWalletConnectSigningModal: true, // 小按钮开启
});

// 4. 按钮 loading 时显示文案
<Button loading={loading}>
  {loading ? walletApproveText.wallet : "Enable Trading"}
</Button>
```

### 新增两步签名流程时

```typescript
// 副标题使用 signature key
<StepTitle>
  {t("step:title")}
  {isSigning && <span className="text-[12px] text-[#A3A3A3]">{walletApproveText.signature}</span>}
</StepTitle>
```

### 代码审查检查清单

- [ ] 一步签名按钮点击后是否出现钱包审批文案
- [ ] 文案是否来自 `useWalletApproveText`（而非硬编码）
- [ ] 是否使用了正确的 key（wallet / signature / spending / confirm）
- [ ] 两步流程的签名提醒是否放在副标题
- [ ] 小按钮或移动端场景是否启用 `showWalletConnectSigningModal`
- [ ] `onSignFailed` 是否按 reason 区分 cancel 与 failed/error
- [ ] 签名取消/失败后是否正确关闭提示弹窗
- [ ] 新增文案是否完成 i18n 同步（所有语言）

## 术语表

| 术语 | 含义 |
|------|------|
| connectorType | 钱包连接类型：`injected`（插件）或 `walletConnect`（扫码） |
| Enable Trading | 启用交易功能，需要用户签名确认 |
| WalletConnect | 通过二维码扫描连接手机钱包的协议 |
| injected | 注入式钱包（如 MetaMask 浏览器插件） |

## 更新记录

### 2026-03-25: 初始版本

初始文档，通过 /k/context learn 从代码自动生成。涵盖：
- useWalletApproveText Hook（4 种文案 key）
- useEnableTrading Hook（showWalletConnectSigningModal 开关）
- WalletConnectSigningHint 弹窗组件
- 一步签名/两步签名/小按钮签名三种交互模式
