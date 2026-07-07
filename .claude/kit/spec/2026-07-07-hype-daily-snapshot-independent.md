# HYPE-watch 每日镜像独立化

## 背景与目的

HYPE-watch 每日镜像通过 `scheduleDaily → scheduleFetch → fetchAndReport` 路径，与 WS 事件路径耦合。WS 断连 `baselineLogged=false` 时，`kind` 三元 `isBaseline ? "START" : daily ? "SNAPSHOT"` 中 `isBaseline` 优先，镜像被劫持为 START WATCH，已知地址不推 TG。VPS 日志 2026-07-07 13:00 UTC 确认 6 个地址全部 START WATCH，TG 零推送。

**目的**：与 sodex-watch 一致——新增 `dailySnapshot.mjs` 独立 REST 模块，`scheduleDaily` 直接调用，不经过 `fetchAndReport`。

## 选定方案

新建 `HYPE-watch/process/dailySnapshot.mjs`，REST 路径：`fetchClearinghouseState`(native+xyz) 拿仓位 + `fetchUserFills` 拿平仓历史。`scheduleDaily` 改为调用 `dailySnapshot(ctx)`。

## 设计概要

### dailySnapshot(ctx)

```javascript
export async function dailySnapshot(ctx, retry = 0) {
  // ctx: { env, address, tgToken, tgChat, stateDir, label, historyLimit }
  try {
    // 并行拉 native + xyz 仓位 + 平仓历史
    const [csNative, csXyz, fills] = await Promise.all([
      fetchClearinghouseState(ctx.env, ctx.address),
      fetchClearinghouseState(ctx.env, ctx.address, "xyz"),
      fetchUserFills(ctx.env, ctx.address),
    ]);

    // 合并 native + xyz 仓位，用 parsePositions 格式
    const nativePos = parsePositions(csNative?.assetPositions, szDecimalsOf);
    const xyzPos = parsePositions(csXyz?.assetPositions, szDecimalsOf);
    const positions = [...nativePos, ...xyzPos];

    // 平仓历史：parseCloseRecords(fills)
    const closeRecords = parseCloseRecords(fills);

    // 空仓跳过 TG
    const hasOpen = positions.length > 0;
    const skipReason = reportSkipReason({ kind: "SNAPSHOT", hasOpenPositions: hasOpen, isNew: false });
    if (skipReason) { log(skipReason); }
    else {
      buildTgMessage(displayId, "SNAPSHOT", fmtTime(), positions, [], closeRecords, new Set(), ctx.historyLimit ?? 2);
      sendTelegram(...);
    }

    // 持久化
    if (ctx.stateDir && positions.length > 0) saveLastPositions(...);
  } catch (e) {
    // 重试 3 次 × 5 分钟
  }
}
```

### scheduleDaily 改造

旧：`forceReport=true; tgReason="daily"; scheduleFetch(true)`
新：`dailySnapshot({env, address, tgToken, tgChat, stateDir, label, historyLimit})`

### 清理项（fetchAndReport）

与 sodex-watch 相同：
- 移除 `forceReport` / `tgReason` 字段
- 简化 `kind`：`isBaseline ? "START" : classifyBanner(...).kind`
- 简化 `isOverview`：`isBaseline`
- 保留 `lastOutFp`（WS 事件去重）
- 移除 G5/G6 中 `!force` 守卫

## 边界与约束

**包含：**
- HYPE-watch 每日镜像独立 REST 路径
- native + xyz 双 dex 仓位合并
- REST 失败重试 3 次 × 5 分钟
- 空仓时 `reportSkipReason` 跳过 TG

**不包含：**
- WS 稳定性优化
- 其他 HYPE-watch 重构

**已知限制：**
- `userFills` 最多 2000 条，平仓历史可能不完整（与旧行为一致）
- `buildTgMessage` / `renderPositions` 的 `marginSummary`/`withdrawable` 参数为死参数（render 不消费），传 `undefined` 即可

## 集成点

| 文件 | 改动 |
|------|------|
| `service/HYPE-watch/process/dailySnapshot.mjs` | **新建** |
| `service/HYPE-watch/process/watcher.mjs` | `scheduleDaily` 调用 `dailySnapshot(ctx)`，移除 `forceReport`/`tgReason` |

## 验收标准

- [ ] 每日 21:00 上海时间，6 个地址均收到 SNAPSHOT TG
- [ ] WS 断连后镜像仍正常推送
- [ ] 有 xyz 仓位的地址正确定显示 xyz 仓位
- [ ] 空仓地址不推 TG
- [ ] `fetchAndReport` 无 `forceReport`/`tgReason` 残留

## 验收场景

### 场景 1：正常镜像
- **Given** 地址 ②ETH+BTC 有 1 个 ETH SHORT 仓位（600 ETH, $1.06M），时间 21:00 上海
- **When** `dailySnapshot` 执行
- **Then** TG 收到 SNAPSHOT，显示 ETH 5x SHORT、标记价/未结盈亏/强平价

### 场景 2：xyz 仓位
- **Given** 地址 多仓高手 有 SOL + xyz:CRCL + xyz:MSTR 等仓位
- **When** `dailySnapshot` 执行
- **Then** TG 同时显示 native 和 xyz 仓位

### 场景 3：WS 断连后镜像
- **Given** WS 在 20:55 断连，`baselineLogged=false`，REST 正常
- **When** 21:00 触发
- **Then** TG 收到 SNAPSHOT（非 START WATCH）

### 场景 4：空仓
- **Given** 地址当前无持仓
- **When** 触发
- **Then** log「定时镜像：当前无持仓，跳过 Telegram 推送」，TG 不推
