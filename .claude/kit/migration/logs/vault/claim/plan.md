# Migration Plan: vault-claim

> Spec 源:`.claude/kit/spec/vault-migration/02-claim.md`
> 目标架构:sodex-next 5 层(Infra / Domain / Service / Container / UI)+ Dialog opener
> 生成:2026-04-22 by `/k:migration plan vault-claim`

---

## 前置匹配结果

| 项 | 结果 |
|---|---|
| Pitfall gates(tag: claim/vault/permit/dialog/bridge/cooldown/queryKey) | **无命中**(sodex-next 尚未录入相关 pitfall) |
| Reusable match(tag: claim/vault/dialog/permit/bridge/mutation) | **无命中**(reusable 库未建 vault 条目) |
| Migration records(kit 级) | 索引目前在 soso-kit 仓,本仓同步后可复用 |
| 类型先行模板 | **已加载**(涉及 ClaimInput/ClaimResult/ClaimableInfo + EIP-712 typed data 新类型) |

**结论**:本模块无已知坑点模式干扰,走常规分层迁移;但要特别留意 clarify 回溯的"permit 误判"(Q3),避免再度简化。

---

## 依赖 & 前置

已就绪(模块 0/1 产出):
- `features/vault/containers/shared/useVaultMag7Balance.ts`(已实现)
- `features/vault/containers/shared/useVaultCooldown.ts`(已实现,返回 `{ withdrawable, processing, cooldownEndTimestamp }`)
- `features/vault/containers/dialogs/openers.ts`(stub 存在,需覆盖 `openVaultClaimDialog`)
- `shared/queryKeys/index.ts` 已有 `vault.mag7Balance` / `vault.cooldown` / `vault.investInfo`

跨 feature 依赖:
- `@/features/trade` 已有 `useEnableTrading`(`features/trade/containers/useEnableTrading.ts`)
- `@/features/auth` 已有 `useConnectWalletDialog`

---

## 步骤拆分(分层顺序:常量/类型 → Infra → Service → Container → UI)

### Step 0 ─ 类型 & 常量先行

**新增 / 修改**:

| 文件 | 操作 | 内容 |
|---|---|---|
| `src/features/vault/constants.ts` | 追加 | `export const CLAIM_MIN_AMOUNT = "4";`<br>`export const CALL_FOR_TYPE_CLAIM = 2;` |
| `src/features/vault/domain/types.ts` | 追加 | `ClaimInput` / `ClaimResult` / `ClaimableInfo` 三个 type |
| `src/features/vault/domain/types.ts` | 追加 | `CallForPermitTypedData`(domain / types / message 结构,供 service + logic 共用) |

**验证**:`pnpm tsc --noEmit` 无错;新类型无 `any`。

**依赖**:无。

---

### Step 1 ─ Infra: ABI

**新增**:`src/features/vault/infra/abis/CallForPermitAbi.ts`

**内容**:
- 从 sodex-web `funding/_hooks/useCallForPermit.ts` + `helper/abi/CallForPermitAbi.ts` 迁入
- 只保留 claim 链路用到的 function fragment:
  - `callFor(typedData, signature)`(bridge callFor 提交 endpoint)
  - `domainSeparator()` 等辅助(按需)

**若模块 0 已有同名文件**:本步复用,不重复建。Step 执行前先 `ls infra/abis/` 确认。

**验证**:ABI viem `Abi` 类型通过;合约地址从 `shared/constants/contracts.ts` 的 `VAULT_CALL_FOR_PERMIT_ADDRESS` / `VAULT_CALLER_ADDRESS` / `VSMAG7_TOKEN_ADDRESS` 读(不重复定义)。

**依赖**:Step 0。

---

### Step 2 ─ Infra: chain 调用

**新增**:`src/features/vault/infra/chain/vaultClaimInfra.ts`

**导出函数**:

```ts
// 1. 用钱包签 EIP-712 typed data,返回 signature(0x 字符串)
export async function signCallForPermit(input: {
  typedData: CallForPermitTypedData;
  account: Address;
}): Promise<`0x${string}`>;

// 2. 提交 callFor 到合约,返回 tx hash
export async function submitBridgeCallFor(input: {
  typedData: CallForPermitTypedData;
  signature: `0x${string}`;
}): Promise<`0x${string}`>;

// 3. 等待 3 confirmations(Q2 确认),返回 receipt
export async function waitForClaimReceipt(
  txHash: `0x${string}`,
): Promise<TransactionReceipt>;
```

**实现要点**:
- 用 `wagmi/actions` 的 `signTypedData` / `writeContract` / `waitForTransactionReceipt`
- chain 固定 `VALUE_CHAIN_MAINNET.id`(对照老项目 `valueChainClient`)
- 结构化错误:抛 `InfraError`(discriminated union,字段 `{ kind: "SIGNATURE_REJECTED" | "TX_REVERTED" | "NETWORK" | "UNKNOWN" }`)

**验证**:手动对 sodex-web `createBridgeCallFor` 的参数构造逻辑逐字段对照写入 `signing-checklist.md`。

**依赖**:Step 0, 1。

---

### Step 3 ─ Service(Command)

**新增**:`src/features/vault/services/vaultClaimService.ts`

**导出**:

```ts
export async function executeClaim(input: ClaimInput): Promise<ClaimResult>;
```

**内部流程**:
1. 调 `buildPermitMessage`(在 Step 4 的 logic 里)构造 typedData
2. `await signCallForPermit({ typedData, account })`
3. `await submitBridgeCallFor({ typedData, signature })` → txHash
4. `await waitForClaimReceipt(txHash)` → 检查 `receipt.status === "success"`,否则抛 `ServiceError({ kind: "TX_REVERTED" })`
5. 返回 `{ success: true, txHash }`

**错误映射**:
- `InfraError.SIGNATURE_REJECTED` → `ServiceError.USER_REJECTED`(静默关闭,不 toast)
- `InfraError.TX_REVERTED` → `ServiceError.CLAIM_FAILED`(i18n `common:claim_failed` toast)
- `InfraError.NETWORK` → `ServiceError.NETWORK_ERROR`

**禁止**:import stores(Command Service 硬规则)。

**新增**:`src/features/vault/services/mapInfraError.ts`(若模块 1 未建)

**验证**:`pnpm tsc --noEmit` 无错。

**依赖**:Step 0, 1, 2。

---

### Step 4 ─ Container: 纯逻辑

**新增**:`src/features/vault/containers/claimFlowLogic.ts`

**导出函数**(均纯函数,禁 `import react / stores / components`):

```ts
export function deriveClaimButtonState(input: {
  isConnected: boolean;
  needsEnableTrading: boolean;
  amount: string;
  min: string;
  max: string;
  isSubmitting: boolean;
}): ClaimButtonState;

export function deriveClaimHelperText(input: {
  amount: string;
  min: string;
  max: string;
}): string | null;

export function buildPermitMessage(input: {
  amount: string;           // canonical sMAG7 decimal
  chainId: number;
  callerAddress: Address;
  tokenAddress: Address;
}): CallForPermitTypedData;
```

**`ClaimButtonState` 联合类型**(写入 `domain/types.ts`):
```ts
type ClaimButtonState =
  | { kind: "connectWallet" }
  | { kind: "enableClaim" }
  | { kind: "claim"; disabled: boolean; helperText: string | null }
  | { kind: "submitting" };
```

**验证**:写最小单测(3-5 条),覆盖 4 态 + 边界(金额 < min / > max / === 0)。

**依赖**:Step 0。

---

### Step 5 ─ Container: mutation hook

**新增**:`src/features/vault/containers/useSubmitVaultClaim.ts`

**返回**:

```ts
export function useSubmitVaultClaim(): {
  submit: (input: ClaimInput) => Promise<ClaimResult>;
  isSubmitting: boolean;
  error: ServiceError | null;
};
```

**实现要点**:
- React Query `useMutation`,`mutationFn = executeClaim`
- `onSuccess` 批量 invalidate:
  - `queryKeys.vault.mag7Balance(address)`
  - `queryKeys.vault.cooldown(address)`
  - `queryKeys.vault.investInfo(address)`
- `onError`:区分 `ServiceError.USER_REJECTED`(返回不触发 toast)vs 其他 kind(调 `handleServiceError` toast)

**依赖**:Step 3, 4。

---

### Step 6 ─ Container: form hook(可选,按 spec 标注)

**新增**:`src/features/vault/containers/useVaultClaimForm.ts`

**职责**:
- `react-hook-form` + `zod` 校验(min / max / 精度)
- 暴露 `{ register, handleSubmit, formState, setValue, watch }`
- Max 来自 `useVaultCooldown().withdrawable`(**在 hook 内部订阅,外部不传**)

**决策**:**做**,因为校验逻辑若散在 JSX 会重复。沿用老项目 form schema 思路。

**依赖**:Step 0。

---

### Step 7 ─ UI: 共享子组件(首建)

**新增**(放 `src/features/vault/components/dialogs/_shared/`):

| 文件 | 职责 |
|---|---|
| `KeyValueRow.tsx` | `You receive` / `Fees` 等行的统一展示组件(label 左,value 右,可选 striked 次值) |
| `VaultClaimSkeleton.tsx`(**仅本模块用则放组件目录**,不进 `_shared/`) | cooldown 加载中的骨架屏 |

**决策**:先只建 `KeyValueRow`(后续 unstake/withdraw/deposit 都要用);Skeleton 是否进 `_shared/` 根据 unstake 阶段复用情况再决定(先放组件目录)。

**依赖**:Step 0。

---

### Step 8 ─ UI: VaultClaimButton

**新增**:`src/features/vault/components/dialogs/VaultClaimDialog/VaultClaimButton.tsx`

**职责**:
- 消费 `deriveClaimButtonState`(Step 4)决定文案
- 根据 state.kind 分支:
  - `connectWallet` → 包 `<ConnectWalletGuard>` fallback
  - `enableClaim` → `<Button onClick={enableTrading}>Enable Claim</Button>`
  - `claim` → `<Button type="submit" disabled={state.disabled}>Claim</Button>` + helper text
  - `submitting` → `<Button loading>Claim</Button>`

**Props**:
```ts
type VaultClaimButtonProps = {
  state: ClaimButtonState;
  isSubmitting: boolean;
  onEnableTrading: () => void;
  onConnectWallet: () => void;
};
```

**依赖**:Step 4。

---

### Step 9 ─ UI: VaultClaimDialog 主弹窗(+ opener)

**新增**:`src/features/vault/components/dialogs/VaultClaimDialog/index.tsx`

**单文件导出两样**(按 `.claude/rules/modal-component-style.md`):

```tsx
// 1. 内容组件——只渲染内容区,不含 title/close/padding/border/rounded/bg
export function VaultClaimDialog(props: ModalInjectedProps<ClaimResult>) {
  const { resolve, close } = props;
  const { address } = useAccount();
  const cooldown = useVaultCooldown(address);
  const { enableTrading, isEnabling } = useEnableTrading();
  const { openDialog: openConnectWallet } = useConnectWalletDialog();
  const { submit, isSubmitting } = useSubmitVaultClaim();
  const form = useVaultClaimForm({ max: cooldown.withdrawable });

  // ...form + KeyValueRow + VaultClaimButton
  return (
    <form onSubmit={form.handleSubmit(async (values) => {
      const result = await submit(values);
      if (result.success) resolve(result);
    })}>
      {/* ... */}
    </form>
  );
}

// 2. opener——封装 openResponsive + shell 配置
export function openVaultClaimDialog(
  input?: { prefillAmount?: string },
): Promise<ClaimResult> {
  return openResponsive(VaultClaimDialog, input, {
    title: "Claim MAG7.ssi",
    description: "Withdraw your MAG7.ssi to your Spot Account.",
    classes: { content: "w-[420px]" },
  });
}
```

**硬约束**:
- 禁止在内容组件 JSX 里写 `<h1>Claim MAG7.ssi</h1>` / 关闭按钮 / `bg-bg-black-*` / `rounded-*` / `border` / 外层 `p-*`——Shell 统一提供
- 禁止在外部文件里 `import { openResponsive }` 或 `import { VaultClaimDialog }`——只允许 `import { openVaultClaimDialog }`

**依赖**:Step 5, 6, 7, 8。

---

### Step 10 ─ Dialog stub 覆盖

**修改**:`src/features/vault/containers/dialogs/openers.ts`

把 `openVaultClaimDialog` 的 stub 替换为从 `components/dialogs/VaultClaimDialog` re-export:

```ts
// Before (stub):
export const openVaultClaimDialog = (_input: unknown): Promise<never> =>
  notImplemented("claim");

// After:
export { openVaultClaimDialog } from "@/features/vault/components/dialogs/VaultClaimDialog";
```

**验证**:
- `pnpm tsc --noEmit` 确认类型签名对齐(`Promise<ClaimResult>` 而非 `Promise<never>`)
- 外部调用方(`VaultStats` / `useVaultSLPViewModel`)import `openVaultClaimDialog` 的路径不变

**依赖**:Step 9。

---

### Step 11 ─ Feature index.ts 导出(按需)

**检查**:`src/features/vault/index.ts` 是否需导出 `openVaultClaimDialog`。

**决策**:若外部 App/页面已通过 `useVaultSLPViewModel().onClaim` 间接调用,则 **不需要** 公开导出(opener 走 viewmodel 内部封装)。若有其他业务面板直接调,才加到 index.ts。

本次倾向 **不加 index.ts 导出**(viewmodel 已包住)。

**依赖**:Step 10。

---

### Step 12 ─ 产物归档

**新增到 `logs/vault/claim/`**:

| 文件 | 内容 |
|---|---|
| `signing-checklist.md` | EIP-712 typed data 字段逐个对照老项目(domain / types / message 每个字段都列) |
| `state-machine.md` | 无(claim 无多步状态机,skip) |
| `tx-hashes.md` | testnet ≥ 1 笔成功 tx,含参数回帖 |
| `acceptance.md` | spec §验收逐项打勾 |

---

## 新旧文件映射表

| 老项目(sodex-web) | 新项目(sodex-next-feature) | 说明 |
|---|---|---|
| `pages/vault/components/modals/funding/claim/index.tsx` | `features/vault/components/dialogs/VaultClaimDialog/index.tsx` | 内容 + opener 同文件 |
| `pages/vault/components/modals/funding/claim/VaultClaimButton.tsx` | `features/vault/components/dialogs/VaultClaimDialog/VaultClaimButton.tsx` | 按钮 4 态 |
| `pages/vault/components/modals/funding/claim/schema.ts`(form schema) | `features/vault/containers/useVaultClaimForm.ts` | react-hook-form + zod |
| `pages/vault/components/modals/funding/_hooks/useCallForPermit.ts` | `features/vault/infra/chain/vaultClaimInfra.ts` + `services/vaultClaimService.ts` + `containers/claimFlowLogic.ts` | 拆分到分层架构 |
| `helper/abi/CallForPermitAbi.ts` | `features/vault/infra/abis/CallForPermitAbi.ts` | ABI 原样搬 |
| `pages/vault/components/modals/funding/_components/VaultClaimSkeleton.tsx` | `features/vault/components/dialogs/VaultClaimDialog/VaultClaimSkeleton.tsx` | 骨架屏(本模块用,不进 `_shared/`) |
| `hooks/useProxyAndCooldown.ts` | 新项目 `containers/shared/useVaultCooldown.ts` | 已在 foundation scaffold |
| `hooks/useEnableTrading.ts` | `@/features/trade/containers/useEnableTrading.ts` | 已在新项目 trade feature |
| `models/vault` MobX actions | React Query invalidate | 通过 `onSuccess` 触发 |

---

## 架构映射检查(CHK-A 类)

| Check | 本计划的处理 |
|---|---|
| CHK-A1 Import 方向 | UI 不 import service/infra;只 import container hooks + `shared/components/ui` |
| CHK-A2 旧代码残留 | 老项目 MobX store `useStore().vault` 不 import;改用 React Query key invalidate |
| CHK-A3 normalize 位置 | 无 DTO → Domain 转换(claim 是 Command,只写不读业务实体);`buildPermitMessage` 纯构造不算 normalize |
| CHK-A4 文件命名 | 组件 `VaultClaimDialog/index.tsx`、Service `vaultClaimService.ts`、Container hook `useSubmitVaultClaim.ts` / `useVaultClaimForm.ts`、Logic `claimFlowLogic.ts` 全部对齐 CLAUDE.md §11 |
| CHK-A5 导出合规 | feature index.ts 不导出 dialog(走 viewmodel 封装);Step 11 默认 skip |

---

## 风险 & 兜底

| 风险 | 触发 | 兜底 |
|---|---|---|
| ABI 字段与老项目不一致 | 合约升级 | 对照 sodex-web `CallForPermitAbi.ts` 逐字段 diff,不一致则以老项目为准(clarify Q3 已确认老项目实现) |
| `useVaultCooldown.withdrawable === "0"` 时用户仍点开弹窗 | UI 入口未 disable | 弹窗内 Amount 输入整体 `disabled` + helper text 显示 "No claimable amount",按钮保持 `Claim` 但 disabled |
| permit 签名 domain 里 `chainId` 传错 | 非 ValueChain 钱包 | infra 层读 `useAccount().chainId` 硬对比 `VALUE_CHAIN_MAINNET.id`,不匹配先触发切链 |
| tx 成功但 receipt `status: "reverted"` | 合约层拒绝 | service 抛 `ServiceError.TX_REVERTED`,error toast 后弹窗不关,用户可重试 |
| `useEnableTrading` 跨 feature import 违反 index.ts 导出规范 | trade feature 未导出 | 前置验证:`grep "useEnableTrading" src/features/trade/index.ts` 确认已导出,否则先补 |

---

## 实施节奏建议

**分两批验证**:

1. **批次 A(Step 0-6)**:类型/常量 + Infra + Service + Container 逻辑/mutation/form。跑 `pnpm tsc --noEmit` + 写单测。
2. **批次 B(Step 7-10)**:UI 子组件 + VaultClaimButton + 主弹窗 + opener 接线。跑 `pnpm lint` + 本地手动打开弹窗看 4 态。

批次 A 通过后再进 B,避免 UI 先写好但底层类型变动导致返工。

---

## Token 估算

| 项 | 字符数 |
|---|---|
| inputChars(02-claim.md + plan-type-first.md + 老项目 claim/ + 现有 state/env) | ~14000 |
| outputChars(本 plan 文件) | ~11000 |
| estimatedTokens | ~6250 |

---

## Next Step

用户确认本 plan 后进入:

```
/k:migration execute vault-claim
```

execute 阶段按本 plan 顺序分步实现,每步完成跑验证,有问题停下触发 `/k/debug`。
