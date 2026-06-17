# Vault WS 推送事件

> 经 2026-04-24 实测验证（探针日志确认）

---

## 订阅 Topic

```
event:  SODEX_USER_NOTICE
topics: {address}@sodex_deposit   ← Deposit
        {address}@sodex_call_for  ← Withdraw + Unstake + Claim（后端 deferred）
```

> `sodex_withdraw` 是普通 Spot 提现通知，Vault 四操作不走这个 topic。  
> 实测：WS 连接正常，三个 topic 已全部订阅；后端不推 `sodex_call_for`。

---

## 四操作事件规格

### 1. Deposit（`VaultDepositWithPermit2`）— `@sodex_deposit` ✅ 后端已推

```ts
record: {
  token: "MAG7SSI" | "SMAG7SSI",   // vault 代币
  coin: string,                      // 展示用
  status: "Depositing" | "Success" | "Failed",
  amount: string,                    // wei
  decimals: number,                  // 8
  txHash: string,                    // 去重 key
  stmp: number,
}
```

**前端动作**：
- Pending → `notify.loading`
- Success（MAG7SSI/SMAG7SSI）→ `notify.success` + **invalidate vault queries** ← ✅ 已补

---

### 2. Withdraw（`VaultRedeemWithPermit`）— `@sodex_call_for` ❌ 后端 deferred

```ts
record: {
  callForType: 1,
  executeStatus: "Requesting" | "Bridging" | "Settling" | "Success" | "Failed",
  inCoinSymbol: "SMAG7SSI",          // 输入
  outCoinSymbol: "MAG7SSI" | "SMAG7SSI",
  inAmount: string,                   // wei
  decimals: number,
  callForId: string,                  // 去重 key
  stmp: number,
}
```

---

### 3. Unstake（`CreateBridgeCallFor`，sMAG7→MAG7）— `@sodex_call_for` ❌ 后端 deferred

```ts
record: {
  callForType: 1,                     // 与 Withdraw 共用
  executeStatus: "Requesting" | "Settling" | "Success" | "Failed",
  inCoinSymbol: "SMAG7SSI",
  outCoinSymbol: "MAG7SSI",
  inAmount: string,
  callForId: string,
}
```

> Withdraw（callForType=1）和 Unstake（callForType=1）用同一 callForType，通过 `inCoinSymbol`/`outCoinSymbol` 区分文案。

---

### 4. Claim（`CreateBridgeCallFor`，MAG7→Base chain）— `@sodex_call_for` ❌ 后端 deferred

```ts
record: {
  callForType: 2,
  executeStatus: "Requesting" | "Bridging" | "Success" | "Failed",
  inCoinSymbol: "MAG7SSI",
  outCoinSymbol: "MAG7SSI",           // Base chain
  inAmount: string,
  callForId: string,
}
```

---

## 现状汇总（2026-04-24 更新）

| 操作 | Topic | callForType | 后端 | 前端订阅 | 前端 handler |
|---|---|---|---|---|---|
| Deposit | `@sodex_deposit` | — | ✅ 推 | ✅ | ✅ toast + vault invalidation |
| Withdraw | `@sodex_call_for` | 1 | ❌ deferred | ✅ | ✅ **已实现**，等后端启用 |
| Unstake | `@sodex_call_for` | 1 | ❌ deferred | ✅ | ✅ **已实现**，等后端启用 |
| Claim | `@sodex_call_for` | 2 | ❌ deferred | ✅ | ✅ **已实现**，等后端启用 |

---

## 补齐计划

### 现在可做（不依赖后端）

Deposit 的 vault query invalidation 已在 `useDepositNotice` 补齐（2026-04-24）。

### 等后端启用 `sodex_call_for`

1. `depositNoticeDataService` 加第三条 subscribe（框架已有探针占位）
2. 新建 `handleCallForNotice(msg)`，按 `callForType` 分流：
   - `callForType=1`（Withdraw/Unstake）→ Pending/Success/Failed toast + invalidate `cooldown`/`mag7Balance`
   - `callForType=2`（Claim）→ Pending/Success/Failed toast + invalidate `cooldown`/`investInfo`
3. 去重逻辑用 `callForId`（无 txHash）

**验证方法**（5 分钟）：
```ts
// 已在 depositNoticeDataService 加探针，做一次真实 claim/unstake
// [DEBUG:WS:CALL_FOR] event=MESSAGE_RECEIVED 出现 → 后端已启用
```

---

## 关键字段差异

| | `sodex_deposit` / `sodex_withdraw` | `sodex_call_for` |
|---|---|---|
| 状态字段 | `record.status` | `record.executeStatus` |
| 币种字段 | `record.coin` / `record.token` | `record.inCoinSymbol` / `record.outCoinSymbol` |
| 区分类型 | `msg.type` | `record.callForType`（1=Withdraw/Unstake, 2=Claim）|
| ID 字段 | `record.txHash` | `record.callForId` |

---

## 老项目源文件索引

| 功能 | 文件 | 行号 |
|---|---|---|
| WS 订阅入口 | `src/models/spotOrder.ts` `startDepositWithdrawWebSocket` | 1430-1485 |
| deposit/withdraw handler | `src/models/spotOrder.ts` `handleDepositWithdrawMessage` | 1491-1683 |
| call_for 分流 | `src/models/spotOrder.ts` `handleStakeMessage` | 1689-1727 |
| unstake handler | `src/models/spotOrder.ts` `handleWithdrawMessage` | 1734-1823 |
| claim handler | `src/models/spotOrder.ts` `handleClaimMessage` | 1830-1898 |
