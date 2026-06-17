# 移除 Stake 页面地区限制

**日期**: 2026-03-26

## 变更内容

从 `StakingHero.tsx` 移除所有 `RegionRestrictWrapper` 包裹。

## 涉及文件

- `src/pages/stake/StakingHero.tsx`

## 移除的限制位置

| 原位置 | 包裹元素 |
|--------|----------|
| 移除 | Get SOSO to Stake 按钮 |
| 移除 | Get SOSO 按钮 |
| 移除 | Deposit into ValueChain 按钮（2处） |

## 变更原因

1. **Stake 操作使用用户已有资产**：属于允许操作，不需要地区限制
2. **Deposit into ValueChain 使用锁定弹窗**：弹窗内已锁定 coin/chain 选择，不需要额外限制

## 关联变更

- 同日：`DepositStepByStep.tsx` 新增 `lockedCoin`/`lockedChain` 功能，支持锁定充值选项
