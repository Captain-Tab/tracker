# Vault Unstake 完整流程

> Vault SLP 模块下的独立 Unstake 入口：用户把 EVM-Funding（或 Spot 兜底）里的 sMAG7.ssi 转回 MAG7.ssi，进入 14 天 cooldown 后由 claim 提取。
>
> 与 `withdraw → MAG7` 路径内嵌的 unstake 步骤不同——本 feature 是从 vault 页面 SLP 区域 "Unstake to MAG7.ssi" 入口触发的独立操作；底层都走 `sodex_call_for type=1`，但调用链不同。

---

## 关联文档

本 feature **不**自管 toast 与数据刷新——这两件事统一由 `vault-notification` feature 提供基础设施，本 feature 仅作为消费方调用。

| 关注点 | 关联文档 |
|---|---|
| **Toast 完整时序** | [`vault-notification` feature §4.3 — Withdraw → MAG7 / Unstake（双信号）](../../router/vault.json#vault-notification) |
| **Toast 具体文案 + helper 函数** | `vault-notification` feature §5（`notifyVaultWithdrawSuccess` 共享 helper） |
| **Pending toast 关闭机制** | `vault-notification` feature §6.2 — callFor pending 双路径关闭（Success / Failed） |
| **错误码体系（CALL_FOR_* → UNSTAKE_*）** | `vault-notification` feature §7.2 — 错误码转换链 |
| **错误 toast 映射全表** | `vault-notification` feature §7.3 — `handleUnstakeServiceError` |
| **数据刷新策略** | `vault-notification` feature §8 — `invalidateVaultMutationQueries`（17 query key + 3/5/9s 兜底） |
| **WS sodex_call_for 推送链路** | `vault-notification` feature §8.6 — 端到端链路（以 withdraw MAG7 为例，unstake 同链路） |
| **dedupe 机制** | `vault-notification` feature §9 — `notifiedCallForPendingIds / SuccessIds` |
| **Toast 规范源 spec（迁移历史）** | `.claude/kit/spec/vault-migration/unstake-toast.md` |
| **数据刷新源 spec（迁移历史）** | `.claude/kit/spec/vault-migration/data-refresh.md` |

> 阅读顺序建议：先读本 guide 理解 unstake 特有流程（smart-transfer + CallForPermit + signer 锁 + 老用户分支），再读 `vault-notification` feature 看 toast/数据刷新如何被驱动。

---

## 架构概览

```
┌────────────────────────────────────────────────────────────┐
│ vault SLP 区域 / VaultStats 入口                           │
│   useVaultSLPViewModel → safeTrigger(openVaultUnstakeDialog)│
└─────────────────────┬──────────────────────────────────────┘
                      │
                      ▼
┌────────────────────────────────────────────────────────────┐
│ VaultUnstakeDialog (壳层由 modalManager 提供)               │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ Alert(warning): 14-day lockup 提示                    │  │
│  │ NumberInput: amount + Max (sMAG7.ssi 链上余额)        │  │
│  │ helperText: deriveUnstakeHelperText(...)              │  │
│  │ LabelValue: You receive = `${amount} MAG7.ssi`        │  │
│  │ ─────────────────────────────────────────             │  │
│  │ if (needsStandaloneEnable):                           │  │
│  │    <Button>Enable Unstake</Button>                    │  │
│  │      └─ useEnableTrading.enableTrading()              │  │
│  │ else:                                                  │  │
│  │    <VaultUnstakeButton state isAwaitingWalletSig />   │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────┬──────────────────────────────────────┘
                      │ form.onSubmit → submit({ amount })
                      ▼
┌────────────────────────────────────────────────────────────┐
│ useSubmitVaultUnstake (mutation 编排)                       │
│                                                             │
│  onMutate: 锁 signer (getCurrentOnChainCapability)          │
│  ────────────────────────────────────────────────────       │
│  mutationFn:                                                │
│    1. 读取 EVM-Funding sMAG7 余额 (useEvmBalancesQuery)     │
│    2. if amount > evmSmag7:                                 │
│         smart-transfer Spot → Funding (trade.useSubmitTransfer)│
│         waitForEvmSmag7Balance (4.5s 轮询)                  │
│    3. setIsAwaitingWalletSignature(true)                    │
│    4. executeUnstakePermit(capability, input) ─┐           │
│         onSigned → setIsAwaitingWalletSignature(false)│     │
│  ────────────────────────────────────────────────────       │
│  onSuccess: setTimeout × 3 (3s/5s/9s)                       │
│              invalidateVaultMutationQueries(qc, account)    │
│  onError:   handleUnstakeServiceError(error)                │
└─────────────────────┬──────────────────────────────────────┘
                      │
                      ▼
┌────────────────────────────────────────────────────────────┐
│ vaultUnstakeService.executeUnstakePermit                    │
│                                                             │
│  1. getClaimNonce(account)        (复用 claim infra)        │
│  2. buildUnstakeCmd(amount):                                │
│       { chain: BASE_ETH, callForType: 1, toClob: false,     │
│         inCoinSymbol: sMAG7, outCoinSymbol: MAG7,           │
│         inAmount: parseUnits(amount, 8), minOutAmount: 0 }  │
│  3. buildUnstakePermitTypedData(...)  EIP-712               │
│  4. signCallForPermit(capability, typedData)  (复用)         │
│       └─ 用户签名 → input.onSigned?.()                      │
│  5. buildUnstakeCallForPermitRequest + postCallForPermit    │
│  6. waitForClaimReceipt(txHash) 3 confirmations  (复用)     │
│  ────────────────────────────────────────────────────       │
│  catch:                                                      │
│    mapInfraErrorToServiceError(err)                         │
│    if CALL_FOR_FAILED  → throw UNSTAKE_FAILED               │
│    if CALL_FOR_TIMEOUT → throw UNSTAKE_TIMEOUT              │
│    else throw mapped                                        │
└─────────────────────┬──────────────────────────────────────┘
                      │ 链上提交 + 服务端 cooldown 启动
                      ▼
┌────────────────────────────────────────────────────────────┐
│ 服务端处理 → WebSocket sodex_call_for type=1 推送           │
│  Pending → useDepositNotice 弹 "Withdrawing in progress..." │
│  Success → notifyVaultWithdrawSuccess(inAmount, sMAG7.ssi)  │
│             + invalidateVaultMutationQueries (单次,权威刷)  │
│  Failed  → "Withdraw failed"                                │
│  详见 vault-notification feature                            │
└────────────────────────────────────────────────────────────┘
```

---

## 核心逻辑

### useSubmitVaultUnstake — Container 编排

文件：`src/features/vault/containers/useSubmitVaultUnstake.ts:33-162`

```ts
export function useSubmitVaultUnstake(): {
  submit: (params: { amount: string }) => Promise<{ success: boolean; txHash?: string }>;
  isSubmitting: boolean;
  isAwaitingWalletSignature: boolean;  // 仅覆盖 vault 自身签名节点(apiKey + unstake permit)
  error: VaultServiceError | null;
  reset: () => void;
}
```

关键职责（仅一个 mutation 编排两层）：
1. `onMutate` — 启动一刻 `getCurrentOnChainCapability()` 锁 signer，避免后续等链上时用户切账号导致 onSuccess invalidate 落到错位 wallet
2. `mutationFn` —
   - 读 EVM-Funding sMAG7 余额（`useEvmBalancesQuery`，coin=`vsMAG7.ssi`）
   - **smart-transfer 触发条件**：`amount > evmSmag7` 时调 `trade.useSubmitTransfer({ from: "Spot", to: "Funding", coin: "vsMAG7.ssi", amount: diff })`
   - smart-transfer 后调 `waitForEvmSmag7Balance` 轮询直到余额到账（**4.5s 总窗口**，超时抛 `EVM_BALANCE_TIMEOUT`）
   - 调 `executeUnstakePermit(capability, input)` 完成 CallForPermit
3. `onSuccess` — 不弹 toast，3 次延迟 `invalidateVaultMutationQueries(qc, context.account)`（3s / 5s / 9s 兜底链上节点同步延迟）
4. `onError` — `handleUnstakeServiceError(error)` 按 kind 映射 toast

### executeUnstakePermit — Service 命令

文件：`src/features/vault/services/vaultUnstakeService.ts:42-98`

```ts
export async function executeUnstakePermit(
  capability: OnChainCapability,
  input: UnstakeInput & { account: Address; onSigned?: () => void },
): Promise<UnstakeResult>
```

5 步固定流程（全部复用 claim infra）：
1. `getClaimNonce(account)` — 链上读 nonce（`vaultClaimInfra`）
2. `buildUnstakeCmd(amount)` + `buildUnstakeDeadlineSeconds()` + `buildUnstakePermitTypedData(...)` — 组装 EIP-712 typed data
3. `signCallForPermit(capability, typedData)` → 触发 `input.onSigned?.()`（上层切 UI 从"等签名"到"等链上"）
4. `buildUnstakeCallForPermitRequest(...)` + `postCallForPermit(...)` → `txHash`
5. `waitForClaimReceipt(txHash)` — 等 3 confirmations

catch 分支错误码转换：
- `CALL_FOR_FAILED` → `UNSTAKE_FAILED`（带 txHash + message）
- `CALL_FOR_TIMEOUT` → `UNSTAKE_TIMEOUT`（带 txHash）
- 其他 → 透传 mapped error

> Service 内部已抛过的 `VaultServiceError`（如 `USER_REJECTED`）通过 `isServiceError` 直接 rethrow，不二次 map。

### waitForEvmSmag7Balance — Infra 轮询

文件：`src/features/vault/infra/chain/vaultUnstakeInfra.ts:37-57`

```ts
export async function waitForEvmSmag7Balance(input: {
  walletAddress: Address;
  targetAmount: string;  // decimal 字符串,如 "11.08"
}): Promise<void>
```

- **重试间隔**：`[500, 1000, 3000]` ms — 总窗口 4.5s
- **共 4 次读取**：t=0 立即读 1 次，然后 +0.5s / +1.5s / +4.5s 各读 1 次
- **链上 read**：`readContract(VSMAG7_TOKEN_ADDRESS, "balanceOf", [owner])` on `VALUE_CHAIN_MAINNET.id`，精度 `8`（`VSMAG7_DECIMALS` 硬编码，避免 infra import domain）
- 任一次 `current >= target` 立即 return；4 次都不达 target → 抛 `VaultInfraError { kind: "TX_TIMEOUT" }`，由 service catch 转 `EVM_BALANCE_TIMEOUT`

### useVaultUnstakeForm — 表单状态

文件：`src/features/vault/containers/useVaultUnstakeForm.ts:12-60`

```ts
export function useVaultUnstakeForm(input: { max: string }): {
  amount: string;
  onAmountChange: (next: string) => void;  // 含 8 位小数校验(VAULT_TOKEN_DECIMAL)
  onMax: () => void;                        // setAmount(input.max)
  reset: () => void;
  helperText: string | null;                // deriveUnstakeHelperText
  isValid: boolean;                          // isUnstakeAmountValid
  min: string;                               // 固定 "5"(UNSTAKE_MIN_AMOUNT 模块内常量)
  max: string;
}
```

- 最低金额 `5 sMAG7.ssi` 写死在 hook 内（不在 domain/constants）—— 仅 unstake 入口使用
- `onAmountChange` 用正则 `^\d*(\.\d{0,8})?$` 阻止超精度输入

### deriveUnstakeButtonState — 纯函数

文件：`src/features/vault/containers/unstakeFlowLogic.ts:11-26`

```ts
export function deriveUnstakeButtonState(input: {
  amount: string;
  min: string;
  max: string;
  isSubmitting: boolean;
}): ClaimButtonState  // { isSubmitting, disabled, helperText }
```

辅助纯函数：
- `deriveUnstakeHelperText({ amount, min, max })` — 返回 `null` / `"Invalid amount"` / `"Enter an amount"` / `"Minimum unstake is X sMAG7.ssi"` / `"Maximum X sMAG7.ssi"`
- `isUnstakeAmountValid(amount, min, max)` — 校验 `min ≤ amount ≤ max && amount > 0`

> 与 `claimFlowLogic` 几乎相同，差异在按钮 label（由 component 决定）和默认 min（claim min 不同）。

### handleUnstakeServiceError — Toast 映射

文件：`src/features/vault/containers/handleUnstakeServiceError.ts:6-68`

| `error.kind` | toast | 文案 |
|---|---|---|
| `USER_REJECTED` | — | **静默** 不弹 |
| `TRANSFER_FAILED` | `notify.error` | `Transfer to Funding failed: ${message}` 或 `Transfer to Funding failed` |
| `EVM_BALANCE_TIMEOUT` | `notify.warning` | `Pre-transfer submitted. Balance did not sync in time, please retry in a few seconds.` |
| `UNSTAKE_FAILED` | `notify.error` | `Unstake failed: ${message}` 或 `Unstake failed` |
| `UNSTAKE_TIMEOUT` | `notify.warning` | `Unstake submitted, waiting for on-chain confirmation. Check Activity tab later.`（带 txHash）/ `Unstake submitted, confirmation may take longer than usual.`（无 txHash） |
| `NETWORK_ERROR` | `notify.error` | `Network error, please check your connection` |
| `CHAIN_MISMATCH` | `notify.error` | `Wrong network, please switch to chain ${expected}` |
| 其他（fallthrough default） | `notify.error` | `error.message` 或 `Request failed, please try again` |

---

## 关键实现

### 1. CallForPermit EIP-712 typed data (callForType=1, toClob=false)

文件：`src/features/vault/domain/unstakePermit.ts:28-38`

```ts
export function buildUnstakeCmd(amount: string): ClaimCmd {
  return {
    chain: "BASE_ETH",                                // 跨链协议字段(目标链)
    callForType: UNSTAKE_CALL_FOR_TYPE,               // = 1 (UNSTAKE)
    inCoinSymbol: standardizeMag7Symbol("sMAG7"),     // → "vsMAG7.ssi"(链上 symbol)
    inAmount: parseUnits(amount, VAULT_TOKEN_DECIMAL).toString(),  // 8 位精度
    outCoinSymbol: standardizeMag7Symbol("MAG7"),     // → "vMAG7.ssi"
    minOutAmount: "0",                                // unstake 不限制最小返回
    toClob: false,                                    // 进 cooldown,不直达 spot
  };
}
```

与 claim 的关键差异：
| 字段 | unstake | claim |
|---|---|---|
| `callForType` | 1 | 2 |
| `inCoinSymbol` → `outCoinSymbol` | sMAG7 → MAG7 | sMAG7 → MAG7 |
| `toClob` | **false**（进 cooldown） | true（直达 Spot） |
| 完成路径 | 服务端启 14-day cooldown | 服务端立刻把 MAG7 转到 EVM-Funding |

### 2. Smart-transfer 触发条件 + boundaries 限制

```ts
// useSubmitVaultUnstake.ts:86-120
const evmSmag7 = evmBalances.data?.find((b) => b.coin === "vsMAG7.ssi")?.available ?? "0";
if (new Decimal(params.amount).gt(new Decimal(evmSmag7))) {
  const diff = new Decimal(params.amount).sub(evmSmag7).toString();
  await doTransfer({ from: "Spot", to: "Funding", coin: "vsMAG7.ssi", amount: diff });
  await waitForEvmSmag7Balance({ walletAddress: account, targetAmount: params.amount });
}
```

**为什么放在 Container 而非 Service？**
- Service 硬规则禁止跨 feature import（`features/vault/services/*` 不能 import `features/trade/services/*`）
- `trade.submitTransfer` 不暴露 service 函数，只暴露 container hook `useSubmitTransfer`
- → smart-transfer 编排只能在 vault container 层做，service 仅做单一 CallForPermit 责任

`trade.useSubmitTransfer` 自带 toast：
- 提交时：`Submitting transfer...` (loading)
- 成功：`Transfer successful` (success)
- 失败：error toast

→ vault unstake 只承接其 Promise resolve/reject，不重复弹 toast；其错误经 try/catch 包装成 `TRANSFER_FAILED`。

### 3. signer 锁（防钱包切换）

`onMutate` 调 `getCurrentOnChainCapability()` 快照 `signerAddress` 写入 mutation context，`mutationFn` 内紧邻再次读取（中间无 await）保证两者一致。

```ts
// useSubmitVaultUnstake.ts:55-67 (onMutate)
const onChain = getCurrentOnChainCapability();
if (!onChain) throw { kind: "UNKNOWN", message: "Wallet not connected" };
return { account: onChain.signerAddress };

// onSuccess 用 context.account 做 invalidate,确保落到原账号
```

中途用户换钱包 → `wagmi.signTypedData` 在 step 4 自然失败抛 `USER_REJECTED`（钱包不匹配）；不会沉默落到错位 wallet。

### 4. 两段 UI 状态：等签名 vs 等链上

`isAwaitingWalletSignature` 是独立 useState，仅在 vault 自身两个签名节点（apiKey 触发 + unstake permit）期间为 true：

```ts
// useSubmitVaultUnstake.ts:122-132
setIsAwaitingWalletSignature(true);
try {
  return await executeUnstakePermit(onChain, {
    amount: params.amount,
    account,
    onSigned: () => setIsAwaitingWalletSignature(false),  // 签名完成 → 切到"等链上"
  });
} finally {
  setIsAwaitingWalletSignature(false);  // 兜底
}
```

UI 层（`VaultUnstakeButton`）按状态显示：
| 条件 | 按钮文案 |
|---|---|
| `isAwaitingWalletSignature` | `walletAction`（来自 `useWalletSigningText`，根据钱包类型动态文案） |
| `state.isSubmitting`（链上等待 / smart-transfer 中） | `Submitting...` |
| 输入合法 | `Unstake` |

**注意**：smart-transfer 阶段是 trade feature 自己的签名 UX（trade 内部按钮文案），vault 的 `isAwaitingWalletSignature` 不覆盖此阶段。

### 5. 老用户独立 Enable Unstake 按钮

```tsx
// VaultUnstakeDialog/index.tsx:48-52
const hasAccount = isAccountIdProbing || !!accountId;  // probe 中乐观视为老用户(防 flash)
const needsStandaloneEnable =
  !isWatching && hasAccount && (!isAuthenticated || !apiKeyValid);
```

- **新用户（链上无 accountId）**：vault callForPermit 后端走 `bizClient`（不带 JWT/apiKey），仅依赖链上签名 + 链上 nonce 校验，**无需 enable trading 即可 unstake**
- **老用户（链上有 accountId）但 apiKey 失效**：显示独立 `Enable Unstake` 按钮，调 `useEnableTrading.enableTrading()` 走 embedded 签名（不叠 AuthStepsModal，因弹窗内钱包必然已连）
- **probe 中 (`isAccountIdProbing`)**：乐观视为老用户，避免 probe 完成时按钮从默认态 flash 到 Enable 态
- **watch 模式 (admin 观察其他账户)**：`isWatching` 为 true，admin 自己的 apiKey 与被观察账户不匹配，Enable 无意义，直接关闭分支显示默认 `Unstake` 按钮

### 6. 余额来源 + Privy 邮箱用户兼容

```tsx
// VaultUnstakeDialog/index.tsx:36-37
const balance = useVaultMag7Balance(address ?? undefined);
const totalSmag7 = balance.data?.valueChain.sMag7 ?? "0";
```

- `address` 来自 `useAuthState()`（不是 `useAccount()`）—— Privy 邮箱用户的 embedded wallet 不一定立刻进 wagmi，但 auth state 派生的 address 在 Privy 登陆完成后即可用
- `useVaultMag7Balance` 查 ValueChain 上的 sMAG7（合约 `VSMAG7_TOKEN_ADDRESS`，精度 8）
- 加载中显示 `<VaultUnstakeSkeleton />` 占位（4 行 pulse 块）

---

## 文件结构

```
src/features/vault/
├── components/dialogs/VaultUnstakeDialog/
│   ├── index.tsx                          UI 主入口 + openVaultUnstakeDialog opener
│   ├── VaultUnstakeButton.tsx             3 态按钮(等签名 / 提交中 / 默认)
│   └── VaultUnstakeSkeleton.tsx           4 行 pulse 占位
│
├── containers/
│   ├── useSubmitVaultUnstake.ts           mutation 编排(smart-transfer + CallForPermit)
│   ├── useVaultUnstakeForm.ts             表单 state(amount + helperText + isValid)
│   ├── unstakeFlowLogic.ts                纯函数(deriveUnstakeButtonState/HelperText/isValid)
│   └── handleUnstakeServiceError.ts       error.kind → toast 文案映射
│
├── services/
│   └── vaultUnstakeService.ts             executeUnstakePermit(纯链路,catch 内 CALL_FOR_*→UNSTAKE_*)
│
├── infra/chain/
│   └── vaultUnstakeInfra.ts               waitForEvmSmag7Balance(4.5s 轮询)
│
└── domain/
    └── unstakePermit.ts                   EIP-712 typed data + cmd encode + request body
```

**复用**（同 feature 内 import，无 boundaries 问题）：
- `infra/chain/vaultClaimInfra.ts` — `getClaimNonce` / `signCallForPermit` / `waitForClaimReceipt`
- `infra/api/vaultApi.ts` — `postCallForPermit`
- `domain/claimPermit.ts` — `ClaimCmd` / `CallForPermitRequestBody` / `CallForPermitTypedData` 类型
- `domain/symbols.ts` — `standardizeMag7Symbol`
- `domain/constants.ts` — `VAULT_TOKEN_DECIMAL` / `UNSTAKE_CALL_FOR_TYPE` / `CALL_FOR_PERMIT_*`
- `services/mapInfraError.ts` — `mapInfraErrorToServiceError`

**跨 feature**（仅通过 public API）：
- `@/features/auth` — `useAuthState`, `useEnableTrading`, `getCurrentOnChainCapability`, `OnChainCapability` type, `useWalletSigningText`
- `@/features/trade` — `useEvmBalancesQuery`, `useSubmitTransfer`
- `@/shared/utils/invalidateVaultMutationQueries` — 17 query key 统一刷新（详见 `vault-notification` feature）

---

## 关键设计决策

### 1. Smart-transfer 在 Container 不在 Service

**为什么**：boundaries 硬规则禁止 `features/vault/services/*` import 跨 feature 的 service。trade 的转账逻辑只暴露 container hook（`useSubmitTransfer`），所以 vault 必须在 container 层编排。

**收益**：service 责任单一（仅 CallForPermit 一条链），smart-transfer 是"业务流程"层而非"领域"层，归 container 合理。

### 2. CALL_FOR_*→UNSTAKE_* 错误码转换在 service catch 内

**为什么**：`mapInfraError` 输出通用 `CALL_FOR_FAILED` / `CALL_FOR_TIMEOUT`（infra 不知道业务上下文），如果直接传给 `handleUnstakeServiceError` 会暴露语义错位的错误码（unstake 流程不应出现 `CLAIM_TIMEOUT`）。

**实现**：`vaultUnstakeService.catch` 转换为 `UNSTAKE_FAILED` / `UNSTAKE_TIMEOUT`，外部 handler 只 case 业务专有 kind + 通用 kind（`USER_REJECTED` / `NETWORK_ERROR` / `CHAIN_MISMATCH`）。

同模式应用于 `vaultClaimService` (CALL_FOR → CLAIM_*) 和 `vaultWithdrawService` (CALL_FOR → WITHDRAW_REDEEM_* / UNSTAKE_*)。

### 3. 不主动起 success toast，等 WS 推送驱动

**为什么**：链上 tx receipt 上链 ≠ 真完成——服务端还要启 14-day cooldown，资产对账后才推 `sodex_call_for type=1 Success`。

**实现**：`onSuccess` 不调 `notify.success`；`useDepositNotice`（trade feature，App 顶层挂载）监听 `lastCallForEvent` 状态，按 `callForType=1` + `executeStatus` 弹 `Withdrawing in progress...` / `Withdraw X.XX sMAG7.ssi successfully.` / `Withdraw failed`。

> 完整时序对照、helper 函数实现、pending toast 关闭机制 → 查 `vault-notification` feature §4.3 / §5 / §6.2。本地错误（`UNSTAKE_FAILED` / `UNSTAKE_TIMEOUT` / `TRANSFER_FAILED` / `EVM_BALANCE_TIMEOUT`）的 toast 文案映射 → 查 §7.3。

### 4. 3 次延迟 invalidate（3s / 5s / 9s）

**为什么**：mutation onSuccess 时链上 receipt 已 confirm，但 ValueChain RPC 节点可能未把最新区块 propagate 完毕，立即 refetch 会读旧数据。

**3/5/9 三档**：
- 3s — 覆盖 ValueChain 节点常见同步延迟
- 5s — 超过 RQ staleTime（默认 5s），保证再 fetch 一次
- 9s — 节点几乎一定同步完成，最终保险

React Query 5s staleTime 内对同一 key 的多次 invalidate 自动 dedupe，不会重复 fetch。WS sodex_call_for Success 推送也会再 invalidate 一次（权威刷），双路重叠不会有性能问题。

### 5. signer 锁 + Privy 邮箱用户兼容

`onMutate` 用 `getCurrentOnChainCapability()` 快照 signerAddress，避免 mutation 期间用户切账号导致 invalidate 落到错位 wallet。Container 余额查询用 `useAuthState().address` 而非 `useAccount()`，覆盖 Privy embedded wallet 场景（Privy 登陆后 `address` 立即可用，但 wagmi 需要等 embedded wallet 注册）。

### 6. 老用户 enable_unstake 独立按钮（embedded，不叠 AuthStepsModal）

**为什么**：unstake 弹窗内钱包必然已连（外部已经 connect 过），叠 AuthStepsModal 第 1 步会显示 "已连接钱包" 占位，体验冗余。

**实现**：`useEnableTrading()`（embedded mode）直接走第 2 步签名，跳过 step 1。

---

## 开发修改指南

### 新增错误码

1. 在 `domain/types.ts` `VaultServiceError` union 追加 `{ kind: "UNSTAKE_NEW_KIND"; ... }`
2. `vaultUnstakeService.catch` 增加分支抛新 kind
3. `handleUnstakeServiceError` 增加 case 映射 toast
4. **同步更新 `isServiceError`** 的 kind 白名单（否则会被当成普通 error 二次 map）
5. 同步 `handleClaimServiceError` / `handleWithdrawServiceError` / `handleDepositServiceError` 的 fallthrough 列表（否则跨业务调用时缺 case TS 报错）

### 修改 smart-transfer 触发逻辑

只改 `useSubmitVaultUnstake.ts:86-120`。如需改余额来源（如检查 Funding + Spot 合并余额），调整 `evmBalances.data.find` 逻辑。

### 修改最低 unstake 金额

只改 `useVaultUnstakeForm.ts:10` 的 `UNSTAKE_MIN_AMOUNT` 常量。helperText 和 button disabled 自动联动。

> 该常量未提到 `domain/constants.ts` 因为仅 unstake 入口使用；如未来 withdraw → MAG7 路径也要同步限制再提取。

### 修改 toast 文案

- 本地错误（`UNSTAKE_FAILED` / `UNSTAKE_TIMEOUT` / `TRANSFER_FAILED` 等）：改 `handleUnstakeServiceError`（本 feature 内）
- WS 推送 success / pending / failed：改 `features/trade/containers/useDepositNotice.ts` 的 `notifyVaultWithdrawSuccess` / type=1 pending 文案 / failed 文案 → 这是 `vault-notification` feature 的边界，改前请阅读其 §5（helper 共用：unstake + withdraw → MAG7）

### 修改 4.5s 轮询窗口

只改 `vaultUnstakeInfra.ts:31` 的 `RETRY_INTERVALS`（如改成 `[500, 1000, 2000, 5000]` 即 t=0,0.5,1.5,3.5,8.5s 共 5 次读取）。注意 `EVM_BALANCE_TIMEOUT` toast 文案中的 "4.5s" 字串需同步改。

### 修改 callForType / toClob

`buildUnstakeCmd` 字段调整。注意 service catch 内 `CALL_FOR_*→UNSTAKE_*` 转换是按 unstake 业务语义写死的；如改 callForType 为其他值（不再是 unstake），整个 service 应改名重写。

---

## 数据更新对接

完成后的数据刷新走 `invalidateVaultMutationQueries`（实现位于 `src/shared/utils/invalidateVaultMutationQueries.ts`，由 `vault-notification` feature 维护，详见该 feature §8 全清单）：

| 时机 | 调用位置 | 策略 | 说明 |
|---|---|---|---|
| mutation onSuccess（receipt confirm） | `useSubmitVaultUnstake.ts:134-148` | 3 次 setTimeout（3s / 5s / 9s） | 兜底 ValueChain 节点同步延迟（见 vault-notification §8.3） |
| WS sodex_call_for type=1 Success | `useDepositNotice.ts:155` | 单次（推送到达时链上数据已稳定） | 服务端真落账时权威刷（见 vault-notification §8.6） |

双路重叠：React Query 5s staleTime 内对同一 key 的多次 `invalidateQueries` 自动 dedupe，不会重复 fetch（见 vault-notification §8.5）。

刷新覆盖 17 个 query key（vault.* / chain.evmBalances / spot.accountState / wagmi readContracts/readContract 前缀）—— 完整清单见 `vault-notification` feature §8.4。

**unstake 流程对清单中 query key 的具体影响**：

| query key | 影响 |
|---|---|
| `chain.evmBalances(account)` | EVM-Funding sMAG7 减少（unstake 进 cooldown） |
| `vault.cooldown(account)` | cooldown 数额增加（独立 unstake 入口的核心 UI 反馈） |
| `vault.investInfo(account)` | 持仓视图（MyPositionTab）变化 |
| `vault.mag7Balance(account)` | sMAG7 链上余额减少 |
| `[...vault.all(), "activity"]` / `[...vault.all(), "myActivity"]` | ActivityTab 新增 unstake 记录 |
| `[...vault.all(), "navCurve"]` / `[...vault.all(), "depositors"]` | 全局图表列表（不直接由 unstake 改变，但作为统一刷新覆盖） |
| `["readContracts"]` / `["readContract"]` 前缀 | wagmi 链上 read 缓存（含 vault 页用 useReadContracts 的余额读取） |

---

## 术语表

| 术语 | 含义 |
|---|---|
| **Smart-transfer** | unstake 前若 EVM-Funding sMAG7 余额不足，自动调 Spot → Funding 转账补差额（trade feature 提供） |
| **CallForPermit** | EIP-712 链上签名授权第三方提交跨链/状态变更请求；vault unstake 走 callForType=1 + toClob=false |
| **cooldown** | sMAG7 转回 MAG7 的 14 天锁定期；期间持仓在 vault 内但不能动用，结束后通过 claim 提取 |
| **sodex_call_for type=1** | 服务端 WS 推送事件类型；type=1 涵盖 unstake 与 withdraw → MAG7 路径（call_for 视角共用 inCoinSymbol=sMAG7） |
| **isAwaitingWalletSignature** | 仅覆盖 vault 自身签名节点（apiKey + unstake permit）的等签名状态；smart-transfer 阶段由 trade 自管 |
| **needsStandaloneEnable** | 老用户（链上有 accountId）apiKey 失效时显示独立 Enable Unstake 按钮的判断 |
| **probe (isAccountIdProbing)** | 链上账户存在性探测中；为防按钮态 flash，期间乐观视为老用户 |
| **VAULT_TOKEN_DECIMAL** | sMAG7/MAG7 链上精度 = 8（与老项目一致） |
| **UNSTAKE_CALL_FOR_TYPE** | callForType 枚举值 = 1 |

---

## 更新记录

### 2026-04-30：初始版本

通过 `/k:context-learn` 从代码自动生成 + 人工补充关联引用。覆盖：
- 10 个 unstake 相关源文件（dialog 3 + container 4 + service 1 + infra 1 + domain 1）
- 全部错误码（UNSTAKE_FAILED / UNSTAKE_TIMEOUT / TRANSFER_FAILED / EVM_BALANCE_TIMEOUT + 通用 kind）
- 完整流程 ASCII 图
- 6 项关键设计决策（boundaries / 错误码转换 / WS 驱动 / 延迟 invalidate / signer 锁 / 老用户 enable）
- smart-transfer 触发条件 + 4.5s 轮询策略
- 与 vault-notification / claim / withdraw → MAG7 的关系说明
- **关联文档区**指向 `vault-notification` feature 9 个具体章节 + 2 份迁移 spec（toast/数据刷新基础设施由 vault-notification 集中维护，本 feature 仅作为消费方）
