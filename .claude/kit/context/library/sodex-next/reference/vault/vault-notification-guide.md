# Vault Notification & Data Refresh Guide

> **范围**：vault feature 4 个核心操作（deposit / withdraw / unstake / claim）的 toast 提示、WS 推送驱动、统一数据刷新机制。
>
> 本文档归集 6 份 spec（`data-refresh.md` / `deposit-toast.md` / `withdraw-toast.md` / `unstake-toast.md` / `claim-toast.md` / `notification-vault-bug.md`）+ 当前代码实现状态，作为 sodex-next 项目 vault 通知与数据更新的单一事实源。
>
> 与老项目 sodex-web 的对照：老项目用 mobx store + eventBus（`spotOrder.ts` + `useVaultDeposit.ts onSuccess` 同步刷余额）；新项目用 React Query + WS Stream Service + 统一 invalidate helper，数据流解耦。

---

## 1. 业务语义：四种操作的"完成"含义

| 操作 | 持仓变化生效时机 | 服务端是否需异步处理 | 真完成信号 | toast 来源 |
|---|---|---|---|---|
| **deposit** | CallForPermit 上链 → SLP 链上即时增发 | ❌ 不需要 | mutation onSuccess（链上 receipt 确认 = 真完成） | `useSubmitVaultDeposit.onSuccess` 调 `notifyVaultDepositCompleted` |
| **withdraw → sMAG7（vsMAG7）** | 链上 SLP redeem 单步：burn SLP + mint vsMAG7 到 EVM-Funding | ❌ 不需要（链上即时落账，**无 WS 推送**） | mutation onSuccess（receipt = 真完成） | `useSubmitVaultWithdraw.onSuccess` 主动调 `notifyVaultWithdrawSuccess` |
| **withdraw → MAG7** | redeem + unstake；unstake 进 cooldown，待服务端 call_for 处理 | ✅ 需要 | WS `sodex_call_for type=1` Success（真落账） | `useDepositNotice` callFor 分支调 `notifyVaultWithdrawSuccess` |
| **unstake**（独立入口） | CallForPermit 提交 → 进 cooldown → 服务端处理 | ✅ 需要 | 同上 | 同上（共用 helper） |
| **claim**（cooldown 结束后） | CallForPermit 提交 → 资产到 EVM-Funding | ✅ 需要 | WS `sodex_call_for type=2` Success | `useDepositNotice` callFor 分支调 `notifyVaultClaimSuccess` |

**核心区别**：
- `deposit` 链上即时生效，**无 WS 推送**，mutation onSuccess 即真完成
- `withdraw → sMAG7` 链上即时落账，**无 WS 推送**，mutation onSuccess 主动弹 toast（**唯一一个 vault feature 主动起 success toast 的入口**）
- `withdraw → MAG7` / `unstake` / `claim` 必须等 WS `sodex_call_for` 推送才标志真完成

---

## 2. 架构总览

```
                    ┌──────────────────────────────────────┐
                    │  WebSocket: sodex_deposit            │
                    │             sodex_withdraw           │
                    │             sodex_call_for(type=1/2) │
                    └────────────┬─────────────────────────┘
                                 │ ArrayBuffer + magic-byte 自动识别(gzip/zlib/deflate)
                                 ▼
        ┌─────────────────────────────────────────────────────┐
        │ src/shared/infra/ws/depositNoticeWs.ts              │
        │  - DecompressionStream API(无 pako 依赖)             │
        │  - subscribe/unsubscribe singleton                   │
        │  - boundHandler 分发                                 │
        └────────────┬────────────────────────────────────────┘
                     │
                     ▼
        ┌─────────────────────────────────────────────────────┐
        │ src/features/trade/services/                        │
        │   depositNoticeDataService.ts                       │
        │  - subscribeDepositNotice(address) refCount 单例    │
        │  - 解析 record → store.setEvent / setCallForEvent   │
        └────────────┬────────────────────────────────────────┘
                     │
                     ▼
        ┌─────────────────────────────────────────────────────┐
        │ src/features/trade/stores/depositNoticeStore.ts     │
        │  state:                                             │
        │   - lastEvent / lastCallForEvent                    │
        │   - notifiedPendingIds Set / notifiedSuccessIds Set │
        │   - notifiedCallForPendingIds / notifiedCallForSuccessIds │
        └────────────┬────────────────────────────────────────┘
                     │ Zustand selector
                     ▼
        ┌─────────────────────────────────────────────────────┐
        │ src/features/trade/containers/useDepositNotice.ts   │
        │  Container hook(App 顶层挂载,App.tsx:138)            │
        │  ├─ useEffect[lastEvent]      → sodex_deposit toast │
        │  ├─ useEffect[lastCallForEvent] → call_for toast    │
        │  └─ exports: notifyVaultDepositCompleted /          │
        │              notifyVaultWithdrawSuccess /           │
        │              notifyVaultClaimSuccess                │
        └────────────┬────────────────────────────────────────┘
                     │ vault feature import 这 3 个 helper
                     ▼
        ┌─────────────────────────────────────────────────────┐
        │ src/features/vault/containers/useSubmitVault*.ts    │
        │  ├─ deposit.onSuccess  → notifyVaultDepositCompleted │
        │  ├─ withdraw.onSuccess → notifyVaultWithdrawSuccess (sMAG7 only) │
        │  ├─ unstake.onSuccess  → 不弹 toast(等 WS)           │
        │  └─ claim.onSuccess    → 不弹 toast(等 WS)           │
        │  全部:onSuccess 调 invalidateVaultMutationQueries × 3 │
        │       (3s / 5s / 9s 延迟)                            │
        └─────────────────────────────────────────────────────┘
```

---

## 3. WS 客户端实现

### 3.1 单例 WebSocket Client

`src/shared/infra/ws/depositNoticeWs.ts`：
- 独立于交易 WS 的客户端（协议不同：binary ArrayBuffer + deflate，JSON event）
- 单例模式（对齐老项目 `DepositWithdrawWebSocket`）
- 使用原生 `DecompressionStream('deflate')` 替代 pako，**无第三方依赖**

### 3.2 Magic Byte 自动识别压缩格式

服务端推送格式按 magic byte 自动识别（与老项目 `pako.inflate` auto-detect 对齐）：

```ts
// inflateToString(buffer: ArrayBuffer)
//   1f 8b → gzip   (explorer WS 实际格式)
//   78 ?? → zlib   (deflate-with-header)
//   其他   → raw deflate
```

**关键 bug 修复**：bugfix2 阶段发现服务端推送实为 `gzip` 而非 `raw deflate`，老项目 pako 自带 auto-detect 故无感知；新项目最初只解 raw deflate，导致解压报错全部消息丢失。修复后按 magic byte 路由，3 种格式全覆盖。

### 3.3 订阅形式

```ts
// depositNoticeDataService.ts
wsInstance.subscribe(WS_EVENT, `${userAddress}@sodex_deposit`,   boundHandler);
wsInstance.subscribe(WS_EVENT, `${userAddress}@sodex_withdraw`,  boundHandler);
wsInstance.subscribe(WS_EVENT, `${userAddress}@sodex_call_for`,  boundCallForHandler);
```

`listenerKey` = `"SODEX_USER_NOTICE:0xAddr@<event_type>"`，按 dispatchKey 路由到对应 handler。

### 3.4 refCount 单例 + 用户切换处理

`subscribeDepositNotice(address)` 内部：
- `refCount` 防多组件重复订阅
- `subscribedAddress` 记录当前订阅的地址；切换 user 时先 `unsubscribe` 老地址再 `subscribe` 新地址
- 完全在 `useDepositNotice` useEffect 的 cleanup 中触发 unsubscribe

---

## 4. Toast 阶段映射（4 个操作）

### 4.1 Deposit（单信号）

| # | 阶段 / 时机 | toast 类型 | 文案 |
|---|---|---|---|
| 1 | 用户点 Deposit / 钱包签名 / Base chain 各阶段 | — | （仅 dialog panel 步骤） |
| 2 | **WS 推送 `sodex_deposit Depositing`**（桥接到 Sodex Spot） | `notify.loading` (autoClose: false) | `5 MAG7.ssi deposit pending` |
| 3 | WS 推送 `sodex_deposit Reporting` 或中间状态 | — | dedupe 跳过（按 recordId） |
| 4 | **WS 推送 `sodex_deposit Success`**（桥接资金到账） | `closeNotify` + `notify.success` (autoClose: 4s) | `Deposit 5 MAG7.ssi successfully` |
| 5 | Enable Trading（仅新用户）/ Value chain 各阶段 | — | （仅 dialog panel） |
| 6 | **顶层 state machine `completed`**（CallForPermit receipt 确认） | `closeNotify` + `notify.success` (autoClose: 4s) | `Deposited 5 MAG7.ssi into vault` |
| 7 | 任意阶段失败（machine `failed`） | `closeNotify` + `notify.error` | `handleDepositServiceError` 按 error.kind 映射 |
| 8 | 用户主动 close dialog / reset | `closeNotify`（兜底关闭残留 pending） | — |

**关键约束**：第 2 步 pending toast `autoClose: false` 永不自动关，第 4 / 6 步两条 success toast 弹出前会先 `closeNotify()` 主动 dismiss 它。

**文案构造**：
```ts
// pending: useDepositNotice.ts:119
notify.loading(`${amount} ${coin} ${action.toLowerCase()} pending`, { autoClose: false });
// success(WS): useDepositNotice.ts:88
notify.success(`${action} ${amount} ${coin} successfully`);
// vault completion: useDepositNotice.ts:195
notify.success(`Deposited ${amount} ${symbolDisplay} into vault`);
```

其中 `action` 由 type 决定：`sodex_deposit` → `Deposit` / `sodex_withdraw` → `Withdrawal`。

### 4.2 Withdraw → sMAG7（vsMAG7 路径，链上即时落账）

| # | 阶段 / 时机 | toast 类型 | 文案 |
|---|---|---|---|
| 1 | 用户点 Withdraw / 钱包签名 / 链上 redeem | — | （仅 dialog panel） |
| 2 | **mutation onSuccess（receipt confirm）** | `closeNotify` + `notify.success` (autoClose: 4s) | `Withdraw 5.00 sMAG7.ssi successfully.` |
| 3 | mutation onError | `handleWithdrawServiceError` 按 error.kind 映射 | 见 §7 |

**唯一一个由 vault mutation 主动弹 success toast 的路径**：因为 vsMAG7 路径不走 call_for，无 WS 推送。

### 4.3 Withdraw → MAG7 / Unstake（双信号）

| # | 阶段 / 时机 | toast 类型 | 文案 |
|---|---|---|---|
| 1 | 用户点 Withdraw/Unstake / 钱包签名 / 链上 redeem(+ unstake permit) | — | — |
| 2 | mutation onSuccess（receipt） | — | **不弹 toast**（等 WS） |
| 3 | **WS `sodex_call_for type=1 Pending`** | `notify.loading` (autoClose: false) | `Withdrawing in progress...` |
| 4 | WS 中间状态（Settling / Bridging） | — | dedupe 跳过 |
| 5 | **WS `sodex_call_for type=1 Success`** | `closeNotify` + `notify.success` (autoClose: 4s) | `Withdraw 5.04 sMAG7.ssi successfully.` |
| 6 | WS Failed | `closeNotify` + `notify.error` | `Withdraw failed` |
| 7 | mutation onError | `handle*ServiceError` 映射 | 见 §7 |

**注**：unstake 入口的 success 文案使用 "Withdraw"（而非 "Unstake"），因底层走 call_for type=1，服务端 record 的 `inCoinSymbol="sMAG7.ssi"`，操作语义对齐 → 文案与 withdraw MAG7 路径完全共用同一 helper（`notifyVaultWithdrawSuccess`）。

**unstake 特有**：smart-transfer 阶段（Spot → EVM-Funding 补差额）由 `trade.useSubmitTransfer` 自带 toast：`Submitting transfer...` / `Transfer successful`，不在 vault 控制范围。

### 4.4 Claim（双信号，文案不带金额）

| # | 阶段 / 时机 | toast 类型 | 文案 |
|---|---|---|---|
| 1 | 用户点 Claim / 钱包签名 / CallForPermit 链上提交 | — | — |
| 2 | mutation onSuccess（receipt） | — | **不弹 toast**（等 WS） |
| 3 | **WS `sodex_call_for type=2 Pending`** | `notify.loading` (autoClose: false) | `Claiming in progress...` |
| 4 | **WS `sodex_call_for type=2 Success`** | `closeNotify` + `notify.success` (autoClose: 4s) | `Claimed successfully` ⚠️ **不带金额币种** |
| 5 | WS Failed | `closeNotify` + `notify.error` | `Claim failed` |
| 6 | mutation onError | `handleClaimServiceError` 映射 | 见 §7 |

**为什么 claim success 文案不带金额币种**：

WS `sodex_call_for type=2` 推送 record 字段：
```json
{
  "callForType": 2,
  "rawStatus": "Success",
  "inAmount": "0",            // ← claim 输入是 0(cooldown 凭证抵扣,不是流量)
  "inCoinSymbol": "sMAG7.ssi",// ← call_for 输入视角(不是用户领到的币)
  "outCoinSymbol": "MAG7.ssi"
}
```

- 不能用 `inAmount/inCoinSymbol`：会显示 `Claimed 0.00 sMAG7.ssi ...` 误导用户
- 不能用 `outAmount/outCoinSymbol`：record 里没有 outAmount 字段（call_for 设计上 `minOutAmount` 是预期值，真实落账金额服务端不一定回传）
- **最终决策**：对齐老项目 `i18n.t("spot:claimed_successfully")`，固定文案 `Claimed successfully` 不显示金额

**Helper 拆分**（不复用 withdraw）：
```ts
// useDepositNotice.ts
export function notifyVaultWithdrawSuccess(amount, coinSymbol)  // withdraw + unstake 共用
export function notifyVaultClaimSuccess()                       // 无参数 ↑↑↑
```

---

## 5. Notify Helper 函数（trade feature 集中维护）

`src/features/trade/containers/useDepositNotice.ts` 导出 3 个函数，由 vault feature import 调用：

```ts
// 1. Deposit completion(value chain 也完成,顶层 machine completed)
export function notifyVaultDepositCompleted(amount: string, symbolDisplay: string): void {
  closeNotify();
  notify.success(`Deposited ${amount} ${symbolDisplay} into vault`);
}

// 2. Withdraw success(sMAG7 mutation 主动 + WS sodex_call_for type=1 共用)
export function notifyVaultWithdrawSuccess(amount: string, coinSymbol: string): void {
  closeNotify();
  notify.success(`Withdraw ${formatAmount2(amount)} ${coinSymbol} successfully.`);
}

// 3. Claim success(WS sodex_call_for type=2 专用,不带参数)
export function notifyVaultClaimSuccess(): void {
  closeNotify();
  notify.success(`Claimed successfully`);
}

// 内部 helper:ROUND_DOWN 到 2 位小数(decimal.js)
function formatAmount2(raw: string): string {
  if (!raw) return "0.00";
  try {
    return new Decimal(raw).toFixed(2, Decimal.ROUND_DOWN);
  } catch {
    return raw;
  }
}
```

**集中管理理由**：
- vault completion 与 WS 推送的 "Deposit X successfully" 属于**同一信息流的不同阶段**（WS 报 base 桥接成功；completion 报 value chain 落账完成）
- 文案 / dedupe 策略需统一管理，便于未来 i18n 接入
- `formatAmount2` 共用避免 sMAG7 路径与 WS Success 文案小数位不一致

**re-export**：`src/features/trade/index.ts` 暴露这 3 个函数，vault feature 通过 `import { notifyVaultDepositCompleted } from "@/features/trade"` 使用，**禁止深路径 import**。

---

## 6. Pending Toast 关闭机制（autoClose:false 防永挂）

WS pending toast `autoClose: false`，必须由后续事件显式关闭。设计上保证**两条独立路径**都会 dismiss：

### 6.1 Deposit pending 关闭路径

```
WS pending(autoClose:false) → 永挂
   ├─ 路径 A: WS Success 到达
   │     useDepositNotice.success 分支 closeNotify() + notify.success
   └─ 路径 B: vault completion 到达(顶层 machine completed)
         notifyVaultDepositCompleted 内部 closeNotify() + notify.success
```

任一路径先到达就关闭 pending；另一路径之后再 `closeNotify` 也无副作用（关空操作）。

### 6.2 Withdraw / Unstake / Claim pending 关闭路径

```
WS callFor pending(autoClose:false) → 永挂
   ├─ 路径 A: WS Success 到达
   │     useDepositNotice 调对应 helper(内部 closeNotify)
   └─ 路径 B: WS Failed 到达
         closeNotify() + notify.error
```

mutation 主动弹 sMAG7 success toast **不影响** WS pending（sMAG7 路径不产生 WS pending，无冲突）。

### 6.3 Reset / Unmount 兜底

`useSubmitVaultDeposit.reset()` 和组件 unmount cleanup 调 `closeNotify()` 关闭残留 pending（防止 dialog 关闭后 pending toast 残留）。

---

## 7. 错误码体系与 toast 映射

### 7.1 VaultServiceError 全集（`domain/types.ts`）

```ts
type VaultServiceError =
  // 通用
  | { kind: "USER_REJECTED" }
  | { kind: "NETWORK_ERROR";   message: string }
  | { kind: "CHAIN_MISMATCH";  expected: number }
  | { kind: "UNKNOWN";         message: string }

  // call_for 通用错误码(mapInfraError 输出)
  | { kind: "CALL_FOR_FAILED";   txHash?: `0x${string}`; message: string }
  | { kind: "CALL_FOR_TIMEOUT";  txHash?: `0x${string}` }

  // Service 层 catch 内转换得到的业务专有错误码
  | { kind: "CLAIM_FAILED";    txHash?: `0x${string}`; message: string }
  | { kind: "CLAIM_TIMEOUT";   txHash?: `0x${string}` }
  | { kind: "UNSTAKE_FAILED";  txHash?: `0x${string}`; message: string }
  | { kind: "UNSTAKE_TIMEOUT"; txHash?: `0x${string}` }

  // 共享子流程
  | { kind: "TRANSFER_FAILED";          message: string }
  | { kind: "EVM_BALANCE_TIMEOUT";      message: string }
  | { kind: "WITHDRAW_APPROVE_FAILED";  message: string }
  | { kind: "WITHDRAW_REDEEM_FAILED";   txHash?: `0x${string}`; message: string }
  | { kind: "WITHDRAW_REDEEM_TIMEOUT";  txHash?: `0x${string}` }
  | { kind: "WITHDRAW_REDEEM_EVENT_MISSING"; txHash: `0x${string}` }

  // Deposit 子阶段
  | { kind: "DEPOSIT_APPROVE_FAILED";   message: string }
  | { kind: "DEPOSIT_BRIDGE_FAILED";    txHash?: `0x${string}`; message: string }
  | { kind: "DEPOSIT_BRIDGE_TIMEOUT";   txHash?: `0x${string}` }
  | { kind: "DEPOSIT_AMOUNT_ZERO" }
  | { kind: "DEPOSIT_INSUFFICIENT_GAS"; message: string }
  | { kind: "DEPOSIT_PERMIT_FAILED";    message: string }
  | { kind: "DEPOSIT_CONFIRM_FAILED";   txHash?: `0x${string}`; message: string }
  | { kind: "DEPOSIT_CONFIRM_TIMEOUT";  txHash?: `0x${string}` }
  | { kind: "ENABLE_TRADING_TIMEOUT" };
```

### 7.2 错误码转换链

```
infra(viem 抛错) → mapInfraErrorToServiceError
                    输出通用 InfraError-shaped:
                    USER_REJECTED / CALL_FOR_FAILED / CALL_FOR_TIMEOUT /
                    NETWORK_ERROR / CHAIN_MISMATCH / DEPOSIT_*

   → vaultClaimService.catch
        if mapped.kind === "CALL_FOR_FAILED"  → CLAIM_FAILED
        if mapped.kind === "CALL_FOR_TIMEOUT" → CLAIM_TIMEOUT

   → vaultUnstakeService.catch
        if mapped.kind === "CALL_FOR_FAILED"  → UNSTAKE_FAILED
        if mapped.kind === "CALL_FOR_TIMEOUT" → UNSTAKE_TIMEOUT

   → vaultWithdrawService.catch(MAG7 路径)
        if mapped.kind === "CALL_FOR_FAILED"  → WITHDRAW_REDEEM_FAILED 或 UNSTAKE_FAILED
        if mapped.kind === "CALL_FOR_TIMEOUT" → WITHDRAW_REDEEM_TIMEOUT 或 UNSTAKE_TIMEOUT
```

**关键设计原则（bugfix2 阶段修复）**：
- `mapInfraErrorToServiceError` 输出**通用**错误码（infra 不知道业务上下文）
- Service 层在 catch 阶段把通用 kind **转为业务专有 kind**（Service 知道自己是 claim / unstake / withdraw）
- 这避免了 unstake 流程暴露 `CLAIM_TIMEOUT` 这种语义错位的错误码（之前的遗留 bug）
- `handle*ServiceError` 内只需 case 业务专有 kind + 通用 kind，不需要跨业务判断

### 7.3 各业务 handle*ServiceError toast 映射

#### `handleDepositServiceError`（11 种 kind）

| error.kind | toast | 文案 |
|---|---|---|
| `USER_REJECTED` | `notify.error` | `Transaction Canceled` |
| `DEPOSIT_AMOUNT_ZERO` | `notify.error` | `Deposit amount cannot be zero` |
| `DEPOSIT_APPROVE_FAILED` | `notify.error` | `Approve failed: ${message}` |
| `DEPOSIT_BRIDGE_FAILED` | `notify.error` | `Bridge failed: ${message}` |
| `DEPOSIT_BRIDGE_TIMEOUT` | `notify.warning` | `Bridge submitted, waiting for confirmation` |
| `DEPOSIT_INSUFFICIENT_GAS` | `notify.error` | `Insufficient gas: ${message}` |
| `DEPOSIT_PERMIT_FAILED` | `notify.error` | `Permit signing failed: ${message}` |
| `DEPOSIT_CONFIRM_FAILED` | `notify.error` | `Confirm failed: ${message}` |
| `DEPOSIT_CONFIRM_TIMEOUT` | `notify.warning` | `Submission pending on-chain confirmation` |
| `ENABLE_TRADING_TIMEOUT` | `notify.error` | `Enable trading timeout` |
| `TRANSFER_FAILED` | `notify.error` | `Transfer failed: ${message}` |
| `EVM_BALANCE_TIMEOUT` | `notify.warning` | `Balance sync delayed. Please retry in a few seconds.` |
| `NETWORK_ERROR` | `notify.error` | `Network error, please check your connection` |
| `CHAIN_MISMATCH` | `notify.error` | `Wrong network, please switch to chain ${expected}` |
| 兜底（其他 kind） | `notify.error` | `error.message` 或 `Request failed, please try again` |

#### `handleWithdrawServiceError`

| error.kind | toast | 文案 |
|---|---|---|
| `USER_REJECTED` | — | **静默** |
| `WITHDRAW_APPROVE_FAILED` | `notify.error` | `Approve failed: ${message}` |
| `WITHDRAW_REDEEM_FAILED` | `notify.error` | `Withdraw failed: ${message}` |
| `WITHDRAW_REDEEM_TIMEOUT` | `notify.warning` | `Withdraw submitted, waiting for confirmation` |
| `WITHDRAW_REDEEM_EVENT_MISSING` | `notify.warning` | 提示事件解析问题 |
| `UNSTAKE_FAILED` | `notify.error` | `Unstake failed: ${message}` |
| `UNSTAKE_TIMEOUT` | `notify.warning` | `Unstake submitted, waiting for confirmation` |
| `NETWORK_ERROR` / `CHAIN_MISMATCH` | 同上 | 同上 |

#### `handleUnstakeServiceError`

| error.kind | toast | 文案 |
|---|---|---|
| `USER_REJECTED` | — | **静默** |
| `TRANSFER_FAILED` | `notify.error` | `Transfer to Funding failed: ${message}` 或 `Transfer to Funding failed` |
| `EVM_BALANCE_TIMEOUT` | `notify.warning` | `Pre-transfer submitted. Balance did not sync in time, please retry in a few seconds.` |
| `UNSTAKE_FAILED` | `notify.error` | `Unstake failed: ${message}` 或 `Unstake failed` |
| `UNSTAKE_TIMEOUT` | `notify.warning` | `Unstake submitted, waiting for on-chain confirmation. Check Activity tab later.` |
| `NETWORK_ERROR` / `CHAIN_MISMATCH` | 同上 | 同上 |

#### `handleClaimServiceError`

| error.kind | toast | 文案 |
|---|---|---|
| `USER_REJECTED` | — | **静默** |
| `CLAIM_FAILED` | `notify.error` | `Claim failed: ${message}` 或 `Claim failed, please try again` |
| `CLAIM_TIMEOUT` | `notify.warning` | `Claim submitted, waiting for on-chain confirmation. Check Activity tab later.` |
| `NETWORK_ERROR` / `CHAIN_MISMATCH` | 同上 | 同上 |

**与老项目对比**：老项目 mutation 失败统一 `notify.error("claim_failed")` 无 errorKind 细分；新项目按 errorKind 提供更精确的反馈（USER_REJECTED 静默 / TIMEOUT 用 warning 而非 error）。

---

## 8. 数据刷新：`invalidateVaultMutationQueries`

### 8.1 单一入口

`src/shared/utils/invalidateVaultMutationQueries.ts`：

```ts
export function invalidateVaultMutationQueries(
  queryClient: QueryClient,
  address: Address | undefined,
): void {
  if (!address) return;
  // 17 个 vault.* / chain.* / spot.* / wagmi 缓存 key 失效
  // 详见 §8.4 全清单
}
```

### 8.2 调用点（5 处）

| 调用点 | 时机 | 策略 |
|---|---|---|
| `useSubmitVaultDeposit.onSuccess` | mutation onSuccess | **3 次延迟 invalidate**（3s / 5s / 9s） |
| `useSubmitVaultWithdraw.onSuccess` | 同上 | 同上（兜底链上节点同步） |
| `useSubmitVaultUnstake.onSuccess` | 同上 | 同上 |
| `useSubmitVaultClaim.onSuccess` | 同上 | 同上 |
| `useDepositNotice` 收到 WS `sodex_call_for` Success | 服务端真落账 | **单次 invalidate**（推送到达时链上数据已稳定） |

### 8.3 为什么要 3 次延迟（3s / 5s / 9s）

mutation `onSuccess` 触发时链上 receipt 虽已 confirm，但：
- ValueChain RPC 节点可能未把最新区块 propagate 完毕
- 立即 invalidate → refetch 调 `readContract` 可能拿到 RPC 节点的旧 storage

**3/5/9 三档理由**：
- **3s**：覆盖 ValueChain 节点常见同步延迟（实测大部分情况下足够）
- **5s**：超过 RQ staleTime（默认 5s），即便 3s 那次 dedupe 命中也保证再 fetch 一次
- **9s**：链上节点几乎一定同步完成，最终保险

React Query 5 秒 staleTime 内对同一 query key 的多次 `invalidateQueries` 自动 dedupe，**不会重复 fetch**——3 次调用最多触发 2 次实际网络请求。

### 8.4 17 个 query key 详细说明

| 类别 | query key | UI 影响 | 刷新原因 |
|---|---|---|---|
| 用户级 | `vault.mag7Balance(addr)` | vault 页 MAG7 / sMAG7 余额 | deposit/withdraw 持仓变化 |
| 用户级 | `vault.investInfo(addr)` | MyPositionTab 个人投资信息 | 持仓 + ROI 变化 |
| 用户级 | `vault.cooldown(addr)` | unstake cooldown 状态 | unstake/claim 变化 |
| 用户级 | `vault.slpBalance(addr)` | SLP 持仓数量 | deposit/withdraw 增减 |
| 用户级 | `vault.hasMyActivity(addr)` | 是否显示 "My Activity" tab | 任意操作产生活动 |
| 用户级 | `chain.evmBalances(addr)` | EVM-Funding 余额（vault Mag7 balance 来源） | claim 资产到账 / withdraw 余额变化 |
| 用户级 | `spot.accountState(addr)` | Spot 余额（兜底，主靠 WS accountUpdate） | 任意涉及 Spot 余额的操作 |
| 用户级 | `[vault, "roi", "user", addr]` | All-time ROI（MyPositionTab） | 任意操作影响个人 ROI |
| 用户级 | `[vault, "chartData", addr]` | 个人 chart（前缀，所有 timeRange） | 任意操作 |
| 列表 | `[vault, "activity"]` (前缀) | ActivityTab 全部活动 | 任意操作产生活动记录 |
| 列表 | `[vault, "myActivity"]` (前缀) | ActivityTab 我的活动 | 同上 |
| 全局 | `[vault, "investInfo", "global"]` | OverviewTab 全局 TVL | 任意操作改变 vault TVL |
| 全局 | `[vault, "roi", "global"]` | OverviewTab 全局 ROI | TVL 变化连带 |
| 全局 | `[vault, "nav", "global"]` | OverviewTab 全局 NAV | 任意持仓变化 |
| 全局 | `[vault, "navCurve"]` (前缀) | ChartPanel NAV 曲线 | 同上 |
| 全局 | `[vault, "depositors"]` (前缀) | DepositorsTab 全局 depositors 列表 | deposit/withdraw 影响列表成员 |
| **wagmi** | `["readContracts"]` (前缀) | **Base 链 ERC20 余额**（`useReadContracts`） | deposit/withdraw 改变 Base 链 MAG7/sMAG7 |
| **wagmi** | `["readContract"]` (前缀) | 其他 wagmi `useReadContract` 调用 | 同上 |

> **关键修复点**：`["readContracts"]` / `["readContract"]` 前缀失效是 spec 之后的代码新增，解决 `useVaultMag7Balance` 用 wagmi `useReadContracts` 读 Base 链 ERC20 余额时缓存不会自动失效的问题。前缀刷会连带其他 useReadContract 被 refetch，均为只读 RPC 调用，无副作用。

### 8.5 双路重叠的 dedupe 保证

`useSubmitVaultWithdraw` / `Unstake` / `Claim` 的 mutation `onSuccess` 与 `useDepositNotice` 的 WS Success 推送会先后调用同一个 helper：
- React Query 5 秒 staleTime 内对同一 query key 的多次 `invalidateQueries` 自动 dedupe
- **不会触发重复 fetch**

**deposit 不存在双路问题**：deposit 没有对应 vault 业务的 WS 推送（`sodex_deposit` 推送是 base→Spot 的事件，与 vault 持仓无关）。

### 8.6 WS 推送驱动的端到端链路（以 withdraw MAG7 为例）

```
[1] 服务端 → WebSocket → 浏览器
    推送 { event:"SODEX_USER_NOTICE", type:"sodex_call_for",
           data:{ addr: record(callForType=1, executeStatus="Success") } }

[2] depositNoticeWs.handleMessage 接收 ArrayBuffer
    ├─ inflateToString 按 magic byte(1f8b → gzip)解压
    └─ JSON.parse 得到消息对象

[3] dispatchMessage 按 listenerKey 分发
    listenerKey = "SODEX_USER_NOTICE:0xAddr@sodex_call_for"
    → 调 boundCallForHandler

[4] handleCallForNotice 解析 record → 写 Zustand store
    useDepositNoticeStore.getState().setCallForEvent(event)

[5] 在 App 顶层挂载的 useDepositNotice() hook 通过 selector 订阅
    const lastCallForEvent = useDepositNoticeStore(s => s.lastCallForEvent)
    store 字段变化 → hook re-render → useEffect[lastCallForEvent] 触发

[6] useEffect 检测 rawStatus === "Success" + dedupe 通过
    → notifyVaultWithdrawSuccess(inAmount, inCoinSymbol)
        - closeNotify()(关 pending)
        - notify.success("Withdraw 5.04 sMAG7.ssi successfully.")
    → invalidateVaultMutationQueries(queryClient, address)

[7] React Query 把 17 个 vault.* / chain.evmBalances / spot.accountState
    + wagmi ["readContracts"]/["readContract"] 等 query 标记为 stale

[8] 当前页面正在用 useQuery 订阅这些 key 的组件自动重新 fetch
    useVaultStatsQuery / useSlpBalanceQuery / useVaultMag7Balance /
    useVaultInvestInfoQuery / useVaultMyActivityQuery / ...

[9] 新数据回来后 React 组件 re-render → UI 显示最新余额 / SLP / ROI / Activity
```

**核心机制**：组件订阅 query key，invalidate 触发 refetch，**完全靠 query key 解耦**——组件不需感知"WS 推了什么"，无中介事件。

---

## 9. Dedupe 机制（depositNoticeStore）

`depositNoticeStore` 维护 4 个 Set 用于 toast 去重：

| Set 名 | 用途 | 加入时机 |
|---|---|---|
| `notifiedPendingIds` | sodex_deposit/withdraw pending 已弹标记 | `notify.loading` 后 |
| `notifiedSuccessIds` | sodex_deposit/withdraw success 已弹标记 | `notify.success` 后 |
| `notifiedCallForPendingIds` | sodex_call_for pending 已弹标记 | 同上 |
| `notifiedCallForSuccessIds` | sodex_call_for success/failed 已弹标记 | success / failed 任一后 |

**recordId 计算规则**：
- `sodex_deposit` / `sodex_withdraw`：`record.txHash || ${addr}-${stmp}-${amount}-${token}` fallback
- `sodex_call_for`：`callForId || ${addr}-${stmp}-${callForType}` fallback

**孤弹防护**：
- 必须先 `markPendingNotified` 才会弹 success（防止 base 链跳过去直接收到 Success 的孤弹场景）
- WS sodex_deposit Success 分支额外条件：`store.hasPendingNotified(recordId) && !store.hasSuccessNotified(recordId)`
- 但 `auth.exchangeAccountId` 的 invalidate 不依赖 dedupe（晚开页面只收到 Success 推送、错过 pending 的场景下也得触发首次 deposit 完成 → 链上创建 accountId 的检测）

**服务端重复推送**：单次 unstake/claim 完成后服务端可能推 4+ 次 Success（已通过 dedupe 防重复弹）。

---

## 10. 设计原则总结

### 10.1 Toast 责任分层

```
features/trade/useDepositNotice                    features/vault/containers
─────────────────────────────────────              ──────────────────────────
WS sodex_deposit Pending → loading                 useSubmitVaultDeposit
WS sodex_deposit Success → success                  └─ onSuccess → notifyVaultDepositCompleted
                                                       (顶层 machine completed)
WS sodex_call_for Pending → loading                useSubmitVaultWithdraw
WS sodex_call_for Success → notifyVault*Success     ├─ onSuccess(sMAG7): notifyVaultWithdrawSuccess
WS sodex_call_for Failed  → notify.error            └─ onSuccess(MAG7) : 不弹(等 WS)
                                                   useSubmitVaultUnstake/Claim
EXPORTS (vault feature 调):                          └─ onSuccess: 不弹(等 WS)
  notifyVaultDepositCompleted                      所有: onError → handle*ServiceError
  notifyVaultWithdrawSuccess
  notifyVaultClaimSuccess
```

**核心原则**：
1. **vault feature 不主动起 success toast**（除 sMAG7 例外）：避免与 WS 推送的 toast 文案重复 / 时序竞争
2. **vault feature 主动起本地错误 toast**：用户取消、smart-transfer 失败、链上 revert 等本地错误通过 mutation onError 路径
3. **WS 推送负责"流程完成"反馈**：pending → success / failed
4. **所有 vault toast 文案集中在 `useDepositNotice.ts`**：统一管理便于 i18n / 文案微调

### 10.2 Toast 流程与数据刷新流程完全独立

- toast 弹完后台数据继续刷
- React Query 5s 内自动 dedupe，无重复 fetch
- 双路（mutation + WS）调同一 helper 不会有性能问题

### 10.3 文案与格式化复用

`formatAmount2` ROUND_DOWN 到 2 位（decimal.js）：
- sMAG7 mutation 主动 success 共用
- WS sodex_call_for type=1 Success 共用

**单位统一**：金额输入是已 `formatUnits` 之后的字符串（如 `"5.123456789"`），输出 `"5.12"`。

### 10.4 与老项目（sodex-web）的关键差异

| 维度 | 老项目 | 新项目 |
|---|---|---|
| 通知文件 | `models/spotOrder.ts`（mobx store） | `containers/useDepositNotice.ts`（React hook + Zustand store） |
| 余额刷新 | `chainAsset.getBalances(true)` + `vault.updateMag7RelatedBalance()` + `eventBus.emit(VAULT_DEPOSIT_SUCCESS)` 等命令式调用 | `invalidateVaultMutationQueries` 单一 helper + React Query 自动 refetch |
| WS 解压 | pako auto-detect | `DecompressionStream` magic-byte 路由（gzip/zlib/raw deflate） |
| 错误处理 | `notify.error("claim_failed")` 统一文案 | `handle*ServiceError` 按 errorKind 细分（USER_REJECTED 静默 / TIMEOUT warning / FAILED error） |
| Toast 来源 | mutation 内部 + eventBus 多处分散 | trade feature 集中维护 helper，vault feature import 调用 |

---

## 11. 涉及文件清单

### 11.1 trade feature（WS + helper）

| 文件 | 作用 |
|---|---|
| `src/shared/infra/ws/depositNoticeWs.ts` | WS 客户端单例 + magic-byte gzip/zlib/deflate 解压 |
| `src/features/trade/services/depositNoticeDataService.ts` | Stream Service：订阅 sodex_deposit / sodex_withdraw / sodex_call_for；refCount + 切 user 切订阅 |
| `src/features/trade/stores/depositNoticeStore.ts` | Zustand store：lastEvent / lastCallForEvent + 4 个 dedupe Set |
| `src/features/trade/containers/useDepositNotice.ts` | Container hook（App.tsx:138 顶层挂载）+ 3 个导出 helper（`notifyVaultDepositCompleted` / `notifyVaultWithdrawSuccess` / `notifyVaultClaimSuccess`）+ 内部 `formatAmount2` |
| `src/features/trade/index.ts` | re-export 3 个 helper |

### 11.2 vault feature（mutation hooks + 错误处理）

| 文件 | 作用 |
|---|---|
| `src/features/vault/containers/useSubmitVaultDeposit.ts` | onSuccess: 调 `notifyVaultDepositCompleted` + 3 次延迟 invalidate；onError: `handleDepositServiceError`；reset/unmount: `closeNotify` 兜底 |
| `src/features/vault/containers/useSubmitVaultWithdraw.ts` | onSuccess(sMAG7): 主动调 `notifyVaultWithdrawSuccess`；onSuccess(MAG7): 不弹；onError: `handleWithdrawServiceError`；3 次延迟 invalidate |
| `src/features/vault/containers/useSubmitVaultUnstake.ts` | onSuccess: 不弹（等 WS）；onError: `handleUnstakeServiceError`；3 次延迟 invalidate |
| `src/features/vault/containers/useSubmitVaultClaim.ts` | onSuccess: 不弹（等 WS）；onError: `handleClaimServiceError`；3 次延迟 invalidate |
| `src/features/vault/containers/handleDepositServiceError.ts` | error.kind → notify.error/warning 文案映射（含 13 case） |
| `src/features/vault/containers/handleWithdrawServiceError.ts` | 同上（含 WITHDRAW_REDEEM_* / UNSTAKE_* / CHAIN_MISMATCH 等） |
| `src/features/vault/containers/handleUnstakeServiceError.ts` | 同上（含 TRANSFER_FAILED / EVM_BALANCE_TIMEOUT / UNSTAKE_*） |
| `src/features/vault/containers/handleClaimServiceError.ts` | 同上（含 CLAIM_FAILED / CLAIM_TIMEOUT） |
| `src/features/vault/services/vaultClaimService.ts` | catch 内 CALL_FOR_* → CLAIM_* 转换 |
| `src/features/vault/services/vaultUnstakeService.ts` | catch 内 CALL_FOR_* → UNSTAKE_* 转换 |
| `src/features/vault/services/vaultWithdrawService.ts` | catch 内 CALL_FOR_* → WITHDRAW_REDEEM_* / UNSTAKE_* 转换（MAG7 路径） |
| `src/features/vault/services/mapInfraError.ts` | InfraError → 通用 ServiceError（CALL_FOR_* / NETWORK_ERROR / CHAIN_MISMATCH / DEPOSIT_*） |
| `src/features/vault/domain/types.ts` | VaultServiceError discriminated union 定义 |

### 11.3 shared 层（统一刷新 helper）

| 文件 | 作用 |
|---|---|
| `src/shared/utils/invalidateVaultMutationQueries.ts` | 17 个 query key 统一失效函数（5 处调用） |
| `src/shared/queryKeys/index.ts` | queryKey factory（vault.* / chain.evmBalances / spot.accountState） |
| `src/shared/infra/notify/index.ts` | `notify.loading/success/error/warning` + `closeNotify` |

### 11.4 App 顶层挂载

| 文件 | 作用 |
|---|---|
| `src/App.tsx:138` | `useDepositNotice()` 全局挂载（每 app 实例一次） |

---

## 12. 不在统一 helper 范围内的数据源

| 数据 | 刷新机制 | 备注 |
|---|---|---|
| Spot 账户细粒度余额 | WS `accountUpdate` 推送 | helper 内 `spot.accountState` 是 REST 兜底 |
| Perps 账户余额 | WS 推送 | vault 操作不改变 perps 余额 |
| 钱包链上 ETH gas 余额 | wagmi `useBalance` | 与 vault helper 无关 |

---

## 13. 已知缺失（按需另做）

1. **i18n 多语言文案**：当前所有 toast 文案为英文硬编码（cross-cutting future task）
2. **WS toast 的 `actionText: "View"`**：跳转充值历史 / vault activity tab
3. **MAG7 / sMAG7 deposit 成功后弹 vault 引导弹窗**（页面不在 vault 时）
4. **跨业务事件总线**：`STAKE_SUCCESS` / `WITHDRAW_PENDING_NOTIFIED` / `VAULT_CALL_FOR_SUCCESS` / `DEPOSIT_WITHDRAW_EXCEPTION`
5. **细粒度错误文案**：按 failCode / failReason 映射（替代当前的 `${message}` 透传）
6. **claim 后端推送的 outAmount 字段**：若服务端补充该字段，可改为 `Claimed X.XX MAG7.ssi successfully.` 文案（暂不做）
7. **服务端重复推送优化**：单次 unstake/claim 完成后服务端推 4+ 次 Success（已通过 dedupe 防重复弹，但服务端行为可优化）
8. **连续相同 toast id 时序冲突**：sonner 在极短时间内连续相同 id 弹两次会有时序问题（设计层面，需专门处理）

---

## 14. 验证手册

测试 vault 完整通知 + 数据刷新链路：

| 操作 | 预期 toast | 预期数据更新 |
|---|---|---|
| Base 链 deposit MAG7 | ① WS pending `5 MAG7.ssi deposit pending` ② WS success `Deposit 5 MAG7.ssi successfully` ③ vault completion `Deposited 5 MAG7.ssi into vault` | vault Mag7/sMag7 余额 / SLP / investInfo / chart / activity / 全局 TVL/ROI/NAV / Base 链 ERC20 余额 |
| Value 链 deposit MAG7 | ② / ③（无 base WS pending） | 同上 |
| Withdraw → sMAG7 | mutation 主动 `Withdraw 5.00 sMAG7.ssi successfully.` | 同上 + cooldown 不变 |
| Withdraw → MAG7 | ① WS pending `Withdrawing in progress...` ② WS success `Withdraw X.XX sMAG7.ssi successfully.` | 同上 + cooldown 增加 |
| Unstake | 同 withdraw MAG7 | 同上 |
| Claim | ① WS pending `Claiming in progress...` ② WS success `Claimed successfully` | 同上 + cooldown 减少 + EVM-Funding MAG7 增加 |
| 用户拒签 | 静默（不弹 toast） | 无变化 |
| 链上 revert | `${OP} failed: ${message}` error toast | 无变化 |
| 链上 receipt 超时 | `${OP} submitted, waiting for confirmation` warning toast | 无变化（服务端可能后续推 WS Success） |
| 网络错误 | `Network error, please check your connection` | 无变化 |
| 链不匹配 | `Wrong network, please switch to chain ${expected}` | 无变化 |
