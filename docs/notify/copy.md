# 跟单推送（HYPE-copy notify）· 模板 / 原理 / 实现

> dry-run 阶段跟单执行器的 TG 推送说明。代码：`service/HYPE-copy/notify/`（`templates.mjs` 文案 / `index.mjs` 逻辑）+ `main.mjs`（状态编排）。
> 关联：[`../copy/hype.md`](../copy/hype.md)（系统）、spec `.claude/kit/spec/2026-06-28-hype-copy-notify.md`。

---

## 一、推送模板

每轮对账后把本轮变化合成**一条** TG 汇总：`消息头 + 多行明细 + 计时页脚`。

**消息头**（每条首行）：
```
[DRY-RUN] 🎯<target.id>｜跟 <目标短地址> → <子账户>
```

**明细行**（按事件类型）：

| 事件 | icon | 模板 | 触发 |
|------|------|------|------|
| 开仓 | 🆕 | `🆕 开 ETH 多 0.625 @ 3000（ratio 6.25%）` | 该币上轮无、本轮有 |
| 加仓 | ⏫ | `⏫ 加 ETH 多 +0.12 → 持 0.74 @ 3000` | 量级增大 |
| 减仓 | ⏬ | `⏬ 减 ETH 多 -0.12 → 持 0.50 @ 3000` | 量级减小 |
| 平仓 | 🏁 | `🏁 平 ETH 多（目标已清仓）` | 该币本轮归零 |
| 启动 | ▶ | `▶ 跟单启动 + 初始镜像同步：持 ETH 多 0.6 / BTC 空 0.1` | 进程首轮 |
| 关闭 | ⏹ | `⏹ 跟单关闭` | 进程 SIGTERM/SIGINT |
| 跳过/触顶 | ⛔ | `⛔ PLTR 无 hype 映射，跳过…` / `⛔ 已达资金上限…` | unmappable / mindust / maxpos / capped / no-price |
| 最低本金 | 💡 | `💡 推荐最低本金=1680，可跟 ETH` | 锚定轮 |
| 失败 | ⚠️ | `⚠️ ETH 执行失败 — <reason>` | error |

**计时页脚**（每条末行）：
```
⏱ 执行 12ms｜完整 340ms
```

**完整示例**：
```
[DRY-RUN] 🎯demo-1｜跟 0x321f…1c84 → s1
⏫ 加 ETH 多 +0.24 → 持 0.74 @ 3000
🆕 开 SOL 多 2 @ 150
🏁 平 BTC 多（目标已清仓）
⏱ 执行 12ms｜完整 340ms
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
| 文案 | `notify/templates.mjs` | 纯字符串：`buildHeader` / `lineFor`（按事件出行）/ `classifyMirrorEvent`（开加减平分类）/ `lineInitialSync` / `lineStart` / `lineStop` / `buildFooter` / `escapeHtml`。无 IO、无状态。 |
| 逻辑 | `notify/index.mjs` | `recordAction`（JSONL + journald）/ `pushRoundSummary`（一条推送）/ `decidePushLine`（去重决策，纯函数）/ `toLogLine`（含 fullMs/execMs）/ `sendTelegram`。 |
| 状态 | `main.mjs` | 持 `lastWouldHold` / `lastAlertFp` / `wasFollowing` / `pendingStartup`；`reconcileOnce` 编排：拉取→映射→换算→校验门→收集事件→`recordAction` 每条 + `decidePushLine` 去重→`pushRoundSummary` 一次。 |

**关键流程（reconcileOnce）**：
```
t0 → 拉取(目标态/价格/assetIndex) → t1
映射 → 资金换算 → planReconcile(desired, current=lastWouldHold, caps, prices)
逐 action 收集 events（place 带 currentSize/desiredSize 供分类）
t2 → fullMs=t2-t0, execMs=t2-t1
for ev: recordAction(+计时)  // JSONL 始终
        decidePushLine(ev)   // 去重后入 lines
首轮：lines 头部换成「初始镜像同步」一行（不逐仓 place 洪水）
pushRoundSummary(header, lines, footer)  // lines 空则不推
更新 lastWouldHold=desired / lastAlertFp / wasFollowing
```

**安全要点**：
- `escapeHtml` 转义 reason 中 `< > &`（`parse_mode: HTML`）。
- `token`/`chat` 空 → `sendTelegram` 内部 guard，不推、只记 JSONL。
- 关闭跟单（进程停止）= `SIGTERM`/`SIGINT` 钩子推 ⏹，与"目标平仓 🏁"分开。
- 精度比较走 `precision.mjs`（`classifyMirrorEvent` 用 `eq/gt/lt`），禁裸 `parseFloat` 运算。

**不在本档**：事件驱动 / PositionStream（见 [`../copy/hype-go-live.md`](../copy/hype-go-live.md) §〇）、每日镜像、真实下单。
