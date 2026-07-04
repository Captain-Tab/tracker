# 通知模块重构（sodex-watch + HYPE-watch）

> 详细设计与全部模拟面板见 `docs/notify/notification-design.md`。
> 原始需求：`.claude/kit/spec/update-notification.md`。

## 背景与目的

现状 watch 通知冗余，阅读困难：仓位卡片**全币种**展示、离场单变化会**额外单发一条** banner、平仓历史一次列多条、多动作同帧被 banner 优先级压缩成一个动词。

目的：**只留本次变化、一眼看清哪个币做了什么动作**。降噪的同时不牺牲盯仓所需的关键信号（平仓后账户全景、加减仓量级、保证金变化）。

## 选定方案

「**按币种/动作拆消息**」：`fetchAndReport` 从"一帧一条消息（`classifyBanner` 取最高优先级）"改为"一帧可发 N 条独立消息"。单动作帧仍一条，不增噪；多动作帧拆多条，每条语义单一。

选它是因为：彻底解决"多动作被压缩成一个 banner"的老问题，且每条消息能精准套用各自的显示规则（⭐️/变化量/历史），规则最简、无多动作塞一条的边界纠缠。

## 设计概要

### 消息生成流程（watcher.fetchAndReport）

- `START`（首帧）/ `SNAPSHOT`（每日 force）→ 单条全景，**行为完全不变**（全币种卡片 + 平仓历史最近 2 条）。
- 事件驱动（其余）：
  - 每个非平仓变化币（`events` 的 OPENED/INCREASED/DECREASED）→ 各生成一条 OPEN/INCREASE/REDUCE 消息，仅含该币卡片。
  - 所有平仓币（CLOSED）→ **合并为一条** CLOSE 消息：顶部"平仓：<币 方向>"摘要，换行"剩余仓位："+ 剩余全部仓位卡片（无剩余则"无持仓"），底部平仓历史（每个平仓币各 1 条）。
  - `exitChanges`（离场单挂/撤/改）→ 生成离场单消息，banner 按动作细化（见下），显示该币完整卡片 + 变化挂单行。
  - `events` 与 `exitChanges` 全空（纯 `closedIdsFp` 抖动）→ **不发**（消除现状无意义 POSITION CHANGE）。
- 移除原独立 `buildExitOrderBanner` 单发逻辑（`watcher.mjs` 主报告后那条），合并进上面的离场单消息。

### banner 文案（const/bannerLabels.mjs）

```js
export const WATCH_BANNER_LABEL = {   // 移除原 CHANGE
  START: "START WATCH 开始监控",
  SNAPSHOT: "SNAPSHOT 每日快照",
  OPEN: "OPEN POSITION 开仓",
  CLOSE: "CLOSE POSITION 平仓",
  INCREASE: "INCREASE POSITION 加仓",
  REDUCE: "REDUCE POSITION 减仓",
};
export const EXIT_ORDER_BANNER_LABEL = {   // 新增
  place:  "ORDER PLACED 挂单设置",
  cancel: "ORDER CANCELED 挂单撤销",
  modify: "ORDER MODIFIED 挂单调整",
  mixed:  "OPEN ORDER 挂单变化",   // 一条消息含多种动作时回退
};
```

### 加/减仓量级 + 保证金变化

- `diffPositions` 的 INCREASED/DECREASED 需保留 **prev position**（当前 `pm.get(k)` 已持有，只是被丢弃），以便渲染层输出：
  - `⭐️ 增加持仓 5 → 8 ETH (+3)` / `⭐️ 减少持仓 8 → 5 BTC (-3)`
  - `⭐️ 保证金 $754 → $1,206 (+$452) Cross`（HYPE 用 `marginUsed` 直读；sodex 用 `(size×entry)/lev` 推算 prev/curr）
- 数据现成，零新增请求。

### ⭐️ 标识（全站统一 ⭐️，原平仓历史的 `★` 改 ⭐️）

- 开仓 → `📊 仓位` 行前（行首）
- 加/减仓 → "增加/减少持仓"行 + "保证金"行前
- 离场单变化 → 变化的挂单行前
- 平仓历史 → 历史行前（原 `newPosIds` 标记）

### 实现约束（spec 审查补充，必须落地）

1. **删 `CHANGE` 的连带清理**：`WATCH_BANNER_LABEL` 删 `CHANGE` 后，必须同步：
   - 移除 `render.mjs` 两端 `bannerHead` 的 `?? WATCH_BANNER_LABEL.CHANGE` 兜底（sodex `:93`、HYPE `:49`），改为离场单走 `EXIT_ORDER_BANNER_LABEL` 专用 head 构造，其余 kind 必有对应 label。
   - 移除 `BANNER_EMOJI.CHANGE`（sodex `:88`、HYPE `:46`）。
   - `classifyBanner` 不再返回 `CHANGE` kind（离场单/抖动改由消息生成流程分流）。否则会渲染出 "undefined"。
2. **`diffPositions` 保持字符串 events 签名不变**：量级（`5→8`）已在 events 串里；保证金变化在**渲染层用 prev/curr 重算**——watcher 在推进 `lastPositions` 前快照 prev，或 `diffPositions` 旁路附加结构（不改 events 数组本身）。禁止改 events 元素形态，避免连锁破坏 `computeExitChanges`（`watcher.mjs:306` `.split(" ")`）、`classifyBanner`、及断言字符串的测试（HYPE `domain.test.mjs:107`）。
3. **`reportGate` skip 语义**：`reportSkipReason` 现按单一 kind 判 START/SNAPSHOT 空仓跳过——拆多条后，此 gate 只作用于**全景消息（START/SNAPSHOT）**；事件驱动的每条消息按"有无内容"决定是否发（全空则整帧不发）。
4. **console 输出**：保持**单条聚合全景**（现 `watcher.mjs:278-283` 的 banner+仓位+历史不拆），仅 **TG 按币种/动作拆多条**——降低改动面，console 仍作完整留痕。

## 边界与约束

**包含：**
- sodex-watch + HYPE-watch 两端对称改（render.mjs + watcher.mjs + parse.mjs 的 diffPositions）

**不包含：**
- HYPE-copy（已核实无耦合：copy 仅依赖 `copySignal` 脏标文件，有独立 templates；`this.positions` 仍全量获取只渲染过滤，copy 依赖数据不受影响）
- 数据获取层（WS 全量 positions + REST 全量记录不变，仅渲染层过滤）
- `emitCopySignal` / `recomputeStateFp` 触发逻辑

**已知限制 / 已定决策：**
- 平仓多币合并的历史 = 每个平仓币各 1 条（已确认：单币平仓即 1 条，多币同帧才 >1，避免漏平仓信息）
- 开仓消息不含"增加持仓/保证金变化"行（新建仓无变化前值）
- 同帧「开 A + 平 B」，A 允许在"开仓 A 消息"与"平仓剩余全景"同现（语义不同，不去重）
- 离场单消息显示完整仓位卡片 + 变化挂单行

## 集成点

| 文件 | 改动 |
|------|------|
| `service/const/bannerLabels.mjs` | `WATCH_BANNER_LABEL` 删 `CHANGE`；新增 `EXIT_ORDER_BANNER_LABEL` |
| `service/sodex-watch/process/parse.mjs` | `diffPositions` 保留 prev（结构化输出或带 prev margin），供量级/保证金变化 |
| `service/sodex-watch/process/render.mjs` | `bannerHead`/`classifyBanner` 调整；`buildTgMessage` 支持单币/平仓合并/离场单三种模式 + ⭐️ + 变化量/保证金行；`buildExitOrderBanner` 合并进主消息或改造；`renderPositionHistory` 平仓时 1 条、去"最近N条"、`★`→`⭐️` |
| `service/sodex-watch/process/watcher.mjs` | `fetchAndReport` 消息循环：按币种/动作拆多条；移除独立 exitChanges 单发；全空 skip |
| `service/HYPE-watch/process/{parse,render,watcher}.mjs` | 同上对称（字段名 `newOids`/`oid`/`marginUsed`） |
| `service/sodex-watch/test/domain.test.mjs` | classifyBanner 组（`:212-229`）随 CHANGE kind 移除/分流同步改；如涉及新渲染函数补测 |
| `service/HYPE-watch/test/domain.test.mjs` | 若 diffPositions 旁路结构影响断言（`:107`）则同步；classifyBanner 未被测则新增 |
| `docs/update-log.md` | 记录本次改动 |

## 验收标准

- [ ] 开仓消息只显示该币卡片，`📊 仓位` 行前有 ⭐️
- [ ] 加仓消息含 `⭐️ 增加持仓 A→B (+N)` + `⭐️ 保证金 X→Y (+Z)`，只显示该币
- [ ] 减仓消息含 `⭐️ 减少持仓 A→B (-N)` + `⭐️ 保证金 X→Y (-Z)`，只显示该币
- [ ] 平仓消息：顶部"平仓：<币>"，有剩余则"剩余仓位："+ 剩余全部卡片，无剩余则"无持仓"；底部每个平仓币各 1 条历史（⭐️、无"最近N条"）
- [ ] 离场单变化只发 1 条（不再主报告后额外单发），banner 按动作细化（设置/撤销/调整/混合回退），变化挂单行前 ⭐️
- [ ] 纯 `closedIdsFp` 抖动（无仓位变化、无离场单变化）不推送
- [ ] START / SNAPSHOT 消息全币种 + 历史最近 2 条，行为不变
- [ ] 多动作同帧拆成多条独立消息
- [ ] 全站 ⭐️ 统一（无残留 `★`）
- [ ] 删 `CHANGE` 后无 "undefined" banner：两端 `bannerHead` 兜底、`BANNER_EMOJI.CHANGE`、`classifyBanner` 返回值均已清理
- [ ] `diffPositions` events 字符串签名未变，`computeExitChanges`/`classifyBanner` 消费不受影响
- [ ] 纯 START/SNAPSHOT 空仓仍走 `reportGate` skip；事件驱动全空整帧不发
- [ ] console 仍单条聚合全景（仅 TG 拆多条）
- [ ] 两端 sodex-watch / HYPE-watch 行为对称
- [ ] HYPE-copy 无改动，单测不受影响
- [ ] 三端单测全绿；`docs/update-log.md` 已更新

## 验收场景

### 场景 1：单币加仓（Happy Path）
- **Given** 被监控账户持有 ETH 20x 做多 5 张、保证金 $754；WS 推送 ETH 增至 8 张、保证金 $1,206，无其他币变化
- **When** `fetchAndReport` 触发，`diffPositions` 产出 `INCREASED LONG ETH 5→8`
- **Then** 发出 1 条 `📈 INCREASE POSITION 加仓` 消息，卡片仅 ETH，含 `⭐️ 增加持仓 5 → 8 ETH (+3)` 与 `⭐️ 保证金 $754 → $1,206 (+$452) Cross`，无平仓历史

### 场景 2：平仓且账户清空
- **Given** 账户仅持有 BTC 25x 做多 1 个仓位；WS 推送该仓 size=0，REST 平仓历史新增该记录
- **When** `fetchAndReport` 触发，`events` 含 `CLOSED LONG BTC`
- **Then** 发出 1 条 `🔴 CLOSE POSITION 平仓` 消息，顶部"平仓：BTC LONG"，仓位区显示"无持仓"，底部 1 条 `⭐️ BTC 做多 | 平仓 ...` 历史

### 场景 3：多动作同帧拆分
- **Given** 账户持有 BTC 做多、ETH 做多各 1 仓；WS 一帧内 BTC 平仓 + ETH 加仓 5→8
- **When** `fetchAndReport` 触发，`events` = [`CLOSED LONG BTC`, `INCREASED LONG ETH 5→8`]
- **Then** 发出 2 条消息：一条 `📈 INCREASE` 仅 ETH（含变化量+保证金 ⭐️），一条 `🔴 CLOSE` 平 BTC（剩余仓位含 ETH + BTC 平仓历史 1 条）

### 场景 4：纯平仓历史抖动不推送
- **Given** 无仓位变化、无离场单变化，仅 REST 平仓历史窗口滚动导致 `closedIdsFp` 变化
- **When** `fetchAndReport` 触发，`events` 与 `exitChanges` 均空
- **Then** 不发送任何 Telegram 消息（仅 console 留痕）

### 场景 5：离场单调整（原双发消除）
- **Given** 账户持有 ETH 做多且已挂 1 个止盈单；WS/REST 检测到该止盈单价格被修改
- **When** `fetchAndReport` 触发，`exitChanges` 含该币 1 条 `modify`
- **Then** 仅发出 1 条 `🏹 ORDER MODIFIED 挂单调整` 消息（不再有额外独立离场单 banner），显示 ETH 完整卡片 + 该挂单行前 ⭐️
