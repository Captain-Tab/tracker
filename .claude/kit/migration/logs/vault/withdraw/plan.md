# Migration Plan: vault-withdraw

> Spec: `.claude/kit/spec/vault-migration/04-withdraw.md`
> 目标架构: sodex-next 5 层
> 生成: 2026-04-22 by `/k:migration plan vault-withdraw`

---

## 前置匹配

- Pitfall gates / Reusable match: 无命中(同 claim/unstake)
- 类型先行: 已加载(`plan-type-first.md` 有 DTO/Domain 类型变更)
- **关键方法论坑**:`records/layering.md` 已录
  - `structure:service-cross-feature-orchestration-via-container`(withdraw 不涉及,本模块无跨 feature 编排)
  - `structure:service-needs-domain-not-container-logic`(build* 函数进 domain,不放 containers/logic)
  - `structure:infra-cannot-import-domain`(infra 硬编码 decimals=8 规避)

---

## 依赖 & 前置

已就绪(前面模块产出):
- claim 的 `infra/chain/vaultClaimInfra.ts`(CallForPermit 三件套,同 feature 内复用)
- claim 的 `infra/api/vaultApi.ts postCallForPermit`
- claim 的 `infra/errors.ts`
- unstake 的 `domain/unstakePermit.ts`(结构模板,withdraw 复制一份)
- `useVaultMag7Balance`(返回 valueChain.{sMag7, mag7})
- `shared/ui/Menu` 或 `Dropdown`(做 TokenSelector)
- trade `useSubmitTransfer`(已导出,withdraw 不需要但保留引用点备用)

---

## ⚠️ 未解决的业务风险(execute 必做核对)

老项目 `withdraw/transaction/useProcessOptions.tsx:61-62`:

```ts
const [inCoinSymbol, outCoinSymbol] = ["sMAG7", "MAG7"] as ...;
```

**硬编码**,第三步注释说"Unstake sMAG7.ssi to MAG7.ssi"。疑似 withdraw 是**多步 Trading flow**(可能含 redeemShares + unstake 两步),不是单 CallForPermit。

**Execute Step 1 强制先对照**:完整读 `withdraw/transaction/{Trading.tsx, useProcessOptions.tsx}` + `useProxyAndCooldown` + `usePreviewRedeem`,搞清:

1. MAG7 withdraw 完整 step 序列(是否含 redeemShares / previewRedeem / permit / 其他?)
2. sMAG7 withdraw 完整 step 序列(可能与 MAG7 不同)
3. 每步对应的签名类型 / HTTP / 链上调用
4. 是否需要 transaction/Trading 级别的多步 UI(step indicator / progressive state)

核对结果会影响下面 Step 3(Service)的设计——如果 withdraw 实际是多步 flow,service 要分多个函数 + container 层做编排(类似 unstake 的 smart-transfer 模式)。

**先不拍死实现**,待 execute Step 1 完整读完老项目后再定 Service 形态。下列 Step 2-12 基于"单 CallForPermit 简化版"假设,**execute 发现多步则按 unstake 模式扩展**。

---

## 步骤拆分(分层顺序 + 单一 CallForPermit 假设)

### Step 0: 类型 & 常量

| 文件 | 操作 |
|---|---|
| `domain/constants.ts` | 追加 `WITHDRAW_CALL_FOR_TYPE = 1`(若 execute 确认与 unstake 同值,复用 `UNSTAKE_CALL_FOR_TYPE`) |
| `domain/types.ts` | 追加 `WithdrawInput = { token: "MAG7" \| "sMAG7"; amount: string }` / `WithdrawResult` |

### Step 1 ⚠️ 强制:读老项目 withdraw Trading flow

读 `withdraw/transaction/{Trading.tsx, useProcessOptions.tsx}` + 相关 hooks,列出:

- MAG7 flow 的所有 step(签名/HTTP/链上调用,顺序)
- sMAG7 flow 的所有 step
- 两者差异点

产出:`logs/vault/withdraw/analyze-flow.md`(5-15 行摘要,不用 verbose)。根据结果决定 Step 3 Service 形态。

### Step 2: Domain withdrawPermit.ts

**若 Step 1 确认单 CallForPermit**:复制 `unstakePermit.ts`,改 `buildWithdrawCmd` 按 token 决定 inCoinSymbol/outCoinSymbol。

**若多步**:按 step 拆 `buildXxxCmd` 函数,每个 step 对应一个 cmd。

```ts
export function buildWithdrawCmd(input: WithdrawInput): BridgeCallForCmd
```

### Step 3: Services

**单步假设**:`services/vaultWithdrawService.ts`

```ts
export async function executeWithdrawPermit(
  input: WithdrawInput & { account: Address },
): Promise<WithdrawResult>
```

流程同 unstake:nonce → buildCmd → typedData → sign → post → waitReceipt。

**多步假设**:拆多个 service 函数,container 层编排(同 unstake 的 smart-transfer 模式)。

### Step 4-7: Containers

- `withdrawFlowLogic.ts`(derive*/is* 纯函数,与 unstake 结构同)
- `useVaultWithdrawForm.ts` — **差异**:多一个 `token: "MAG7" | "sMAG7"` 选择 state + `onTokenChange` action;`max` 按 token 动态切换
- `useSubmitVaultWithdraw.ts` — mutation 三段 notify + invalidate 3 key
- `handleWithdrawServiceError.ts` — VaultServiceError → toast

### Step 8: UI 子组件 + 主弹窗

- `components/dialogs/VaultWithdrawDialog/WithdrawTokenSelector.tsx` — 基于 `shared/ui/Menu`(之前 Depositors 排序用过),选项 MAG7/sMAG7,值由 form state 控制
- `components/dialogs/VaultWithdrawDialog/VaultWithdrawButton.tsx`(4 态,复制 unstake)
- `components/dialogs/VaultWithdrawDialog/VaultWithdrawSkeleton.tsx`
- `components/dialogs/VaultWithdrawDialog/index.tsx` + `openVaultWithdrawDialog`

UI 字段差异按 token:
- MAG7 模式:无 WarningAlert,`Amount (MAG7.ssi)`,Max 来自 `valueChain.mag7`
- sMAG7 模式:按 Figma 8246-83518 补齐(execute 阶段用 `/k:figma` 拿设计稿),Max 来自 `valueChain.sMag7`

### Step 9: Dialog stub 覆盖

`containers/dialogs/openers.ts` re-export。

### Step 10: 跨 feature 检查

无新增(useSubmitTransfer 已在 unstake 阶段导出,withdraw 无 smart-transfer)。

### Step 11: ViewModel / mock 接线

确认 `useVaultSLPViewModel` 和 `mock.ts` 里的 withdraw opener 调用无参(同 claim/unstake pattern)。如果目前这两处 stub 调用还传 undefined,改无参。

### Step 12: 产物归档

- `signing-checklist.md` — 两种 token 的 cmd 参数逐字段对照(inCoinSymbol/outCoinSymbol 差异)
- `tx-hashes.md` — testnet MAG7 + sMAG7 各 1 笔

---

## 新旧文件映射

| 老(sodex-web) | 新(sodex-next-feature) |
|---|---|
| `withdraw/index.tsx` | `components/dialogs/VaultWithdrawDialog/index.tsx` |
| `withdraw/VaultWithdrawButton.tsx` | `components/dialogs/VaultWithdrawDialog/VaultWithdrawButton.tsx` |
| `withdraw/schema.ts` | 合并到 `useVaultWithdrawForm.ts`(useState + 纯函数校验) |
| `withdraw/Confirm.tsx` | **不迁移**(若 UI 无确认二级弹窗需求,spec Q1-B 决策统一到主弹窗内;若 execute 发现必需,独立建一个) |
| `withdraw/transaction/Trading.tsx` | **视 execute Step 1 结论**:若是多步 UI 则需要某种 step 组件;若只是展示 pending 状态,用 VaultWithdrawButton.loading 态代替 |
| `withdraw/transaction/useProcessOptions.tsx` | 拆到 `services/vaultWithdrawService.ts`(每个 step 对应一个函数或合并成单函数) |
| `_components/TokenSelector.tsx` | `VaultWithdrawDialog/WithdrawTokenSelector.tsx`(本模块用,不进 shared) |

---

## 架构检查(CHK-A)

| 项 | 处理 |
|---|---|
| CHK-A1 Import 方向 | UI 不 import service/infra,沿用 claim/unstake pattern |
| CHK-A2 旧代码残留 | 不 import MobX store |
| CHK-A3 normalize | 本模块无 DTO→Domain 转换;`buildWithdrawCmd` 为构造函数不算 normalize |
| CHK-A4 文件命名 | 同 claim/unstake,已知有脚本误报 |
| CHK-A5 导出合规 | feature index.ts 不 export |

---

## 风险 & 兜底

| 风险 | 触发 | 兜底 |
|---|---|---|
| ⚠️ **withdraw 实际是多步 flow** | execute Step 1 读老 Trading 发现 | 按 unstake 的 smart-transfer mode 扩展,container 层两层+ mutation |
| MAG7/sMAG7 的 cmd 参数不同 | Step 1 读老项目 | buildWithdrawCmd 按 token 分支;execute 对照写字段 |
| MAG7 模式可能根本不需要 CallForPermit(只是 redeemShares 直接合约调用) | Step 1 核对 | 若为真,service 里按 token 分流:MAG7 走 writeContract,sMAG7 走 permit |
| TokenSelector 的 UI 响应(切换触发 form reset / max 重算) | form hook 实现 | useVaultWithdrawForm 暴露 `onTokenChange` 同时 reset amount |

---

## Next Step

用户确认后进入 `/k:migration execute vault-withdraw`。execute 第一步**先读老项目 withdraw 的 Trading flow**,再按实际结构选择 Service 形态(单步 vs 多步)。
