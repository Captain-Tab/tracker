# Transfer SOSO EVM 余额即时更新修复

## 核心需求

**问题**：SOSO 从 Spot Transfer 到 Funding(EVM) 后，UI 中展开的 EVM 余额没有立即更新，需要刷新页面才能看到新余额。

**目标**：Transfer 成功后，EVM 余额在 UI 中即时更新。

## 核心组件

| 组件 | 路径 | 作用 |
|------|------|------|
| Transfer Modal | `src/components_tw/modals/spot/transfer/index.tsx` | 触发 Transfer 操作 |
| chainAsset Store | `src/models/chainAsset.ts` | 管理链上资产余额 |

## 核心流程图

```
用户在 Transfer Modal 执行 Spot → Funding Transfer
    ↓
executeTransfer() 调用 transferAsset API
    ↓
API 返回成功 (code: 0)
    ↓
transferSuccessHandler() 被调用
    ↓
updateBalance() 执行
    ↓
chainAsset.checkBalancesModified() 开始轮询
    ↓
╔═══════════════════════════════════════════════════════════╗
║  checkBalancesModified 轮询循环                            ║
║  1. 检查 Spot/Futures 余额是否变化                         ║
║  2. 检测到变化后调用 getBalances(true)                     ║
║     └─ 🔑 关键修复：轮询链上 EVM 余额直到更新               ║
╚═══════════════════════════════════════════════════════════╝
    ↓
MobX observable balances 更新
    ↓
UI 自动响应更新（MobX reaction）
    ↓
✅ UI 显示最新 EVM 余额
```

## 根本原因

`checkBalancesModified` 检测到 Spot/Futures 余额变化后，调用 `getBalances()` 时没有传入 `true` 参数，导致没有等待链上 EVM 余额确认就返回了。

## 修复方案

**修改 chainAsset.ts 第 278 行**：

```tsx
// 修复前
await this.getBalances();

// 修复后
await this.getBalances(true);  // 🔑 true 表示轮询等待链上确认
```

`getBalances(true)` 会循环检查链上余额，直到检测到变化或超时，确保 EVM 余额已更新后再返回。

## 修改文件清单

| 文件 | 行号 | 修改内容 |
|------|------|----------|
| `src/models/chainAsset.ts` | 278 | `getBalances()` → `getBalances(true)` |

## 更新记录

- 2026-02-13 修复 Transfer SOSO 后 EVM 余额不即时更新问题
