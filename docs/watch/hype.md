# HYPE 账户监听（perps WS + REST）

`service/HYPE-watch/main.mjs` 的设计说明。监听 Hyperliquid 钱包 perps 账户变化，对照 sodex 版（[sodex.md](./sodex.md)）按平台拆分而来——章节对称，内容均为 HYPE 实测事实。

## 一、目标

长驻监听**多个**钱包 `address` 的**合约（perps）账户**，围绕"跟/盯某交易者、预判其操作"：

- WS 收到账户变化（开/加/减/平仓、挂单挂改撤）→ 作为**触发器**
- 触发后用 info REST 拉**权威详情**：离场挂单（`frontendOpenOrders`）+ 平仓历史（`userFills`，逐笔 `closedPnl`）；当前仓位直接用 WS `clearinghouseState` 快照
- **离场挂单（reduceOnly / isPositionTpsl）** 是唯一的**前瞻信号**——提前看到对方的止盈/止损出场计划
- **多地址**：一进程同时盯多个地址，各自独立 WS + 独立 Telegram 会话，模块级共享限流
- 依赖 `ws` 包（`npm install ws`）；**无 SDK、无鉴权**。代理(WARP)另需 `undici` + `https-proxy-agent`
- **仅多地址 `--config` 模式**（不做单地址 CLI / 纯快照模式，见 main.mjs:4）

## 二、为什么不需要 apiKey / JWT

| 证据 | 结论 |
| --- | --- |
| `info` 端点统一 `POST {type, user}`，header 仅 `Content-Type: application/json`，从不带 `Authorization`/cookie（api/index.mjs:43-62） | 账户读取零鉴权 |
| WS `onopen` 只发 `{method:"subscribe", subscription:{type, user:address}}`，URL `wss://api.hyperliquid.xyz/ws` 无 token（watcher.mjs:101） | WS 订阅不带凭据 |
| 账户定位**全程用 `address`**，无 accountId 概念（api/index.mjs:2、66-68） | 无需 address→accountId 解析步骤 |

> 唯一前提：地址需是有 perps 活动的钱包。HYPE info 对未知地址返回空结构而非报错，故 discovery 阶段确认其有持仓/成交即可。

## 三、host 清单

| 层 | host | 键 | 鉴权 |
| --- | --- | --- | --- |
| WS 触发 | `wss://api.hyperliquid.xyz/ws` | `user=address` | 无 |
| 当前仓位 / 离场单 / 平仓 | `https://api.hyperliquid.xyz/info`（POST `{type, user}`） | `user=address` | 无 |
| 符号精度元数据 | 同上 `info`，`{type:"meta"}` → `universe[].szDecimals` | — | 无 |

- WS 与 REST **同一 host 家族**（`api.hyperliquid.xyz`），不像 sodex 分网关/数据/biz 三套。
- `info` 一个端点按 `type` 复用：`clearinghouseState` / `frontendOpenOrders` / `userFills` / `meta`（api/index.mjs:66-68、122）。

## 四、执行流程

> 仅实时 WS 监听模式；多地址用 `--config`（§十）；每日镜像默认 20:00 上海（§九 SNAPSHOT）。

```
启动
 ├─ info {type:"meta"} → 建 coin → szDecimals 缓存（每 6h 刷新；缺省 szDecimals=4）
 │     价格精度 = MAX_DECIMALS(6) - szDecimals（parse.mjs:8）
 └─ 每地址连 wss .../ws（无鉴权）
       ├─ onopen: subscribe 四频道（method:"subscribe"，user=address）
       │     clearinghouseState / openOrders / userFills / orderUpdates（watcher.mjs:20、101）
       ├─ 心跳: 每 15s 发 {method:"ping"}，pong 看门狗 10s 超时则重连
       ├─ clearinghouseState 推送 → 解析 assetPositions（仓位快照）+ marginSummary + withdrawable
       ├─ openOrders 推送 → 缓存全量挂单（仅作指纹用）
       ├─ 触发指纹 stateFp = 仓位指纹 + 全量挂单指纹；变化即 scheduleFetch
       │     档位判别另用「持仓键集合(coin:dir) + 离场单子集」是否变（结构变化）
       ├─ userFills / orderUpdates 推送 → 仅触发"重新评估"（structural=false，状态以 REST 为准）
       └─ 分档防抖 → fetchAndReport()
              ├─ 当前仓位 / marginSummary：直接用 WS clearinghouseState 快照
              ├─ 离场单：info frontendOpenOrders（取 reduceOnly || isPositionTpsl）
              ├─ 平仓历史：info userFills（dir 含 "Close"，按 oid 聚合，updated time 降序取最近 N）
              ├─ 出参指纹 outFp = 仓位 + 离场单 + 平仓 oid 集（三者任一变才上报）
              ├─ 与上次持仓 diff → 事件；新出现的平仓 oid 标 ★
              └─ 打印：banner 头 + 仓位卡片(含离场挂单) + 平仓历史；离场单挂/改/撤另发轻提醒
       └─ onclose: 指数退避重连（1s→30s，带 jitter）+ 重新订阅
```

### 分档防抖（HYPE 特有：治理滚仓刷屏）

WS clearinghouseState 在同仓加减仓（滚仓）时高频推送，故两档防抖（watcher.mjs:174-187）：

| 档 | 触发条件 | 防抖 / 封顶 | 默认 |
| --- | --- | --- | --- |
| 短档 | 结构变化（开/平/反手 → 键集合变；离场单挂改撤 → 离场单子集变） | `debounce-ms` / `max-wait-ms` | 3000 / 5000 |
| 长档 | 仅 abs(size)/开仓单 sz 变（同仓滚仓加减仓） | `tier-debounce-ms` / `tier-max-wait-ms` | 12000 / 45000 |

`pendingStructural` 窗口内只升级取最紧急档；设长档=短档即回退旧行为。HYPE 实测滚仓拐点约 12s。

## 五、字段映射（基于 parse.mjs）

### 当前仓位（`clearinghouseState.assetPositions[].position`）

| 字段 | 来源 | 说明 |
| --- | --- | --- |
| `coin` | `position.coin` | 币种名（HYPE 用 coin 名，无 symbol_id） |
| size / dir | `szi` | **`szi` 已带符号**：正→LONG、负→SHORT（无 BOTH/hedge 概念，单向） |
| 开仓价 | `entryPx` | — |
| **标记价 mark** | **反推** | `positionValue / |size|`（HYPE 持仓里不直接给 markPx，parse.mjs:23） |
| 仓位价值 | `positionValue` | 名义敞口，USD |
| 未结盈亏 | `unrealizedPnl` | 浮盈，USD |
| ROE% | `returnOnEquity` | 已是比例（0.438 = 43.8%），展示 ×100 |
| 杠杆 | `leverage.type` / `leverage.value` | type → Cross/Isolated；value → 倍数 |
| 强平价 | `liquidationPx` | 可能为 null |
| **保证金** | `marginUsed` | **直给精确值**，无需名义÷杠杆推算（区别于 sodex） |

账户级：`marginSummary`（accountValue/totalMarginUsed/totalNtlPos）、`withdrawable`（watcher.mjs:149-150）。

### 离场挂单（`frontendOpenOrders`，取 `reduceOnly===true || isPositionTpsl===true`）

`coin` / `side`（B 买 / A 卖）/ `limitPx` / `sz`（剩余量）/ `triggerPx` / `oid`；
TP/SL 判定优先看 `orderType` 文案（"Take Profit *"→TP、"Stop *"→SL，parse.mjs:60-66）。

### 平仓历史（`userFills`，`dir` 含 "Close"，按 `oid` 聚合）

- 逐笔成交账本，过滤 `dir` 含 "Close" 的笔；**同 oid 多笔成交聚合**：`closedPnl`/`fee`/`sz` 求和，`px`/`time` 取最新一笔（parse.mjs:87-92）。
- 字段：`coin` / `dir`（Close Long/Close Short）/ `closedPnl`（**官方权威已实现盈亏，无需回放**）/ `fee` / `sz` / `px` / `time`。
- 客户端按 `time` 降序，取最近 N（默认 2，`--history-limit`）。
- 计价币 USD；`fee` 为正成本。

> 与 sodex 差异：HYPE 平仓来自**逐笔 fills 按 oid 聚合**（closedPnl 现成），sodex 来自仓位级 `perps/positions`（size=0）；HYPE 无数字枚举映射（dir/方向均为字符串）。

## 六、健壮性

1. `{method:"ping"}` 每 15s + pong 看门狗 10s（watcher.mjs:112-114）
2. 大整数安全 JSON 解析（`parseJsonSafe`）
3. 断线指数退避重连（1s→30s，±20% jitter）+ 重放订阅（watcher.mjs:124-129）
4. WS `channel:"error"` / subscriptionResponse 打日志（watcher.mjs:143-144）
5. HTTP 超时 10s + AbortController（api/index.mjs:44-45）
6. **模块级共享限流（429）**：HYPE info 按 IP weight 限流，优先服务端 `Retry-After`，否则指数退避 2→60s + ±20% jitter；`sharedRateLimitUntil` gate **所有地址**请求；冷却结束遍历全部 watcher 各触发一次 `scheduleFetch`（api/index.mjs:84-99）。
7. **拉取失败兜底**：任何 REST 失败一律跳过本次上报、保留指纹待下次，绝不渲染空数据（watcher.mjs:218）。
8. **去重双层**：触发层 `stateFp`（仓位 + 全量挂单）与出参层 `outFp`（仓位 + 离场单 + 平仓 oid 集）（watcher.mjs:166、224）。
9. **内存限容**：`seenCloseOids` 超 2000 用当前数据重建，防长跑泄漏（watcher.mjs:239）。

## 七、用法

```bash
node service/HYPE-watch/main.mjs --config=service/HYPE-watch/config.json   # 仅此模式
```

通用 flag：

```bash
--history-limit=N      # 平仓历史条数（默认 2）
--debounce-ms=N        # 短档防抖（默认 3000）
--max-wait-ms=N        # 短档封顶（默认 5000）
--tier-debounce-ms=N   # 长档防抖（默认 12000，治理滚仓刷屏）
--tier-max-wait-ms=N   # 长档封顶（默认 45000）
--at=HH:MM             # 每日镜像时刻（上海时间，默认 20:00）
--env=production       # 环境（默认 production）
```

> 无 `--config` 直接退出并打印用法（main.mjs:36-43）。

## 八、部署与隐私结论

- **被监听地址无法察觉**：读公开 info 数据不通知对方、不上链。唯一可见方是 Hyperliquid 服务端日志（你的源 IP + 订阅帧/请求里的地址）。
- **WS 优于 REST 轮询**：单条长连接 + 被动接收，足迹最小。
- **无 API key**：全链路 public，无凭据可泄露/轮换。
- **运行位置**：7×24 监听首选小型 VPS + `systemd Restart=always`。
- **IP 暴露**：本机暴露住宅 IP，VPS 暴露数据中心 IP，对法律程序都非匿名；VPN/代理只是 IP 替换，不等于匿名。关键风险是**关联**：别用同一 IP 既监听又登录你本人账户。
- **配置隐私**：`service/HYPE-watch/config.json` 含 Telegram token / chat_id → 已入 `.gitignore`，仅 VPS 本地存在。

## 九、仓位与平仓历史展示

### 仓位卡片（console 与 TG 共用 `derivePositionView()`，render.mjs:12）

console 表格列：`Coin(含 Nx 杠杆) | 方向 | 持仓量 | 仓位价值 | Entry | Mark | Unrealized PnL (ROE%) | Liq.Price | 保证金 | 离场挂单`。
TG 卡片每项独占一行，末尾追加离场挂单。

- **方向**：`szi` 符号判 LONG/SHORT（HYPE 单向，无 hedge），中文映射 `LONG→做多 / SHORT→做空`。
- **仓位价值**：直接用 `positionValue`（USD，2 位）。
- **保证金**：直接用 `marginUsed`（精确）+ `leverage.type`（Cross/Isolated）；**无需推算**。
- **ROE%**：`returnOnEquity × 100`（接口直给比例）。
- **标记价（Mark）反推**：`positionValue / |size|`（HYPE 持仓不含 markPx，render.mjs:78、parse.mjs:23）；反推不出显示 `-`。
- **离场挂单（reduceOnly）**：仓位卡片末尾按 `coin` 匹配（HYPE 单向，匹配 coin 即可，render.mjs:33）：
  - 行格式 `离场挂单 {止盈|止损} @ {价} ({全平|部分} {量}{部分时 /持仓量})`
  - TP/SL 标签来自 `orderType` 文案；文案缺失时退化为 `离场挂单 @ 价 (...)` 不带标签

### 平仓历史（权威盈亏）

来源 `userFills`（dir 含 "Close"，按 oid 聚合）。**直接用逐笔 `closedPnl`（官方权威）**，无需回放、无需仓位聚合。

- 排序：客户端按 `time` 降序取最近 N（默认 2，`--history-limit=N`）。
- 每条三行（render.mjs:103-108）：
  ```
  {★ }币种 方向  {MM/DD HH:mm}
    平仓价 {px}  数量 {Σsz}
    盈亏 {Σclosedpnl 带符号}  手续费 {Σfee 带符号}
  ```
- **★ 新记录**：首帧基线全部不标，之后新出现的平仓 `oid` 标 ★（`seenCloseOids` + `baselineLogged`，watcher.mjs:238）。

### banner（去重，三行）

每次变化打印方框 banner，只有头部三行——**动作(emoji+动词) / 时间(🕐) / 身份(📡+displayId) 各独立一行**（避免手机 TG 折行），时间统一 `YYYY/MM/DD HH:mm:ss`（上海 UTC+8）：

```
╔════════════════════════════════╗
║ 🟢 OPEN POSITION               ║
║ 🕐 2026/06/20 22:24:03         ║
║ 📡 【0x58...7027】🎯 xiao      ║
╚════════════════════════════════╝
```

- **displayId**：默认 `【短地址】`；config 项有 `label` 时在括号外用 🎯 追加。
- banner 类型由仓位 diff 动词判定（render.mjs:45-61）：

| kind | emoji | 显示 | 触发 |
|------|-------|------|------|
| START | 👀 | START WATCH | 首帧基线 |
| OPEN | 🟢 | OPEN POSITION | 新键 |
| CLOSE | 🔴 | CLOSE POSITION | 键消失 |
| INCREASE | 📈 | INCREASE POSITION | abs(size) 增 |
| REDUCE | 📉 | REDUCE POSITION | abs(size) 减 |
| SNAPSHOT | 📸 | SNAPSHOT | 每日镜像 |
| CHANGE | 🔄 | POSITION CHANGE | 其它 |

### START WATCH 门控（避免部署噪音）

仅 config 中相比上次新增的地址才推 `👀 START WATCH` 到 TG；已监听过的地址重启时只建基线、不推 TG（console banner 照常）。

- 状态文件 `HYPE-watch/.seen-addresses.json`（gitignore），启动比对并集落盘（main.mjs:50-55）。
- 门控逻辑在 `tool/seenAddresses.mjs`，**与 sodex-watch 共用**。
- 删除 `.seen-addresses.json` 后下次启动所有 config 地址重新推 START。

### 离场挂单变化轻提醒（独立 banner）

reduceOnly 单集合 diff（按 oid）检测 PLACE/MODIFY/CANCEL → 主报告之后单发（render.mjs:140）：

```
🏹 离场挂单
🕐 2026/06/20 22:24:03
📡 【0x58...7027】🎯 xiao
设置/撤销/调整 {止盈|止损} {coin} {方向} @ {价}
```

- **MODIFY**：只认 `price` 变化——`sz` 变小多为部分成交（`frontendOpenOrders.sz` 是剩余量），不误报改单（parse.mjs:138）；交易所撤旧+新单实现改单时退化为 CANCEL+PLACE（可接受）。
- **FILL 不双报**：离场单消失且同窗口该 coin 仓位减/平 → 判成交归平仓事件，不发撤销提醒（watcher.mjs:287-289）。
- 首帧只建基线，不提醒。

### 时区与精度

- 时间统一 `fmtTime`，**北京时间 UTC+8**（`Asia/Shanghai`，无 DST），格式 `YYYY/MM/DD HH:mm:ss`。
- 价格精度按币种 `6 - szDecimals`（parse.mjs:8）；数量精度 `min(szDecimals, 6)`；USD 金额 2 位；缺失显示 `-`。

## 十、SNAPSHOT 每日镜像

无独立快照模式；每日镜像在 WS 模式内定时触发（watcher.mjs:131-135）：

- 默认每天 **20:00 上海时间（UTC+8）**；`--at=HH:MM` 改全局，config 地址项 `at` 各自错峰。
- 触发时 `forceReport=true`、清 `lastOutFp`，强制走一次 `fetchAndReport`，banner 头为 `SNAPSHOT`。
- **无持仓则不推 TG**（仅 console 留痕，watcher.mjs:264-266）；事件驱动不受此限。

## 十一、多地址模式（`--config`）

```bash
node service/HYPE-watch/main.mjs --config=service/HYPE-watch/config.json
```

- 进程内循环 `new AccountWatcher(env, addr, flags)`，各自独立 WS（物理隔离），共享模块级限流器 `watcherRegistry`（api/index.mjs:74）。
- 配置：**全局一个 bot（`tgToken`）+ 每地址独立 `tgChat`**；地址项可选 `tgToken` 覆盖、`label` 别名、`at` 镜像时刻、`startTime` 观察起点（Unix 毫秒，记录该地址首次加入 watch 的时刻，仅作元数据）。
- **每地址独立镜像时刻**：取值优先级 **地址项 `at` > 全局 `--at` > 默认 20:00**，错峰避免并发拉取。
- 配置含 TG 凭据 → 不入 git（`.gitignore`），仅服务器本地填写。
- 瓶颈是 info 端点 IP 限流，由共享限流器兜（一处 429 全员退避）。
