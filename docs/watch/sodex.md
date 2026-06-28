# WS 监听账户变化 → REST 拉平仓历史 / 离场挂单（perps）

`service/sodex-watch/main.mjs` 的设计说明。配套已有的 `service/sodex-watch/query.mjs`（快照查询）。

## 一、目标

长驻监听**一个或多个**钱包 `address` 的**合约（perps）账户**，围绕"跟/盯某交易者、预判其操作"：

- WS 收到账户变化（开/加/减/平仓、离场挂单挂改撤）→ 作为**触发器**
- 触发后用 REST 拉**权威详情**：当前仓位（WS 快照）+ **平仓历史**（权威 `realized_pnl`/资金费/均价）
- **离场挂单（reduceOnly）** 是唯一的**前瞻信号**——提前看到对方的止盈/止损出场计划
- **多地址**：一进程同时盯多个地址，各自独立 WS + 独立 Telegram 会话，模块级共享限流
- 依赖 `ws` 包（`npm install`）；无 SDK、无鉴权（已实测，见 §二）。代理(WARP)另需 `undici` + `https-proxy-agent`

## 二、为什么不需要 apiKey / JWT（实测证据）

| 证据 | 结论 |
| --- | --- |
| `@sodex/sdk` ws.mjs 全文 grep `token/jwt/auth/apikey/bearer/cookie` → 0 命中；`connect()` 只 `new WebSocket(url)`，URL 无 token，`onopen` 不发任何登录帧 | 客户端不带任何凭据 |
| 实测：无凭据连 `wss://mainnet-gw.sodex.dev/ws/perps`，subscribe 一个不存在地址 → 返回 `{success:false,error:"user not found"}`（不是 unauthorized） | 服务端只校验「账户是否存在」，不校验鉴权 |
| `dataClient`（`mainnet-data.sodex.dev`）用的 `sharedHooks` 从不 set `Authorization` | history 端点也是 public（按 account_id） |

> 唯一前提：地址必须是已注册的合约账户（首跑用真实地址确认 `success:true`）。

## 三、三套 host

| 层 | host | 键 | 鉴权 |
| --- | --- | --- | --- |
| WS 触发 | `wss://mainnet-gw.sodex.dev/ws/perps` | `address` | 无（已证） |
| 平仓历史 | `https://mainnet-data.sodex.dev/api/v1/perps/positions` | `account_id` | 无 |
| 符号元数据 | `https://alpha-biz.sodex.dev/biz/futures/symbols?env=mainnet` | — | 无 |
| address→accountId 备用 | `https://sodex.dev/mainnet/chain/address/{address}/accounts` | `address` | 无 |
| 快照模式当前仓位 | `https://mainnet-gw.sodex.dev/api/v1/perps/accounts/{address}/state` | `address` | 无 |

## 四、执行流程

> 默认实时 WS 监听模式；多地址用 `--config`（§十一）；`--snapshot` 单地址快照模式见 §十。

```
启动
 ├─ 拉 biz/futures/symbols → 建 symbol_id → {name, quoteCoin, 精度} 缓存（每 6h 刷新）
 └─ 连 wss .../ws/perps（每地址一条）
       ├─ onopen: 订阅 accountState / accountUpdate / accountOrderUpdate / accountTrade（user=address）
       ├─ 心跳: 每 15s 发 {op:"ping"}，pong 看门狗超时则重连
       ├─ accountState 快照 → 当前持仓(data.P) + 离场单(data.O 中 R:true) + account_id(aid)
       │     触发指纹 stateFp = 规范化仓位身份 + 离场单集合(i+p+q)；开仓单(R:false)不计，避免 churn
       └─ 指纹变化 或 accountTrade/accountOrderUpdate → 防抖 3000ms（+maxWait 5000ms 封顶）→ fetchAndReport()
              ├─ 当前持仓 / 离场单：直接用 WS 快照
              ├─ 平仓历史：GET data/api/v1/perps/positions?account_id=N（取 size=0 已平仓，按 updated_at 降序取最近 N）
              ├─ 出参指纹 outFp = 仓位 + 离场单 + 平仓 position_id 集（三者任一变才上报）
              ├─ 与上次持仓 diff → 事件；新出现的已平仓位（新 position_id）标 ★
              └─ 打印：头部一行 banner + 仓位卡片(含离场挂单) + 平仓历史；离场单挂/改/撤另发轻提醒
       └─ onclose: 指数退避重连（1s→30s，带 jitter）+ 重新订阅
```

## 五、字段映射（实测）

- 仓位方向（WS）：`ps` 名称（`LONG`/`SHORT`/`BOTH`）；`BOTH`（单向模式）按 `size` 符号判 LONG/SHORT
- **平仓历史枚举是数字，与 WS 字符串不同源**（独立映射，不复用 `positionDirection`）：
  - `position_side`：`2 → 做多(LONG)`、`3 → 做空(SHORT)`；`1` 未观测，兜底原值
  - `margin_mode`：`2 → Cross`、`1 → Isolated`；未知兜底原值
- 离场单（WS `data.O`，仅取 `R:true`）：`i` 单号 / `s` 币 / `S` BUY|SELL / `p` 价 / `q` 量 / `z` 已成交 / `ps` 方向 / `o` 类型
- `symbol_id` → `baseCoin/quoteCoin`：`biz/futures/symbols`
- 时间 `updated_at`（ms）；盈亏/资金费计价币 = USD

## 六、健壮性

1. `{op:"ping"}` 每 15s + pong 看门狗
2. 大整数安全解析（ID 类字段 16+ 位转字符串，避免 Number 丢精度）
3. 断线指数退避重连 + 重放订阅
4. subscribe ack `success:false` 打日志
5. HTTP 超时 10s + AbortController
6. **模块级共享限流（429/409）**：优先服务端 `Retry-After`，否则指数退避 2→60s + ±20% jitter；`sharedRateLimitUntil` gate **所有地址**的请求（一处限流全员退避，多地址聚合 QPS 受控）。**冷却结束遍历全部 watcher 各触发一次 `scheduleFetch`**（G2：否则冷却期内其他地址的变化因被 gate 而永久漏报；各自 outFp 去重，无变化不重复上报）。
7. **拉取失败兜底**：任何未成功拉取一律跳过本次上报、保留 `lastOutFp`/`forceReport` 待下次，绝不渲染空数据（防误报）。
8. **去重双层规范化**：触发层 `stateFp` 与出参层 `outFp` **都含仓位 + 离场单**（G1：否则纯挂单变化被去重→即时提醒失效）；`outFp` 另含平仓 position_id 集。
9. **平仓索引延迟补拉**（G5/G6）：检测到 CLOSED 仓位事件但平仓历史尚无对应新 `position_id` → 等 2s 补拉，使 CLOSE banner 能正确带上 ★ 平仓记录。
10. **内存限容**：`seenPositionIds` 超 2000 用当前数据重建，防长跑泄漏。

## 七、用法

```bash
# 多地址（推荐，各推各的 Telegram 会话）
node service/sodex-watch/main.mjs --config=service/sodex-watch/config.json

# 单地址（向后兼容）
node service/sodex-watch/main.mjs 0xYourAddress                        # 实时 WS 监听（默认）
node service/sodex-watch/main.mjs 0xYourAddress --snapshot             # 快照模式：启动抓一次 + 每日 20:00
node service/sodex-watch/main.mjs 0xYourAddress --snapshot --at=08:30  # 改每日抓取时间
node service/sodex-watch/main.mjs 0xYourAddress --tg-token=xxx --tg-chat=yyy  # 单地址 Telegram
node service/sodex-watch/main.mjs 0xYourAddress --history-limit=5      # 平仓历史条数（默认 2）
node service/sodex-watch/main.mjs 0xYourAddress --debounce-ms=500      # 自定义防抖
node service/sodex-watch/main.mjs 0xYourAddress --max-wait-ms=8000     # 防抖封顶（活跃流最长等待）
node service/sodex-watch/main.mjs 0xYourAddress --account-id=12345     # 跳过 accountId 解析
node service/sodex-watch/main.mjs 0xYourAddress --raw                  # 附原始帧/响应
```

约束：`--config` 仅实时 WS 模式，与 `--snapshot` **互斥**（多地址快照本次不做）。

## 八、部署与隐私结论

- **被监听地址无法察觉**：读公开数据不通知对方、不上链。唯一可见方是网关运营方的服务端日志（你的源 IP + 订阅帧里的地址）。
- **WS 优于 REST 轮询**：单条长连接 + 被动接收，足迹最小；REST 轮询才像扫描、易被限流。
- **无 API key**：全链路 public，无凭据可泄露/轮换，「key 轮换」在此不适用。
- **运行位置**：7×24 监听首选小型 VPS + `systemd Restart=always`（自愈 + 重启存活）；本机仅在常开不休眠时可用。
- **IP 暴露对比**：本机暴露住宅 IP（≈城市级定位 + ISP，凭法律程序可溯源）；VPS 暴露数据中心 IP（不直接暴露住宅位置，但 VPS 账单可溯源到本人）。两者对法律程序都非匿名。
- **VPN/代理**：只是把你的 IP 换成它的（常规隐私手段），不等于匿名——信任转移到 VPN 方（有支付信息、可能记日志）。真正风险是**关联**：别用同一 IP/网络既监听又登录你本人账户。
- **边界**：不为「规避运营方识别」做 IP 轮换/多跳/反关联工程；只做正常连接卫生（单连接、限速、抖动重连）+ 监听与本人账户隔离。
- **配置隐私**：`service/sodex-watch/config.json` 含 Telegram bot token / chat_id → 已入 `.gitignore`，仅 VPS 本地存在。

## 九、仓位与平仓历史展示

### 仓位卡片（对齐线上 Position 表）

console 表格列：`Coin(含 Nx 杠杆) | 方向 | 持仓量 | 仓位价值 | Entry | Mark | Unrealized PnL (ROE%) | Liq.Price | Margin | 离场挂单`。
Telegram 卡片每项独占一行，末尾追加离场挂单。console 与 TG 共用 `derivePositionView()` 派生，两端口径一致。

- **方向**：`ps=BOTH` 按 `size` 符号判 LONG/SHORT；hedge 直接用 `ps`。中文映射 `LONG→做多 / SHORT→做空`。
- **持仓量 / 仓位价值**：仓位价值 = `标记价 × |size|`（USD，2 位）。
- **Margin** = `|size|×entry / leverage`；模式来自 `m`（Cross/Isolated）。**ROE%** = `uPnL / margin`。
- **标记价（Mark）反推**：账户快照不含合约 mark，用 `mark = 开仓价 + 未结盈亏 / 带符号数量` 反推（因 `ur=(mark−entry)×带符号size`），与展示盈亏天然自洽。无法反推时标记价/价值显示 `-`。
- **离场挂单（reduceOnly）**：仓位卡片末尾按 symbol + 方向匹配该仓的离场单：
  - 行格式 `离场挂单 {止盈|止损} @ {价} ({全平|部分} {量}{部分时 /持仓量})`
  - 方向匹配：reduceOnly `SELL→平多`、`BUY→平空`；hedge 按 `ps`
  - TP/SL 推断：多单 SELL 价 > 标记 → 止盈、< → 止损；空单反之
  - **mark 反推不出（G11）**：退化为 `离场挂单 @ 价 (...)`，不带止盈/止损标签
  - 孤儿单（无对应持仓）暂忽略；stop 类型订单样本未实测，TP/SL 暂按价格侧推断

### 平仓历史（权威盈亏，替换原成交历史）

来源 `data/api/v1/perps/positions`（按 account_id，仅 `size=0` 已平仓记录）。**比逐笔成交回放更准**——直接用接口权威 `realized_pnl`（仓位生命周期累计 = 平仓总盈亏）+ 资金费 + 均价。

- **排序（G3）**：接口按 `position_id` 返回（非平仓时间），pid 小但 `updated_at` 新会排后 → **客户端按 `updated_at` 降序**再取最近 N（默认 2，`--history-limit=N`）。
- 每条两行：
  ```
  {★ }币种 方向 {全平|部分}  {MM/DD HH:mm}
    开仓 {均开} → 平仓 {均平}
    数量：{cum_closed_size}
    盈亏 {realized_pnl 带符号}  资金费 {funding_fee 带符号}
  ```
- **★ 新记录**：首帧基线全部不标（避免满屏 ★），之后新出现的已平仓位（新 `position_id`）标 ★，沿用 `seenPositionIds` + `baselineLogged` 机制。
- **限制**：`perps/positions` 只返已平仓（size=0），**部分减仓（仓仍开）期间无平仓历史记录**；其可见性靠 WS 实时持仓 diff（DECREASED），权威 PnL 待全平才出现。

### banner（去重，三行）

每次变化打印方框 banner，**只有头部**（原 `OPENED/CLOSED…` 明细行已删，与仓位卡片重复）。头部 `bannerHead(displayId, kind, clock)` 分三行——**动作(emoji+动词) / 时间(🕐) / 身份(📡+displayId) 各独立一行**（避免长动词或完整时间在手机 TG 折行），时间统一 `YYYY/MM/DD HH:mm:ss`（上海 UTC+8）：

```
╔════════════════════════════════╗
║ 🟢 OPEN POSITION               ║
║ 🕐 2026/06/20 22:24:03         ║
║ 📡 【0x58...7027】🎯 xiao      ║
╚════════════════════════════════╝
```

- **displayId**：默认 `【短地址】`（前 4 位含 `0x` + `...` + 后 4，如 `【0x58...7027】`）；config 项有 `label` 时在括号外用 🎯 追加（如 `【0x58...7027】🎯 xiao`）。
- banner 类型（kind）由仓位 diff 动词判定，emoji 映射：

| kind | emoji | 显示 |
|------|-------|------|
| START WATCH | 👀 | `👀 START WATCH` |
| OPEN POSITION | 🟢 | `🟢 OPEN POSITION` |
| CLOSE POSITION | 🔴 | `🔴 CLOSE POSITION` |
| INCREASE POSITION | 📈 | `📈 INCREASE POSITION` |
| REDUCE POSITION | 📉 | `📉 REDUCE POSITION` |
| SNAPSHOT | 📸 | `📸 SNAPSHOT` |
| POSITION CHANGE | 🔄 | `🔄 POSITION CHANGE` |

- "什么动作"由头部动词、"什么币/量/价"由仓位卡片、平仓由「平仓历史」表达——消除重复。

### START WATCH 门控（多地址模式，避免部署噪音）

多地址 `--config` 模式下，**仅 config 中相比上次新增的地址**才推送 `👀 START WATCH` 到 Telegram；已监听过的地址重启/部署时只在内部建基线、不推 TG（console banner 照常打）。

- 状态文件 `sodex-watch/.seen-addresses.json`（gitignore，跨部署比对），记录已通知过 START 的地址集合，启动时并集落盘。
- 门控逻辑在 `tool/seenAddresses.mjs`（`loadSeenAddresses`/`computeNewAddresses`/`saveSeen`），sodex-watch 与 HYPE-watch 共用。
- **单地址 CLI 模式不门控**（交互式，照常推 START）。
- **强制全部重推**：删除 `.seen-addresses.json` 后下次启动所有 config 地址重新推 START。

### 离场挂单变化轻提醒（独立 banner）

reduceOnly 单集合 diff（按 orderId）检测 PLACE/MODIFY/CANCEL → 主报告之后单发：

```
🏹 离场挂单
🕐 2026/06/20 22:24:03
📡 【0x58...7027】🎯 xiao
设置/撤销/调整 {止盈|止损} {coin} {方向} @ {价}
```

- **MODIFY（G9）**：同 orderId 的 `p`/`q` 变 → 一条"调整"；交易所撤旧+新单实现改单时退化为 撤销+设置 两条（可接受）。
- **FILL 不双报**：reduceOnly 单消失时，若同窗口该 symbol 仓位减/平 → 判成交，归平仓事件，不发撤销提醒；否则判撤销。
- 首帧只建立基线，不提醒；普通开仓单（`R:false`）挂/撤 **不触发任何报告/通知**。

### 时区与精度

- 时间统一 `fmtTime`，**北京时间 UTC+8**（`Asia/Shanghai`，无 DST），格式 `YYYY/MM/DD HH:mm:ss`（斜杠分隔）。
- 数值按字段分精度 + 千分位 + 去尾零（`fmtNum/fmtUsd/fmtPct`）：价格类按币种 `pricePrecision`；数量按 `quantityPrecision`（封顶 6）；USD 金额 2 位；缺失/非法显示 `-`。

## 十、Snapshot 模式（单地址 `--snapshot`：按需 + 每日定时）

实时 WS 之外的第二种模式：**不**保持持久 WS，改用 REST 取快照，适合「每天定点看一次 + 想看时手动拉」。

- **当前持仓 / 离场单来源**：REST `GET {gateway}/api/v1/perps/accounts/{address}/state`，解析 `data.P`（持仓）/ `data.O`（离场单）/ `data.aid`（accountId）。
- **平仓历史**：同实时模式走 data host `api/v1/perps/positions`（默认最近 2，`--history-limit=N`）。
- **每日定时**：默认每天 **20:00 上海时间（UTC+8）**；`--at=HH:MM` 可改。
- **按需触发**：`kill -USR1 <pid>`（headless/systemd 可用，无端口、无鉴权面）；交互式 TTY 下额外支持回车。
- 复用实时模式渲染：仓位卡片(含离场挂单)、平仓历史、★ 新增标记；banner 头为 `SNAPSHOT`。

## 十一、多地址模式（`--config`）

```bash
node service/sodex-watch/main.mjs --config=service/sodex-watch/config.json
```

- 进程内循环 `new AccountWatcher(addr)`，各自独立 WS（物理隔离：一地址断不影响其他），共享模块级限流器。
- 配置：**全局一个 bot（`tgToken`）+ 每地址独立 `tgChat`**；地址项可选 `tgToken` 覆盖、可选 `label` 别名、可选 `at` 镜像时刻。
- **每地址独立每日镜像时刻 `at`（可选）**：每个地址各自在自己的 `at`（上海时间 `HH:MM`）触发一次 SNAPSHOT，可错峰避免 N 地址同一时刻并发拉取。取值优先级 **地址项 `at` > 全局 `--at` > 默认 `20:00`**；非法值（非 `HH:MM`）告警并回退默认。
- 错误处理（G8）：文件缺失 / JSON 解析失败 / `watches` 空 → 退出；非法 `address` 跳过告警；重复 address 去重保首个；非法 `at` 告警回退默认。
- 配置含 TG 凭据 → **不入 git**（`.gitignore`），仅服务器本地填写 `service/sodex-watch/config.json`。
- 容量：1GB/1 核 VPS 跑 5–10 地址内存/CPU 充裕；瓶颈是 data host 限流，由共享限流器兜。
