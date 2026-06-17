# Stake 页面小额余额显示优化

**日期**: 2026-03-13 | **类型**: feat | **范围**: stake

---

## 变更概述

优化 Stake 页面的小额余额显示逻辑，新增 `< 0.01` 格式化规则，并调整 "Get SOSO to Stake" 按钮的触发阈值。

---

## 核心变更

### 1. 小额余额格式化函数

**文件**: `src/pages/stake/hooks/useStakeData.ts`

新增 `formatUserBalance` 函数，处理三种显示场景：

```typescript
const SMALL_VALUE_THRESHOLD = 0.01;

function formatUserBalance(value: string, decimals: number = 2): string {
  const num = new BigNumber(value);
  if (num.isNaN() || !num.isFinite() || num.isZero()) {
    return "0";
  }
  if (num.isGreaterThan(0) && num.isLessThan(SMALL_VALUE_THRESHOLD)) {
    return "< 0.01";
  }
  return formatWithCommas(value, decimals);
}
```

### 2. 应用到用户余额字段

**文件**: `src/pages/stake/hooks/useStakeData.ts`

三个字段改用 `formatUserBalance`：

| 字段 | 说明 |
|------|------|
| `availableOnValueChain` | ValueChain 可用余额 |
| `yourStakedOnValueChain` | ValueChain 已质押 |
| `stakedOnBase` | Base 已质押 (sSOSO) |

```typescript
availableOnValueChain: connected
  ? `${formatUserBalance(availableData.total)} SOSO`
  : "-- SOSO",
yourStakedOnValueChain: connected
  ? `${formatUserBalance(yourStakedData.valueChain)} SOSO`
  : "-- SOSO",
stakedOnBase: connected
  ? `${formatUserBalance(yourStakedData.base)} sSOSO`
  : "-- sSOSO",
```

### 3. 低余额按钮触发阈值

**文件**: `src/pages/stake/StakingHero.tsx`

将判断条件从 `=0` 改为 `<0.01`：

```diff
- // 判断 ValueChain 可用余额是否为 0
- const isZeroBalance = new BigNumber(raw.availableOnValueChain).isZero();
+ // 判断 ValueChain 可用余额是否小于 0.01
+ const isLowBalance = new BigNumber(raw.availableOnValueChain).isLessThan(0.01);
```

---

## 显示效果

| 余额值 | 显示结果 | 按钮状态 |
|--------|----------|----------|
| `0` | `0 SOSO` | "Get SOSO to Stake" |
| `0.005` | `< 0.01 SOSO` | "Get SOSO to Stake" |
| `0.01` | `0.01 SOSO` | "Start Staking" + "Get SOSO" |
| `23.96` | `23.96 SOSO` | "Start Staking" + "Get SOSO" |

---

## 设计决策

### 为什么选择 0.01 作为阈值

- 与显示精度保持一致（保留 2 位小数）
- 小于 0.01 的余额在实际操作中无法有效质押
- 统一用户体验：显示 `< 0.01` 而非 `0.00`

### 为什么重命名 isZeroBalance → isLowBalance

- 语义更准确：不再只是判断零余额
- 代码自解释：明确表示"低余额"状态

### Total Staked 为什么不应用此规则

- Total Staked 显示平台总数据，数值不会出现小于 0.01 的情况
- 保持与现有 `formatWithCommas` 格式一致

---

## 文件变更列表

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `src/pages/stake/hooks/useStakeData.ts` | 修改 | 新增 `formatUserBalance` 函数 |
| `src/pages/stake/StakingHero.tsx` | 修改 | `isZeroBalance` → `isLowBalance`，阈值改为 `<0.01` |

---

## 关联文档

- **Reference**: `.cursor/kit/context/library/sodex-web/reference/stake/stake-page-guide.md`
