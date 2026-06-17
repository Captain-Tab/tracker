# Migration Verify: vault-claim

> Spec: `.claude/kit/spec/vault-migration/02-claim.md`
> Plan: `.claude/kit/migration/logs/vault/claim/plan.md`
> 执行日期: 2026-04-22

---

## 自动检查

### 1. TypeScript 编译

```bash
pnpm tsc --noEmit
```

**结果**: ✅ 0 errors

### 2. ESLint

```bash
pnpm lint src/features/vault
```

**结果**: ✅ vault 模块 0 errors

(仓库内另有 1 个 `features/referrals/components/ReferralTables/index.tsx:367` 错误,与本次迁移无关)

### 3. `verify-arch.sh` 架构检查

```bash
bash .claude/kit/migration/scripts/verify-arch.sh src/features/vault
```

**结果**: 3/5 通过,2 项"命名不符" warning

**误报清单**(脚本规则与 CLAUDE.md §11 文件命名速查不同步):

| 文件 | 脚本规则 | CLAUDE.md 实际规则 | 判定 |
|---|---|---|---|
| `infra/chain/vaultInfra.ts` / `vaultClaimInfra.ts` | 应 `*Api.ts` 或 `*Rpc.ts` | `xxxInfra.ts` 是 Infra RPC 合法命名 | 脚本过严 |
| `containers/useSubmitVaultClaim.ts` | 应 `use*Query.ts` 或 `use*ViewModel.ts` | `useSubmitXxx.ts` 是 Container Mutation 合法命名 | 脚本过严 |
| `containers/useVaultClaimForm.ts` / `useVaultCooldown.ts` / `useVaultMag7Balance.ts` | 同上 | Container Stream / Query hook 合法命名 | 脚本过严 |
| `containers/claimFlowLogic.ts` / `vaultTabsLogic.ts` / `vaultStatsLogic.ts` | 同上 | Container Logic `xxxLogic.ts` 合法命名 | 脚本过严 |
| `containers/handleClaimServiceError.ts` | 同上 | Container Error `handleServiceError.ts` 合法命名 | 脚本过严 |
| `containers/dialogs/openers.ts` | 同上 | Dialog opener 聚合文件,项目现有约定 | 脚本过严 |

**真正的小偏差**(CLAUDE.md §11 未显式允许,但没明显更好的归属):

| 文件 | CLAUDE.md 允许 | 实际情况 | 建议 |
|---|---|---|---|
| `domain/claimPermit.ts` | `types.ts` / `validation.ts` / `normalize.ts` | EIP-712 typed data + build 纯函数。业务类型混 normalize | 可改名 `normalize/permit.ts` 符合"normalize 拆分"规则;或保留名字(更贴近业务语义) |
| `domain/symbols.ts` | 同上 | 纯函数 `standardizeMag7Symbol`。纯字符串转换,无 DTO↔domain normalize 性质 | 可放 `shared/utils/symbols.ts`(但目前只 vault 用);或合并进 normalize |
| `domain/constants.ts` | 同上 | 业务常量。CLAUDE.md 未明列 | 保留:boundaries 规则要求 feature 子目录下才是有效 elementType,没有更好位置 |

**决策**: 暂不改命名(待上游推动 verify-arch.sh 规则和 CLAUDE.md §11 对齐,或批量重构)。3 个 domain 文件的归属在 `records/layering.md` 已有相关讨论(structure:feature-vs-shared-const)。

### 4. CHK-A 专项

| # | 项 | 结果 |
|---|---|---|
| CHK-A1 Import 方向 | ✅ UI 不 import services/infra,只 import container hooks + shared/ui |
| CHK-A2 旧代码残留 | ✅ 未 import 老 MobX Store;使用 React Query invalidate 替代 eventBus |
| CHK-A3 normalize 位置 | ✅ claim 无 DTO→Domain 转换(仅 Command 写入);buildPermitTypedData 在 domain/claimPermit.ts 属构造函数,不是 normalize |
| CHK-A4 文件命名 | ⚠️ 见上方误报 + 真实偏差 |
| CHK-A5 导出合规 | ✅ feature `index.ts` 未导出 dialog(走 viewmodel 内部封装) |

---

## 手动验收 Checklist(待用户执行)

### UI 层

- [ ] Figma(Withdraw 样式参考)对照 PC + Mobile
- [ ] 按钮 4 态全覆盖:
  - [ ] 未连钱包 → "Connect Wallet"
  - [ ] 已连但未 enable trading → "Enable Claim"
  - [ ] 已连 + 金额违规(空/低于 4/超过 max) → "Claim" disabled + helper text
  - [ ] 已连 + 合法金额 → "Claim" 可点
  - [ ] 提交中 → loading

### Golden Path

- [ ] 钱包已连 → 余额 > 0 可 claim → 输入合法金额 → Claim → 钱包弹签名 → 签名成功 → **loading toast 出现**("Claiming X MAG7.ssi...") → 等 ~3 confirmations → **success toast**("X MAG7.ssi claim submitted") → 弹窗关闭 → SLP 块余额/cooldown 刷新

### 边界

- [ ] Min: 输入 < 4 禁用 + helper text 显示 "Minimum 4"
- [ ] Max: 超过 `withdrawable` 禁用 + helper text 显示 "Maximum X.XXXX"
- [ ] `withdrawable === "0"`: Amount 输入整体 disabled + placeholder 保持
- [ ] 精度:小数位 > 8(VAULT_TOKEN_DECIMAL)的输入被拦截

### 异常

- [ ] Enable Claim 拒签 → 按钮从 loading 恢复,无 toast(静默)
- [ ] Claim permit 拒签 → loading toast dismiss,无 error toast(USER_REJECTED 静默),弹窗不关
- [ ] Tx 超时 / receipt status !== success → error toast(`Claim failed: ...`),弹窗不关,可重试
- [ ] 网络断 → `NETWORK_ERROR` toast(`Network error, please check your connection`)
- [ ] 链不对 → `CHAIN_MISMATCH` toast(`Wrong network, please switch to chain 286623`)

### Testnet 真实验证

- [ ] **testnet tx hash ≥ 1**(必需产物,写入 `tx-hashes.md`)
  - 前置:有已完成 unstake cooldown 的 sMAG7 头寸
  - 步骤:走 Golden Path,记录最终 `txHash`

### 回归

- [ ] 模块 0/1(foundation/page)未 break:VaultPage 打开正常 / TVL / cooldown 显示正确
- [ ] `features/trade` 的 withdraw 流程未 break(因修了 trade/index.ts 导出 useEnableTrading;permit infra 未改)

---

## 本次 execute 发现的问题汇总

参见 `records-candidates.md`(同目录),供 `/k:migration finalize` 阶段做三层分流。

---

## 状态

- 自动检查: **通过**(命名 warning 为脚本过严,不 block)
- 手动验收: **待用户执行**
- Testnet tx: **待用户提供**
- 下一步: 用户完成手动验收后运行 `/k:migration finalize vault-claim`
