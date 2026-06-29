# 跟单推送（HYPE-copy notify）· 模板 / 原理 / 实现

> dry-run 阶段跟单执行器的 TG 推送说明。代码：`service/HYPE-copy/notify/`（`templates.mjs` 文案 / `index.mjs` 逻辑）+ `main.mjs`（状态编排）。
> 关联：[`../copy/hype.md`](../copy/hype.md)（系统）、spec `.claude/kit/spec/2026-06-28-hype-copy-notify.md`。

---

## 一、推送模板

每轮对账后把本轮变化合成**一条** TG 汇总：`banner 头 + （启动时）仓位卡片 + 明细行 + 计时页脚`。风格对齐 watch 卡片式。

**Banner 头**（每条首行）：
```
▶ 跟单启动                      ← kind=initial_sync / startup
🆕 跟单对账                      ← kind=round
🕐 2026/06/29 12:05:03
📡 跟 0x267b...2566 🎯demo-1  [DRY-RUN]
```

**仓位卡片**（仅启动轮；目标仓位 / 跟单仓位分两卡片，空行分隔）：

```
━━━━━━━━━━
🎯 目标仓位：LIT 10x 做空
  持仓量  35,559 张
  开仓价  $1.72
  标记价  $1.75
  保证金  $12,653

📊 跟单仓位：LIT 10x 做空
  持仓量  715 张
  仓位价值  $1,248
  保证金  $125
━━━━━━━━━━
```

| 行 | 数据来源 |
|----|----------|
| 目标持仓量 / 开仓价 / 保证金 | sodex REST `state.P[]`（`sz` / `ep` / `co/l` 派生） |
| 标记价 | hype `allMids` |
| 跟单持仓量 / 仓位价值 / 保证金 | `computeDesired` 按 ratio 缩放后 |

**明细行**（按事件类型）：

| 事件 | icon | 模板 | 触发 |
|------|------|------|------|
| 开仓 | 🆕 | `🆕 ETH 做多 \| 新开 0.5 张 @ $3,000.50  ratio 1.98%` | 该币上轮无、本轮有 |
| 加仓 | ⏫ | `⏫ ETH 做多 \| +0.24 → 持 0.74 张 @ $3,001` | 量级增大 |
| 减仓 | ⏬ | `⏬ ETH 做多 \| -0.24 → 持 0.5 张 @ $3,000.50` | 量级减小 |
| 平仓 | 🏁 | `🏁 BTC 做多 \| 目标已清仓，平仓` | 该币本轮归零 |
| 启动 | ▶ | `▶ 跟单启动`（banner 行）+ 仓位卡片（启动轮） | 进程首轮 |
| 关闭 | ⏹ | `⏹ 跟单关闭` | 进程 SIGTERM/SIGINT |
| 单仓超限 | ⛔ | `⛔ LIT 仓位过重不跟——目标仓按比例缩小后仍需 $1,249，超单仓上限 $300（余额 $500 × 60%）` | maxpos |
| 资金上限 | ⛔ | `⛔ ETH 需 $520 > 资金上限 $450，加仓拦截` | capped |
| 无映射 | ⛔ | `⛔ PLTR 无 hype 映射，跳过（不计入分母）` | unmappable |
| 最小名义 | ⛔ | `⛔ ETH 名义 < 最小 $10，跳过` | mindust |
| 最低本金 | 💡 | `💡 最低本金下单：$4.07（仅保证最大仓 ≥ $10 名义，可跟 LIT）` | 锚定轮 |
| 失败 | ⚠️ | `⚠️ ETH 执行失败 — <reason>` | error |

**计时页脚**（每条末行）：
```
⏱ 执行 12ms｜完整 340ms
```

**完整示例（启动轮）**：
```
▶ 跟单启动
🕐 2026/06/29 12:05:03
📡 跟 0x267b...2566 🎯demo-1  [DRY-RUN]

━━━━━━━━━━
🎯 目标仓位：LIT 10x 做空
  持仓量  35,559 张
  开仓价  $1.72
  标记价  $1.75
  保证金  $12,653

📊 跟单仓位：LIT 10x 做空
  持仓量  715 张
  仓位价值  $1,248
  保证金  $125
━━━━━━━━━━

💡 最低本金下界：$4.07（仅保证最大仓 ≥ $10 名义，可跟 LIT）

⛔ LIT 仓位过重不跟——目标仓按比例缩小后仍需 $1,249，超单仓上限 $300（余额 $500 × 60%）

⏱ 执行 25ms｜完整 775ms
```

**完整示例（常规轮）**：
```
⏫ 跟单对账
🕐 2026/06/29 12:15:00
📡 跟 0x267b...2566 🎯demo-1  [DRY-RUN]

🆕 ETH 做多 | 新开 0.5 张 @ $3,000.50  ratio 1.98%
⏫ BTC 做空 | +0.12 → 持 0.36 张 @ $60,000
🏁 SOL 做多 | 目标已清仓，平仓

⏱ 执行 30ms｜完整 650ms
```

---

## 二、核心原理

1. **一轮一条汇总**：一轮对账（事件驱动主触发 + 180s 周期兜底）的所有变化 + 告警合成**一条** TG，而非每事件一条——省 Telegram 限速、易读、不刷屏。

2. **状态做差分类（开/加/减/平）**：dry-run 无真实持仓，故内存保留**上一轮 would-hold**（`lastWouldHold`），本轮 `desired` 与它做差（`current = lastWouldHold`）：
   - 上轮无、本轮有 → 🆕 开仓；量级增 → ⏫ 加仓；量级减 → ⏬ 减仓；本轮归零 → 🏁 平仓。
   - 这套与真实交易统一（真实下 `current` = hype 实仓），事件驱动下一档可平滑切换。

3. **指纹去重防刷屏**：持续性告警（capped / unmappable / mindust / no-price）每轮都会重现，用 `lastAlertFp`（`coin:result` 集合）**进入状态推一次**，状态不变静默，脱离再进入才重推；`min-capital` 仅锚定轮（开跟）推一次；`noop`（碎步/无变动）永不推。

4. **两条管线独立**：推送（去重、汇总）与 JSONL 日志（每动作一条、全量审计）互不影响——`noop` 不推但仍可记。

5. **计时**：每轮打 `t0`(开始拉取)/`t1`(拉取完成)/`t2`(处理完成)，`fullMs=t2−t0`（完整：watch 拉取 + copy 处理）、`execMs=t2−t1`（执行：copy 处理段）；落每条 JSONL + 推送页脚，`fullMs−execMs` 即网络拉取耗时。

---

## 三、核心实现

**三分离结构**：

| 层 | 文件 | 职责 |
|----|------|------|
| 文案 | `notify/templates.mjs` | 纯字符串：`buildHeader` / `buildBanner` / `buildPositionCards`（目标+跟单双卡片）/ `buildDeltaLine`（单币变化行）/ `lineFor`（按事件出行）/ `classifyMirrorEvent`（开加减平分类）/ `buildRoundSummary`（轮次聚合）/ `lineStart` / `lineStop` / `buildFooter` / `escapeHtml` / `fmtDisplaySize` / `fmtDisplayUsd`。无 IO、无状态。 |
| 逻辑 | `notify/index.mjs` | `recordAction`（JSONL + journald）/ `pushRoundSummary`（一条推送）/ `decidePushLine`（去重决策，纯函数）/ `toLogLine`（含 fullMs/execMs）/ `sendTelegram`。 |
| 状态 | `main.mjs` | 持 `lastWouldHold` / `lastAlertFp` / `wasFollowing` / `pendingStartup`；`reconcileOnce` 编排：拉取→映射→换算→校验门→收集事件→`recordAction` 每条 + `decidePushLine` 去重→`pushRoundSummary` 一次。 |

**关键流程（reconcileOnce）**：
```
t0 → 拉取(目标态/价格/assetIndex) → t1
映射 → 资金换算 → planReconcile(desired, current=lastWouldHold, caps, prices)
逐 action 收集 events（place 带 currentSize/desiredSize/szDecimals 供分类；skip 带上下文）
desiredEnriched（补 leverage / szDecimals / targetEntryPx / targetSzi 供卡片展示）
t2 → fullMs=t2-t0, execMs=t2-t1
for ev: recordAction(+计时)  // JSONL 始终
        decidePushLine(ev)   // 去重后入 lines
buildRoundSummary(kind, clock, headerId, positionCards, lines, footer)  // 启动轮含仓位卡片
pushRoundSummary(null, [summary], null, push)  // lines 空则不推
更新 lastWouldHold=desired / lastAlertFp / wasFollowing
```

**安全要点**：
- `escapeHtml` 转义 reason 中 `< > &`（`parse_mode: HTML`）。
- `token`/`chat` 空 → `sendTelegram` 内部 guard，不推、只记 JSONL。
- 关闭跟单（进程停止）= `SIGTERM`/`SIGINT` 钩子推 ⏹，与"目标平仓 🏁"分开。
- 精度比较走 `precision.mjs`（`classifyMirrorEvent` 用 `eq/gt/lt`），禁裸 `parseFloat` 运算。

**不在本档**：事件驱动 / PositionStream（见 [`../copy/hype-go-live.md`](../copy/hype-go-live.md) §〇）、每日镜像、真实下单。
