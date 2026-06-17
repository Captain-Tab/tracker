# Vault Withdraw 完整流程

> Vault SLP 的 Withdraw 入口：用户用 sMAG7.SLP 凭证从 Vault 提取 MAG7.ssi 或 sMAG7.ssi。**两个 token 走完全不同的代码分支**——本 guide 重点说明分支差异。

---

## 关联文档

本 feature **不**自管 toast 与数据刷新——这两件事统一由 `vault-notification` feature 提供基础设施，本 feature 仅作为消费方调用。

| 关注点 | 关联文档 |
|---|---|
| **Toast 完整时序（含 sMAG7 / MAG7 两路差异）** | [`vault-notification` feature §4.2 sMAG7 单信号 + §4.3 MAG7 双信号](../../router/vault.json#vault-notification) |
| **`notifyVaultWithdrawSuccess` helper（共用）** | `vault-notification` feature §5（sMAG7 mutation 主动弹 + MAG7 路径 WS callFor type=1 共用同一 helper） |
| **Pending toast 关闭机制** | `vault-notification` feature §6.2 — callFor pending 双路径关闭 |
| **错误码体系（CALL_FOR_* → WITHDRAW_REDEEM_*）** | `vault-notification` feature §7.2 — 错误码转换链 |
| **错误 toast 映射全表** | `vault-notification` feature §7.3 — `handleWithdrawServiceError` |
| **数据刷新策略** | `vault-notification` feature §8 — `invalidateVaultMutationQueries`（17 query key + 3/5/9s 兜底） |
| **WS sodex_call_for type=1 推送链路** | `vault-notification` feature §8.6 — 端到端链路（仅 MAG7 路径） |
| **Toast 规范源 spec（迁移历史）** | `.claude/kit/spec/vault-migration/withdraw-toast.md` |
| **数据刷新源 spec（迁移历史）** | `.claude/kit/spec/vault-migration/data-refresh.md` |

> 阅读顺序建议：先读本 guide §核心分支差异理解 sMAG7 vs MAG7 两条路径，再读 `vault-notification` feature 看 toast 如何被分别驱动（sMAG7 主动 / MAG7 等 WS）。

---

## 核心分支差异：sMAG7 vs MAG7

| 维度 | `withdraw → sMAG7`（vsMAG7） | `withdraw → MAG7` |
|---|---|---|
| **mutation 步骤数** | 1 步：`executeVaultRedeem` | 2 步：`executeVaultRedeem` + `executeUnstakePermit` |
| **链上行为** | redeem 即 burn SLP + mint vsMAG7 到 EVM-Funding | redeem → 然后用 redeem 出的 sMAG7 unstake 进 cooldown |
| **真完成信号** | mutation onSuccess（链上 receipt = 真完成） | WS `sodex_call_for type=1 Success`（cooldown 启动后服务端推送） |
| **Toast 来源** | mutation 主动调 `notifyVaultWithdrawSuccess` 弹 | `useDepositNotice` callFor 分支调同一 helper |
| **Toast 文案** | `Withdraw X.XX sMAG7.ssi successfully.` | `Withdraw X.XX sMAG7.ssi successfully.` ⚠️ 共用同一文案（call_for inCoinSymbol=sMAG7） |
| **后续等待** | 无（即时到账 EVM-Funding） | 14-day cooldown，期满后通过 claim 提取 |
| **Phase 状态** | idle → approving → redeeming → idle（onSuccess） | idle → approving → redeeming → unstaking → idle |
| **签名次数** | 2 次（SLP Permit + outer CallForPermit） | 3 次（前两次同 + unstake permit） |
| **进度视图步骤** | 2 步：Approve → Withdraw | 3 步：Approve → Withdraw → Unstake |
| **Warning Alert** | 不显示 | 显示 14-day lockup 提示 |
| **ETA 信息行** | 不显示 | 显示 Estimated Time of Arrival |
| **二次确认** | 不需要 | cooldown 中重复 withdraw 触发 reset lock-up 警告 |

---

## 架构概览

```
┌────────────────────────────────────────────────────────────┐
│ vault VaultHeader 入口                                      │
│   onClick → openVaultWithdrawDialog()                       │
└─────────────────────┬──────────────────────────────────────┘
                      │
                      ▼
┌────────────────────────────────────────────────────────────┐
│ VaultWithdrawDialog (壳层由 modalManager 提供)              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ 顶部 cooldown banner(可选,用户在 cooldown 中)        │  │
│  │ 动态描述(MAG7/sMAG7 不同文案)                        │  │
│  │ NumberInput: amount + Max(maxSlp,SLP 余额)           │  │
│  │   placeholder: `Minimum ${form.min}`(动态)           │  │
│  │   helperText: deriveWithdrawHelperText               │  │
│  │ CoinSelectRow: Dropdown 切 MAG7 / sMAG7 (TokenLogo)  │  │
│  │ Alert(warning, 仅 MAG7): 14-day lockup 提示          │  │
│  │ InfoRow × 3 / × 4(MAG7 多 ETA):                       │  │
│  │   - Fees: computeWithdrawFee(NAV*amount - preview)   │  │
│  │   - You receive: previewAssets(链上 previewRedeem)   │  │
│  │   - Rate: `1 sMAG7.SLP = NAV ${coin}`                │  │
│  │   - ETA(仅 MAG7): now + cooldownSeconds              │  │
│  │ <VaultWithdrawButton state isAwaitingWalletSig />    │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────┬──────────────────────────────────────┘
                      │ form.onSubmit
                      │   ├─ MAG7 + cooldown 已激活/有 pending → 弹 Confirmation Dialog
                      │   └─ 其他 → 直接 submit({ token, amount, slpDecimals })
                      ▼
┌────────────────────────────────────────────────────────────┐
│ useSubmitVaultWithdraw (mutation 编排)                      │
│                                                             │
│  onMutate: 锁 signer (getCurrentOnChainCapability)          │
│  ────────────────────────────────────────────────────       │
│  mutationFn:                                                │
│    setPhase("approving") + setIsAwaitingWalletSignature(true)│
│    Step A: executeVaultRedeem(capability, input)            │
│             onSigned 回调(第二次签完):                      │
│               setPhase("redeeming")                          │
│               setIsAwaitingWalletSignature(false)           │
│    ─────── 分支 ───────                                     │
│    if token === "sMAG7":                                    │
│       return { success: true, redeemTxHash }                │
│    else (token === "MAG7"):                                 │
│       setPhase("unstaking") + setIsAwaitingWalletSig(true)  │
│       Step B: executeUnstakePermit(capability, {            │
│                amount: formatUnits(redeem.assetsBigInt, 8), │
│                account, onSigned })                          │
│       return { success, redeemTxHash, unstakeTxHash }       │
│  ────────────────────────────────────────────────────       │
│  onSuccess(_data, params, context):                         │
│    setPhase("idle")                                         │
│    if params.token === "sMAG7":                             │
│       notifyVaultWithdrawSuccess(amount, "sMAG7.ssi") ⚠️    │
│    setTimeout × 3 invalidateVaultMutationQueries(3s/5s/9s)  │
│  ────────────────────────────────────────────────────       │
│  onError: handleWithdrawServiceError(error)                 │
└────────────┬───────────────────────────────┬───────────────┘
             │ Step A                          │ Step B (MAG7 only)
             ▼                                  ▼
┌────────────────────────────────┐  ┌──────────────────────────────┐
│ vaultWithdrawService           │  │ vaultUnstakeService          │
│  executeVaultRedeem            │  │  executeUnstakePermit        │
│   1. Promise.all([             │  │   (复用 unstake feature 实现, │
│        getSlpTokenNonce(acc),  │  │    详见 vault-unstake guide) │
│        getVaultRedeemPermitNonce(acc) │ │                          │
│      ])                        │  │  catch:                       │
│   2. buildSlpPermitTypedData   │  │   CALL_FOR_FAILED→UNSTAKE_FAILED│
│      → signCallForPermit(SLP)  │  │   CALL_FOR_TIMEOUT→UNSTAKE_TIMEOUT│
│   3. parseSignatureVrs(sig)    │  └──────────────────────────────┘
│      → onSigned() ─────────────┐         │
│      (推进 step,UI approving→  │         │
│       redeeming;但仍要再签一次)│         │
│   4. buildVaultRedeemCallForPermitTypedData │
│      → signCallForPermit(outer)│         │
│   5. buildVaultRedeemCmdData   │         │
│      → postCallForPermit       │         │
│      → txHash                  │         │
│   6. waitAndParseRedeemAssets  │         │
│      → assetsBigInt(8 位精度)  │         │
│   ────────────────────────     │         │
│   catch:                        │         │
│    CALL_FOR_FAILED→             │         │
│      WITHDRAW_REDEEM_FAILED     │         │
│    CALL_FOR_TIMEOUT→            │         │
│      WITHDRAW_REDEEM_TIMEOUT    │         │
└────────────────────────────────┘         │
             │                              │
             └──────────────┬───────────────┘
                            ▼
┌────────────────────────────────────────────────────────────┐
│ MAG7 路径触发 sodex_call_for type=1(unstake 启动 cooldown) │
│  Pending → useDepositNotice 弹 "Withdrawing in progress..." │
│  Success → notifyVaultWithdrawSuccess(inAmount, sMAG7.ssi)  │
│             + invalidateVaultMutationQueries (单次,权威刷)  │
│  详见 vault-notification feature                            │
│                                                             │
│ sMAG7 路径无 WS 推送(链上 redeem 即时落账)                  │
└────────────────────────────────────────────────────────────┘
```

---

## 核心逻辑

### useSubmitVaultWithdraw — Container 编排（两路分支核心）

文件：`src/features/vault/containers/useSubmitVaultWithdraw.ts:41-172`

```ts
export type WithdrawPhase = "idle" | "approving" | "redeeming" | "unstaking";

export function useSubmitVaultWithdraw(): {
  submit: (params: { token: WithdrawToken; amount: string; slpDecimals: number }) => Promise<WithdrawResult>;
  isSubmitting: boolean;
  isAwaitingWalletSignature: boolean;
  phase: WithdrawPhase;
  error: VaultServiceError | null;
  reset: () => void;
}
```

关键职责（**唯一一个跨 service 编排的 mutation**：vault-withdraw → vault-unstake service）：

1. **onMutate** — `getCurrentOnChainCapability()` 锁 signer 写入 mutation context
2. **mutationFn**：
   - `setPhase("approving")` + `setIsAwaitingWalletSignature(true)`
   - **Step A** (sMAG7 / MAG7 共有): `executeVaultRedeem(capability, { amount, account, slpDecimals, onSigned })`
     - `onSigned` 回调 (第二次签完触发): `setPhase("redeeming")` + `setIsAwaitingWalletSignature(false)`
     - 等链上 redeem receipt + 解析 Redeem 事件
   - **分支**：
     - `params.token === "sMAG7"` → `return { success: true, redeemTxHash }`（**结束**）
     - `params.token === "MAG7"` → 继续 Step B
   - **Step B (MAG7 only)**:
     - `setPhase("unstaking")` + `setIsAwaitingWalletSignature(true)`
     - `unstakeAmount = formatUnits(redeem.assetsBigInt, VAULT_TOKEN_DECIMAL=8)`
     - `executeUnstakePermit(capability, { amount: unstakeAmount, account, onSigned })`
     - `return { success: true, redeemTxHash, unstakeTxHash }`
3. **onSuccess** —
   - `setPhase("idle")`
   - **仅 sMAG7 主动弹 toast**: `notifyVaultWithdrawSuccess(params.amount, "sMAG7.ssi")`
   - **MAG7 不弹**（等 WS sodex_call_for type=1 Success 推送）
   - 3 次延迟 `invalidateVaultMutationQueries(qc, context.account)` (3s / 5s / 9s)
4. **onError** —
   - `setPhase("idle")`
   - `handleWithdrawServiceError(error)` 按 kind 映射 toast

### executeVaultRedeem — Service 命令（两次签名）

文件：`src/features/vault/services/vaultWithdrawService.ts:45-141`

```ts
export type VaultRedeemResult = {
  txHash: `0x${string}`;
  /** Redeem 事件解析出的 sMAG7 数量(bigint, 8 位精度) */
  assetsBigInt: bigint;
};

export async function executeVaultRedeem(
  capability: OnChainCapability,
  input: { amount: string; account: Address; slpDecimals: number; onSigned?: () => void },
): Promise<VaultRedeemResult>
```

5 步流程（**两次签名**——这是 withdraw 区别于 claim/unstake 的核心）：

1. **并行读两个 nonce**:
   - `getSlpTokenNonce(account)` — SLP 合约的 ERC20 Permit nonce（key 单一）
   - `getVaultRedeemPermitNonce(account)` — CallForPermit 合约的 nonce(account, **key=4**) — VaultRedeemWithPermit 专用 key
2. **第 1 次签名 — SLP ERC20 Permit (EIP-2612)**:
   - `buildSlpPermitTypedData({ owner, spender: CALL_FOR_PERMIT_ADDRESS, amountWei, ... })`
   - `signCallForPermit(capability, slpPermitTypedData)` → 65 字节签名
   - `parseSignatureVrs(sig)` 拆出 `{ v, r, s }`（后面 cmdData + outer message 都要用）
3. **触发 onSigned** ← **这里 onSigned 不是签完所有签名,而是签完第 1 次**（注释：`SLP Permit 签完 → 进入 redeeming 阶段`）
   - 之后第 2 次签名时 spinner 应在 "Withdraw from SLP" 上
4. **第 2 次签名 — CallForPermit 外层（包裹 v/r/s）**:
   - `buildVaultRedeemCallForPermitTypedData({ cmd: { token, amount, deadline, v, r, s }, to: SLP_TOKEN_ADDRESS, nonce: redeemNonce, deadline, chainId, verifyingContract: CALL_FOR_PERMIT_ADDRESS })`
   - `cmdType = "VaultRedeemWithPermit"`（不是 `CreateBridgeCallFor`）
   - `signCallForPermit(capability, redeemTypedData)` → outerSignature
5. **后端提交 + 等 receipt**:
   - `buildVaultRedeemCmdData({ tokenAddress, amountWei, permitDeadline, v, r, s })` → encodeAbiParameters hex
   - `buildVaultRedeemCallForPermitRequest(...)` 组装 POST body
   - `postCallForPermit(postBody)` → `txHash`
   - `waitAndParseRedeemAssets(txHash)` — 等 3 confirmations + 解析 Redeem 事件取 `assetsBigInt`

catch 分支错误码转换：
- `CALL_FOR_FAILED` → `WITHDRAW_REDEEM_FAILED`（带 txHash + message）
- `CALL_FOR_TIMEOUT` → `WITHDRAW_REDEEM_TIMEOUT`（带 txHash）
- 其他 → 透传 mapped error

> Service 内部已抛过的 `VaultServiceError`（含 `UNSTAKE_FAILED` / `UNSTAKE_TIMEOUT` 等所有可能从 unstake service 透传上来的 kind）通过 `isServiceError` 直接 rethrow，不二次 map。

### waitAndParseRedeemAssets — Infra 解析 Redeem 事件

文件：`src/features/vault/infra/chain/vaultWithdrawInfra.ts:209-254`

```ts
export async function waitAndParseRedeemAssets(txHash: `0x${string}`): Promise<bigint>
```

1. `waitForTransactionReceipt(wagmiConfig, { hash: txHash, confirmations: 3 })`
2. 检查 `receipt.status === "success"`，否则抛 `TX_REVERTED`
3. 找匹配 log: `address === SLP_TOKEN_ADDRESS && topics[0] === REDEEM_EVENT_TOPIC`
4. 解析 data 第 4 段 32 字节为 `assetsBigInt`
   - data 布局: `investor(32B) | receiver(32B) | shares(32B) | assets(32B)`
   - `assets = data.slice(192, 256)`（跳过前 3 段 = 96 字节 = 192 hex chars）
5. 找不到事件 → 抛 `UNKNOWN`（service catch 不会转 WITHDRAW_REDEEM_*，handler 仍按 default 处理）

> `REDEEM_EVENT_TOPIC = 0x3f693fff038bb8a046aa76d9516190ac7444f7d69cf952c4cbdc086fdef2d6fc` 硬编码（来自合约 ABI 的 keccak hash）。

### useVaultWithdrawForm — 表单状态（含 token 切换）

文件：`src/features/vault/containers/useVaultWithdrawForm.ts:13-83`

```ts
export function useVaultWithdrawForm(input: {
  max: string;
  min?: string;          // 来自链上 callForMinAmounts;未就绪 fallback WITHDRAW_MIN_AMOUNT="4"
  initialToken?: WithdrawToken;
}): {
  token: WithdrawToken;
  onTokenChange: (next: WithdrawToken) => void;  // 切换时 reset amount(prev !== next)
  amount: string;
  onAmountChange: (next: string) => void;        // 8 位小数校验
  onMax: () => void;                              // setAmount(input.max)
  reset: () => void;
  helperText: string | null;
  isValid: boolean;
  min: string;
  max: string;
}
```

关键差异（vs claim/unstake form）：
- 多 `token` state（`WithdrawToken = "MAG7" | "sMAG7"`）
- `onTokenChange` 切换时**自动 reset amount**（避免 sMAG7 amount 残留到 MAG7 输入）
- `min` 是**外部传入的动态值**（来自 `useVaultMinWithdrawAmountQuery(token)`，按 token 切换重新读链上 `callForMinAmounts(chain, coinSymbol)`），`undefined` fallback `WITHDRAW_MIN_AMOUNT="4"`
- `max` 始终是 `useSlpBalanceQuery(address).data.value`（**SLP 余额，不区分 token**——SLP 是 withdraw 凭证）

### deriveWithdrawButtonState + computeWithdrawFee — 纯函数

文件：`src/features/vault/containers/withdrawFlowLogic.ts:7-77`

```ts
export function deriveWithdrawButtonState(input: {
  amount: string;
  min: string;
  max: string;
  isSubmitting: boolean;
}): ClaimButtonState  // 与 claim/unstake 共用 ClaimButtonState 类型

// 由 dialog 层调,纯派生展示用 fee 字符串
export function computeWithdrawFee(input: {
  nav: string | undefined;
  amount: string;
  previewAssets: string | undefined;
}): string  // "X.XX" 或 "--" 或异常值兜底
```

`computeWithdrawFee` 公式：`fee = NAV * amount - previewRedeem(amount)`，结果 ≤ 0 视为异常返回 `"--"`。

`deriveWithdrawHelperText` 文案差异：`Minimum withdraw is ${min} sMAG7.SLP`（以 SLP 单位显示，即用户输入的单位）。

### handleWithdrawServiceError — Toast 映射

文件：`src/features/vault/containers/handleWithdrawServiceError.ts:6-80`

| `error.kind` | toast | 文案 |
|---|---|---|
| `USER_REJECTED` | — | **静默** 不弹 |
| `WITHDRAW_APPROVE_FAILED` | `notify.error` | `Approve failed: ${message}` 或 `Approve failed, please try again` |
| `WITHDRAW_REDEEM_FAILED` | `notify.error` | `Redeem failed: ${message}` 或 `Redeem failed, please try again` |
| `WITHDRAW_REDEEM_TIMEOUT` | `notify.warning` | `Redeem submitted, waiting for on-chain confirmation. Check Activity tab later.`（带 txHash）/ `Redeem submitted, confirmation may take longer than usual.`（无 txHash） |
| `WITHDRAW_REDEEM_EVENT_MISSING` | `notify.warning` | `Redeem submitted, but event parsing failed. Please check Activity tab.` |
| `UNSTAKE_FAILED` (来自 Step B 透传) | `notify.error` | `Unstake step failed: ${message}` 或 `Unstake step failed, sMAG7 is in your wallet. Retry from Unstake.` |
| `UNSTAKE_TIMEOUT` (来自 Step B) | `notify.warning` | `Unstake submitted, waiting for on-chain confirmation. Check Activity tab later.` |
| `NETWORK_ERROR` | `notify.error` | `Network error, please check your connection` |
| `CHAIN_MISMATCH` | `notify.error` | `Wrong network, please switch to chain ${expected}` |
| 其他（fallthrough default） | `notify.error` | `error.message` 或 `Request failed, please try again` |

> 关键：MAG7 路径 Step B 失败时（unstake 步骤已经把 sMAG7 unstake 成功，cooldown 已启）`UNSTAKE_FAILED` 文案提示用户"sMAG7 is in your wallet. Retry from Unstake."，引导用户去 Unstake 弹窗重试，而不是再点 Withdraw（避免重复签 redeem）。

---

## 关键实现

### 1. 两次签名的 onSigned 时机（推动 phase 从 approving 到 redeeming）

**关键设计**：`onSigned` **不是**签完所有签名才触发，而是**第 1 次（SLP Permit）签完时**触发。

```ts
// vaultWithdrawService.ts:74-82
const permitSignature = await signCallForPermit(capability, slpPermitTypedData);
const { v, r, s } = parseSignatureVrs(permitSignature);

// SLP Permit 签完 → 进入 redeeming 阶段
input.onSigned?.();

// 接下来用户要签第 2 个(outer CallForPermit)
const outerSignature = await signCallForPermit(capability, redeemTypedData);
```

**为什么这样设计**：UI 进度视图（`VaultWithdrawProgressView`）的 step 1 "Approve Spending Cap" 是 SLP Permit 签名；step 2 "Withdraw from SLP" 是 outer CallForPermit 签名。第 1 次签完进入 step 2 active 状态，spinner 移到 "Withdraw from SLP" 上 —— 即使第 2 次还需要用户在钱包签名。

**Container 层处理**：
```ts
// useSubmitVaultWithdraw.ts:103-106
onSigned: () => {
  setIsAwaitingWalletSignature(false);  // 切到"等链上"(虽然马上要再次签名)
  setPhase("redeeming");                 // step 2 active
}
```

> 这是与 claim/unstake 单次签名的核心差异——它们的 `onSigned` 等价于"全部签名完成"，可以直接切到等链上确认。

### 2. token 切换 + 动态 min 查询

```tsx
// VaultWithdrawDialog/index.tsx:50-56
const [dialogToken, setDialogToken] = useState<WithdrawToken>("MAG7");
const minQuery = useVaultMinWithdrawAmountQuery(dialogToken);  // queryKey 含 coinSymbol
const form = useVaultWithdrawForm({
  max: maxSlp,
  min: minQuery.data?.formatted,         // 异步,未就绪时 form 内部 fallback
  initialToken: dialogToken,
});

const handleTokenChange = (next: WithdrawToken) => {
  setDialogToken(next);                   // dialog state(driven min query)
  form.onTokenChange(next);               // form state(内部还有 token,reset amount)
};
```

**双 state 设计**：
- `dialogToken` — driven `useVaultMinWithdrawAmountQuery` 重新读链上 `callForMinAmounts(BASE_ETH, coinSymbol)`
- `form.token` — driven `helperText` / `isValid` / `onMax`（amount reset 行为也基于此）

切换路径：用户点 Dropdown → `handleTokenChange(next)` → 同时更新两个 state → minQuery 重新 fetch + form amount reset → UI 显示新 token 的 placeholder/min/Warning Alert/ETA。

> `mapTokenToCoinSymbol` 把 UI 态 `MAG7`/`sMAG7` 映射到合约参数 `MAG7.ssi`/`sMAG7.ssi`（去 v 前缀）。`TARGET_CHAIN` 硬编码 `BASE_ETH`（提取目标链固定）。

### 3. cooldown 中重复 withdraw 的二次确认（仅 MAG7）

```tsx
// VaultWithdrawDialog/index.tsx:113-152
const cooldownPendingAmount = Number(cooldownData?.processing ?? "0");
const isCooldownActive = cooldownData?.cooldownEndTimestamp
  ? dayjs().isBefore(dayjs(cooldownData.cooldownEndTimestamp * 1000))
  : false;
const shouldShowCooldownConfirm = cooldownPendingAmount > 0 || isCooldownActive;

const handleFormSubmit = (event) => {
  event.preventDefault();
  if (!form.isValid || isSubmitting) return;
  // 仅 MAG7 场景需二次确认
  if (form.token === "MAG7" && shouldShowCooldownConfirm) {
    setShowingConfirm(true);  // 弹 Confirmation Dialog
    return;
  }
  void executeSubmit();
};
```

**为什么需要**：用户在 cooldown 中再点 Withdraw → MAG7 会"重置 lock-up"——服务端会按新 unstake tx 重新启动 cooldown 时钟，之前 cooldown 中的资产也会被合并重置。需要让用户明确知晓后再继续。

**实现细节**：嵌套二次确认弹窗使用 **Radix Dialog 直接渲染**（含独立 Portal + 遮罩），**不走 modalManager**：

```tsx
// VaultWithdrawDialog/index.tsx:173-202
<Dialog open={showingConfirm} onOpenChange={...} title="Confirmation" showClose ...>
  <VStack gap="lg">
    <p>Initiating a new withdrawal at this time will reset the lock-up period
       which you will be able to claim on {unlockTimeForConfirm}.</p>
    <p>Are you sure to proceed?</p>
  </VStack>
  <Button onClick={() => { setShowingConfirm(false); void executeSubmit(); }}>
    Confirm
  </Button>
</Dialog>
```

**为何不走 modalManager**：`openResponsive` 是**队列式**（一次只展示一个），如果 nest 调用会阻塞父弹窗；Radix Dialog 直接渲染独立 Portal，真正叠加在 withdraw 弹窗之上，避开队列化行为。

### 4. 提交期间替换为 Progress View（替代原表单）

```tsx
// VaultWithdrawDialog/index.tsx:159-167
if (isSubmitting) {
  return (
    <VaultWithdrawProgressView
      amount={form.amount}
      token={form.token}
      phase={phase}
    />
  );
}
```

`VaultWithdrawProgressView`（`VaultWithdrawProgressView.tsx:67-122`）按 token 显示不同步骤：
- **sMAG7**: 2 步 — Approve → Withdraw
- **MAG7**: 3 步 — Approve → Withdraw → Unstake

phase → currentStep 索引：
- `approving` → 0（step 1 active）
- `redeeming` → 1（step 2 active）
- `unstaking` → 2（step 3 active，仅 MAG7）

Top 显示 "Sign Transactions" 标题 + "You Withdraw {amount} sMAG7.SLP" 摘要卡 + 警告条："Transfer in progress. Closing it or failed may cause funds remain in EVM-Funding Account." + StepProcess 步骤列表。

### 5. cooldown banner（顶部状态条）

```tsx
// VaultWithdrawDialog/index.tsx:206-212
{showCooldownBanner && cooldownData ? (
  <VaultWithdrawCooldownBanner
    cooldownAmount={cooldownData.processing ?? "0"}
    cooldownEndTimestamp={cooldownData.cooldownEndTimestamp ?? 0}
  />
) : null}
```

`VaultWithdrawCooldownBanner`（`VaultWithdrawCooldownBanner.tsx`）显示：橙色 spinner（自定义 SVG，stroke-dasharray 部分弧）+ `${formatted} MAG7.ssi will be available to Claim on ${dateText}`。

显示条件：`cooldownPendingAmount > 0 || isCooldownActive`。MAG7 / sMAG7 都显示（提示用户当前有 cooldown 中资产）。

### 6. 5+ 个 share query 数据源

| Query hook | 提供数据 | 用途 |
|---|---|---|
| `useVaultMag7Balance(address)` | 余额聚合 | 加载态判断（不直接用于 Max） |
| `useSlpBalanceQuery(address)` | `{ value, decimals }` SLP 链上余额 | **Max** 来源 + `slpDecimals` 传给 mutation 做 amountWei 换算 |
| `useVaultNavQuery()` | NAV `{ raw, formatted }` | Rate 显示 + Fee 计算 |
| `useVaultPreviewRedeemQuery(amount, decimals)` | `{ formattedAssets }` | "You receive" 显示 + Fee 计算 |
| `useVaultCooldownSecondsQuery()` | 全局 cooldown 秒数 | ETA 计算 + Confirmation Dialog 解锁时间 |
| `useVaultCooldown(address)` | 用户 cooldown 状态 | banner 显示 + MAG7 二次确认判断 |
| `useVaultMinWithdrawAmountQuery(token)` | `{ raw, formatted }` 链上最小金额 | placeholder + helperText min |

> 与 claim 仅用 `useVaultCooldown` 单 query 相比，withdraw 数据源最多。

### 7. signer 锁（防钱包切换，与 claim/unstake 同模式）

`onMutate` 调 `getCurrentOnChainCapability()` 快照 `signerAddress` 写入 mutation context，`mutationFn` 内紧邻再次读取保证一致。中途换钱包 → `wagmi.signTypedData` 自然失败抛 `USER_REJECTED`。

**注意**：withdraw 用 `useConnection`（wagmi 3.x 新 API，替代 deprecated `useAccount`），同 vault-unstake/claim 不一致——这是渐进式重构产物。

### 8. 不使用独立 Enable Withdraw 按钮

```ts
// useSubmitVaultWithdraw.ts:86-90
// vault callForPermit 后端走 bizClient(不带 JWT/apiKey),全程仅依赖
// OnChainCapability 链上签名 + 链上 nonce 校验。新用户(链上未注册 accountId)
// 也能直接 withdraw,无需先 enable trading。
// 老用户 apiKey 失效场景由 dialog 层 "Enable Withdraw"(claim/unstake 同样)按钮承担,
// 此 hook 不再做 enable trading 检查。
```

但**当前 dialog 实现没有 `Enable Withdraw` 按钮**（与 claim/unstake 不同）—— withdraw 弹窗用 wagmi `useConnection().address` 而非 `useAuthState()`，没有 `apiKeyValid` / `accountId` 派生信号；这部分被有意省略。如未来需要补，参照 claim/unstake 的 `needsStandaloneEnable` 模式。

---

## 文件结构

```
src/features/vault/
├── components/dialogs/VaultWithdrawDialog/
│   ├── index.tsx                                384 行 UI 主入口 + opener + InfoRow / CoinSelectRow 内联子组件
│   ├── VaultWithdrawButton.tsx                  3 态按钮(等签名/提交中/默认)
│   ├── VaultWithdrawCooldownBanner.tsx          顶部 cooldown 状态条(橙色 spinner + 解锁时间)
│   ├── VaultWithdrawProgressView.tsx            提交中替换表单的进度视图(2/3 步 by token)
│   └── VaultWithdrawSkeleton.tsx                4 段 pulse 占位(description/inputs/alert/info rows/button)
│
├── containers/
│   ├── useSubmitVaultWithdraw.ts                两路分支 mutation 编排 + WithdrawPhase state
│   ├── useVaultWithdrawForm.ts                  表单 state(含 token + 动态 min + 切 token reset amount)
│   ├── withdrawFlowLogic.ts                     纯函数 + computeWithdrawFee
│   ├── handleWithdrawServiceError.ts            error.kind → toast 文案映射
│   └── shared/                                   多 query hooks
│       ├── useSlpBalanceQuery.ts                Max + slpDecimals
│       ├── useVaultNavQuery.ts                  Rate + Fee
│       ├── useVaultPreviewRedeemQuery.ts        You receive
│       ├── useVaultCooldownSecondsQuery.ts      ETA
│       ├── useVaultCooldown.ts                  banner + 二次确认
│       └── useVaultMinWithdrawAmountQuery.ts    placeholder + min(token-aware queryKey)
│
├── services/
│   └── vaultWithdrawService.ts                  executeVaultRedeem(catch CALL_FOR_*→WITHDRAW_REDEEM_*)
│
├── infra/chain/
│   └── vaultWithdrawInfra.ts                    SLP nonce/balance + NAV/previewRedeem/minAmount/cooldown 链上读 + waitAndParseRedeemAssets
│
└── domain/
    └── withdrawPermit.ts                        EIP-712 typed data(SLP Permit + outer CallForPermit) + cmd encode + parseSignatureVrs
```

**关键复用关系**：
- **依赖 `vaultClaimInfra`**：`signCallForPermit` / `waitForClaimReceipt` 从 claim infra 复用（单次签名抽象，withdraw 调两次）
- **依赖 `vaultUnstakeService`**：MAG7 路径 Step B 直接调 `executeUnstakePermit`（unstake feature 的 service）
- **被 `useDepositNotice`（trade feature）消费**：MAG7 路径 onSuccess 不弹 toast，等其监听 sodex_call_for type=1

**跨 feature**（仅通过 public API）：
- `@/features/auth` — `getCurrentOnChainCapability`, `OnChainCapability` type, `useWalletSigningText`（withdraw button 内）
- `@/features/trade` — `notifyVaultWithdrawSuccess`（仅 sMAG7 路径调用）
- `@/shared/utils/invalidateVaultMutationQueries` — 17 query key 统一刷新（详见 `vault-notification` feature）
- `wagmi` — `useConnection()`（dialog 层，**不是** vault-unstake/claim 用的 `useAuthState()`）

---

## 关键设计决策

### 1. 两路代码分支 by token（vault feature 唯一这样做的）

**为什么**：
- sMAG7 提取 = 把 vsMAG7 mint 到 EVM-Funding，链上即时落账
- MAG7 提取 = 必须先 redeem 出 sMAG7，再 unstake 进入 cooldown 等服务端处理

**实现**：mutation 内部 if/else 分支；两条路径**共用同一个 mutation hook**而不是拆两个，因为前面 redeem step 完全相同，分歧仅在最后一步是否做 unstake。

**收益**：UI 层（form / button / progress view）按 token 派生，单一 dialog 服务两个 use case。

### 2. 跨 service 编排 in Container

**为什么**：MAG7 路径需要先调 `vaultWithdrawService` 再调 `vaultUnstakeService`——两个 service 之间需要传递 `redeem.assetsBigInt`（链上事件解析结果），属于业务流程编排，不属于单 service 责任。

**实现**：`useSubmitVaultWithdraw` 的 `mutationFn` 串联两个 service 调用，service 之间无直接依赖。

> 与 vault-unstake 的 smart-transfer（Container 编排 trade.useSubmitTransfer + vault.executeUnstakePermit）模式一致——boundaries 规则禁 service 跨 feature import，跨 service 编排归 Container。

### 3. CALL_FOR_*→WITHDRAW_REDEEM_* / UNSTAKE_* 双重错误码转换

**为什么**：
- `vaultWithdrawService.catch` 转 `CALL_FOR_*` → `WITHDRAW_REDEEM_*`（Step A 失败）
- `vaultUnstakeService.catch`（Step B 失败时）转为 `UNSTAKE_*` 透传上来

`handleWithdrawServiceError` 必须同时 case `WITHDRAW_REDEEM_*` 和 `UNSTAKE_*`，并对 `UNSTAKE_FAILED` 给特定文案"sMAG7 is in your wallet. Retry from Unstake." 引导用户。

### 4. sMAG7 主动弹 toast 是 vault feature 唯一例外

**为什么**：sMAG7 路径无 WS sodex_call_for 推送（只有 unstake/claim/withdraw→MAG7 才走 call_for type=1/2）。链上 redeem receipt 即真完成，必须 mutation 主动弹。

**实现**：`onSuccess` 内 `if (params.token === "sMAG7") notifyVaultWithdrawSuccess(...)`。MAG7 路径不弹（等 WS）。

> 完整时序对照、helper 函数实现、pending toast 关闭机制 → 查 `vault-notification` feature §4.2 (sMAG7) / §4.3 (MAG7) / §5。本地错误（`WITHDRAW_REDEEM_*` / `UNSTAKE_*`）的 toast 文案映射 → 查 §7.3。

### 5. 嵌套 Confirmation Dialog 走 Radix 不走 modalManager

**为什么**：modalManager 的 `openResponsive` 是队列式（一次一个，nest 会阻塞父弹窗）。cooldown 重复 withdraw 二次确认需要真正叠加在父 withdraw 弹窗上，必须独立 Portal + 遮罩。

**实现**：直接渲染 `<Dialog open={showingConfirm} ...>`（来自 `@/shared/components/ui`，本质是 Radix Dialog 封装），独立 Portal 不影响父弹窗状态。

### 6. onSigned 时机推进 phase（第 1 次签完即推进）

**为什么**：UI step 2 "Withdraw from SLP" 对应 outer CallForPermit 签名而非链上等待。第 1 次签名（SLP Permit）完成时，UI 应立即进入 step 2 active 状态，spinner 移到 step 2 上，提示用户"接下来要再次签名"。

**实现**：service 在 `parseSignatureVrs` 后立即触发 `onSigned()`，container 在 `onSigned` 回调内 `setPhase("redeeming")` + `setIsAwaitingWalletSignature(false)`——即使马上要再次签名，UI 状态已切到"链上确认中"。

> 与 claim/unstake `onSigned = 全部签完` 的语义不同——这是 withdraw 唯一的 UX 设计。

### 7. signer 锁 + Privy 邮箱用户兼容（与 claim/unstake 一致）

详见 vault-unstake guide §关键实现 §3 / vault-claim guide §关键实现 §3。

### 8. 不实现 Enable Withdraw 按钮（有意省略）

**注释明示**：`// 老用户 apiKey 失效场景由 dialog 层 "Enable Withdraw"(claim/unstake 同样)按钮承担`。

但当前 dialog 没有这个按钮——这是**已知差异**，需要按 claim/unstake 的 `needsStandaloneEnable` 模式补齐。临时影响：老用户 apiKey 失效时直接点 Withdraw 会触发 `ensureExchangeCapability` 的兜底签名流程，而不是显式独立按钮。

---

## 开发修改指南

### 新增错误码

1. 在 `domain/types.ts` `VaultServiceError` union 追加 `{ kind: "WITHDRAW_NEW_KIND"; ... }`
2. `vaultWithdrawService.catch` 增加分支抛新 kind
3. `handleWithdrawServiceError` 增加 case 映射 toast
4. **同步更新 `isServiceError`** 的 kind 白名单（否则会被当成普通 error 二次 map）
5. 同步 `handleClaimServiceError` / `handleUnstakeServiceError` / `handleDepositServiceError` 的 fallthrough 列表

### 修改 sMAG7 / MAG7 分支条件

只改 `useSubmitVaultWithdraw.ts:109-114` 的 `if (params.token === "sMAG7") return ...`。注意 `params.token` 类型 `WithdrawToken = "MAG7" | "sMAG7"`，扩展时同步 `domain/types.ts` 类型。

### 修改最低 withdraw 金额

链上动态值由 `useVaultMinWithdrawAmountQuery(token)` 读 `callForMinAmounts(BASE_ETH, coinSymbol)`，**不需要前端改**。fallback 默认值在 `domain/constants.ts:57` `WITHDRAW_MIN_AMOUNT="4"`，仅 query 失败时使用。

### 修改 cooldown 二次确认条件

只改 `VaultWithdrawDialog/index.tsx:118-119` 的 `shouldShowCooldownConfirm` 表达式。当前是 `cooldownPendingAmount > 0 || isCooldownActive`。

### 修改进度视图步骤

只改 `VaultWithdrawProgressView.tsx:45-49` 的 `buildSteps(token)` 返回值。`phaseToStep` 同步调整 phase 到 step 索引的映射。

### 修改 toast 文案

- 本地错误（`WITHDRAW_REDEEM_*` / `UNSTAKE_*` 等）：改 `handleWithdrawServiceError`（本 feature 内）
- WS 推送 success / pending / failed：改 `features/trade/containers/useDepositNotice.ts` 的 `notifyVaultWithdrawSuccess` / type=1 pending 文案 / failed 文案 → 这是 `vault-notification` feature 的边界，改前请阅读其 §5（**MAG7 路径与 unstake 共用 helper**）

### 修改两次签名的 onSigned 时机

只改 `vaultWithdrawService.ts:82` 的 `input.onSigned?.()` 位置。注意：移到第 2 次签名后会让 UI step 2 active 延迟，影响用户对"应该再签一次"的感知。

### 修改 Redeem 事件解析

`vaultWithdrawInfra.ts:38` 的 `REDEEM_EVENT_TOPIC` + 251 行的 `data.slice(192, 256)` 切片偏移。事件 layout 变化时同步两处。

---

## 数据更新对接

完成后的数据刷新走 `invalidateVaultMutationQueries`（实现位于 `src/shared/utils/invalidateVaultMutationQueries.ts`，由 `vault-notification` feature 维护，详见该 feature §8 全清单）：

| 时机 | 调用位置 | 策略 | 说明 |
|---|---|---|---|
| mutation onSuccess（receipt confirm） | `useSubmitVaultWithdraw.ts:145-156` | 3 次 setTimeout（3s / 5s / 9s） | 兜底 ValueChain 节点同步延迟 |
| WS sodex_call_for type=1 Success（仅 MAG7） | `useDepositNotice.ts:155` | 单次（推送到达时链上数据已稳定） | 服务端真落账时权威刷 |

双路重叠：React Query 5s staleTime 内对同一 key 的多次 `invalidateQueries` 自动 dedupe。

刷新覆盖 17 个 query key（vault.* / chain.evmBalances / spot.accountState / wagmi readContracts/readContract 前缀）—— 完整清单见 `vault-notification` feature §8.4。

**withdraw 流程对清单中 query key 的具体影响**（按 token 分别看）：

| query key | sMAG7 影响 | MAG7 影响 |
|---|---|---|
| `vault.slpBalance(account)` | 减少（burn SLP） | 减少（burn SLP） |
| `chain.evmBalances(account)` | EVM-Funding **vsMAG7 增加** | （间接）unstake 后 sMAG7 进 cooldown |
| `vault.cooldown(account)` | 不变 | **cooldownPending 增加 + cooldownEndTimestamp 更新** |
| `vault.investInfo(account)` | 持仓视图变化 | 持仓视图变化 |
| `vault.mag7Balance(account)` | sMAG7 增加 | 不变（unstake 把 sMAG7 锁进 cooldown） |
| `[...vault.all(), "activity"]` / `myActivity` | 新增 redeem 记录 | 新增 redeem + unstake 记录 |
| `[...vault.all(), "navCurve"]` / `depositors` | 全局图表/列表 | 同 |
| `["readContracts"]` / `["readContract"]` 前缀 | wagmi 链上 read 缓存 | 同 |

---

## 术语表

| 术语 | 含义 |
|---|---|
| **VaultRedeemWithPermit** | CallForPermit cmdType；外层签名包裹 SLP Permit 的 v/r/s + token/amount/deadline |
| **SLP Permit (EIP-2612)** | SLP token 合约的 ERC20 Permit；授权 CallForPermit 合约动用户的 SLP |
| **sMAG7.SLP** | withdraw 凭证（用户输入的 amount 单位）；链上对应 SLP_TOKEN_ADDRESS（典型 20 位精度） |
| **vsMAG7.ssi** | sMAG7 路径的目标资产；链上 sMAG7 表示，UI 显示 sMAG7.ssi（去 v 前缀） |
| **assetsBigInt** | redeem 事件解析出的 sMAG7 数量（8 位精度）；MAG7 路径用作 unstake 输入 |
| **REDEEM_EVENT_TOPIC** | `0x3f693fff038bb8a046aa76d9516190ac7444f7d69cf952c4cbdc086fdef2d6fc`（合约 keccak hash） |
| **VAULT_REDEEM_PERMIT_KEY** | CallForPermit 合约 nonces(account, key) 的 key=4，VaultRedeemWithPermit 专用 |
| **WithdrawPhase** | `idle / approving / redeeming / unstaking` —— 进度视图 step 派生用 |
| **cooldownEndTimestamp** | 单位秒；UI 用 `dayjs(* 1000)` 转 ms |
| **WITHDRAW_MIN_AMOUNT** | fallback 最低 withdraw 金额 = "4"（动态值由 `useVaultMinWithdrawAmountQuery` 读链上 `callForMinAmounts`） |
| **shouldShowCooldownConfirm** | MAG7 二次确认触发条件：`cooldownPendingAmount > 0 || isCooldownActive` |
| **previewRedeem** | 链上 SLP Vault 合约的 ERC4626 风格预览函数；返回 amount × NAV |
| **onSigned (withdraw 语义)** | 第 1 次签名（SLP Permit）签完触发，**不是**全部签完——UI 用此推进 step |

---

## 更新记录

### 2026-04-30：初始版本

通过 `/k:context-learn` 从代码自动生成 + 人工补充关联引用。覆盖：
- 12 个 withdraw 相关源文件（dialog 5 + container 4 + shared query 7 + service 1 + infra 1 + domain 1）
- 全部错误码（WITHDRAW_APPROVE_FAILED / WITHDRAW_REDEEM_FAILED/_TIMEOUT/_EVENT_MISSING + 透传 UNSTAKE_*/_TIMEOUT + 通用 kind）
- **sMAG7 vs MAG7 完整分支差异表**（mutation 步骤 / 真完成信号 / Toast 来源 / 后续等待 / Phase / 签名次数 / 进度视图 / Warning / ETA / 二次确认）
- 完整流程 ASCII 图（含 Step A + Step B 两路）
- 8 项关键设计决策（两路分支 / 跨 service 编排 / 双重错误码 / sMAG7 主动弹 toast / Confirmation Dialog 走 Radix / onSigned 时机 / signer 锁 / 未实现 Enable Withdraw）
- 两次签名 + onSigned 时机的特殊设计
- token 切换 + 动态 min 查询 + amount reset 设计
- cooldown 二次确认（仅 MAG7）+ 进度视图替换表单 + cooldown banner
- 7 个 share query 数据源对照表
- **关联文档区**指向 `vault-notification` feature 9 个具体章节 + 2 份迁移 spec
