# vault-deposit Interaction Spec

> Phase 0 产出,Phase 1/2 共同事实源。
> 源:`sodex-web/.../context/library/sodex-web/reference/vault/vault-deposit-guide.md` + 6 份 history。
> 原则:**只摘与迁移有关的决策/约束**,不抄代码。迁移不一致时优先以本 spec + 新项目规范裁决。

---

## 1. 币种体系(迁移不变)

| 链 | 链上 Symbol | 显示名 | 备注 |
|---|---|---|---|
| Base Chain | `MAG7.ssi` / `sMAG7.ssi` | 同 | Base 链原生 |
| Value Chain | `vMAG7.ssi` / `vsMAG7.ssi` | `MAG7.ssi` / `sMAG7.ssi` | 代码带 `v` 前缀,UI 去前缀 |

常量需与 unstake/withdraw 已定义的 `VMAG7_TOKEN_ADDRESS` / `VSMAG7_TOKEN_ADDRESS` 一致,**不重复定义**。

Stake/Unstake 判定:
- `isStake=true` → 输入 MAG7,输出 sMAG7
- `isStake=false` → 输入 sMAG7,输出 MAG7

**迁移约束**: token 选择 UI (基于 Base/ValueChain × MAG7/sMAG7) 在 Phase 1 `AccountSelector` 组件内产出;Domain 层只认 `{ isStake: boolean, chain: 'BASE_ETH' | 'VALUE_CHAIN' }`。

---

## 2. 分层状态机(方案 F reducer 契约)

### 顶层 reducer: `topReducer(state, action, config)`

```ts
type TopState =
  | { kind: 'idle' }
  | { kind: 'base_chain_phase' }
  | { kind: 'enable_trading' }
  | { kind: 'value_chain_phase' }
  | { kind: 'completed' }
  | { kind: 'failed', phase: 'base_chain' | 'value_chain' | 'enable_trading', error: ServiceError };

type TopAction =
  | { type: 'START' }
  | { type: 'BASE_CHAIN_COMPLETED' }
  | { type: 'ENABLE_TRADING_COMPLETED' }
  | { type: 'VALUE_CHAIN_COMPLETED' }
  | { type: 'BASE_CHAIN_FAILED', error: ServiceError }
  | { type: 'ENABLE_TRADING_FAILED', error: ServiceError }
  | { type: 'VALUE_CHAIN_FAILED', error: ServiceError }
  | { type: 'RETRY' }
  | { type: 'RESET' };

type TopConfig = { needsBaseChain: boolean; isNewUser: boolean }; // ⚠ isNewUser 是快照
```

**转换表**:

| 当前 | Action + 条件 | 下一状态 |
|---|---|---|
| idle | START + needsBaseChain=true | base_chain_phase |
| idle | START + needsBaseChain=false | value_chain_phase |
| base_chain_phase | BASE_CHAIN_COMPLETED + isNewUser=true | enable_trading |
| base_chain_phase | BASE_CHAIN_COMPLETED + isNewUser=false | value_chain_phase |
| base_chain_phase | BASE_CHAIN_FAILED | failed(base_chain) |
| enable_trading | ENABLE_TRADING_COMPLETED | value_chain_phase |
| enable_trading | ENABLE_TRADING_FAILED | failed(enable_trading) |
| value_chain_phase | VALUE_CHAIN_COMPLETED | completed |
| value_chain_phase | VALUE_CHAIN_FAILED | failed(value_chain) |
| failed(X) | RETRY | 对应 phase |
| completed / failed | RESET | idle |

### BaseChain reducer: `baseChainReducer(state, action)`

```ts
type BaseChainState =
  | { kind: 'idle' }
  | { kind: 'checking_allowance' }
  | { kind: 'approving'; allowanceAmount: bigint }
  | { kind: 'approve_confirming'; txHash: string }
  | { kind: 'approve_completed'; txHash?: string }
  | { kind: 'bridging' }
  | { kind: 'bridge_confirming'; txHash: string }
  | { kind: 'bridge_settling'; bridgeTxHash: string; approveTxHash?: string }
  | { kind: 'completed'; approveTxHash?: string; bridgeTxHash: string }
  | { kind: 'failed'; step: 'approve' | 'confirm'; error: ServiceError; cache: CacheData };

// RETRY 回退点:
// step='approve' failed → checking_allowance (重新检查 allowance)
// step='confirm' failed → approve_completed (保留 approveTxHash, 直接进 bridge)
```

**关键节点**:
- `bridge_settling`: 轮询合约 `SOSO_DEPOSIT_CONTRACT.getTransaction(BASE_CHAIN_IDENTIFIER, bridgeTxHash)`,判定 `txHash 匹配 + status===1`。**15 次 × 5 秒**(history 20260205 将 10 升到 15)。超时后写 warning,允许流程继续(不视为失败)。

### ValueChain reducer: `valueChainReducer(state, action, config)`

```ts
type ValueChainState =
  | { kind: 'idle' }
  | { kind: 'transferring' }      // Spot → EVM-Funding
  | { kind: 'staking' }            // MAG7 → sMAG7 (Stake 路径)
  | { kind: 'stake_confirming'; txHash: string }
  | { kind: 'approving' }          // EIP-2612 permit sign
  | { kind: 'approve_completed'; signature; deadline: number }
  | { kind: 'confirm_signing' }
  | { kind: 'confirm_proceeding' }
  | { kind: 'completed' }
  | { kind: 'failed'; stepIndex: number; stepName: StepName; error: ServiceError; cache: CacheData };

type ValueChainConfig = { needsTransfer: boolean; needsStake: boolean };
type StepName = 'transfer' | 'stake' | 'approve' | 'confirm';
type CacheData = {
  transferData?: unknown;
  stakeData?: { txHash: string };
  approveSignature?: unknown;
  approveDeadline?: number;
};
```

**RETRY 策略**(history 20251219 修复):
- `transfer` failed → transferring(从头重试)
- `stake` failed → **staking**(不回退到 transfer,资金已在 EVM-Funding)
- `approve` failed → approving
- `confirm` failed → 若 `approveDeadline > now` 则走 `approve_completed`(复用签名);否则重走 approving

---

## 3. 账户逻辑

| 场景 | selectedChain | token | config.needsBaseChain | config.needsTransfer | config.needsStake | isNewUser 影响 |
|---|---|---|---|---|---|---|
| Base 存 MAG7 | BASE_ETH | MAG7 | true | 自动 true(from=SPOT) | true | 触发 enable_trading |
| Base 存 sMAG7 | BASE_ETH | sMAG7 | true | 自动 true(from=SPOT) | false | 触发 enable_trading |
| Value 存 MAG7 / 源=Spot | VALUE_CHAIN | MAG7 | false | true | true | 无 |
| Value 存 MAG7 / 源=EVM-Funding | VALUE_CHAIN | MAG7 | false | false | true | 无 |
| Value 存 sMAG7 / 源=Spot | VALUE_CHAIN | sMAG7 | false | true | false | 无 |
| Value 存 sMAG7 / 源=EVM-Funding | VALUE_CHAIN | sMAG7 | false | false | false | 无 |

**关键**:
- Base Chain 桥接后资金**自动到 Spot**(`toClob=true` 统一,history 20251107),所以 Value Chain 子机的 `from` 被 Container 强制成 `SPOT`
- Value Chain 直接存款时,`from` 由用户选择(Spot / EVM-Funding)

---

## 4. 资金流向(统一 toClob=true)

```
Base MAG7 → bridge(toClob=true) → ValueChain Spot(vMAG7) → Transfer → EVM-Funding(vMAG7) → Stake → EVM-Funding(vsMAG7) → Vault
Base sMAG7 → bridge(toClob=true) → ValueChain Spot(vsMAG7) → Transfer → EVM-Funding(vsMAG7) → Vault
ValueChain 直接 → (可选 Transfer) → EVM-Funding → (可选 Stake) → Vault
```

Vault Deposit 最终签名类型: EIP-2612 Permit,`depositTokenAddress` 根据 `isStake` 取 `VMAG7_TOKEN_ADDRESS` (isStake=true) 或 `VSMAG7_TOKEN_ADDRESS`(isStake=false)。

---

## 5. 方案 F 架构约束(Phase 2 plan 阶段硬核验)

### 5.1 文件组织

```
src/features/vault/
├── domain/
│   ├── depositStateMachine.ts   ← 3 个纯 reducer + types(可单测)
│   └── depositPermit.ts          ← EIP-712 typed-data builder(复刻 withdrawPermit/unstakePermit)
├── infra/chain/
│   └── vaultDepositInfra.ts      ← 10 个原子 async
├── containers/
│   ├── deposit/useVaultDepositMachine.ts   ← reducer + effect driver
│   ├── useSubmitVaultDeposit.ts  ← 外层编排(mutation / notify / invalidate / enable_trading / smart-transfer)
│   ├── useVaultDepositForm.ts    ← 表单
│   ├── depositFlowLogic.ts       ← derive/decide/map/build 纯派生
│   └── handleDepositServiceError.ts
└── components/dialogs/VaultDepositDialog/  ← Phase 1 产出
```

### 5.2 禁止清单

- ❌ 不建 `services/vaultDepositService.ts`(vault-deposit 独有决策,理由见 05-deposit.md §架构决策)
- ❌ 不用 AsyncGenerator 模式
- ❌ reducer 内不 `import react` / `import stores`
- ❌ infra 原子函数内不 `toast` / `notify` / `navigate`
- ❌ Container 不直接 `import stores`(走 `useEvmBalancesQuery` + `queryClient.invalidateQueries`)

### 5.3 Infra 原子函数清单(10 个,Phase 2 execute 依此生成)

```ts
// Base 链 (复用 claim/unstake 已有的 wagmi 工具)
export async function checkErc20Allowance(params): Promise<bigint>;
export async function approveErc20(params): Promise<{ txHash: `0x${string}` }>;
export async function waitBaseReceipt(params): Promise<void>;              // confirmations=2
export async function bridgeToValueChain(params): Promise<{ txHash: `0x${string}` }>; // IBridge.bridge / bridgeNativeToken
export async function pollBridgeSettle(params): Promise<{ confirmed: boolean }>; // 15×5s, 合约 getTransaction

// Value 链 - Transfer (复用 trade.useSubmitTransfer? 不, Service 不能 import container,所以走 trade 的 api client)
export async function signTransferAsset(params): Promise<{ signature; nonce }>;
export async function postTransferAsset(params): Promise<unknown>;

// Value 链 - Permit (复用 claim/unstake 的 CallForPermit infra)
export async function permitApproveSign(params): Promise<{ signature; deadline: number }>;
export async function permitConfirmBuild(params, prevSig): Promise<ConfirmPermitPayload>;
export async function permitConfirmPost(payload): Promise<{ txHash: `0x${string}` }>;
export async function waitValueReceipt(params): Promise<void>;             // confirmations=3
```

### 5.4 Container 外层编排职责(`useSubmitVaultDeposit`)

- `onMutate`: `notify.loading("Depositing X MAG7.ssi into vault...")`
- **enable_trading 分支**: 监听 `machine.state.kind === 'enable_trading'`,调 trade/login 的 signMessage hook(**若该 hook 未 ready,先迁 trade/login**),等待 `user.id` 就绪(15×1s 重试),完成后 `dispatch({ type: 'ENABLE_TRADING_COMPLETED' })`
- **smart-transfer**: Base 链阶段前不做;Value 链直存时由 `useVaultDepositForm` 校验,不足时先调 `trade.useSubmitTransfer`(对齐 unstake/withdraw 已有模式)
- `onSuccess`: invalidate
  - `queryKeys.vault.mag7Balance(address)`
  - `queryKeys.vault.investInfo(address)`
  - `queryKeys.vault.cooldown(address)`(如有)
  - `queryKeys.chain.evmBalances(address)`
- `onError`: `handleDepositServiceError(err)` → toast + i18n

### 5.5 `useVaultDepositMachine` 驱动器契约

```ts
export function useVaultDepositMachine(input, callbacks): {
  state: TopState;
  baseState: BaseChainState;
  valueState: ValueChainState;
  stepList: StepView[];       // 派生自 depositFlowLogic
  currentStep: number;
  totalSteps: number;
  start: () => void;
  retry: () => void;
  reset: () => void;
};
```

**防重入必做**:
- `prevStateRef.current === state.kind` 挡 StrictMode 双跑
- `isUnmountedRef.current` 跨 await 检查
- AbortController(可选,至少对 `pollBridgeSettle` / `waitBaseReceipt` / `waitValueReceipt` 生效)

---

## 6. Retry 与错误处理

### 6.1 失败识别

- 所有失败通过 `handleDepositServiceError` 的 `kind` 枚举,统一命名(对齐 unstake/withdraw):
  `USER_REJECTED | APPROVE_FAILED | BRIDGE_FAILED | BRIDGE_TIMEOUT | TRANSFER_FAILED | PERMIT_FAILED | CONFIRM_FAILED | NETWORK_ERROR | CHAIN_MISMATCH | ENABLE_TRADING_TIMEOUT | INSUFFICIENT_GAS | UNKNOWN`

### 6.2 `isUserRejectedError` 检测

复刻老项目:匹配 `user rejected` / `user denied` / `user canceled` / `rejected the request` / `UserRejectedRequestError` / `denied transaction` 关键字。**归属位置**:`domain/depositPermit.ts`(纯函数)或 `shared/utils/wagmiErrors.ts`(若 claim/unstake 已有)。

### 6.3 Try Again UI

- 只在"用户拒签"型错误展示按钮
- 点击后显示 "Retrying..." 3 秒 → 自动隐藏按钮(history 20251205)
- 按钮归 Phase 1 的 `Trading.tsx` 组件,调 `retry()`

---

## 7. Edge cases (来自 history)

| 来源 | 问题 | 新项目对策 |
|---|---|---|
| 20260205 | WS 推送导致 `isNewUser` 中途变化 | **execute 时锁快照**(`isNewUserSnapshotRef` → reducer 的 config)。**强约束:reducer 不读 user store**,只认入参 config |
| 20260205 | Enable Trading 等 `user.id` 超时 | Container 层 15×1s 重试;超时抛 `ENABLE_TRADING_TIMEOUT` |
| 20260306-问题1 | 流程中 useEffect 触发 auto-fill 把金额覆盖成 0 | `useVaultDepositForm` 必须用 `tradingStatus !== 'idle'` 守卫 4 个 auto-fill,**或**更彻底地把 form 拆成 `idle` 时读表单,流程开始后 `freeze(snapshot)` |
| 20260306-问题2 | Enable Trading 完成后金额被覆盖 | form 的 useEffect 不依赖 `isNewUser`,改依赖 `selectedChain?.chain`;或走 `isNewUserRef`(同上 freeze 方案更干净) |
| 20260306-问题1 | 0 金额跳过 approve 导致 bridge 失败 | `checkErc20Allowance` 里加 `if (amountRaw === 0n) throw new ServiceError('AMOUNT_ZERO')` |
| 20250107 | sMAG7 confirm_proceeding 未等 receipt | `permitConfirmPost` 后**必须** `waitValueReceipt(confirmations=3)`;与 claim/unstake 一致 |
| 20251107 | sMAG7 toClob 统一 | 新项目 `bridgeToValueChain` 永远传 `toClob=true` |
| 20251205 | Confirm 文案三阶段 | Phase 1 `DepositToSodexStep` 按 idle/processing/completed 渲染不同文案 |
| 20251219 | stake retry 错误回退 | reducer 的 RETRY 分支精确写,见 §2 RETRY 策略 |
| 20251219 | Value 链直存无 CollapsiblePanel 包装 | Phase 1 `VaultDepositDialog/Trading.tsx` 统一用 CollapsiblePanel,对齐 Base 链 |

---

## 8. 跨 feature 依赖

| 依赖 | 用途 | 是否已 ready |
|---|---|---|
| `trade.useSubmitTransfer` | Value 链直存 smart-transfer(Spot→EVM-Funding 补差额) | ✅ unstake/withdraw 已用 |
| `trade.useEvmBalancesQuery` | 余额校验 | ✅ |
| `trade/login 的 signMessage hook` | enable_trading 签名 | ⚠ **Phase 2 execute 前需确认**。若未 ready,阻塞点明示在 plan.md |
| `shared/infra/notify` | toast | ✅ |
| `shared/queryKeys/vault.*` | invalidate key | ✅(withdraw 阶段已补齐) |
| `shared/utils/wagmiErrors.isUserRejected` | retry UI 判定 | 若不存在,本模块在 `domain/` 新增,Phase 6 finalize 时考虑提到 shared |

---

## 9. 迁移时与 context guide 的偏差警告

无已知偏差。guide 最后更新 2026-03-06,新项目 feat/vault 分支截至 2026-04-23。若 Phase 2 execute 阶段发现偏差,回写到本 spec 末尾 "补充" 段,并 PR 时同步更新 sodex-web context(由模块 6 cleanup 统一做)。

---

## 11. UI 顶层路由(idle → preview → trading 三屏)

**状态变量**: `tradingStatus: 'idle' | 'preview' | 'trading'`(index.tsx:69-71)

| tradingStatus | 渲染视图 | 迁出条件 |
|---|---|---|
| `idle` | **Form UI**(ChainSelector + TokenSelector + AccountSelector + Amount + Preview 摘要行 + Deposit 按钮 + "Must to Know" 折叠面板) | 点 Deposit → `preview` |
| `preview` | **Preview 组件**(交易摘要:From/To token 金额、汇率、费用、余额校验) | onConfirm → `trading` / onBack → `idle` |
| `trading` | **Trading 组件**(多步骤面板 + Try Again) | onSuccess → 关弹窗 resolve |

**关键**:
- Preview 是**独立页面级视图**,不是小弹窗;占满 Dialog 内容区
- `preview → trading` 是不可回退(开始签名后不允许回退到 preview,只能 retry 当前 step)
- auto-fill 守卫(history 20260306):4 个 useEffect 必须 `if (tradingStatus !== 'idle') return`

**迁移映射**:
- idle 对应 `VaultDepositDialog/index.tsx` 的 idle 分支
- preview 对应 `VaultDepositDialog/Preview.tsx`
- trading 对应 `VaultDepositDialog/Trading.tsx`

---

## 12. 弹窗完整清单(不止 1 个)

| # | 弹窗 | 触发 | 归属 | 新项目处理 |
|---|---|---|---|---|
| 1 | **主 Deposit 弹窗** | 用户从 Vault Page → Deposit 按钮 | 本模块 | `openVaultDepositDialog()` ,响应式(PC Dialog / Mobile Drawer) |
| 2 | **interruptionModal** | 钱包拒绝 approve 或 confirm 签名时 | 全局共享(老项目 `useProcessOptions.tsx:332,378`) | ⚠ **检查新项目是否已有**;若无,按 `.claude/rules/modal-component-style.md` 建 `_shared/InterruptionDialog` |
| 3 | **PrivyCheckModal** (VaultPreTradeButton.tsx) | 连接/校验钱包状态 | Privy 整合相关 | ⚠ **前置依赖**,若新项目未接 Privy,VaultPreTradeButton 迁移时需降级为普通 connect 流 |

**Try Again 不是弹窗,是 Trading.tsx 内的按钮**(bg `#262626`,3 秒自动隐藏)。

---

## 13. 折叠面板完整清单(5 个,不止 1 个)

| # | 面板 | 组件 | 状态变量 | 展开规则 |
|---|---|---|---|---|
| 1 | **Must to Know** | MUI `<Collapse>` (index.tsx:72,621,645) | `isMustKnowExpanded` | 用户手动展开;idle 表单常驻 |
| 2 | Depositing to SoDEX | `<CollapsiblePanel>` (Trading.tsx:267-285) | `isSodexExpanded` | 仅 Base chain 显示 |
| 3 | Enable Depositing to SLP Vault | `<CollapsiblePanel>` (Trading.tsx:289-301) | `isEnableTradingExpanded` | 仅 `isNewUserInitial && Base chain` |
| 4 | Depositing to SLP Vault (Base) | `<CollapsiblePanel>` (Trading.tsx:304-319) | `isVaultExpanded` | Base chain 多步骤阶段 |
| 5 | Depositing to SLP Vault (Value) | `<CollapsiblePanel>` (Trading.tsx:329-345) | `isVaultExpanded`(同 4 共享) | 仅 Value chain 单阶段 |

**CollapsiblePanel 状态 5 种**: `isExpanded` / `isActive` / `isCompleted` / `isFailed` / `showLoading`。

**失败态硬规则**(`CollapsiblePanel.tsx:31,50-72`):
- `canToggle = isActive || isCompleted`
- `isFailed=true` 时 **不可展开折叠**(只读)
- 标题从 `text-white` 变 `text-[#A3A3A3]`(灰)
- 右侧显示 **WarningIcon `text-[#F1C21B]` 黄色**(16px,非 `#F19D38` Alert 色)

---

## 14. Loading 完整清单(11 处)

| # | 位置 | 组件/类型 | 触发 |
|---|---|---|---|
| 1 | 初始 token config 加载 | `<VaultDepositSkeleton>` (index.tsx:48) | `useTokenConfig().isLoading` |
| 2 | NAV 数据加载 | (内嵌展示) | `useNav().isNavLoading` |
| 3 | Base 链余额查询(Max 按钮) | 文案"Loading" 替换金额 | `BaseAccountInput.tsx:124,131` |
| 4 | Value 链余额(AccountSelector) | 骨架/占位 | index.tsx:828 传 `isLoading` |
| 5 | CollapsiblePanel 步骤行 spinner | `animate-spin border-[#FF7637]` (2px,24px 圆) | `showLoading && isActive` |
| 6 | DepositToSodexStep circle | `<CircleProcessing spinning={isProcessing} />` | approve/confirm/settle 各阶段 |
| 7-10 | 各 CollapsiblePanel `showLoading` 桥接到 machine | Trading.tsx:273/295/310/335 | 对应 phase processing |
| 11 | Try Again 按钮 "retrying" | 3 秒 setTimeout 自动隐藏 | `isRetrying=true` |

**新项目约定**:
- Skeleton 统一走 `@/shared/components/ui/Skeleton`(若已存在)
- Spinner 复用前序 claim/unstake 已建的(如 `shared/components/ui/Spinner` + Tailwind `animate-spin`)
- `#FF7637` 橙色 spinner 是老项目自定义,**需检查新项目有无对应 warning token**;否 bracket 类 + 注释

---

## 15. Notify + i18n 完整清单

### 15.1 Notify toast(13 处)

| # | 时机 | 类型 | i18n key | autoClose | 文件:行 |
|---|---|---|---|---|---|
| 1 | Bridge 交易提交 | loading | `manual:formdata_amount_value2_deposit_is_pending` | **false** | useBaseChainDeposit.ts:504 |
| 2 | Bridge 确认成功 | success | `common:deposit_formdata_amount_value2_successfully` | 默认 | useBaseChainDeposit.ts:544 |
| 3 | Base chain step 失败(带 onError) | error | `error.message` \| `spot:transaction_failed_please_try_again` | 默认 | useBaseChainDeposit.ts:659 |
| 4 | Base chain 失败(无 onError) | error | `vault:base_chain_deposit_failed_please_try` | 默认 | useBaseChainDeposit.ts:665 |
| 5 | Vault 确认完成 | success | `common:deposited_formdata_amount_value2_into_vault` | 默认 | useNewValueChainDeposit.tsx:911 |
| 6 | Vault 失败(带 onError) | error | `error.message` \| fallback | 默认 | useNewValueChainDeposit.tsx:936 |
| 7 | Vault 失败(无 onError) | error | fallback | 默认 | useNewValueChainDeposit.tsx:942 |
| 8 | 交易被用户取消 | error | `vault:transaction_canceled` | 默认 | Trading.tsx:206 |
| 9 | 通用交易失败 | error | `common:transaction_failed_error_message` | 默认 | Trading.tsx:208 |
| 10 | 新用户未启用 Trading | warning | `common:please_enable_trading_first` | 默认 | VaultPreTradeButton.tsx:104 |
| 11 | 网络切换失败 | error | (直接消息) | 默认 | useNetworkSwitch.ts:152 |
| 12 | 网络切换被拒 | error | (直接消息) | 默认 | useNetworkSwitch.ts:158 |
| 13 | (已注释) Stake 完成 | success | 自定义 | - | useNewValueChainDeposit.tsx:760 |

**新项目迁移规则**:
- 全部走 `@/shared/infra/notify`(对齐 unstake/withdraw)
- **归位**:notify 调用 **只在 Container 层**(useSubmitVaultDeposit)。reducer/infra/service 不能 toast
- Bridge pending 的 `autoClose: false` 由 `onMutate` 抛出,`onSuccess/onError` 负责 `toast.dismiss(loadingId)`

### 15.2 i18n key 汇总(57 unique,按 namespace 分组)

**common (23)**: loading / confirm / expand / hide / fees / connect_wallet / max_value1 / must_to_know / you_receive / you_receive_2 / you_will_need_to_sign_this / sign_transactions / you_deposit / try_again / deposited_formdata_amount_value2_into_vault / deposit_formdata_amount_value2_successfully / transaction_failed_error_message / sodex_will_cover_the_service_fees / transaction_proceeding_2 / please_enable_trading_first / approving_spending_cap_in_wallet / confirming_in_wallet / network_switch_failed / network_switch_rejected

**vault (25)**: amount_tokendisplayname / max_displaybalance_tokendisplayname / minimum_deposit_is_minamount_tokendisplayname / minimum_minimum / approve_spending_cap / depositing_into_sodex_3mins / waiting_for_balance_sync_2mins / network_chain / account_type_Spot / account_type_Spot_inactive / account_type_EVM-Funding / account_type_EVM-Funding_inactive / rate / show / approve_and_confirm / approving_spending_cap_in_wallet_on / confirming_in_wallet_on_mobile / deposit_to_slp_vault / depositing_to_slp_vault / depositing_to_sodex / enable_depositing_to_slp_vault / transaction_canceled / retrying / base_chain_deposit_failed_please_try / transferring_to_evm_funding

**manual (2)**: formdata_amount_value2_deposit_is_pending / open_a_channel_from_your_account_2/4

**spot (1)**: transaction_failed_please_try_again

**迁移任务**:
- 检查 `public/locales/` 对应 namespace 是否全量存在,缺的走 `/soso-translation-auto` skill 补
- 每个模板参数(`formData_amount` / `value2` / `tokenDisplayName` / `minAmount` / `displayBalance`)在新项目必须保留**同名插值**(不改键名)

---

## 16. 失败态 UI 完整规格

### 16.1 颜色

| 场景 | 颜色 | 注意 |
|---|---|---|
| Alert "Must to know" 文字/边 | `#F19D38` | warning-primary 橙 |
| Alert "Must to know" 背景 | `#2F241D` | 深橙 |
| **Failed 步骤 WarningIcon** | `#F1C21B` ⚠ | **黄色,非橙色**,对应新项目可能是 `text-status-warning` 或待补 token |
| Failed 面板标题 | `#A3A3A3` | text-text-secondary(灰) |
| Try Again 按钮 bg | `#262626` | 深灰,对应 bg-bg-black-tertiary |
| Step spinner 边 | `#FF7637` | 老项目自定义橙,新项目待 map |

### 16.2 行为规则

- **Try Again 显示条件**: 仅 `isUserRejectedError(error) === true`(匹配 `user rejected / denied / canceled / rejected the request / UserRejectedRequestError`)
- **Try Again 3 秒超时**: 点击后 `setIsRetrying(true)` + `setTimeout(3000, () => { setIsRetrying(false); setShowTryAgain(false); })`
- **Failed CollapsiblePanel 不可折叠**: `canToggle = isActive || isCompleted`(isFailed 不在其中)
- **Value Chain 失败**: 同时显示 WarningIcon + loading spinner(history 20251205)
- **失败步骤之前显示 completed**: `getStepStatus` 在 failed 状态下按 stepIndex 判定,小于 failedStepIndex 的回显 ✓ 绿

### 16.3 failedPhase 归属

- `'base_chain'` → Base chain 面板标 failed,Enable Trading / Vault 面板保持 pending
- `'enable_trading'` → SoDEX 面板 completed,Enable Trading failed,Vault pending
- `'value_chain'` → SoDEX completed,(Enable Trading completed 若新用户),Vault failed

---

## 17. 移动端适配点(6 处具体分支)

| # | 点 | PC 行为 | Mobile 行为 | 判断 |
|---|---|---|---|---|
| 1 | 主弹窗容器 | `<Dialog>` | `<Drawer>`(底部抽屉) | `openResponsive` 自动 |
| 2 | 签名入口 | `signMessage()` | `signMessageMobile()` | `ui.isMobileScreen`(useVaultDeposit.ts:302-304) |
| 3 | Stake 步骤 label | `<StakeProcess isActive />` | `<StakeProcess isActive inMobile />`(含 MobileIcon) | useProcessOptions.tsx:180 |
| 4 | Enable Trading 步骤 | 普通文案 | `<MobileIcon />` + 特定 label | useProcessOptions.tsx:297 |
| 5 | Confirm 步骤 i18n | `common:confirming_in_wallet` | `vault:confirming_in_wallet_on_mobile` | useProcessOptions.tsx:344,346 |
| 6 | ProcessIndicator 扫码 | 不显示 | `isFromMobileScan={user.connectorType === 'walletConnect'}` | Trading.tsx:317 |

**迁移约定**(新项目):
- 统一用 `useIsMobile()` hook 或 Tailwind `mobile:` / `pc:` 前缀(v1.11.0 规则)
- `signMessageMobile` 是 trade/login feature 的 hook,Phase 2 execute 需确认 trade 侧已导出
- MobileIcon / 移动端专用 i18n key 在 Phase 1 ui-migration 的 legacy-notes 必须标出

### Figma Mobile 节点(未拉取,Phase 1 负责)

| 场景 | Figma node | 状态 |
|---|---|---|
| Base chain Mobile idle | `434:46140` | **未拉取**,Phase 1 VaultDepositDialog 的 ui-migration 调用时拉 |
| Value chain Mobile idle | `434:50448` | **未拉取** |
| Mobile 进行中/失败 | 未提供 | ⚠ **设计稿缺失**,Phase 1 参考 Base/Value 进行中 PC 稿 + 响应式规则自适配 |

**Phase 1 硬约束**: 每个 `/k:ui-migration` 调用必须对 PC + Mobile 两套 Figma 都拉,冲突裁决时 Mobile 独立判断(`openResponsive` Shell 会自动切布局,但内容区 padding/字号/按钮排列可能不同)。

---

## 18. Phase 1/2 消费本 spec 的方式

- **Phase 1 (`/k:ui-migration`)**:
  - Step 0.5 legacy-notes 引用 §3(账户)/§7(edge)/§11(顶层路由)/§12(折叠面板)/§13(Loading)/§14(Notify+i18n)/§15(失败态)/§17(移动端)
  - 每个组件在 ui-migration 时必须拉**对应 Figma 节点的 PC + Mobile 两套**
  - §12 的 5 个折叠面板对应 Trading.tsx 内部布局,**不单独出 ui-migration**,跟随 Trading 组件
  - §11 的 `idle/preview/trading` 三屏对应 3 个独立组件:`VaultDepositDialog/index.tsx`(idle form) / `Preview.tsx` / `Trading.tsx`
- **Phase 2 (`/k:migration`)**:
  - `analyze`: 读 §1/§2/§3/§7/§11/§14(错误映射参考 §15)
  - `spec`: copy §5(架构约束) + §6(错误处理) + §16.3(failedPhase 归属)
  - `plan`: §5.1 文件 + §5.3 infra + §12 的 CollapsiblePanel 复用判断(是否进 `_shared/`)
  - `execute`:
    - reducer 严格按 §2
    - Container `useSubmitVaultDeposit` 的 notify 照 §14.1 13 条 toast 逐一落地
    - 移动端按 §17 6 处分支
    - interruptionModal / PrivyCheckModal 按 §12 弹窗清单决定建 or 复用
  - `verify`:
    - §7 edge cases 逐条回归
    - §14.2 57 个 i18n key 在 `public/locales/` 齐全
    - §17 Figma Mobile 节点是否有完整 ui-migration 产物
