---
id: vault-deposit-base-chain-debug-2026-04-24
tags: [vault, deposit, base-chain, value-chain, debug, signing, permit, staking, retry, toast]
related_feature: vault-deposit
severity: critical
date: 2026-04-24
source: 真实测试调试（Base chain MAG7/sMAG7 端到端验证）
---

# vault-deposit 真实流程调试归档（2026-04-24）

## 测试结果

| 路径 | 结果 |
|---|---|
| Base chain MAG7（bridge→stake→permit→vault） | ✅ 两笔成功 |
| Base chain sMAG7（bridge→transfer→permit→vault，无 stake） | ✅ 成功 |
| Value chain 直存 | 🔲 待下次 session 测试 |

---

## 发现的关键 Bug 及修复

### 1. `baseBridgeAddress` 未设置 → 静默卡死

**现象**：Base chain 进入 `base_chain_phase`，但 `baseState` 立刻 FAILED（`guard: !inp.token.baseBridgeAddress`），`case "failed": return` 不传播到 topState → 机器卡死，UI 永久显示 loading。

**根因**：`DEFAULT_TOKEN_MAG7 / DEFAULT_TOKEN_SMAG7` 未设置 `baseBridgeAddress`，该字段需从链上 `getTokenConfig` 动态读取。

**修复**：
- `vaultDepositInfra.ts` 新增 `readBaseBridgeAddress(coinSymbol)` 函数（调 `SODEX_TOKEN_QUERY.getTokenConfig`）
- `runBaseChainState.checking_allowance` 懒加载 bridge address，存入 `resolvedBridgeAddrRef`（不放 `inputRef`，避免被 render 覆盖）

---

### 2. 三个关键合约地址错误（`code=-1` API 拒绝）

**根因对比**：

| 字段 | 错误值 | 正确值 |
|---|---|---|
| ERC-2612 permit `spender` | `VAULT_CALLER_ADDRESS` (0x478FeC...) | `CALL_FOR_PERMIT_ADDRESS` (0x890B7D...) |
| CallForPermit typed data `to` | `VAULT_CALLER_ADDRESS` | `SLP_TOKEN_ADDRESS` (0x368788...) |
| CallForPermit API request `to` | `VAULT_CALLER_ADDRESS` | `SLP_TOKEN_ADDRESS` |

**原则**：
- `spender`：CallForPermit 合约需成为 spender，才能在执行时调用 `token.permit()`
- `to`：API 服务端按 SLP Token（vault 合约）地址路由执行，不是 VAULT_CALLER_ADDRESS

**对应 Signing Checklist**：已在 `signing-checklist.md` 记录各字段逐一比对规则。

---

### 3. `case "staking"` 缺少 `STAKE_CONFIRMED` handler → 卡死

**现象**：Staking 完成后 `dispatchValue(STAKE_CONFIRMED)`，但 `valueChainReducer` 的 `case "staking"` 只处理 `STAKE_SUBMITTED`，`STAKE_CONFIRMED` 未处理 → `return state`（卡在 staking）。

**修复**：`depositStateMachine.ts` 的 `case "staking"` 添加：
```typescript
if (action.type === "STAKE_CONFIRMED") return { kind: "approving" };
```

---

### 4. `mapCauseToDepositError` 无法识别已映射的 `VaultServiceError`

**现象**：用户拒签 → infra 层 `approveErc20` catch → throw `{ kind: "USER_REJECTED" }` → 机器 catch 再捕获 → `isUserRejectedError({ kind: "USER_REJECTED" })` 匹配 "user rejected"（空格）但 JSON 是 "user_rejected"（下划线）→ 返回 `DEPOSIT_APPROVE_FAILED` → `shouldShowTryAgain = false` → Try Again 不出现。

**修复**：`mapCauseToDepositError` 首先检查 `cause.kind === "USER_REJECTED"` passthrough，跳过字符串关键词匹配。

---

### 5. Staking coin symbol 格式错误 → `code=-1`

**现象**：staking API 调用 `inCoinSymbol: "MAG7"` 但服务端期望 `"MAG7.ssi"`。

**修复**：使用 `inp.token.isStake ? "MAG7.ssi" : "sMAG7.ssi"` 带 `.ssi` 后缀。

---

### 6. 网络切换后需等 2s 才签名

**现象**：从 Base (8453) 切换到 Value Chain (286623) 后立即 `signTypedData` → `InternalRpcError: Provided chainId "286623" must match active chainId "8453"`。

**修复**：`signEip712TypedData` 在 `switchChain` 后 `await new Promise(resolve => setTimeout(resolve, 2000))`（对齐老项目 `approving` case 的延迟）。

---

### 7. Transfer 后需等 2s 服务端同步余额

**现象**：Transfer 到 EVM-Funding 后立即发起下一步，服务端 balance 未同步 → `TRANSFER_FAILED: SERVER_ERROR`。

**修复**：`runValueChainState.transferring` 在 `TRANSFER_COMPLETED` dispatch 前 `await sleep(DEPOSIT_BRIDGE_SYNC_DELAY_MS = 2000)`（对齐老项目 `case "transferring"` 末尾 `await sleep(2000)` 位置）。

---

### 8. Value chain `TRANSFER_COMPLETED → staking` reducer 跳过修复

**背景**：新项目 value chain reducer `TRANSFER_COMPLETED` 原本直接跳 `approving`（跳过 staking）。测试发现 vault 合约只接受 vsMAG7，不接受 vMAG7，必须先 stake。

**修复**：恢复 `TRANSFER_COMPLETED → staking`（`needsStake=true` 时）。Staking UI 步骤在面板里不显示（用户看 3 步：Transfer / Approve / Confirm），但机器内部完整执行。

---

### 9. Retry 期间 Toast + Try Again 逻辑

**Toast 根因**：`USER_REJECTED` 时不应清 loading toast（流程可继续），只在 fatal error 清。`closeNotify()` 使用 `activeMessageKeys.clear()`，不能用 `toast.dismiss(id)` 替代（后者不清 Set）。

**Try Again 根因**：retry timer（3s）会在用户再次拒签后覆盖 `setShowTryAgain(true)` → Try Again 消失。修复：`onError` 设置 Try Again 前先 `clearTimeout` 计时器。

**值链 retry**：`shouldShowDepositTryAgain` 扩展为 value chain 所有错误均显示 Try Again（利用机器已有的 cache retry 路径，不需要从 base chain 重跑）。

---

## 关键常量（测试验证）

| 名称 | 地址 | 说明 |
|---|---|---|
| `CALL_FOR_PERMIT_ADDRESS` | `0x890B7D142841065E64E5f94a455876e6352A7801` | ERC-2612 permit spender / CallForPermit verifyingContract |
| `VAULT_CALLER_ADDRESS` | `0x478FeC6b6EAD70D0e03BEeBa15027Aa6D51180Ab` | staking `to` 字段 |
| `SLP_TOKEN_ADDRESS` | `0x368788EFa75Ee0BC3ce8B4D1a920197Af2e30876` | vault deposit `to` 字段（API request） |
| `VSMAG7_TOKEN_ADDRESS` | `0xa17B0537af8687080B7bFAa8C5EEA4EcD6481870` | vsMAG7 permit token（MAG7/sMAG7 均用此） |
| Bridge address (MAG7) | `0xCC7322A2f9f82251dA51584B1a89915dBc02185B` | 动态读取，不硬编码 |

---

## 成功交易哈希（测试网）

| 路径 | Vault TX |
|---|---|
| Base MAG7 Run 1 | `0x364ddabc66fd8b6dbe13b62c713c9e8635b2767a1c3de7ee398581e4fdb888a1` |
| Base MAG7 Run 2 | `0x309edac814da823409c120256c333839c5b6ba91cb760b6415eb76be2bea5545` |
| Base sMAG7 Run 1 | `0x6b68781c251f4638c5c0817d52a61eca2993a25e59062780c7b0a9bed33d380b` |
