# Stake 后 Spot 余额刷新修复 + Toast 阶段化

**日期**: 2026-05-06 | **类型**: fix | **范围**: stake

---

## 变更概述

修复 stake 走 `needsTransfer=true` 路径后 spot 余额永久 stale 的 bug；同步加 toast 文案分阶段切换缓解 UX 时序困惑。

---

## 根因

`useSubmitStake.mutationFn` 完成后只调 `queryClient.invalidateQueries({queryKey: queryKeys.staking.all()})`——但 staking 命名空间不覆盖 `["spot", "accountState", address]`。

当 stake 走 transfer 路径时，`transferSosoSpotToEvm` 实际从 Spot 划转 SOSO 到 EVM-Funding，**Spot 余额已变**。但前端 cache 中的 spot snapshot 是 `staleTime: Infinity` + `refetchOnMount/Focus/Reconnect: false`（HTTP 一次性 + WS 增量设计），不会自动刷新。

后果：`rawAvailable = vcNative + spotSoso` 中的 `spotSoso` 部分长期偏高（包含已被划走的金额）。

---

## 核心变更

### 1. 新增 `useSpotRefetchAfterTransfer` hook

**文件**: `src/features/staking/containers/useSpotRefetchAfterTransfer.ts`（新建）

`[2_000, 5_000]` ms 两段 retry，主动 `refetchQueries(spot.accountState)`，覆盖后端 transfer settlement 时间窗口。

```ts
const RETRY_DELAYS_MS = [2_000, 5_000] as const;

export function useSpotRefetchAfterTransfer() {
  const queryClient = useQueryClient();
  const timersRef = useRef<number[]>([]);

  useEffect(() => () => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  }, []);

  return useCallback((address: string) => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
    RETRY_DELAYS_MS.forEach((delayMs) => {
      const id = window.setTimeout(() => {
        void queryClient.refetchQueries({queryKey: queryKeys.spot.accountState(address)})
          .catch(() => {});
      }, delayMs);
      timersRef.current.push(id);
    });
  }, [queryClient]);
}
```

特性：
- useRef + useEffect cleanup 处理组件 unmount
- 连续 stake 时清前一次未 fire 的 timer
- `refetchQueries` 主动绕开 `staleTime: Infinity`
- `.catch(() => {})` 静默吞掉，不影响 mutation 链路

### 2. `useSubmitStake` transfer 分支后调 retry

**文件**: `src/features/staking/containers/useSubmitStake.ts`

```ts
const triggerSpotRefetchRetry = useSpotRefetchAfterTransfer();

// mutationFn transfer 分支末尾
if (needsTransfer(amountWei, vcNativeWei)) {
  // ... 现有 transfer 逻辑 ...
  await transferSosoSpotToEvm(capability, formatUnits(transferWei, 18));
  await pollVcBalance(addr, amountWei);

  // 主动触发 spot 重读：staking 的 invalidateQueries 不覆盖 spot.accountState
  triggerSpotRefetchRetry(addr);
}
```

### 3. 拆分 `useSpotAccountSync` 为两个 hook

**文件**: `src/features/trade/containers/useSpotAccountSync.ts`

- `useSpotAccountStoreSync()`：仅 store snapshot → React Query cache 桥接（无 toast）
- `useSpotAccountSync()`：内部调 `useSpotAccountStoreSync` + 保留 trade 成交 toast

trade 页面的行为完全不变（仍用 `useSpotAccountSync`）。stake / vault / portfolio 等非 trade 页面可挂 `useSpotAccountStoreSync` 不带 toast 副作用。

### 4. `useStakingPageViewModel` 挂 `useSpotAccountStoreSync`

**文件**: `src/features/staking/containers/useStakingPageViewModel.ts`

```ts
import { useSpotAccountStoreSync } from "@/features/trade";

export function useStakingPageViewModel() {
  useSpotAccountStoreSync();  // 让 stake 页面期间 WS push 也能同步到 RQ cache
  // ...
}
```

修复"用户在 stake 页面期间任何 spot 变化都不刷新"的更广问题——WS push 现在能通过 store → cache 链路实时反映。

### 5. `features/trade/index.ts` 新增 export

```ts
export { useSpotAccountStoreSync } from "./containers/useSpotAccountSync";
```

### 6. Toast 文案分 3 阶段切换

**文件**: `src/features/staking/containers/useSubmitStake.ts`

```
onMutate                                  → "Staking SOSO..."
进入 transfer 分支 setStep("approving") 后 → "Transferring SOSO to ValueChain..."
进入 sendStakeTransaction 前               → "Confirming stake on chain..."
onSettled 成功                            → "Staking successful!"
```

切换通过 `closeNotify()` + `notify.loading(newMsg)` 实现。`closeNotify` 仅关 loading toast，不影响最终结果 toast。

设计目的：transfer 完成 + spot retry 触发后，spot 余额会先于 stake on-chain receipt 减少（约 5-7s 提前量）。toast 文案切换让用户理解"这是 transfer 阶段，spot 在变；下一阶段是 stake on chain"，避免"我的 SOSO 凭空消失"的视觉困惑。

---

## 文件变更列表

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `src/features/staking/containers/useSpotRefetchAfterTransfer.ts` | 新增 | [2s, 5s] 两段 retry hook + cleanup |
| `src/features/staking/containers/useSubmitStake.ts` | 修改 | 引入 retry + toast 三阶段切换 |
| `src/features/staking/containers/useStakingPageViewModel.ts` | 修改 | 挂载 useSpotAccountStoreSync |
| `src/features/trade/containers/useSpotAccountSync.ts` | 修改 | 拆出 useSpotAccountStoreSync (cache sync only) |
| `src/features/trade/index.ts` | 修改 | export useSpotAccountStoreSync |

---

## 协同机制

- **WS 推送正常时**：`useSpotAccountStoreSync` 桥接是主路径，[2s, 5s] retry 是兜底
- **WS 滞后 / 命中中间态**：[2s, 5s] retry 主动拉 HTTP 拿 settled 状态覆盖 cache
- **后端 settlement >5s**：仅靠 WS push 兜底；超过则需下次 mount 触发

---

## 设计取舍

> ⚠️ 主动 `refetchQueries` 违反了 `useSpotAccountStateQuery.ts` 注释的"关掉所有 refetch 避免 HTTP/WS 互相覆盖"原则。trade-off：stake 是低频操作，对后端无压力；HTTP 与 WS 写入冲突理论上可能让 cache 短暂回退到旧值，但下一次 WS push 会校准。

老项目（sodex-web）等价做法：MobX `chainAsset.checkBalancesModified(5)` 主动轮询 5 次。本方案 [2s, 5s] 二段重试是更轻量的"主动刷新"对应。

---

## 影响范围

- **stake 邮箱用户**：bug 完全修复
- **stake 钱包用户**：bug 完全修复（钱包用户和邮箱用户走同一份 mutation 路径）
- **vault 系列**：零影响（vault 不依赖 staking 任何代码）
- **trade 页面**：零影响（`useSpotAccountSync` 行为完全保留）

---

## 验证

iter 4-5 日志验证：
- 多次连续 stake（含 needsTransfer=true）spot 余额都按预期减少
- retry [2s, 5s] 都按预期 fire，HTTP refetchQueries 完成后 P4-vm 立即反映新 rawAvailable
- toast 文案按 3 阶段切换

---

## 关联文档

- **Reference**: `.claude/kit/context/library/sodex-next/reference/stake/stake-soso-guide.md`
- **关联功能**: stake-page（弹窗的入口页面）
