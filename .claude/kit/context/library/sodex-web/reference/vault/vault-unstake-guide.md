# Vault Unstake 智能转账流程

## 架构概览

Unstake 模块负责将用户的 sMAG7 代币赎回为 MAG7。核心挑战是用户的 sMAG7 可能分布在两个账户：

```
用户 sMAG7 余额分布
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  ┌─────────────────┐        ┌─────────────────┐            │
│  │   Spot 账户      │        │  EVM-Funding    │            │
│  │   (链下余额)     │        │  (链上余额)      │            │
│  │                 │        │                 │            │
│  │   spotAmount    │  ───►  │   evmAmount     │ ───► Unstake│
│  │                 │ 转账   │                 │   (链上操作) │
│  └─────────────────┘        └─────────────────┘            │
│                                                             │
│  totalBalance = spotAmount + evmAmount                      │
└─────────────────────────────────────────────────────────────┘
```

**智能转账逻辑**：
- 用户输入 ≤ evmAmount → 直接 unstake
- 用户输入 > evmAmount → 自动 transfer (Spot→EVM) + unstake

---

## 核心逻辑

### useUnstakeWithTransfer Hook

位置: `_hooks/useUnstakeWithTransfer.ts`

```typescript
// L49-338: 主 hook
export const useUnstakeWithTransfer = (): UseUnstakeWithTransferReturn => {
  // 0. 提取具体字段作为依赖（确保 MobX observable 变化时正确触发更新）
  const evmSmag7 = valueChain.balances?.["EVM-Funding"]?.smag7;
  const spotSmag7 = valueChain.balances?.["Spot"]?.smag7;

  // 1. 计算总余额（向下取整避免精度问题）
  const totalBalance = useMemo<TotalBalance>(() => {
    const evmAmount = evmSmag7 || "0";
    const spotAmount = spotSmag7 || "0";
    const totalRaw = calculate(evmAmount).add(spotAmount).done();
    const total = floorToDecimal(totalRaw, { decimal: DEFAULT_DECIMAL, trimTrailingZeros: true });
    return { amount: total, evmAmount, spotAmount };
  }, [evmSmag7, spotSmag7]);  // 精确依赖，非整体对象

  // 2. 余额快照（防止 transfer 过程中 UI 抖动）
  const [snapshotBalance, setSnapshotBalance] = useState<string | null>(null);
  const displayBalance = useMemo<TotalBalance>(() => {
    if (snapshotBalance !== null) {
      return { amount: snapshotBalance, evmAmount: totalBalance.evmAmount, spotAmount: totalBalance.spotAmount };
    }
    return totalBalance;
  }, [snapshotBalance, totalBalance]);

  // 3. 重试机制（带滑点容差，总等待 4.5s）
  const RETRY_INTERVALS = [500, 1000, 3000];
  const MAX_RETRIES = RETRY_INTERVALS.length;  // 动态计算，避免不一致
  
  const executeUnstakeWithRetry = useCallback(async (targetAmount: string) => {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      await sleep(RETRY_INTERVALS[attempt]);  // 每次都等待
      if (attempt > 0) await refreshValueChainBalances();  // 第一次不刷新
      
      const currentEvmBalance = vaultBalance?.valueChainBalances?.["EVM-Funding"]?.smag7 || "0";
      const diff = calculate(targetAmount).sub(currentEvmBalance);
      if (diff.lte("0.0001") && calculate(currentEvmBalance).gt("0")) {
        const actualAmount = calculate(currentEvmBalance).lt(targetAmount) ? currentEvmBalance : targetAmount;
        return await executeUnstake(actualAmount);
      }
    }
    return false;
  }, [refreshValueChainBalances, vaultBalance, executeUnstake]);

  // 4. 主执行函数（滑点容差判断 transfer 必要性）
  const execute = useCallback(async (_inputAmount: string) => {
    setSnapshotBalance(totalBalance.amount);
    const rawEvmAmount = valueChain.balances?.["EVM-Funding"]?.smag7 || "0";
    const transferRaw = calculate(_inputAmount).sub(rawEvmAmount);
    const SLIPPAGE = "0.0001";
    let unstakeAmount = _inputAmount;
    
    if (transferRaw.gt(SLIPPAGE)) {
      // 差值 > 滑点，需要 transfer
      const transferAmount = floorToDecimal(transferRaw.done(), { decimal: TOKEN_DECIMAL });
      await executeTransfer(transferAmount);
      transferCompleted = true;
    } else if (transferRaw.gt("0")) {
      // 差值在滑点内，不 transfer，用 EVM 余额 unstake（避免超额）
      unstakeAmount = rawEvmAmount;
    }
    
    const unstakeSuccess = transferCompleted
      ? await executeUnstakeWithRetry(unstakeAmount)
      : await executeUnstake(unstakeAmount);
  }, [...]);
};
```

### 执行流程图

```
用户点击 Unstake
       │
       ▼
┌──────────────────────────────────────┐
│ execute(_inputAmount)                │  L243
│                                      │
│ 0. setSnapshotBalance()             │  L249 (锁定 UI 显示余额)
│                                      │
│ 1. 判断是否需要转账（滑点容差）        │
│    transferRaw = input - rawEvm     │
│    SLIPPAGE = 0.0001                │
│                                      │
│    ├─ transferRaw > SLIPPAGE        │
│    │   → 需要 transfer              │
│    │   → executeTransfer()          │
│    │   → executeUnstakeWithRetry()  │
│    │   ┌─────────────────────────┐  │
│    │   │ 等待: 500/1000/3000ms   │  │
│    │   │ 总计: 4.5s              │  │
│    │   │ 滑点容差: ≤0.0001       │  │
│    │   └─────────────────────────┘  │
│    │                                 │
│    ├─ 0 < transferRaw ≤ SLIPPAGE    │
│    │   → 不 transfer                │
│    │   → unstakeAmount = rawEvm    │
│    │   → executeUnstake()           │
│    │                                 │
│    └─ transferRaw ≤ 0               │
│        → 直接 executeUnstake()      │
│                                      │
│ 2. finally: setSnapshotBalance(null)│  L320 (恢复实时余额)
└──────────────────────────────────────┘
```

---

## 关键实现

### 1. 精度处理（防止 ERC20InsufficientBalance）

**问题**：直接 `toFixed(4)` 会四舍五入，导致显示余额略大于实际余额。

**解决方案**：

```typescript
// useUnstakeWithTransfer.ts L66-83
// 提取具体字段作为依赖，确保 MobX observable 变化时正确触发更新
const evmSmag7 = valueChain.balances?.["EVM-Funding"]?.smag7;
const spotSmag7 = valueChain.balances?.["Spot"]?.smag7;

// 使用 floorToDecimal 向下取整，而非 toFixed
const totalBalance = useMemo<TotalBalance>(() => {
  const evmAmount = evmSmag7 || "0";
  const spotAmount = spotSmag7 || "0";
  const totalRaw = calculate(evmAmount).add(spotAmount).done();
  const total = floorToDecimal(totalRaw, { 
    decimal: DEFAULT_DECIMAL,      // 4 位小数
    trimTrailingZeros: true 
  }) || "0";
  
  return {
    amount: total,
    evmAmount: floorToDecimal(evmAmount, ...) || "0",
    spotAmount: floorToDecimal(spotAmount, ...) || "0",
  };
}, [evmSmag7, spotSmag7]);  // 精确依赖，非整体对象
```

### 2. Transfer 金额边界处理（统一 calculate 库）

**问题**：当用户输入略大于格式化后的 evmAmount，但实际差值很小时，`floorToDecimal` 可能将 transferAmount 截断为 0，导致 API 报错 "amount must be a positive decimal"。

**解决方案**（已简化，统一用 calculate 库避免 parseFloat 精度问题）：

```typescript
// useUnstakeWithTransfer.ts L259-278
// 使用原始余额计算 transfer 金额
const rawEvmAmount = valueChain.balances?.["EVM-Funding"]?.smag7 || "0";
const transferRaw = calculate(_inputAmount).sub(rawEvmAmount);

// transferRaw > 0 时才需要转账
if (transferRaw.gt("0")) {
  const transferAmount = floorToDecimal(transferRaw.done(), { decimal: DEFAULT_DECIMAL, trimTrailingZeros: true }) || "0";

  // transfer 金额 > 0 时执行转账（使用 calculate 精确判断）
  if (calculate(transferAmount).gt("0")) {
    needTransfer = true;
    await executeTransfer(transferAmount);
    transferCompleted = true;
  }
}
// unstakeAmount 始终使用用户输入金额，不做调整
```

### 3. 链上 Unstake 调用

```typescript
// useUnstakeWithTransfer.ts L149-189
const executeUnstake = useCallback(async (amount: string) => {
  const inAmountBigInt = parseUnits(amount, 8);  // sMAG7 精度 8 位
  
  const res = await createBridgeCallFor({
    chain: "BASE_ETH",
    callForType: 1,           // UNSTAKE
    inCoinSymbol: "sMAG7",
    outCoinSymbol: "MAG7",
    inAmount: inAmountBigInt,
    minOutAmount: 0n,
    toClob: false,
  });
  
  // 等待 3 个确认
  await waitForTransactionReceipt(wagmiConfig, {
    hash: res.txHash,
    confirmations: 3,
  });
}, [createBridgeCallFor]);
```

### 4. 余额快照机制（防止 UI 抖动）

**问题**：transfer 过程中，Spot 余额减少但 EVM 余额同步有延迟，导致 `totalBalance` 重算时显示较低的值。

**解决方案**：

```typescript
// useUnstakeWithTransfer.ts L56-91
const [snapshotBalance, setSnapshotBalance] = useState<string | null>(null);

// 对外暴露的余额：执行期间返回快照值
const displayBalance = useMemo<TotalBalance>(() => {
  if (snapshotBalance !== null) {
    return { amount: snapshotBalance, evmAmount, spotAmount };
  }
  return totalBalance;
}, [snapshotBalance, totalBalance]);

// execute() 中
setSnapshotBalance(totalBalance.amount);  // 开始时快照
try { ... } finally {
  setSnapshotBalance(null);  // 结束时清除
}
```

### 5. 重试机制 + 滑点容差

**问题**：`floorToDecimal` 向下取整导致 transfer 金额略少于所需，EVM 余额可能比目标少 0.0001 左右。

**解决方案**：

```typescript
// useUnstakeWithTransfer.ts L32-34, L209-244
const RETRY_INTERVALS = [500, 1000, 3000];  // 总计 4.5s
const MAX_RETRIES = RETRY_INTERVALS.length; // 动态计算，避免不一致

const executeUnstakeWithRetry = useCallback(async (targetAmount: string) => {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    await sleep(RETRY_INTERVALS[attempt]);  // 每次都等待
    if (attempt > 0) await refreshValueChainBalances();  // 第一次不刷新
    
    const currentEvmBalance = vaultBalance?.valueChainBalances?.["EVM-Funding"]?.smag7 || "0";
    const diff = calculate(targetAmount).sub(currentEvmBalance);
    
    if (diff.lte("0.0001") && calculate(currentEvmBalance).gt("0")) {
      const actualAmount = calculate(currentEvmBalance).lt(targetAmount)
        ? currentEvmBalance : targetAmount;
      return await executeUnstake(actualAmount);
    }
  }
  return false;
}, [refreshValueChainBalances, vaultBalance, executeUnstake]);
```

### 6. 滑点容差判断 transfer 必要性

**问题**：当差值很小（0 < diff ≤ 0.0001）时，执行 transfer 代价高但收益低，且可能因精度截断导致问题。

**解决方案**：

```typescript
// useUnstakeWithTransfer.ts L263-280
const SLIPPAGE = "0.0001";
let unstakeAmount = _inputAmount;

if (transferRaw.gt(SLIPPAGE)) {
  // 差值 > 滑点，需要 transfer
  const transferAmount = floorToDecimal(transferRaw.done(), { decimal: TOKEN_DECIMAL });
  await executeTransfer(transferAmount);
  transferCompleted = true;
} else if (transferRaw.gt("0")) {
  // 差值在滑点内（0 < diff ≤ 0.0001），不 transfer，用 EVM 余额 unstake
  unstakeAmount = rawEvmAmount;  // 避免超额
}
// 差值 ≤ 0，EVM 余额充足，直接用用户输入金额
```

| 场景 | 差值 | 操作 | unstakeAmount |
|------|------|------|---------------|
| EVM 充足 | ≤ 0 | 直接 unstake | 用户输入 |
| 差值很小 | 0 < diff ≤ 0.0001 | 直接 unstake | **EVM 余额** |
| 差值较大 | > 0.0001 | transfer → unstake | 用户输入 |

---

## 文件结构

```
src/pages/vault/components/modals/funding/unstake/
├── _hooks/
│   └── useUnstakeWithTransfer.ts    # 核心逻辑 hook（269行）
├── index.tsx                        # 弹窗 UI 入口（114行）
├── VaultUnstakeButton.tsx           # 按钮组件（143行）
└── schema.ts                        # Zod 表单校验（44行）
```

### 依赖关系

```
index.tsx
    │
    ├── useUnstakeWithTransfer()  → execute, isLoading, totalBalance
    │       │
    │       ├── useCallForPermit()      → createBridgeCallFor (unstake)
    │       ├── useSparkSigner()        → signTransferAssetRequest (transfer)
    │       └── useMag7Balance()        → valueChain.balances
    │
    ├── VaultUnstakeButton
    │       │
    │       ├── useEnableTrading()      → 钱包签名流程
    │       └── useWalletApproveText()  → 签名提示文案
    │
    └── getFormSchema(totalBalance)    → Zod 校验
```

---

## 关键设计决策

### 为什么使用 floorToDecimal 而非 toFixed？

| 方法 | 行为 | 示例 (4位小数) | 风险 |
|------|------|---------------|------|
| `toFixed(4)` | 四舍五入 | 8.19388978 → "8.1939" | ❌ 超出实际余额 |
| `floorToDecimal` | 向下取整 | 8.19388978 → "8.1938" | ✅ 安全 |

### 为什么 transfer 金额使用原始余额计算？

```typescript
// ✅ 正确：使用原始余额
const rawEvmAmount = valueChain.balances?.["EVM-Funding"]?.smag7 || "0";
const transferRaw = calculate(_inputAmount).sub(rawEvmAmount).done();

// ❌ 错误：使用格式化后的余额
const transferRaw = calculate(_inputAmount).sub(totalBalance.evmAmount).done();
```

格式化后的余额可能丢失精度，导致 transfer 金额计算错误。

### 为什么 VaultUnstakeButton 单独抽取？

1. **复用性**：预交易逻辑（钱包连接、白名单、私钥刷新）可被其他 Vault 操作复用
2. **职责分离**：主组件专注表单逻辑，按钮组件专注授权流程
3. **遵循签名规范**：按钮 loading 时显示 `walletApproveText.wallet`

### 为什么使用滑点容差判断 transfer 必要性？

| 方案 | 优点 | 缺点 |
|------|------|------|
| 精确判断 (diff > 0) | 用户不损失任何金额 | 小额 transfer 代价高、可能因截断失败 |
| **滑点容差 (diff > 0.0001)** | 减少不必要的 transfer、更稳定 | 用户最多损失 ~$0.02 |

选择滑点容差方案，因为：
1. **用户无感**：0.0001 约 $0.02，几乎无感知
2. **减少 API 调用**：避免不必要的 transfer
3. **避免超额**：差值小时调整 unstakeAmount 为 EVM 余额，确保不超额

### 为什么新增 TOKEN_DECIMAL 常量？

```typescript
// constant.ts
export const DEFAULT_DECIMAL = 4;   // UI 显示精度
export const TOKEN_DECIMAL = 8;     // token 链上精度
```

- `DEFAULT_DECIMAL (4)`：用于 UI 显示格式化
- `TOKEN_DECIMAL (8)`：用于 transfer 金额计算，避免 UI 精度截断导致小额差额被忽略

---

## 开发修改指南

### 调整最小/最大金额限制

修改 `schema.ts`:

```typescript
// L10: 最小金额
const MINIMUM_USDC_DEPOSIT_AMOUNT = 5;

// L28-39: 最大金额校验使用传入的 vsMag7.amount
```

### 修改 unstake 链调用参数

修改 `useUnstakeWithTransfer.ts` 的 `executeUnstake` 函数 (L124-164)。

### 添加新的错误提示

1. 在 `public/locales/en/vault.json` 添加 key
2. 使用 `/k/translate` 同步其他语言

---

## 术语表

| 术语 | 说明 |
|------|------|
| sMAG7 | Staked MAG7 代币，质押凭证 |
| MAG7 | 基础代币 |
| EVM-Funding | 用户链上钱包账户 |
| Spot | 用户平台内部账户（链下） |
| floorToDecimal | 向下取整到指定小数位的工具函数 |
| createBridgeCallFor | 链上 permit + call 组合调用 |

---

## 更新记录

### 2026-03-25: 滑点容差 + 重试优化

**核心改动**：
- 新增滑点容差机制：差值 > 0.0001 才执行 transfer，差值 <= 0.0001 时直接用 EVM 余额 unstake（避免超额）
- 重试配置优化：`RETRY_INTERVALS = [500, 1000, 3000]`，`MAX_RETRIES = RETRY_INTERVALS.length`（动态计算，总等待 4.5s）
- 新增 `TOKEN_DECIMAL = 8` 常量：用于 transfer 金额计算，避免 UI 精度（4 位）截断

### 2026-03-25: 逻辑简化 + 依赖修复

**核心改动**：
- 简化 needTransfer 判断逻辑，移除重复的 parseFloat 判断，统一使用 calculate 库
- 修复 useMemo 依赖项，提取 `evmSmag7` 和 `spotSmag7` 作为具体字段，确保 MobX observable 变化时正确触发更新
- `unstakeAmount` 始终使用用户输入金额，不再根据边界情况调整

### 2026-03-25: 余额快照 + 重试机制

**核心改动**：
- 新增余额快照机制（`snapshotBalance` + `displayBalance`），防止 transfer 过程中 UI 抖动
- 新增重试机制（`executeUnstakeWithRetry`），带滑点容差 ≤ 0.0001
- 使用 `calculate` 库进行精确比较，避免浮点精度问题
- 移除 `unstake_in_progress` 通知
- 登录态校验、错误提示归因优化

### 2026-03-25: 初始版本

初始文档，通过 /k/context learn 从代码自动生成

**核心改动**：
- 解决用户只能看到 EVM 余额的问题
- 实现智能转账逻辑（Spot → EVM → Unstake）
- 修复精度问题（floorToDecimal 替代 toFixed）
