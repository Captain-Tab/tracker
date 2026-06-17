# Vault Claim 完整流程

> Vault SLP 模块下的 Claim 入口：cooldown 期满后用户把 cooldown 中的 sMAG7.ssi 凭证兑现为 MAG7.ssi 直达 Spot 账户。
>
> 与 unstake 互补：unstake 启动 14-day cooldown（callForType=1, toClob=false），claim 是 cooldown 结束后兑现（callForType=2, toClob=true）。两者共享 infra/domain（claim 是基础设施，unstake/withdraw 都基于 claim infra 复用）。

---

## 关联文档

本 feature **不**自管 toast 与数据刷新——这两件事统一由 `vault-notification` feature 提供基础设施，本 feature 仅作为消费方调用。

| 关注点 | 关联文档 |
|---|---|
| **Toast 完整时序** | [`vault-notification` feature §4.4 — Claim（双信号，文案不带金额）](../../router/vault.json#vault-notification) |
| **Toast 文案为何不带金额** | `vault-notification` feature §4.4 设计原因（call_for type=2 record `inAmount=0` / `inCoinSymbol=sMAG7` 不能直显） |
| **Helper 函数实现** | `vault-notification` feature §5（`notifyVaultClaimSuccess()` 无参数固定文案 `Claimed successfully`） |
| **Pending toast 关闭机制** | `vault-notification` feature §6.2 — callFor pending 双路径关闭（Success / Failed） |
| **错误码体系（CALL_FOR_* → CLAIM_*）** | `vault-notification` feature §7.2 — 错误码转换链 |
| **错误 toast 映射全表** | `vault-notification` feature §7.3 — `handleClaimServiceError` |
| **数据刷新策略** | `vault-notification` feature §8 — `invalidateVaultMutationQueries`（17 query key + 3/5/9s 兜底） |
| **WS sodex_call_for type=2 推送链路** | `vault-notification` feature §8.6 — 端到端链路 |
| **dedupe 机制** | `vault-notification` feature §9 — `notifiedCallForPendingIds / SuccessIds` |
| **Toast 规范源 spec（迁移历史）** | `.claude/kit/spec/vault-migration/claim-toast.md` |
| **数据刷新源 spec（迁移历史）** | `.claude/kit/spec/vault-migration/data-refresh.md` |

> 阅读顺序建议：先读本 guide 理解 claim 特有流程（cooldown 数据源 + CallForPermit + signer 锁 + 老用户分支），再读 `vault-notification` feature 看 toast/数据刷新如何被驱动。

---

## 架构概览

```
┌────────────────────────────────────────────────────────────┐
│ vault SLP 区域 / VaultStats 入口                           │
│   useVaultSLPViewModel → safeTrigger(openVaultClaimDialog) │
└─────────────────────┬──────────────────────────────────────┘
                      │
                      ▼
┌────────────────────────────────────────────────────────────┐
│ VaultClaimDialog (壳层由 modalManager 提供)                 │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ NumberInput: amount + Max (cooldown.withdrawable)    │  │
│  │ helperText: deriveClaimHelperText(min=CLAIM_MIN_AMOUNT)│ │
│  │ LabelValue: You receive = `${amount} MAG7.ssi`       │  │
│  │ LabelValue: Fees = "0" + ${amount * 0.00005} 划线    │  │
│  │ ─────────────────────────────────────────             │  │
│  │ if (needsStandaloneEnable):                           │  │
│  │    <Button>Enable Claim</Button>                      │  │
│  │      └─ useEnableTrading.enableTrading()              │  │
│  │ else:                                                  │  │
│  │    <VaultClaimButton state isAwaitingWalletSig />     │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────┬──────────────────────────────────────┘
                      │ form.onSubmit → submit({ amount })
                      ▼
┌────────────────────────────────────────────────────────────┐
│ useSubmitVaultClaim (mutation 单层,无 smart-transfer)      │
│                                                             │
│  onMutate: 锁 signer (getCurrentOnChainCapability)          │
│  ────────────────────────────────────────────────────       │
│  mutationFn:                                                │
│    1. setIsAwaitingWalletSignature(true)                    │
│    2. executeClaim(capability, input) ─────────┐            │
│         onSigned → setIsAwaitingWalletSignature(false)│      │
│  ────────────────────────────────────────────────────       │
│  onSuccess: setTimeout × 3 (3s/5s/9s)                       │
│              invalidateVaultMutationQueries(qc, account)    │
│  onError:   handleClaimServiceError(error)                  │
└─────────────────────┬──────────────────────────────────────┘
                      │
                      ▼
┌────────────────────────────────────────────────────────────┐
│ vaultClaimService.executeClaim                              │
│                                                             │
│  1. getClaimNonce(account)        (Infra readContract)     │
│  2. buildClaimCmd(amount):                                  │
│       { chain: BASE_ETH, callForType: 2, toClob: true,      │
│         inCoinSymbol: sMAG7, outCoinSymbol: MAG7,           │
│         inAmount: "0", minOutAmount: parseUnits(amount,8) } │
│  3. buildPermitTypedData(...)  EIP-712                      │
│  4. signCallForPermit(capability, typedData)                │
│       └─ 用户签名 → input.onSigned?.()                      │
│  5. buildCallForPermitRequest + postCallForPermit           │
│  6. waitForClaimReceipt(txHash) 3 confirmations             │
│  ────────────────────────────────────────────────────       │
│  catch:                                                      │
│    mapInfraErrorToServiceError(err)                         │
│    if CALL_FOR_FAILED  → throw CLAIM_FAILED                 │
│    if CALL_FOR_TIMEOUT → throw CLAIM_TIMEOUT                │
│    else throw mapped                                        │
└─────────────────────┬──────────────────────────────────────┘
                      │ 链上提交 + 服务端处理
                      ▼
┌────────────────────────────────────────────────────────────┐
│ 服务端处理 → WebSocket sodex_call_for type=2 推送           │
│  Pending → useDepositNotice 弹 "Claiming in progress..."    │
│  Success → notifyVaultClaimSuccess() 弹 "Claimed successfully"│
│             + invalidateVaultMutationQueries (单次,权威刷)  │
│  Failed  → "Claim failed"                                   │
│  详见 vault-notification feature                            │
└────────────────────────────────────────────────────────────┘
```

---

## 核心逻辑

### useSubmitVaultClaim — Container 编排

文件：`src/features/vault/containers/useSubmitVaultClaim.ts:30-121`

```ts
export function useSubmitVaultClaim(): {
  submit: (params: { amount: string }) => Promise<{ success: boolean; txHash?: string }>;
  isSubmitting: boolean;
  isAwaitingWalletSignature: boolean;  // 仅覆盖 vault 自身签名节点(apiKey + claim permit)
  error: VaultServiceError | null;
  reset: () => void;
}
```

关键职责（单层 mutation，**无 smart-transfer**——cooldown 资产服务端管理，直接走 CallForPermit）：
1. `onMutate` — 启动一刻 `getCurrentOnChainCapability()` 锁 signer，避免后续等链上时用户切账号导致 onSuccess invalidate 落到错位 wallet
2. `mutationFn` —
   - 紧邻再次读 capability 校验（中间无 await，保证 signer 一致）
   - `setIsAwaitingWalletSignature(true)`
   - 调 `executeClaim(capability, { ...params, account, onSigned })`
   - `onSigned` 回调 → `setIsAwaitingWalletSignature(false)`（按钮文案从 walletAction 切到 "Submitting..."）
   - finally 兜底重置 flag
3. `onSuccess` — 不弹 toast，3 次延迟 `invalidateVaultMutationQueries(qc, context.account)`（3s / 5s / 9s 兜底链上节点同步延迟）
4. `onError` — `handleClaimServiceError(error)` 按 kind 映射 toast

### executeClaim — Service 命令

文件：`src/features/vault/services/vaultClaimService.ts:39-102`

```ts
export async function executeClaim(
  capability: OnChainCapability,
  input: ClaimInput & { account: Address; onSigned?: () => void },
): Promise<ClaimResult>
```

5 步固定流程（基础设施模块——unstake/withdraw service 都复用本模块的 infra）：
1. `getClaimNonce(account)` — 链上读 nonce（`vaultClaimInfra.ts:40`，按 `cmdType key=1 CreateBridgeCallFor`）
2. `buildClaimCmd(amount)` + `buildDeadlineSeconds()` + `buildPermitTypedData(...)` — 组装 EIP-712 typed data
3. `signCallForPermit(capability, typedData)` → 触发 `input.onSigned?.()`（上层切 UI 从"等签名"到"等链上"）
4. `buildCallForPermitRequest(...)` + `postCallForPermit(...)` → `txHash`
5. `waitForClaimReceipt(txHash)` — 等 3 confirmations（`CLAIM_TX_CONFIRMATIONS = 3`）

catch 分支错误码转换：
- `CALL_FOR_FAILED` → `CLAIM_FAILED`（带 txHash + message）
- `CALL_FOR_TIMEOUT` → `CLAIM_TIMEOUT`（带 txHash）
- 其他 → 透传 mapped error

> Service 内部已抛过的 `VaultServiceError`（如 `USER_REJECTED`）通过 `isServiceError` 直接 rethrow，不二次 map。

### useVaultClaimForm — 表单状态

文件：`src/features/vault/containers/useVaultClaimForm.ts:15-63`

```ts
export function useVaultClaimForm(input: { max: string }): {
  amount: string;
  onAmountChange: (next: string) => void;  // 含 8 位小数校验(VAULT_TOKEN_DECIMAL)
  onMax: () => void;                        // setAmount(input.max)
  reset: () => void;
  helperText: string | null;                // deriveClaimHelperText
  isValid: boolean;                          // isClaimAmountValid
  min: string;                               // CLAIM_MIN_AMOUNT = "4" (domain 常量,与 unstake "5" 不同)
  max: string;
}
```

- 最低金额 `CLAIM_MIN_AMOUNT = "4"` 在 `domain/constants.ts`（与 unstake "5" 不同；claim 是 sMAG7→MAG7 兑现，门槛略低）
- `onAmountChange` 用正则 `^\d*(\.\d{0,8})?$` 阻止超精度输入
- 注释明示原计划用 react-hook-form+zod，因新项目未装这两个依赖，用 useState + claimFlowLogic 等价实现

### deriveClaimButtonState — 纯函数

文件：`src/features/vault/containers/claimFlowLogic.ts:12-27`

```ts
export function deriveClaimButtonState(input: {
  amount: string;
  min: string;
  max: string;
  isSubmitting: boolean;
}): ClaimButtonState  // { isSubmitting, disabled, helperText }
```

辅助纯函数：
- `deriveClaimHelperText({ amount, min, max })` — 返回 `null` / `"Invalid amount"` / `"Enter an amount"` / `"Minimum X MAG7.ssi"` / `"Maximum X MAG7.ssi"`
- `isClaimAmountValid(amount, min, max)` — 校验 `min ≤ amount ≤ max && amount > 0`

> 这是 claim/unstake 共用的"基础设施"——unstakeFlowLogic 与本文件几乎相同，差异仅在 helperText 单位字串（`MAG7.ssi` vs `sMAG7.ssi`）。

### handleClaimServiceError — Toast 映射

文件：`src/features/vault/containers/handleClaimServiceError.ts:11-73`

| `error.kind` | toast | 文案 |
|---|---|---|
| `USER_REJECTED` | — | **静默** 不弹 |
| `CLAIM_FAILED` | `notify.error` | `Claim failed: ${message}` 或 `Claim failed, please try again` |
| `CLAIM_TIMEOUT` | `notify.warning` | `Claim submitted, waiting for on-chain confirmation. Check Activity tab later.`（带 txHash）/ `Claim submitted, confirmation may take longer than usual.`（无 txHash） |
| `NETWORK_ERROR` | `notify.error` | `Network error, please check your connection` |
| `CHAIN_MISMATCH` | `notify.error` | `Wrong network, please switch to chain ${expected}` |
| 其他（fallthrough default） | `notify.error` | `error.message` 或 `Request failed, please try again` |

---

## 关键实现

### 1. CallForPermit EIP-712 typed data (callForType=2, toClob=true)

文件：`src/features/vault/domain/claimPermit.ts:70-80`

```ts
export function buildClaimCmd(amount: string): ClaimCmd {
  return {
    chain: "BASE_ETH",                                         // 跨链协议字段(目标链)
    callForType: CLAIM_CALL_FOR_TYPE,                          // = 2 (CLAIM)
    inCoinSymbol: standardizeMag7Symbol("sMAG7"),              // → "vsMAG7.ssi"(链上 symbol)
    inAmount: "0",                                             // claim 输入固定 0(cooldown 凭证抵扣)
    outCoinSymbol: standardizeMag7Symbol("MAG7"),              // → "vMAG7.ssi"
    minOutAmount: parseUnits(amount, VAULT_TOKEN_DECIMAL).toString(),  // 用户期望领到的最少 MAG7
    toClob: true,                                              // 直达 Spot,不进 cooldown
  };
}
```

与 unstake 的关键差异：
| 字段 | claim | unstake |
|---|---|---|
| `callForType` | **2** | 1 |
| `inAmount` | **"0"**（cooldown 凭证抵扣） | `parseUnits(amount, 8)` |
| `minOutAmount` | `parseUnits(amount, 8)` | "0" |
| `toClob` | **true**（直达 Spot） | false（进 cooldown） |
| 资产来源 | cooldown 凭证（服务端管理） | EVM-Funding sMAG7（需 smart-transfer 兜底） |
| 数据 hook | `useVaultCooldown(address)` → `withdrawable` | `useVaultMag7Balance(address)` → `valueChain.sMag7` |

### 2. cooldown 数据源（无 smart-transfer）

```tsx
// VaultClaimDialog/index.tsx:36-37
const cooldown = useVaultCooldown(address ?? undefined);
const withdrawable = cooldown.data?.withdrawable ?? "0";
```

`useVaultCooldown(address)` 返回 cooldown 状态（含 `withdrawable` = 可领取数量）。**不需要 smart-transfer**——cooldown 资产由服务端管理，CallForPermit 链上签名后服务端自动把 MAG7 转入 Spot。

→ 比 unstake 流程简化：
- 无 `useEvmBalancesQuery`
- 无 `useSubmitTransfer` 兜底转账
- 无 `waitForEvmSmag7Balance` 4.5s 轮询
- container 单层 mutation 而非两层编排

### 3. signer 锁（防钱包切换）

`onMutate` 调 `getCurrentOnChainCapability()` 快照 `signerAddress` 写入 mutation context，`mutationFn` 内紧邻再次读取（中间无 await）保证两者一致。

```ts
// useSubmitVaultClaim.ts:49-72 (onMutate + mutationFn 紧邻)
onMutate: () => {
  const onChain = getCurrentOnChainCapability();
  if (!onChain) throw { kind: "UNKNOWN", message: "Wallet not connected" };
  return { account: onChain.signerAddress };
},
mutationFn: async (params, _ctx) => {
  const onChain = getCurrentOnChainCapability();
  if (!onChain) throw { kind: "UNKNOWN", message: "Wallet not connected" };
  const account = onChain.signerAddress;
  // ...
},
```

中途用户换钱包 → `wagmi.signTypedData` 在 step 4 自然失败抛 `USER_REJECTED`（钱包不匹配）；不会沉默落到错位 wallet。`onSuccess` 用 `context.account` 做 invalidate 确保落到原账号。

### 4. 两段 UI 状态：等签名 vs 等链上

`isAwaitingWalletSignature` 是独立 useState，仅在 vault 自身两个签名节点（apiKey 触发 + claim permit）期间为 true：

```ts
// useSubmitVaultClaim.ts:82-91
setIsAwaitingWalletSignature(true);
try {
  return await executeClaim(onChain, {
    ...params,
    account,
    onSigned: () => setIsAwaitingWalletSignature(false),  // 签名完成 → 切到"等链上"
  });
} finally {
  setIsAwaitingWalletSignature(false);  // 兜底
}
```

UI 层（`VaultClaimButton`）按状态显示：
| 条件 | 按钮文案 |
|---|---|
| `isAwaitingWalletSignature` | `walletAction`（来自 `useWalletSigningText`，根据钱包类型动态文案——WC 用户需要去手机端确认） |
| `state.isSubmitting`（链上等待） | `Submitting...` |
| 输入合法 | `Claim` + 下方 `helperText` 提示 |

### 5. 老用户独立 Enable Claim 按钮

```tsx
// VaultClaimDialog/index.tsx:46-50
const hasAccount = isAccountIdProbing || !!accountId;  // probe 中乐观视为老用户(防 flash)
const needsStandaloneEnable =
  !isWatching && hasAccount && (!isAuthenticated || !apiKeyValid);
```

- **新用户（链上无 accountId）**：vault callForPermit 后端走 `bizClient`（不带 JWT/apiKey），仅依赖链上签名 + 链上 nonce 校验，**无需 enable trading 即可 claim**
- **老用户（链上有 accountId）但 apiKey 失效**：显示独立 `Enable Claim` 按钮，调 `useEnableTrading.enableTrading()` 走 embedded 签名（不叠 AuthStepsModal，因弹窗内钱包必然已连）
- **probe 中 (`isAccountIdProbing`)**：乐观视为老用户，避免 probe 完成时按钮从默认态 flash 到 Enable 态
- **watch 模式 (admin 观察其他账户)**：`isWatching` 为 true，admin 自己的 apiKey 与被观察账户不匹配，Enable 无意义，直接关闭分支显示默认 `Claim` 按钮

### 6. Fees 展示纯派生（无后端读取）

```tsx
// VaultClaimDialog/index.tsx:65-72
const feesUsdDisplay = useMemo(() => {
  if (!form.amount) return null;
  try {
    return new Decimal(form.amount).mul("0.00005").toFixed(2);
  } catch {
    return null;
  }
}, [form.amount]);
```

UI 显示 `0` + 划线 `${amount * 0.00005}` USD —— 0 是真实手续费（claim 免费），划线显示原本应付费用作 marketing 提示。完全在前端纯函数派生，不调后端 API。

### 7. Privy 邮箱用户兼容

```tsx
// VaultClaimDialog/index.tsx:28-35
const { isAuthenticated, apiKeyValid, accountId, address, isAccountIdProbing, isWatching } = useAuthState();
```

`address` 来自 `useAuthState()` 而非 `useAccount()`—— Privy 邮箱用户的 embedded wallet 不一定立刻进 wagmi，但 auth state 派生的 address 在 Privy 登陆完成后即可用。

---

## 文件结构

```
src/features/vault/
├── components/dialogs/VaultClaimDialog/
│   ├── index.tsx                          UI 主入口 + openVaultClaimDialog opener
│   ├── VaultClaimButton.tsx               3 态按钮(等签名 / 提交中 / 默认 + helperText)
│   └── VaultClaimSkeleton.tsx             3 段 pulse 占位(input + 2 行 LabelValue + button)
│
├── containers/
│   ├── useSubmitVaultClaim.ts             mutation 编排(单层 CallForPermit,无 smart-transfer)
│   ├── useVaultClaimForm.ts               表单 state(amount + helperText + isValid)
│   ├── claimFlowLogic.ts                  纯函数(deriveClaimButtonState/HelperText/isValid)
│   └── handleClaimServiceError.ts         error.kind → toast 文案映射
│
├── services/
│   └── vaultClaimService.ts               executeClaim(纯链路,catch 内 CALL_FOR_*→CLAIM_*)
│
├── infra/chain/
│   └── vaultClaimInfra.ts                 getClaimNonce + signCallForPermit + waitForClaimReceipt
│                                          ↑↑↑ 基础设施,unstake/withdraw service 都复用
│
└── domain/
    ├── claimPermit.ts                     EIP-712 typed data + cmd encode + request body
    │                                      ↑↑↑ 类型(ClaimCmd/CallForPermitTypedData/RequestBody)被 unstake 复用
    └── constants.ts                       CLAIM_MIN_AMOUNT="4" + CLAIM_CALL_FOR_TYPE=2
```

**claim 是基础设施**：本 feature 的 `infra/chain/vaultClaimInfra.ts` 与 `domain/claimPermit.ts` 是基础模块——

| 复用方 | 复用内容 |
|---|---|
| `vaultUnstakeService` | `getClaimNonce` / `signCallForPermit` / `waitForClaimReceipt` |
| `vaultWithdrawService` | 同上（MAG7 路径含 unstake permit 子步） |
| `unstakePermit.ts` | `ClaimCmd` / `CallForPermitRequestBody` / `CallForPermitTypedData` 类型 |

**跨 feature**（仅通过 public API）：
- `@/features/auth` — `useAuthState`, `useEnableTrading`, `getCurrentOnChainCapability`, `OnChainCapability` type, `useWalletSigningText`
- `@/shared/utils/invalidateVaultMutationQueries` — 17 query key 统一刷新（详见 `vault-notification` feature）

---

## 关键设计决策

### 1. 无 smart-transfer 编排（与 unstake 不同）

**为什么**：cooldown 资产由服务端管理（不是用户钱包余额），CallForPermit 链上签名后服务端处理就能把 MAG7 直接转到 Spot；不需要先把资金从 Spot 转到 EVM-Funding。

**结果**：container 单层 mutation，比 unstake 简洁。

### 2. CALL_FOR_*→CLAIM_* 错误码转换在 service catch 内

**为什么**：`mapInfraError` 输出通用 `CALL_FOR_FAILED` / `CALL_FOR_TIMEOUT`（infra 不知道业务上下文），如果直接传给 `handleClaimServiceError` 会暴露语义错位的错误码。

**实现**：`vaultClaimService.catch` 转换为 `CLAIM_FAILED` / `CLAIM_TIMEOUT`，外部 handler 只 case 业务专有 kind + 通用 kind（`USER_REJECTED` / `NETWORK_ERROR` / `CHAIN_MISMATCH`）。

同模式应用于 `vaultUnstakeService` (CALL_FOR → UNSTAKE_*) 和 `vaultWithdrawService` (CALL_FOR → WITHDRAW_REDEEM_* / UNSTAKE_*)。

### 3. 不主动起 success toast，等 WS 推送驱动

**为什么**：链上 tx receipt 上链 ≠ 真完成——服务端还要把 MAG7 转入 Spot 后才推 `sodex_call_for type=2 Success`。

**实现**：`onSuccess` 不调 `notify.success`；`useDepositNotice`（trade feature，App 顶层挂载）监听 `lastCallForEvent` 状态，按 `callForType=2` + `executeStatus` 弹 `Claiming in progress...` / `Claimed successfully` / `Claim failed`。

**特殊：success 文案不带金额币种** —— call_for type=2 record `inAmount=0` / `inCoinSymbol=sMAG7`，都不能直接代表用户领到的 MAG7 数量；对齐老项目 `i18n.t("spot:claimed_successfully")` 不带金额。详见 `vault-notification` feature §4.4。

> 完整时序对照、helper 函数实现、pending toast 关闭机制 → 查 `vault-notification` feature §4.4 / §5 / §6.2。本地错误（`CLAIM_FAILED` / `CLAIM_TIMEOUT`）的 toast 文案映射 → 查 §7.3。

### 4. 3 次延迟 invalidate（3s / 5s / 9s）

**为什么**：mutation onSuccess 时链上 receipt 已 confirm，但 ValueChain RPC 节点可能未把最新区块 propagate 完毕，立即 refetch 会读旧数据。

**3/5/9 三档**：
- 3s — 覆盖 ValueChain 节点常见同步延迟
- 5s — 超过 RQ staleTime（默认 5s），保证再 fetch 一次
- 9s — 节点几乎一定同步完成，最终保险

React Query 5s staleTime 内对同一 key 的多次 invalidate 自动 dedupe，不会重复 fetch。WS sodex_call_for Success 推送也会再 invalidate 一次（权威刷），双路重叠不会有性能问题。

### 5. signer 锁 + Privy 邮箱用户兼容

`onMutate` 用 `getCurrentOnChainCapability()` 快照 signerAddress，避免 mutation 期间用户切账号导致 invalidate 落到错位 wallet。Container 数据查询用 `useAuthState().address` 而非 `useAccount()`，覆盖 Privy embedded wallet 场景。

### 6. 老用户 enable_claim 独立按钮（embedded，不叠 AuthStepsModal）

**为什么**：claim 弹窗内钱包必然已连（外部已经 connect 过），叠 AuthStepsModal 第 1 步会显示"已连接钱包"占位，体验冗余。

**实现**：`useEnableTrading()`（embedded mode）直接走第 2 步签名，跳过 step 1。

---

## 开发修改指南

### 新增错误码

1. 在 `domain/types.ts` `VaultServiceError` union 追加 `{ kind: "CLAIM_NEW_KIND"; ... }`
2. `vaultClaimService.catch` 增加分支抛新 kind
3. `handleClaimServiceError` 增加 case 映射 toast
4. **同步更新 `isServiceError`** 的 kind 白名单（否则会被当成普通 error 二次 map）
5. 同步 `handleUnstakeServiceError` / `handleWithdrawServiceError` / `handleDepositServiceError` 的 fallthrough 列表（否则跨业务调用时缺 case TS 报错）

### 修改最低 claim 金额

只改 `domain/constants.ts:22` 的 `CLAIM_MIN_AMOUNT`。helperText 和 button disabled 自动联动。

> 该常量提升到 `domain/constants.ts` 因为可能被其他模块引用（如 vault SLP 区域显示 cooldown 状态时校验是否达到 claim 阈值）。

### 修改 toast 文案

- 本地错误（`CLAIM_FAILED` / `CLAIM_TIMEOUT` 等）：改 `handleClaimServiceError`（本 feature 内）
- WS 推送 success / pending / failed：改 `features/trade/containers/useDepositNotice.ts` 的 `notifyVaultClaimSuccess` / type=2 pending 文案 / failed 文案 → 这是 `vault-notification` feature 的边界，改前请阅读其 §5（claim helper 不与 withdraw/unstake 共用，固定无参数）

### 修改 callForType / toClob / inAmount 设计

`buildClaimCmd` 字段调整。注意 service catch 内 `CALL_FOR_*→CLAIM_*` 转换是按 claim 业务语义写死的；如改 callForType 为其他值（不再是 claim），整个 service 应改名重写。

### 修改 confirmations 数

只改 `vaultClaimInfra.ts:23` 的 `CLAIM_TX_CONFIRMATIONS`（默认 3，由 clarify Q2 决策）。同时复用此 infra 的 unstake/withdraw 也会受影响——如需差异化按业务拆分 infra。

---

## 数据更新对接

完成后的数据刷新走 `invalidateVaultMutationQueries`（实现位于 `src/shared/utils/invalidateVaultMutationQueries.ts`，由 `vault-notification` feature 维护，详见该 feature §8 全清单）：

| 时机 | 调用位置 | 策略 | 说明 |
|---|---|---|---|
| mutation onSuccess（receipt confirm） | `useSubmitVaultClaim.ts:93-107` | 3 次 setTimeout（3s / 5s / 9s） | 兜底 ValueChain 节点同步延迟（见 vault-notification §8.3） |
| WS sodex_call_for type=2 Success | `useDepositNotice.ts:155` | 单次（推送到达时链上数据已稳定） | 服务端真落账时权威刷（见 vault-notification §8.6） |

双路重叠：React Query 5s staleTime 内对同一 key 的多次 `invalidateQueries` 自动 dedupe，不会重复 fetch（见 vault-notification §8.5）。

刷新覆盖 17 个 query key（vault.* / chain.evmBalances / spot.accountState / wagmi readContracts/readContract 前缀）—— 完整清单见 `vault-notification` feature §8.4。

**claim 流程对清单中 query key 的具体影响**：

| query key | 影响 |
|---|---|
| `vault.cooldown(account)` | cooldown.withdrawable 减少（核心 UI 反馈：claim 按钮的 Max 值变化） |
| `chain.evmBalances(account)` | （间接）若服务端把 MAG7 转 Spot 而非 EVM-Funding，此 key 变化较小 |
| `spot.accountState(account)` | Spot 账户 MAG7 增加（claim toClob=true 直达 Spot） |
| `vault.investInfo(account)` | 个人持仓视图变化 |
| `vault.mag7Balance(account)` | MAG7 链上余额变化 |
| `[...vault.all(), "activity"]` / `[...vault.all(), "myActivity"]` | ActivityTab 新增 claim 记录 |
| `["readContracts"]` / `["readContract"]` 前缀 | wagmi 链上 read 缓存（含 vault 页用 useReadContracts 的余额读取） |

---

## 术语表

| 术语 | 含义 |
|---|---|
| **CallForPermit** | EIP-712 链上签名授权第三方提交跨链/状态变更请求；vault claim 走 callForType=2 + toClob=true |
| **cooldown** | sMAG7 转回 MAG7 的 14 天锁定期；本 feature 是 cooldown 期满后的"兑现"操作 |
| **withdrawable** | `useVaultCooldown(address).data.withdrawable` —— cooldown 中已过期可领取的 MAG7 数量 |
| **sodex_call_for type=2** | 服务端 WS 推送事件类型；type=2 专属 claim 操作（type=1 涵盖 unstake/withdraw → MAG7） |
| **isAwaitingWalletSignature** | 仅覆盖 vault 自身签名节点（apiKey + claim permit）的等签名状态 |
| **needsStandaloneEnable** | 老用户（链上有 accountId）apiKey 失效时显示独立 Enable Claim 按钮的判断 |
| **probe (isAccountIdProbing)** | 链上账户存在性探测中；为防按钮态 flash，期间乐观视为老用户 |
| **CLAIM_MIN_AMOUNT** | 最低 claim 金额 = "4"（domain 常量，与 unstake "5" 不同） |
| **CLAIM_CALL_FOR_TYPE** | callForType 枚举值 = 2 |
| **VAULT_TOKEN_DECIMAL** | sMAG7/MAG7 链上精度 = 8 |
| **CLAIM_TX_CONFIRMATIONS** | receipt 等待确认数 = 3（由 clarify Q2 决策，infra 内常量；unstake/withdraw 复用 infra 时同步） |

---

## 更新记录

### 2026-04-30：初始版本

通过 `/k:context-learn` 从代码自动生成 + 人工补充关联引用。覆盖：
- 9 个 claim 相关源文件（dialog 3 + container 4 + service 1 + infra 1 + domain 1）
- 全部错误码（CLAIM_FAILED / CLAIM_TIMEOUT + 通用 kind）
- 完整流程 ASCII 图
- 6 项关键设计决策（无 smart-transfer / 错误码转换 / WS 驱动 / 延迟 invalidate / signer 锁 / 老用户 enable）
- 与 unstake 的字段差异对照（callForType / inAmount / minOutAmount / toClob / 资产来源 / 数据 hook）
- claim 作为基础设施被 unstake/withdraw 复用的边界说明
- **关联文档区**指向 `vault-notification` feature 9 个具体章节 + 2 份迁移 spec（toast/数据刷新基础设施由 vault-notification 集中维护，本 feature 仅作为消费方）
