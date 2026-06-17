<!-- MIGRATION_SUMMARY_START -->
功能: vault-deposit
关键文件: sodex-web/src/pages/vault/components/modals/funding/deposit/** (主 index.tsx 861 行 + 3 个 _hooks 状态机 + AccountSelector/BaseAccountInput/VaultPreTradeButton 等)
API:
  - POST /spot/universal (spotUniversalApi) — transferAsset from Spot→EVM-Funding
  - POST /vault/call-for-permit (postCallForPermit,复用 claim infra) — EIP-712 Permit 提交
  - readContract SOSO_DEPOSIT_CONTRACT.getTransaction(BASE_CHAIN_IDENTIFIER, txHash) — Bridge 入账轮询
写操作: POST /spot/universal (type=transferAsset); POST /vault/call-for-permit; ERC20.approve; IBridge.bridge / bridgeNativeToken
状态管理: 老 MobX(user / vault / ui)→ 新 Zustand + React Query(Container hooks) + 纯 reducer(domain/depositStateMachine)
关联功能: claim (permit infra 复用), unstake (smart-transfer + mapInfraError 复用), withdraw (permit builder 结构复用), trade (useSubmitTransfer + useEvmBalancesQuery + enable_trading signMessage hook)
<!-- MIGRATION_SUMMARY_END -->

# 迁移分析: vault-deposit

## 功能摘要

vault-deposit 是 vault feature 最复杂模块,用户从 Base Chain 或 Value Chain 存入 MAG7/sMAG7 到 SLP Vault。
- **Base Chain 路径**: ERC20 approve → IBridge.bridge(toClob=true) → 合约轮询 getTransaction 确认入账 → [新用户:enable_trading 签名] → Value Chain Spot→EVM-Funding transfer → EIP-2612 permit 2 签名 → CallForPermit 提交 → 链上 receipt。
- **Value Chain 直存**: 仅 Value Chain 段(可选 Transfer + permit 2 签名)。

状态机已设计为 **方案 F**(见 interaction-spec §5):3 个纯 reducer(top/baseChain/valueChain) + 10 个原子 infra + Container 内 workflow hook 驱动;**不建 `services/vaultDepositService.ts`** 避免空壳。

## 关键文件

**老项目待迁(sodex-web/src/pages/vault/components/modals/funding/deposit/)**:
- `index.tsx` 861 行 → 将拆分为 `VaultDepositDialog/{index,Preview,Trading,...}`(Phase 1 已完成)
- `transaction/_hooks/useVaultDeposit.ts` 454 行(顶层 reducer + effect) → `domain/depositStateMachine.ts topReducer` + `containers/deposit/useVaultDepositMachine.ts` top driver
- `transaction/_hooks/useBaseChainDeposit.ts` 769 行(Base 子机) → `domain/depositStateMachine.ts baseChainReducer` + `infra/chain/vaultDepositInfra.ts` (checkAllowance/approve/bridge/waitReceipt/pollSettle) + driver
- `transaction/_hooks/useNewValueChainDeposit.tsx` 1060 行(Value 子机) → 同上 valueChainReducer + (transfer/permit approve/confirm build/confirm post/wait receipt)
- `transaction/_hooks/useNetworkSwitch.ts` → 不单独建,Container 直调 `useAddNetwork` 或 shared infra
- `transaction/useProcessOptions.tsx` 400 行(step label / icon) → Container `depositFlowLogic.ts` 纯派生 + Component 层 icon 映射

**老项目共享 hooks(deposit 自建自用,不提升 shared)**:
- `funding/_hooks/{useNonce, useMag7Balance, useCallForPermit, useDepositERC20WithPermit, useVaultDepositWithPermit}` → 接近 2-3 个已被 claim/unstake/withdraw 吸收;本模块新需 nonce/permit 相关**复用 claim infra**,不再重建。

**新项目已就绪基础设施(复用)**:
- `src/features/vault/infra/chain/vaultClaimInfra.ts` — `getClaimNonce` / `signCallForPermit` / `waitForClaimReceipt`
- `src/features/vault/infra/api/vaultApi.ts` — `postCallForPermit`
- `src/features/vault/domain/{claimPermit,unstakePermit,withdrawPermit}.ts` — typed-data builder 模板
- `src/features/vault/services/mapInfraError.ts` — 错误转译
- `src/features/trade/index.ts` — `useSubmitTransfer`(已导出,unstake/withdraw 已用)
- `src/shared/infra/notify` / `shared/components/ui/*`

## 关联功能(跨 feature 影响)

| 关联 | 方式 | 影响 |
|---|---|---|
| vault-claim | 复用 `vaultClaimInfra` 三件套 | 无修改 |
| vault-unstake | 参考 `smart-transfer + permit` 两层 mutation 模式(`useSubmitVaultUnstake`) | 无修改 |
| vault-withdraw | 参考 permit builder 结构 | 无修改 |
| trade (smart-transfer) | Container 调 `trade.useSubmitTransfer` | 无修改(已导出) |
| trade (enable_trading) | ⚠ Container 调 trade/login 的 signMessage hook | **待确认 trade 侧是否已暴露** |
| shared/queryKeys | `queryKeys.vault.{mag7Balance,investInfo,cooldown,activity,myActivity}` + `queryKeys.chain.evmBalances` | 新增 keys 时核对 unstake 已建,无新增 |

## 已知坑点

### sodex-next pitfall(gate)

| id | 严重度 | 对 deposit 的影响 |
|---|---|---|
| `vault-decimal-constants-semantics` | medium | Max 按钮 / 输入框用 `VAULT_DEFAULT_DECIMAL=4`(不是 `VAULT_DISPLAY_DECIMAL=2`)。BaseAccountInput / AccountSelector 两组件都要核对 |
| `slp-decimals-dynamic` | high | 本模块 **不涉及 SLP 合约读写**(deposit 以 vMAG7/vsMAG7 为主 token),不触发。但若未来加"deposit 折算 sMAG7.SLP 预览",必须动态读 SLP decimals |
| `theme-stroke-fill-via-cssvar` | low | icon/spinner 颜色通过 CSS var,不硬编码 stroke/fill |

### 跨迁移 records(kit 级)

| id | 对 deposit 的影响 |
|---|---|
| `chain-call:callForPermit-cmdType-to-address-mapping` | ⚠ deposit 的 permit `to` 不是 VaultCaller,而是 `VAULT_CALL_FOR_PERMIT_ADDRESS`(老项目 `useVaultDepositWithPermit` 里固定)。domain/depositPermit 要沿用。|
| `chain-call:token-decimals-dynamic-read` | Base Chain `erc20Decimals(coinAddr)` 动态读(老项目 useBaseChainDeposit.ts:378);Value Chain vMAG7/vsMAG7 固定 `MAG7_DECIMALS=8`(老项目已硬编码) |
| `structure:service-cross-feature-orchestration-via-container` | ⚠ **核心**:smart-transfer(trade.useSubmitTransfer)+ enable_trading(trade/login signMessage)+ CallForPermit 的跨 feature 编排**必须在 Container 层**。deposit 不建 Service,与此规则一致 |
| `structure:service-needs-domain-not-container-logic` | reducer/typed-data builder 归 domain;UI 派生放 containers/depositFlowLogic.ts |
| `structure:infra-cannot-import-domain` | infra 原子函数不 import domain,错误走 `infra/errors.ts`,decimals 硬编码 8 或参数传入 |
| `ui-progress:step-to-event-mapping` | ⚠ Trading 组件 step → 事件映射必须逐步标(approve/bridge/settle/transfer/permit approve/confirm sign/confirm post/wait receipt),不允许"中间 step 空转" |
| `ui-progress:modalManager-queue-not-stack` | interruptionModal(若需)走 modalManager 队列;若需要叠加(deposit 中弹 Privy modal)用 Radix `<Dialog>` 直接叠 |
| `ui-progress:defer-item-tracking` | Phase 1 handoff 遗留 5 条悬挂问题,本次标 implement/defer 逐条 |
| `ws:callForPermit-push-deferred` | 后端 WS push 未启用,deposit 成功通知走 invalidate + toast(与 claim/unstake/withdraw 一致) |
| `spec:permit-assumption-trap` | 已核查老项目确有 `useVaultDepositWithPermit`,permit 存在,与本 spec 对齐 |
| `plan:dependency-existence-check` | plan 阶段检查新增依赖:无需新库(wagmi / viem / dayjs / decimal.js / sonner 已装) |
| `structure:feature-vs-shared-const` | `MAG7_DECIMALS` / `VAULT_CALL_FOR_PERMIT_ADDRESS` / `VAULT_CALLER_ADDRESS` 业务语义进 `features/vault/domain/constants.ts`;`CONTRACTS_BY_FUNCTION`(协议事实)进 shared |

### 历史 defer 回补检查(pending.md)

- `vault-withdraw-cooldown-confirm` 已 **resolved**(2026-04-23),无需本期再处理。
- 本次 deposit 的 defer 条目见 §实现状态清单末尾。

## 写操作 Ground Truth

> deposit 路径含 4 类写操作。前 3 类老项目 infra 已 well-known(claim/unstake/withdraw 已迁),capture 不重复。第 4 类 `transferAsset` 走 trade.useSubmitTransfer,已在 unstake 跑过。**本 analyze 跳过 debug capture**(条件触发未命中:context doc <30 天,API 全在已迁路径)。

| API | 字段 | 类型/格式 | 示例 | 来源(老项目) |
|-----|------|-----------|--------|--------------|
| **ERC20.approve(bridge, amountRaw)** | spender=bridgeAddr | Address | `0x...` | CONTRACTS_BY_FUNCTION.BRIDGE.address |
| ERC20.approve | amountRaw | bigint | `parseUnits(amount, decimals)` | 动态读 `erc20Decimals(coinAddr)` |
| **IBridge.bridge(coinSymbol,to,amount,toClob)** | coinSymbol | string("MAG7.ssi"\|"sMAG7.ssi") | `baseChainConfig.coinSymbol` | 老项目 useBaseChainDeposit.ts:485 |
| IBridge.bridge | to | Address | user wallet address | |
| IBridge.bridge | amount | bigint | `parseUnits(amount, actualDecimals)` | |
| IBridge.bridge | toClob | bool | **恒 true**(history 20251107 统一) | |
| `IBridge.bridgeNativeToken(to,amount,toClob)` | — | — | 仅 SOSO 币种(本模块不走) | isSoso=true 分支 |
| **SOSO_DEPOSIT.getTransaction(chain,hash)** | chain | string | `"BASE_ETH"` | BASE_CHAIN_IDENTIFIER |
| SOSO_DEPOSIT.getTransaction | hash | string | bridgeTxHash | |
| 返回 `txHash` | string | 匹配输入 hash 判定成功 | |
| 返回 `status` | number | `1` 为成功 | |
| 返回 `chain` | string | 必须 "BASE_ETH"(case insensitive) | |
| **POST /spot/universal** | type | `"transferAsset"` | TransferAssetType.TRANSFER_ASSET_TYPE_EVM_WITHDRAW | |
| POST /spot/universal | params.coinID | number | `3`(MAG7) 或 `13`(sMAG7) | |
| POST /spot/universal | params.fromAccountID | number | `user.id` | |
| POST /spot/universal | params.toAccountID | number | `999`(EVM-Funding 固定) | |
| POST /spot/universal | params.amount | string | 去除尾 0 | `removeTrailingZeros` |
| POST /spot/universal | params.type | number | `TransferAssetType.TRANSFER_ASSET_TYPE_EVM_WITHDRAW` | |
| POST /spot/universal | signature | string(sparkSigner) | `signTransferAssetRequest(signParams)` | |
| POST /spot/universal | nonce | number | 同上 | |
| **approveForPermit EIP-712** | callForPermitAddress | Address | `VAULT_CALL_FOR_PERMIT_ADDRESS` | domain/constants |
| approveForPermit | vaultAddress | Address | `VAULT_CALLER_ADDRESS` | |
| approveForPermit | tokenAddress | Address | `VMAG7_TOKEN_ADDRESS` / `VSMAG7_TOKEN_ADDRESS`(随 isStake) | |
| approveForPermit | amount | bigint | `parseUnits(amount, MAG7_DECIMALS=8)` | 固定 8 位,非动态 |
| approveForPermit | chainId | number | `VALUE_CHAIN_NETWORK.id` | |
| **confirmPayload** | approveSignature + deadline | — | `Math.floor(Date.now()/1000) + 1800` | 30 min 过期 |
| **POST /vault/call-for-permit** | (同 claim/unstake postCallForPermit) | — | 复用 `infra/api/vaultApi.ts` | |

## Context 规则消费清单(**强制,基于 interaction-spec + history**)

> 基于 interaction-spec.md §1-§17(18 章节) 逐条消费。新增 defer 条目同步追加到 pending.md。

| # | 规则来源 | 规则内容 | UI 产物 | 实现状态 | followUp |
|---|---|---|---|---|---|
| 1 | guide §币种 / interaction-spec §1 | Base/Value Chain × MAG7/sMAG7 4 种映射,显示去 `v` 前缀 | TokenSelector 文案 / Trading 标题 | implement | — |
| 2 | guide §Stake | `isStake=true → MAG7 输入/sMAG7 输出` | reducer config.needsStake | implement | — |
| 3 | guide §toClob | Base→Value 桥接统一 `toClob=true` | infra.bridgeToValueChain 硬写 | implement | — |
| 4 | guide §账户选择 | Base 自动 Spot;Value 由用户选 Spot/EVM-Funding | AccountSelector.selectedAccountType + reducer config.needsTransfer 派生 | implement | — |
| 5 | interaction-spec §2 顶层 reducer | 6 state + 9 action + `config.{needsBaseChain,isNewUser}` | domain/depositStateMachine.topReducer | implement | — |
| 6 | interaction-spec §2 BaseChain reducer | 10 state(含 bridge_settling)+ RETRY 分 approve/confirm | baseChainReducer | implement | — |
| 7 | interaction-spec §2 ValueChain reducer | 9 state(含 transferring/staking 分支)+ RETRY 按 stepName 精确回退 | valueChainReducer | implement | — |
| 8 | guide §Bridge settle | SOSO_DEPOSIT.getTransaction 轮询 15×5s | infra.pollBridgeSettle | implement | — |
| 9 | history 20260205 | `isNewUser` 快照:execute 时锁到 config,reducer 不读 user store | Container execute 时传入 config,reducer 纯函数 | implement | — |
| 10 | history 20260205 | Enable Trading 等 `user.id` 15×1s 重试,超时抛 `ENABLE_TRADING_TIMEOUT` | useSubmitVaultDeposit 处理 | implement | — |
| 11 | history 20260306-①② | 流程中 4 个 auto-fill useEffect 需 `if (tradingStatus !== 'idle') return` 守卫;或 freeze 表单 snapshot | useVaultDepositForm 实现 | implement | — |
| 12 | history 20260306-① | 0 金额 `checkErc20Allowance` 抛 `AMOUNT_ZERO` | infra.checkErc20Allowance | implement | — |
| 13 | history 20250107 | `permitConfirmPost` 后必须 `waitValueReceipt(confirmations=3)` | infra.waitValueReceipt | implement | — |
| 14 | history 20251205 | Confirm 步骤 3 阶段文案(idle/processing/completed) | DepositToSodexStep 已拉 handoff(Phase 1) | implement | — |
| 15 | history 20251205 | Try Again 3 秒 setTimeout 自动隐藏 | Trading.showTryAgain + isRetrying | implement | — |
| 16 | interaction-spec §12 折叠面板 | 5 个面板(Must to Know + Sodex + Enable Trading + Vault×2) | VaultDepositDialog + Trading(Phase 1 已产 TradingPanelSlot) | implement | — |
| 17 | interaction-spec §15 失败 UI 颜色 | WarningIcon `#F1C21B` 黄(非 `#F19D38`) | WarningText 组件(Phase 1 已硬编码 + 注释) | implement | — |
| 18 | interaction-spec §15 | CollapsiblePanel failed 时 canToggle=false | Phase 1 Props 已含 `isFailed` | implement | — |
| 19 | interaction-spec §15 | Value Chain failed 同时显示 WarningIcon + spinner | Trading 组件处理(Phase 1 `showLoading && isFailed`) | implement | — |
| 20 | interaction-spec §14 13 toast | 全部 notify 在 Container 层(useSubmitVaultDeposit + 子 hook),service/reducer/infra 不 toast | Container 层 onMutate/onSuccess/onError | implement | — |
| 21 | interaction-spec §14.2 57 i18n keys | 4 namespace(common/vault/manual/spot),模板参数插值保留 | `public/locales/` 核对 | implement | 核对缺失 key 用 `/soso-translation-auto` 补 |
| 22 | interaction-spec §16.3 failedPhase 归属 | base/enable_trading/value 3 种 failedPhase 对应面板状态 | Trading 根据 topState.phase 分派 | implement | — |
| 23 | interaction-spec §17 Mobile 6 处 | signMessage / MobileIcon / i18n key / WalletConnect 扫码 | Container + Component 层处理 | implement | — |
| 24 | interaction-spec §17 Mobile Figma | Mobile 进行中/失败 Figma **未提供** | 依赖响应式 Shell 自动处理 + PC 进行中稿推断 | **defer** | **followUp:** `pending.md#vault-deposit-mobile-trading-figma`(设计补稿后回补) |
| 25 | interaction-spec §12 弹窗 interruptionModal | 钱包拒签触发 | Container 层;若新项目无全局 interruptionModal,降级为 toast | **defer** | **followUp:** `pending.md#vault-deposit-interruption-modal`(新项目 modalManager 是否建共享 InterruptionDialog,由模块 6 集成时统一裁) |
| 26 | interaction-spec §12 弹窗 PrivyCheckModal | Privy 集成 | 老项目有 PrivyCheckModal;新项目 VaultPreTradeButton 目前仅 connect_wallet / enable_deposit / switch_network / submit 4 态,无 privy | **skip** | 新项目架构不再用 Privy,走 wagmi + rainbowkit |
| 27 | interaction-spec §13 11 loading | Skeleton + 各 step spinner(`#FF7637`) + Try Again retrying | VaultDepositDialog 内联 Skeleton(Phase 1 已占位,待替换);Spinner 借 shared `<Spinner>` | implement | `#FF7637` 待补 token,临时 bracket 类 |
| 28 | guide §关键决策 #3 MetaMask 冲突 | approve 完成后 500ms 延迟 + bridge 智能重试(最多 3 次) | infra.approveErc20 与 infra.bridgeToValueChain 之间 Container driver 插 sleep(500) | implement | 重试不做(简化),单次失败即抛 |
| 29 | Phase 1 悬挂 #1 | VaultDepositDialog.inputArea slot(根据 chain 注入 BaseAccountInput / AccountSelector) | Container `useVaultDepositForm` 派生 + VM 注入 | implement | — |
| 30 | Phase 1 悬挂 #3 | VaultDepositSkeleton 真实版(Base/Value 两种结构) | shared 或 feature 内组件 | implement | — |
| 31 | Phase 1 悬挂 #4 | DepositToSodexStep SVG(CostIcon/WhitePaperIcon/SosoIcon) | 从 shared/components/ui/icons 找对应或降级 lucide | implement | — |
| 32 | Phase 1 悬挂 #5 | 所有 i18n 硬编码英文 → `useTranslation` 接入 | Component/Container 层 useTranslation | implement | — |

**defer 项**(本轮 analyze 新增 2 条,已登记下方 pending.md 追加段):

1. `vault-deposit-mobile-trading-figma`
2. `vault-deposit-interruption-modal`

## 字段溯源表

> Container/Service/Infra 各层字段源头。所有链上字段精确到 `合约地址 + ABI fn`。

| 展示/计算字段 | 源 | 类型 | 关键细节 |
|---|---|---|---|
| **链选择** selectedChain | 用户选 | form | "BASE_ETH" / "VALUE_CHAIN",默认按 token 推导 |
| **Token 选择** token | `useTokenConfig` (HTTP) → `allCoins` | api | 老项目 useFundingToken;新项目是否已建 useAllCoinsQuery 待核实 |
| **余额** Base chain MAG7/sMAG7 | 合约 `MAG7_ERC20.balanceOf(user)` / `SMAG7_ERC20.balanceOf(user)` on Base | chain | decimals 动态 `erc20Decimals(coinAddr)` |
| **余额** Value chain Spot vMAG7 | API `/user/account-balances`(spot namespace) | api | `coin="vMAG7.ssi"` filter,已在 trade.useEvmBalancesQuery |
| **余额** Value chain EVM-Funding vMAG7 | 合约 `VMAG7_ERC20.balanceOf(proxyAddress)` on Value Chain | chain | `proxyAddress = userToAccount(user)` 合约查 proxy,直传 user 拿到 0 |
| **余额** Value chain 合计 | 老项目 `useMag7Balance.valueChain.{mag7,sMag7}` | derived | Spot + EVM-Funding 合计,Container 层合成,复用 unstake 的 `useVaultMag7Balance` |
| **Max 显示** | 对应余额 + `VAULT_DEFAULT_DECIMAL=4` 格式化 | derived | **不用 VAULT_DISPLAY_DECIMAL** |
| **Min 最低充值** | 硬编码 5(MAG7.ssi) | const | 老项目 index.tsx `customMinimum=5`;是否后端下发待核 |
| **amount** | form input | form | decimal.js 校验,ROUND_DOWN 到 decimals 位 |
| **isStake** | token symbol 推导 | derived | `token.symbol ∈ {MAG7.ssi, vMAG7.ssi}` → true |
| **isNewUser** | `!user.id`(snapshot at execute) | derived | 见 pitfall history 20260205 |
| **needsBaseChain** | `selectedChain === 'BASE_ETH'` | derived | reducer config |
| **needsTransfer** | Base chain → 恒 true;Value chain → `from !== EVM_FUNDING` | derived | reducer config |
| **needsStake** | `isStake === true` | derived | reducer config(注:老项目 staking step 已注释,新项目也不做 stake step,但保留 reducer 节点) |
| **allowanceAmount** | 合约 `MAG7_ERC20.allowance(user, bridgeAddr)` on Base | chain | createErc20Allowance |
| **approveTxHash** | `sendTransactionCompatible({to:coinAddr, data:approve})` | chain | wagmi/actions |
| **bridgeTxHash** | `sendTransactionCompatible({to:bridgeAddr, data:bridge})` | chain | |
| **bridgeSettled** | `SOSO_DEPOSIT.getTransaction(BASE_CHAIN_IDENTIFIER, bridgeTxHash)` on Value Chain | chain | SOSO_DEPOSIT_CONTRACT_ADDRESS |
| **nonce (permit)** | `CALL_FOR_PERMIT.nonces(account)` on Value Chain | chain | 复用 `getClaimNonce(account)`(claim infra 已建) |
| **permitSignature** | EIP-712 `signTypedData` via wagmi | chain(wallet) | 复用 `signCallForPermit`(claim infra) |
| **confirmPayload** | `createConfirmPermitPayload({...params, prevSig})` | derived | domain/depositPermit builder |
| **txHash (confirm)** | `POST /vault/call-for-permit` 返回 | api | 复用 `postCallForPermit`(claim infra) |
| **receipt** | `valueChainClient.waitForTransactionReceipt(tx, confirmations=3)` | chain | 复用 `waitForClaimReceipt` |
| **signMessage** | trade/login hook | cross-feature | ⚠ 待确认 trade 侧暴露名 |

## 确认记录

- **入口文件**: sodex-web/src/pages/vault/components/modals/funding/deposit/index.tsx(已确认)
- **API**: 3 类写操作(Base chain tx + Value chain POST transfer + Value chain POST permit)+ 1 类合约读(getTransaction),全部位于已迁路径,跳过 debug capture
- **跨 feature 共享**: trade.useSubmitTransfer 已导出;**enable_trading 的 signMessage hook 未确认**,execute Step 前需核查 trade/login feature
- **依赖库**: wagmi / viem / decimal.js / sonner 均已装,无新增
- **defer 条目**: 2 条(Mobile Figma + interruptionModal),已登记 pending.md 追加段

### 触发器判断

| 触发器 | 命中? | 说明 |
|---|---|---|
| A 范围边界(≥2 关联功能共享核心文件) | ❌ | 无共享核心文件待迁 |
| B 数据偏差(capture vs context API 数不符) | N/A | 跳过 capture,基于 context 分析 |
| C 入口不确定(≥3 候选) | ❌ | 单入口明确 |
| D 旧逻辑模糊(无注释特殊逻辑) | ⚠ 但已在 history/interaction-spec 消化 | 对应的 history 20260205 / 20260306 / 20251205 / 20251219 已解释 isNewUser 快照/auto-fill 覆盖/try again 超时/retry 分支 |

**结论**: ✅ 分析清晰,无歧义,可进入 spec 阶段。
