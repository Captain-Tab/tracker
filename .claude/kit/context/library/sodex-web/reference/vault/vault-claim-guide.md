# Vault Claim 领取弹窗

## 架构概览

sMAG7 经过 Unstake → 冷却期（cooldown）到期后，用户可通过 Claim 弹窗将 sMAG7 赎回为 MAG7.ssi。

```
用户点击 Claim 按钮
        ↓
Claim 弹窗打开（index.tsx L35）
        ↓
useProxyAndCooldown() 获取
  ├─ proxyAddress（代理合约地址）
  └─ formattedInfo.cooldownAmount（可领取金额上限）
        ↓
用户输入金额（AmountInput）
  ├─ 最小：4 MAG7.ssi（MINIMUM_USDC_CLAIM_AMOUNT）
  └─ 最大：cooldownAmount
        ↓
handleClaim()
  ├─ createBridgeCallFor({ callForType: 2, inAmount: 0n, minOutAmount: parseUnits(amount,8) })
  │   └─ 链上合约调用（Value Chain）
  ├─ waitForTransactionReceipt({ confirmations: 3 })
  └─ vault.updateMag7RelatedBalance()
        ↓
弹窗关闭（resolve()）
```

**关键设计**：
- `callForType: 2` 表示 Claim 操作（区别于 Deposit 的其他类型）
- `inAmount: 0n`，`minOutAmount` 为用户输入金额（8位精度），合约自动从 cooldown 池取
- `toClob: true` 资金直接进入 Spot 账户

---

## 核心逻辑

### handleClaim（index.tsx L75-119）

```typescript
const handleClaim = async () => {
  if (isLoading) return;
  try {
    setIsLoading(true);
    const data = await createBridgeCallFor({
      chain: "BASE_ETH",
      callForType: 2,
      inCoinSymbol: "sMAG7",
      outCoinSymbol: "MAG7",
      inAmount: 0n,
      minOutAmount: parseUnits(amount, 8),  // 8位精度
      toClob: true,
    });

    // 验证 txHash
    if (!data || typeof (data as any)?.txHash !== "string") {
      throw new Error("Transaction failed: No transaction hash received");
    }

    // 等待链上确认（3个确认）
    const receipt = await valueChainClient!.waitForTransactionReceipt({
      hash: (data as any).txHash as `0x${string}`,
      confirmations: 3,
    });

    if (receipt.status !== "success") {
      throw new Error("Transaction failed on valuechain, please try again");
    }

    await vault.updateMag7RelatedBalance();
    resolve?.();
  } catch (error) {
    notify.error(t("common:claim_failed"));
  } finally {
    setIsLoading(false);
  }
};
```

### 表单校验（schema.ts L11-37）

动态 Zod schema，两个 refine 规则：

| 规则 | 条件 | 错误信息 |
|------|------|----------|
| 最小金额 | `amount >= 4` | `Minimum claim is 4 MAG7.ssi.` |
| 最大金额 | `amount <= cooldownAmount` | `Maximum claim is {cooldownAmount} MAG7.ssi.` |

`MINIMUM_USDC_CLAIM_AMOUNT = 4`（schema.ts L9）

### VaultClaimButton 三态逻辑（VaultClaimButton.tsx L89-129）

```
未连接钱包       → "Connect Wallet"（ContainedButton，PrivyChekckModal.open()）
需要 Enable      → "Enable Claim"（ContainedButton，handlePreClaim → doEnableTrading）
可领取           → "Claim"（PrimaryButton，type=submit 触发表单）
```

触发 Enable 条件：`(user.id && !user.inWhitelist) || (user.id && needsRefresh)`

---

## 关键 Hooks

### useProxyAndCooldown（src/hooks/useProxyAndCooldown.ts）

组合三个子 Hook：

| Hook | 职责 |
|------|------|
| `useProxyAddress` | 获取用户代理合约地址 |
| `useCooldownInfos(proxyAddress)` | 获取该地址的 cooldown 可领取量 |
| `useCooldown` | 获取合约全局 cooldown 时长设置 |

关键返回值：
- `formattedInfo.cooldownAmount`：当前可领取数量（用作表单上限）
- `isLoading`：三个子 Hook loading 的聚合
- `formattedCooldown`：格式化的冷却时长（用于 UI 展示）

在 Claim 组件中的使用方式（index.tsx L40-68）：
```typescript
const { formattedInfo, isLoading: isLoadingCooldown } = useProxyAndCooldown();

// cooldownAmount 驱动两处关键逻辑：
// 1. 表单 schema 上限（resolver 每次 formattedInfo 变化时重新计算）
resolver: zodResolver(getFormSchema(formattedInfo))

// 2. AmountInput 的 max 值
const formattedMaxBalance = formatMaxBalance(formattedInfo?.cooldownAmount, DEFAULT_DECIMAL);

// 3. isLoadingCooldown 控制骨架屏
{isLoadingCooldown && <VaultClaimSkeleton />}
```

### useCallForPermit（vault/modals/funding/_hooks/useCallForPermit.ts）

初始化时传入固定地址：
```typescript
const { createBridgeCallFor } = useCallForPermit({
  callForPermitAddress: VAULT_CALL_FOR_PERMIT_ADDRESS,
  callerAddress: VAULT_CALLER_ADDRESS,
  tokenAddress: VSMAG7_TOKEN_ADDRESS,  // sMAG7 代币地址
});
```

---

## 文件结构

```
src/pages/vault/components/modals/funding/claim/
├── index.tsx              # Claim 主组件（193行）
├── VaultClaimButton.tsx   # 三态按钮组件（138行）
└── schema.ts              # Zod 表单校验 + MINIMUM_USDC_CLAIM_AMOUNT

相关文件：
src/hooks/useProxyAndCooldown.ts          # 代理地址 + cooldown 数据
src/hooks/useProxyAddress.ts              # 代理地址查询
src/hooks/useCooldownInfos.ts             # cooldown 可领取量
src/hooks/useCooldown.ts                  # 全局 cooldown 时长
src/pages/vault/components/modals/funding/_hooks/useCallForPermit.ts  # 链上合约调用
src/pages/vault/components/modals/funding/_components/VaultClaimSkeleton.tsx  # 加载骨架屏
```

---

## 关键设计决策

**为什么 inAmount: 0n？**
合约的 Claim 操作（callForType: 2）不需要输入金额，从 cooldown 池按 `minOutAmount` 取出，所以 inAmount 固定为 0。

**为什么 confirmations: 3？**
Claim 涉及 sMAG7 → MAG7 的代币转换，需要更高确认数保证链上状态最终一致（vs Deposit 用 2 个确认）。

**为什么 8位精度？**
MAG7.ssi/sMAG7 是 8位精度代币（`TOKEN_DECIMAL = 8`），与 USDC（6位）和 ETH（18位）不同。

---

## 术语表

| 术语 | 说明 |
|------|------|
| **sMAG7** | Staked MAG7，质押后获得的代币 |
| **MAG7.ssi** | 领取后得到的目标代币 |
| **cooldownAmount** | 经过冷却期解锁、当前可领取的 sMAG7 数量 |
| **callForType: 2** | Bridge 合约的操作类型，2 = Claim |
| **VSMAG7_TOKEN_ADDRESS** | sMAG7 代币合约地址（Value Chain） |
| **proxyAddress** | 用户的代理合约地址，cooldown 信息基于此地址查询 |
| **createBridgeCallFor** | 发起链上 Claim 交易的方法 |

---

## 更新记录

### 2026-03-29: 初始版本

初始文档，通过 /k/context learn 从代码自动生成
