# Records Candidates: vault-claim

> 本次迁移发现的问题集合,`/k:migration finalize` 阶段由用户逐条分流到 history / records / pitfall。

## 候选条目

### 候选 #1: clarify 回溯修正 claim permit 误判

- **问题摘要**: 02-claim.md 首版按"claim 最简单、无 permit"假设写,但老项目实际用 `useCallForPermit.createBridgeCallFor` → 签名 + HTTP POST,全链路有 permit 签名。clarify Q3 修正为"保留 permit"
- **发生阶段**: spec → plan
- **相关文件**: `.claude/kit/spec/vault-migration/02-claim.md`
- **修复**: spec 改写 + plan Step 1-3 按 permit 实现 + 加"背景决策"段标注修正
- **AI 推荐分流**: **records(新增条目)**
- **推荐理由**: 所有 callForPermit 类模块(unstake/withdraw/deposit)首版 spec 都可能犯相同错误——"看起来简单就去 permit"。属跨 migration 方法论坑
- **建议 id**: `spec:permit-assumption-trap`
- **建议 category**: `spec.md`(新分类)或归入 `api-contract.md`

### 候选 #2: trade feature 的 `useEnableTrading` 未在 index.ts 导出

- **问题摘要**: plan 风险清单提醒要查 `trade/index.ts` 是否导出 `useEnableTrading`,实测未导出。vault claim 跨 feature import 前必须先补导出
- **发生阶段**: execute 批次 B
- **相关文件**: `features/trade/index.ts`
- **修复**: 追加 `export { useEnableTrading } from "./containers/useEnableTrading";`
- **AI 推荐分流**: **history only**
- **推荐理由**: 具体 feature 的 index.ts 导出状态,下次其他模块跨 import 时查一下就行,不是通用坑

### 候选 #3: react-hook-form + zod 不存在导致 plan 改路径

- **问题摘要**: plan.md 写明 `useVaultClaimForm` 用 react-hook-form + zod,execute 时发现项目未安装,降级为 useState + claimFlowLogic 纯函数组合
- **发生阶段**: execute 批次 A
- **相关文件**: `features/vault/containers/useVaultClaimForm.ts`
- **AI 推荐分流**: **records(新增条目)**
- **推荐理由**: plan 阶段写实现时要**先验证项目依赖是否存在**,不能假设依赖已装。下次 plan 其他模块也会碰到同类情况
- **建议 id**: `plan:dependency-existence-check`
- **建议 category**: `api-contract.md` 或新建 `plan.md`

### 候选 #4: ESLint boundaries 规则限制 feature 根文件位置

- **问题摘要**: execute 初版把 claim 常量放 `features/vault/constants.ts`(feature 根);ESLint boundaries `checkUnknownLocals` 报"unknown elementType"。必须搬到 `features/vault/domain/constants.ts` 才能通过
- **发生阶段**: execute 批次 C(重构)
- **相关文件**: `features/vault/domain/constants.ts`(最终位置)
- **AI 推荐分流**: **已入 records**
- **推荐理由**: `records/layering.md` 的 `structure:feature-vs-shared-const` 已涵盖分层决策(业务语义入 `features/<X>/constants.ts`),但没提到"feature 根文件会被 boundaries 标 unknown"。可以**追加到现有 layering.md** 补充

### 候选 #5: Infra/Service 和 Domain 的双向 import 限制

- **问题摘要**: execute 初版 `infra/chain/vaultClaimInfra.ts` import `domain/types` 的 `CallForPermitTypedData` / `VaultInfraError`;被 boundaries 拦(infra 禁 import domain)。必须用本地泛型替代,error 类型搬到 `infra/errors.ts`
- **发生阶段**: execute 批次 C
- **相关文件**: `features/vault/infra/errors.ts`(新建),`features/vault/infra/chain/vaultClaimInfra.ts`(改本地类型)
- **AI 推荐分流**: **records(新增条目)**
- **推荐理由**: 写 infra 层时 AI 很容易把 domain 类型直接 import(看起来更 DRY),但分层规则禁止。属跨 migration 通用
- **建议 id**: `structure:infra-cannot-import-domain`
- **建议 category**: `layering.md`(追加段落)

### 候选 #6: Services 不能 import Containers(build\* 纯函数下沉)

- **问题摘要**: execute 初版 `services/vaultClaimService.ts` import `containers/claimFlowLogic.ts` 的 `buildPermitTypedData` / `buildClaimCmd`;被 boundaries 拦(services 禁 import containers)。必须把 build\* 纯函数从 containers 搬到 domain/claimPermit.ts
- **发生阶段**: execute 批次 C
- **相关文件**: `features/vault/domain/claimPermit.ts`(接收从 containers 搬来的函数)
- **AI 推荐分流**: **records(新增条目)**
- **推荐理由**: 纯函数放 containers/xxxLogic.ts 是 CLAUDE.md §6 允许的,但如果 service 也要调,就得下沉到 domain。AI 容易把所有纯函数都丢进 containers 图省事
- **建议 id**: `structure:service-needs-domain-not-container-logic`
- **建议 category**: `layering.md`(追加段落)

### 候选 #7: Dialog opener 与 stub 的双重导出

- **问题摘要**: `containers/dialogs/openers.ts` 有 `openVaultClaimDialog` 的 stub;execute 时需要改成 `re-export` 真实实现。外部 ViewModel 签名从 `(input: unknown) => Promise<never>` 变 `() => Promise<ClaimResult>`,两处调用点(`useVaultSLPViewModel` / `VaultStats/mock.ts`)也要同步改
- **发生阶段**: execute 批次 B
- **相关文件**: `containers/dialogs/openers.ts` / `useVaultSLPViewModel.ts` / `VaultStats/mock.ts`
- **AI 推荐分流**: **history only**
- **推荐理由**: 模块 0 scaffold 的 stub 设计本就预期被 execute 覆盖,记在 history 够;各 stub 模块都会碰到同样动作,不是坑

### 候选 #8: sodex_call_for WS push 未启用(已入 records)

- **问题摘要**: /k:debug 插桩实测 explorer WS `sodex_call_for` channel 在 claim 场景无 handler 回调(WS 连接健康,仅此 type 后端未推)。与 `trade/containers/useDepositNotice.ts:17-18` "deferred" 注释印证
- **发生阶段**: clarify 延伸 + execute 中途验证
- **相关文件**: `kit/migration/records/ws.md`
- **AI 推荐分流**: **已入 records**(本次直接添加,不需在 finalize 重复)
- **推荐理由**: 已走 records add 流程

---

## 分流汇总建议

| 去向 | 条目 |
|---|---|
| **records(新增)** | #1 spec:permit-assumption-trap<br>#3 plan:dependency-existence-check<br>#5 structure:infra-cannot-import-domain(可合并进 layering.md)<br>#6 structure:service-needs-domain-not-container-logic(可合并进 layering.md) |
| **records(追加到现有)** | #4 layering.md 追加 "feature 根文件 boundaries 警告"段落 |
| **已入 records** | #8(ws:callForPermit-push-deferred,不重复) |
| **history only** | #2 trade index.ts 导出,#7 Dialog opener stub 覆盖 |
| **pitfall(项目通用)** | 本次无 |

---

## 下一步

用户完成手动验收(见 `verify.md`)+ testnet tx ≥ 1 后,运行 `/k:migration finalize vault-claim`。finalize 阶段读取本文件,对每条 candidate 逐条确认分流动作。
