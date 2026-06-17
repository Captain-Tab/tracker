---
id: slp-decimals-dynamic
tags: [vault, slp, decimals, chain-read]
related_feature: vault-withdraw
severity: high
gate: true
gate_rule: vault 功能涉及 SLP token 的 parseUnits/formatUnits 时,decimals 必须从 `useSlpBalanceQuery` 动态读取,禁止硬编码 VAULT_TOKEN_DECIMAL 或任何常量
trigger: [SLP, sMAG7.SLP, VAULT_TOKEN_DECIMAL, parseUnits, formatUnits, shares, amountWei]
date: 2026-04-23
---

# SLP 合约精度不能硬编码,必须链上动态读

## 问题描述

vault 模块里有 3 种 decimals:
- `SLP_TOKEN_ADDRESS`(sMAG7.SLP 合约):**18**(链上 `decimals()` 返回)
- `VMAG7_TOKEN_ADDRESS`:8
- `VSMAG7_TOKEN_ADDRESS`:8

`VAULT_TOKEN_DECIMAL=8` 常量仅对应 vMAG7/vsMAG7,**不适用 SLP**。

## 典型症状

Withdraw 或 Deposit 时:
- redeem tx 成功但 assets 解析为 0
- 后续 unstake 因 `inAmount=0` 被合约拒绝 `"SoDexTokenCaller: in amount must be greater than 0"`
- 根因:shares = 4e8 而应为 4e18,合约按 4e8 shares(极小)计算 assets → 向下取整为 0

## 避坑

vault feature 里任何涉及 SLP 的数值转换:

```ts
// ❌ 错(硬编码)
parseUnits(amount, VAULT_TOKEN_DECIMAL)  // 8,错

// ✅ 对(动态读)
const slpBalance = useSlpBalanceQuery(address);  // 内部 readContract SLP decimals()
parseUnits(amount, slpBalance.data?.decimals ?? 20);  // fallback 20 作为安全 default
```

实现:
- `buildWithdrawAmountWei(amount, slpDecimals)` 第二参必传
- container 层从 `slpBalance.data.decimals` 透传
- infra 层 `fetchSlpBalance` 同时 `balanceOf + decimals()` 一起读

## 关联

- `src/features/vault/containers/shared/useSlpBalanceQuery.ts`
- `src/features/vault/domain/withdrawPermit.ts:buildWithdrawAmountWei`
- kit/migration/records/chain-call-semantics.md:`chain-call:token-decimals-dynamic-read`(跨迁移方法论版)
