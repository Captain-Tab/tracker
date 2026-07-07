# sodex-watch 每日镜像独立化

## 背景与目的

每日镜像当前与 WS 事件路径共用 `fetchAndReport`，WS 断连导致 `baselineLogged=false` 时镜像被劫持为 START WATCH，TG 不推送。

**目的**：每日镜像走独立的 REST 路径，不读写 `this.positions` / `this.lastPositions`，不与 WS 状态耦合。

## 选定方案

新增独立文件 `process/dailySnapshot.mjs`，导出 `dailySnapshot(ctx)` 函数。`AccountWatcher.scheduleDaily` 调用该函数，传入上下文参数。与 `fetchAndReport` 完全解耦。

## 设计概要

### 核心原则

- `dailySnapshot(ctx)` 是纯函数 + I/O，不依赖 `this`
- 使用局部变量，不读写调用方的 `this.positions` / `this.lastPositions`
- 空仓时调用 `reportSkipReason` 跳过 TG（与旧 `fetchAndReport` 行为一致）
- `buildTgMessage` 参数与旧 SNAPSHOT 路径一致（reduceOnly=`[]`, newPosIds=`new Set()`）

### 新文件：`process/dailySnapshot.mjs`

对外导出：

```
export async function dailySnapshot(ctx, retry = 0)
  ctx: { env, address, accountId, tgToken, tgChat, stateDir, label, historyLimit }
  returns: { accountId } — 调用方写回 this.accountId
```

内部逻辑：
1. 若 `accountId` 为空 → `resolveAccountIdViaChain(env, address)`
2. `Promise.all(fetchAccountState, fetchPositionHistory)`
3. REST 仓位转换为 `{symbol, size, entry, unrealizedPnl, leverage, liqPrice, marginMode}` 局部数组（对齐 `parseWsPosition` 格式，确保 `derivePositionView` 渲染链路完整）
4. 调用 `buildTgMessage(displayId, "SNAPSHOT", fmtTime(), positions, [], closeRecords, new Set(), historyLimit)`
5. `sendTelegram` + 条件 `saveLastPositions`
6. 失败 → `setTimeout` 重试 3 次 × 5 分钟

### watcher.mjs 改动

```javascript
import { dailySnapshot } from "./dailySnapshot.mjs";

scheduleDaily() {
  const ms = msUntilNextShanghai(this.at);
  this.dailyTimer = setTimeout(async () => {
    const result = await dailySnapshot({
      env: this.env, address: this.address, accountId: this.accountId,
      tgToken: this.tgToken, tgChat: this.tgChat,
      stateDir: this.stateDir, label: this.label, historyLimit: this.historyLimit,
    });
    if (result.accountId) this.accountId = result.accountId;
    this.scheduleDaily();
  }, ms);
}
```

### 清理项（fetchAndReport 中移除）

| 移除 | 行号 | 说明 |
|------|------|------|
| `this.forceReport` 字段 | 构造函数 line 67 | 仅 daily 用 |
| `const force = this.forceReport` | line 249 | 仅 daily 用 |
| `this.tgReason` 字段 | 构造函数 line 68 | 仅 daily 用 |
| `isOverview` 中 `\|\| this.tgReason === "daily"` | line 319 | daily 不再进入 |
| `kind` 中 `this.tgReason === "daily" ? "SNAPSHOT" :` | line 320 | 同上 |
| `this.tgReason = "event"` 赋值 | line ~349 | 清理残留 |

### 保留（不做任何修改）

| 保留 | 原因 |
|------|------|
| `this.lastOutFp` | 服务于**常规 WS 事件去重**（line 250 `if (!force && outFp === this.lastOutFp) return`），不是仅 daily 用 |
| `isBaseline` / `baselineLogged` | 不变 |
| `reportSkipReason` | 不变（daily 不再经过它） |
| `this.positions` / `this.lastPositions` | dailySnapshot 不读写，无竞态 |

### fetchAndReport 简化后的关键行

```javascript
// line ~249: 移除 force 变量
// line ~250: 简化为 if (outFp === this.lastOutFp) return;
const outFp = ...
if (outFp === this.lastOutFp) return;
this.lastOutFp = outFp;

// line ~319: isOverview = isBaseline（移除 tgReason）
const isOverview = isBaseline;

// line ~320: kind 简化（移除 SNAPSHOT 分支）
const kind = isBaseline ? "START" : classifyBanner(events, newPosIds).kind;
```

## 边界与约束

**包含：**
- 每日镜像走独立 REST 路径
- REST 失败重试 3 次 × 5 分钟
- 空仓也发 SNAPSHOT
- accountId 自动解析

**不包含：**
- HYPE-watch 改造
- WS 稳定性优化

**已知限制：**
- `buildTgMessage` 的 `marginSummary` / `withdrawable` 参数来自 WS，daily 传 null
- 平仓历史的 `newPosIds` 传空 Set（daily 不标 ⭐️）

## 集成点

| 文件 | 改动 |
|------|------|
| `service/sodex-watch/process/dailySnapshot.mjs` | **新建** — 独立 REST 快照函数 |
| `service/sodex-watch/process/watcher.mjs` | 导入 `dailySnapshot`、简化 `scheduleDaily`、`fetchAndReport` 移除 force/tgReason |

## 验收标准

- [ ] 每日 20:00 上海时间，5 个地址均收到 SNAPSHOT TG
- [ ] WS 断连后镜像仍正常推送
- [ ] REST 失败重试 3 次，全失败跳过
- [ ] `fetchAndReport` 无 `forceReport` / `tgReason` 残留
- [ ] WS 事件推送（OPEN/CLOSE 等）不受影响
- [ ] `lastOutFp` 去重逻辑保留且正确

## 验收场景

### 场景 1：正常每日镜像
- **Given** WS 在线，地址有 2 个持仓（AAVE SHORT size=336、US500 LONG size=32），accountId=17139
- **When** 20:00 上海时间到达
- **Then** TG 收到 SNAPSHOT，含当前仓位 2 个和最近 2 条平仓历史

### 场景 2：WS 断连后镜像
- **Given** WS 19:55 断连（baselineLogged=false），fetchAccountState 正常返回 2 个仓位
- **When** 20:00 触发
- **Then** TG 收到 SNAPSHOT（非 START WATCH），dailySnapshot 不碰 this.positions

### 场景 3：空仓镜像
- **Given** 地址当前无持仓，fetchAccountState 返回 positions=[]
- **When** 20:00 触发
- **Then** TG 收到 SNAPSHOT 显示「无持仓」

### 场景 4：REST 重试成功
- **Given** 第 1 次 fetchAccountState 抛异常，第 2 次正常返回
- **When** 20:00 触发
- **Then** 20:05 重试成功，TG 收到 SNAPSHOT

### 场景 5：3 次全部失败
- **Given** fetchAccountState 持续抛异常
- **When** 20:00 触发，20:05、20:10 均失败
- **Then** 日志「重试 3 次仍失败，跳过」，TG 无推送

### 场景 6：dailySnapshot 不干扰 WS 事件
- **Given** dailySnapshot 正在执行，WS 同时推送新仓位变化触发 fetchAndReport
- **When** 两者并发完成
- **Then** fetchAndReport 正常产生 diff 事件，dailySnapshot 正常推送 SNAPSHOT，互不覆盖
