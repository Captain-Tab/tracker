# 多地址监听 + 平仓历史 + 离场挂单 + banner 去重

> 功能 spec。目标文件：`script/watch-account.mjs`、新增 `script/watch.config.json`、`docs/watch-account-plan.md`。

## 实现者须知（新会话先读，避免踩坑）

> 本 spec 经多轮澄清 + 真实接口实测 + 评审修正（G1-G11 + label + ★复用），可直接实现。以下是实测得来、不读会踩的关键约束：

1. **目录/命令**：代码在 `script/` 子目录。语法 `node --check script/watch-account.mjs`；测试 `cd script && node --test`（现有 20 个单测，**先跑通作为基线**再改）。
2. **依赖**：`ws` 是硬依赖（已 `npm install ws`，非零依赖）；代理(WARP)场景另需 `undici`+`https-proxy-agent`。
3. **最易踩的 4 个坑（务必照 spec 做，别凭直觉）**：
   - **G1**：删 trades 后，`outFp`（出参去重，`:723/725`）若只剩仓位指纹 → 纯挂单变化被去重 → reduceOnly 即时提醒**失效**。outFp 必须也含 reduceOnly + 平仓 id。
   - **G2**：限流冷却恢复（`:714`）现只唤醒命中 429 的实例；多地址下其余 watcher 会**漏报**冷却期内变化 → 须模块级注册表，冷却结束唤醒**全部** watcher。
   - **G3**：`perps/positions` **按 position_id 返回，非平仓时间**（实测 pid 小但 updated_at 新会排后）→ 客户端按 `updated_at` 降序再取 N。
   - **G4**：positions 接口 `position_side` 是**数字** `2=LONG/3=SHORT`、`margin_mode` 数字，与 WS 的字符串 `ps`/`m` **不同源** → 平仓历史走独立数字映射，**不能**复用 `positionDirection`。
4. **不要凭记忆改 API 字段**；需验证用真实地址 `0x584743497098d00733d5d29fe80e020280427027`（accountId 3602，当前有持仓 + reduceOnly 挂单 + 已平仓历史）。
5. **向后兼容**：保留单地址 CLI（`node script/watch-account.mjs 0xAddr`）；`watch.config.json` 含 TG 凭据 → 进 `.gitignore`。
6. **流程**：`/k:spec` 加载本文件定复杂度档 → 按路由 `/k:task` 实现 → 完成 `/k:check`。

## 背景与目的

现有 `watch-account.mjs` 只监听**单个**钱包地址、REST 拉**成交历史(trades)**、banner 头部明细与仓位卡片重复、不监听挂单。本次围绕"**跟/盯某交易者、预判其操作**"的动机做四项增强：

1. **多地址**：一个进程同时盯最多 5–10 个地址（1GB/1 核 VPS 足够），每地址独立 Telegram 会话。
2. **平仓历史替换成交历史**：用 `perps/positions` 的**权威 `realized_pnl`/资金费/均价**替代逐笔成交 + 客户端回放估算 —— 更准、更贴"这个仓位平掉赚了多少"。
3. **离场挂单(reduceOnly)监听**：唯一的**前瞻信号** —— 提前看到对方的止盈/止损出场计划。
4. **banner 去重**：删掉与仓位卡片重复的 `OPENED/CLOSED…` 明细行。

## 选定方案

**方案 A：单进程内 N 个 `AccountWatcher` 实例 + 模块级共享限流器。**

| 方案 | 思路 | 优点 | 缺点 | 改动 | 风险 |
|---|---|---|---|---|---|
| **A（选定）** | 循环 `new AccountWatcher(addr)`，各自独立 WS | 复用已验证状态机；物理隔离(一地址断不影响其他)；防抖/去重/不漏发四性质天然 per-address 成立；改动小 | N 条 WS 连接 | 小 | 低 |
| B | 单 WS 多路复用，按 `data.user` 路由 | 省连接 | 路由层新增丢/串消息失败模式(accountTrade 是否带 user 未验证)；单 socket 断 = N 地址相关性全挂；重构大 | 大 | 中 |

选 A 理由：① ≤10 地址时连接数对网关无感(已实测单连接正常)，B 的省连接收益≈0；② 防抖/过滤/去重/不漏发是 per-address 状态机内逻辑，A=B 同源，A 还多了物理隔离；③ 改动最小、复用现有测试。

**共享限流器**：把 `rateLimitUntil`/backoff 从 per-instance 提到**模块级单例**，所有地址 REST 走同一闸 —— 一处 429/409 全体退避，聚合 QPS 受控（多地址对服务器的唯一真实风险点是 data host 的 N× 拉取）。

## 设计概要

### 1. 配置文件（`script/watch.config.json`）

```json
{
  "tgToken": "全局默认 bot token",
  "watches": [
    { "address": "0xA…", "tgChat": "会话1", "label": "xiao" },
    { "address": "0xB…", "tgChat": "会话2", "tgToken": "可选覆盖此地址的 bot" }
  ]
}
```

- Telegram：**全局一个 bot（`tgToken`）+ 每地址独立 `tgChat`**；地址项可选 `tgToken` 覆盖。
- **【新】`label`（可选）**：给地址起别名。banner 头从 `【accountId】` 变为 `【accountId-label】`（如 `【1046-xiao】`）；无 `label` 时仍只显示 `【1046】`。单地址 CLI 无 label。
- 入口：`node script/watch-account.mjs --config=script/watch.config.json` → 读取后循环 `new AccountWatcher(env, watch.address, { ...flags, tgToken, tgChat })`。
- **保留单地址 CLI**：`node script/watch-account.mjs 0xAddr` 仍可用（向后兼容；systemd 可二选一）。
- 配置含 tg 凭据 → **加入 `.gitignore`**，仅 VPS 本地存在。

### 2. 多地址 + 共享限流

- `main()`：有 `--config` → 读 JSON、循环建 N 个 watcher、`start()`；`SIGINT` 关闭全部。无 `--config` → 沿用单地址。
- `symbolsById`/`symbolsBySymbol` 已是模块级，N watcher 共享，不变。
- **共享限流器**（模块级）：`sharedRateLimitUntil` + `sharedBackoff`；`AccountWatcher` 的 429/409 分支写**模块级**变量，`scheduleFetch`/`fetchAndReport` 入口 gate 读**模块级**。
- **【G2】冷却结束须唤醒全部 watcher**：现单地址恢复靠命中 429 的实例自己 `setTimeout(scheduleFetch, waitMs+500)`（`:714`）。多地址下，冷却期内其他 watcher 的 `stateFp` 已在 `:660-661` 推进、但 `scheduleFetch` 被 gate（`:668`）丢弃；若只唤醒命中者，其余 watcher **永不重触发 → 漏报冷却期内变化**。故需：模块级维护 watcher 注册表，冷却结束时遍历**所有** watcher 调一次 `scheduleFetch()`（各自 outFp 去重，无变化的自然不重复上报）。
- **内存限容**：累积 Set（`seenPositionIds` 见下）超阈值(如 2000)时用当前数据重建，防长跑泄漏。

### 3. 平仓历史替换成交历史

- **删除**：`fetchTradesNext`/`fetchTradesWeb` 的 trades 拉取、`computeRealizedPnl`(回放估算)、`--all` 翻页、`renderTrades` 成交列。
- **新增**：`fetchPositionHistory(accountId)` → `GET data/api/v1/perps/positions?account_id=N`。
- **【G3】排序后再截断（实测必须）**：接口**按 position_id 返回，不是按平仓时间**（实测 `pid=6847314` 的 `updated_at` 最新却排第 5）。直接取前 N 会漏掉真正最近平的仓 → **必须客户端按 `updated_at` 降序排序后再取最近 N（默认 2）**。
- **归一化**：`toPositionHistoryRecords(dto)` 取 `position_id, symbol_id, position_side, margin_mode, max_size, cum_closed_size, avg_entry_price, avg_close_price, realized_pnl, funding_fee, updated_at`。
- **【G4】数字枚举映射（实测，与 WS 字符串格式不同）**：positions 接口字段为**数字**，需映射：
  - `position_side`：**`2 → LONG（做多）`、`3 → SHORT（做空）`**（实测 11/12 一致；`1` 未观测，疑为 BOTH/单向，加兜底）。
  - `margin_mode`：数字（实测全为 `2`）→ 复用/扩展 `marginModeLabel` 映射 Cross/Isolated；未知值兜底原值。
  - 注意：这与 WS `data.P` 的 `ps:"LONG"/"SHORT"`、`m:"CROSS"` 字符串**不是同一套**，平仓历史须走自己的数字映射，不能复用 `positionDirection`。
- **渲染**：`renderPositionHistory()` —— 中文名 **「平仓历史」**，每条两行：
  ```
  {★ }平仓时间  币种 方向 · {全平|部分}
    开仓 {avg_entry} → 平仓 {avg_close}  数量 {cum_closed_size}
    已实现盈亏 {realized_pnl 带符号} 资金费 {funding_fee}
  ```
- **★ 新记录（直接复用现有 ★ 机制，只换键）**：现 `★` 逻辑（`watch-account.mjs:732`）是通用的「`seenXxx` 见过集 + `baselineLogged` 首帧不标、之后标新」模式。平仓历史**原样套用**，仅把键 `tradeKey(trade_id)` 换成 **`position_id`**：`seenTradeIds → seenPositionIds`；首帧基线全部不标 ★（避免一上来满屏 ★），之后新出现的已平仓位标 ★。`realized_pnl` 是该仓位生命周期累计 = 平仓总盈亏，直接展示，无需 diff。
- **【G5/G6】平仓索引延迟的 2s 重试改判据**：现重试条件 `events>0 && newFills.length===0`（`:737`）的 `newFills` 来自 trades，删 trades 后失配。改为：**检测到 CLOSED 仓位事件（`diffPositions` 出现 CLOSED）但平仓历史里尚无对应新 `position_id`** → 视为 positions 索引延迟，沿用 2s 延迟补拉。这样 CLOSE banner（已删明细行、靠平仓历史 ★ 指明哪个币）在补拉后能正确带上 ★ 平仓记录，避免"只说 CLOSE 不知哪个仓"。
- 精度：均价/价按 `pricePrecision`、数量按 `quantityPrecision`、盈亏/资金费按 USD(2 位) —— 复用 `fmtNum/fmtUsd`。

### 4. 离场挂单（reduceOnly）

- **触发指纹**：`stateFp` 从 `canonicalPositionsFp(positions)` 改为 `canonicalPositionsFp(positions) + "|" + canonicalReduceOnlyOrders(data.O)`。`canonicalReduceOnlyOrders` 只取 `R:true` 的单（`i+p+q` 规范化排序），**不含开仓单**（避免 churn）。这样挂/改/撤 TP/SL 即时触发报告。
- **【G1】出参去重 `outFp` 同步纳入 reduceOnly（关键）**：现 `outFp = canonicalPositionsFp(positions) + "|" + tradeFp`（`:723`），删 trades 后若仅剩仓位指纹，则**纯挂单变化(仓位没变)会被 `:725` 去重掉 → 即时提醒失效**。故 `outFp` 改为 `canonicalPositionsFp(positions) + "|" + canonicalReduceOnlyOrders(data.O) + "|" + 平仓历史 position_id 集`。触发层(stateFp)与出参层(outFp)**两处都要含 reduceOnly**。
- **【G10】diff 状态**：模块/实例维护 `prevReduceOnly`（Map by orderId），每次与新集合比对得出 PLACE/CANCEL/MODIFY。
- **【G9】MODIFY 判定**：同 orderId 的 `p`/`q` 变 → MODIFY（一条"调整"提醒）；交易所以"撤旧 id+新 id"实现改单时，退化为 CANCEL+PLACE 两条（可接受，不强行合并）。
- **展示（贴仓位卡片下）**：`derivePositionView` 增加该仓的离场单匹配（symbol + 方向：reduceOnly SELL→LONG、BUY→SHORT；hedge 按 `ps`）。仓位卡片末尾追加：
  ```
  离场挂单  {止盈|止损} @ {价 pricePrecision} ({全平|部分} {量 quantityPrecision}{部分时 / 持仓量})
  ```
  - TP/SL 推断：多单 SELL 价 > 标记 → 止盈，< → 止损；空单反之。
  - **【G11】mark 反推不出（null）时**：无法判 TP/SL → 退化为 `离场挂单 @ 价 (全平/部分 量)`，不带止盈/止损标签。
  - 数量走 `fmtNum(q, quantityPrecision)`（与持仓量同精度，自动适配 BTC 小数）。
  - 无离场单则不显示该行；孤儿单（无对应持仓）暂忽略。
- **变化轻提醒**（独立 banner）：reduceOnly 单集合 diff 检测 PLACE/MODIFY/CANCEL → 发 `⚡ 【accountId】 离场挂单 · 时间` + `设置/撤销/调整 {止盈|止损} {coin} {方向} @ {价}`。
- **FILL 不双报**：reduceOnly 单消失时，若同窗口该 symbol 仓位减/平（`z==q` 或仓位 diff 命中）→ 判成交，归到平仓事件，不发离场单提醒；否则判撤销。
- stop 类型订单样本未实测到，TP/SL 标注暂按价格侧推断，遇 stop 类型再补。

### 5. banner 去重

- 删除 `bannerDetailLines` 在报告中的输出（`OPENED/CLOSED/Buy…` 明细行）。banner = **头部一行**(`⚡ 【displayId】 <动词> · 时间`)。
- **【label】`bannerHead` 改造**：`bannerHead`（`:367`，唯一拼 `【accountId】` 处）入参由 `accountId` 改为 `displayId`；`displayId = label ? \`${accountId}-${label}\` : accountId`（在 watcher 构造时算好传入）。例：`⚡ 【1046-xiao】 OPEN POSITION · …`。
- "什么动作"由头部动词表达；"什么币/量/价"由仓位卡片表达；平仓由「平仓历史」补全。消除重复 + 顺带去掉明细行里的未格式化原始价。

### 最终消息示例

```
⚡ 【1046】 START WATCH · 2026/06/19 22:24:03

━━━━━━━━━━━━━━━━
📊 仓位：CL 10x SHORT
  方向  做空
  持仓量  574.658
  仓位价值  $43,729.18
  开仓价  88.484
  标记价  76.096
  未结盈亏  +$7,118.66 (+140%)
  强平价  101.852
  保证金  $5,084.78 (Cross)
  离场挂单  止盈 @ 70.00 (全平 574.658)
━━━━━━━━━━━━━━━━

📜 平仓历史 (最近2条)

  2026/06/15 23:33:01  CL 做空 · 全平
  开仓 88.48 → 平仓 76.10  数量 574.658
  已实现盈亏 +$7,118.66  资金费 -$12.34

  2026/06/15 21:10:42  BTC 做多 · 全平
  开仓 63,166 → 平仓 64,210  数量 1.2
  已实现盈亏 +$1,252.80  资金费 -$3.07
```

## 边界与约束

**包含：**
- 多地址(config)、模块级共享限流、平仓历史替换成交历史、reduceOnly 离场单(触发+展示+提醒)、banner 去重、内存限容。

**不包含：**
- 开仓挂单(`R:false`)监听 —— churn 噪声，明确不做。
- 单 WS 多路复用(方案 B) —— ≤10 地址无收益。
- 部分平仓的权威 PnL 即时性 —— `perps/positions` 实测**只返已平仓(size=0)**，部分减仓(仓仍开)期间无平仓历史记录；其可见性靠 WS 实时持仓 diff(DECREASED)，权威 PnL 待全平才出现。
- stop 类型订单的精确 TP/SL 标注（暂推断）。
- 实时持仓(WS `data.P`)逻辑本次不动。

**配置与错误处理（G7/G8）：**
- **【G7】`--config` 仅实时 WS 模式**：`--config` 与 `--snapshot` 互斥 —— 同时给出时报错退出（多地址快照本次不做）。
- **【G8】config 加载错误处理**：文件缺失 / JSON 解析失败 / `watches` 为空 → 打印错误并 `exit(1)`；单个 `address` 非法（非 `0x…40hex`，走 `isAddress`）→ 跳过该项并告警，不影响其他；重复 address → 去重保留首个。

**已知限制：**
- **不再零依赖**：`ws` 为硬依赖(`npm install ws`)；用代理(WARP)再加 `undici` + `https-proxy-agent`。
- 配置文件含 TG 凭据 → 不入 git（`.gitignore`）。
- 1GB/1 核 VPS：5–10 地址内存(~70–130MB)/CPU(近空闲)充裕；瓶颈是 data host 限流，由共享限流器兜。

## 集成点

| 文件 / 符号 | 改动 |
|---|---|
| `script/watch.config.json` | **新增**（gitignore） |
| `script/watch-account.mjs` `main()` | 解析 `--config`，循环建 N watcher；保留单地址 |
| `AccountWatcher` 构造 | 接收 per-地址 `tgToken`/`tgChat`/`label`；算 `displayId` |
| `bannerHead`（`:367`） | 入参 `accountId` → `displayId`（含 label） |
| `seenTradeIds`→`seenPositionIds` + ★ 标新 | 复用现有 baseline+seen 机制，键换 position_id |
| 模块级 | 新增 `sharedRateLimitUntil`/`sharedBackoff` 共享限流；`canonicalReduceOnlyOrders` |
| `handleMessage` `stateFp` | 加入 reduceOnly 集合 |
| `fetchTradesNext`/`fetchTradesWeb`/`computeRealizedPnl`/`renderTrades` | **删除**（trades + 回放） |
| 新增 `fetchPositionHistory`/`toPositionHistoryRecords`/`renderPositionHistory` | 平仓历史 |
| `derivePositionView` | 匹配 + 输出该仓 reduceOnly 离场单 |
| `buildTgMessage`/`buildEventBanner` | 删 `bannerDetailLines` 输出；新增离场单行 + 离场变化 banner |
| `seenTradeIds` → `seenPositionIds` | dedup/★ 改键 |
| `docs/watch-account-plan.md` + `docs/systemd-setup.md` | 同步（ExecStart 改 `--config`） |

## 验收标准

- [ ] `--config=script/watch.config.json` 启动后，N 个地址各自连 WS、各推到自己的 `tgChat`
- [ ] 单地址 `node script/watch-account.mjs 0xAddr` 仍可用（向后兼容）
- [ ] 任一地址触发 429/409 → 共享限流器使**全部**地址 REST 一并退避（非各自为政）
- [ ] 报告不再有 `OPENED/CLOSED…` 明细行；banner = 头部一行 + 仓位卡片 + 平仓历史
- [ ] 成交历史段被「平仓历史」替换，默认 2 条，显示权威 `realized_pnl` + 资金费 + 均价
- [ ] 持仓挂有 reduceOnly 单时，仓位卡片下出现「离场挂单 {止盈/止损} @ 价 (全平/部分 量)」，量按币种精度（BTC 不被截 0）
- [ ] 新挂/改/撤 reduceOnly 单 → 收到独立离场挂单提醒；普通开仓单下/撤 → **无**提醒
- [ ] reduceOnly 单成交(平仓)→ 只出平仓事件，**不**额外发离场单提醒
- [ ] 【G1】纯 reduceOnly 挂单变化(仓位/平仓均无变)能触发并上报（outFp 含 reduceOnly，不被去重）
- [ ] 【G2】某地址冷却结束时，其余 watcher 也被重新唤醒评估（不漏报冷却期内的状态变化）
- [ ] 【G3】平仓历史按 `updated_at` 降序取最近 N（构造一个 position_id 较小但平仓时间最新的记录，应排在最前）
- [ ] 【G4】平仓历史 `position_side=2` 显示「做多」、`=3` 显示「做空」；`margin_mode` 显示 Cross/Isolated（非数字）
- [ ] 【label】config 项有 `label:"xiao"` → banner 头显示 `【1046-xiao】`；无 label → `【1046】`
- [ ] 【★复用】平仓历史首帧基线不标 ★；之后新出现的已平仓位（新 position_id）标 ★，沿用现有 seen+baseline 机制
- [ ] 数值千分位 + 去尾零 + 缺失显示 `-`；时间 `YYYY/MM/DD HH:mm:ss`
- [ ] `node --test`（script/）全绿；`node --check` 通过

## 验收场景

### 场景 1：多地址配置启动，各推各的会话
- **Given** `script/watch.config.json` 含 2 个 watch：`{address:0xA, tgChat:"C1"}`、`{address:0xB, tgChat:"C2"}`，全局 `tgToken=T`，两地址均为已注册合约账户
- **When**  `node script/watch-account.mjs --config=script/watch.config.json` 启动
- **Then**  进程内建 2 个 AccountWatcher、各连一条 WS；0xA 的 START WATCH 推到 C1、0xB 推到 C2（同一 bot T）

### 场景 2：单地址向后兼容
- **Given** 不提供 `--config`
- **When**  `node script/watch-account.mjs 0x584743497098d00733d5d29fe80e020280427027`
- **Then**  按原单地址模式运行，打印该账户 START WATCH（行为与本次改动前一致）

### 场景 3：平仓历史替换成交历史 + 权威盈亏
- **Given** accountId=3602 有一条已平仓记录 `position_id=6999122, realized_pnl=1087.67770107224, avg_entry/close, funding_fee` 存在于 `perps/positions`
- **When**  发生账户变化触发报告
- **Then**  报告含「平仓历史」段（非「成交历史」），该条显示 `已实现盈亏 +$1,087.68 资金费 …`（取自接口权威值，非客户端回放）；报告中无回放估算列

### 场景 4：reduceOnly 离场单展示 + 触发
- **Given** 0x5847…7027（accountId 3602）持有 CL 10x SHORT 574.658（标记价 76.096），并新挂一张 reduceOnly BUY LIMIT @ 70.00 q=574.658（仓位本身未变）
- **When**  WS 推来含该 reduceOnly 单的 accountState
- **Then**  reduceOnly 集合指纹变化 → 触发报告；CL 仓位卡片下出现 `离场挂单 止盈 @ 70.00 (全平 574.658)`（BUY 价 70 < 标记 76 → 止盈）；并发独立提醒 `⚡ 【3602】 离场挂单 · …`

### 场景 5：开仓单 churn 不打扰
- **Given** 某地址反复下/撤普通限价**开仓**单（`R:false`），仓位与 reduceOnly 单均未变
- **When**  这些开仓单在 WS `data.O` 里增减
- **Then**  `stateFp` 不变（只认 reduceOnly + 仓位）→ **不触发报告、无任何通知**

### 场景 6：BTC 小数量挂单精度
- **Given** 某地址持有 BTC LONG 0.024（quantityPrecision 5/6），挂 reduceOnly SELL @ 85000 q=0.024
- **When**  渲染离场挂单行
- **Then**  显示 `离场挂单 止盈 @ 85,000 (全平 0.024)`，数量不被截成 0（按币种 quantityPrecision）

### 场景 7：共享限流跨地址退避 + 冷却结束全员重唤（G2）
- **Given** 配置 5 个地址；地址 A 的 positions 请求返回 429（`Retry-After: 30`）；冷却期内地址 B 发生平仓（B 的 `stateFp` 已推进但 `scheduleFetch` 被 gate）
- **When**  30s 冷却结束
- **Then**  ① 冷却期内全部 5 地址 REST 被 gate 跳过；② 冷却结束时遍历**所有** watcher 各触发一次 `scheduleFetch` → 地址 B 的平仓被补报（不因被 gate 而永久漏报）

### 场景 8：平仓历史按平仓时间排序（G3）
- **Given** accountId 的 positions 接口返回两条已平仓：`{position_id:6999122, updated_at:1781877266498}` 与 `{position_id:6847314, updated_at:1781877922860}`（后者 position_id 更小但 updated_at 更新，接口按 position_id 把它排在后面）
- **When**  渲染「平仓历史 (最近2条)」
- **Then**  `6847314`（updated_at 最新）排在**第一行**（客户端按 updated_at 降序，而非接口原序）

### 场景 9：平仓历史数字枚举映射（G4）
- **Given** 平仓记录 `{position_side:2, margin_mode:2, symbol_id:1}` 与 `{position_side:3, …}`
- **When**  渲染平仓历史
- **Then**  前者方向显示「做多」、后者显示「做空」；保证金模式显示「Cross/Isolated」而非数字 `2`

### 场景 10：label 别名显示
- **Given** config 项 `{address:0xA, accountId 解析为 1046, label:"xiao"}`，另一项 0xB 无 label（accountId 2048）
- **When**  两地址各触发 banner
- **Then**  0xA banner 头 `⚡ 【1046-xiao】 …`；0xB banner 头 `⚡ 【2048】 …`（无 label 不加后缀）

### 场景 11：平仓历史 ★ 复用基线机制
- **Given** watcher 首次拉到平仓历史 2 条（position_id A、B）
- **When**  首帧渲染，随后该账户又全平一个新仓（position_id C）触发第二次渲染
- **Then**  首帧 A、B **均不标 ★**（基线）；第二次渲染 C 标 ★、A/B 不标（沿用 `seenPositionIds` + `baselineLogged`）

<!-- COMPLEXITY-OVERRIDE: medium→task, reason: spec 已含完整实现蓝图(行号集成点+G1-G11+11 场景)，等价 plan，用户确认直接 task -->
