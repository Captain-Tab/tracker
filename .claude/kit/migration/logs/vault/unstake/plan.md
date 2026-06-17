# Migration Plan: vault-unstake

> Spec 源:`.claude/kit/spec/vault-migration/03-unstake.md`
> 生成:2026-04-22 by `/k:migration plan vault-unstake`

## 前置匹配

| 项 | 结果 |
|---|---|
| Pitfall gates | 无命中 |
| Reusable match | 无命中(reusable 库未建 vault 条目) |
| Records(kit 级) | 命中 `spec:permit-assumption-trap`(已过) `plan:dependency-existence-check`(对 trade submit/useSubmitTransfer 已核) `structure:*`(全部已内化到 claim 产物) |
| 类型先行模板 | 加载 |

## spec 与实现微调

**spec Service 原本写**:`executeUnstake` 内部先 `submitTransfer` 再 `signCallForPermit`。
**改为**:Service 只做 CallForPermit 部分(和 claim 几乎一样);pre-transfer 放 **Container 层** `useSubmitVaultUnstake` 编排。

原因:
- `trade/services/transferService.ts.submitTransfer` 不在 trade `index.ts` 导出——feature public API 只允许导出 `use*` container hooks(CLAUDE.md §3)。跨 feature 调 service 函数违反架构
- 正解:trade 导出 `useSubmitTransfer`(container hook);vault 的 container hook 做"mutation of mutations"编排

## 依赖前置(execute 前必做)

- [ ] **trade/index.ts 追加**:`export { useSubmitTransfer } from "./containers/useSubmitTransfer";`
- [ ] `waitForEvmSmag7Balance` — vault 自建一份小函数(vault/infra/chain/vaultUnstakeInfra.ts),避免跨 feature 调 trade/services

## 步骤

### Step 0:类型 + 常量

| 文件 | 操作 |
|---|---|
| `domain/constants.ts` | 追加 `UNSTAKE_CALL_FOR_TYPE = 1 as const`、`CMD_TYPE_CREATE_BRIDGE_KEY_UNSTAKE = 1n`(cmdType=CreateBridgeCallFor 在合约里的 key,和 claim 相同) |
| `domain/types.ts` | 追加 `UnstakeInput`(`{amount: string}`)、`UnstakeResult`(`{success: boolean; txHash?: string}`);VaultServiceError 追加 `TRANSFER_FAILED` / `EVM_BALANCE_TIMEOUT` kind |

**注**:cmdType=CreateBridgeCallFor 的 nonce key 和 claim 相同(key=1 CreateBridgeCallFor),claim infra 的 `getClaimNonce` 可直接复用;**不同的是 cmd 内的 callForType**(claim=2,unstake=1)。

### Step 1:Domain - unstake permit

新建 `domain/unstakePermit.ts`(仿 `claimPermit.ts`):
- `buildUnstakeCmd(amount)` 返回 `BridgeCallForCmd`
  - `callForType: UNSTAKE_CALL_FOR_TYPE = 1`
  - `inCoinSymbol: standardizeMag7Symbol("sMAG7")` → "sMAG7.ssi"
  - `outCoinSymbol: standardizeMag7Symbol("MAG7")` → "MAG7.ssi"
  - `inAmount: parseUnits(amount, 8).toString()`
  - `minOutAmount: "0"`
  - `toClob: false`(cooldown,不直达 spot)
  - (字段值以 execute 阶段对照老 `useUnstakeWithTransfer` 为准,本 plan 以合理推断为起点)
- `buildUnstakePermitTypedData` / `buildUnstakeCmdData` / `buildUnstakeCallForPermitRequest` - 和 claim 结构 100% 相同,本轮**复制**(模块 6 integration 抽 shared)

### Step 2:Infra - 复用 claim + 新增 waitForEvmSmag7Balance

- **直接复用**(不改):
  - `infra/chain/vaultClaimInfra.ts` 的 `getClaimNonce` / `signCallForPermit` / `waitForClaimReceipt`
  - `infra/api/vaultApi.ts` 的 `postCallForPermit`
  - `infra/errors.ts` 的 `VaultInfraError`
- **新建** `infra/chain/vaultUnstakeInfra.ts`:
  - `waitForEvmSmag7Balance({ walletAddress: Address, targetAmount: string, timeoutMs?: number })` - 轮询 EVM sMAG7 余额直到 ≥ targetAmount;超时抛 `{ kind: "TX_TIMEOUT" }`(复用 VaultInfraError 类型)
  - 实现:`readContract` ERC20 `balanceOf(VSMAG7_TOKEN_ADDRESS, walletAddress)` + `formatUnits`,老项目 `useUnstakeWithTransfer` 用 `RETRY_INTERVALS = [500, 1000, 3000]` 共 4.5s,本次沿用

### Step 3:Service - 纯 CallForPermit 链路

新建 `services/vaultUnstakeService.ts`:

```ts
export async function executeUnstakePermit(input: {
  amount: string;
  account: Address;
}): Promise<UnstakeResult>
```

流程(和 claim `executeClaim` 几乎一样,差异仅 `buildUnstakeCmd` vs `buildClaimCmd`):
1. `getClaimNonce(account)` - 复用
2. `buildUnstakeCmd(amount)` + `buildUnstakePermitTypedData`
3. `signCallForPermit(typedData)` - 复用
4. `buildUnstakeCallForPermitRequest` + `postCallForPermit` → txHash
5. `waitForClaimReceipt(txHash)` - 复用 3 confirmations
6. 返回 `{ success: true, txHash }`

**不含 pre-transfer**(编排交给 container)。

### Step 4:Container - 纯逻辑

新建 `containers/unstakeFlowLogic.ts`:
- `deriveUnstakeButtonState({ isConnected, needsEnableTrading, amount, min, max, isSubmitting })` - 和 claim 同结构,但 button labels: "Connect Wallet" / "Enable Unstake" / "Unstake" / submitting
- `deriveUnstakeHelperText` / `isUnstakeAmountValid` - 复制 claim,Min = "0"(unstake 无最低限制,或按老项目核对)

**决策**:不做 label 参数化(claim/unstake 合一抽象),保留各自文件,模块 6 再统一。

### Step 5:Container - form hook

新建 `containers/useVaultUnstakeForm.ts`:
- 同 claim 模式,useState + `isUnstakeAmountValid` / `deriveUnstakeHelperText`
- `max` 参数从外部传入(`useVaultMag7Balance().valueChain.sMag7`)
- `min = "0"`(无最低)

### Step 6:Container - mutation 编排(关键差异点)

新建 `containers/useSubmitVaultUnstake.ts`:

```ts
export function useSubmitVaultUnstake() {
  const { address } = useAccount();
  const { mutateAsync: doTransfer } = useSubmitTransfer(); // 跨 feature,从 @/features/trade import(execute 前 trade/index.ts 补导出)
  const queryClient = useQueryClient();
  const { data: balance } = useVaultMag7Balance(address);

  return useMutation({
    onMutate: (params) => notify.loading(`Unstaking ${amount} sMAG7.ssi...`, { autoClose: false }),
    mutationFn: async ({ amount }: { amount: string }) => {
      // 1. Smart-transfer 判断
      const evmSmag7 = getEvmFundingSmag7FromBalance(balance); // 从 useVaultMag7Balance 取 EVM-Funding 单独余额(目前 balance 只给 valueChain 合计,需扩展)
      if (new Decimal(amount).gt(evmSmag7)) {
        const diff = new Decimal(amount).sub(evmSmag7).toString();
        // 调 trade useSubmitTransfer 的 mutateAsync
        await doTransfer({ from: "Spot", to: "Funding", coin: "sMAG7.ssi", amount: diff });
        // 等 EVM 余额到账
        await waitForEvmSmag7Balance({ walletAddress: address, targetAmount: amount });
      }

      // 2. 走 vault service 做 CallForPermit 签名
      return executeUnstakePermit({ amount, account: address });
    },
    onSuccess: (_data, params) => {
      toast.dismiss(unstakeLoadingId(params.amount));
      notify.success(`${params.amount} sMAG7.ssi unstake submitted`);
      queryClient.invalidateQueries({ queryKey: queryKeys.vault.mag7Balance(address) });
      queryClient.invalidateQueries({ queryKey: queryKeys.vault.cooldown(address) });
      queryClient.invalidateQueries({ queryKey: queryKeys.vault.investInfo(address) });
      queryClient.invalidateQueries({ queryKey: queryKeys.chain.evmBalances(address) });
    },
    onError: (error, params) => {
      toast.dismiss(unstakeLoadingId(params.amount));
      handleUnstakeServiceError(error);
    },
  });
}
```

**需解决**:`useVaultMag7Balance` 当前返回的 `valueChain.sMag7` 是 Spot+EVM 合计,获取单独的 EVM-Funding 子余额需要:
- 方案 a:扩展 `useVaultMag7Balance` 返回明细(`valueChain.evmFundingSmag7` / `valueChain.spotSmag7`)—— foundation 改动,影响既有 claim 调用方,谨慎
- 方案 b:在 `useSubmitVaultUnstake` 内额外调 `useBalancesQuery`(spot) + `useEvmBalancesQuery`(EVM)拿原始数据,合并时只取 EVM 部分 —— **推荐**,零 foundation 改动

**选方案 b**。

### Step 7:Container - error 映射

新建 `containers/handleUnstakeServiceError.ts` - 仿 `handleClaimServiceError`,新增 case:
- `TRANSFER_FAILED` → `notify.error("Transfer to Funding failed")`
- `EVM_BALANCE_TIMEOUT` → `notify.warning("Pre-transfer submitted, please check balance and retry")`
- 其余 cover claim 已有 kind(直接复制 switch)

### Step 8:UI - 子组件

**新建**:
- `components/dialogs/VaultUnstakeDialog/VaultUnstakeSkeleton.tsx`(复制 claim 的,仅文案"Unstaking..."无,skeleton 无文案就直接复制)

**复用**:
- shared/ui 的 `Alert`(若存在,否则内联 Warning 样式)— 14-day lockup 提示
- shared/ui 的 `NumberInput` / `LabelValue` / `Button` / `VStack`

### Step 9:UI - 按钮 + 主弹窗

新建 `components/dialogs/VaultUnstakeDialog/VaultUnstakeButton.tsx`:
- 结构 100% 复制 `VaultClaimButton.tsx`,文字改 `Enable Unstake` / `Unstake`

新建 `components/dialogs/VaultUnstakeDialog/index.tsx`:
- 结构复制 `VaultClaimDialog/index.tsx`,改动:
  - 标题 `Unstake` / 副标题 `Unstake your sMAG7.ssi to MAG7.ssi.`
  - 顶部新增 `<Alert>`(Warning / 14-day lockup 提示)
  - Amount startAdornment `Amount (sMAG7.ssi)` / placeholder `0.00`
  - Max 来源 `balance.valueChain.sMag7`(注意:容器内 useEvmBalancesQuery + useBalancesQuery 拿 EVM 单独余额存 state,Max 仍显示合计)
  - You receive `${amount} MAG7.ssi` 或 `--`(无 Fees 行)
  - Submit 调 `useSubmitVaultUnstake`

### Step 10:opener 接线

`containers/dialogs/openers.ts`:
- `export { openVaultUnstakeDialog } from "@/features/vault/components/dialogs/VaultUnstakeDialog";` 覆盖原 stub
- `openVaultDepositDialog` / `openVaultInterruptionDialog` 保持 stub(后续模块)

### Step 11:前置依赖补齐

- `features/trade/index.ts` 追加 `export { useSubmitTransfer } from "./containers/useSubmitTransfer";`
- 检查:如已导出则跳过

### Step 12:viewmodel / mock 同步

`containers/useVaultSLPViewModel.ts`:
- `onUnstakeValueChain` / `onUnstakeBase` 从 `safeTrigger(() => openVaultUnstakeDialog(undefined))` 改为 `safeTrigger(() => openVaultUnstakeDialog())`(签名从 `Promise<never>` 变 `Promise<UnstakeResult>`)

`components/VaultStats/mock.ts`:
- 同上改动

### Step 13:产物归档

`logs/vault/unstake/`:
- `signing-checklist.md` — CallForPermit EIP-712 参数 + TransferAsset 签名参数
- `tx-hashes.md` — testnet unstake tx(含 smart-transfer 场景,如能构造)
- `acceptance.md` — 验收记录

## 新旧文件映射

| 老项目(sodex-web) | 新项目(sodex-next-feature) | 说明 |
|---|---|---|
| `pages/vault/components/modals/funding/unstake/index.tsx` | `features/vault/components/dialogs/VaultUnstakeDialog/index.tsx` | 合入 opener |
| `pages/vault/components/modals/funding/unstake/VaultUnstakeButton.tsx` | `features/vault/components/dialogs/VaultUnstakeDialog/VaultUnstakeButton.tsx` | 4 态按钮 |
| `pages/vault/components/modals/funding/unstake/schema.ts`(zod) | `features/vault/containers/useVaultUnstakeForm.ts`(useState + logic) | 不引入 react-hook-form |
| `pages/vault/components/modals/funding/unstake/_hooks/useUnstakeWithTransfer.ts` | **拆分**:`services/vaultUnstakeService.ts`(permit 部分) + `containers/useSubmitVaultUnstake.ts`(编排) + `infra/chain/vaultUnstakeInfra.ts` (waitForEvmSmag7Balance) | 分层化 |
| `useCallForPermit` | 复用 claim `infra/chain/vaultClaimInfra.ts` | 同 feature 复用 |
| `models/vaultBalance` MobX 更新 | React Query invalidate | 同 claim |

## 架构检查预期(CHK-A)

| # | 预期 |
|---|---|
| A1 Import 方向 | ✅ 同 claim |
| A2 旧代码残留 | ✅ 不 import MobX |
| A3 normalize | ✅ unstake 无 DTO→Domain(Command 写入);buildXxx 是构造函数 |
| A4 文件命名 | ⚠️ 同 claim,已知 verify-arch.sh 误报(忽略) |
| A5 导出合规 | ✅ feature index.ts 不暴露 dialog,viewmodel 内部封装;trade/index.ts 追加 useSubmitTransfer 合规(hook 以 use 开头) |

## 风险 & 兜底

| 风险 | 触发 | 兜底 |
|---|---|---|
| `cmd.toClob` / `minOutAmount` 值与老项目不符 | execute 对照遗漏 | execute Step 1 时 diff 老项目 `useUnstakeWithTransfer` 中的 `createBridgeCallFor` 入参,不拍脑袋 |
| 旧 UI 组件 WarningAlert 找不到完全对应的 shared | shared/ui 可能无 Alert | 检查 `shared/components/ui/Alert`,有则用,无则内联 `<div className="rounded border border-text-warning p-3">` |
| `useSubmitTransfer` 在 trade 内部隐含 loading toast | 可能产生双 loading("Submitting transfer..." + "Unstaking...") | execute 时对比两个 loading id 是否冲突;如冲突,在 unstake 编排里先 `toast.dismiss(trade 的 id)` |
| smart-transfer 签名跳出"Submit transfer" 弹窗 | trade `useSubmitTransfer` 不是设计给内部 orchestration 的 | execute 时看 useSubmitTransfer 是否可以静默调用(不弹 UI);如不行,自建 `submitTransferQuiet` 版本 |
| `waitForEvmSmag7Balance` 轮询 4.5s 仍未到账 | 链上延迟 | 抛 `EVM_BALANCE_TIMEOUT`,Container toast warning"已发起转账,请稍后再试"而非自动重试 |

## 实施节奏

两批:
- 批次 A:Step 0-7(常量/类型/domain/infra/service/纯 container) → `pnpm tsc --noEmit` 过
- 批次 B:Step 8-12(UI + viewmodel 同步 + opener 接线) → `pnpm lint` 过 + 跑一次看弹窗

## Next

用户确认 → `/k:migration execute vault-unstake`
