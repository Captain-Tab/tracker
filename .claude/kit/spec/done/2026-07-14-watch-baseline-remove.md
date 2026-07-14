# watch 删除 baselineLogged / isBaseline 防御代码（逻辑层）

## 背景与目的

`sodex-watch` 和 `HYPE-watch` 的 `fetchAndReport` 中使用了 `baselineLogged` 布尔字段来区分"首次上报"和"后续上报"。首次上报（`isBaseline=true`）时，`kind` 被无条件设为 `"START"`，忽略 `diffPositions` 的计算结果。

这个设计引入于 commit `d4c03e8`（`fix(watch): prevent false OPEN events on WS reconnect`），目的是防止 WS 重连后持久化格式错位导致的假 OPEN。但它也同时吞掉了重连期间的真 OPEN——`diffPositions` 正确计算出 `OPENED` 事件，但被 `kind="START"` 覆盖。

Spec A 修复了持久化格式错位（假 OPEN 的根因），本 Spec 删除不再需要的防御代码。

**目标**：删除 `baselineLogged` 字段和所有 `isBaseline`/`kind="START"` 无条件覆盖逻辑。首次启动用 `!this.hasEverReported` 替代（只升不降），WS 重连后正常走 `classifyBanner`。

**⚠️ 硬依赖**：Spec A 必须先于本 Spec 部署。若本 Spec 单独部署，`saveLastPositions` 仍写 `coin:"undefined"`，导致每周期被 `loadLastPositions` 过滤 → `lastPositions` 始终为空 → `hasEverReported` 在重启后失效。

## 选定方案

删除 `baselineLogged`，新增 `hasEverReported`（只升不降，完成首次上报后永久为 true）：

- `baselineLogged` 字段删除
- `onclose` 中的 `baselineLogged = false` 删除
- 新增 `this.hasEverReported = false`（构造函数）
- `isBaseline` 判断 → `const hasNoBaseline = !this.hasEverReported`
- fetchAndReport 末尾：`this.hasEverReported = true`
- `kind = isBaseline ? "START" : classifyBanner(...)` → 始终用 `classifyBanner`（首次无基线时 events 为空 → classifyBanner 返回 null → 走 console 留痕不推 TG）
- Layer 2 REST 交叉验证触发条件：`isBaseline` → `hasNoBaseline`（仅首次启动）
- 首次启动不发 TG：因为 `lastPositions=[]` 且 `this.positions` 建立的基线全部是新仓位，`diffPositions` 会产 OPENED。首帧应静默建基线。但**如果首帧 events 非空**（这只会发生在过渡期旧格式被过滤后 WS 已有仓位的情况），走 `isOverview` 分支 → `reportGate` 检查 isNew → TG 可能仍被跳过。

### 关键区别：`hasEverReported` vs `baselineLogged`

| | baselineLogged（旧） | hasEverReported（新） |
|---|---|---|
| 首次启动 | false | false |
| 完成首次 fetchAndReport | true | true |
| WS 重连后 | false ⚡（重置） | true ✅（不重置） |
| 全部平仓后 | true（不变） | true（不变） |
| 全部平仓后重开 | false→true（此前一直在运行） | true（已是 true）→ classifyBanner → OPEN ✅ |

## 设计概要

### sodex-watch `watcher.mjs` 改动

| 位置 | 当前 | 改为 |
|------|------|------|
| 构造函数 | `this.baselineLogged = false;` | `this.hasEverReported = false;` |
| L123 onclose | `this.baselineLogged = false;` | 删除 |
| L261 | `if (this.baselineLogged) newPosIds.add(...)` | `if (this.hasEverReported) newPosIds.add(...)` |
| L263-265 | `isBaseline = !this.baselineLogged; this.baselineLogged = true` | 删除，改为 `const hasNoBaseline = !this.hasEverReported;` |
| L268 | `if (isBaseline && this.stateDir)` | `if (hasNoBaseline && this.stateDir)` |
| L293 | `if (!isBaseline && hasClosed && ...)` | `if (!hasNoBaseline && hasClosed && ...)` |
| L310 | `exitChanges = isBaseline ? [] : ...` | `exitChanges = hasNoBaseline ? [] : ...` |
| L314 | `isOverview = isBaseline` | `isOverview = hasNoBaseline` |
| L315 | `kind = isBaseline ? "START" : classifyBanner(...).kind` | `kind = hasNoBaseline ? "START" : classifyBanner(events, newPosIds).kind` |
| fetchAndReport 末尾 | （无） | 新增 `this.hasEverReported = true;`（在 L347 之后） |

### HYPE-watch `watcher.mjs` 改动

| 位置 | 当前 | 改为 |
|------|------|------|
| 构造函数 | `this.baselineLogged = false;` | `this.hasEverReported = false;` |
| L133 onclose | `this.baselineLogged = false;` | 删除 |
| L296 | `if (this.baselineLogged) newOids.add(...)` | `if (this.hasEverReported) newOids.add(...)` |
| L298-299 | `isBaseline = !this.baselineLogged` | 删除，改为 `const hasNoBaseline = !this.hasEverReported;` |
| L303 | `if (isBaseline && this.stateDir)` | `if (hasNoBaseline && this.stateDir)` |
| L328 | `this.baselineLogged = true;` | 删除 |
| L331 | `exitChanges = isBaseline ? [] : ...` | `exitChanges = hasNoBaseline ? [] : ...` |
| L335 | `isOverview = isBaseline` | `isOverview = hasNoBaseline` |
| L336 | `kind = isBaseline ? "START" : classifyBanner(...)` | `kind = hasNoBaseline ? "START" : classifyBanner(events).kind ...` |
| fetchAndReport 末尾 | （无） | 新增 `this.hasEverReported = true;`（在 L368 之后） |

### HYPE 端额外修复：Layer 2 覆盖后恢复 `lastPositions`

HYPE watcher 的 Layer 2（L303-326）将 `this.lastPositions = persisted`，之后没有像 sodex L305 那样的无条件覆盖。这导致重启首周期 write 回旧数据。

修复：在 Layer 2 块之后、`this.hasEverReported = true` 之前（或在 L318 之后立即）加：

```js
// Layer 2 用 persisted 覆盖了 lastPositions 用于 diff，现在恢复为当前真实仓位供 save 使用
this.lastPositions = this.positions;
```

实际位置：L327 之后（Layer 2 块结束处）。

## 边界与约束

| 项 | 处理 |
|----|------|
| 包含 | sodex-watch + HYPE-watch 的 `baselineLogged`/`isBaseline` 删除 + `hasEverReported` 新增 |
| 不包含 | `reportGate.mjs`（不删，dailySnapshot 仍用它）、discovery/observing/copy 模块、Spec A 改动 |
| 首次启动 | `hasNoBaseline=true` → 等效 isBaseline → 静默建基线，不发 TG |
| WS 重连 | `hasEverReported` 不重置 → `hasNoBaseline=false` → classifyBanner → 真 OPEN 正常推送 |
| 全部平仓后重开 | `hasEverReported=true` → classifyBanner → OPEN → TG ✅ |
| 硬依赖 Spec A | 必须先部署 Spec A。若单独部署本 Spec，重启后 `loadLastPositions` 返回 `[]`（旧格式被过滤）→ `hasEverReported` 重启后也是 false → 行为维持首次启动 → TG 永远没事件 |

## 集成点

| 文件 | 改动 |
|------|------|
| `service/sodex-watch/process/watcher.mjs` | 删除 `baselineLogged`，新增 `hasEverReported`，`isBaseline`→`hasNoBaseline` |
| `service/HYPE-watch/process/watcher.mjs` | 同上 + Layer 2 后补充 `this.lastPositions = this.positions` |

## 验收标准

- [ ] `baselineLogged` 字段在两端的 watcher 中完全删除
- [ ] WS 重连后首帧不吞真 OPEN（1256 场景回放：断连期间开仓 → 重连后 TG 推 OPEN）
- [ ] 首次启动仍静默建基线（不发假 OPEN）
- [ ] **全部平仓后重新开仓**：TG 正常推送 OPEN（不吞事件，这是 `hasEverReported` 修复的回归）
- [ ] 正常运行中开仓/加仓/减仓/平仓行为不变
- [ ] 现有单测不退化（sodex 21 + HYPE 14）
- [ ] `node --check` 两端 watcher 通过

## 验收场景

### 场景 1：WS 重连期间开仓 → 推 OPEN（1256 场景）
- **Given** sodex-watch 监控 0x5d...1256，`lastPositions` 无 XAUt 仓位，`hasEverReported=true`。WS 因 code=1006 断连
- **When** WS 重连，首帧含 XAUt 25x LONG size=12.8267（断连期间新开）
- **Then** `hasNoBaseline=false` → `diffPositions` 返回 `["OPENED LONG XAUt"]` → `classifyBanner` → kind="OPEN" → TG 推送 🟢 OPEN POSITION

### 场景 2：WS 重连后仓位未变 → 无事件
- **Given** `lastPositions=[{symbol:"XAUt-USD", posSide:"LONG", coin:"XAUt", dir:"LONG", size:12.8}]`，WS 断连后重连，仓位仍为 12.8
- **When** `diffPositions(lastPositions, positions)` 比较
- **Then** key "XAUt:LONG" 匹配 → 无 diff → `events=[]` → 不触发 TG 推送

### 场景 3：首次启动 → 静默建基线
- **Given** 首次部署，`hasEverReported=false`，`lastPositions=[]`，WS 首帧含 3 个仓位
- **When** `fetchAndReport` 触发，`hasNoBaseline=true`
- **Then** `kind="START"` → isOverview=true → TG 走 reportGate（isNew ? 推 : 跳过）→ `hasEverReported=true`

### 场景 4：全部平仓后重开 → 推 OPEN（回归防御）
- **Given** `hasEverReported=true`，`lastPositions` 含 XAUt size=12.8。用户平仓 → `lastPositions` 变为 `[]`（save 的 `length>0` guard 可能不写磁盘，但内存中正确为空）。用户重新开仓 XAUt size=20
- **When** `fetchAndReport` 触发，`hasNoBaseline=false`
- **Then** `diffPositions([], [XAUt:20])` → `["OPENED LONG XAUt 20"]` → `classifyBanner` → kind="OPEN" → TG 推送 ✅（不会被吞为 START）

### 场景 5：正常运行加仓 → 行为不变
- **Given** `lastPositions=[{symbol:"XAUt-USD", posSide:"LONG", ..., size:12.8}]`，WS 推送新帧 size=20
- **When** `diffPositions` → size 变 → `classifyBanner` → INCREASE
- **Then** TG 推送 📈 INCREASE POSITION

### 场景 6：HYPE 端对称行为
- **Given** HYPE-watch 监控地址，WS 断连后重连，新开了仓位。`hasEverReported=true`
- **When** 同场景 1 逻辑，HYPE 端 `diffPositions` key 用 coin/dir
- **Then** TG 推送 🟢 OPEN POSITION（两端行为一致）

### 场景 7：重启后 HYPE Layer 2 写入正确数据（额外修复）
- **Given** HYPE-watch 重启，Layer 2 加载 persisted=旧数据，REST 返回新仓位
- **When** Layer 2 执行 `this.lastPositions = persisted`（用于 diff），然后 `this.lastPositions = this.positions`（修复写入）
- **Then** `saveLastPositions` 写入的是当前真实仓位（非旧数据），下次重启不循环读旧值
