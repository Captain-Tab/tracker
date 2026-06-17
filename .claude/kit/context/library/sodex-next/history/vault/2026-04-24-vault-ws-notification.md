# Vault WS 通知处理 — 2026-04-24

> 实测验证（探针插桩 + WS OPEN/CLOSE 日志）确认后端推送状态，完成前端 handler 实现。

---

## 背景

Vault 四大操作（Deposit / Withdraw / Unstake / Claim）依赖 explorer WS endpoint
`wss://mainnet-ws-explorer.sodex.dev/websocket` 推送通知。

新项目原有实现（迁移时遗留）：
- `@sodex_deposit` + `@sodex_withdraw` 已订阅，有 handler，**但缺少 vault query invalidation**
- `@sodex_call_for`（Withdraw/Unstake/Claim）：仅有 debug 探针，无生产 handler

---

## 实测结论（2026-04-24）

| topic | 后端是否推送 | 前端订阅 |
|---|---|---|
| `@sodex_deposit` | ✅ 推 | ✅ |
| `@sodex_withdraw` | ✅ 推（普通 Spot 提现；Vault Withdraw 不走此 topic）| ✅ |
| `@sodex_call_for` | ❌ 后端 deferred | ✅（handler 已就绪）|

**关键验证**：做完 Vault Withdraw（callForPermit），WS OPEN 已确认，三个 topic 均已订阅，`@sodex_call_for` 零回调 → 后端未推。

---

## 本次实现

### 文件改动

| 文件 | 改动内容 |
|---|---|
| `trade/stores/depositNoticeStore.ts` | 新增 `CallForNoticeEvent` 类型 + `lastCallForEvent` + callFor 去重 Set/Actions |
| `trade/services/depositNoticeDataService.ts` | 新增 `handleCallForNotice` + `boundCallForHandler` + 订阅 `@sodex_call_for` |
| `trade/containers/useDepositNotice.ts` | 新增 callFor useEffect handler（Pending/Success/Failed + vault invalidation）；补 deposit success 的 vault invalidation |

### 消息结构

**sodex_deposit / sodex_withdraw**（现有）：
```ts
record.status: "Depositing" | "Success" | "Failed"
record.txHash            // 去重 key
record.coin / record.token
record.amount / record.decimals
```

**sodex_call_for**（新增）：
```ts
record.callForType: 1    // Withdraw / Unstake
                   2    // Claim
record.executeStatus: "Requesting" | "Bridging" | "Settling" | "Success" | "Failed"
record.callForId         // 去重 key（无 txHash）
record.inCoinSymbol / record.outCoinSymbol
record.inAmount / record.decimals
```

### Handler 逻辑（callFor）

```
Pending（Requesting/Bridging/Settling）
  → 首次 → notify.loading("Withdrawing in progress..." | "Claiming in progress...", autoClose:false)
  → mark callForPendingNotified

Success
  → 有 pending 记录 && 未 success 通知
  → notify.success("{inAmount} {inCoinSymbol} withdraw successfully" | "Claimed {inAmount} {inCoinSymbol} successfully")
  → mark callForSuccessNotified
  → invalidate: mag7Balance + cooldown + investInfo + slpBalance + hasMyActivity + activity + myActivity
  → Claim only: + chain.evmBalances

Failed
  → 未 success 通知 → notify.error("Withdraw failed" | "Claim failed")
  → mark callForSuccessNotified（防重复）
```

### Deposit success 补充的 vault invalidation

当 `sodex_deposit` Success 且 token = `MAG7SSI` / `SMAG7SSI` 时：
```ts
invalidate: investInfo + mag7Balance + slpBalance + hasMyActivity + activity + myActivity
```

---

## 架构约定

- 所有 WS 通知走**同一 `DepositNoticeWs` 单例**（三个 topic 共用一条 WS 连接）
- `depositNoticeDataService`（Stream Service）负责订阅 + 写 store
- `useDepositNotice`（Container hook）负责读 store + toast + invalidate
- **不使用 EventBus**，用 `queryClient.invalidateQueries` 替代老项目的 `emit(VAULT_CALL_FOR_SUCCESS)` → `SLP.tsx refreshAll`
- 去重策略：`callForId.toString()` 优先，无 id 时 `${address}-${stmp}-${callForType}` 组合 key

---

## 后端启用 sodex_call_for 后的验证步骤

1. 做一次真实 Claim 或 Withdraw
2. 观察 `[DEBUG:WS:CALL_FOR] event=MESSAGE_RECEIVED` 是否出现（需临时加探针）
3. 有回调 → handler 生效，UI 自动更新，无需改代码
