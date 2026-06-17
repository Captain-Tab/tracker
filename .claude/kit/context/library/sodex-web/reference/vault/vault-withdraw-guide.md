# Vault Withdraw 提现完整流程

## 架构概览

用户将 sMAG7.SLP（SLP Vault 份额）赎回为 MAG7.ssi 或 sMAG7.ssi，支持双路径链上交易。

```
用户打开 Withdraw 弹窗（index.tsx L79）
        ↓
getSLPMag7Data(address)          读取 SLP Token 链上余额
        ↓
表单输入 amount + 选择 token
  ├─ token = sMAG7.ssi（IN_COIN_SYMBOL）→ 2 步流程（Approve + Withdraw）
  └─ token = MAG7.ssi（OUT_COIN_SYMBOL）→ 3 步流程（Approve + Withdraw + Unstake）
        ↓
toSubmit()                       表单提交
  ├─ requiresWallet()            QR 登录用户拦截
  ├─ checkNetwork() / performSwitch()  自动切换到 ValueChain
  └─ shouldShowCooldownConfirm   有冷却中数量时先弹二次确认弹窗
        ↓
setIsTrading(true)               渲染 Trading 组件
        ↓
executeActions()（Trading.tsx L61）
  ├─ Step 1: approveForPermit    ERC-20 Approve（Permit 签名）
  ├─ Step 2: confirmForPermit    链上 Redeem，parseRedeemEvent 解析返回 assets
  └─ Step 3（仅 MAG7.ssi）: createBridgeCallFor(callForType:1)  Unstake
        ↓
vault.updateMag7RelatedBalance()
onComplete()（关闭弹窗）
```

**关键设计**：
- `token.symbol === OUT_COIN_SYMBOL` 决定步骤数：sMAG7.ssi = 2步，MAG7.ssi = 3步
- `shouldShowCooldownConfirm`：有未领取量或冷却进行中时，先弹二次确认防止覆盖冷却期
- `previewRedeem` + `NAV` 查询用于实时显示预估接收金额和手续费
- `parseRedeemEvent` 从链上 log 解析 Redeem 事件的 `assets`，传给第三步 Unstake 使用

---

## 核心逻辑

### toSubmit（index.tsx L327-366）

```typescript
const toSubmit = async (data: FormSchema) => {
  // 1. QR 登录用户拦截
  if (!requiresWallet()) return;

  // 2. 自动切换网络
  const currentChainCorrect = await checkNetwork();
  if (!currentChainCorrect) {
    const switchSuccess = await performSwitch();
    if (!switchSuccess) return;
  }

  // 3. 有冷却期时弹二次确认
  if (data.token?.symbol === IN_COIN_SYMBOL && shouldShowCooldownConfirm) {
    withdrawConfirmModal.open({
      unlockTime: formatDate(dayjs().add(14, "days").valueOf()),
      onConfirm: async (resolveConfirmModal) => {
        resolveConfirmModal?.();
        toTrading();
      },
      onClose: () => withdrawModal.open(),
    });
    return;
  }
  toTrading();
};
```

### shouldShowCooldownConfirm（index.tsx L171-180）

```typescript
const shouldShowCooldownConfirm = useMemo(() => {
  const pendingAmount = Number(formattedInfo?.cooldownAmount || 0);
  const isCooldownActive = formattedInfo?.isCooldownActive ?? Boolean(isCoolDown);
  return pendingAmount > 0 || isCooldownActive;
}, [formattedInfo?.cooldownAmount, formattedInfo?.isCooldownActive, isCoolDown]);
```

四种场景的判断逻辑：

| 场景 | cooldownAmount | isCooldownActive | 显示确认弹窗 |
|------|----------------|------------------|-------------|
| 有未领取且冷却中 | > 0 | true | ✅ |
| 有未领取但已解锁 | > 0 | false | ✅ |
| 已领完但冷却中 | = 0 | true | ✅ |
| 无冷却无待领 | = 0 | false | ❌ |

### useProcessOptions（useProcessOptions.tsx L55-265）

动态生成 2 或 3 步交易配置：

```
Step 1 (approve):   approveForPermit(amount)      → permitSignature
Step 2 (withdraw):  confirmForPermit(amount, sig)  → txHash + assets
Step 3 (unstake, 仅 MAG7.ssi):
                    createBridgeCallFor({
                      callForType: 1,
                      inAmount: assetsBigInt,  // 从 parseRedeemEvent 解析
                      minOutAmount: 0n,
                      toClob: false,
                    })
```

Step 2 之后通过 `parseRedeemEvent` 从链上 log 解析 assets：
```typescript
const redeemEvent = await parseRedeemEvent(txHash, SLP_TOKEN_ADDRESS);
assets = formatUnits(redeemEvent.assets, vsMag7Decimals);
assetsBigInt = redeemEvent.assets;
```

### executeActions（Trading.tsx L61-113）

顺序执行 options，previousData 在步骤间传递：

```typescript
let previousData: Partial<WithdrawProcessPreviousData> = {};
for (const option of options) {
  const data = await option.action.execute(previousData);
  // 每步执行后刷新余额
  chainAsset.getBalances(true);
  spotAsset.fetchBalanceList();
  previousData = { ...previousData, [option.action.type]: data };
  updateStep();
}
```

Step 3 从 previousData 取 `withdraw.assetsBigInt`，确保 Unstake 金额精度正确。

### calculateFee（index.tsx L237-267）

```typescript
// fee = NAV × inputAmount - previewRedeemResult
const fee = Number(navResult.formattedNav) * Number(amount) - Number(previewResult.formattedAmount);
return fee <= 0 ? "--" : fee.toFixed(2);
```

防抖 1000ms（`isDebouncing`）期间显示 `"--"`，避免频繁请求。

---

## 关键实现

### 余额查询（index.tsx L59-78, L120-133）

```typescript
const slpBalanceOf = createErc20BalanceOf(SLP_TOKEN_ADDRESS, VALUE_CHAIN_NETWORK.id);

const getSLPMag7Data = async (address: Address) => {
  const decimals = await erc20Decimals(SLP_TOKEN_ADDRESS, VALUE_CHAIN_NETWORK.id);
  const balanceRAW = await slpBalanceOf(address);
  return {
    decimals,
    value: formatUnits(balanceRAW, decimals),
    bigIntValue: balanceRAW,
    symbol: "sMAG7.SLP",
    // ...
  };
};

// address 变化时手动触发刷新
useEffect(() => {
  if (address) refreshSlpMag7Data(address as `0x${string}`);
}, [address]);
```

### 最小提现金额（schema.ts + index.tsx L384-402）

最小金额从链上 `getVaultMinWithdrawAmount` 动态获取，存储在 `minWithdrawAmount` state：

```typescript
const minWithdrawAmount = await getVaultMinWithdrawAmount(
  "BASE_ETH",
  token.symbol.replace(/^v/, ""),  // 去掉 "v" 前缀
);
setMinWithdrawAmount(formatUnits(minWithdrawAmount || 0n, MAG7_DECIMALS));
```

### 骨架屏（index.tsx L541）

`isLoadingBalance && !isTrading` 时显示 `VaultWithdrawSkeleton`，交易中不覆盖 Trading 组件。

---

## 文件结构

```
src/pages/vault/components/modals/funding/withdraw/
├── index.tsx                      # Withdraw 主组件（546行）
├── VaultWithdrawButton.tsx        # 三态按钮（141行）
├── Confirm.tsx                    # 冷却期二次确认弹窗（46行）
├── schema.ts                      # Zod 校验（最小提现金额 + 余额上限）
└── transaction/
    ├── index.ts                   # 导出 Trading
    ├── Trading.tsx                # 链上交易执行组件（144行）
    └── useProcessOptions.tsx      # 动态步骤配置（267行）

相关文件：
src/hooks/useProxyAndCooldown.ts              # 冷却期状态
src/hooks/usePreviewRedeem.ts                 # 预估赎回金额
src/hooks/useNav.ts                           # NAV 汇率查询
src/hooks/useTokenConfig.ts                   # 最小提现金额查询
src/hooks/useNetworkSwitch.ts                 # 网络切换
src/pages/vault/components/modals/funding/_hooks/useVaultRedeemWithPermit.ts  # Approve+Redeem 签名
src/pages/vault/components/modals/funding/_hooks/useCallForPermit.ts          # createBridgeCallFor
src/utils/parseTransactionLogs.ts             # parseRedeemEvent
src/pages/vault/components/modals/funding/_components/VaultWithdrawSkeleton.tsx
```

---

## 关键设计决策

**为什么需要 parseRedeemEvent？**
Redeem 的实际返回 `assets`（sMAG7.ssi 数量）由合约计算，客户端传入的是 `shares`（sMAG7.SLP）。Unstake 步骤需要精确的 `assets` 金额，所以必须从链上 log 解析，而不是用输入金额推算。

**为什么冷却期要二次确认？**
新的 Withdraw 操作会重置冷却计时器，如果用户有正在冷却的旧赎回单，会延迟其领取时间。四种场景都要拦截（只有"无冷却无待领"跳过），防止用户误操作。

**为什么 token 选择决定步骤数？**
- `sMAG7.ssi`（IN_COIN_SYMBOL）：只需从 SLP 赎回，得到 sMAG7 即可（2步）
- `MAG7.ssi`（OUT_COIN_SYMBOL）：赎回后还需额外 Unstake 将 sMAG7 → MAG7（3步）

**为什么用防抖1000ms？**
previewRedeem 和 NAV 是链上 / RPC 查询，用户快速输入时频繁请求会产生大量并发。防抖过程中 calculateFee 显示 `"--"` 给用户即时反馈。

---

## 术语表

| 术语 | 说明 |
|------|------|
| **sMAG7.SLP** | SLP Vault 的份额代币，用于 Withdraw 输入 |
| **sMAG7.ssi** | Unstake 前的中间状态代币（IN_COIN_SYMBOL） |
| **MAG7.ssi** | 最终目标代币（OUT_COIN_SYMBOL），需额外 Unstake |
| **SLP_TOKEN_ADDRESS** | sMAG7.SLP 合约地址（Value Chain） |
| **approveForPermit** | ERC-20 Permit 签名授权（Step 1） |
| **confirmForPermit** | 链上 Redeem 执行（Step 2） |
| **parseRedeemEvent** | 从链上 log 解析 Redeem 事件的 assets 金额 |
| **shouldShowCooldownConfirm** | 判断是否弹冷却期二次确认弹窗 |
| **callForType: 1** | Bridge 合约的 Unstake 操作类型 |
| **NAV** | Net Asset Value，sMAG7.SLP 的净值汇率 |
| **previewRedeem** | 预估赎回后收到的代币数量 |

---

## 更新记录

### 2026-03-29: 初始版本

初始文档，通过 /k/context learn 从代码自动生成
