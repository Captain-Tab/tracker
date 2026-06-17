# Trade Withdraw 提现功能

主站提现弹窗，支持 Spot/Funding 双账户、Regular/Flash 双模式提现，包含多链地址校验、XRP/XLM Memo、SOSO 原生转账、Enable Trading 等完整提现流程。

## 架构概览

```
┌─────────────────────────────────────────────────────────────────┐
│                      WithdrawModal.tsx                          │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │
│  │ CoinSelector│  │ChainSelector│  │ RegularFlashTab         │ │
│  │ 币种选择    │  │ 链选择      │  │ Regular/Flash 模式切换  │ │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘ │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │              AccountAmountSelector                          ││
│  │  ┌─────────────┐  ┌─────────────┐                          ││
│  │  │ Spot Account│  │Funding Acct │  账户切换 + 金额输入     ││
│  │  └─────────────┘  └─────────────┘                          ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  Destination Address + Memo (XRP/XLM)                       ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  Fee / You Receive 展示                                     ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  Withdraw Button (Enable Trading / Withdraw to Chain)       ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

## 核心状态

| 状态 | 类型 | 说明 |
|------|------|------|
| `selectedAccountType` | `"Spot" \| "Funding"` | 当前选中的账户类型 |
| `tabValue` | `"regular" \| "flash"` | 提现模式 |
| `withdrawStatus` | `"approving" \| "confirming" \| undefined` | 提现进度状态 |
| `fundsData` | `FundsSelectData` | 当前账户余额数据 |
| `noMemoForAddress` | `boolean` | XRP/XLM 是否跳过 Memo |

## 核心逻辑

### 1. 表单验证 (getWithdrawSchema)

动态 Zod schema，根据币种/链/账户状态生成校验规则：

```typescript
// src/pages/_components/withdraw/schema.ts
export const getWithdrawSchema = (options?: {
  max?: string;           // 当前账户最大可提现金额
  marketList: any[];      // 市场列表（用于币种校验）
  minWithdrawAmount?: string;  // 最小提现金额
  noMemoForAddress?: boolean;  // XRP/XLM Memo 是否可选
}) => z.object({
  coin: z.custom<CoinInfoData>(),
  amount: z.string().min(1),
  chain: z.custom<ChainInfo>(),
  destinationAddress: z.string().optional(),
  tabValue: z.enum(["regular", "flash"]).optional(),
  memo: z.string().optional(),
})
  // 1. Regular 模式地址必填
  .refine((data) => {
    if (data.tabValue === "regular" || data.coin?.coinSymbol === "SOSO") {
      return !!data.destinationAddress;
    }
    return true;
  })
  // 2. 地址格式校验（根据链类型）
  .refine((data) => {
    if (data.destinationAddress && data.chain?.chain) {
      return validateAddressByChain(data.destinationAddress, data.chain.chain);
    }
    return true;
  })
  // 3. 金额不超过余额
  .refine((data) => toDefaultNumber(data.amount) <= toDefaultNumber(options?.max))
  // 4. 金额不低于最小提现
  .superRefine((data, ctx) => {
    if (toDefaultNumber(data.amount) < toDefaultNumber(options?.minWithdrawAmount)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["amount"], message: "..." });
    }
  })
  // 5. XRP/XLM Memo 必填（除非勾选 noMemoForAddress）
  .refine((data) => {
    if ((data.coin?.coinSymbol === "XRP" || data.coin?.coinSymbol === "XLM") && !options?.noMemoForAddress) {
      return data.memo && data.memo.trim().length > 0;
    }
    return true;
  });
```

### 2. 提现流程 (toSubmit → handleTransfer → withdrawFor)

```
┌──────────────────────────────────────────────────────────────────────────┐
│                          toSubmit(data)                                  │
├──────────────────────────────────────────────────────────────────────────┤
│  1. requiresWallet() 检查钱包连接                                        │
│  2. verifyWithdrawAddress() 高风险地址检测（Regular 模式）               │
│  3. handleTransfer() 执行资产转移（Spot → 链上）                         │
│  4. withdrawFor(data, withdrawType) 执行提现签名                         │
│  5. chainAsset.getBalances(true) 刷新余额                                │
│  6. resolveModal() 关闭弹窗                                              │
└──────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────┐
│                      handleTransfer() - Spot 账户专用                    │
├──────────────────────────────────────────────────────────────────────────┤
│  1. setWithdrawStatus("approving")                                       │
│  2. signTransferAssetRequest() - Spark 签名                              │
│  3. spotUniversalApi({ type: "transferAsset", ... })                     │
│  4. updateBalances(Infinity) 等待余额更新                                │
│  5. setWithdrawStatus("confirming")                                      │
└──────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────┐
│                 withdrawFor(data, withdrawType) - EIP-712 签名           │
├──────────────────────────────────────────────────────────────────────────┤
│  1. switchToTargetNetwork() 切换到 ValueChain                            │
│  2. getCallForPermitNonce() 获取 nonce                                   │
│  3. 构造 EIP-712 domain + message                                        │
│  4. signTypedDataCompatible() 签名                                       │
│  5. verifyTypedData() 验证签名                                           │
│  6. encodeAbiParameters() 编码 cmdData                                   │
│  7. callForPermit() 调用后端 API 执行提现                                │
└──────────────────────────────────────────────────────────────────────────┘
```

### 3. EIP-712 签名结构

```typescript
// domain
const domain = {
  name: "SoDexTokenCallForPermit",
  version: "1.0.0",
  chainId: VALUE_CHAIN_NETWORK.id,
  verifyingContract: VALUE_CHAIN_CONTRACTS.SODEX_TOKEN_CALL_FOR_PERMIT.address,
};

// message
const message = {
  to: VALUE_CHAIN_CONTRACTS.SODEX_TOKEN_WITHDRAWER.address,
  cmd: {
    coinSymbol: coin.coinSymbol,
    chain: chain.chain,
    receiver: destinationAddress,  // XRP/XLM: `${address}:${memo}`
    amount: amountBigint,
    withdrawType: Number(withdrawType),
    memo: remarkValue,
    failedBackToClob: fundsData?.accountType === "Spot",
  },
  nonce,
  deadline: deadlineBigint,
};
```

### 4. SOSO 原生代币转账

SOSO 币种使用原生代币转账，不走 callForPermit：

```typescript
if (isSoso) {
  setWithdrawStatus("confirming");
  await switchToTargetNetwork();
  
  // 计算实际转账金额（扣除手续费）
  const rawAmountInWei = parseUnits(data.amount, decimals);
  const sosoFeeInWei = parseUnits("0.0001", decimals);
  const amountInWei = rawAmountInWei > sosoFeeInWei ? rawAmountInWei - sosoFeeInWei : 0n;
  
  // 发送原生代币转账
  const txHash = await sendTransactionCompatible({
    to: data.destinationAddress as `0x${string}`,
    value: amountInWei,
    chainId: VALUE_CHAIN_NETWORK.id,
    gasPrice: BigInt(1e9),
    type: "legacy",
  });
  
  // 等待交易确认
  await waitForTransactionReceipt(wagmiConfig, {
    hash: txHash,
    chainId: VALUE_CHAIN_NETWORK.id,
    confirmations: 2,
  });
}
```

### 5. Enable Trading 流程

当 Spot Account + needsRefresh 时，需要先完成签名授权：

```typescript
const handleButtonClick = async () => {
  if (fundsData?.accountType === "Spot" && needsRefresh) {
    // 1. 保存当前表单数据
    const savedRestoreForm = { ...watch(), tabValue };
    
    // 2. 关闭当前弹窗
    suppressDepositGuideOnce();
    resolveModal?.();
    
    // 3. 执行签名
    const signResult = ui.isMobileScreen
      ? await signMessageMobile()
      : await signMessage();
    
    if (signResult !== "success") {
      reopenWithdrawModal();  // 签名失败/取消，重开弹窗
      return;
    }
    
    // 4. 弹出 Stay signed in 弹窗
    if (ui.isMobileScreen) {
      await staySignedInDrawer.open({ onFinish: openWithdrawModal });
    } else {
      await createStaySignedInModal.open({ onFinish: openWithdrawModal });
    }
    return;
  }
  
  // 正常提现流程
  await toSubmit(watch());
};
```

## 关键 Hooks

### useWithdraw

查询提现参数（链上合约调用）：

```typescript
// src/pages/_components/hooks/useWithdraw.ts
interface WithdrawRequirements {
  withdrawFee: bigint;        // 提现手续费
  userBalance: bigint;        // 用户余额
  availableAmount: bigint;    // 可提现额度
  burnRateLimitCap: bigint;   // 销毁限额上限
  burnRateLimitTimeWindow: bigint;
  burnRateLimitBuffer: bigint;
  coinAddr: string;           // 币种合约地址
  bridgeAddr: string;         // 桥合约地址
  tokenAddress: `0x${string}`;
}

const { withdrawRequirements } = useWithdraw({
  coinSymbol: coin?.coinSymbol,
  chain: chain?.chain,
  address: address!,
  withdrawType: tabValue === "regular" ? WithdrawType.Regular : WithdrawType.Flash,
  enabled: !!coin.coinSymbol && !!chain.chain,
});
```

### 其他关键 Hooks

| Hook | 用途 |
|------|------|
| `useFundingToken` | 获取所有可用币种列表 |
| `useTokenConfig` | 获取 Token 配置（最小提现金额） |
| `useNonce` | 获取 callForPermit nonce |
| `useSparkSigner` | Spark 签名（signTransferAssetRequest） |
| `useCompatibleSign` | 兼容签名（signTypedDataCompatible, sendTransactionCompatible） |
| `usePrivateKeyRefresh` | 检测是否需要 Enable Trading |

## 账户余额获取

```typescript
// 从 mergedSpotAndFuturesBalances 获取币种余额
const targetCoinBalances = useMemo(() => {
  return chainAsset.mergedSpotAndFuturesBalances.find((item) => {
    const symbol = item.symbol || "";
    const normalizedSymbol = symbol.toLowerCase().startsWith("v") ? symbol.slice(1) : symbol;
    return isEqualIgnoreCase(normalizedSymbol, coin.coinSymbol);
  });
}, [chainAsset.mergedSpotAndFuturesBalances, coin?.coinSymbol]);

// 构建账户数据源
const accountDataSource = useMemo(() => ({
  Spot: {
    value: targetCoinBalances.spotAsset?.availableBalance || "0",
    accountType: "Spot",
  },
  Funding: {
    value: targetCoinBalances.value,
    accountType: "Funding",
  },
}), [targetCoinBalances]);
```

## 文件结构

```
src/pages/_components/withdraw/
├── WithdrawModal.tsx          # 主提现弹窗组件（1745行）
├── index.tsx                  # 导出入口
├── schema.ts                  # Zod 表单验证 schema
├── AccountAmountSelector.tsx  # 账户选择器+金额输入
├── TransferProcess.tsx        # 转账进度展示
└── FundsSelector.tsx          # 资金选择器（旧版，已弃用）

src/pages/_components/hooks/
└── useWithdraw.ts             # 提现参数查询 Hook

src/pages/_components/common/
├── CoinSelector.tsx           # 币种选择器
├── ChainSelector.tsx          # 链选择器
├── RegularFlashTab.tsx        # Regular/Flash 模式切换
└── RecentTransfer.tsx         # 最近转账记录
```

## 关键设计决策

### 1. 双账户支持

提现支持从 Spot Account 和 Funding Account 两个账户发起：
- **Spot Account**: 资产在 CLOB 系统中，需要先调用 `signTransferAssetRequest` 转移到链上，再执行提现
- **Funding Account**: 资产已在链上，直接调用 `withdrawFor` 执行提现

### 2. 表单恢复机制

Enable Trading 流程会关闭当前弹窗，完成后需要恢复用户输入：
- 使用 `restoreForm` props 恢复表单字段
- 使用 `restoreSelectedAccountType` 恢复账户选择
- 使用 `restoreNoMemoForAddress` 恢复 Memo 勾选状态

### 3. 动态 Schema

表单验证 schema 根据以下因素动态生成：
- `max`: 当前账户余额（切换账户时更新）
- `minWithdrawAmount`: 最小提现金额（从 TokenConfig 获取）
- `noMemoForAddress`: XRP/XLM Memo 是否必填

## 术语表

| 术语 | 说明 |
|------|------|
| **Regular** | 普通提现模式，需要填写目标地址 |
| **Flash** | 闪电提现模式，直接提现到绑定钱包 |
| **callForPermit** | EIP-712 签名后调用的后端 API，执行实际提现操作 |
| **withdrawFee** | 提现手续费，从链上合约查询 |
| **availableAmount** | 当前可提现额度，受速率限制影响 |
| **Enable Trading** | Spot 账户首次使用需要签名授权 |
| **needsRefresh** | 标记是否需要执行 Enable Trading 流程 |

## 代码位置索引

| 功能 | 文件 | 行号 |
|------|------|------|
| 主组件入口 | `WithdrawModal.tsx` | 125 |
| 表单验证 schema | `schema.ts` | 14-108 |
| 提现参数查询 | `useWithdraw.ts` | 23-92 |
| 账户金额选择器 | `AccountAmountSelector.tsx` | 47-226 |
| EIP-712 签名 | `WithdrawModal.tsx` | 850-941 |
| SOSO 原生转账 | `WithdrawModal.tsx` | 1017-1078 |
| Enable Trading 处理 | `WithdrawModal.tsx` | 1237-1352 |
| 表单恢复逻辑 | `WithdrawModal.tsx` | 263-323 |

## 更新记录

### 2026-03-03: 初始版本

初始文档，通过 /k/context learn 从代码自动生成
