# 修复 banner 分类错误与离场单 "无持仓" 文案

> bugfix spec。目标文件：`service/sodex-watch/process/watcher.mjs`、`service/sodex-watch/process/render.mjs`

## 背景

### 症状

用户收到三条来自同一事件的 Telegram 消息：

1. `🏹 ORDER CANCELED` — 文案显示 `📊 仓位：无持仓`（实际有仓位）
2. `🔴 CLOSE POSITION` — 显示了正确持仓
3. Console banner 显示 `🟢 OPEN POSITION 开仓`（实际是平仓+反手，非单纯开仓）

### 根因链

`watcher.mjs:269-290` Layer 2 REST 兜底使用 `/api/v1/perps/accounts/{address}/state`（**仅返活跃仓位，不含已平仓**）覆盖 `this.positions`。若 REST 调用时某仓位已平，`restCurr` 中已无该仓位。

`watcher.mjs:305` 将 `this.positions = restCurr`（缺已平仓位）赋给 `this.lastPositions`。

下次事件时 `parse.mjs:140 diffPositions(lastPositions, this.positions)` 两输入均缺该已平仓位 → 不产生 `CLOSED` 事件。

→ `watcher.mjs:407 reducedCoins` 从 events 提取平仓币种，因 CLOSED 缺失，该币种未入集合

→ `watcher.mjs:414` cancel 过滤 `reducedCoins.has(baseCoin(o.symbol))` 不命中，cancel 未被跳过

→ `watcher.mjs:398` 找该币种活跃仓位，`find()` 返回 null

→ 渲染 "仓位：无持仓"

与此同时 `classifyBanner`（`render.mjs:107`）仅依赖 events（OPENED 优先于 CLOSED）→ 误判为 OPEN POSITION。

TG 事件流（`watcher.mjs:376-390`）用 `newPosIds`（平仓历史 position_id 集）独立检测平仓 → 正确推送 CLOSE POSITION，但与 console 结论矛盾。

## 修复

### 1. computeExitChanges 用 records + newPosIds 补全平仓币种

**签名变更**：`computeExitChanges(reduceOnly, events)` → `computeExitChanges(reduceOnly, events, records, newPosIds)`（当前调用处 `watcher.mjs:311` 中 `records` 和 `newPosIds` 均在作用域内，`records` 在第 251 行已定义）。

**函数体**：`reducedCoins` 从双源提取：

1. events 中 `DECREASED/CLOSED` 的币种（现有逻辑）
2. `newPosIds` 中的 position_id → `records.find(r => r.positionId === id)` → `symbolMeta(r.symbolId).baseCoin` 并入 `reducedCoins`

### 2. classifyBanner 加 CHANGE 分支

`render.mjs:107-116`：现有代码 L114 已含 `newClosedIds?.size > 0` 回退 → CLOSE。缺少的是：

OPENED + CLOSED 同时存在 → 返回 `{ kind: "CHANGE" }`（混合事件，不偏向 OPEN）。在 L109 `OPENED` 判定前插入：若 `verbs.includes("OPENED") && verbs.includes("CLOSED")` → 直接返回 CHANGE。

### 3. buildExitOrderMessage 无活跃仓位文案

`render.mjs` exit order message 函数：`pos` 为 null 时显示 `仓位已平仓` 而非 `无持仓`。

## 验收标准

- [ ] 同时平仓+撤单场景，TG 不再出现 "仓位：无持仓"，改为 "仓位已平仓"
- [ ] console banner 与 TG 结论一致（同事件同为 CLOSE 或 CHANGE）
- [ ] 正常开仓/平仓/增减仓场景不退化
- [ ] 多地址并发无相互污染

## 验收场景

### 场景 1：平仓+撤单同批次

- **Given** 账户持有 LIT SHORT + US500 SHORT，同时平掉 LIT 并撤销 LIT 离场单
- **When** WS 推送包含两项变化的 accountState
- **Then** ① TG 不出现 "仓位：无持仓" ② TG 出现 CLOSE POSITION（含 LIT 平仓历史 ⭐️）③ cancel 被过滤（归平仓事件），不单独推送 ORDER CANCELED

### 场景 2：纯撤单（无平仓）

- **Given** 账户持有 CL SHORT，撤销其离场挂单，仓位不变
- **When** WS 推送仅包含订单变化
- **Then** TG 推送 ORDER CANCELED，仓位卡片正确显示 CL SHORT 当前持仓

### 场景 3：开仓+反手

- **Given** 账户平掉 ETH LONG 同时开 BTC SHORT
- **When** WS 推送
- **Then** console banner 显示 CHANGE（非 OPEN 或 CLOSE），TG 分别推送 OPEN 和 CLOSE
