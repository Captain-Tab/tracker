# WS 监听账户变化 → REST 拉成交详情（perps）

`watch-account.mjs` 的设计说明。配套已有的 `query-account.mjs`（快照查询）。

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
       ├─ accountState 快照 → 当前持仓(data.P) + mark(data.B) + account_id(aid，取不到走 chain 备用)
       │     对快照 P+O 做指纹去重，过滤服务端周期性重推
       └─ 指纹变化 或 收到 accountTrade → 防抖 750ms 合并 → fetchAndReport()
              ├─ 当前持仓：直接用上面的 WS 快照（不再请求 data positions 端点）
              ├─ 成交历史：GET data/api/v1/perps/trades?account_id=N（默认最近 10，--all 全量）
              ├─ 与上次持仓 diff → 事件；逐笔回放算 Realized PnL；相对上次的新成交标 ★
              └─ 打印：fill-driven banner + 仓位表 + Trade History 表
                   （Time | Coin | Direction | Price | Amount | Trade Value | Realized PnL | Fee）
       └─ onclose: 指数退避重连（1s→30s，带 jitter）+ 重新订阅
```

## 五、字段映射（取自 sodex-next 源码）

- 成交 `side`：`{1: Buy, 2: Sell}`（`domain/normalize/history.ts:23`）
- 仓位方向：WS 快照 `ps` 为名称（`LONG`/`SHORT`/`BOTH`）；`BOTH`（单向模式）按 `size` 符号判 LONG/SHORT
- `symbol_id` → `baseCoin/quoteCoin`：`biz/futures/symbols`（`perpsApi.ts:23`）
- Trade Value = price × quantity；所有数值列统一 2 位小数（见 §九「时区与精度」）
- 成交时间 `ts_ms`，Fee 计价币 = `quoteCoin`

## 六、健壮性（SDK 帮我们做、脚本里自己实现）

1. `{op:"ping"}` 每 15s + pong 看门狗（`ws.mjs:1194`）
2. 大整数安全解析（ID 类字段 16+ 位转字符串，避免 Number 丢精度）
3. 断线指数退避重连 + 重放订阅
4. subscribe ack `success:false` 打日志
5. HTTP 超时 10s + AbortController

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
- **事件驱动而非轮询**：服务端会周期性重推 `accountState` 快照。脚本对快照 `P+O` 做指纹去重，**仅在指纹变化或收到 `accountTrade` 时**才拉成交历史并打印；首帧打印一次基线。
- **成交历史**走 REST `api/v1/perps/trades`（按 account_id），仅在变化时拉取。

### 仓位展示（对齐线上 Position 表列）

列：`Coin(含 Nx 杠杆) | Amount | Position Value | Entry | Mark | Unrealized PnL (ROE%) | Liq.Price | Margin`

- **方向**：`ps=BOTH`（单向模式）按 `size` 符号判 LONG/SHORT；hedge 模式直接用 `ps`。
- **杠杆**：合到 Coin 列（`SPCX 5x LONG`）。杠杆是仓位级属性，**不进** Trade History。
- **Margin** = `|size|×entry / leverage`（实测对齐线上 `$13.97`）；模式来自 `m`（Cross/Isolated）。
- **ROE%** = `uPnL / margin`（实测对齐线上 `-4.42%`）。
- **Mark / Position Value**：Mark 取快照 balances 的币种 oracle 价（`B[].px`，按 base coin 匹配）；查不到时 Position Value 回退用 entry，Mark 显示 `-`。
- **Liq.Price**：与全局精度一致，2 位小数（见下「时区与精度」）。

### 逐笔已实现盈亏（Realized PnL，计算列）

API **不返回**逐笔盈亏（trades 只有 price/quantity/fee/side；盈亏只在仓位级 `cr`）。本列由脚本**回放成交序列**计算：

- 按 symbol 时间升序回放，维护带符号净持仓 `qty` 与**加权均价** `entry`。
- 开仓/加仓笔：更新 `entry`，本笔无已实现盈亏（显示 `-`）。
- 平仓/减仓笔：`PnL = (成交价 − entry) × 平仓量 × 方向符号`（多 +1 / 空 −1）；越过 0 则余量按成交价反向开新仓。
- 实测对齐：Buy0.11→Sell0.11 = `+$0.0220`；Sell0.36→Buy0.36 = `−$0.2268`。

**新增行标记**：每次因账户变化重拉成交后，相对上次**新出现**的成交行，行首打 `★`（旧行用等宽空格占位对齐）。首次基线打印不标，之后才标。

**事件 banner（fill-driven）**：每次变化打印一个方框 banner，描述本次新成交及其导致的持仓结果，与 `★` 行保持一致：

```
╔═══════════════════════════════════════════╗
║ ⚡ NEW FILL  ·  14:29:00                   ║
║    Sell 0.21 SPCX @ 197.96  →  SHORT 0.21 ║
╚═══════════════════════════════════════════╝
```

- 平仓：`Buy 0.21 SPCX @ 198.10  →  FLAT (closed)`。
- 多笔：列出每笔 + 每币种结果行。
- 无新成交但持仓变化：退化为 `POSITION CHANGE` + diff 事件；都没有则 `ACCOUNT UPDATE`。
- banner 对齐按「emoji 宽度=2」计算，适配大多数现代终端；个别终端把 ⚡ 渲染成单宽时右边框可能偏移（仅视觉，不影响数据）。

**口径与限制**：

- 仅「交易盈亏」，**不含资金费**（trades 无此数据），手续费在独立 Fee 列；故与线上「已实现盈亏」可能略有出入。
- 准确性依赖窗口**包含开仓笔**——默认最近 10 条时，若仓位在窗口外开的，最早几行盈亏会失真；要全准用 `--all`。

### 时区与精度

- 成交时间显示**北京时间 UTC+8**（`Asia/Shanghai`，无 DST），格式 `YYYY-MM-DD HH:mm:ss`。
- **所有数值列统一 2 位小数**（Price / Amount / Trade Value / Realized PnL / Fee / Entry / Mark / Liq.Price / Position Value / Margin / ROE%）。

### 成交历史两种模式

- **默认**：最近 **10** 条（`--history-limit ?? 10`），每次变化单页拉取。
- **`--all`**：按游标 `meta.next_cursor` 翻页拉全部（每页 100，安全上限 200 页）。
- `--history-limit=N` 自定义单页条数。
- 注意：`--all` 在每次变化事件都会重拉全量，适合一次性 dump，不适合长驻默认。

## 十、Snapshot 模式（`--snapshot`：按需 + 每日定时）

实时 WS 监听之外的第二种模式：**不**保持持久 WS，改用 REST 取快照，适合「每天定点看一次 + 想看时手动拉」。

- **当前持仓来源**：REST `GET {gateway}/api/v1/perps/accounts/{address}/state`（按 address，公开无鉴权），解析 `data.P`（同 WS 快照字段）取 live 持仓、`data.B` 取 mark、`data.aid` 取 accountId。
- **成交历史**：同实时模式走 data host `api/v1/perps/trades`（默认最近 10，`--all` 全量）。
- **每日定时**：默认每天 **20:00 上海时间（UTC+8）** 抓一次。`msUntilNextShanghai` 用固定 +8 偏移算下一个触发点（上海无 DST）；`--at=HH:MM` 可改。
- **按需触发**：
  - **`kill -USR1 <pid>`** —— 主推荐，headless / systemd 下可用，无端口、无鉴权面（脚本启动时打印 pid）。
  - 终端回车 —— 仅在交互式 TTY 下额外支持，方便本地测试。
  - 未采用 stdin-only（服务器无 TTY）或 HTTP 端口（增加攻击面，与低足迹目标冲突）。
- 复用实时模式的渲染：仓位表、成交表、`★` 新增行标记、`diffPositions` 事件、Realized PnL 计算；banner 头为 `⚡ SNAPSHOT · <原因>`（启动 / 每日 20:00 / 按需）。
- 启动先抓一次基线（不标 ★），之后每日 / 按需抓取相对上次的新成交标 `★`。

## 七、用法

```bash
node watch-account.mjs 0xYourAddress                       # 实时 WS 监听（默认），成交历史默认最近 10 条
node watch-account.mjs 0xYourAddress --snapshot            # 快照模式：启动抓一次 + 每日 20:00 上海时间
node watch-account.mjs 0xYourAddress --snapshot --at=08:30 # 改每日抓取时间
#   按需触发：kill -USR1 <pid>（或交互式终端回车）
node watch-account.mjs 0xYourAddress --all                 # 成交历史拉全部（游标翻页）
node watch-account.mjs 0xYourAddress --history-limit=30     # 自定义单页条数
node watch-account.mjs 0xYourAddress --enable-web-fallback # 主路失败降级 web
node watch-account.mjs 0xYourAddress --debounce-ms=500     # 自定义防抖
node watch-account.mjs 0xYourAddress --account-id=12345    # 跳过 accountId 解析
node watch-account.mjs 0xYourAddress --raw                 # 附原始帧/响应
```
