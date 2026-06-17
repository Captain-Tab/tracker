---
id: vault-deposit-migration-2026-04-23
tags: [vault, deposit, workflow-hook, state-machine, permit, cross-chain, migration]
related_feature: vault-deposit
severity: info
date: 2026-04-23
source: sodex-web → sodex-next 模块 5
---

# vault-deposit 迁移归档(2026-04-23)

## 本次变更

完整落地模块 5 vault-deposit,采用 **方案 F Workflow Hook Pattern** 架构(不建 Service 层壳)。

### 迁移背景

- 本模块是 vault feature 最复杂部分:Base Chain 桥接 + EIP-2612 permit + CallForPermit + 跨链状态机 + 新用户 Enable Trading 分支
- 老项目 3 层嵌套 hook 状态机(useVaultDeposit 顶层 454 行 + useBaseChainDeposit 769 行 + useNewValueChainDeposit 1060 行),副作用混在 hook 里
- 前序模块 2/3/4(claim/unstake/withdraw)已稳定 CallForPermit 三件套 + mapInfraError + smart-transfer 模式,本模块在此基础上叠加

### 架构决策(区别前序模块)

**方案 F: Workflow 作为 Container 级概念,不建 `services/vaultDepositService.ts`**

原因:
- vault-deposit 的 workflow 绑定 React 生命周期(StrictMode 防抖 / unmount 检测 / 实时进度推送 / AbortController / ref cache)
- 如果拆出 Service,它只会是"executor 分发器空壳",不做真实编排
- 保留 domain/infra 纯函数 + 原子合规,Container 内部承担 workflow 编排

对比 claim/unstake/withdraw 的"一次性 permit service":
| 模块 | 状态机层级 | Service 形态 |
|---|---|---|
| 2 claim | 1 步 | 真 Command Service `executeClaimPermit` |
| 3 unstake | 1 步 + smart-transfer | Service + Container 两层 mutation |
| 4 withdraw | 2 步(redeem + unstake) | Service 承接两步 |
| **5 deposit** | **3+ 阶段多状态机** | **不建 Service,Container workflow hook 承载** |

### 产出清单

**新文件**(9):
- `domain/depositPermit.ts`(307 行)— EIP-2612 + CallForPermit(VaultDepositWithPermit2) typed-data builder + isUserRejectedError
- `domain/depositStateMachine.ts`(518 行)— 3 个纯 reducer(top / baseChain / valueChain)+ config 类型
- `infra/chain/vaultDepositInfra.ts`(543 行)— 10 个原子 async(Base approve/bridge/settle + Value permit 链)
- `containers/deposit/useVaultDepositMachine.ts`(720 行)— reducer + effect driver + 防重入 + cache refs
- `containers/useSubmitVaultDeposit.ts`(229 行)— mutation 外层编排
- `containers/useVaultDepositForm.ts`(166 行)— 表单 + Max + auto-fill 守卫
- `containers/depositFlowLogic.ts`(354 行)— 纯派生(decideConfig / mapStepStatus / buildStepList / deriveButtonState / validateDepositAmount)
- `containers/handleDepositServiceError.ts`(119 行)— kind → i18n notify
- `.claude/kit/migration/logs/vault/deposit/{interaction-spec,style-diff,figma-nodes.json,analyze,migration-spec,plan,signing-checklist,state-machine,acceptance}.md`

**修改文件**(5):
- `domain/constants.ts` — +15 条 DEPOSIT_* 常量
- `domain/types.ts` — +DepositInput/Result/Chain/From/TokenRef + 9 个 ServiceError kind
- `infra/errors.ts` — +USER_REJECTED / SIGN_FAILED
- `infra/api/vaultApi.ts` — CallForPermitRequest.cmdType 增加 `VaultDepositWithPermit2`
- `components/dialogs/VaultDepositDialog/index.tsx` — 新增 VaultDepositDialogContainer wrapper,openVaultDepositDialog 签名简化为 `{tokenAddress?: string}`
- `containers/dialogs/openers.ts` — stub 替换为真实 re-export

### 跨 feature 连线

- `trade.useSubmitTransfer` — smart-transfer Spot → EVM-Funding(Value chain 直存补差额)
- `trade.useEnableTrading` — 新用户 `isNewUser=true` 分支,Container 通过 callback 注入
- `trade.useEvmBalancesQuery` — smart-transfer 决策依赖

### 关键坑(本次 execute 过程中出现 + 解决)

1. **`postCallForPermit` cmdType 类型不兼容**:infra/api/vaultApi.ts 原 CallForPermitRequest 只接受 `CreateBridgeCallFor | VaultRedeemWithPermit`,本模块必须加 `VaultDepositWithPermit2`
2. **reducer switch exhaustive check**:TypeScript strict 下 reducer `switch(state.kind)` 必须覆盖所有状态,`bridging` / `staking` / `stake_confirming` 等"过渡但不期待 action"状态需显式 `return state`;driver 的 switch 也需显式处理 `idle/completed/failed` 不 run 副作用的分支
3. **useRef strict 参数**:TS 5 要求 `useRef<T>()` 提供初始值,改用 `useRef<T | undefined>(undefined)`
4. **ModalInjectedProps 泛型不匹配**:`ModalInjectedProps<void>` 和无参 `ModalInjectedProps` 的 resolve 类型不兼容(`(value: void) => void` vs `(value: unknown) => void`);Container props 用无参版本,opener 的 openResponsive 泛型通过 `as unknown as` 转换
5. **openVaultDepositDialog 签名变更**:Phase 1 stubs 以 `undefined` 调用,本期改为 `{tokenAddress?}` 接收,所有已有 call 点(mock / slp-vm 等)自动兼容(参数可省)

### 未竟工(交给模块 6 integration)

UI 层数据 fine-tune:
- `feesDisplay / youReceiveDisplay / rateDisplay / buttonText` 当前占位,待接入 NAV / 费率派生 + i18n
- Token 选择器点击回调 TODO
- Base chain 余额占位(需 useBalance wire-up)
- Must to Know 展开 state 未实装
- Get MAG7 / Help 外链 TODO

i18n:57 个 key 当前硬编码英文,待 `useTranslation` 接入(可用 `/soso-translation-auto`)。

Defer 项(登记 pending.md):
- `vault-deposit-mobile-trading-figma` — Mobile trading Figma 缺稿
- `vault-deposit-interruption-modal` — 全局拒签 modal 模式(新项目暂无)

### 验证

- `npx tsc --noEmit` 0 errors
- `npx eslint` 0 errors on vault-deposit 9 新文件
- 方案 F 5 条硬约束全过:不建 Service / 不用 AsyncGenerator / reducer 无 react / infra 无 toast / Container 不 import store
- testnet tx 两笔真实签名 — **defer 到手动 QA**(非代码阻塞)

### 与前序模块差异(设计决策备忘)

1. **Service 层**:claim/unstake/withdraw 有 `services/vault*Service.ts`,deposit 不建(方案 F)
2. **mutation 模式**:unstake/withdraw 是两层 mutation(smart-transfer + 主流程);deposit 是 workflow hook + 外层 mutation(machine 状态机承接多步骤)
3. **cmdType**:claim/unstake = CreateBridgeCallFor;withdraw = VaultRedeemWithPermit;deposit = VaultDepositWithPermit2
4. **wait confirmations**:claim/unstake/withdraw 3 confirmations;deposit Base 阶段 2(快)+ Value 阶段 3(最终)

### 回归影响

- 前序模块(0-4)签名流不动,共享 `signCallForPermit` / `postCallForPermit` / `mapInfraError` 均兼容扩展
- `features/vault/index.ts` 公共 API 无新增 export(dialog opener 走 shared `containers/dialogs/openers.ts`)
- `migration-state.json` 记录本次 execute/verify,`deferItems` 2 条

### 参考

- spec: `.claude/kit/spec/vault-migration/05-deposit.md` + 05a/05b/05c
- Phase 0: `logs/vault/deposit/{interaction-spec,style-diff,figma-nodes.json}.md`
- Phase 1(UI): `logs/vault/deposit/ui-migration-summary.md`(9 组件 handoff)
- Phase 2(逻辑): `logs/vault/deposit/{analyze,migration-spec,plan,signing-checklist,state-machine,acceptance}.md`
