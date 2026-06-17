---
id: auth-session-downgrade-isFirstTimeUser
tags: [auth, session, isFirstTimeUser, vault, deposit]
related_feature: vault-deposit
severity: high
gate: true
gate_rule: 凡用 !accountId 或 !user.id 判断"是否为新用户"时，必须同时检查 isAuthenticated，防止 session 降级场景误判
trigger: [isFirstTimeUser, isNewUser, accountId, user.id, needsEnableTrading, enable trading, 新用户, 老用户]
date: 2026-04-26
---

# auth session 降级后 accountId=null 导致老用户被误判为新用户

## 问题描述

vault deposit 弹窗对 BASE_ETH 链，老用户（有 accountId、apiKey 过期）打开弹窗后，应该看到独立的「Enable Deposit」按钮；实际却看到进度弹窗（Sign Transactions）中 enable trading 出现为第 2 步，即走了新用户的 3 步机器流程。

## 调试过程中的误判

**第 1 次修复**：`isFirstTimeUser = !accountId`
- 以为只要检查 accountId 是否为空就足够

**第 2 次修复**：`isFirstTimeUser = !isAuthInitializing && !accountId`
- 以为问题是"初始化期间 accountId 临时 null"（race condition）
- 加了 `isAuthInitializing` 保护

**为何误判**：两次修复都停在"accountId 临时 null"的层面，没有追问"accountId 永久 null 还有哪些路径？"

## 根因

`wallet-session`（老用户）的 session 在 health check 失败后会降级：

```
wallet-session（有 accountId）
  → probeSessionHealth 失败（JWT/apiKey 过期）
  → handleExpired → performFullReauth
  → downgradeToWalletConnected
  → wallet-connected
```

`wallet-connected` 下 `deriveAccountId` 返回 `null`（与 `wallet-identity-only` 新用户相同）。
`isAuthenticated = false`，`accountId = null`，`apiKeyValid = false`。

原有判断 `!isAuthInitializing && !accountId` 对两种情况都返回 `true`：

| session | isAuthenticated | accountId | isFirstTimeUser（修复前） | 正确值 |
|---------|----------------|-----------|--------------------------|-------|
| `wallet-identity-only`（真新用户）| true | null | true ✅ | true |
| `wallet-connected`（降级老用户）| **false** | null | true ❌ | **false** |

降级老用户在 BASE_ETH 下触发 `needsStandaloneEnableDeposit = false`，跳过独立按钮，直接进入 3 步机器流程。

## 避免方式

**修复模式**：

```ts
// ❌ 错误：只用 !accountId，无法区分降级老用户和真新用户
const isFirstTimeUser = !isAuthInitializing && !accountId;

// ✅ 正确：加 isAuthenticated 区分
// - wallet-identity-only（真新用户）：isAuthenticated=true, accountId=null → true
// - wallet-connected（降级老用户）：isAuthenticated=false, accountId=null → false
const isFirstTimeUser = !isAuthInitializing && isAuthenticated && !accountId;
```

**检查规则**：
凡写"是否为新用户/首次用户"判断时，必须：
1. 打开 `src/features/auth/domain/sessionQueries.ts`，枚举所有 session kind 下 `deriveAccountId` 的返回值
2. 确认 `wallet-connected`（降级）场景下该判断是否符合预期
3. 组合 `isAuthenticated && !accountId` 而不是单独 `!accountId`

**验收场景（必须覆盖）**：
```
Given: 用户曾经登录，apiKey 过期，session 降级为 wallet-connected
      (isAuthenticated=false, accountId=null, apiKeyValid=false)
When:  打开 BASE_ETH deposit 弹窗
Then:  显示独立「Enable Deposit」按钮，不进入 3 步机器流程
```

**相关文件**：
- `src/features/auth/domain/sessionQueries.ts` — `deriveAccountId` 各 kind 返回值
- `src/features/auth/containers/useSessionHealthCheck.ts` — `downgradeToWalletConnected` 降级路径
- `src/features/vault/components/dialogs/VaultDepositDialog/index.tsx` — 已修复
