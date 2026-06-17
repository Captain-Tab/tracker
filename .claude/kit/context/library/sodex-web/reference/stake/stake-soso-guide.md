# Stake SOSO 功能指南

## 🎯 功能概述

StakeSoso 是 SOSO 质押弹窗组件，用户可以质押 SOSO 代币获得 sSOSO，同时提升 SSI Boost 系数（最高 11x）。

### 核心特性

1. **双来源余额**: 支持 ValueChain EVM 余额 + Spot 账户余额（自动划转）
2. **Boost 机制**: 质押金额 / SSI 总资产 × 100，最高 +1000%（11x）
3. **Trading Fee Discount**: 内部调用 `useStakeData()` 获取 yourStaked，任意入口打开弹窗都能正确计算折扣（0%-40%）
4. **精度安全**: 使用 BigInt 计算避免浮点数精度问题
5. **固定手续费**: 0.001 SOSO Gas 费用
6. **数据复用**: 通过 ahooks `cacheKey` 共享缓存，避免重复请求

---

## 🏗️ 架构概览

### 组件结构

```
StakeSoso.tsx (主组件)
    ├── 输入界面
    │   ├── My Total SSI Value (SSI 总资产)
    │   ├── Boost coefficient (Boost 系数展示)
    │   ├── MustToKnow (展开/折叠说明)
    │   └── Amount Input (金额输入 + Max)
    │
    └── StakeReview.tsx (Review 界面)
        └── ProcessIndicator (进度指示器)
            ├── approving (钱包批准)
            ├── confirming (确认交易)
            └── proceeding (链上执行)
```

### 状态流转

```
用户输入金额
    ↓
handleStake() ← 重入保护 (isStakingRef)
    ↓
┌─────────────────────────────────────────┐
│  Step 1: 网络切换                        │
│  handleAddNetwork() → ValueChain        │
└─────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────┐
│  Step 2: 划转（如需要）                  │
│  if (inputAmount > evmBalance)          │
│      handleTransfer() → Spot → EVM      │
└─────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────┐
│  Step 3: 质押交易                        │
│  stakeValueChainSoso(stakeWei)          │
│      → waitForTransactionReceipt        │
└─────────────────────────────────────────┘
    ↓
成功/失败 → 弹窗 → 刷新余额
```

---

## 📋 关键实现

### 1. 余额计算（BigInt 精度）

```typescript
// 余额 = ValueChain 余额 + Spot 可用余额（截断到 4 位小数）
const balance = useMemo(() => {
  try {
    const valueChainWei = valueChainSosoBalance?.formatted
      ? parseUnits(valueChainSosoBalance.formatted, 18)
      : 0n;
    const spotWei = spotSosoBalance ? parseUnits(spotSosoBalance, 18) : 0n;
    
    // Spot 余额截断到 4 位（划转 API 最小精度限制）
    const spotUsableWei = (spotWei / DECIMALS_4_WEI) * DECIMALS_4_WEI;
    const totalWei = valueChainWei + spotUsableWei;
    // ... 格式化输出
  } catch (error) {
    // 回退到浮点数计算
  }
}, [valueChainSosoBalance, spotSosoBalance]);
```

**关键点**:
- `DECIMALS_4_WEI = 10n ** 14n`（18 - 4 = 14 位）
- Spot 余额 < 0.0001 不计入（API 最小精度）
- 使用 `removeTrailingZeros()` 去除末尾零

### 2. 划转逻辑

```typescript
const handleTransfer = async (
  amountWei: bigint,
  valueChainWei: bigint,
): Promise<bigint | null> => {
  const transferAmountRawWei = amountWei - valueChainWei;
  
  // 不需要划转
  if (transferAmountRawWei <= 0n) return valueChainWei;
  
  // 金额太小跳过（< 0.0001）
  if (transferAmountRawWei < DECIMALS_4_WEI) return valueChainWei;
  
  // 向上取整到 4 位小数
  const transferCeilWei = ((transferAmountRawWei + DECIMALS_4_WEI - 1n) / DECIMALS_4_WEI) * DECIMALS_4_WEI;
  
  // 执行划转
  const transferSuccess = await transferSoso({ amount: transferAmountStr });
  
  // 轮询等待余额更新（最多 10 次 × 1 秒）
  for (let attempt = 0; attempt < BALANCE_POLL_MAX_ATTEMPTS; attempt++) {
    const { data: polledBalance } = await refetchValueChainBalance();
    if (polledBalance >= expectedMinWei) break;
    await sleep(BALANCE_POLL_INTERVAL_MS);
  }
  
  return actualValueChainWei;
};
```

**关键点**:
- 划转金额向上取整（避免残留）
- 轮询确认余额更新后再质押
- 超时中止并提示用户重试

### 3. 重入保护

```typescript
// 使用 useRef 而非 useState，确保同步阻塞
const isStakingRef = useRef(false);

const handleStake = async () => {
  if (isStakingRef.current) return;  // 同步检查
  isStakingRef.current = true;       // 立即锁定
  
  try {
    // ... 质押逻辑
  } finally {
    isStakingRef.current = false;    // 释放锁
  }
};
```

**为什么用 useRef**:
- `useState` 异步更新，存在时序问题
- `useRef` 同步修改，立即生效

### 4. Boost 系数计算

```typescript
// boostPercent = stakeUsd / totalSsiUsd × 100，向下取整，[0, 1000]
const boostPercent = useMemo(() => {
  const total = Number(totalSsiUsd);
  if (!Number.isFinite(stakeUsd) || stakeUsd <= 0) return 0;
  if (!Number.isFinite(total) || total <= 0) return 0;
  const raw = Math.floor((stakeUsd / total) * 100);
  return Math.max(0, Math.min(1000, raw));
}, [stakeUsd, totalSsiUsd]);

// boost = 1 + boostPercent/100，显示为 "1.00x" ~ "11.00x"
const boost = `${(1 + boostPercent / 100).toFixed(2)}x`;
```

### 5. Trading Fee Discount 计算

```typescript
// StakeSoso.tsx 内部获取 yourStaked（任意入口都能正确显示）
const { raw: stakeDataRaw } = useStakeData();
const { discount } = useStakingDiscount(stakeDataRaw.yourStaked, amount);

// src/pages/stake/hooks/useStakingDiscount.ts
export function useStakingDiscount(
  yourStaked: string,   // 已质押数量（从 useStakeData 获取）
  inputAmount: string   // 用户输入数量
): UseStakingDiscountResult {
  return useMemo(() => {
    const staked = parseFloat(yourStaked) || 0;
    const input = parseFloat(inputAmount) || 0;
    const total = staked + input;
    
    const tierInfo = getStakingTierByAmount(total);
    
    return {
      discount: tierInfo.discount,  // "0%", "5%", "10%", etc.
      tier: tierInfo.tier,          // 0-6
    };
  }, [yourStaked, inputAmount]);
}
```

**折扣等级配置** (`src/config/feeTiers.ts`):

| Tier | 阈值 | 折扣 |
|------|------|------|
| 0 | 0 | 0% |
| 1 | ≥30 | 5% |
| 2 | ≥300 | 10% |
| 3 | ≥3,000 | 15% |
| 4 | ≥30,000 | 20% |
| 5 | ≥300,000 | 30% |
| 6 | ≥1,500,000 | 40% |

### 6. 组件卸载保护

```typescript
const isMountedRef = useRef(true);

useEffect(() => {
  isMountedRef.current = true;
  return () => { isMountedRef.current = false; };
}, []);

// 在异步回调中检查
setTimeout(() => {
  if (!isMountedRef.current) return;  // 已卸载，跳过
  // ... 执行操作
}, 100);
```

### 7. Enable Trading 绕过逻辑

```typescript
// 没有 user.id 但 EVM 有余额时，绕过 needsRefresh 检查
const shouldBypassNeedsRefresh = !user.id && hasEvmSosoBalance;

if (needsRefresh && !shouldBypassNeedsRefresh) {
  await handleEnableTrading();
  return;
}
```

**场景**: 用户未登录但 EVM 钱包有 SOSO，允许直接质押

---

## 📁 文件结构

```
src/components_tw/modals/stakeSoso/
├── StakeSoso.tsx              # 主组件（输入界面 + 逻辑）
├── StakeSosoSkeleton.tsx      # 加载骨架屏
├── StakeReview.tsx            # Review 界面（进度展示）
├── StakeSuccess.tsx           # 成功弹窗（动态文案：boost + discount）
├── MustToKnow.tsx             # 必须了解信息（展开/折叠）
└── index.ts                   # 弹窗创建函数
    ├── createStakeSosoModal   # 主弹窗（接收 yourStaked prop）
    ├── createStakeSuccessModal # 成功弹窗（接收 boost + discount）
    └── createStakeFailedModal  # 失败弹窗

相关 Hooks:
├── src/pages/stake/hooks/useStakingDiscount.ts  # Trading Fee Discount 计算
├── src/pages/stake/hooks/useStakeData.ts        # 质押数据（提供 yourStaked）

相关工具函数:
├── src/utils/web3/valueChainStake.ts  # 质押合约调用
├── src/config/feeTiers.ts             # 等级配置 + getStakingTierByAmount()
├── src/hooks/useSosoTransfer.ts       # Spot → EVM 划转
├── src/hooks/useEnableTrading.ts      # Enable Trading
└── src/hooks/useAddNetwork.ts         # 网络切换
```

---

## 🎨 UI 结构

### 输入界面

```
┌─────────────────────────────────────┐
│  Stake SOSO                         │
│                                     │
│  ┌─────────────────────────────┐   │
│  │ My Total SSI Value    $500  │   │  ← SSI 总资产
│  │               Buy MAG7 SSI ↗│   │
│  └─────────────────────────────┘   │
│                                     │
│  ┌─────────────────────────────┐   │
│  │ ✨ Boost coefficient  5.00x │   │  ← Boost 系数
│  │                       +400% │   │
│  │ ─────────────────────────── │   │
│  │ 🏷️ Trading Fee Discount  5%│   │  ← 始终显示
│  │ ─────────────────────────── │   │
│  │ ▼ Must to know              │   │  ← 可展开说明
│  └─────────────────────────────┘   │
│                                     │
│  ┌─────────────────────────────┐   │
│  │ Amount (SOSO)               │   │
│  │ [1000____________]          │   │  ← 金额输入
│  │ ~$xxx                       │   │
│  │ ─────────────────────────── │   │
│  │ Balance: 1500.5 [Max]       │   │  ← 余额 + Max
│  └─────────────────────────────┘   │
│                                     │
│  Estimated gas fees: <0.001 SOSO   │
│  You receive: 999.999 sSOSO        │
│                                     │
│  [████████ Stake ████████]         │  ← 主按钮
│  [  Unstake/Withdraw on SSI ↗  ]   │  ← 次要按钮
└─────────────────────────────────────┘
```

### Review 界面

```
┌─────────────────────────────────────┐
│  ○ Approving...                     │  ← 当前步骤高亮
│  ○ Confirming                       │
│  ○ Proceeding                       │
│                                     │
│  Deposit: 1000 SOSO                 │
│  Receive: 999.999 sSOSO             │
└─────────────────────────────────────┘
```

---

## 🔑 关键配置

### 常量定义

| 常量 | 值 | 说明 |
|---|---|---|
| `FEE_WEI` | `parseUnits("0.001", 18)` | 固定 Gas 费用 |
| `BALANCE_POLL_MAX_ATTEMPTS` | 10 | 余额轮询最大次数 |
| `BALANCE_POLL_INTERVAL_MS` | 1000 | 轮询间隔（毫秒）|
| `DECIMALS_4_WEI` | `10n ** 14n` | 4 位小数精度单位 |

### 按钮状态逻辑

| 条件 | 按钮文案 | 禁用状态 |
|---|---|---|
| 余额 = 0 | "Insufficient Balance" | ✅ 禁用 |
| needsRefresh & 有余额 | "Enable Staking" | ❌ 可用 |
| 输入 > 余额 | "Insufficient Balance" | ✅ 禁用 |
| 输入 ≤ 0.001 | "Stake" | ✅ 禁用（扣费后无实际质押）|
| 正常 | "Stake" | ❌ 可用 |

---

## 🎓 术语表

| 术语 | 说明 |
|---|---|
| **SOSO** | SoSoValue 平台代币 |
| **sSOSO** | 质押后的 SOSO 凭证代币 |
| **ValueChain** | SoDEX 的 Layer2 网络 |
| **Spot 账户** | 现货交易账户 |
| **EVM-Funding** | 链上账户（EVM 兼容）|
| **SSI** | SoSoValue Index（指数资产）|
| **Boost** | SSI 空投倍数加成 |
| **划转 (Transfer)** | Spot → EVM-Funding 资金转移 |
| **Enable Trading** | 签名创建 SoDEX 账户 |

---

## 📝 注意事项

### 1. 弹窗打开时的状态重置

```typescript
useEffect(() => {
  if (modal.visible) {
    hasSetDefaultAmountRef.current = false;  // 重置标志
    setAmount("0");
    setValueChainBalanceRefreshed(false);
    refetchValueChainBalance().then(() => {
      setValueChainBalanceRefreshed(true);
    });
  }
}, [modal.visible, refetchValueChainBalance]);
```

每次打开弹窗都会刷新余额并重新填入 Max。

### 2. 默认金额填入时序

必须等待以下条件全部满足：
1. ValueChain 余额加载完成
2. ValueChain 余额刷新完成（弹窗打开时触发）
3. Spot 余额刷新完成（如有 user.id）
4. 未设置过默认金额

### 3. 划转后实际质押金额

如果划转金额向上取整后 > 用户输入金额，使用实际 EVM 余额质押：

```typescript
if (actualBalanceWei > inputAmountWei) {
  stakeAmountWei = actualBalanceWei;
  setActualStakeAmountWei(actualBalanceWei);
}
```

避免 EVM 上残留少量 SOSO。

### 4. useStakeData 缓存共享

StakeSoso 组件内部调用 `useStakeData()` 获取 yourStaked：

```typescript
const { raw: stakeDataRaw } = useStakeData();
const { discount } = useStakingDiscount(stakeDataRaw.yourStaked, amount);
```

**缓存机制**:
- 使用 ahooks `cacheKey: stake:yourStaked:${address}` 共享缓存
- `/stake` 页面已加载时，弹窗直接使用缓存，0 额外请求
- 其他入口（spot/asset、StakeFailed、ClaimSuccess、banner）首次打开会请求一次
- 未登录时返回 `"0"`，discount 显示 0%

---

## 📅 更新记录

### 2026-03-18: 全局 Trading Fee Discount 修复

- 移除 `yourStaked` props，改为组件内部调用 `useStakeData()` 获取
- 任意入口（spot/asset、StakeFailed、ClaimSuccess、banner）打开弹窗都能正确显示 discount
- 通过 ahooks `cacheKey` 共享缓存，`/stake` 页面已加载时无额外请求
- 新增 `type StakeSosoProps = InjectModalProps`（移除 yourStaked 属性）

### 2026-03-14: Trading Fee Discount 功能

- 新增 `useStakingDiscount` hook：根据 `yourStaked + inputAmount` 计算折扣等级
- StakeSoso 弹窗新增 Trading Fee Discount 显示区域（始终显示）
- StakeSuccess 弹窗动态文案：0% 只显示 boost，>0% 显示 boost + discount
- 新增 `getStakingTierByAmount()` 函数（`src/config/feeTiers.ts`）
- 国际化：新增 `trading_fee_discount_tooltip`、`congratulation_you_have_got_boost_and_discount`
- 移除 `showDiscount` 条件判断，Trading Fee Discount 始终可见

### 2025-12-29: 初始版本

- 实现 Stake SOSO 弹窗基础功能
- 支持 ValueChain + Spot 双余额
- Boost 系数计算与展示

---

最后更新: 2026-03-18
