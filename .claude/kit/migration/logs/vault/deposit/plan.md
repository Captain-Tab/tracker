# Migration Plan: vault-deposit

> Spec: `.claude/kit/migration/logs/vault/deposit/migration-spec.md`
> 目标架构: sodex-next 5 层 / **方案 F Workflow Hook Pattern**
> 生成: 2026-04-23 by `/k:migration plan vault-deposit` [Opus 核验]

---

## 架构核验(方案 F 硬约束)

- [x] **不建 `services/vaultDepositService.ts`**:vault-deposit 的 workflow 绑定 React 生命周期(StrictMode 防抖、unmount 检测、进度推送),Service 只会产出"executor 分发器空壳"。编排归 Container。
- [x] reducer 纯函数(3 个),无 react / store 依赖 → `domain/depositStateMachine.ts`
- [x] infra 原子 async(10 个),无 toast / notify / store → `infra/chain/vaultDepositInfra.ts`
- [x] Container 分两层:`useVaultDepositMachine`(workflow driver) + `useSubmitVaultDeposit`(外层编排) → `containers/deposit/` + `containers/`
- [x] typed-data builder 纯函数 → `domain/depositPermit.ts`
- [x] notify/invalidate/enable_trading/smart-transfer **只在 Container 外层**

---

## 前置匹配

### Pitfall gates(sodex-next)

| id | 命中? | 影响 |
|---|---|---|
| `vault-decimal-constants-semantics` | ✅ | Max 按钮用 `VAULT_DEFAULT_DECIMAL=4`;`BaseAccountInput` / `AccountSelector` 核对 |
| `slp-decimals-dynamic` | ❌ 不触发 | deposit 不涉及 SLP 合约读写 |
| `theme-stroke-fill-via-cssvar` | ⚠ 低 | `#FF7637`(spinner) / `#F1C21B`(warning) 暂走 bracket 类 + 中文注释 |

### Records(kit 级)

| id | 避坑动作 |
|---|---|
| `chain-call:callForPermit-cmdType-to-address-mapping` | deposit cmdType = `VaultDepositWithPermit2`,`to = VAULT_CALLER_ADDRESS`(domain/depositPermit 硬约束) |
| `chain-call:token-decimals-dynamic-read` | Base 链 `erc20Decimals(coinAddr)` 动态读;Value 链 `MAG7_DECIMALS=8` 业务语义常量 |
| `structure:service-cross-feature-orchestration-via-container` | smart-transfer + enable_trading + permit 全在 Container 编排 |
| `structure:service-needs-domain-not-container-logic` | reducer + typed-data builder 归 domain;UI 派生在 containers/depositFlowLogic |
| `structure:infra-cannot-import-domain` | infra 不 import domain,decimals 参数传入,错误 throw `InfraError` |
| `structure:feature-vs-shared-const` | `MAG7_DECIMALS` / `VAULT_CALL_FOR_PERMIT_ADDRESS` 进 `features/vault/domain/constants.ts` |
| `ui-progress:step-to-event-mapping` | 逐 step 标覆盖事件,见 §Step-Event 映射 |
| `ui-progress:modalManager-queue-not-stack` | interruptionModal 降级 toast(defer);PrivyCheckModal skip |

### Reusable 复用清单

| 已有资产 | 来源 | 用途 |
|---|---|---|
| `getClaimNonce(account)` | vaultClaimInfra.ts | permit nonce 链上读 |
| `signCallForPermit(typedData)` | vaultClaimInfra.ts | CallForPermit EIP-712 签名 |
| `waitForClaimReceipt(txHash)` | vaultClaimInfra.ts | tx 3 confirmations |
| `postCallForPermit(request)` | vaultApi.ts | HTTP 提交 permit |
| `mapInfraErrorToServiceError` | services/mapInfraError.ts | 错误映射(如 claim/unstake 已建的 kind 不够,扩展) |
| `useVaultMag7Balance` | containers/shared | Value chain 余额 |
| `trade.useSubmitTransfer` | features/trade | smart-transfer Spot→Funding |
| `trade.useEvmBalancesQuery` | features/trade | EVM 余额细粒度判定 |
| `isUserRejectedError` | ⚠ 若前序模块已建则复用,否则本模块在 `domain/` 新增,Phase 6 升 shared |

### 依赖检查

| 库 | 存在? | 用途 |
|---|---|---|
| wagmi / viem | ✅ | 链上读写 |
| wagmi/actions | ✅ | 非 hook 版本,infra 层用 |
| decimal.js | ✅ | 精度计算 |
| sonner | ✅ | notify |
| dayjs | ✅ | time format |

无新增依赖。

### ⚠️ 未解决风险(execute 必核)

1. **trade/login 的 enable_trading 签名 hook 是否已暴露?**
   - 老项目:`LoginContext.signMessage` / `LoginContext.signMessageMobile`
   - 新项目:execute Step 7 之前 `grep -rn "signMessage\|useEnableTrading\|useSignMessage" src/features/trade src/features/login 2>/dev/null`
   - 若未暴露:先补 trade/login 侧暴露,或本模块用降级方案(直接用 wagmi actions signMessage,但不建议 — 脱离 login feature 单一 source)

2. **AccountSelector 逻辑:Value chain Spot 账户在新用户态 disabled**(老项目 `selectedAccount` 行为)
   - Form hook 里实现 `disabledOptions` 派生

3. **`useTokenConfig` / `useFundingToken` 在新项目的对应** hook 名?
   - execute 前 `grep -rn "useAllCoinsQuery\|useCoinConfigQuery\|useTokenConfig" src/features` 定位

---

## 步骤拆分(分层 + 依赖倒序)

### Step 0: 类型 & 常量 + typed-data builder

文件:
- `features/vault/domain/constants.ts`(扩展)
  - `+ VAULT_CALL_FOR_PERMIT_ADDRESS` (若 claim/unstake 已建则复用)
  - `+ VAULT_CALLER_ADDRESS`(复用)
  - `+ VMAG7_TOKEN_ADDRESS` / `VSMAG7_TOKEN_ADDRESS`(复用)
  - `+ MAG7_DECIMALS = 8`
  - `+ SOSO_DEPOSIT_CONTRACT_ADDRESS` (业务语义,不入 shared)
  - `+ BASE_CHAIN_IDENTIFIER = 'BASE_ETH'`
  - `+ DEPOSIT_SETTLE_MAX_ATTEMPTS = 15`
  - `+ DEPOSIT_SETTLE_POLL_INTERVAL_MS = 5000`
  - `+ DEPOSIT_APPROVE_DEADLINE_SEC = 1800` (30 min)
  - `+ DEPOSIT_ENABLE_TRADING_RETRY_INTERVAL_MS = 1000`
  - `+ DEPOSIT_ENABLE_TRADING_MAX_ATTEMPTS = 15`

- `features/vault/domain/types.ts`(扩展)
  - `+ DepositInput = { chain: 'BASE_ETH'|'VALUE_CHAIN'; token: { symbol; isStake: boolean; baseAddr?; decimals }; from: 'SPOT'|'EVM_FUNDING'; amount: string; account: Address }`
  - `+ DepositResult = { success: boolean; txHash?: string }`
  - `+ DepositServiceError` kind 扩展(8 新 kind,对齐 spec §错误处理)

- `features/vault/domain/depositStateMachine.ts`(新建,纯函数,3 reducer)
  - `TopState` / `TopAction` / `TopConfig = { needsBaseChain; isNewUser }`,`topReducer`
  - `BaseChainState` / `BaseChainAction` / `baseChainReducer`
  - `ValueChainState` / `ValueChainAction` / `ValueChainConfig = { needsTransfer; needsStake }`,`valueChainReducer`
  - RETRY 分支按 interaction-spec §2 精确实现
  - `isUserRejectedError(err: unknown): boolean` (纯函数,导出)

- `features/vault/domain/depositPermit.ts`(新建,typed-data builder)
  - `buildDepositErc2612PermitTypedData({ tokenAddress, owner, spender, amount, nonce, deadline, chainId })`
  - `buildDepositCallForPermitTypedData({ erc2612Signature, tokenAddress, amount, deadline, to, nonce, chainId, verifyingContract })` (嵌套 VaultDepositWithPermit2)
  - `buildDepositCallForPermitRequest({ cmd, to, nonce, deadline, signature })`
  - 硬约束:`to = VAULT_CALLER_ADDRESS`;cmdType = `VaultDepositWithPermit2`

**产出基线**:types 齐,下面 Step 1-9 都按此 import。

### Step 1: Infra(10 个原子 async)

文件:`features/vault/infra/chain/vaultDepositInfra.ts`(新建)

```ts
// Base 链
export async function checkErc20Allowance(params: { owner: Address; coinAddr: Address; bridgeAddr: Address; amountRaw: bigint; chainId: number }): Promise<{ allowance: bigint; needsApprove: boolean }>;
export async function approveErc20(params: { coinAddr: Address; bridgeAddr: Address; amountRaw: bigint; chainId: number }): Promise<{ txHash: Hash }>;
export async function waitBaseReceipt(params: { txHash: Hash; chainId: number; confirmations?: number }): Promise<void>;
export async function bridgeToValueChain(params: { bridgeAddr: Address; coinSymbol: string; receiver: Address; amountRaw: bigint; toClob: boolean; chainId: number }): Promise<{ txHash: Hash }>;
export async function pollBridgeSettle(params: { bridgeTxHash: Hash; maxAttempts?: number; pollIntervalMs?: number }): Promise<{ confirmed: boolean }>;

// Value 链 Transfer
export async function signTransferAsset(params: { fromAccountId: number; toAccountId: number; coinId: number; amount: string; owner: Address }): Promise<{ signature: string; nonce: number }>;
export async function postTransferAsset(params: { serializableParams: TransferAssetParams; signature: string; nonce: number }): Promise<unknown>;

// Value 链 Permit(基于 claim/unstake 已有的 signCallForPermit 扩展)
export async function permitApproveSign(params: { tokenAddress: Address; owner: Address; spender: Address; amountRaw: bigint; chainId: number }): Promise<{ signature: { v: number; r: Hex; s: Hex }; deadline: number }>;
export async function buildAndSignConfirmPermit(params: { tokenAddress: Address; amountRaw: bigint; deadline: number; erc2612Sig: { v; r; s }; nonce: bigint; to: Address; chainId: number; verifyingContract: Address }): Promise<ConfirmPermitPayload>;
export async function postConfirmPermit(payload: ConfirmPermitPayload): Promise<{ txHash: Hash }>;
```

**硬约束**:
- 不 import domain(用 `InfraError` 本地错误)
- `ERC20_DECIMALS_DEFAULT = 8` 参数化传入,不硬写在 infra
- 所有外抛错误走 `InfraError` 或 wagmi 原生;Container 再转 `DepositServiceError`
- `postConfirmPermit` 内部直接调已有 `postCallForPermit(vaultApi.ts)`,不重复 HTTP 客户端

### Step 2: handleDepositServiceError(错误映射)

文件:`features/vault/containers/handleDepositServiceError.ts`

- 输入:`unknown`(原始错误 / InfraError / 已是 DepositServiceError)
- 输出:`void`(side-effect: notify + i18n)
- 返回 kind 给 Container 决定 UI(Try Again 等)

参考 `handleClaimServiceError` / `handleUnstakeServiceError` 的 switch 结构。

### Step 3: depositFlowLogic(纯派生)

文件:`features/vault/containers/depositFlowLogic.ts`

函数清单(纯函数,不 `import react`):

```ts
// 根据 top state + config 推 Button 态
export function deriveButtonState(form, balance, top): PreTradeButtonState;
// 根据 chain + token 推 needsTransfer/needsStake
export function decideValueChainConfig(chain, token, from): { needsTransfer: boolean; needsStake: boolean };
// 从 3 层 state 构建 TradingPanelSlot[]
export function buildStepList(top, base, value, config): StepViewModel[];
// step 状态映射(processing/completed/pending)
export function mapStepStatus(stepName, state, config): 'pending'|'processing'|'completed'|'failed';
// 余额校验(min, max, 超精度)
export function validateDepositAmount(amount, balance, min, decimals): { ok: boolean; errorKey?: string };
// Build infra 调用参数(bridgeCoinSymbol/permitToken 等)
export function buildDepositCallParams(input: DepositInput): { baseChainCall; valueChainCall } | null;
```

### Step 4: useVaultDepositForm(表单)

文件:`features/vault/containers/useVaultDepositForm.ts`

- react-hook-form + zod(复用 withdraw 的 schema 模式)
- fields: `selectedChain` / `token` / `from` / `amount`
- 余额:复用 `useVaultMag7Balance` + Base chain `useBalance` from wagmi(若跨 feature 也有 Base 余额 hook 则复用)
- auto-fill 守卫:`tradingStatus !== 'idle' → return`(history 20260306)
- Max 按钮:用 `VAULT_DEFAULT_DECIMAL=4` 格式化
- `disabledOptions`:新用户 Value Chain Spot 不可选(老项目 AccountSelector 行为)

### Step 5: useVaultDepositMachine(workflow driver,**关键点 Opus 核验**)

文件:`features/vault/containers/deposit/useVaultDepositMachine.ts`

结构:
```ts
export function useVaultDepositMachine(
  input: DepositInput | null,  // null = idle
  callbacks: {
    onBaseCompleted?: () => void;
    onEnableTrading?: () => Promise<void>;  // 外层 Container 提供:等 user.id + signMessage
    onValueCompleted?: (result: { txHash: Hash }) => void;
    onError?: (error: DepositServiceError) => void;
  }
): {
  topState: TopState;
  baseState: BaseChainState;
  valueState: ValueChainState;
  stepList: StepViewModel[];
  currentStep: number;
  totalSteps: number;
  failedPhase: TopState['phase'] | null;
  start: () => void;
  retry: () => void;
  reset: () => void;
};
```

内部:
- 3 个 `useReducer` 独立持 top/base/value state
- **防重入**:`prevStateRef` + `isUnmountedRef` + `AbortController`(wait/poll)
- `useEffect([topState])` 驱动;sub-state 变化时触发对应 infra 调用
- Base 完成 → 派发 TopAction `BASE_CHAIN_COMPLETED`,reducer 按 `config.isNewUser` 走 `enable_trading` 或 `value_chain_phase`
- `enable_trading` 分支:只派发 `onEnableTrading?.()` 回调给外层,自己不管 signMessage
- approve 完成后 **500ms sleep**(history MetaMask 冲突)
- `start()` 锁定 `config.isNewUser = !user.id` 快照(外层传入)

**Opus 核验项**(execute 暂停审阅):
- [ ] StrictMode 双跑不发两次链上 tx
- [ ] unmount 期间 await 不写 state
- [ ] AbortController 在 reset 时 abort
- [ ] RETRY 时 prevStateRef 清空允许重执行

### Step 6: useSubmitVaultDeposit(外层编排)

文件:`features/vault/containers/useSubmitVaultDeposit.ts`

结构(对齐 unstake/withdraw 的 mutation 模式):

```ts
export function useSubmitVaultDeposit(): {
  submit: (input: DepositInput) => Promise<DepositResult>;
  retry: () => void;
  reset: () => void;
  isSubmitting: boolean;
  topState: TopState;
  stepList: StepViewModel[];
  failedPhase: TopState['phase']|null;
  showTryAgain: boolean;
  isRetrying: boolean;
};
```

内部:
- `useMutation<DepositResult, DepositServiceError, DepositInput>`
- `onMutate`: notify.loading id + `setTradingStatus('trading')` 调 machine.start
- `onSuccess`:
  - `queryClient.invalidateQueries(queryKeys.vault.mag7Balance(address))`
  - `queryKeys.vault.investInfo(address)` / `cooldown` / `activity` / `myActivity`
  - `queryKeys.chain.evmBalances(address)`
  - `notify.success("common:deposited_formdata_amount_value2_into_vault")`
- `onError`: `handleDepositServiceError(err)`;若 `USER_REJECTED` 激活 `showTryAgain` + 3s setTimeout 自动隐藏
- **smart-transfer**:submit 入口前,若 Value 链直存且 `amount > evmBalance.{coin}`,先 `await trade.useSubmitTransfer({ from: 'Spot', to: 'Funding', coin, amount: diff })`(对齐 unstake)。Base 链 via bridge,不做 smart-transfer
- **enable_trading 编排**:传给 `useVaultDepositMachine.callbacks.onEnableTrading` 一个 async fn:
  ```ts
  async () => {
    for (attempt in [1..15]) {
      if (user.id) break;
      await sleep(1000);
      await refetchUserId();
    }
    if (!user.id) throw { kind: 'ENABLE_TRADING_TIMEOUT' };
    const ok = await (ui.isMobileScreen ? trade.signMessageMobile() : trade.signMessage());
    if (ok === 'cancel') throw { kind: 'USER_REJECTED' };
    if (ok === 'failed') throw { kind: 'ENABLE_TRADING_TIMEOUT' };
  }
  ```

**Opus 核验项**:
- [ ] StrictMode 双跑不重复 signMessage
- [ ] mutation 失败后 topState 停在 failed,允许 retry

### Step 7: VaultDepositDialog 数据组装(UI 层仅数据注入)

文件:`features/vault/components/dialogs/VaultDepositDialog/index.tsx`(Phase 1 骨架已产)

修改:
- 读 `useVaultDepositForm` + `useSubmitVaultDeposit`
- 根据 `tradingStatus` 路由:
  - idle → Form 区 + Preview 摘要(`Fees` / `You receive` / `Rate` / `Min` 动态显示)
  - preview → `<Preview {...preview} />`
  - trading → `<Trading {...tradingProps} />`
- `inputArea` slot:按 `selectedChain` 注入 `<BaseAccountInput>` 或 `<AccountSelector>`
- `<VaultPreTradeButton state={deriveButtonState(...)}>` 按派生 state 映射按钮态
- Skeleton:接入真实 `VaultDepositSkeleton`(新建于 Phase 1 或复用 Unstake Skeleton 基础)
- `openVaultDepositDialog` 正式实现(接 input.tokenAddress 预选 token)
- `DepositToSodexStep` 的 icons:用 `@phosphor-icons/react` 或 shared `<Icon>`,无对应 fallback 内联 SVG

### Step 8: openers.ts 替换 stub

文件:`features/vault/containers/dialogs/openers.ts`

- 删 stub 实现,`export { openVaultDepositDialog } from '@/features/vault/components/dialogs/VaultDepositDialog'`

### Step 9: i18n 对接

- `grep -rn "i18n.t\|useTranslation" src/features/vault/components/dialogs/VaultDepositDialog/` 找硬编码
- 57 个 key(见 analyze.md §21)按 namespace 补齐到 `public/locales/{en,zh,...}/vault.json | common.json | manual.json | spot.json`
- 若批量缺,用 `/soso-translation-auto` 生成

### Step 10: 关键 Component props wire up

- `Trading.tsx` 的 `sodexPanel` / `enableTradingPanel` / `vaultPanel` 3 slot: 由 `buildStepList` 派生
- `CollapsiblePanel` 的 `isFailed` / `showLoading`: 由 mapStepStatus 派生
- `VaultPreTradeButton.state`: `deriveButtonState`
- `WarningText.text`: failedPhase + kind 映射

---

## Step-Event 映射表(ui-progress 坑避免)

每个 UI step 都必须覆盖至少一个可观察事件:

| UI Step | state 覆盖 | 事件 |
|---|---|---|
| Approve(Base) | `checking_allowance` / `approving` / `approve_confirming` | checkErc20Allowance / sendTx(approve) / waitBaseReceipt |
| Confirm(Base) idle | `approve_completed` | (等待 bridge 提交) |
| Confirm(Base) processing | `bridge_confirming` | bridge tx submitted + waitBaseReceipt |
| Confirm(Base) completed | `bridge_settling` | pollBridgeSettle |
| Enable Trading | `enable_trading` | onEnableTrading callback running |
| Transfer(Value) | `transferring` | signTransferAsset + postTransferAsset |
| Approve(Value Permit) | `approving` | permitApproveSign |
| Confirm sign(Value) | `confirm_signing` | buildAndSignConfirmPermit |
| Confirm proceeding(Value) | `confirm_proceeding` | postConfirmPermit + waitValueReceipt |

**无空转 step**。

---

## Defer 项登记(对应 pending.md)

- `vault-deposit-mobile-trading-figma`(Mobile trading Figma 缺稿)
- `vault-deposit-interruption-modal`(全局 interruptionModal 降级为 toast)

---

## 验证锚点(verify 阶段核)

- [ ] `tsc --noEmit` 0 errors
- [ ] eslint 0 errors(vault feature)
- [ ] 方案 F 硬约束 5 条全过(grep:`services/vaultDepositService` 不存在 / `AsyncGenerator` 不存在 / reducer 不 import react / infra 不 toast / Container 不 import store)
- [ ] testnet tx ≥ 2 笔(approve + deposit)
- [ ] 32 条 analyze 规则消费清单全部 implement 或 defer(2 条 defer 登记 pending)
- [ ] 57 个 i18n key 存在
- [ ] reducer 单测:topReducer / baseChainReducer / valueChainReducer 覆盖所有 state × action

---

## Done 定义

- Step 0-10 全部完成
- 验证锚点全过
- `/k:migration finalize vault-deposit` 归档成功
- 模块 6 integration 前置工作触发
