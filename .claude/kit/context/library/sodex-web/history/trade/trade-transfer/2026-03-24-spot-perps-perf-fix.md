# Spot↔Perps 划转性能优化

**日期**: 2026-03-24 | **类型**: perf | **范围**: trade-transfer

---

## 变更概述

修复 Spot↔Perps 划转等待时间过长的问题，从 ~17 秒优化到 ~1 秒。

---

## 核心变更

### 1. 新增 waitForChainBalance 参数

**文件**: `src/models/chainAsset.ts`

`checkBalancesModified` 函数新增第三个参数 `waitForChainBalance`（默认 `true`），用于控制是否等待 EVM 链上余额确认。

```typescript
checkBalancesModified = (times = 20, interval = 2000, waitForChainBalance = true) => {
  // ...
  if (!isEqual(newBalances, prevBalances)) {
    if (waitForChainBalance) {
      await this.getBalances(true);  // 仅当需要时才等待 EVM
    }
    resolve(true);
  }
};
```

### 2. Spot↔Perps 跳过 EVM 等待

**文件**: `src/components_tw/modals/spot/transfer/index.tsx`

Spot↔Perps 是纯链下账户划转，EVM 余额不会变化，因此传入 `waitForChainBalance: false`。

```typescript
await chainAsset.checkBalancesModified(loopCount, 2000, !isSpotAndFuturesTransfer);
```

---

## 问题根因

2026-02-13 修复 Spot→Funding SOSO 转账后 EVM 余额不即时更新问题时，在 `checkBalancesModified` 中添加了 `getBalances(true)` 轮询等待 EVM 确认。但该修复没有区分路径，导致 Spot↔Perps 也会无意义地轮询 EVM（10 轮 × ~1.7s = ~17s）。

---

## 文件变更列表

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `src/models/chainAsset.ts` | 修改 | 新增 `waitForChainBalance` 参数 |
| `src/components_tw/modals/spot/transfer/index.tsx` | 修改 | Spot↔Perps 传 `false` |

---

## 测试覆盖

| 路径 | 修复前 | 修复后 | 状态 |
|------|--------|--------|------|
| Funding → Spot | ~5s | ~5s | ✅ 不变 |
| Spot → Funding | ~3s | ~3s | ✅ 不变 |
| Spot → Perps | ~17s | ~0.9s | ✅ 优化 |
| Perps → Spot | ~17s | ~0.5s | ✅ 优化 |

---

## 追加变更：统一 300ms 等待

### 变更说明

1. **sleep 时间调整**：500ms → 300ms
2. **条件统一**：从 `transferData.to === "Perps"` 改为 `isSpotAndFuturesTransfer`，覆盖双向路径

### 变更代码

```typescript
// Spot↔Perps 互转，等待后端数据同步后再查询余额
if (isSpotAndFuturesTransfer) {
  await sleep(300);
}
```

### 变更原因

- 原逻辑仅对 Spot→Perps 添加 500ms 等待
- 实际测试发现 Perps→Spot 也需要等待后端同步
- 使用 `isSpotAndFuturesTransfer` 条件更简洁，且两个方向逻辑一致

---

## 追加变更：两次检测机制

### 变更说明

封装 `waitForSpotPerpsSync` 函数，替代固定 300ms 等待，增加重试机制：

1. **第一次 300ms**：覆盖 ~90% 正常情况
2. **第二次 900ms**：兜底极端延迟
3. **智能退出**：检测到余额变化立即返回，避免多余请求

### 变更代码

```typescript
const waitForSpotPerpsSync = async () => {
  const intervals = [300, 900];
  for (const interval of intervals) {
    await sleep(interval);
    const changed = await chainAsset.checkBalancesModified(1, 0, false);
    if (changed) return;
  }
};
```

### 变更原因

- 固定 300ms 无法保证后端一定同步完成
- 增加重试机制，覆盖极端延迟场景
- `checkBalancesModified` 内部会刷新数据，即使返回 false 数据也是最新的

---

## 关联文档

- **Reference**: `.cursor/kit/context/library/sodex-web/reference/trade/trade-transfer-guide.md`
