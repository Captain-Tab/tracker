# WS 监听账户变化 → REST 拉成交详情（perps）

`script/watch-account.mjs` 的设计说明。配套已有的 `script/query-account.mjs`（快照查询）。

## 一、目标

长驻监听一个钱包 `address` 的**合约（perps）账户**：

- WS 收到账户变化（开仓 long/short、加减仓、平仓、成交）→ 作为**触发器**
- 触发后用 REST 拉**权威详情**：当前仓位 + 成交历史（Trade History）+ 订单
- 主路 sodex-next，备路 sodex-web（`--enable-web-fallback`）
- 全程**零鉴权**（已实测验证，见下）、零依赖（Node 22 内置 `WebSocket` + `fetch`）

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
| 成交/订单/仓位历史 | `https://mainnet-data.sodex.dev/api/v1/perps/{trades,orders,positions}` | `account_id` | 无 |
| 符号元数据 | `https://alpha-biz.sodex.dev/biz/futures/symbols?env=mainnet` | — | 无 |
| address→accountId 备用 | `https://sodex.dev/mainnet/chain/address/{address}/accounts` | `address` | 无 |
| 备路 sodex-web | 同网关，`/futures/fapi/...` | `accountId` | 无（public path）|

## 四、执行流程

> 默认实时 WS 监听模式；另有 `--snapshot` 快照模式见 §十。

```
启动
 ├─ 拉 biz/futures/symbols → 建 symbol_id → {name, quoteCoin} 缓存（每 6h 刷新）
 └─ 连 wss .../ws/perps
       ├─ onopen: 订阅 accountState / accountUpdate / accountOrderUpdate / accountTrade（user=address）
       ├─ 心跳: 每 15s 发 {op:"ping"}，pong 看门狗超时则重连
       ├─ accountState 快照 → 当前持仓(data.P) + account_id(aid，取不到走 chain 备用)；标记价由持仓 ur 反推（见 §九）
       │     对快照仓位做规范化指纹去重（abs(size)+派生方向+按 symbol 排序），过滤服务端周期性重推与表示/顺序漂移
       └─ 指纹变化 或 收到 accountTrade → 防抖 3000ms（+maxWait 5000ms 封顶）合并 → fetchAndReport()
              ├─ 当前持仓：直接用上面的 WS 快照（不再请求 data positions 端点）
              ├─ 成交历史：GET data/api/v1/perps/trades?account_id=N（默认最近 2，--all 全量）
              ├─ 与上次持仓 diff → 事件；逐笔回放算 Realized PnL；相对上次的新成交标 ★
              └─ 打印：fill-driven banner + 仓位表 + Trade History 表
                   （Time | Coin | Direction | Price | Amount | Trade Value | Realized PnL | Fee）
       └─ onclose: 指数退避重连（1s→30s，带 jitter）+ 重新订阅
```

## 五、字段映射（取自 sodex-next 源码）

- 成交 `side`：`{1: Buy, 2: Sell}`（`domain/normalize/history.ts:23`）
- 仓位方向：WS 快照 `ps` 为名称（`LONG`/`SHORT`/`BOTH`）；`BOTH`（单向模式）按 `size` 符号判 LONG/SHORT
- `symbol_id` → `baseCoin/quoteCoin`：`biz/futures/symbols`（`perpsApi.ts:23`）
- Trade Value = price × quantity；数值按字段分精度（价格/数量按币种精度，USD 类 2 位，均千分位 + 去尾零，见 §九「时区与精度」）
- 成交时间 `ts_ms`，Fee 计价币 = `quoteCoin`

## 六、健壮性（SDK 帮我们做、脚本里自己实现）

1. `{op:"ping"}` 每 15s + pong 看门狗（`ws.mjs:1194`）
2. 大整数安全解析（ID 类字段 16+ 位转字符串，避免 Number 丢精度）
3. 断线指数退避重连 + 重放订阅
4. subscribe ack `success:false` 打日志
5. HTTP 超时 10s + AbortController
6. **限流退避（429/409）**：优先服务端 `Retry-After`，否则指数退避 2→60s + ±20% jitter；`rateLimitUntil` gate 所有请求，冷却后单次 catch-up；**限流时不打 web 备路**（两 host 可能共限）
7. **拉取失败兜底**：任何未成功拉取（限流/硬错误未降级）一律跳过本次上报、保留 `lastOutFp`/`forceReport` 待下次，**绝不渲染空成交历史**（防误报）
8. **去重双层规范化**：触发层 `stateFp` 与出参层 `outFp` 均用 `canonicalPositionsFp`（abs size+派生方向+排序）；成交分量用全 `tradeKey` 排序拼接（顺序无关、不碰大 id 精度）→ 不多发；REST 全量权威 + catch-up → 不漏发

## 八、部署与隐私结论

- **被监听地址无法察觉**：读公开数据不通知对方、不上链。唯一可见方是网关运营方的服务端日志（你的源 IP + 订阅帧里的地址）。
- **WS 优于 REST 轮询**：单条长连接 + 被动接收，足迹最小；REST 轮询才像扫描、易被限流。
- **无 API key**：全链路 public，无凭据可泄露/轮换，「key 轮换」在此不适用。
- **运行位置**：7×24 监听首选小型 VPS + `systemd Restart=always`（自愈 + 重启存活）；本机仅在常开不休眠时可用。
- **IP 暴露对比**：本机暴露住宅 IP（≈城市级定位 + ISP，凭法律程序可溯源）；VPS 暴露数据中心 IP（不直接暴露住宅位置，但 VPS 账单可溯源到本人）。两者对法律程序都非匿名。
- **VPN/代理**：只是把你的 IP 换成它的（常规隐私手段），不等于匿名——信任转移到 VPN 方（有支付信息、可能记日志）。真正风险是**关联**：别用同一 IP/网络既监听又登录你本人账户。
- **边界**：不为「规避运营方识别」做 IP 轮换/多跳/反关联工程；只做正常连接卫生（单连接、限速、抖动重连）+ 监听与本人账户隔离。

## 九、实跑修正（run-test 反馈）

- **当前持仓来源改为 WS 快照**：`accountState.data.P`（字段 `s/ps/sz/ep/ur/cr/l/lp/m`，见 `@sodex/sdk` `parsePerpsSnapshotPosition`）。data-host 的 `api/v1/perps/positions` 是**历史/已结**仓位（size=0），不是当前持仓——已弃用于「当前仓位」展示。
- **事件驱动而非轮询**：服务端会周期性重推 `accountState` 快照。脚本对快照**仓位做规范化指纹去重**（`canonicalPositionsFp`：abs size+派生方向+排序，**不含订单数组** —— 订单易变字段每秒翻指纹会造成过度拉取，且报告不展示挂单），**仅在指纹变化或收到 `accountTrade` 时**才拉成交历史并打印；首帧打印一次基线。
- **成交历史**走 REST `api/v1/perps/trades`（按 account_id），仅在变化时拉取。

### 仓位展示（对齐线上 Position 表列）

列（终端表格）：`Coin(含 Nx 杠杆) | 方向 | 持仓量 | 仓位价值 | Entry | Mark | Unrealized PnL (ROE%) | Liq.Price | Margin`

Telegram 卡片每项独占一行：`方向 / 持仓量 / 仓位价值 / 开仓价 / 标记价 / 未结盈亏(ROE%) / 强平价 / 保证金`。console 与 TG 共用 `derivePositionView()` 派生，保证两端口径一致。

- **方向**：`ps=BOTH`（单向模式）按 `size` 符号判 LONG/SHORT；hedge 模式直接用 `ps`。展示中文映射 `LONG→做多 / SHORT→做空`。
- **杠杆**：合到 Coin 列（`SPCX 5x LONG`）。杠杆是仓位级属性，**不进** Trade History。
- **持仓量 / 仓位价值**：拆为两项；仓位价值 = `标记价 × |size|`（USD，2 位）。
- **Margin** = `|size|×entry / leverage`（实测对齐线上 `$13.97`）；模式来自 `m`（Cross/Isolated）。
- **ROE%** = `uPnL / margin`（实测对齐线上 `-4.42%`）。
- **标记价（Mark）反推**：账户快照**不含合约 mark**（`data.B` 是抵押币余额，非合约标的价）。改用持仓字段反推 `mark = 开仓价 + 未结盈亏 / 带符号数量`（因 `ur=(mark−entry)×带符号size`），与展示盈亏天然自洽。数量为 0 / 字段缺失时标记价与仓位价值均显示 `-`。
- **精度**：价格类（开仓价/标记价/强平价/成交价）按币种 `pricePrecision`；数量按 `quantityPrecision`（封顶 6）；USD 金额（仓位价值/盈亏/保证金）2 位；均千分位 + 去尾零。统一走 `fmtNum/fmtUsd/fmtPct`。

### 逐笔已实现盈亏（Realized PnL，计算列）

API **不返回**逐笔盈亏（trades 只有 price/quantity/fee/side；盈亏只在仓位级 `cr`）。本列由脚本**回放成交序列**计算：

- 按 symbol 时间升序回放，维护带符号净持仓 `qty` 与**加权均价** `entry`。
- 开仓/加仓笔：更新 `entry`，本笔无已实现盈亏（显示 `-`）。
- 平仓/减仓笔：`PnL = (成交价 − entry) × 平仓量 × 方向符号`（多 +1 / 空 −1）；越过 0 则余量按成交价反向开新仓。
- 实测对齐：Buy0.11→Sell0.11 = `+$0.0220`；Sell0.36→Buy0.36 = `−$0.2268`。

**新增行标记**：每次因账户变化重拉成交后，相对上次**新出现**的成交行，行首打 `★`（旧行用等宽空格占位对齐）。首次基线打印不标，之后才标。

**事件 banner（动词化，全部带 `【accountId】`）**：每次变化打印方框 banner，头部由 `bannerHead(accountId, kind, clock)` 生成，时间统一 `fmtTime` 的 `YYYY/MM/DD HH:mm:ss`（上海 UTC+8）：

```
╔══════════════════════════════════════════════════╗
║ ⚡ 【1163】 OPEN POSITION · 2026/06/18 14:29:00   ║
║    Sell 0.21 SPCX @ 197.96  →  SPCX 做空 0.21    ║
╚══════════════════════════════════════════════════╝
```

banner 类型（kind）：

- `START WATCH` — 启动基线
- `OPEN / CLOSE / INCREASE / REDUCE POSITION` — 单笔开/平/加/减（由成交 + 仓位 diff 动词判定）
- `POSITION UPDATE (n)` — 多笔成交
- `POSITION CHANGE` — 仓位变化但无成交可归因（带 diff 明细，兜底）
- `SNAPSHOT` — 快照/每日（不带原因）
- 平仓结果行显示 `→ SPCX 已平仓`；旧的 `ACCOUNT UPDATE`（无变化）已删除，无变化不单独发通知。
- banner 对齐按「emoji 宽度=2」计算，适配大多数现代终端；个别终端把 ⚡ 渲染成单宽时右边框可能偏移（仅视觉，不影响数据）。

**口径与限制**：

- 仅「交易盈亏」，**不含资金费**（trades 无此数据），手续费在独立 Fee 列；故与线上「已实现盈亏」可能略有出入。
- 准确性依赖窗口**包含开仓笔**——默认最近 2 条时，若仓位在窗口外开的，最早几行盈亏会失真；要全准用 `--all`。

### 时区与精度

- 所有事件 / 成交时间走统一 `fmtTime`，显示**北京时间 UTC+8**（`Asia/Shanghai`，无 DST），格式 `YYYY/MM/DD HH:mm:ss`（斜杠分隔）。
- **数值按字段分精度 + 千分位 + 去尾零**（统一 `fmtNum/fmtUsd/fmtPct`）：
  - 价格类（Price / Entry / Mark / Liq.Price）→ 按币种 `pricePrecision`
  - 数量类（Amount / 持仓量）→ 按 `quantityPrecision`（封顶 6）
  - USD 金额（Trade Value / Realized PnL / Position Value / Margin）→ 2 位
  - 手续费 Fee → 按 `quoteCoinDisplayPrecision`；ROE% → 2 位带符号
  - 缺失 / 非法值统一显示 `-`（不当 0）

### 成交历史两种模式

- **默认**：最近 **2** 条（`--history-limit ?? 2`），每次变化单页拉取。
- **`--all`**：按游标 `meta.next_cursor` 翻页拉全部（每页 100，安全上限 200 页）。
- `--history-limit=N` 自定义单页条数。
- 注意：`--all` 在每次变化事件都会重拉全量，适合一次性 dump，不适合长驻默认。

## 十、Snapshot 模式（`--snapshot`：按需 + 每日定时）

实时 WS 监听之外的第二种模式：**不**保持持久 WS，改用 REST 取快照，适合「每天定点看一次 + 想看时手动拉」。

- **当前持仓来源**：REST `GET {gateway}/api/v1/perps/accounts/{address}/state`（按 address，公开无鉴权），解析 `data.P`（同 WS 快照字段）取 live 持仓、`data.aid` 取 accountId；标记价同实时模式由持仓 `ur` 反推（见 §九）。
- **成交历史**：同实时模式走 data host `api/v1/perps/trades`（默认最近 2，`--all` 全量）。
- **每日定时**：默认每天 **20:00 上海时间（UTC+8）** 抓一次。`msUntilNextShanghai` 用固定 +8 偏移算下一个触发点（上海无 DST）；`--at=HH:MM` 可改。
- **按需触发**：
  - **`kill -USR1 <pid>`** —— 主推荐，headless / systemd 下可用，无端口、无鉴权面（脚本启动时打印 pid）。
  - 终端回车 —— 仅在交互式 TTY 下额外支持，方便本地测试。
  - 未采用 stdin-only（服务器无 TTY）或 HTTP 端口（增加攻击面，与低足迹目标冲突）。
- 复用实时模式的渲染：仓位表、成交表、`★` 新增行标记、`diffPositions` 事件、Realized PnL 计算；banner 头为 `⚡ SNAPSHOT · <原因>`（启动 / 每日 20:00 / 按需）。
- 启动先抓一次基线（不标 ★），之后每日 / 按需抓取相对上次的新成交标 `★`。

## 七、用法

```bash
node script/watch-account.mjs 0xYourAddress                       # 实时 WS 监听（默认），成交历史默认最近 2 条
node script/watch-account.mjs 0xYourAddress --snapshot            # 快照模式：启动抓一次 + 每日 20:00 上海时间
node script/watch-account.mjs 0xYourAddress --snapshot --at=08:30 # 改每日抓取时间
#   按需触发：kill -USR1 <pid>（或交互式终端回车）
node script/watch-account.mjs 0xYourAddress --all                 # 成交历史拉全部（游标翻页）
node script/watch-account.mjs 0xYourAddress --history-limit=30     # 自定义单页条数
node script/watch-account.mjs 0xYourAddress --enable-web-fallback # 主路失败降级 web
node script/watch-account.mjs 0xYourAddress --debounce-ms=500     # 自定义防抖
node script/watch-account.mjs 0xYourAddress --max-wait-ms=8000    # 防抖封顶（活跃流最长等待）
node script/watch-account.mjs 0xYourAddress --account-id=12345    # 跳过 accountId 解析
node script/watch-account.mjs 0xYourAddress --raw                 # 附原始帧/响应
```
