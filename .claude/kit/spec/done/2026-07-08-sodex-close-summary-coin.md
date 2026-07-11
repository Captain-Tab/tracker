# sodex-watch CLOSE 摘要 undefined 修复

## 背景与目的

CLOSE 事件 TG 消息中"平仓摘要"（`closedSummaries`）币名显示 `undefined`：
```
平仓：undefined LONG
```
而同帧的"平仓历史"渲染正确显示 `US500`。

**根因**：摘要币名来自 `events` 字符串（`diffPositions` → `lastPositions` → `baseCoin(p.symbol)`），而平仓历史币名来自 `histRecords` 的 `symbolId`（REST API → `symbolMeta(r.symbolId).baseCoin`）。当 `lastPositions` 格式缺少 `symbol` 字段时，`baseCoin(undefined)` 返回 `"undefined"`。

两种缺 `symbol` 的来源：
- 持久化格式 `{coin, dir, size}` — `lastPositionsStore.mjs:19-23`
- REST 兜底格式 `{coin, dir, size, entry}` — `watcher.mjs:275-280`

**目的**：统一摘要和平仓历史的币名来源，消除对 `lastPositions` 格式的依赖。

## 选定方案

将 `closedSummaries` 构造从"事件字符串 split"改为"histRecords + symbolMeta"——与平仓历史渲染完全同源。

核心理由：
1. `histRecords` 在同一帧已拉取，数据可用
2. `symbolMeta(r.symbolId).baseCoin` 不依赖任何内存中仓位格式
3. G5/G6 守卫（`watcher.mjs:295-298`）确保 `events` 含 CLOSE 时 `newPosIds` 必非空（否则 2s 重试）；反向不保证但新方案只依赖 `newPosIds` 不依赖 `events`，跨帧场景独立覆盖
4. 被删除的两条旧路径均依赖 `lastPositions` 字段格式，其中备线的 Layer 3 守卫（`prevCoins`）在 WS 格式下已失效（`p.coin = undefined` → `Set{undefined}` → `has("US500")` 永远 false）

## 设计概要

### 替换范围

`watcher.mjs` `buildEventMessages` 方法，第 375-388 行。

**旧代码（两路分支）**：
```javascript
let closedSummaries = events.filter(...).map(e => {
  const [, dir, coin] = e.split(" "); return { coin, dir };  // 主线：依赖 events 格式
});
if (!closedSummaries.length && newPosIds.size) {
  const prevCoins = new Set(prevPositions.map(p => p.coin));  // 备线：依赖 p.coin（WS 格式无此字段）
  const affected = [...];  // 用 symbolMeta 取币名，但被 prevCoins.has(c) 拦掉
  if (affected.some(c => prevCoins.has(c))) { ... }  // prevCoins = Set{undefined}，永远匹配不到
}
```

**新代码（单路）**：
```javascript
let closedSummaries = [];
if (newPosIds.size) {
  const seen = new Set();
  for (const r of histRecords) {
    if (!newPosIds.has(r.positionId)) continue;
    const coin = symbolMeta(r.symbolId).baseCoin || `#${r.symbolId}`;
    const dir = RECORD_SIDE_DIR[Number(r.positionSide ?? 0)] ?? "";
    if (!dir) continue;
    const dedupKey = `${coin}:${dir}`;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);
    closedSummaries.push({ coin, dir });
  }
}
```

关键决策：
- `|| `#${r.symbolId}``：缓存缺失时显示 `#xx`（与 `renderPositionHistory:228-229` 行为一致）
- `RECORD_SIDE_DIR` 取方向：与旧备线（`watcher.mjs:385`）完全一致。与 `positionDirection(p)` 不等价（后者可回退到 `Number(p.size) < 0`），但旧主线正是此次要替换的 `undefined` 路径，且 API 实测 `position_side` 始终为 2 或 3
- `dedupKey` 按 `coin:dir` 去重：同币同方向关多个仓位时摘要不重复（旧主线不去重，此为改进）
- `!dir` 跳过：`position_side` 非法值时静默丢弃该条

## 边界与约束

**包含：**
- `closedSummaries` 构造逻辑替换
- 币名来源统一为 `symbolMeta(r.symbolId).baseCoin`

**不包含：**
- `lastPositions` 持久化格式修复（`{coin,dir,size}` → 补 `symbol`）——另案处理
- OPEN/INCREASE/DECREASE 消息的币名修复（仍依赖 `baseCoin(p.symbol)`）——影响面独立
- REST 兜底 `restCurr` 格式修复——另案处理

**已知限制：**
- 下架币（如 symbol_id 78）缓存未命中 → 显示 `#78`（与平仓历史渲染行为一致）
- 缓存完全空（`refreshSymbols` 失败且未兜底）→ 全部显示 `#xx`

## 集成点

| 文件 | 改动 |
|------|------|
| `service/sodex-watch/process/watcher.mjs` | `buildEventMessages` 方法内 `closedSummaries` 构造逻辑替换（14 行 → 13 行） |

无新增文件、无新增导入。`symbolMeta` 和 `RECORD_SIDE_DIR` 已在当前文件导入。

## 验收标准

- [ ] CLOSE TG 摘要行显示正确币名（非 `undefined`）
- [ ] 同币同方向多仓位同时平仓时摘要不重复
- [ ] 跨帧平仓（`diffPositions` 未抓到 CLOSE 但 `newPosIds` 有）正常显示
- [ ] G5/G6 重试后摘要正常
- [ ] baseline（START WATCH）不受影响
- [ ] OPEN/INCREASE/DECREASE TG 不受影响
- [ ] 离场单 TG 不受影响

## 验收场景

### 场景 1：正常平仓（Happy Path）
- **Given** PLTR赚持有 US500 LONG 仓位（`symbol="US500-USD"`, `posSide="LONG"`, size=32.551），WS 在线
- **When** 目标平仓，WS 推送新快照（US500 不在 P 数组中）。`diffPositions` 检测到 CLOSE，`fetchPositionHistory` 返回 `symbol_id=34` 的 close record
- **Then** TG 收到 CLOSE 消息，摘要行显示 `平仓：US500 LONG`，平仓历史显示 `⭐️ US500 做多 全平`

### 场景 2：WS 断连后重启 → 再平仓
- **Given** 服务重启，`lastPositions` 先被 REST 兜底格式污染（无 `symbol`），后被第二帧 WS 数据恢复。此后目标平仓
- **When** CLOSE 事件触发
- **Then** 摘要行从 `histRecords` 取币名，不依赖 `lastPositions` 格式，显示正确

### 场景 3：跨帧平仓（diffPositions 未检测到）
- **Given** 仓位在帧 N 关闭，但 WS 快照延迟到达，`diffPositions` 未检测到 CLOSE。帧 N+1 时 `newPosIds` 包含该 close record
- **When** `buildEventMessages` 执行
- **Then** 摘要行从 `histRecords` 获取 `symbolId` → `symbolMeta` 解析，显示正确币名

### 场景 4：同币同方向多仓位同时平仓
- **Given** 同一 coin+dir 有 2 个独立仓位（如 2 个 US500 LONG 仓位），同一帧全部平仓。`newPosIds` 有 2 个不同 position_id
- **When** `buildEventMessages` 执行
- **Then** 摘要行去重，只显示一条 `平仓：US500 LONG`

### 场景 5：币名缓存缺失
- **Given** 平仓的 symbol_id 不在 `symbolsById` 中（下架币），`symbolMeta(symbolId).baseCoin` 返回 `""`
- **When** `buildEventMessages` 执行
- **Then** 摘要行显示 `平仓：#78 SHORT`，与平仓历史渲染行为一致
