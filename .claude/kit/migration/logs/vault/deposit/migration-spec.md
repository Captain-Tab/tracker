<!-- MIGRATION_SUMMARY_START -->
功能: vault-deposit
关键文件: features/vault/{domain,infra/chain,containers,components/dialogs/VaultDepositDialog}
API: POST /spot/universal (transferAsset); POST /vault/call-for-permit; chain write (approve/bridge); chain read (getTransaction, nonce, balance, allowance)
写操作: ERC20.approve / IBridge.bridge / POST /spot/universal / POST /vault/call-for-permit
状态管理: 纯 reducer(domain) + Zustand(vault-deposit-form ui 态,如需) + React Query(invalidate 后端余额)
关联功能: claim(复用 callForPermit infra), unstake(复用 smart-transfer + mapInfraError), withdraw(复用 permit builder 结构), trade(useSubmitTransfer + enable_trading signMessage)
<!-- MIGRATION_SUMMARY_END -->

# Migration Spec: vault-deposit

> 上游:[analyze.md](./analyze.md) + [interaction-spec.md](./interaction-spec.md) + [ui-migration-summary.md](./ui-migration-summary.md)
> 架构决策:**方案 F Workflow Hook Pattern**
> 生成:2026-04-23 by `/k:migration spec vault-deposit`

---

## 旧架构描述

- **当前实现**:MobX Store(`user` / `vault` / `ui`)+ 3 层嵌套 hook 状态机(useVaultDeposit 顶层 + useBaseChainDeposit + useNewValueChainDeposit)+ `useProcessOptions` step 编排 + eventBus(VAULT_DEPOSIT_SUCCESS)
- **关键文件**:
  - `sodex-web/src/pages/vault/components/modals/funding/deposit/index.tsx` 861 行
  - `transaction/_hooks/useVaultDeposit.ts` 454 行
  - `transaction/_hooks/useBaseChainDeposit.ts` 769 行
  - `transaction/_hooks/useNewValueChainDeposit.tsx` 1060 行
  - `transaction/useProcessOptions.tsx` 400 行
- **数据流**: `form (RHF) → useVaultDeposit dispatch(START) → effect 跑副作用 → dispatch(COMPLETED/FAILED) → eventBus.emit → 上游 observer refresh`
- **核心逻辑摘要**:3 阶段 state machine(Base → EnableTrading? → Value),含 15×5s bridge settle 轮询 + 30min permit deadline + 3s Try Again timeout + isNewUser 快照锁 + 4 个 form auto-fill 守卫

## 新架构目标

- **目标分层**:sodex-next 5 层 Clean Architecture(方案 F)
  ```
  UI (VaultDepositDialog/*)
    ↓ props
  Container
    ├─ useSubmitVaultDeposit (外层编排 mutation + notify + invalidate + enable_trading + smart-transfer)
    └─ useVaultDepositMachine (workflow hook:reducer + effect driver + 防重入)
         ↓ calls
  Domain (reducer 纯函数 + typed-data builder + constants)
         ↓
  Infra (chain 原子 async + api)
         ↓
  External (wagmi / HTTP / RPC)
  ```

- **架构硬约束**(plan 阶段核验):
  - ❌ 不建 `services/vaultDepositService.ts`
  - ❌ 不用 AsyncGenerator
  - ❌ reducer 内不 `import react`
  - ❌ infra 不 toast/notify
  - ❌ Container 不直接 import store(invalidate + query)
  - ✅ reducer 是纯函数,可单测
  - ✅ infra 原子函数不跨层依赖 domain,错误归 `infra/errors.ts`
  - ✅ 编排副作用统一在 Container 层

- **数据转换路径**:
  - DTO(infra 返回如 `{txHash, nonce}`)→ Domain type (`CallForPermitRequest` / `SodexBridgeTransaction` 等)→ ViewModel(Container hook 返回的 UI 派生数据)
  - notify/toast → 仅在 Container 的 mutation 回调

- **状态管理**:
  - **reducer state**(单次 flow 短期):useReducer 持有,不入 store
  - **form state**(amount / selectedChain / tokenType):useVaultDepositForm 的 useState(单次 flow 内 React state 够,不建 store;history 20260306 守卫保留)
  - **余额**:React Query(复用 `useVaultMag7Balance` / `useEvmBalancesQuery`)
  - **成功后数据刷新**:`queryClient.invalidateQueries` 而非 eventBus

## Endpoint 清单

| 方法 | 路径/合约 | 用途 | 老项目路径 | 新项目复用点 |
|------|---------|------|----------|-----------|
| contract write | `ERC20.approve(bridgeAddr, amountRaw)` on Base | 授权桥接合约花费 | useBaseChainDeposit.ts:413 | 新增 `infra.approveErc20` |
| contract write | `IBridge.bridge(coinSymbol,to,amount,toClob=true)` on Base | 跨链桥接 | useBaseChainDeposit.ts:485 | 新增 `infra.bridgeToValueChain` |
| contract read | `MAG7_ERC20.allowance(user,bridgeAddr)` | 判断需否 approve | useBaseChainDeposit.ts:385 | 新增 `infra.checkErc20Allowance` |
| contract read | `SOSO_DEPOSIT.getTransaction(BASE_CHAIN_IDENTIFIER, txHash)` on Value | Bridge 入账轮询 | useBaseChainDeposit.ts:598 | 新增 `infra.pollBridgeSettle`(15×5s) |
| POST | `/spot/universal` (type=transferAsset) | Spot → EVM-Funding | useNewValueChainDeposit.tsx:651 | 新增 `infra.signTransferAsset` + `infra.postTransferAsset`(或复用 trade.useSubmitTransfer,二选一) |
| contract write(wallet) | `signTypedData(EIP-712 Permit)` | Approve permit 签名 | useNewValueChainDeposit.tsx:794 | 新增 `infra.permitApproveSign`(结构 alike claim/unstake 已有) |
| POST | `/vault/call-for-permit` | 提交 permit 调用 | useNewValueChainDeposit.tsx:875 | ✅ **复用** `postCallForPermit`(vaultApi.ts) |
| contract read | `CALL_FOR_PERMIT.nonces(account)` | permit nonce | (老项目 useCallForPermit) | ✅ **复用** `getClaimNonce`(vaultClaimInfra.ts) |
| wallet sign | EIP-712 `signCallForPermit` | CallForPermit typed-data 签名 | useNewValueChainDeposit.tsx | ✅ **复用** `signCallForPermit`(vaultClaimInfra.ts) |
| contract read(wait) | `waitForTransactionReceipt(confirmations=3)` on Value | permit tx 入链确认 | useNewValueChainDeposit.tsx:860 | ✅ **复用** `waitForClaimReceipt` |
| cross-feature hook | trade.useSubmitTransfer | smart-transfer Spot→Funding 补差额 | (新项目已迁,unstake 已用) | Container 层直接调 |
| cross-feature hook | trade/login signMessage hook | Enable Trading 签名 | LoginContext.signMessage | ⚠ **待确认 trade 侧暴露名** |

## Breaking Changes

- **无新增导出**;`openVaultDepositDialog` 早在模块 0 scaffold,本模块覆盖 stub 实现
- **替换模块 0 stub**:`containers/dialogs/openers.ts` 的 `openVaultDepositDialog` 从 stub 改指向 `VaultDepositDialog/index.tsx openVaultDepositDialog`
- **新增文件**(domain + infra + container):见 plan 阶段详单
- **DTO/Domain 类型新增**:`DepositInput` / `DepositResult` / 3 个 reducer state/action union / `DepositServiceError` kind 新增 8 种(复用 claim/unstake 已有者沿用)
- **i18n keys**: 57 个(见 interaction-spec §14.2),若 `public/locales/` 缺失需 `/soso-translation-auto` 补
- **`features/vault/index.ts` 公共 API**:无新增 export(dialog opener 已在 shared openers 文件)

## 兼容策略

- **渐进式**:本模块独立落地,不动 claim/unstake/withdraw 已有代码
- **模块 0 stub 覆盖**:最后一步在 `containers/dialogs/openers.ts` 把 `openVaultDepositDialog` 替换成真实实现
- **UI 层已 props-driven**(Phase 1 产出):Container 只需按 Props 契约组装数据,不改 components 内部

## 回滚方案

- **独立分支 `feat/vault`** 已在使用;问题时可单独 revert Phase 2 commits
- **模块 0 stub 保留占位**:若 Phase 2 execute 失败,把 openers 指回 stub 版本(返回 `{ success: false }`)不阻塞其他模块
- **测试网真实签名在 verify 阶段跑**:sign failures 不影响 mainnet

## 错误处理策略(对齐 sodex-next 参考)

### 分层职责

| 层 | 错误职责 | 本模块落地 |
|---|---|---|
| Infra | 结构化原始异常 → `InfraError` | `infra/errors.ts` 已存在,deposit 直接 throw `InfraError` |
| Container | 转译 Infra/wagmi raw error → `DepositServiceError` kind + i18n + toast | `containers/handleDepositServiceError.ts` 新增 |
| UI | 仅展示 toast 文案,不处理错误 | VaultDepositDialog 不处理 |

(**注**:方案 F 不建 Service 层,转译逻辑上提到 Container。deposit 的 `mapInfraError` 若与 claim/unstake 的能复用则复用 `services/mapInfraError.ts`,不复用则在 Container 新增纯函数)

### `DepositServiceError` kind 枚举

| kind | 触发 | UI 文案(i18n) |
|---|---|---|
| `USER_REJECTED` | 钱包拒签(`isUserRejectedError`) | 不弹 toast,但激活 Try Again |
| `APPROVE_FAILED` | approve tx 失败 | `spot:transaction_failed_please_try_again` |
| `BRIDGE_FAILED` | bridge tx 失败 | `vault:base_chain_deposit_failed_please_try` |
| `BRIDGE_TIMEOUT` | pollBridgeSettle 15×5s 未入账 | warning,允许继续 |
| `AMOUNT_ZERO` | 输入金额 0 或超精度后为 0 | `vault:minimum_deposit_is_minamount_tokendisplayname` |
| `INSUFFICIENT_GAS` | Base ETH 不足 | `common:insufficient_gas_please_add_eth` (可能需新 i18n) |
| `NETWORK_ERROR` / `CHAIN_MISMATCH` | 网络切换失败/用户拒绝 | `common:network_switch_rejected` |
| `TRANSFER_FAILED` / `EVM_BALANCE_TIMEOUT` | smart-transfer 失败 | 复用 unstake 已有 |
| `PERMIT_FAILED` | EIP-712 签名失败(非用户拒签) | `spot:transaction_failed_please_try_again` |
| `CONFIRM_FAILED` | `permitConfirmPost` HTTP 或 receipt status=0 | 同上 |
| `ENABLE_TRADING_TIMEOUT` | 15×1s 等 user.id 超时 | `common:user_account_creation_timeout` (新 i18n) |
| `UNKNOWN` | 兜底 | `common:transaction_failed_error_message` |

### 重试策略(对齐 reducer RETRY 分支)

- **顶层**:`retry` 根据 `failedPhase` 回退到对应 phase(不 reset)
- **Base chain**:approve failed → `checking_allowance`;confirm failed → `approve_completed`(保留 txHash)
- **Value chain**:按 stepName + `approveDeadline > now` 决定是否复用签名
- **Try Again 按钮**:仅 `USER_REJECTED` 激活,3s 后自动隐藏(history 20251205)

## 交付物(本 spec 作为 plan/execute/verify 的执行合同)

- 3 个纯 reducer + `ServiceError` 类型 + typed-data builder → **domain/**
- 10 个原子 async(+1 个 `isUserRejectedError` 纯函数)→ **infra/chain/**
- Container 层:
  - `useVaultDepositMachine` (workflow driver)
  - `useSubmitVaultDeposit` (编排 mutation + notify + invalidate + enable_trading + smart-transfer)
  - `useVaultDepositForm` (RHF 表单 + 余额校验 + auto-fill 守卫)
  - `depositFlowLogic.ts` (纯派生:`deriveButtonState` / `decideNextStep` / `buildStepList` / `mapStepLabel`)
  - `handleDepositServiceError.ts` (i18n + toast)
- Component 层:已产出(Phase 1),本模块只做 `VaultDepositDialog/index.tsx` 内的数据注入

## Done 定义

- 5 层代码齐全;tsc + eslint + 4 条 ui-migration 红线全过
- testnet 两笔 tx(approve + deposit permit)归档到 `tx-hashes.md`
- signing-checklist + state-machine + acceptance 3 份归档
- 32 条规则消费清单(见 analyze)逐项实现或 defer(2 条 defer 已登记 pending.md)
- `migration-state.json` 标记 `finalize: completed`
