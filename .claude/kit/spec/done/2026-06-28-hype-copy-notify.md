# Spec · HYPE-copy 跟单通知增强（dry-run）

> 由 `/k:clarify` 产出，供 `/k:spec` / `/k:task` 加载。触发仍用轮询（60s），**事件驱动是下一档（go-live §〇），不在本次**。

---

## 背景与目的

一期 dry-run 通知只覆盖 place / 各 skip / min-capital / 失败，且存在两个问题：① 周期轮询下 `min-capital`/`skip-*` **每轮无条件推 → TG 刷屏**；② dry-run `current 恒空`，**看不见滚仓/平仓等"变化型"事件**，开/加/减/平不区分。

本次增强：让跟单执行器在每轮对账后，把**仓位变化（开/加/减/平）+ 启停 + 告警**合成**一条** TG 汇总推送，并对持续性告警去重，消息头带跟单对象与执行子账户，便于不盯盘掌握"目标动了→我方镜像怎么跟"。

## 选定方案

**方案 A**：状态（`lastWouldHold` + 告警指纹 + `wasFollowing`）放 `main.mjs`（编排层持生命周期态）；`notify/templates.mjs` 放纯文案；`notify/index.mjs` 拆 per-action 记录与 per-round 汇总推送。`reconcile.mjs` / `diffDelta` **零改**（只是 main 改传 `current = lastWouldHold`）。

理由：契合"文案/逻辑/状态三分离"，纯函数层不沾状态、可单测；reconcile 不动，回归面小。

（否决：B 去重状态塞 notify → notify 变有状态难测；C 每事件一条 → 刷屏 + 吃 TG 限速。）

## 设计概要

### 数据流（每 60s 一轮 reconcileOnce）
```
current = lastWouldHold（不再传 []）→ planReconcile(desired, current, caps, prices)
for 每个 action：
  recordAction(toLogLine(action)) → 每动作一条 JSONL + journald（始终，不去重）
  若可推 & 未被去重 → push 一行文案到 lines[]
若 lines 非空 → 汇总 = 消息头 + lines.join("\n") → sendTelegram 推一次
更新 lastWouldHold / lastAlertFp / wasFollowing
```

### 核心数据结构（main 持状态）
- `lastWouldHold: Map<coin, sizeStr>`：上一轮 would-hold 净仓；喂 `diffDelta` 当 `current`。
- `lastAlertFp: Set<"coin:result">`：持续性告警去重集；每轮重建。
- `wasFollowing: boolean`：min-capital 仅在 `idle/flat → following`（锚定轮）推一次。

### 计时（main 用 Date.now() 打三点；定义 A）
- `t0` = 本轮开始（触发拉取目标态/价格）；`t1` = 拉取完成（看到目标快照）；`t2` = would-place 构造完成。
- **`fullMs = t2 − t0`**（完整时间：watch 拉取段 + copy 处理段全程）。
- **`execMs = t2 − t1`**（执行时间：copy 自身处理段，不含网络拉取；`fullMs − execMs` 即拉取耗时）。
- 一轮算一组 `{fullMs, execMs}`，落每条 JSONL（同轮共享）+ 推送页脚。事件驱动下一档可把 `fullMs` 起点前移到事件到达时刻（更贴端到端），本档为 A 定义。

### 事件分类（由 prevSize=lastWouldHold[coin]、newSize=desired[coin] 派生）
| 条件 | 事件 | icon |
|---|---|---|
| prev=0 且 new≠0 | 开仓 | 🆕 |
| `\|new\| > \|prev\|`（prev≠0） | 加仓 | ⏫ |
| `\|new\| < \|prev\|` 且 new≠0 | 减仓 | ⏬ |
| new=0 且 prev≠0 | 平仓 | 🏁 |

### 推送/去重规则
| 事件 | 是否推 | 去重 |
|---|---|---|
| 🆕开/⏫加/⏬减/🏁平（place 类） | ✅ | delta 驱动，天然只在变化时出现 |
| ⛔ skip-unmappable / mindust / maxpos / skip-capped(cap-warn) / no-price | ✅ 告警 | **进入状态推一次**，键 `coin:result` 在上轮集合则静默；脱离再进入才重推 |
| 💡 min-capital | ✅ | **仅锚定轮**推一次（`wasFollowing=false→true`） |
| ⚠️ 失败/error | ✅ | 不去重（每次都要知道） |
| noop | ❌ | 既不推也不计入告警指纹 |
| ▶ 启动 / ⏹ 关闭跟单 | ✅ | 进程级，各一次 |

### 消息文案（templates.mjs）
- 消息头：`[DRY-RUN] 🎯<target.id>｜跟 <目标短地址> → <subAccount>`
- 明细行示例：`🆕 开 ETH 多 0.625 @ 3000（ratio 6.25%）` / `⏫ 加 ETH 多 +0.12 → 持 0.74 @ 3000` / `⏬ 减 …` / `🏁 平 ETH 多（目标已清仓）`
- 启动：`▶ 跟单启动 <id>｜跟 0x…→s1（avail 模拟，待锚定）`；关闭：`⏹ 跟单关闭 <id>`
- 重启首轮（`lastWouldHold` 空）：`▶ 启动 + 初始镜像同步：持 ETH 多 0.6 / BTC 空 0.1 …`（不逐仓当开仓洪水）
- 汇总末尾**计时页脚**：`⏱ 执行 12ms｜完整 340ms`（execMs / fullMs）

## 边界与约束

**包含：**
- 事件分类（开/加/减/平）；一轮一条汇总推送；持续告警指纹去重；min-capital 仅锚定轮；启动/关闭(SIGTERM/SIGINT)推送；重启首轮初始镜像同步。
- **计时**：`fullMs`（t2−t0）/ `execMs`（t2−t1）落每条 JSONL + 推送计时页脚（定义 A）。
- `escapeHtml`（`< > &`，parse_mode HTML）；token/chat 空则只记 JSONL 不推；轮询 60s；`notify/templates.mjs` 文案分离；纯函数单测。
- **最后一步**新建 `docs/notify/copy.md` 说明文档（模板/原理/实现三节）。

**不包含：**
- 每日镜像推送（缓做）；事件驱动 / PositionStream（下一档 go-live §〇）；真实下单 / 签名 / agent key。

**已知限制：**
- 触发仍轮询（60s），有最多 60s 延迟，下一档事件驱动接管后降为 180s 兜底。
- dry-run 无真实执行账号，消息头执行方仅显示子账户标签。

## 集成点

- 新建 `service/HYPE-copy/notify/templates.mjs`：`buildHeader(id, targetAddr, subAccount)` + 各事件行 `lineFor(action)` + icon 常量（🆕⏫⏬🏁▶⏹⛔💡⚠️）。
- 改 `service/HYPE-copy/notify/index.mjs`：拆 `recordAction`（JSONL+journald）、`pushRoundSummary`（一条）、`escapeHtml`；`buildActionText`/文案迁入 templates。
- 改 `service/HYPE-copy/main.mjs`：持 `lastWouldHold`/`lastAlertFp`/`wasFollowing`；`current=lastWouldHold`；收集 lines 一次推；`SIGTERM`/`SIGINT` 钩子；间隔 60s；打 `t0/t1/t2` 算 `fullMs/execMs` 透传给 recordAction + 推送页脚。
- `service/HYPE-copy/test/domain.test.mjs`：加 事件分类 / 告警去重指纹 / 汇总文案 / escapeHtml 用例。
- 复用：`process/reconcile.mjs`（零改）、`process/precision.mjs`、现有 `sendTelegram`。
- **最后一步** 新建 `docs/notify/copy.md`：解释 copy 推送模板、核心原理（一轮一条汇总 + 状态做差分类 + 指纹去重 + 两管线独立）、核心实现（templates/index/main 三分离 + lastWouldHold 做差）。

## 验收标准

- [ ] 六类事件（🆕开/⏫加/⏬减/🏁平/▶启动/⏹关闭）按模板与 icon 正确推送。
- [ ] 一轮多个变化 → **合成一条** TG（消息头 + 多行），非每事件一条。
- [ ] 持续告警（capped/unmappable/mindust/no-price）**进入推一次**，状态不变静默，脱离再进入重推。
- [ ] `min-capital` 仅锚定轮推一次，不再每轮推。
- [ ] `noop` 不推、不计入告警指纹。
- [ ] 消息头含 `🎯<id>｜跟 <目标短地址> → <subAccount>`。
- [ ] 重启首轮 `lastWouldHold` 空 → 推「初始镜像同步」一条，不逐仓当开仓。
- [ ] `SIGTERM`/`SIGINT` → 推 `⏹ 跟单关闭` 后退出。
- [ ] reason 含 `< > &` 经 `escapeHtml` 转义；token/chat 空 → 不推只记 JSONL。
- [ ] 每动作仍落一条 JSONL（与去重独立）。
- [ ] 每条 JSONL 含 `fullMs`/`execMs`；推送汇总末尾含计时页脚 `⏱ 执行 Xms｜完整 Yms`；`fullMs ≥ execMs`。
- [ ] `reconcile.mjs`/`diffDelta` 未改（git diff 确认）。
- [ ] 新建 `docs/notify/copy.md`（模板/原理/实现三节）。
- [ ] `node --test service/HYPE-copy/test/domain.test.mjs` 全绿；`/k:check` 三闸门通过。

## 验收场景

### 场景 1：一轮多变化合成一条 + 开/加/平 分类
- **Given** dry-run，`lastWouldHold = {ETH:"0.5", BTC:"0.1"}`；本轮目标变化使 `desired = {ETH:"0.625", SOL:"2"}`（ETH 加仓、SOL 新开、BTC 目标已平），价格齐全、均过校验门为 place，token/chat 已配
- **When** `reconcileOnce()` 执行一轮
- **Then** 推**一条** TG：消息头 + 3 行 `⏫ 加 ETH …` / `🆕 开 SOL …` / `🏁 平 BTC …` + 计时页脚 `⏱ 执行 Xms｜完整 Yms`（`Y ≥ X`）；JSONL 落 3 条，每条含 `fullMs`/`execMs`；`lastWouldHold` 更新为 `{ETH:"0.625", SOL:"2"}`

### 场景 2：持续告警去重 + noop 不推
- **Given** 目标持 PLTR（不可映射）连续 3 轮；某轮另有 ETH delta 0.0005（< minDeltaPct → noop）
- **When** 连续 3 轮 `reconcileOnce()`
- **Then** PLTR 的 `skip-unmappable` **仅第 1 轮推一次**（键 `PLTR:skip-unmappable` 进 `lastAlertFp`，2/3 轮静默）；ETH noop 三轮都不推、不进告警指纹；JSONL 仍每轮记录 PLTR skip

### 场景 3：重启首轮初始镜像同步
- **Given** 执行器重启，内存 `lastWouldHold` 空；目标当前持 ETH 多、BTC 空（可映射、过校验门）
- **When** 启动后第一轮 `reconcileOnce()`
- **Then** 推一条 `▶ 跟单启动 <id> … + 初始镜像同步：持 ETH 多 0.6 / BTC 空 0.1`，**不**逐仓推 3 条 🆕 开仓；`lastWouldHold` 填充为当前镜像

### 场景 4：关闭跟单（进程停止）
- **Given** 执行器运行中，配了 token/chat
- **When** 收到 `SIGTERM`（`systemctl stop`）
- **Then** 推一条 `⏹ 跟单关闭 <id>` 后进程退出；不与"目标平仓(🏁)"混淆
