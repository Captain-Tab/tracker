# 邀请空投 + Claim 功能 + 多项优化

**日期**: 2026-04-08 | **类型**: feat | **范围**: user

---

## 变更概述

新增 Claim Rebate 功能（链上领取返佣），重构数据获取架构（5 个独立数据源），优化鉴权弹窗和 UI 状态映射，增加区域受限支持。

---

## 核心变更

### 1. Claim Rebate 功能

**文件**: `src/pages/referrals/index.tsx`, `src/pages/referrals/components/NewReferralHeader.tsx`

- 新增链上合约读取（`ReferralClaimAbi.getClaimedAmount`）获取已领取金额
- 前端计算 `claimableRewards = earnedRewardsFromApi - onChainClaimedRewards`
- Header 新增 Claim Rebate 按钮，>= 1 USDC 可领取，打开 `createClaimRewardsModal`

### 2. 数据类型和数据获取重构

**文件**: `src/pages/referrals/index.tsx`

- 新增 `ReferralStats` / `ClaimHistoryItem` / `ClaimHistoryData` / `ReferralListItem` / `ReferralListData` 类型
- 5 个独立数据获取函数：`fetchReferralData` / `fetchClaimHistory` / `fetchReferralList` / `fetchOnChainClaimed` / `fetchLeaderboardData`
- 分页独立更新，不触发全屏骨架屏

### 3. 鉴权弹窗改用通用组件

**文件**: `src/pages/referrals/index.tsx`

- `openAuthModal` 改用 `createAuthStepsModal.open()` 替代直接使用 `ReferralConnectWalletStepsModal`

### 4. 区域受限支持

**文件**: `src/pages/referrals/components/NewReferralHeader.tsx`

- Invite User / Claim Rebate / Trade More / Deposit More 按钮包裹 `RegionRestrictWrapper`
- 根据 `rewards.hasReferralLink` 区分是否需要限制

### 5. usePageAuth enableTrading 路径

**文件**: `src/hooks/usePageAuth.ts`

- 有 userid 的用户走 `enableTrading` 流程，无 userid 走完整 auth token 签名
- 新增 `authTokenRemoved` 事件监听 + localStorage 跨 tab 同步

### 6. 移动端钱包签名优化

**文件**: `src/pages/referrals/components/ReferralConnectWalletStepsModal.tsx`

- 新增 `StepStatus` 类型、nonce 预获取、token 有效性预检查
- 签名流程增加 `validateReferralAuthMessage` 安全验证

---

## 文件变更列表

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `src/pages/referrals/index.tsx` | 修改 | 新增类型定义、Claim 数据获取、链上合约交互 |
| `src/pages/referrals/components/NewReferralHeader.tsx` | 修改 | Claim 按钮、区域受限、Props 扩展 |
| `src/pages/referrals/components/ReferralConnectWalletStepsModal.tsx` | 修改 | 签名优化、nonce 预获取 |
| `src/hooks/usePageAuth.ts` | 修改 | enableTrading 路径、事件监听扩展 |

---

## 关联文档

- **Reference**: `.claude/kit/context/library/sodex-web/reference/user/user-auth-referrals-guide.md`
