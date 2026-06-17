# sMAG7 充值后 SLP 余额不更新问题修复

## 核心需求

**问题描述：**
- Base 链选择 MAG7 充值后，SLP.tsx 余额正常更新
- Base 链选择 sMAG7 充值后，SLP.tsx 余额不更新，需要手动刷新页面

---

## 根本原因

- `confirm_proceeding` 中 `executeConfirmPermitPayload` 返回后直接触发成功事件
- 没有等待链上确认（`waitForTransactionReceipt`），与 stake/unstake/claim 流程不一致
- sMAG7 流程更快（不需要 stake），链上可能还没确认就触发了 `VAULT_DEPOSIT_SUCCESS` 事件
- `SLP.tsx` 收到成功事件时，链上交易还未确认，余额查询返回旧值

---

## 解决方案

### 修复后的 confirm_proceeding 流程

```typescript
// useValueChainDeposit.tsx Line 850-865
case 'confirm_proceeding': {
  // 调用后端 API
  await executeConfirmPermitPayload(payload);

  // ✅ 新增：等待链上确认（3个区块）
  await waitForTransactionReceipt(wagmiConfig, {
    hash: txHash,
    confirmations: 3,
  });

  // 触发成功事件（此时链上已确认）
  eventBus.emit(VAULT_DEPOSIT_SUCCESS);
  onComplete();
}
```

### SLP.tsx 监听成功事件

```typescript
// SLP.tsx Line 248-265
useEffect(() => {
  const handleVaultDepositSuccess = () => {
    // 刷新 SLP 相关余额
    vault.updateMag7RelatedBalance();
  };

  eventBus.on(VAULT_DEPOSIT_SUCCESS, handleVaultDepositSuccess);
  return () => {
    eventBus.off(VAULT_DEPOSIT_SUCCESS, handleVaultDepositSuccess);
  };
}, [vault]);
```

---

## 核心组件列表

| 文件 | 修改内容 |
|------|----------|
| `useValueChainDeposit.tsx` L850-865 | 添加 waitForTransactionReceipt（等待3个区块确认）|
| `SLP.tsx` L248-265 | 添加 VAULT_DEPOSIT_SUCCESS 事件监听 |
| `useValueChainDeposit.tsx` | 移除多余的 vault.updateMag7RelatedBalance() 调用 |

---

## 修改前后对比

| 场景 | 修改前 | 修改后 |
|------|--------|--------|
| MAG7 充值后余额 | 正常更新（stake 需要等待）| 正常更新（无变化）|
| sMAG7 充值后余额 | 不更新（需手动刷新）| ✅ 自动更新（等待链上确认后）|
| 链上确认等待 | 无 | ✅ 等待 3 个区块确认 |

---

## 更新记录

- 2025-01-07 修复 sMAG7 充值后 SLP 余额不更新
  - useValueChainDeposit.tsx 添加 waitForTransactionReceipt 等待链上确认
  - SLP.tsx 添加 VAULT_DEPOSIT_SUCCESS 事件监听刷新余额
  - 移除多余的 vault.updateMag7RelatedBalance() 调用（由事件驱动取代）
