# Vault Deposit 完整流程

> Vault SLP 模块的 Deposit 入口：用户从 Base 链或 Value 链向 Vault 存入 MAG7.ssi/sMAG7.ssi，根据来源链不同走 1-2-3 个阶段（Base / EnableTrading / Value）。
>
> **vault module 最复杂 feature**：3 层 reducer 状态机 + effect driver + 不建 Service 的特殊架构 + 跨 feature 编排（trade.useSubmitTransfer / auth.ensureExchangeCapability / auth.waitForAccountReady）+ 3 屏切换（idle / preview / trading）+ Auto-fill 双 ref 防误报 + RETRY 缓存复用签名。

---

## 关联文档

本 feature **不**自管 toast 与数据刷新——这两件事统一由 `vault-notification` feature 提供基础设施，本 feature 仅作为消费方调用。

| 关注点 | 关联文档 |
|---|---|
| **Deposit Toast 完整时序（17 个阶段）** | [`vault-notification` feature §4.1 — Deposit（单信号）](../../router/vault.json#vault-notification) |
| **`notifyVaultDepositCompleted` helper** | `vault-notification` feature §5（顶层 machine completed 时调用，文案 `Deposited X MAG7.ssi into vault`） |
| **WS sodex_deposit Pending/Success 推送** | `vault-notification` feature §3 / §4.1（**Base 链桥接**触发 WS pending → "5 MAG7.ssi deposit pending"，桥接成功 WS Success → "Deposit 5 MAG7.ssi successfully"，**与 vault completion toast 共存于不同时机**） |
| **Pending toast 关闭机制（双路径兜底）** | `vault-notification` feature §6.1 — `closeNotify` + WS Success 路径 / vault completion 路径 |
| **错误码体系（DEPOSIT_*）** | `vault-notification` feature §7.1 — VaultServiceError DEPOSIT_* 全集 |
| **错误 toast 映射全表** | `vault-notification` feature §7.3 — `handleDepositServiceError`（13 case） |
| **数据刷新策略** | `vault-notification` feature §8 — `invalidateVaultMutationQueries`（17 query key + 3/5/9s 兜底；deposit 单路无 WS sodex_call_for） |
| **dedupe 机制** | `vault-notification` feature §9 — `notifiedPendingIds / SuccessIds` |
| **Toast 规范源 spec（迁移历史）** | `.claude/kit/spec/vault-migration/deposit-toast.md` |
| **数据刷新源 spec（迁移历史）** | `.claude/kit/spec/vault-migration/data-refresh.md` |
| **业务规范（4 段 spec）** | `.claude/kit/spec/vault-migration/05a-deposit-foundation.md` / `05b-deposit-ui.md` / `05c-deposit-logic.md`（设计阶段产物，迁移完成后查代码而非这些 spec） |

> 阅读顺序建议：先读本 guide §状态机模型理解 3 层 reducer + 阶段流转，再读 §核心实现看 effect driver 防重入设计，最后查 `vault-notification` feature 看 toast 如何在 WS 推送 + machine 完成两路被驱动。

---

## 业务路径

| 场景 | needsBaseChain | isNewUser | needsTransfer | needsStake | 阶段流 |
|---|---|---|---|---|---|
| 新用户 Base 链存款 | ✅ | ✅ | ✅(force SPOT)| ❌(vault 内部 stake) | Base → EnableTrading → Value |
| 老用户 Base 链存款 | ✅ | ❌ | ✅(force SPOT)| ❌ | Base → Value |
| Value 链 Spot 存款 | ❌ | ❌ | ✅ | ❌ | Value(transfer + permit + confirm) |
| Value 链 EVM-Funding 存款 | ❌ | ❌ | ❌ | ❌ | Value(permit + confirm) |

**关键**：
- **`needsStake` 永远 false**：当前实现 vault 合约内部处理 vMAG7→vsMAG7 转换（对齐老项目 external staking 已注释）。代码里 `staking` state 仍保留但实际不走（`decideValueChainConfig` 恒返回 `needsStake: false`）
- **Base 链 `from` 强制 SPOT**：bridge 后资金到 Spot 账户（`DEPOSIT_TO_CLOB = true` 表示 toClob），所以 Value 链子机的 `from` 在 Base 路径下被强制为 SPOT
- **新用户 isNewUser 锁定**：`onMutate` 时快照（`useVaultDepositForm` 用 `isFirstTimeUser = isAccountIdProbing || !accountId`），完成 EnableTrading 后链上有了 accountId 不会让面板消失

---

## 架构总览

```
┌──────────────────────────────────────────────────────────────────────┐
│ vault SLP/Stats/Header 入口                                           │
│   useVaultSLPViewModel / VaultHeader → openVaultDepositDialog(input?) │
└─────────────────────────┬────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────────────┐
│ VaultDepositDialogContainer                                           │
│   tradingStatus state: 'idle' | 'preview' | 'trading'                 │
│   ┌──────────┬──────────┬──────────┐                                  │
│   │ idle     │ preview  │ trading  │                                  │
│   │ <Form>   │<Preview> │<Trading> │                                  │
│   └──────────┴──────────┴──────────┘                                  │
│   useSubmitVaultDeposit() (mutation 编排)                              │
│   useVaultDepositForm()   (表单 + 余额 + auto-fill)                    │
└─────────────────────────┬────────────────────────────────────────────┘
                          │ submit({ chain, token, from, amount, account, isNewUser })
                          ▼
┌──────────────────────────────────────────────────────────────────────┐
│ useSubmitVaultDeposit (Outer Container)                               │
│   - 持有 useVaultDepositMachine(input, callbacks)                      │
│   - callbacks 桥接跨 feature:                                          │
│     · onTransferNeeded   → trade.useSubmitTransfer                    │
│     · onEnableTrading    → auth.waitForAccountReady + ensureExchangeCapability │
│     · onSuccess          → notifyVaultDepositCompleted + 3 次延迟 invalidate │
│     · onError            → handleDepositServiceError + Try Again 显示 │
│     · onBaseChainCompleted → 占位(WS sodex_deposit Success 已弹 toast)│
│   - 派生 isAwaitingWalletSignature(approving / confirm_signing)        │
│   - retry / reset / showTryAgain / closeNotify 兜底                    │
└─────────────────────────┬────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────────────┐
│ useVaultDepositMachine (Inner Container - reducer + effect driver)    │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │ 3 个 useReducer + 6 个 useRef:                                │    │
│  │   topState / baseState / valueState (各自独立 reducer)         │    │
│  │   prevTopKindRef / prevBaseKindRef / prevValueKindRef (防重入) │    │
│  │   isUnmountedRef / abortRef / resolvedBridgeAddrRef           │    │
│  │   approveTxHashRef / approveSignatureRef / approveDeadlineRef │    │
│  │   confirmPayloadRef                                            │    │
│  └──────────────────────────────────────────────────────────────┘    │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │ 3 个 useEffect drivers(top / base / value):                   │    │
│  │   - 比较 prev*KindRef === state.kind → 跳过(防 StrictMode 双跑)│    │
│  │   - 跨 await checkUnmounted() → 不 dispatch                   │    │
│  │   - try/catch → mapCauseToDepositError → dispatch FAILED      │    │
│  └──────────────────────────────────────────────────────────────┘    │
└────────────┬─────────────────────────────┬────────────────┬──────────┘
             │ Top: idle/base/eT/value/    │                │
             ▼ completed/failed             │                │
┌────────────────────┐  ┌────────────────────┐  ┌────────────────────┐
│ Base Chain Reducer │  │ Value Chain Reducer│  │ Top Reducer        │
│ (BaseChainState)   │  │ (ValueChainState)  │  │ (TopState)         │
│  idle              │  │  idle              │  │  idle              │
│  →checking_allowance│  │  →transferring     │  │  →base_chain_phase │
│  →approving        │  │  →staking(skipped) │  │  →enable_trading   │
│  →approve_confirming│  │  →approving        │  │  →value_chain_phase│
│  →approve_completed│  │  →approve_completed│  │  →completed        │
│  →bridge_confirming│  │  →confirm_signing  │  │  →failed           │
│  →bridge_settling  │  │  →confirm_proceeding│ │                    │
│  →completed/failed │  │  →completed/failed │  │                    │
└──────────┬─────────┘  └──────────┬─────────┘  └────────────────────┘
           │                        │
           ▼                        ▼
┌────────────────────────────────────────────────────────────────────┐
│ Infra atomic functions(11 个)                                       │
│  Base 链:                                                            │
│   - readBaseBridgeAddress(coinSymbol)         懒加载 bridge 地址     │
│   - readErc20Decimals({coinAddr})              ERC20 decimals       │
│   - checkErc20Allowance({owner,coin,bridge})   approve 前置          │
│   - approveErc20(cap, {coin,bridge,amount})    approve tx           │
│   - waitBaseReceipt({txHash, confirmations})   等链上确认            │
│   - bridgeToValueChain(cap, {bridge,coin,recv,amount,toClob})       │
│   - pollBridgeSettle({bridgeTxHash})           轮询 settle          │
│  Value 链:                                                           │
│   - getTokenPermitNonce({tokenAddr, account})                       │
│   - readTokenPermitDomain({tokenAddr})                              │
│   - signEip712TypedData(cap, typedData)                             │
│   - getDepositCallForPermitNonce({account})                         │
│   - submitDepositPermit(request) → txHash                           │
│   - waitValueReceipt({txHash, confirmations})                       │
│   - stakeVaultToken(cap, {...}) 当前不调用(needsStake=false)         │
└────────────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────────────┐
│ 链上提交 + Base 桥接事件(WS sodex_deposit pending/success)           │
│  Bridge → 服务端处理 → WS 推送                                         │
│  pending → useDepositNotice 弹 "5 MAG7.ssi deposit pending"          │
│  success → useDepositNotice 弹 "Deposit 5 MAG7.ssi successfully"     │
│                                                                       │
│ Value chain CallForPermit confirm → topState completed                │
│  → onSuccess → notifyVaultDepositCompleted "Deposited X MAG7.ssi into vault" │
│  → 3 次延迟 invalidateVaultMutationQueries(3s/5s/9s)                  │
│  详见 vault-notification feature                                      │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 状态机模型（3 层 reducer）

### Top Reducer — 阶段协调

```ts
type TopState =
  | { kind: "idle" }
  | { kind: "base_chain_phase" }
  | { kind: "enable_trading" }
  | { kind: "value_chain_phase" }
  | { kind: "completed"; txHash?: `0x${string}` }
  | { kind: "failed"; phase: "base_chain"|"value_chain"|"enable_trading"; error: VaultServiceError };

type TopConfig = { needsBaseChain: boolean; isNewUser: boolean };
```

转换矩阵（详见 `domain/depositStateMachine.ts:46-102`）：

| 当前 | Action | 条件 | 下一状态 |
|---|---|---|---|
| `idle` | START | `needsBaseChain=true` | `base_chain_phase` |
| `idle` | START | `needsBaseChain=false` | `value_chain_phase` |
| `base_chain_phase` | BASE_CHAIN_COMPLETED | `isNewUser=true` | `enable_trading` |
| `base_chain_phase` | BASE_CHAIN_COMPLETED | `isNewUser=false` | `value_chain_phase` |
| `base_chain_phase` | BASE_CHAIN_FAILED | — | `failed("base_chain")` |
| `enable_trading` | ENABLE_TRADING_COMPLETED | — | `value_chain_phase` |
| `enable_trading` | ENABLE_TRADING_FAILED | — | `failed("enable_trading")` |
| `value_chain_phase` | VALUE_CHAIN_COMPLETED | — | `completed` |
| `value_chain_phase` | VALUE_CHAIN_FAILED | — | `failed("value_chain")` |
| `failed` | RETRY | — | 对应 phase（按 state.phase 回到原阶段）|
| `completed` / `failed` | RESET | — | `idle` |

### Base Chain Reducer — 桥接子机

```ts
type BaseChainState =
  | { kind: "idle" }
  | { kind: "checking_allowance" }
  | { kind: "approving"; allowance: bigint }
  | { kind: "approve_confirming"; txHash }
  | { kind: "approve_completed"; txHash? }
  | { kind: "bridging" }
  | { kind: "bridge_confirming"; txHash }
  | { kind: "bridge_settling"; bridgeTxHash; approveTxHash? }
  | { kind: "completed"; approveTxHash?; bridgeTxHash }
  | { kind: "failed"; step: "approve"|"confirm"; error; cache: BaseChainCache };
```

**RETRY 复用规则**（`baseChainReducer:272-284`）：
- `step="approve" failed` → 回 `checking_allowance`（重新检查 allowance）
- `step="confirm" failed` → 回 `approve_completed`（**保留 `approveTxHash`**，直接进 bridge，不重新签 approve）

`BaseChainCache` 缓存中间产物：`allowance / needsApprove / approveTxHash / bridgeTxHash`。

### Value Chain Reducer — 提交子机

```ts
type ValueChainState =
  | { kind: "idle" }
  | { kind: "transferring" }
  | { kind: "staking" }              // 实际 needsStake=false 不会进入
  | { kind: "stake_confirming"; txHash }
  | { kind: "approving" }
  | { kind: "approve_completed"; signature: { v, r, s }; deadline: number }
  | { kind: "confirm_signing" }
  | { kind: "confirm_proceeding" }
  | { kind: "completed"; txHash? }
  | { kind: "failed"; stepName: ValueChainStepName; stepIndex; error; cache: ValueChainCache };

type ValueChainConfig = { needsTransfer: boolean; needsStake: boolean };
type ValueChainStepName = "transfer" | "stake" | "approve" | "confirm";
```

**RETRY 复用规则**（`valueChainReducer:474-497`）：
- `stepName="transfer"` → 回 `transferring`（从头）
- `stepName="stake"` → 回 `staking`（不回 transfer，资金已到 EVM-Funding）
- `stepName="approve"` → 回 `approving`
- `stepName="confirm"` →
  - **若 `cache.approveSignature` + `approveDeadline > now`** → 回 `approve_completed`（**复用签名**直接进 confirm）
  - 否则 → 回 `approving`（重签）

`ValueChainCache` 缓存中间产物：`transferData / stakeData / approveSignature{v,r,s} / approveDeadline`。

### deriveValueChainSteps — 步骤列表派生

```ts
// domain/depositStateMachine.ts:512-520
function deriveValueChainSteps(config: ValueChainConfig): ValueChainStepName[] {
  const steps: ValueChainStepName[] = [];
  if (config.needsTransfer) steps.push("transfer");
  if (config.needsStake)    steps.push("stake");      // 当前不会 push(needsStake=false)
  steps.push("approve", "confirm");
  return steps;
}
```

输出 step 数组用于 `stepIndex` 计算 + UI step list 渲染。

---

## 核心逻辑

### useVaultDepositMachine — Reducer + Effect Driver（最复杂部分）

文件：`src/features/vault/containers/deposit/useVaultDepositMachine.ts:122-778`（~860 行）

**职责**：
- 持 3 个 reducer（top / base / value）
- 按状态变更驱动 infra atomic 异步调用
- 暴露 `{ start, retry, reset, topState, baseState, valueState, failedPhase, isRunning }`

**3 个 effect drivers**：

```ts
// Top driver: 进入/切换阶段时触发子机 START 或外层回调
useEffect(() => {
  if (prevTopKindRef.current === topState.kind) return;
  const prevTopKind = prevTopKindRef.current;  // 保存旧值
  prevTopKindRef.current = topState.kind;

  if (topState.kind === "base_chain_phase") {
    prevBaseKindRef.current = undefined;       // 重置子机防重入 key
    dispatchBase({ type: "START" });
  }
  if (topState.kind === "value_chain_phase") {
    prevValueKindRef.current = undefined;
    if (prevTopKind === "base_chain_phase") {
      callbacksRef.current.onBaseChainCompleted?.();  // base 完成回调
    }
    dispatchValue({ type: "START" });
  }
  if (topState.kind === "enable_trading") {
    if (prevTopKind === "base_chain_phase") {
      callbacksRef.current.onBaseChainCompleted?.();
    }
    void runEnableTradingAsync();
  }
  if (topState.kind === "completed") {
    callbacksRef.current.onSuccess?.(topState.txHash);
  }
  if (topState.kind === "failed") {
    callbacksRef.current.onError?.(topState.error, topState.phase);
  }
}, [topState]);

// Base driver: 仅在 top.base_chain_phase 内,按 baseState 跑 atomic
useEffect(() => {
  if (topState.kind !== "base_chain_phase") return;
  if (prevBaseKindRef.current === baseState.kind) return;
  prevBaseKindRef.current = baseState.kind;
  void runBaseChainState(baseState);
}, [baseState, topState.kind]);

// Value driver: 仅在 top.value_chain_phase 内,按 valueState 跑 atomic
useEffect(() => {
  if (topState.kind !== "value_chain_phase") return;
  if (prevValueKindRef.current === valueState.kind) return;
  prevValueKindRef.current = valueState.kind;
  void runValueChainState(valueState);
}, [valueState, topState.kind]);
```

**runBaseChainState（switch 7 个 state.kind）**（`useVaultDepositMachine.ts:286-465`）：
1. `checking_allowance` — `readBaseBridgeAddress` (懒加载) + `readErc20Decimals` + `checkErc20Allowance` → `dispatchBase({type:"ALLOWANCE_CHECKED", needsApprove})`
2. `approving` — `approveErc20(capability, ...)` → `dispatchBase({type:"APPROVE_SUBMITTED", txHash})`
3. `approve_confirming` — `waitBaseReceipt({txHash, 3 confirmations})` → 写 `approveTxHashRef.current` + `dispatchBase({type:"APPROVE_CONFIRMED"})`
4. `approve_completed` — `await sleep(DEPOSIT_APPROVE_POST_DELAY_MS=500)` MetaMask 缓冲 + `bridgeToValueChain(capability, ...)` → `dispatchBase({type:"BRIDGE_SUBMITTED", txHash})`
5. `bridge_confirming` — `waitBaseReceipt` → `dispatchBase({type:"BRIDGE_CONFIRMED", approveTxHash: ref})`
6. `bridge_settling` — `pollBridgeSettle({bridgeTxHash})` 长轮询 → 即使 `confirmed=false` 也 `dispatchBase({type:"SETTLING_COMPLETED"})` + `dispatchTop({type:"BASE_CHAIN_COMPLETED"})`（**超时不阻塞流程**）
7. `idle / completed / failed / bridging` — 不跑（idle 由 START 推动；completed/failed 终态）

**runValueChainState（switch 8 个 state.kind）**（`useVaultDepositMachine.ts:467-694`）：
1. `transferring` — `await callbacksRef.current.onTransferNeeded({coinSymbol, amount})`（外层调 `trade.useSubmitTransfer`）+ `await sleep(DEPOSIT_BRIDGE_SYNC_DELAY_MS)` 等服务端同步 → `dispatchValue({type:"TRANSFER_COMPLETED"})`
2. `staking` — 不会执行（需 `needsStake=true`）；保留 `stakeVaultToken(cap, ...)` 调用以备未来
3. `approving` —
   - `permitTokenAddress = isStake ? VMAG7_TOKEN_ADDRESS : VSMAG7_TOKEN_ADDRESS`
   - `Promise.all([getTokenPermitNonce, readTokenPermitDomain])`
   - domain 兜底：`name||"SoDexToken: sMAG7.ssi"` / `version||"1"`
   - `buildVaultTokenPermitTypedData({owner,spender:CALL_FOR_PERMIT_ADDRESS,...})`
   - `signEip712TypedData(capability, typedData)` → 拆 v/r/s + 写 `approveSignatureRef.current` + `approveDeadlineRef.current`
   - `dispatchValue({type:"APPROVE_COMPLETED", signature, deadline})`
4. `approve_completed` — 自动 `dispatchValue({type:"CONFIRM_STARTED"})`（无 await）
5. `confirm_signing` —
   - `depositTokenAddress = isStake ? VMAG7 : VSMAG7`
   - `getDepositCallForPermitNonce({account})`
   - `outerDeadline = buildDepositOuterDeadlineSeconds()`（默认 +1h）
   - `cmdData = buildVaultDepositCmdData({tokenAddr, amountWei, permitDeadline, v, r, s})`
   - `typedData = buildVaultDepositCallForPermitTypedData({cmd, to:SLP_TOKEN_ADDRESS, ...})` (**`to` 是 SLP_TOKEN_ADDRESS 而非 VAULT_CALLER_ADDRESS**——对齐老项目 `useVaultDepositWithPermit`)
   - `signEip712TypedData` → outer signature + `confirmPayloadRef.current = { request }`
   - `dispatchValue({type:"CONFIRM_SIGNATURE_COMPLETED"})`
6. `confirm_proceeding` — `submitDepositPermit(payload.request)` → `txHash` + `waitValueReceipt({txHash, confirmations: DEPOSIT_VALUE_TX_CONFIRMATIONS})` → `dispatchValue({type:"CONFIRM_COMPLETED", txHash})` + `dispatchTop({type:"VALUE_CHAIN_COMPLETED", txHash})`
7. `idle / completed / failed / stake_confirming` — 不跑

**runEnableTradingAsync**（`useVaultDepositMachine.ts:696-710`）：
- `await callbacksRef.current.onEnableTrading()` (外层处理 waitForAccountReady + ensureExchangeCapability)
- 成功 → `dispatchTop({type:"ENABLE_TRADING_COMPLETED"})`
- 失败 → `isUserRejectedError(cause) ? USER_REJECTED : ENABLE_TRADING_TIMEOUT` 抛上层

**mapCauseToDepositError**（`useVaultDepositMachine.ts:784-844`）—— 按 `state.kind` 推断错误 kind：

| state.kind | error.kind |
|---|---|
| `approving` (含 "permit" 字串) | `DEPOSIT_PERMIT_FAILED` |
| `approving / approve_confirming / checking_allowance` | `DEPOSIT_APPROVE_FAILED` |
| `approve_completed / bridge_confirming` | `DEPOSIT_BRIDGE_FAILED` |
| `bridge_settling` | `DEPOSIT_BRIDGE_TIMEOUT`（warning，不阻塞流程） |
| `transferring` | `TRANSFER_FAILED` |
| `confirm_signing` | `DEPOSIT_PERMIT_FAILED` |
| `confirm_proceeding` | `DEPOSIT_CONFIRM_FAILED` |
| 其他 + msg 含 "insufficient funds/gas" | `DEPOSIT_INSUFFICIENT_GAS` |
| `EXCHANGE_CAPABILITY_MISSING` 类 | `USER_REJECTED` |
| `isUserRejectedError(cause)` | `USER_REJECTED` |
| 兜底 | `UNKNOWN` |

### useSubmitVaultDeposit — 外层编排（跨 feature 桥接）

文件：`src/features/vault/containers/useSubmitVaultDeposit.ts:43-291`

**职责**：
1. 持有 `useVaultDepositMachine(input, callbacks)`
2. 提供 5 个 callbacks 桥接跨 feature：
   - `onTransferNeeded` → 调 `trade.useSubmitTransfer({from:"Spot", to:"Funding", coin, amount})`
   - `onEnableTrading` → 两阶段：`auth.waitForAccountReady` + `auth.ensureExchangeCapability({mode:"embedded"})`
   - `onBaseChainCompleted` → 占位（WS sodex_deposit Success 已弹 toast）
   - `onSuccess(txHash)` → `notifyVaultDepositCompleted` + 3 次延迟 invalidate
   - `onError(error, phase)` → `closeNotify` + `handleDepositServiceError` + `shouldShowDepositTryAgain → setShowTryAgain(true)`
3. 派生 `isAwaitingWalletSignature`：仅 `base.approving / value.approving / value.confirm_signing` 为 true（用户必须去钱包确认的节点）
4. 暴露 `{submit, retry, reset, isSubmitting, currentInput, machine, isAwaitingWalletSignature, showTryAgain, isRetrying}`
5. `submit(params)` 走 `closeNotify + setCurrentInput + queueMicrotask(machine.start)`
6. `retry()` 调 `closeNotify + machine.retry()` + 3s 自动隐藏 Try Again（`DEPOSIT_TRY_AGAIN_TIMEOUT_MS`）
7. `reset()` 关闭弹窗时调 `closeNotify + machine.reset()`
8. unmount cleanup 调 `closeNotify`（防止 WS pending 残留）

### onTransferNeeded callback（smart-transfer）

```ts
// useSubmitVaultDeposit.ts:77-98
const onTransferNeeded = useCallback(async (params) => {
  if (!address) throw new Error("Wallet not connected");
  // 双保险:machine 已判 needsTransfer,这里再读余额
  const coin = normalizeTransferCoin(params.coinSymbol);  // MAG7.ssi → vMAG7.ssi
  const evmAmt = new Decimal(evmBalances.data?.find(b => b.coin === coin)?.available ?? "0");
  const needAmt = new Decimal(params.amount);
  const diff = needAmt.minus(evmAmt);
  if (diff.lte(0)) return;  // 余额够,跳过

  await doTransfer({ from: "Spot", to: "Funding", coin, amount: diff.toString() });
}, [address, doTransfer, evmBalances.data]);
```

`normalizeTransferCoin`（`useSubmitVaultDeposit.ts:285-291`）：`MAG7.ssi → vMAG7.ssi` / `sMAG7.ssi → vsMAG7.ssi`（trade balance API 用 v 前缀 key）。

### onEnableTradingCallback（两阶段拆分，避免误弹钱包）

```ts
// useSubmitVaultDeposit.ts:100-143
const onEnableTradingCallback = useCallback(async () => {
  // Phase 1 静默轮询 fetchAccountId(无 UI),把 bridge 后的最终一致窗口等掉
  const onChain = getCurrentOnChainCapability();
  if (!onChain) throw { kind: "USER_REJECTED" as const };

  try {
    await waitForAccountReady(onChain.signerAddress, {
      maxAttempts: DEPOSIT_ENABLE_TRADING_MAX_ATTEMPTS,
      intervalMs: DEPOSIT_ENABLE_TRADING_RETRY_INTERVAL_MS,
    });
  } catch {
    throw { kind: "ENABLE_TRADING_TIMEOUT" as const };
  }

  // Phase 2 ensureExchangeCapability 单次调用——成功=已签;失败=用户取消
  try {
    await ensureExchangeCapability({ mode: "embedded" });
  } catch (err) {
    const authErr = err as { type?: string };
    if (authErr?.type === "SIGNATURE_REJECTED" || authErr?.type === "SIGNATURE_TIMEOUT") {
      throw { kind: "USER_REJECTED" as const };
    }
    throw { kind: "ENABLE_TRADING_TIMEOUT" as const };
  }
}, []);
```

**为什么这样设计（关键 bug 修复）**：
- **旧设计**：循环包 `ensureExchangeCapability`，每次失败都重弹签名 modal——用户取消时会被烦 15 次；`EXCHANGE_CAPABILITY_MISSING` 同时覆盖"取消"和"后端账户未同步"，无法区分
- **新设计**：
  - Phase 1（静默 polling）：链上 readContract 检测 accountId 出现，把 bridge 后的最终一致窗口等掉
  - Phase 2（用户签名）：单次 `ensureExchangeCapability` 调用，成功=已签，失败=用户关弹窗/拒签 → `USER_REJECTED`，语义无歧义

### useVaultDepositForm — 表单状态 + Auto-fill（双 ref 防误报）

文件：`src/features/vault/containers/useVaultDepositForm.ts:84-323`

```ts
type DepositFormReturn = {
  form: { selectedChain, token, from, amount };
  setSelectedChain / setToken / setFrom / setAmount;
  onMaxClick;
  balanceDisplay / maxDisplay / minDisplay;
  isBalanceLoading;
  validation: { isValid, canSubmit, errorText? };
  helperText: string | null;
  canAutoFill: boolean;  // tradingStatus === "idle"
};
```

**4 项核心机制**：

1. **默认值派生**：
   - `selectedChain = defaultChain ?? (isNewUser ? "BASE_ETH" : "VALUE_CHAIN")`
   - `token = defaultToken ?? DEFAULT_TOKEN_MAG7`（MAG7 / Stake 路径）
   - `from = defaultFrom ?? (isNewUser ? "EVM_FUNDING" : "SPOT")`（新用户 Spot 被禁用）

2. **Max 余额三路计算**（`useMemo`）：
   - **Base 链**：`useReadContract(erc20.balanceOf, BASE_*_TOKEN_ADDRESS)` on `base.id` → `formatUnits(raw, 8)`
   - **Value 链 SPOT**：`spotBalancesQuery.data.find(b => b.coin === "vMAG7.ssi"/"vsMAG7.ssi").available`
   - **Value 链 EVM_FUNDING**：`evmBalancesQuery.data.find(...).available`
   - **isAddressSwitching=true**：返回 "0"（防钱包切换过渡期 max 显示旧账号余额）
   - 全部走 `roundDown(raw, VAULT_DEFAULT_DECIMAL=4)` 展示

3. **双 ref 防误报机制**：
   - `userHasEditedRef` — 用户主动编辑/Max 点击 → 阻挡后续 auto-fill
   - `hasUserInputtedRef` — 曾经输入过非空值（含 auto-fill）→ 触发空值校验
   - `setAmountInternal`（auto-fill / Max 用）只翻 `hasUserInputted`
   - `handleManualAmountChange`（手动输入）翻两个 ref
   - 切 chain/token/from → reset `userHasEdited`（允许 auto-fill）

4. **Auto-fill effect**（chain/token/from/balance 变化时）：
   ```ts
   useEffect(() => {
     if (!canAutoFill) return;                   // tradingStatus !== idle → 不填
     if (userHasEditedRef.current) return;       // 用户已编辑 → 不覆盖
     if (isBalanceLoading) return;               // 余额加载中 → 不填
     setAmountInternal(maxDisplay);
   }, [selectedChain, token, from, maxDisplay, ...]);
   ```

### validateDepositAmount — 三重校验

文件：`src/features/vault/containers/depositFlowLogic.ts:330-398`

返回 `{isValid, canSubmit, errorText?}` 三态：

| 输入 | isValid | canSubmit | errorText |
|---|---|---|---|
| `isBalanceLoading=true` | true | false | — (抑制错误) |
| `amount=""` + `!hasUserInputted` | true | false | — |
| `amount=""` + `hasUserInputted` + `userHasEdited` | false | false | `Minimum deposit is X MAG7.ssi` |
| `amount=""` + `hasUserInputted` + `!userHasEdited` | false | false | undefined（防闪烁） |
| invalid number | false | false | `Invalid amount` (仅 userHasEdited) |
| `amount < min` | false | false | `Minimum deposit is X MAG7.ssi`（hasUserInputted 即显示） |
| `amount > balance` | false | false | `Not enough balance` (仅 userHasEdited) |
| valid | true | true | — |

**关键 UX**：
- 余额加载中**不显示错误**（避免 RQ refetch 时误报）
- "Not enough balance"**仅 userHasEdited=true 显示**（auto-fill 设了 max 后余额短暂过期不应误报）
- "Minimum deposit is X" 在 hasUserInputted 即显示（auto-fill 也算输入过；纯初始空态不显示）

### deriveDepositButtonState — 按钮状态派生

文件：`src/features/vault/containers/depositFlowLogic.ts:282-312`

```ts
type DepositButtonState =
  | { kind: "connect_wallet" }
  | { kind: "enable_deposit" }
  | { kind: "switch_network" }
  | { kind: "submit"; disabled: boolean; helperText: string | null }
  | { kind: "submitting" };
```

派生优先级（高→低）：
1. `isSubmitting` → `submitting`
2. `!isConnected` → `connect_wallet`
3. `isNewUser` → `enable_deposit`
4. `currentChainId !== requiredChainId` → `switch_network`
5. 默认 → `submit { disabled, helperText }` (来自 validateDepositAmount)

> 注：dialog 实际未直接使用该函数，而是根据 useAuthState + 表单 state 自己派生 `buttonText`/`isSubmitDisabled`（见 `index.tsx:625-641`）。该函数预留给未来重构。

### handleDepositServiceError + shouldShowDepositTryAgain

文件：`src/features/vault/containers/handleDepositServiceError.ts`（138 行）

**Toast 映射 13 case** —— 详见 `vault-notification` feature §7.3 全表：

| `error.kind` | toast |
|---|---|
| `USER_REJECTED` | `notify.error("Transaction Canceled")` |
| `DEPOSIT_AMOUNT_ZERO` | `notify.error("Deposit amount cannot be zero")` |
| `DEPOSIT_APPROVE_FAILED` | `notify.error("Approve failed: ${msg}")` |
| `DEPOSIT_BRIDGE_FAILED` | `notify.error("Bridge to SoDEX failed: ${msg}")` |
| `DEPOSIT_BRIDGE_TIMEOUT` | `notify.warning("Bridge submitted. Balance is still syncing...")` |
| `DEPOSIT_INSUFFICIENT_GAS` | `notify.error("Insufficient ETH on Base chain to pay for gas...")` |
| `DEPOSIT_PERMIT_FAILED` | `notify.error("Permit signing failed: ${msg}")` |
| `DEPOSIT_CONFIRM_FAILED` | `notify.error("Vault deposit failed: ${msg}")` |
| `DEPOSIT_CONFIRM_TIMEOUT` | `notify.warning("Deposit submitted. Waiting for on-chain confirmation...")` |
| `ENABLE_TRADING_TIMEOUT` | `notify.error("Account creation timed out...")` |
| `TRANSFER_FAILED` | `notify.error("Transfer to EVM-Funding failed: ${msg}")` |
| `EVM_BALANCE_TIMEOUT` | `notify.warning("Balance sync delayed...")` |
| `NETWORK_ERROR` / `CHAIN_MISMATCH` | 通用 |

**`shouldShowDepositTryAgain(error, phase)`**（`handleDepositServiceError.ts:131-138`）：
- `error.kind === "USER_REJECTED"` → **true**（仅用户拒签时显示）
- `phase === "value_chain"` → **true**（任何 value 链错误均可重试）
- `phase === "base_chain"` 非拒签 → **false**（bridge 已上链，不能随意重提交）

---

## 关键实现

### 1. 防重入硬规则（StrictMode + unmount + AbortController）

**3 个 prev*KindRef**：
```ts
const prevTopKindRef = useRef<string | undefined>(undefined);
const prevBaseKindRef = useRef<string | undefined>(undefined);
const prevValueKindRef = useRef<string | undefined>(undefined);
```

每个 effect 进入前检查：`if (prev*KindRef.current === state.kind) return;`

**StrictMode 双跑场景**：React 18 `<StrictMode>` 在 dev 下故意把 effect 跑两次。如果不挡，会导致：
- approve 签名弹两次
- 余额读取两次
- 链上请求重发

**reset 流程**（`useVaultDepositMachine.ts:747-760`）：
```ts
const reset = useCallback(() => {
  abortRef.current?.abort();
  abortRef.current = null;
  approveTxHashRef.current = undefined;
  approveSignatureRef.current = undefined;
  approveDeadlineRef.current = undefined;
  confirmPayloadRef.current = null;
  prevTopKindRef.current = undefined;
  prevBaseKindRef.current = undefined;
  prevValueKindRef.current = undefined;
  dispatchTop({ type: "RESET" });
  dispatchBase({ type: "RESET" });
  dispatchValue({ type: "RESET" });
}, []);
```

清所有 ref + dispatch RESET（reducers 自己也回 idle）。

**unmount 检查**：
```ts
const isUnmountedRef = useRef(false);
useEffect(() => {
  isUnmountedRef.current = false;
  return () => { isUnmountedRef.current = true; };
}, []);

function checkUnmounted(): boolean {
  return isUnmountedRef.current;
}
```

每次 await 后立即 `if (checkUnmounted()) return;`，防止 unmount 后 dispatch 触发 react warning。

### 2. RETRY 缓存复用（不重签 approve / 不重 bridge）

**Base chain RETRY**：
- `approve` step failed → 完整重跑（重新检查 allowance）
- `confirm` step failed → 保留 `cache.approveTxHash`，跳到 `approve_completed` 直接进 bridge

**Value chain RETRY**：
- `transfer` failed → 重 transfer
- `stake` failed → 仅重 stake（不回 transfer）
- `approve` failed → 重 permit 签名
- `confirm` failed →
  - `cache.approveDeadline > now` → 复用 `cache.approveSignature` 跳到 `approve_completed`
  - 否则 → 回 `approving` 重签

**Container 层 RETRY**（`useVaultDepositMachine.ts:727-745`）：
```ts
const retry = useCallback(() => {
  if (topState.kind !== "failed") return;
  prevTopKindRef.current = undefined;        // 允许 effect 重入
  if (topState.phase === "base_chain") {
    prevBaseKindRef.current = undefined;
    dispatchTop({ type: "RETRY" });
    dispatchBase({ type: "RETRY" });
  }
  if (topState.phase === "value_chain") {
    prevValueKindRef.current = undefined;
    dispatchTop({ type: "RETRY" });
    dispatchValue({ type: "RETRY" });
  }
  // enable_trading retry: 重新触发 callback
  dispatchTop({ type: "RETRY" });
}, [topState]);
```

### 3. Bridge address 懒加载缓存（独立 ref，避免 inputRef 被 render 覆盖）

```ts
// useVaultDepositMachine.ts:179-180
const resolvedBridgeAddrRef = useRef<`0x${string}` | undefined>(undefined);

// checking_allowance 内
if (!inp.token.baseBridgeAddress && !resolvedBridgeAddrRef.current) {
  const bridgeAddr = await readBaseBridgeAddress(inp.token.baseCoinSymbol ?? "MAG7.ssi");
  resolvedBridgeAddrRef.current = bridgeAddr;
}

// 后续 step 都用
function getEffectiveBridgeAddr() {
  return inputRef.current?.token.baseBridgeAddress ?? resolvedBridgeAddrRef.current;
}
```

**为什么独立 ref**：bridge 地址首次读 `getTokenConfig`，结果不能写回 input（input 由外层控制，render 会覆盖）。独立 ref 跨 render 持久。

### 4. 顶层 isNewUser 快照锁定

```tsx
// VaultDepositDialogContainer 中
const isFirstTimeUser = isAccountIdProbing || !accountId;
//                       ^^^^^^^^^^^^^^^^^ probe 中乐观视为新用户

// submission.submit 时传入
submission.submit({
  ...,
  isNewUser: isFirstTimeUser,  // ← 锁进 input
});

// Trading 视图渲染时
const isNewUserSnapshot = submission.currentInput?.isNewUser ?? isFirstTimeUser;
//                         ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ 用快照,不用实时值
```

**为什么必须快照**：bridge 完成后服务端推 WS → `useDepositNotice` invalidate `auth.exchangeAccountId` query → 重 fetch 后 `accountId` 出现 → 实时 `isFirstTimeUser` 变 false → Enable Trading 面板会消失。**用 currentInput 快照锁定渲染**，新用户面板始终展示。

### 5. 三屏切换（idle / preview / trading）

```tsx
// VaultDepositDialogContainer
const [tradingStatus, setTradingStatus] = useState<"idle" | "preview" | "trading">("idle");

// idle → preview 触发
const handleSubmit = (e) => {
  e.preventDefault();
  // 钱包未连 → 仅触发连接(不进 preview)
  if (!isConnected) { openConnectWallet(); return; }
  // Enable Deposit → 走独立 enableTrading
  if (needsStandaloneEnableDeposit) { void enableTrading(); return; }
  // 检查网络 → 切链 → preview
  if (chainId !== targetChainId) {
    setIsSwitchingNetwork(true);
    void switchChainAsync({ chainId: targetChainId })
      .then(() => setTradingStatus("preview"))
      .finally(() => setIsSwitchingNetwork(false));
    return;
  }
  setTradingStatus("preview");
};

// preview → trading
const handleConfirmDeposit = () => {
  setTradingStatus("trading");
  submission.submit({ ... });  // 真正启动 machine
};

// trading → completed → 1s 后关闭弹窗
useEffect(() => {
  if (kind === "completed") {
    const timer = setTimeout(() => modalClose?.(), 1000);
    return () => clearTimeout(timer);
  }
}, [kind, modalClose]);
```

**3 屏渲染分支**：
- `tradingStatus === "preview"` → `<Preview from to onConfirm onBack />`
- `tradingStatus === "trading"` → `<Trading sodexPanel enableTradingPanel vaultPanel ... />`
- 默认 → `<VaultDepositDialog>` 表单

### 6. Trading 视图的 Panel 状态派生

每个 panel 独立计算 `isActive / isCompleted / isFailed / showLoading`，由 `topState.kind + topState.phase` 派生。详见 `index.tsx:813-905`：

| Panel | isActive | isCompleted | isFailed |
|---|---|---|---|
| sodex | `top.kind==="base_chain_phase"` | `top.kind in {enable_trading, value_chain_phase, completed}` 或 `failed` 但非 base_chain | `top.failed && phase==="base_chain"` |
| enableTrading | `top.kind==="enable_trading"` | `top.kind in {value_chain_phase, completed}` | `top.failed && phase==="enable_trading"` |
| vault | `top.kind==="value_chain_phase"` | `top.kind==="completed"` | `top.failed && phase==="value_chain"` |

**Failed 时保留失败步骤的 active 视觉**（`index.tsx:842-843` / `886-900`）：
```ts
// SoDEX panel - currentStep
case "failed":
  return base.step === "confirm" ? 1 : 0;

// Vault panel - vaultKindForStep
const vaultKindForStep = value.kind === "failed" && "stepName" in value
  ? value.stepName === "transfer" ? "transferring"
    : value.stepName === "stake" ? "staking"
      : value.stepName === "approve" ? "approving"
        : value.stepName === "confirm" ? "confirm_signing"
          : value.kind
  : value.kind;
```

把失败 stepName 映射回等效的 active state，让 step indicator 显示 active 视觉而非全灰。

### Trading 屏的 Panel 数字圆圈布局（Figma 430-34942）

`Trading.tsx` 不直接渲染 3 个独立 `CollapsiblePanel`，而是动态过滤可见 panel 后用 `stepNumber + showConnectorLine` 渲染数字圆圈连接线布局：

```tsx
// Trading.tsx:92-124
const panels: Array<{ slot: TradingPanelSlot; show: boolean }> = [
  { slot: sodexPanel ?? {...placeholder}, show: isBaseChain && !!sodexPanel },
  { slot: enableTradingPanel ?? {...placeholder}, show: isBaseChain && isNewUser && !!enableTradingPanel },
  { slot: vaultPanel, show: true },
];
const visible = panels.filter((p) => p.show);
return visible.map((p, idx) => (
  <CollapsiblePanel
    key={p.slot.title}
    {...p.slot}
    stepNumber={idx + 1}
    showConnectorLine={idx < visible.length - 1}
  >
    {p.slot.content}
  </CollapsiblePanel>
));
```

四种渲染场景：
- 新用户 Base 链：3 个圆圈（1 SoDEX → 2 EnableTrading → 3 Vault）+ 2 条连接线
- 老用户 Base 链：2 个圆圈（1 SoDEX → 2 Vault）+ 1 条连接线
- Value 链：1 个圆圈（1 Vault）+ 0 条连接线

### Trading 屏标题动态切换（依据 isAwaitingWalletSignature）

```tsx
// Trading.tsx:51-64
const { signingHint } = useWalletSigningText();
return (
  <div>
    <h3>Sign Transactions</h3>
    <p>{isAwaitingWalletSignature ? signingHint : "You will need to sign this transaction in your wallet."}</p>
  </div>
);
```

`useWalletSigningText().signingHint` 根据钱包类型返回不同提示（如 WC 用户提示去手机端确认，浏览器钱包提示去扩展确认）。**等签名时切换文案，给用户具体的下一步引导**。

### DepositToVaultStep 文案常量（4 个 step × 3 状态）

`DepositToVaultStep.tsx:19-38` 定义了 4 个 step 的 `Record<StepStatus, string>` 文案：

| step | active | completed | pending |
|---|---|---|---|
| transfer | `Transferring to EVM-Funding` | `Transferred to EVM-Funding` | `Transfer to EVM-Funding` |
| stake | `Staking MAG7.ssi to sMAG7.ssi (~3 mins)` | `Staked MAG7.ssi to sMAG7.ssi` | `Stake MAG7.ssi to sMAG7.ssi` |
| approve | `Approving Spending Cap in Wallet` | `Approved Spending Cap` | `Approve Spending Cap` |
| confirm | `Confirming in Wallet` | `Confirmed` | `Confirm` |

`buildSteps(needsTransfer, needsStake)` 按 config 动态拼接：`[transfer?, stake?, approve, confirm]` —— **当前 needsStake 恒 false，stake 步骤不显示**（保留代码以备未来）。

### computeVaultCurrentStep 的 stake 兜底

`DepositToVaultStep.tsx:90-120`：

```ts
export function computeVaultCurrentStep(valueStateKind, needsTransfer, needsStake): number {
  let idx = 0;
  const transferStep = needsTransfer ? idx++ : -1;
  const stakeStep    = needsStake    ? idx++ : -1;   // 当前恒 -1
  const approveStep  = idx++;
  const confirmStep  = idx++;
  const totalSteps   = idx;

  switch (valueStateKind) {
    case "transferring": return transferStep;
    case "staking":
    case "stake_confirming":
      // **关键兜底**:needsStake=false 时 stakeStep=-1(不显示)
      // 映射到 approveStep,让 Approve 步骤显示 loading
      return stakeStep >= 0 ? stakeStep : approveStep;
    case "approving":
    case "approve_completed":   return approveStep;
    case "confirm_signing":
    case "confirm_proceeding":  return confirmStep;
    case "completed":           return totalSteps;
    default:                    return -1;            // 全 pending
  }
}
```

→ 即使 reducer 内部不会进入 `staking` state（needsStake=false），UI 兜底逻辑仍处理这种 case，避免显示出错。

### SoDEX panel 自动折叠 + Vault panel 自动展开

```tsx
// index.tsx:534-541
useEffect(() => {
  const kind = submission.machine.topState.kind;
  if (kind === "value_chain_phase" || kind === "enable_trading") {
    setIsSodexExpanded(false);  // base 完成后自动折叠
  }
  if (kind === "completed") {
    const timer = setTimeout(() => modalClose?.(), 1000);  // 1s 后关弹窗
    return () => clearTimeout(timer);
  }
}, [...]);

// vaultPanel
isExpanded: isVaultActive || isVaultFailed ? true : isVaultExpanded,
//          ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ 激活/失败时强制展开
```

UX：base 完成后 SoDEX 面板自动折叠，Vault 面板进入 active 状态自动展开，用户视线自然推进。

### 8. CallForPermit `to` 字段对齐老项目

**关键设计**：`to = SLP_TOKEN_ADDRESS`（不是 `VAULT_CALLER_ADDRESS`）

```ts
// useVaultDepositMachine.ts:613-620
const typedData = buildVaultDepositCallForPermitTypedData({
  cmd: cmdForTyped,
  to: SLP_TOKEN_ADDRESS,                    // ← 注意这里
  nonce: callForNonce,
  deadline: outerDeadline,
  chainId: VALUE_CHAIN_MAINNET.id,
  verifyingContract: CALL_FOR_PERMIT_ADDRESS,
});
```

对齐老项目 `useVaultDepositWithPermit` 的 `vaultAddress = SLP_TOKEN_ADDRESS`（SLP token 是 ERC4626 vault，deposit 直接调它）。

而 unstake/claim/withdraw 的 `to = VAULT_CALLER_ADDRESS`（CallForPermit 中转）。**这是 deposit 唯一与其他操作不同的 cmdType `to` 字段**。

### 9. Permit token 与 Deposit token 同地址（vMAG7 / vsMAG7）

```ts
// useVaultDepositMachine.ts:518-520 (approving)
const permitTokenAddress = inp.token.isStake
  ? VMAG7_TOKEN_ADDRESS
  : (inp.token.valueChainTokenAddress ?? VSMAG7_TOKEN_ADDRESS);

// useVaultDepositMachine.ts:583-585 (confirm_signing)
const depositTokenAddress = inp.token.isStake
  ? VMAG7_TOKEN_ADDRESS
  : (inp.token.valueChainTokenAddress ?? VSMAG7_TOKEN_ADDRESS);
```

**对齐老项目**：
- `isStake=true (MAG7)` → permit 用 `vMAG7`，deposit token 也是 `vMAG7`，vault 内部处理 vMAG7→vsMAG7 staking
- `isStake=false (sMAG7)` → permit 用 `vsMAG7`，deposit token 也是 `vsMAG7`

**SoDexToken domain 兜底**：
```ts
// useVaultDepositMachine.ts:534-535
const safeDomainName = domainInfo.name || "SoDexToken: sMAG7.ssi";
const safeDomainVersion = domainInfo.version || "1";
```

`readTokenPermitDomain` 失败时用兜底（对齐老项目 `_createTokenPermitDomain`）。

### 10. MetaMask 冲突缓冲 + 桥接同步等待

```ts
// useVaultDepositMachine.ts:397 (approve_completed)
await sleep(DEPOSIT_APPROVE_POST_DELAY_MS);  // 500ms 缓冲再 bridge

// useVaultDepositMachine.ts:509 (transferring after onTransferNeeded)
await sleep(DEPOSIT_BRIDGE_SYNC_DELAY_MS);   // 服务端同步 EVM-Funding 余额
```

两处 sleep 都是为了避免下游链上 / 后端读到旧状态。

### 11. signer 锁 + Privy 邮箱用户兼容

`requireOnChain()`（`useVaultDepositMachine.ts:276-284`）每次 effect 进入异步路径前调 `getCurrentOnChainCapability()`。缺失时抛 `USER_REJECTED`（qr-session / watch / 钱包未连接都属于不能签的状态）。

**这是 4 个 vault feature 中唯一不在 `onMutate` 锁 signer 的**——deposit 用 `useState(currentInput)` + `queueMicrotask(machine.start)` 异步启动 machine，没有 mutation context；改用 `requireOnChain` 在每个 atomic call 前 call-time 读 capability。中途切钱包 → `wagmi.signTypedData` 自然失败抛 `USER_REJECTED`。

dialog 用 `useAuthState().address` 而非 `useAccount()` —— Privy 邮箱用户的 embedded wallet 不一定立刻进 wagmi，但 auth state 派生的 address 在 Privy 登陆后即可用。链上签名/写交易由 wagmi 触发，Privy 自动桥接 embedded wallet。

---

## 文件结构

```
src/features/vault/
├── components/dialogs/VaultDepositDialog/
│   ├── index.tsx                                1023 行 Container 包装 + Dialog UI + Skeleton + 3 屏切换
│   ├── BaseAccountInput.tsx                     76 行 Base 链余额输入 + Max
│   ├── AccountSelector.tsx                      193 行 Value 链 Spot/EVM-Funding 切换
│   ├── CollapsiblePanel.tsx                     146 行 Trading 视图通用折叠面板
│   ├── DepositToSodexStep.tsx                   66 行 Base 链 3 步 step indicator
│   ├── DepositToVaultStep.tsx                   120 行 Value 链 N 步 step indicator(动态)
│   ├── Preview.tsx                              131 行 Review 屏(从→到 + Confirm/Back)
│   ├── Trading.tsx                              159 行 Sign Transactions 屏(SoDEX/Enable/Vault 三 panel)
│   ├── VaultPreTradeButton.tsx                  102 行 按钮组件(Connect/EnableDeposit/Switch/Submit)
│   └── WarningText.tsx                          11 行 Alert 警告文字封装
│
├── containers/
│   ├── deposit/
│   │   └── useVaultDepositMachine.ts            860 行 Reducer + Effect Driver 核心
│   ├── useSubmitVaultDeposit.ts                 291 行 外层编排(callbacks 桥接 + Try Again)
│   ├── useVaultDepositForm.ts                   347 行 表单 + Auto-fill + 双 ref 防误报
│   ├── depositFlowLogic.ts                      408 行 纯派生(StepStatus/PanelSlotData/validation/buttonState)
│   ├── handleDepositServiceError.ts             138 行 error.kind → toast(13 case) + shouldShowDepositTryAgain
│   └── useVaultDepositorsQuery.ts               50 行 Depositors 列表 query(独立 feature)
│
├── domain/
│   ├── depositStateMachine.ts                   520 行 3 个 reducer 纯函数
│   └── depositPermit.ts                         308 行 EIP-712 typed data + cmd encode + isUserRejectedError
│
└── infra/chain/
    └── vaultDepositInfra.ts                     736 行,15 个 atomic async 函数:
                                                  Base 链 read/write:
                                                   - readBaseBridgeAddress / readErc20Decimals / checkErc20Allowance
                                                   - approveErc20 / waitBaseReceipt / bridgeToValueChain / pollBridgeSettle
                                                  Value 链 read/write:
                                                   - getTokenPermitNonce / readTokenPermitDomain
                                                   - getStakeCallForPermitNonce / stakeVaultToken (needsStake=false 时不调)
                                                   - getDepositCallForPermitNonce
                                                   - signEip712TypedData(EIP-712 通用签名 wrapper)
                                                   - waitValueReceipt / submitDepositPermit
```

**复用关系**：
- `useVaultDepositMachine` 调 `vaultDepositInfra` 的 11 个 atomic 函数
- `useSubmitVaultDeposit` 通过 callbacks 跨 feature 调 `trade.useSubmitTransfer` + `auth.waitForAccountReady` + `auth.ensureExchangeCapability`
- 不依赖 `vaultClaimInfra` / `vaultUnstakeService` / `vaultWithdrawService`（**deposit 是独立链路**）
- `domain/depositPermit.ts` 与 `claimPermit.ts` / `unstakePermit.ts` / `withdrawPermit.ts` 类型互不依赖，但结构对称

**跨 feature**（仅通过 public API）：
- `@/features/auth` — `useAuthState`, `useEnableTrading`, `getCurrentOnChainCapability`, `OnChainCapability` type, `ensureExchangeCapability`, `waitForAccountReady`, `openConnectWalletDialog`
- `@/features/trade` — `useEvmBalancesQuery`, `useBalancesQuery`, `useSubmitTransfer`, `notifyVaultDepositCompleted`
- `@/shared/utils/invalidateVaultMutationQueries` — 17 query key 统一刷新（详见 `vault-notification` feature）
- `wagmi` — `useReadContract` (form), `useChainId/useSwitchChain` (dialog)

---

## 关键设计决策

### 1. 不建 vault deposit Service

**为什么**：
- 编排逻辑跨 feature（trade + auth），无法塞进单一 Service（boundaries 禁跨 feature service import）
- 状态机（top/base/value 3 层 reducer）需要 effect driver，不能用纯 async 函数表达
- service 抽象会让"何时 dispatch"分散，难以追踪

**实现**：
- `domain/` 提供纯 reducer + permit builder
- `infra/chain/vaultDepositInfra.ts` 提供 11 个 atomic async（不组装流程）
- `containers/deposit/useVaultDepositMachine.ts` 是 effect driver（reducer + atomic 编排）
- `containers/useSubmitVaultDeposit.ts` 是外层 wrapper（callbacks + invalidate + UI 状态）

→ 与 claim/unstake/withdraw 都建 Service 的模式形成对比。深度参考 `.claude/kit/spec/vault-migration/05c-deposit-logic.md` 设计决策 §架构约束。

### 2. 3 层 reducer + 3 个 effect driver

**为什么不用单一大 reducer**：
- 顶层关心阶段流转（Base→EnableTrading→Value），与子机内部 step 解耦
- 子机内部 step 多（Base 8 state / Value 9 state），混在一起 state explosion
- RETRY 复用规则各阶段独立（Base 保留 approveTxHash / Value 保留 approveSignature），单大 reducer 难以表达

**实现**：3 个独立 `useReducer`，3 个 effect 分别监听对应 state；通过 `dispatchTop({BASE_CHAIN_COMPLETED})` 等动作把"子机完成"信号传给顶层。

### 3. enable_trading 两阶段拆分（修复用户烦扰 bug）

**旧设计问题**：循环包 `ensureExchangeCapability`，每次失败重弹签名 modal。
- 用户取消时被烦 15 次（`MAX_ATTEMPTS=15`）
- `EXCHANGE_CAPABILITY_MISSING` 同时覆盖"取消"和"账户未同步"，无法区分语义

**新设计**：
- **Phase 1（静默 polling）**：链上 `readContract` 检测 `accountId` 出现，把 bridge 后的最终一致窗口等掉（无 UI 干扰）
- **Phase 2（用户签名）**：单次 `ensureExchangeCapability` 调用，成功=已签，失败一定是用户关弹窗/拒签 → `USER_REJECTED`，语义无歧义

### 4. signer 锁用 requireOnChain call-time 读（vs 其他 vault feature 的 onMutate 快照）

**为什么 deposit 不一样**：
- claim/unstake/withdraw 用 `useMutation`，`onMutate` 自然提供 context 写入 `account`
- deposit 用 `useReducer + useEffect`，没有 mutation context；machine 启动后会跑很久（多个签名 + 链上等待 + 服务端轮询）
- 改成 call-time 读 `getCurrentOnChainCapability()`：每个 atomic call 前重新读，**仍能感知钱包切换**（信号靠 wagmi 自己抛 `USER_REJECTED`）

### 5. 双 ref 防 Auto-fill 误报

**问题**：余额 RQ refetch 期间余额变 "0" 短暂，会让 "Not enough balance" 闪烁红字。

**解决**：
- `userHasEditedRef`：仅手动输入/Max 翻 true（auto-fill 不翻）
- `hasUserInputtedRef`：曾输入非空就翻 true（含 auto-fill）
- "Not enough balance" 仅 `userHasEdited=true` 显示
- "Minimum X" 在 `hasUserInputted=true` 显示（auto-fill 也算）
- 余额加载中 → 抑制全部错误（`isBalanceLoading=true → isValid=true, canSubmit=false`）

### 6. isNewUser 锁定快照

**问题**：bridge 完成后服务端推 WS → invalidate `auth.exchangeAccountId` → accountId 出现 → 实时 `isFirstTimeUser` 变 false → Enable Trading 面板消失。

**解决**：`submission.submit` 时把 `isNewUser` 写进 `currentInput`，Trading 视图渲染时用 `submission.currentInput?.isNewUser ?? isFirstTimeUser` 快照锁定。

### 7. 3 屏切换 vs 单一 dialog body

**为什么不用 3 个独立 modalManager 弹窗**：
- 状态在弹窗间传递（form → preview → trading → completed）会有时序复杂度
- preview/trading 期间用户中途取消应回 idle 而非整个关闭重启

**实现**：单 dialog 内 `tradingStatus` state 驱动子树切换（`if (tradingStatus === "preview") return <Preview>;` 等），关闭弹窗即清整个子树。

### 8. CallForPermit `to=SLP_TOKEN_ADDRESS`（与 claim/unstake/withdraw 不同）

**为什么**：deposit 是直接调 SLP（ERC4626 vault token）的 `deposit()`；其他操作是通过 VaultCaller 中转。对齐老项目 `useVaultDepositWithPermit.vaultAddress = SLP_TOKEN_ADDRESS`。

### 9. SoDEX panel 自动折叠 + Vault panel 自动展开

UX 设计：base 完成后用户视线应转到 Vault 面板。SoDEX 折叠 + Vault 强制展开（`isVaultActive || isVaultFailed ? true : isVaultExpanded`），自然推进。

### 10. completed 后 1s 延迟关闭弹窗

```ts
if (kind === "completed") {
  const timer = setTimeout(() => modalClose?.(), 1000);
}
```

让用户看到所有 panel 绿色完成状态再关闭（提供心理结尾）。

---

## 错误码 → 阶段映射

| Phase | error.kind | 触发场景 | toast 类型 |
|---|---|---|---|
| `base_chain` | `DEPOSIT_AMOUNT_ZERO` | parseUnits → 0n | error |
| `base_chain` | `DEPOSIT_APPROVE_FAILED` | approve tx revert / sign reject | error |
| `base_chain` | `DEPOSIT_BRIDGE_FAILED` | bridge tx revert | error |
| `base_chain` | `DEPOSIT_BRIDGE_TIMEOUT` | pollBridgeSettle 超时 | warning |
| `base_chain` | `DEPOSIT_INSUFFICIENT_GAS` | insufficient funds/gas | error |
| `enable_trading` | `ENABLE_TRADING_TIMEOUT` | waitForAccountReady 超时 / ensureExchangeCapability 异常 | error |
| `enable_trading` | `USER_REJECTED` | ensureExchangeCapability SIGNATURE_REJECTED/TIMEOUT | error("Transaction Canceled") |
| `value_chain` | `TRANSFER_FAILED` | trade.useSubmitTransfer 失败 | error |
| `value_chain` | `EVM_BALANCE_TIMEOUT` | EVM 余额未及时同步 | warning |
| `value_chain` | `DEPOSIT_PERMIT_FAILED` | approve/confirm 签名失败(含"permit"字串) | error |
| `value_chain` | `DEPOSIT_CONFIRM_FAILED` | submitDepositPermit / waitValueReceipt 失败 | error |
| `value_chain` | `DEPOSIT_CONFIRM_TIMEOUT` | waitValueReceipt 超时 | warning |
| 任何 | `USER_REJECTED` | isUserRejectedError 命中 / EXCHANGE_CAPABILITY_MISSING | error("Transaction Canceled") |
| 任何 | `NETWORK_ERROR` / `CHAIN_MISMATCH` | infra 抛 | error |

**Try Again 显示规则**（`shouldShowDepositTryAgain`）：
- `USER_REJECTED` → 显示
- `phase === "value_chain"` 任何错误 → 显示
- `phase === "base_chain"` 非拒签 → **不显示**（bridge 已上链不能随意重提交）
- `phase === "enable_trading"` → 不显示（用户应手动重试 Enable Deposit）

---

## 数据更新对接

完成后的数据刷新走 `invalidateVaultMutationQueries`（实现位于 `src/shared/utils/invalidateVaultMutationQueries.ts`，由 `vault-notification` feature 维护，详见该 feature §8 全清单）：

| 时机 | 调用位置 | 策略 | 说明 |
|---|---|---|---|
| `topState.kind === "completed"` | `useSubmitVaultDeposit.onSuccess` (containers/useSubmitVaultDeposit.ts:151-172) | 3 次 setTimeout（3s / 5s / 9s） | 兜底 ValueChain 节点同步延迟 |
| WS sodex_deposit Success | `useDepositNotice.ts:96-114` | 独立 invalidate（仅 vault.investInfo / mag7Balance / slpBalance / hasMyActivity / activity / myActivity） | base 桥接成功的局部刷新（注意：与 mutation 刷新覆盖范围不完全一致） |

**deposit 不走 sodex_call_for**（与 claim/unstake/withdraw 不同），因为 deposit 链上即时落账。

刷新覆盖 17 个 query key（vault.* / chain.evmBalances / spot.accountState / wagmi readContracts/readContract 前缀）—— 完整清单见 `vault-notification` feature §8.4。

**deposit 流程对清单中 query key 的具体影响**：

| query key | 影响 |
|---|---|
| `vault.slpBalance(account)` | 增加（vault 内部 mint SLP 给用户） |
| `vault.investInfo(account)` | 持仓增加 |
| `vault.mag7Balance(account)` | 链上余额减少（被 deposit 进 vault） |
| `chain.evmBalances(account)` | EVM-Funding vMAG7/vsMAG7 减少（permit 被 vault 划走） |
| `spot.accountState(account)` | Spot 余额变化（如果 from=SPOT，transfer 后减少） |
| `[...vault.all(), "activity"]` / `myActivity` | 新增 deposit 记录 |
| `[...vault.all(), "investInfo", "global"]` | 全局 TVL 增加 |
| `[...vault.all(), "navCurve"]` / `depositors` | 全局图表/列表 |
| `["readContracts"]` / `["readContract"]` 前缀 | wagmi 链上 read 缓存（vault 页 ERC20 余额） |
| `auth.exchangeAccountId(addr)` | **deposit 完成首次链上创建 accountId** —— `useDepositNotice` Success 分支强制 invalidate（不依赖 dedupe） |

> `auth.exchangeAccountId` invalidate 是 deposit 特有 —— 第一次 deposit 完成时链上创建 accountId，需要重新 fetch 让其入 session.chainAccountId。详见 `useDepositNotice.ts:73-78`。

---

## 关键常量

文件：`src/features/vault/domain/constants.ts`

| 常量 | 值 | 用途 |
|---|---|---|
| `DEPOSIT_MIN_AMOUNT` | `"5"` | 最低 deposit 金额（MAG7.ssi） |
| `DEPOSIT_TO_CLOB` | `true` | bridge 资金到 Spot 账户 |
| `DEPOSIT_BASE_TX_CONFIRMATIONS` | **`2`** | Base 链 approve / bridge tx receipt 等确认数 |
| `DEPOSIT_VALUE_TX_CONFIRMATIONS` | `3` | Value 链 confirm tx receipt 等确认数 |
| `DEPOSIT_APPROVE_POST_DELAY_MS` | `500` | approve 完成后 sleep 缓冲（MetaMask 冲突保护） |
| `DEPOSIT_BRIDGE_SYNC_DELAY_MS` | **`2000`** | Spot→EVM-Funding transfer 后等服务端同步 |
| `DEPOSIT_APPROVE_DEADLINE_SEC` | `30 * 60` (1800s = 30min) | ERC2612 permit deadline 偏移 |
| `CALL_FOR_PERMIT_DEADLINE_SECONDS` | `3600` (1h) | CallForPermit 外层 deadline 偏移 |
| `DEPOSIT_ENABLE_TRADING_MAX_ATTEMPTS` | **`15`** | waitForAccountReady Phase 1 最大轮询次数 |
| `DEPOSIT_ENABLE_TRADING_RETRY_INTERVAL_MS` | **`1000`** | waitForAccountReady 轮询间隔(1s × 15 = 最长 15s) |
| `DEPOSIT_TRY_AGAIN_TIMEOUT_MS` | **`3000`** | Try Again 按钮点击后自动隐藏延迟（3s） |
| `DEPOSIT_SETTLE_MAX_ATTEMPTS` | **`15`** | pollBridgeSettle 最大轮询次数（用于 base bridge_settling 阶段） |
| `DEPOSIT_SETTLE_POLL_INTERVAL_MS` | **`5000`** | pollBridgeSettle 轮询间隔（5s × 15 = 最长 75s 后 timeout 视为 SETTLING_COMPLETED 不阻塞） |
| `VAULT_TOKEN_DECIMAL` | `8` | vMAG7/vsMAG7 链上精度 |
| `VAULT_DEFAULT_DECIMAL` | `4` | UI 展示精度 |
| `VAULT_DEFAULT_MINIMUM_DECIMAL` | `2` | UI 最小展示精度（cooldown banner 等） |

---

## 开发修改指南

### 新增错误码

1. 在 `domain/types.ts` `VaultServiceError` union 追加 `{ kind: "DEPOSIT_NEW_KIND"; ... }`
2. `mapCauseToDepositError` (`useVaultDepositMachine.ts:784`) 增加 state.kind → 新 kind 的映射
3. `handleDepositServiceError` 增加 case 映射 toast
4. 同步 `handleClaimServiceError` / `handleUnstakeServiceError` / `handleWithdrawServiceError` 的 fallthrough 列表

### 新增 Base 链子 step

1. 在 `BaseChainState` union 追加 state（如 `bridge_sending` 中间态）
2. 在 `BaseChainAction` 追加 transitions
3. 在 `baseChainReducer` 加 case
4. 在 `runBaseChainState` (`useVaultDepositMachine.ts:286`) switch 加 case + atomic call
5. 同步 dialog 的 `sodexCurrentStep`（`index.tsx:828-848`）映射

### 新增 Value 链子 step

类似上面，但需注意 `deriveValueChainSteps` 与 `mapValueChainStepStatus` 的 step 顺序。如果新 step 跨 needsTransfer/needsStake 配置，记得在 `decideValueChainConfig` 同步配置规则。

### 修改 RETRY 复用规则

只改 `baseChainReducer` / `valueChainReducer` 的 `case "failed":` 分支。新 cache 字段同步加到 `BaseChainCache` / `ValueChainCache` type，在 `dispatchValue({type:"FAILED", cache: {...}})` 写入。

### 修改默认 chain / token / from

只改 `useVaultDepositForm.ts:51-57` `resolveDefaultChain` + 90-106 默认值初始化。注意 `defaultChain` 优先级最高（外部传入）。

### 修改 enable_trading 轮询

改 `domain/constants.ts` 的 `DEPOSIT_ENABLE_TRADING_MAX_ATTEMPTS / DEPOSIT_ENABLE_TRADING_RETRY_INTERVAL_MS`。两阶段拆分逻辑在 `useSubmitVaultDeposit.ts:100-143`。

### 修改 toast 文案

- 本地错误（`DEPOSIT_*` / `TRANSFER_FAILED` / `EVM_BALANCE_TIMEOUT` 等）：改 `handleDepositServiceError`（本 feature 内）
- WS 推送 / vault completion：改 `features/trade/containers/useDepositNotice.ts` 的 `notifyVaultDepositCompleted` / sodex_deposit pending/success 分支文案 → 这是 `vault-notification` feature 的边界，改前请阅读其 §4.1 + §5

### 修改 SoDEX/Vault 面板自动展开折叠规则

只改 `index.tsx:534-548` 的 `useEffect` + `index.tsx:920+` 的 `isExpanded` 派生表达式。

### 修改 deposit fee 比例

`index.tsx:49` 的 `DEPOSIT_FEE_RATE = 0.00005`。同步检查 `feesOriginalDisplay` / `youReceiveDisplay` 计算（`index.tsx:594-617`）。

---

## 术语表

| 术语 | 含义 |
|---|---|
| **VaultDepositWithPermit2** | CallForPermit cmdType；外层签名包裹 ERC2612 permit 的 v/r/s + token/amount/permitDeadline |
| **CALL_FOR_PERMIT_ADDRESS** | CallForPermit 合约地址 (Value 链) |
| **VAULT_CALLER_ADDRESS** | VaultCaller 合约（claim/unstake/withdraw 的 `to`，**deposit 不用此地址**） |
| **SLP_TOKEN_ADDRESS** | sMAG7.SLP token 地址 = ERC4626 vault token；deposit 的 `to` |
| **vMAG7 / vsMAG7** | Value 链 ERC20 token；UI 显示 MAG7.ssi/sMAG7.ssi（去 v 前缀） |
| **isStake** | true=用户输入 MAG7（vault 内部 stake → vsMAG7）；false=输入 sMAG7（直接 deposit vsMAG7） |
| **DEPOSIT_TO_CLOB** | bridge 时 toClob=true，资金到 Spot 账户（ValueChain 子机的 `from` 强制 SPOT） |
| **TopPhase** | "base_chain" / "value_chain" / "enable_trading" |
| **needsTransfer / needsStake** | ValueChainConfig；needsStake 当前恒 false（vault 内部处理 stake） |
| **isNewUser / isFirstTimeUser** | `isAccountIdProbing || !accountId`；锁定快照防 WS 推送后变化 |
| **isAwaitingWalletSignature** | 仅 base.approving / value.approving / value.confirm_signing 时 true |
| **needsStandaloneEnableDeposit** | 老用户 apiKey 失效场景，显示独立 Enable Deposit 按钮（embedded 模式） |
| **prevTopKindRef / prevBaseKindRef / prevValueKindRef** | 防 effect 重入的 React StrictMode 双跑保护 |
| **resolvedBridgeAddrRef** | bridge 地址懒加载缓存（独立 ref，避免 render 覆盖） |
| **approveSignatureRef / approveDeadlineRef / confirmPayloadRef** | 中间产物缓存，RETRY 时复用 |
| **DEPOSIT_FEE_RATE** | 0.00005 = 0.005% 手续费率（前端 SoDEX 显示用，链上实际 0） |
| **userHasEditedRef vs hasUserInputtedRef** | 双 ref 区分 auto-fill 与手动编辑，防 RQ refetch 误报 |
| **bridge_settling 超时** | DEPOSIT_BRIDGE_TIMEOUT 是 warning，**不阻塞流程**（继续走 SETTLING_COMPLETED） |
| **WS sodex_deposit** | bridge 进度推送，在 vault completion 之前；详见 vault-notification §4.1 |

---

## 更新记录

### 2026-04-30：初始版本

通过 `/k:context-learn` 从代码自动生成 + 人工补充关联引用。覆盖：
- 11 个 deposit 源文件（dialog 10 + container 5 + domain 2 + infra 1，~5870 行）
- 全部错误码（11 个 DEPOSIT_* + ENABLE_TRADING_TIMEOUT + TRANSFER_FAILED/EVM_BALANCE_TIMEOUT + 通用 kind）
- **3 层 reducer 完整图**（top + base + value）+ 转换矩阵 + RETRY 缓存复用规则
- **完整流程 ASCII 图**（Container → Outer → Inner machine → Reducers → Infra → 链上）
- 11 项关键设计决策（不建 Service / 3 层 reducer / enable_trading 两阶段 / signer 锁 / 双 ref / isNewUser 快照 / 3 屏切换 / `to=SLP_TOKEN` / 折叠展开 / 1s 延迟关闭 / Privy 兼容）
- 防重入硬规则（StrictMode + unmount + AbortController + reset 时机）
- 11 个关键实现细节（懒加载 / RETRY / domain 兜底 / Permit token 同地址 / MetaMask 缓冲 / Bridge timeout 不阻塞 / panel 状态派生 / failed 视觉保留 / SoDEX 自动折叠 / 1s 延迟 / Phase 1+2 拆分）
- 错误码 → 阶段映射表
- 关键常量表（13 个）
- 开发修改指南（8 类常见修改步骤）
- **关联文档区**指向 `vault-notification` feature 9 个具体章节 + 2 份迁移 spec + 3 段业务 spec

### 2026-04-30：补充验证（/k:context-update）

通过 `/k:context-update` 补读 5 个未覆盖文件（Trading.tsx / DepositToVaultStep.tsx / Preview.tsx 节选 / constants.ts 节选 / vaultDepositInfra.ts 完整 export 清单）后补充：
- **常量值修正 + 补全**：`DEPOSIT_BASE_TX_CONFIRMATIONS` 从 3 修正为 **2**；补充 `DEPOSIT_BRIDGE_SYNC_DELAY_MS=2000` / `DEPOSIT_ENABLE_TRADING_MAX_ATTEMPTS=15` / `DEPOSIT_ENABLE_TRADING_RETRY_INTERVAL_MS=1000` / `DEPOSIT_TRY_AGAIN_TIMEOUT_MS=3000` / `DEPOSIT_SETTLE_MAX_ATTEMPTS=15` / `DEPOSIT_SETTLE_POLL_INTERVAL_MS=5000` / `VAULT_DEFAULT_MINIMUM_DECIMAL=2` 实际值
- **Trading 屏数字圆圈布局**（Figma 430-34942）：动态过滤可见 panel + `stepNumber + showConnectorLine`，4 种渲染场景
- **Trading 屏标题动态切换**：`isAwaitingWalletSignature` 时用 `useWalletSigningText().signingHint`（钱包类型动态提示）
- **DepositToVaultStep 文案常量**：4 个 step × 3 状态（active / completed / pending）+ stake 步骤注释（needsStake=false 时不显示）
- **computeVaultCurrentStep stake 兜底**：`stakeStep >= 0 ? stakeStep : approveStep` 防止 needsStake=false 时显示出错
- **infra atomic 函数 15 个**（之前写 11 个）：补 `getStakeCallForPermitNonce / signEip712TypedData / submitDepositPermit / waitValueReceipt`
