# observing ⑥ API transient error grace period

## 背景

HYPE-discovery ⑥ observing 阶段（`observing.mjs`）在移除 stale 条目时，依赖 `evalEliminated`（来自 ③ evaluate 阶段）提供的淘汰原因。当 `fetchUserFills` 因 transient API 错误耗尽重试仍失败时，条目被标记淘汰，observing 将其移出观察态，streak 中断。

**实测案例**：`0x005844b2ffb2e122cf4244be7dbcb4f84924907c`（907c）在 2026-07-12 的 evaluate 中因 HTTP 429 拉取失败，从 observing 被移除。手动重拉成功（2,000 fills），说明是 transient 错误非地址问题。

**数据统计**：
- HYPE-discovery：4 次 transient API 失败（~1.3%，300 候选池，全为 HTTP 429/503）
- sodex-discovery：1 次（~0.3%，~100 候选池）
- 两端已有 `MAX_RETRIES=6` + exp backoff（2s→4s→8s→16s→32s→60s, ±20% jitter）仍无法覆盖 API 全局限流时的所有请求

**风险不对称**：
- False positive（保留无效条目）：1 条 300B JSON，零成本
- False negative（移除有效条目）：streak 归零，升 watch 延迟 2 周

## 目标

observing ⑥ 阶段对 transient API 错误做 1 周 grace period——不因单次 API 抖动断 streak。

## 改动范围

| 文件 | 模块 | 改动 |
|------|------|------|
| `service/HYPE-discovery/process/observing.mjs` | HYPE | 移除逻辑加 API 错误 guard + `buildObservingTgMessage` 加 `retained` 参数 |
| `service/sodex-discovery/process/observing.mjs` | sodex | 同构同步 |
| `service/HYPE-watch/watch-observing.json` | HYPE | 条目 schema 加 `apiRetries` 字段（可选，缺失默认 0） |
| `service/sodex-watch/watch-observing.json` | sodex | 同构 |

## 排除

- evaluate 层的 `postInfoWithRetry` / `fetchWithRetry`（已有 6 次重试，不改）
- 非 API 错误的淘汰原因（`掉出榜单` / `HFT` / `样本不足` 等，照常移出）
- leaderboard 层面的 429（不在 scored 里，自然不在 observing）
- watch / discovery ⑤ 输出 / ⑦ shadow / copy 模块
- systemd / cron / app 编排（不增新 timer 或并发锁）

## 设计

### 1. 判断 transient API 错误

在 `observing.mjs` 的移除段，对被移出条目检查 `elimReason`：

```js
/**
 * 判断淘汰原因是否为 transient API 错误（应保留而非移出）。
 * 匹配 evaluate 层用尽重试后抛出的 error.message。
 * Node 18+ 内置 fetch (undici) 的 TypeError message 为 "fetch failed"，
 * 其原始错误码在 error.cause.code 中（不再单独加 regex——"fetch failed" 已覆盖）。
 */
function isTransientApiError(reason) {
  if (!reason) return false;
  return /HTTP\s*(429|409|503)|fetch\s*failed|abort/i.test(reason);
}
```

**匹配逻辑**：
- `HTTP 429` / `HTTP 503` — HYPE API 限流/不可用（`THROTTLE_STATUSES`）
- `HTTP 409` — sodex API 限流（`THROTTLE_STATUSES` 含 409，HYPE 侧不匹配但无副作用）
- `fetch failed` — Node 18+ undici `TypeError` 外层 message（覆盖 `ECONNREFUSED`/`ETIMEDOUT`/`ENOTFOUND` 等网络错误）
- `abort` — `AbortError`（10s 超时触发；HYPE `postInfoWithRetry` 和 sodex `fetchWithRetry` 均使用 `AbortController`）

**匹配** → 走 grace period（保留）
**不匹配** → 照常移出

### 2. 连续失败上限 + apiRetries 安全读写

条目 schema 加 `apiRetries` 字段：

| 字段 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `apiRetries` | `number` | 0 | 连续 API 失败计数；本周正常通过 → 清零 |

**安全读取**（防御 NaN / Infinity / string / null / 负数污染）：
```js
const retries = Number.isFinite(entry.apiRetries) && entry.apiRetries >= 0 ? entry.apiRetries : 0;
```

**流程**：
```
本周在 scored 中 → apiRetries=0 → 正常续命/结算
本周不在 scored 中 + elimReason 是 API transient → apiRetries++
    apiRetries == 1 → 保留（weeksSeen 不变，不断 streak）
    apiRetries >= 2 → 移除（连续 2 周 API 失败，判定为永久问题）
本周不在 scored 中 + elimReason 非 API → 照常移除
```

### 3. TG 消息

新增 ⚠️ 段，在 🔴 段之后、🟡 段之前：

```
⚠️ 本周 API 错误暂留（下周重试）
  📡 0x0058…907c 上周评分63.1 · HTTP 429
```

空段不展示。`buildObservingTgMessage` 签名加 `retained` 参数（默认 `[]`）。

**TG early-return 修正**：
```js
// 旧：仅检查 promoted/removed/watching
if (!promoted.length && !removed.length && !watching.length) return null;
// 新：加入 retained
if (!promoted.length && !removed.length && !watching.length && !retained.length) return null;
```

### 4. 兜底与异常

| 异常 | 处理 |
|------|------|
| `apiRetries` 字段缺失（旧条目） | `Number.isFinite(undefined)` → false → 默认 0 |
| `apiRetries` 被污染（NaN/Infinity/-1/"1"/null） | `Number.isFinite` + `>= 0` 双重守卫，不满足 → 0 |
| `elimReason` 为 null/undefined | `isTransientApiError(null)` → false → 照常移除 |
| `AbortError` timeout（`"The operation was aborted"`） | regex `/abort/i` 匹配 → 保留 |
| VPS 断电/进程崩溃 | observing 异常 try/catch 不中断 ①-⑤（已有）；`apiRetries` 写盘后即持久化 |
| JSON 读写损坏 | `loadObserving` 已有 `catch → {}` 容错；损坏文件被替换为空对象 → 全部条目丢失，下次重建从 0 开始 |
| sodex 旧条目无 `accountId` + API 错误 | elimReason key 用 `address`（小写），sodex 的 evalEliminated 同为 `address` key，不受 accountId 差异影响 |
| dry-run 模式 | 保留逻辑同样生效（验证用），写盘跳过 |
| 连续 2 次 API 失败 | `apiRetries >= 2` → 真移除，进 🔴 段；日志记 `observing: 移除（连续2次API失败）` |
| TG 仅含 retained 无其他段 | early-return 加入 `retained.length` 判断 → 正常推送 ⚠️ 段（不静默） |

## 验收场景

### G1: API 429 首次 → 保留

```
Given: watch-observing.json 中 907c（apiRetries=0, weeksSeen=["2026-W28"]）
      本周 scored 中无 907c（因 evaluate 429 淘汰）
      evalEliminated: [{address:907c, reason:"画像拉取失败: HTTP 429 info userFills"}]
When: observing(scored, evalEliminated, ctx)
Then: 907c 保留在 obs 中
      apiRetries=1, weeksSeen=["2026-W28"]（不新增本周）
      retained= [{address:907c, lastScore:63.1, reason:"HTTP 429", apiRetries:1}]
      TG 消息包含 ⚠️ 段 "本周 API 错误暂留（下周重试）"
```

### G2: 连续 2 次 429 → 移出

```
Given: watch-observing.json 中 907c（apiRetries=1, weeksSeen=["2026-W28"]）
      本周 scored 中无 907c（再次 429）
When: observing(scored, evalEliminated, ctx)
Then: 907c 被移出 obs
      removed= [{address:907c, reason:"连续2次API拉取失败: HTTP 429"}]
      TG 消息包含 🔴 段（非 ⚠️）
```

### G3: API 错误后恢复正常 → apiRetries 清零

```
Given: watch-observing.json 中 907c（apiRetries=1, weeksSeen=["2026-W28"]）
      本周 scored 中有 907c（API 恢复）
When: observing(scored, evalEliminated, ctx)
Then: 907c 保留，apiRetries=0, weeksSeen=["2026-W28","2026-W29"]
```

### G4: 非 API 错误 → 照常移出

```
Given: watch-observing.json 中 xyz（apiRetries=0）
      本周 scored 中无 xyz
      evalEliminated: [{address:xyz, reason:"掉出榜单（pnl/量下滑）"}]
When: observing(scored, evalEliminated, ctx)
Then: xyz 被移出（行为不变）
```

### G5: HFT 淘汰 → 照常移出

```
Given: watch-observing.json 中 xyz
      evalEliminated: [{address:xyz, reason:"HFT 30.3 笔交易/天 > 5"}]
When: observing(scored, evalEliminated, ctx)
Then: xyz 被移出（行为不变）
```

### G6: ⚠️ 段为空 → 静默

```
Given: retained=[], promoted=[], removed=[], watching=[]
When: buildObservingTgMessage(decisions, dayLabel)
Then: 返回 null（不推 TG）
```

### G7: 仅 retained 有内容 → 正常推送 ⚠️ 段

```
Given: retained=[{address:907c, ...}], promoted=[], removed=[], watching=[]
When: buildObservingTgMessage(decisions, dayLabel)
Then: TG 消息含 ⚠️ 段，不返回 null
```

### G8: dry-run 保留逻辑

```
Given: ctx.dryRun=true, 907c 命中 API 错误
When: observing(scored, evalEliminated, ctx)
Then: stdout 打印 ⚠️ 段内容；不写 obs 文件、不发 TG
```

### G9: sodex 同构

```
Given: sodex-observing 中条目因 HTTP 409 被移出
When: observing(scored, evalEliminated, ctx) in sodex
Then: HTTP 409 匹配 /HTTP\s*409/ → 保留
      sodex 口径差异（walletAddress 归一 + accountId 存储）不受影响
```

### G10: apiRetries 被 NaN 污染 → 默认 0

```
Given: watch-observing.json 中条目 apiRetries=NaN
      evalEliminated: [{address:addr, reason:"画像拉取失败: HTTP 429..."}]
When: 读取条目，Number.isFinite(NaN) → false → retries=0
Then: retries++ → 1 → 保留
```

### G11: apiRetries 被负数/字符串污染 → 默认 0

```
Given: 条目 apiRetries=-1 (或 "1" string)
When: 读取条目，Number.isFinite(-1) = true 但 -1 >= 0 = false → retries=0
      (或 Number.isFinite("1") = false → retries=0)
Then: retries++ → 1 → 保留
```

### G12: AbortError timeout → 保留

```
Given: evalEliminated: [{address:addr, reason:"画像拉取失败: The operation was aborted"}]
When: isTransientApiError("画像拉取失败: The operation was aborted")
Then: /abort/i 匹配 → true → 保留
```

### G13: fetch failed 网络错误 → 保留

```
Given: evalEliminated: [{address:addr, reason:"画像拉取失败: fetch failed"}]
When: isTransientApiError("画像拉取失败: fetch failed")
Then: /fetch\s*failed/i 匹配 → true → 保留
```

## 涉及文件

- `service/HYPE-discovery/process/observing.mjs` — `observing()` + `buildObservingTgMessage()` + 新增 `isTransientApiError()`
- `service/sodex-discovery/process/observing.mjs` — 同构
- `service/HYPE-discovery/process/observing.mjs` — `__internals` 导出加 `isTransientApiError`

## 不复用件 / 不入库件

- 不改 `tool/watchCandidates.mjs`
- 不改 evaluate / api / score / output / shadow
- 不改 app / systemd / config

## 约束

- 两端的 `isTransientApiError()` 各自内联（不抽共享模块）
- `apiRetries` 字段仅 observing 自管自用，shadow ⑦ ledger 不记录
- `Number.isFinite(entry.apiRetries) && entry.apiRetries >= 0` 双重守卫，防止 JSON 手动编辑/程序错误引入的污染值

<!-- SUBAGENT-REVIEW: 2026-07-12, found 3 critical + 8 warnings, all fixed -->
