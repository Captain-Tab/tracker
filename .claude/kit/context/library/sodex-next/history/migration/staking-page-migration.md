---
id: staking-page-migration
type: migration
feature: staking
date: 2026-04-25
status: completed
---

# Staking 页面迁移记录（sodex-web → sodex-next-feature）

## 迁移范围

`src/features/staking/` 全功能迁移：链读数据层 + StakeSosoDialog 完整流程 + UI 全量还原。

---

## 架构决策

### 数据层（链读替代 fixture）

- `useTotalStakedQuery` → `readContract(sSOSO.totalSupply, VALUECHAIN_STAKE.totalSupply)` on Base + ValueChain
- `useStakingBalancesQuery` → `readUserStaked + readNativeVcBalance + WSOSO spot balance`
- 关键：Spot SOSO 在交易所内部叫 **WSOSO**（不是 SOSO），需用 `b.coin === "WSOSO"` 过滤

### StakeSosoDialog 流程

**Enable Trading 独立按钮模式**（对齐 Vault 模式）：
- 不在 mutation 内部调 `ensureApiKey`
- 用 `useEnableTrading()` hook + 独立 "Enable Staking" 按钮
- 条件：`!isAuthenticated || !apiKeyValid`（同 VaultWithdrawDialog）

**React 18 批量更新问题**：
- `setOperationStep` 在 async mutationFn 中会被批量合并，UI 只渲染最终 idle 状态
- 修复：`flushSync(() => setOperationStep(step))` 强制同步渲染

**Toast 顺序问题**：
- TanStack Query 回调顺序：`onError` → `onSettled`
- 若在 `onError` 显示 toast、`onSettled` 调 `closeNotify()`，toast 会被立即关闭
- 修复：所有结果 toast 移入 `onSettled`，先 `closeNotify()` 再显示结果

**mutation 取消**：
- `reset()` 不能终止 in-flight mutationFn（async 继续运行）
- 修复：`cancelledRef.current = true` + 每个 await 后检查 → 真正阻止后续步骤
- Dialog 关闭时不调 `closeNotify()`，避免关掉 `onSettled` 已显示的结果 toast

### SSI Boost 计算

**两套数据源**：
1. `useStakingBoostCalc` → 快速链上估算（SLP × NAV），用于 My Total SSI Value 显示
2. `useBoostTotalQuery` → 完整聚合（对齐老项目 boostTotal），用于 Boost 系数 + requiredSosoFor11x 精确计算

**老项目 boostTotal 聚合逻辑**（useBoostTotalQuery 实现）：
```
totalSsiUsd = holdingUSD(Base balanceOf × price)
            + stakingUSD(Base balanceOf + ValueChain VSMAG7 + cooldown unavailable × price)
            + lpUSD(/portfolio/lp/list × price)
            + valueChainLpExtra(SLP × NAV × mag7Price)
```

**MAG7.ssi 特殊处理**：
```
actualAmt = Base_balanceOf + ValueChain_VMAG7 + expired_cooldown(available)
```

### SSI Gateway API（ssi-gw.sosovalue.com）

新增 `ssiGwClient`，环境变量：
- dev: `VITE_SSI_GW_URL=/proxy/ssi-gw`（vite proxy → ssi-gw.sosovalue.com）
- prod: `VITE_SSI_GW_URL=https://ssi-gw.sosovalue.com`

接口：
- `POST /indices/index/website/portfolio/info` → holding 持仓
- `POST /indices/index/website/portfolio/staking/list` → staking 持仓
- `POST /indices/index/website/portfolio/lp/list` → LP 持仓

---

## 关键坑点

1. **WSOSO vs SOSO**：Spot 余额中 SOSO 的内部交易所名称为 WSOSO，filter 时需用 `b.coin === "WSOSO"`

2. **React 18 自动批量更新**：async mutationFn 中的 setState 被批量合并，需用 `flushSync` 强制同步

3. **TanStack Query onError/onSettled 顺序**：onError 先于 onSettled，在 onError 显示 toast 后 onSettled 的 closeNotify 会把它关掉

4. **mutation reset() 不能取消 in-flight**：需用 ref 标志位 + 每步 await 后检查

5. **SLP balance × NAV 精度问题**：用 SLP × NAV 计算的 totalSsiUsd 精度远低于老项目后端聚合，导致 requiredSosoFor11x 计算偏差；需用完整 boostTotal 聚合逻辑

6. **StakeSosoDialog queryKey 冲突**：`useSlpBalanceQuery` 和自定义 useQuery 使用相同 queryKey 但不同 queryFn 会导致 type 冲突，需使用不同 key

7. **ssiGwApi vs gw-sodex**：老项目的 portfolio API 在 `ssi-gw.sosovalue.com`，与新项目的 `gw-sodex.sosovalue.com` 是不同网关，需单独配置

---

## 新增文件清单

| 文件 | 说明 |
|------|------|
| `infra/chain/stakingChainInfra.ts` | 链读：totalSupply + balanceOf + native balance |
| `infra/chain/valueChainStake.ts` | sendStakeTransaction + waitForStakeReceipt（拆分后） |
| `infra/api/sosoTransferInfra.ts` | Spot→EVM SOSO 划转 |
| `infra/api/ssiGwApi.ts` | SSI Gateway 接口（holding/staking/lp） |
| `containers/useStakingBalancesQuery.ts` | Your Staked + ValueChain Available |
| `containers/useSubmitStake.ts` | 质押 mutation（flushSync + cancelRef） |
| `containers/stakeFlowLogic.ts` | 纯函数：精度截断/划转判断/余额格式化 |
| `containers/useStakingBoostCalc.ts` | SSI Boost 系数估算（链上快速版） |
| `containers/useBoostTotalQuery.ts` | SSI 总资产精确聚合（对齐老项目 boostTotal） |
| `components/StakeSosoDialog/` | 完整弹窗：Content + ReviewStep + Skeleton |
| `components/YouBadge.tsx` | 质押档位 You 标签 |
| `components/TagStatus.tsx` | ongoing/coming-soon 状态标签 |
| `components/MobileStakeButton.tsx` | 移动端底部浮动按钮 |

---

## 验收状态

- [x] tsc --noEmit 无报错
- [x] 链读数据（Your Staked / Total Staked）正常更新
- [x] StakeSosoDialog 完整 6 区块 UI 还原
- [x] Enable Staking / Stake 按钮状态正确
- [x] SSI Boost 系数对齐老项目（boostTotalQuery）
- [x] requiredSosoFor11x 精确计算（boostTotalQuery）
- [x] 质押流程：Approving → Confirming → Proceeding 步骤正常显示
- [x] 用户取消：toast "User cancelled transaction."
- [x] 错误：toast 错误信息
- [x] 成功：toast + 关闭弹窗 + 刷新数据
- [x] debug 代码已清理
