---
id: vault-decimal-constants-semantics
tags: [vault, constants, decimals, display-precision]
related_feature: vault-withdraw
severity: medium
gate: true
gate_rule: 在 vault 功能里做金额格式化时,先确认用 VAULT_DISPLAY_DECIMAL(2,粗显)还是 VAULT_DEFAULT_DECIMAL(4,输入/Max),不可互换
trigger: [VAULT_DISPLAY_DECIMAL, VAULT_DEFAULT_DECIMAL, formatQuantity, vault, amount, max]
date: 2026-04-23
---

# vault 有两个展示精度常量,语义不同不可混用

## 问题描述

`features/vault/domain/constants.ts` 定义了两个展示精度:

```ts
export const VAULT_DEFAULT_DECIMAL = 4;         // 输入 / Max / 交易精度
export const VAULT_DEFAULT_MINIMUM_DECIMAL = 2; // 最小单位
export const VAULT_DISPLAY_DECIMAL = 2;         // 粗显(dashboard 余额卡)
```

名字相似但语义不同:
- `VAULT_DISPLAY_DECIMAL=2`:余额卡粗显(如 dashboard "25.30 sMAG7.ssi")
- `VAULT_DEFAULT_DECIMAL=4`:输入框 placeholder / Max 按钮 / 交易可输入位数(如 "25.0255")

## 典型症状

Max 按钮显示 `25.02` 而非 `25.0255`(少 2 位),因为误用 `VAULT_DISPLAY_DECIMAL` 做 Max 格式化。用户最大可 withdraw 量被截断。

## 避坑

场景 → 常量对照:

| 场景 | 用哪个常量 |
|------|-----------|
| Dashboard / Availability 卡片粗显余额 | `VAULT_DISPLAY_DECIMAL`(2) |
| Withdraw/Unstake/Claim 输入框 placeholder | `VAULT_DEFAULT_DECIMAL`(4) |
| Max 按钮显示的最大可用值 | `VAULT_DEFAULT_DECIMAL`(4) |
| fee 展示(Fees 行) | `toFixed(2)`(固定 2 位,对齐老项目 calculateFee) |
| You receive / previewRedeem 展示 | `VAULT_DEFAULT_DECIMAL`(4)+ `formatQuantity ROUND_DOWN` |
| cooldown amount(banner 里 "9.04 MAG7.ssi...") | `VAULT_DEFAULT_MINIMUM_DECIMAL`(2) |

## 避坑动作

改金额显示前,先 grep:
```bash
grep -n "VAULT_.*_DECIMAL\|formatQuantity" <file>
```

判断当前场景属于哪类,再选常量。不确定时看老项目对应组件用的是 `DEFAULT_DECIMAL`(4)还是 `DEFAULT_MINIMUM_DECIMAL`(2)。

## 关联

- `useSlpBalanceQuery`:Max 展示,用 `VAULT_DEFAULT_DECIMAL`(修复过)
- `useVaultMag7Balance`:Dashboard 展示,用 `VAULT_DISPLAY_DECIMAL`
- `VaultWithdrawCooldownBanner`:cooldown 数量,用 `VAULT_DEFAULT_MINIMUM_DECIMAL`
