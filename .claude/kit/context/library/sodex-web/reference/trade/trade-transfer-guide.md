# Trade Transfer 划转功能指南

## 📋 概述

Trade Transfer 是账户间资金划转功能，支持用户在三种账户之间转移资产：
- **Funding**: 资金账户（链上钱包余额）
- **Spot**: 现货交易账户
- **Perps**: 合约交易账户

**有效划转路径**：
- Funding ↔ Spot（支持）
- Spot ↔ Perps（支持）
- Funding ↔ Perps（不支持直接互转）

---

## 🪙 类型定义

### 账户类型 (TransferAccountType)

```typescript
type TransferAccountType = "Funding" | "Spot" | "Perps";
```

### 划转数据 (TransferData)

```typescript
interface TransferData {
  from?: TransferAccountType;           // 起始账户，默认 "Funding"
  to?: TransferAccountType;             // 目标账户，默认 "Spot"
  token?: BalancesWithSpotAsset;        // 划转币种
  amount?: string;                       // 划转金额
  tradingPairs?: string[];              // 限定的交易对币种
  fromFundingAccount?: boolean;         // 是否从 Funding 账户入口进入
}
```

### 有效划转键 (ValidTransferKey)

```typescript
// 排除 from/to 相同的情况
type ValidTransferKey = Exclude<
  `${TransferAccountType}-${TransferAccountType}`,
  "Funding-Funding" | "Spot-Spot" | "Perps-Perps"
>;

// 实际有效值: 
// "Funding-Spot" | "Spot-Funding" | 
// "Spot-Perps" | "Perps-Spot" | 
// "Funding-Perps" | "Perps-Funding" (不可用)
```

---

## 🎯 默认账户组合选择规则

### 优先级规则

| 优先级 | 条件 | 默认组合 |
|--------|------|----------|
| 1 | 入口传入 from/to | 使用入口参数 |
| 2 | 测试网环境（无 Funding） | Perps → Spot |
| 3 | 主网未传参 | Funding → Spot |

### 邮箱登录用户特殊规则

| 币种类型 | 包含币种 | 允许组合 |
|----------|----------|----------|
| **EVM 类** | SOSO, WSOSO, MAG7SSI, SMAG7SSI | Funding ↔ Spot |
| **Futures 类** | USDC | Spot ↔ Perps |

**自动切换逻辑**：
- 邮箱用户选择 EVM 币种 + 非 Funding↔Spot 组合 → 自动切换为 Spot → Funding
- 邮箱用户选择 USDC + 非 Spot↔Perps 组合 → 自动切换为 Spot → Perps
- 邮箱用户选择 Perps 账户 + EVM 币种 → 自动切换币种为 USDC

### 币种切换时的账户自动调整 (onTokenChange)

```typescript
// 邮箱用户：根据币种类型自动切换账户组合
if (emailLogin) {
  if (isEmailEvmToken(token.symbol)) {
    // EVM 币种 → 强制 Spot ↔ Funding
    // 保持原方向（如从 Spot 入口进来应为 Spot → Funding）
    const isEvmPair = (from === "Spot" && to === "Funding") 
                   || (from === "Funding" && to === "Spot");
    if (!isEvmPair) {
      handleTransferDataChange({
        token,
        from: fromFundingAccount ? "Funding" : "Spot",
        to: fromFundingAccount ? "Spot" : "Funding",
      });
    }
    return;
  }
  
  if (isEmailFuturesToken(token.symbol)) {
    // Futures 币种 → 强制 Spot ↔ Perps
    const newFrom = transferData.from === "Perps" ? "Perps" : "Spot";
    const newTo = newFrom === "Perps" ? "Spot" : "Perps";
    handleTransferDataChange({ token, from: newFrom, to: newTo });
    return;
  }
}

// 非邮箱用户：选择非 Futures 支持代币时，切换到 Funding ↔ Spot
if (!isFuturesSupportedToken && isSpotAndFuturesTransfer) {
  handleTransferDataChange({
    token,
    from: "Funding",
    to: "Spot",
  });
  return;
}
```

### 账户切换时的币种自动调整 (onAccountTypeChange)

```typescript
// 邮箱用户 + 选择 Perps 账户 + 当前是 EVM 币种 → 自动切换为 USDC
if (emailLogin && accountType === "Perps") {
  if (isEmailEvmToken(currentSymbol)) {
    const usdcToken = mergedSpotAndFuturesBalances.find(b => b.symbol === "USDC");
    if (usdcToken) {
      handleTransferDataChange({
        token: usdcToken,
        from: direction === "from" ? "Perps" : "Spot",
        to: direction === "from" ? "Spot" : "Perps",
      });
      return;
    }
  }
}
```

---

## 🪙 默认币种选择规则

### 优先级规则

| 优先级 | 条件 | 选择币种 |
|--------|------|----------|
| 1 | 入口传入 symbol 且可用 | 使用入口币种 |
| 2 | 入口未传入币种 | 默认 USDC |
| 3 | USDC 不可用 | 可选列表第一项 |

### 可选列表规则

| 用户类型 | 列表规则 |
|----------|----------|
| **邮箱登录** | 只展示平台允许币种 |
| **非邮箱（传入交易对）** | 优先展示交易对币种 + 有余额币种 |
| **非邮箱（未传交易对）** | 展示所有有余额币种 |

**特殊处理**：WSOSO 统一映射为 SOSO 显示

### SymbolSelector 币种列表过滤逻辑

```typescript
// 固定显示的币种常量
const SPOT_PERPS_ALWAYS_SHOW_TOKENS = ["USDC", "ETH", "BTC", "SOL", "XAUT"];

// 过滤优先级（按代码顺序）
if (isSpotAndFuturesTransfer && tradingPairs?.length) {
  // 1. Spot↔Perps 互转：固定显示 5 种主流币种 + tradingPairs 中的币种
  return balances.filter((item) => {
    if (SPOT_PERPS_ALWAYS_SHOW_TOKENS.some(t => isEqualIgnoreCase(item.name, t))) return true;
    return tradingPairs.includes(item.symbol);
  }).filter(dropWSOSO);
}

if (emailLogin) {
  // 2. 邮箱用户：只显示允许币种，不受 tradingPairs 限制
  return balances.filter(dropZeroBalance).filter(dropWSOSO)
    .filter(isEmailLoginEnableTransferToken);
}

if (tradingPairs?.length) {
  // 3. 非邮箱 + 传入交易对：交易对币种 + 其他有余额币种
  const tradingPairsBalances = balances.filter(tradingPairs);
  const otherBalances = balances.filter(!tradingPairs).filter(dropZeroBalance);
  return tradingPairsBalances.concat(otherBalances).filter(dropWSOSO);
}

// 4. 默认（Funding↔Spot）：有余额币种，USDC 固定显示
return balances.filter(dropZeroBalance).filter(dropWSOSO);
```

**重要说明**：`options` 生成时，Spot↔Perps 场景不再使用 `dropZeroBalance` 二次过滤，避免固定币种被过滤掉。

**过滤函数说明**：

| 函数 | 作用 |
|------|------|
| `dropZeroBalance` | 过滤零余额，但保留 USDC |
| `dropWSOSO` | 隐藏 WSOSO（统一映射到 SOSO） |
| `filterEmailLoginTokens` | 邮箱用户只显示 SOSO/MAG7/SMAG7/USDC |
| `SPOT_PERPS_ALWAYS_SHOW_TOKENS` | Spot↔Perps 固定显示：USDC/ETH/BTC/SOL/XAUT |

**默认选中逻辑**：
1. 查找入口传入的 `symbol`
2. 找不到则选择 `USDC`
3. 都找不到则选择列表第一项

---

## 📲 业务入口与默认配置

### 现货交易入口

| 入口 | 默认币种 | 默认方向 |
|------|----------|----------|
| 下单区域黄色加号 | 当前交易对币种 | Perps → Spot（现货模式）/ Spot → Perps（合约模式） |
| Buy 余额不足引导 | USDC | 余额较多账户 → Spot |

### 合约交易入口

| 入口 | 默认币种 | 默认方向 |
|------|----------|----------|
| 下单按钮余额不足引导 | USDC | Spot → Perps |
| AvailableToTrade 加号 | 当前交易对币种 | Spot → Perps |
| 新手引导第二步 | 引导传入参数 | Spot → Perps |

### 资产页入口

| 入口 | 非邮箱用户 | 邮箱用户 |
|------|------------|----------|
| 顶部 Transfer 按钮 | Funding → Spot | Spot → Perps |
| 资产列表 USDC 划转 | 根据账户类型 | Spot ↔ Perps |
| 资产列表非 USDC 划转 | Funding ↔ Spot | Funding ↔ Spot |

---

## 🔄 划转执行流程

### Funding → Spot 流程

```
用户点击 Confirm
    ↓
requiresWallet() 检查钱包连接
    ↓
needSwitchToValueChain? → 是 → switchToTargetNetwork()
    ↓ 否
isSoSo?
├─ 是 → 进入 <Process /> 组件（wrap + deposit 流程）
└─ 否 → handleApproveForPermit()
         ↓
         approveForPermit() → permit 签名
         ↓
         confirmForPermit() → 等待交易确认
         ↓
         transferSuccessHandler()
```

### Spot ↔ Perps 流程

```
用户点击 Confirm
    ↓
确定 transferTypeMap：
├─ "Perps-Spot" → TRANSFER_ASSET_TYPE_SPOT_WITHDRAW (KeyType.FUTURES)
├─ "Spot-Perps" → TRANSFER_ASSET_TYPE_PERPS_WITHDRAW (KeyType.SPOT)
└─ "Spot-Funding" → TRANSFER_ASSET_TYPE_EVM_WITHDRAW (KeyType.SPOT)
    ↓
signTransferAssetRequest(params, keyType, address)
    ↓
trade.universalRequest(keyType)({ type: "transferAsset", ... })
    ↓
transferSuccessHandler() → updateBalance()
    ↓
checkBalancesModified(loopCount, 2000, waitForChainBalance=false)
    ↓  (跳过链上余额轮询，因为 Spot↔Perps 不涉及链上)
✅ 转账完成（约 1-2 秒）
```

### 错误处理

两个 catch 块均调用 `reportWalletError`（`src/utils/sentry.ts`），自动过滤用户主动拒绝（`isUserCancel`）：

| 函数 | Sentry action tag |
|------|-------------------|
| `handleApproveForPermit` | `Transfer.handleApproveForPermit` |
| `executeTransfer` | `Transfer.executeTransfer` |

> **性能优化说明**（2026-03-24 实现）：
> - Spot ↔ Perps 是内部账户转账，不涉及链上 EVM 余额变化
> - 传入 `waitForChainBalance=false` 跳过 `getBalances(true)` 的链上轮询
> - 优化前耗时约 17-19 秒，优化后约 0.5-1 秒

### waitForChainBalance 路径规则

各划转路径是否需要等待 EVM 链上余额确认：

| 路径 | EVM 余额会变化？ | 需要等待 EVM 确认？ |
|------|-----------------|-------------------|
| Funding → Spot | ✅ 减少 | ✅ 需要 |
| Spot → Funding | ✅ 增加 | ✅ 需要 |
| **Spot → Perps** | ❌ 不变 | ❌ 不需要 |
| **Perps → Spot** | ❌ 不变 | ❌ 不需要 |

**调用逻辑**（`transfer/index.tsx`）：

```typescript
// Spot↔Perps 同步检测：等待后端数据同步后检测余额变化
// 第一次 300ms 覆盖正常情况，第二次 900ms 兜底极端延迟
const waitForSpotPerpsSync = async () => {
  const intervals = [300, 900];
  for (const interval of intervals) {
    await sleep(interval);
    const changed = await chainAsset.checkBalancesModified(1, 0, false);
    if (changed) return;
  }
};

// Spot↔Perps 纯链下划转：等待后端同步 + 跳过 EVM 余额轮询
if (isSpotAndFuturesTransfer) {
  await waitForSpotPerpsSync();
} else {
  await chainAsset.checkBalancesModified(loopCount, 2000, !isSpotAndFuturesTransfer);
}
```

> **同步检测说明**：
> - 第一次 300ms：覆盖 ~90% 正常情况，检测到变化立即返回
> - 第二次 900ms：兜底极端延迟，确保数据最终正确
> - `checkBalancesModified` 内部会刷新余额数据，即使返回 `false` 数据也是最新的

**测试验证结果**（4 条路径全覆盖）：

| 路径 | waitForChainBalance | 进入 EVM 轮询 | 测试状态 |
|------|--------------------:|---------------|----------|
| Funding → Spot | `true` | ✅ 是 | ✅ 通过 |
| Spot → Funding | `true` | ✅ 是 | ✅ 通过 |
| Spot → Perps | `false` | ❌ 跳过 | ✅ 通过 |
| Perps → Spot | `false` | ❌ 跳过 | ✅ 通过 |

### SOSO Funding → Spot 特殊流程

```
进入 <Process /> 组件
    ↓
isShowAddNetWork? → 是 → handleAddNetwork() 切换到 ValueChain
    ↓ 否
checkAllowance() 检查授权额度
    ↓
授权不足? → 是 → handleApprove()
               ↓
               sendTransactionCompatible({ approve(CLOB_GATEWAY_ADDRESS, amount) })
               ↓
               waitForTransactionReceipt() 等待确认
    ↓
handleConfirm()
    ↓
sendTransactionCompatible({ depositERC20(SOSO_TOKEN_ADDRESS, amount) })
    ↓
waitForTransactionReceipt() 等待 2 confirmations
    ↓
spotAsset.fetchBalanceList() + chainAsset.getBalances()
    ↓
onSuccess() → modal.hide()
```

**关键合约调用**：
```typescript
// 授权 (如果需要)
encodeFunctionData({
  abi: erc20Abi,
  functionName: "approve",
  args: [CLOB_GATEWAY_ADDRESS, parseUnits(amount, decimals)],
});

// 充值
encodeFunctionData({
  abi: clobGatewayAbi,
  functionName: "depositERC20",
  args: [SOSO_TOKEN_ADDRESS, parseUnits(amount, decimals)],
});
```

**ProcessStatus 状态流转**：
```
"addingNetwork" → "approving" → "confirming" → (success/failed)
```

**费用计算**：
```typescript
const SOSO_GAS_FEE = 0.001;        // 预估 gas 费
const SOSO_ACTIVATION_FEE = 1;     // 激活费

receiveAmount = inputAmount - SOSO_GAS_FEE - SOSO_ACTIVATION_FEE;
```

---

## 🏗️ 组件架构

### 主组件结构

```
<Transfer>
├─ isProcessing?
│   └─ <Process />                    # SOSO wrap + deposit 流程
└─ 主界面
    ├─ <TransferAccountSwitcher />    # 账户选择器（from ↔ to）
    ├─ <SymbolSelector />             # 币种选择 + 金额输入
    ├─ <Collapse> 合约划转提示        # showFuturesTransferTips
    ├─ <Collapse> 多资产划转提示      # showMultiAssetTransferTips
    ├─ <Collapse> SOSO 费用信息       # isSOSOFromFunding
    └─ <ContainedButton>              # 确认按钮
```

### 核心子组件

| 组件 | 职责 |
|------|------|
| `TransferAccountSwitcher` | 账户类型选择器，支持双向切换 |
| `SymbolSelector` | 币种下拉选择 + 金额输入 + 余额显示 |
| `Process` | SOSO wrap/deposit 流程处理 |

### 核心 Hooks

| Hook | 职责 |
|------|------|
| `useSparkSigner` | 提供 `signTransferAssetRequest` 签名方法 |
| `useDepositERC20WithPermit` | 提供 `approveForPermit` / `confirmForPermit` |
| `useAddNetwork` | 提供 `switchToTargetNetwork` 网络切换 |
| `useWalletOperationCheck` | 提供 `requiresWallet` 钱包检查 |
| `useWalletAddress` | 提供 `emailLogin` 邮箱登录状态 |

---

## 🛡️ 验证与限制

### 确认按钮 disabled 条件

```typescript
const disabled = (
  (!toDefaultNumber(transferData.amount) ||      // 金额为空
   !toDefaultNumber(maxAmount) ||                 // 最大可用为 0
   noMoreSOSOFromFunding ||                       // SOSO 扣费后为 0
   calculate(transferData.amount).gt(maxAmount))  // 超出最大可用
  && !needSwitchToValueChain                      // 除非需要切换网络
);
```

### 特殊提示条件

| 提示类型 | 显示条件 |
|----------|----------|
| **合约划转提示** | `from === "Perps" && to === "Spot" && positionList.length > 0` |
| **多资产划转提示** | 多资产代币 + Perps → Spot + vUSDC 可用余额 < 0 |
| **SOSO 费用信息** | `isSoSo && isFundingToSpot && amount > 0` |

---

## 🔌 API 与签名

### 签名类型映射

| 划转路径 | TransferAssetType | KeyType |
|----------|-------------------|---------|
| Perps → Spot | `TRANSFER_ASSET_TYPE_SPOT_WITHDRAW` | `FUTURES` |
| Spot → Perps | `TRANSFER_ASSET_TYPE_PERPS_WITHDRAW` | `SPOT` |
| Spot → Funding | `TRANSFER_ASSET_TYPE_EVM_WITHDRAW` | `SPOT` |

### 签名参数

```typescript
const params = {
  id: 0,
  fromAccountID: Number(user.id) || 0,
  toAccountID: 999,
  coinID: coinData.id,          // 从 lookup.query("priceList") 获取
  amount: removeTrailingZeros(transferData.amount!),
  type: transferAssetType,
};
```

---

## 📁 文件结构

```
src/components_tw/modals/spot/transfer/
├── index.tsx                        # 主组件（694行）
├── types.ts                         # 类型定义
├── helper.ts                        # 辅助函数（账户纠正、币种判断）
├── constants.ts                     # 常量（SOSO_GAS_FEE、SOSO_ACTIVATION_FEE）
└── _components/
    ├── SymbolSelector.tsx           # 币种选择 + 金额输入（311行）
    ├── transferAccountSwitcher/
    │   ├── index.tsx                # 账户切换主组件
    │   ├── AccountTypeSelector.tsx  # 单个账户选择器
    │   └── Indicator.tsx            # 方向指示器
    └── process/
        ├── index.tsx                # SOSO approve+deposit 流程（298行）
        ├── AddingNetwork.tsx        # 网络切换 UI
        ├── ProcessIndicator.tsx     # 流程进度指示器
        └── CircleProcessing.tsx     # 加载动画
```

---

## 📝 术语表

| 术语 | 说明 |
|------|------|
| **Funding** | 资金账户，对应链上钱包余额 |
| **Spot** | 现货交易账户 |
| **Perps** | 永续合约交易账户 |
| **EVM 类币种** | SOSO/WSOSO/MAG7/SMAG7，只能 Funding ↔ Spot |
| **Futures 类币种** | USDC，可以 Spot ↔ Perps |
| **signTransferAssetRequest** | 划转签名方法，返回 signature + nonce |
| **universalRequest** | 通用请求方法，根据 KeyType 选择接口 |
| **permit** | ERC-2612 授权签名，用于 Funding → Spot |
| **wrap** | 将原生 SOSO 转换为 WSOSO |

---

## 📍 代码位置索引

| 功能 | 文件路径 |
|------|----------|
| 主组件 | `src/components_tw/modals/spot/transfer/index.tsx` |
| 类型定义 | `src/components_tw/modals/spot/transfer/types.ts` |
| 辅助函数 | `src/components_tw/modals/spot/transfer/helper.ts` |
| 常量定义 | `src/components_tw/modals/spot/transfer/constants.ts` |
| 流程组件 | `src/components_tw/modals/spot/transfer/_components/process.tsx` |
| 币种选择器 | `src/components_tw/modals/spot/transfer/_components/SymbolSelector.tsx` |
| 账户切换器 | `src/components_tw/modals/spot/transfer/_components/transferAccountSwitcher/index.tsx` |
| 弹窗导出 | `src/components_tw/modals/spot/index.tsx` |
| 签名 Hook | `src/hooks/useSignApi/index.ts` |
| Permit Hook | `src/pages/vault/components/modals/funding/_hooks/useDepositERC20WithPermit.ts` |

---

## 📅 更新记录

- **创建日期**: 2026-02-25
- **版本**: 1.4
- **参考文档**: 划转弹窗默认币种与账户选择.pdf

### 变更历史

| 日期 | 版本 | 变更内容 |
|------|------|----------|
| 2026-03-29 | 1.5 | 添加 Sentry 错误上报（`handleApproveForPermit` / `executeTransfer`），修正 `transferAccountSwitcher` 路径为目录 |
| 2026-03-24 | 1.4 | 封装 `waitForSpotPerpsSync`，两次检测（300ms+900ms）替代固定等待 |
| 2026-03-24 | 1.3 | 统一 Spot↔Perps 使用 300ms 等待（原 500ms，仅 Spot→Perps） |
| 2026-03-24 | 1.2 | 实现 `waitForChainBalance` 参数，Spot↔Perps 从 ~17s 优化到 ~1s |
| 2026-02-25 | 1.1 | 设计 `checkEvmBalance` 参数（未实现） |
| 2026-02-25 | 1.0 | 初始创建 |
