# 统一 Base Chain 桥接逻辑（toClob=true）

## 核心需求

**问题：** Base Chain 桥接 sMAG7 时使用 `toClob=false`，资金直接到 EVM-Funding，但后续 Value Chain 流程需要从 Spot 开始，导致代码逻辑分支复杂。

**目标：** 统一所有资金都走 Spot 账户，简化代码，并保证余额查询逻辑一致。

---

## 解决方案

### 统一规则

```typescript
// useBaseChainDeposit.ts Line 356
// 统一将资金转入 Spot 账户（CLOB 系统）
const toClob = true;  // MAG7 和 sMAG7 都走 Spot
```

### 修改前后对比

| 币种 | 修改前 | 修改后 |
|---|---|---|
| **MAG7** | toClob=true → Spot | toClob=true → Spot（无变化）|
| **sMAG7** | toClob=false → EVM-Funding | toClob=true → Spot（**新增 Transfer 步骤**）|

### 资金流向变化

**MAG7（无变化）：**
```
Base Chain MAG7 → 桥接 → Value Chain Spot → Transfer → EVM-Funding → Stake → Vault
```

**sMAG7（新增 Transfer 步骤）：**
```
修改前：Base Chain sMAG7 → 桥接 → EVM-Funding → Vault（2步）
修改后：Base Chain sMAG7 → 桥接 → Spot → Transfer → EVM-Funding → Vault（3步）
```

### Value Chain From 的统一处理

```typescript
// useVaultDeposit.ts Line 247-265
const valueChainFrom = useMemo(() => {
  let result = from;

  if (config.needsBaseChain) {
    // 从 Base Chain 来的，统一将资金转入 Spot 账户（toClob=true）
    result = DepositFromEnum.SPOT;
  }

  return result;
}, [config.needsBaseChain, from]);
```

---

## 核心组件列表

| 文件 | 修改内容 |
|------|----------|
| `useBaseChainDeposit.ts` L356 | toClob 改为固定 true |
| `useVaultDeposit.ts` L247-265 | valueChainFrom 统一为 Spot（needsBaseChain 时）|

---

## 影响

- ✅ MAG7 流程无变化
- ⚠️ sMAG7 流程增加 1 个 Transfer 步骤（从 2 步变为 3 步）
- ✅ 代码逻辑更简洁统一，消除 toClob 条件分支
- ✅ 余额查询统一查询 Spot 账户，逻辑一致

---

## 更新记录

- 2025-11-07 统一 Base Chain 桥接逻辑
  - Base Chain 桥接统一 toClob=true，所有资金都到 Spot
  - sMAG7 Value Chain 流程新增 Transfer 步骤（Spot → EVM-Funding）
  - 余额同步逻辑简化，统一查询 Spot 账户
  - 移除 isStake 条件判断，代码更简洁
