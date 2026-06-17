---
id: domain-normalize-no-display-format
tags: [domain, normalize, formatQuantity, display-format, separator, NaN, parseUnits, decimal.js, vault, claim, withdraw]
related_feature: vault-claim
severity: high
gate: true
gate_rule: domain/normalize.ts 输出余额/数量字段时禁止调用 formatQuantity/formatPrice/formatPercent 等带千位分隔符或 toFixed 的展示格式化函数;canonical 数值字符串(roundDownBalance 等)是唯一允许形态,千位符与展示截位放 ViewModel/UI
trigger: [normalize.ts, toVault, formatQuantity, formatPrice, formatPercent, "1,4", "Number(", parseUnits, withdrawable, processing, cooldown, canClaim, isEmpty, isPositiveAmount, Decimal.js, NaN]
date: 2026-05-14
---

# Domain normalize 误用展示格式化函数,下游 Number()/parseUnits 静默 NaN

## 问题描述

`features/vault/domain/normalize.ts:toVaultCooldown` 把 `withdrawable` / `processing` 字段用 `formatQuantity(...)` 包过一层 → 输出 `"1,405.49"`(带千位分隔符)写进 `VaultCooldown` 这个 Domain Type。表面看一切正常,但实际:

```ts
// VaultStats/index.tsx
const canClaim = Number(claim.withdrawable) > 0;
// Number("1,405.49") === NaN
// NaN > 0 === false
// → 「领取」按钮永远 disabled,用户余额再大也点不了
```

同一份格式化字符串还会经由 `claimFlowLogic.safeDecimal()` 走 `new Decimal("1,405.49")` 抛出 → `null` → claim 表单 max 校验静默跳过;同时 `parseUnits("1,405.49", 8)` 在 viem 层抛 `InvalidDecimalNumberError`。

## 调试过程中的误判

**第 1 次直觉**:"watch 模式 guard noop"  
看到点击「领取」无反应,以为是 `useVaultSLPViewModel:50` 的 `if (isWatching) return noop` 把回调劫持掉。
- 通过 inline fetch 插桩在 ActionLink 的 onClick 上 → 日志显示 **click 事件根本没派发**(因为 `disabled={!canClaim}` 是 true)。

**第 2 次直觉**:"isWatching guard 二级问题"  
依然以为 watch 模式造成按钮 noop。
- 在 ClaimCard 渲染处 useEffect 插桩 → 日志:`{claim:{withdrawable:"1,405.49"}, canClaim:false}`。
- 看到 `withdrawable:"1,405.49"` 才意识到——Domain 给了带逗号的展示字符串。

## 根因

`domain/normalize.ts:199` 用 `formatQuantity(roundDownBalance(amount, decimals), VAULT_DISPLAY_DECIMAL)`。

`formatQuantity` 内部 `formatWithSeparator()` 把 `1405.49336865` → `"1,405.49"`(千位符 + 截位 2 位)。**这是 ViewModel/UI 层职责**,被错误地搬进了 Domain。

## 避坑

### 硬规则(对齐 CLAUDE.md §5)

`domain/normalize.ts` 中,余额 / 数量 / 价格 / 金额字段:

- ✅ 只能输出 **canonical 数值字符串**(无千位符)
  - 用 `new Decimal(raw).toDecimalPlaces(precision, ROUND_DOWN).toString()`
  - 余额/数量 ROUND_DOWN 到 token decimal,**不截展示位数**
  - 价格保留 raw,展示截位放 UI
- ❌ 禁止调用 `formatQuantity` / `formatPrice` / `formatPercent` / `formatWithSeparator` / `Intl.NumberFormat` 等任何含千位符或固定 toFixed 的展示格式化函数

### sodex-web 对照(Ground Truth)

老项目 `useCooldownInfos.ts:91-92`:

```ts
const cooldownAmountStr = formatUnits(info.cooldownAmount, inCoinDecimals);
// "1405.49336865"(无千位符)
const cooldownAmount = Number(cooldownAmountStr);
// Number 可解析 → 后续 > 0 比较安全
```

→ Domain 给纯数,展示由 `CoolDownStatus.tsx:25 (cooldownAmount||0).toFixed(2)` 在渲染时做。

### 写代码前自查

改 `features/*/domain/normalize.ts` 时,grep 自查:

```bash
grep -n "formatQuantity\|formatPrice\|formatPercent\|formatWithSeparator\|Intl\.NumberFormat\|toLocaleString" features/<name>/domain/normalize.ts
```

应返回 0 行。若有匹配,要么是误放(必须移除),要么是 raw decimal placement 工具(确认未引入千位符)。

### 写代码前的下游消费防御

UI 层比较数值时,即便上游已 canonical,也优先用 `new Decimal(value).gt(0)` 替代 `Number(value) > 0`——后者一旦上游回归带千位符就 NaN 静默失败。

## 修复模式(本次落地)

1. `domain/normalize.ts:199` 删除 `formatQuantity` 包装,直接返回 `roundDownBalance(amount, decimals)` 的 canonical 字符串
2. 展示格式化下移到 `VaultStats/index.tsx`:
   - `formatClaimAmount(value)` 在渲染时 `formatQuantity(value, VAULT_DISPLAY_DECIMAL)`
   - `passesDisplayThreshold(value)` 用 `Decimal.toDecimalPlaces(2, ROUND_HALF_UP).gt(VAULT_MIN_DISPLAY_AMOUNT)` 对齐 sodex-web `shouldDisplay` 阈值(>0.01)
3. UI 层比较从 `Number(...) > 0` 改为 `passesDisplayThreshold(...)`(同时含 NaN 防御 + 阈值收紧)
4. `VaultWithdrawDialog/index.tsx:125` 顺手把 `Number(processing) > 0` 改为 `new Decimal(processing).gt(0)`,补 CLAUDE.md §9「number 表示精确数值」的合规

## 涉及文件清单(本次 bug 牵连面)

| 文件 | 角色 | 故障模式 |
|---|---|---|
| `domain/normalize.ts` | 根因 | `formatQuantity` 误用 |
| `components/VaultStats/index.tsx:164` | 一级故障 | `Number("1,405.49") = NaN` → 按钮 disabled |
| `containers/claimFlowLogic.ts:64-71` `safeDecimal` | 二级故障 | `new Decimal("1,405.49")` 抛错 → max 校验静默跳过 |
| `services/...parseUnits` | 三级故障(未触发因按钮先 disabled) | `parseUnits("1,405.49", 8)` 抛 InvalidDecimalNumberError |
| `components/dialogs/VaultWithdrawDialog/index.tsx:125` | 同源 | `Number(processing) > 0` 同 NaN 路径 |

## 关联

- `[[vault-decimal-constants-semantics]]`(精度常量不可互换;本 pitfall 的姊妹规则)
- CLAUDE.md §5(精度处理分层)
- CLAUDE.md §9(硬禁止 number 表示精确数值)
- sodex-web reference:`src/hooks/useCooldownInfos.ts`、`src/pages/vault/components/modals/funding/helper.ts:shouldDisplay`
