# 服务端架构与部署设计（Server Architecture）

> tracker 服务端总图：多服务如何在服务器上摆放、隔离、通信、稳定运行、记录数据。
> 涵盖现有 Node 服务（discovery / watch）与未来 Rust 执行服务（跟单 / 做市），作为后续扩展的施工依据。
> 配套文档：跟单业务逻辑见 [`copy-trade-blueprint.md`](./copy-trade-blueprint.md)；本文只讲**部署/隔离/通信**，不重复业务逻辑。

---

## 目录

1. [目的与范围](#1-目的与范围)
2. [核心概念速览（不熟服务器也能懂）](#2-核心概念速览不熟服务器也能懂)
3. [服务清单与职责划分（读/写分离）](#3-服务清单与职责划分读写分离)
4. [语言选型与理由](#4-语言选型与理由)
5. [Node 服务建议](#5-node-服务建议)
6. [单机多服务部署（systemd 加固，可直接抄）](#6-单机多服务部署systemd-加固可直接抄)
7. [日志规范（可直接抄）](#7-日志规范可直接抄)
8. [服务间通信（冷/暖/控制/热 四层）](#8-服务间通信冷暖控制热-四层)
9. [钱包与 nonce 隔离规则](#9-钱包与-nonce-隔离规则)
10. [资源预算估算](#10-资源预算估算)
11. [将来平滑拆成两台 VPS](#11-将来平滑拆成两台-vps)
12. [分阶段路线图 & 现在不做什么](#12-分阶段路线图--现在不做什么)

---

## 1. 目的与范围

要解决的问题：把多个服务（选人、监控、跟单、做市）在一台服务器上**安全摆放、互不干扰、稳定运行、出事可追**，并为将来拆机留好门。

约束：
- **不重写现有 Node 逻辑**（discovery/watch 已可用且非平凡）。
- **签名安全第一**：私钥不离本机，复用审计过的 SDK。
- **现在一台 VPS 即可**，设计要能将来平滑拆成两台而不重写。

---

## 2. 核心概念速览（不熟服务器也能懂）

| 概念 | 大白话 |
|------|--------|
| **VPS** | 机房里租的一台远程电脑，装 Linux，24h 开机联网。 |
| **进程** | 一个正在运行的程序实例，住在自己独立的内存「房间」里，看不到别的进程的内存。 |
| **服务** | 一个一直跑不退出的程序（如 watch）。 |
| **systemd** | Linux 自带的「管家」：开机自动拉起服务、崩溃自动重启、限制资源、收集日志。 |
| **服务间通信** | 进程内存隔离，互相看不到对方数据，要交换信息只能：传纸条（文件）、打电话（网络/HTTP）、用公告栏（数据库/Redis）。 |
| **cgroup** | Linux 给每个进程「划配额」的机制（最多用多少内存/CPU），systemd 通过它做隔离。 |
| **journald** | systemd 的日志中心，所有服务的输出都汇到这里，用 `journalctl` 统一查。 |

---

## 3. 服务清单与职责划分（读/写分离）

核心思路：**Node 管所有只读分析（选人 + 监控），Rust 管所有写操作（签名下单）。**

| 服务 | 语言 | 常驻/周期 | 职责 | 钱包 |
|------|------|-----------|------|------|
| sodex-discovery / HYPE-discovery | Node | 周期（timer） | 从榜单选出可跟单目标，产出名单 | 无（只读） |
| sodex-watch / HYPE-watch | Node | 常驻 | 监控目标账户变化，给**人**看的告警 | 无（只读） |
| notifier | Node | 常驻/触发 | 汇总各服务状态 → Telegram | 无 |
| **copy-trader** | **Rust** | 常驻 | 跟单：自订目标 fill → 下单 | 跟单子账户 |
| **mm-engine** | **Rust** | 常驻 | 现货做市：自订盘口 → 高频报价 | 做市子账户（独立） |

硬规则：
- **跟单与做市拆成两个 Rust 进程**（故障/风险互不传染）。
- **实时行情各服务直连交易所自取**，绝不在自有服务间转发（见 §8）。
- watch 是「给人看的监控」，**不**承担给 copy-trader 喂行情的职责。

---

## 4. 语言选型与理由

| 语言 | 用在哪 | 为什么 |
|------|--------|--------|
| **Node** | discovery / watch / notifier / 跟单执行（初期） | 复用审计过的 `@nktkas/hyperliquid` 签名 + 现有逻辑；负载 I/O 密集，语言计算无所谓 |
| **Rust** | 做市引擎、（成熟后）跟单执行 | 无 GC 抖动→延迟确定性；高吞吐；内存低；配 Rust SDK 保证签名安全 |
| ~~Go~~ | 暂不用 | 无官方 HL 签名 SDK，引入即重写危险的签名层；除非将来 watch 扩到几十地址撞内存才考虑 |
| ~~Python~~ | 不用 | 对此负载性能/内存双输，无收益 |

**不重写原则**：能跑的 Node 不动；Rust 只新增执行/做市这两个写侧服务。

---

## 5. Node 服务建议

- **运行时**：Node **≥ 22.12**（`@nktkas/hyperliquid` 最低要求；watch 用原生 WS 也需 22+）。VPS 先 `node -v` 确认。
- **SDK 接入**：npm 包是预编译 **ESM `.js` + `.d.ts`**，纯 `.mjs` **可直接 `import`，无需 TS、无需构建**。`.d.ts` 运行时被忽略。
  ```js
  import { ExchangeClient, HttpTransport } from '@nktkas/hyperliquid';
  import { privateKeyToAccount } from 'viem/accounts';
  const account = privateKeyToAccount(process.env.PRIVATE_KEY); // 私钥只在本地
  const exchange = new ExchangeClient({ wallet: account, transport: new HttpTransport() });
  ```
- **若要用 TypeScript**：**提前 `tsc` 编译成 JS 再部署**，VPS 跑编译产物。**禁止**在 VPS 上用 ts-node/tsx 实时跑 `.ts`（白增内存与启动开销）。
- **私钥**：执行器持有的是 **Agent Wallet（只能交易、不能提现）key**，不是主私钥（见 copy-trade-blueprint §10.7）。用 viem `privateKeyToAccount` 从 agent key 建 account，只存本地（systemd credential），**只把 account 对象传 SDK**。主私钥不上服务器。
- **版本纪律**：锁定 SDK 版本号，升级时人工 review diff；提交前跑 `/k:security` 扫依赖。

---

## 6. 单机多服务部署（systemd 加固，可直接抄）

约定路径：代码 `/opt/tracker/service`，独立运行用户 `tracker`（读侧）/ `trader-exec`（写侧）。

### 6.1 常驻 watch 服务

```ini
# /etc/systemd/system/sodex-watch.service
[Unit]
Description=Sodex account watch (always-on WS listener)
After=network-online.target
Wants=network-online.target
OnFailure=tracker-alert@%n.service

[Service]
Type=simple
User=tracker
Group=tracker
WorkingDirectory=/opt/tracker/service
ExecStart=/usr/bin/node sodex-watch/main.mjs --config=sodex-watch/config.json
Restart=always
RestartSec=5

# 资源隔离（cgroup）
MemoryMax=200M          # 硬上限：超了会被 OOM kill（然后 Restart 拉起）
MemoryHigh=160M         # 软上限：超了被节流回收，用于观察真实占用
CPUQuota=50%            # 最多用半个核
TasksMax=64

# 安全加固
NoNewPrivileges=true    # 进程及子进程永不提权
ProtectSystem=strict    # 整个文件系统只读
ProtectHome=true        # 看不到 /home
PrivateTmp=true         # 独立 /tmp
ReadWritePaths=/opt/tracker/service/logs   # 只放开日志目录可写

# 日志 → journald
StandardOutput=journal
StandardError=journal
SyslogIdentifier=sodex-watch

[Install]
WantedBy=multi-user.target
```

> **WatchdogSec 须知**：`WatchdogSec=` 只有当服务是 `Type=notify` 且程序周期性发 `sd_notify WATCHDOG=1` 才有效；否则 systemd 会到点误杀。Node 实现见 §6.4。**没实现心跳前，先只用 `Restart=always`，不要加 WatchdogSec。**

### 6.2 周期 discovery 服务 + 定时器

```ini
# /etc/systemd/system/sodex-discovery.service
[Unit]
Description=Sodex trader discovery (periodic batch)
After=network-online.target
Wants=network-online.target
OnFailure=tracker-alert@%n.service

[Service]
Type=oneshot                     # 跑完即退，不常驻
User=tracker
Group=tracker
WorkingDirectory=/opt/tracker/service
ExecStart=/usr/bin/node sodex-discovery/main.mjs
MemoryMax=400M                   # 解析大榜单峰值更高，给 400M
MemoryHigh=350M
CPUQuota=80%
TasksMax=64
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=/opt/tracker/service/log
StandardOutput=journal
StandardError=journal
SyslogIdentifier=sodex-discovery
```

```ini
# /etc/systemd/system/sodex-discovery.timer
[Unit]
Description=Run sodex-discovery weekly

[Timer]
OnCalendar=Mon *-*-* 09:00:00    # 每周一 09:00（系统时区）
Persistent=true                  # 漏跑（如关机）下次开机补跑

[Install]
WantedBy=timers.target
```

### 6.3 失败告警服务（被 OnFailure 触发）

```ini
# /etc/systemd/system/tracker-alert@.service   （模板单元，%i = 失败的单元名）
[Unit]
Description=Send Telegram alert for failed unit %i

[Service]
Type=oneshot
User=tracker
WorkingDirectory=/opt/tracker/service
ExecStart=/usr/bin/node app/alert.mjs %i       # alert.mjs 读取参数并推 Telegram
```

> 任意服务在 `[Unit]` 写 `OnFailure=tracker-alert@%n.service`，崩溃时自动触发告警，`%n` 把自己的单元名传进去。

### 6.4 Rust 执行服务（未来）+ 私钥安全注入

```ini
# /etc/systemd/system/copy-trader.service
[Unit]
Description=Rust copy-trade executor
After=network-online.target
Wants=network-online.target
OnFailure=tracker-alert@%n.service

[Service]
Type=simple
User=trader-exec                 # 独立用户，与读侧服务隔离
Group=trader-exec
WorkingDirectory=/opt/tracker/exec
ExecStart=/opt/tracker/exec/bin/copy-trader
Restart=always
RestartSec=5
MemoryMax=128M
CPUQuota=80%
TasksMax=32
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true

# Agent key 用 systemd credential 注入（比环境变量安全：仅本进程可读，不进 /proc/environ）
# 注入的是只能交易、不能提现的 Agent Wallet key，非主私钥（见 copy-trade-blueprint §10.7）
LoadCredential=agent-key:/etc/tracker/copy-trader-agent.key
# 程序内通过 $CREDENTIALS_DIRECTORY/agent-key 读取

StandardOutput=journal
StandardError=journal
SyslogIdentifier=copy-trader

[Install]
WantedBy=multi-user.target
```

### 6.5 常用运维命令

```bash
sudo systemctl daemon-reload                 # 改完 unit 后重载
sudo systemctl enable --now sodex-watch      # 开机自启 + 立即启动
sudo systemctl enable --now sodex-discovery.timer
systemctl status sodex-watch                 # 看状态
systemd-cgtop                                # 实时看各服务 CPU/内存占用（资源监控）
systemctl show sodex-watch -p MemoryCurrent  # 看当前内存
```

### 6.6 Watchdog 心跳（Node 端，可选）

```js
// 需要 Type=notify + WatchdogSec=120 时，程序里周期发心跳
import notify from 'sd-notify';      // npm i sd-notify
notify.ready();                       // 启动完成
const sec = Number(process.env.WATCHDOG_USEC ?? 0) / 1e6;
if (sec) setInterval(() => notify.watchdog(), (sec / 2) * 1000); // 周期的一半发一次
```

---

## 7. 日志规范（可直接抄）

原则：**结构化 JSON、统一字段、全部进 journald、异常走 error 级 + Telegram。**

### 7.1 Node 用 pino

```js
// service/lib/logger.mjs
import pino from 'pino';                    // npm i pino
export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { service: 'sodex-watch' },         // 每服务固定自己的名字
  timestamp: pino.stdTimeFunctions.isoTime, // ISO 时间
  formatters: { level: (label) => ({ level: label }) },
});

// 用法：第一参数放结构化字段，第二参数放人读的消息
logger.info({ event: 'watch_start', address }, 'watch started');
logger.warn({ event: 'ws_reconnect', attempt }, 'reconnecting');
logger.error({ event: 'order_failed', coin, size, err: e.message }, 'order failed');
```

输出到 stdout/stderr，systemd 自动收进 journald（无需自己写文件）。

### 7.2 Rust 用 tracing（字段对齐）

```rust
// Cargo: tracing, tracing-subscriber (json)
use tracing::{info, error};
tracing_subscriber::fmt().json().init();   // JSON 输出 → journald

info!(event = "mm_start", account = %addr, "market maker started");
error!(event = "order_failed", coin = %coin, err = %e, "order failed");
```

### 7.3 统一字段约定

| 字段 | 含义 | 必填 |
|------|------|------|
| `ts` | ISO 时间戳 | ✅（库自动） |
| `level` | info/warn/error/debug | ✅ |
| `service` | 服务名（sodex-watch / copy-trader …） | ✅ |
| `event` | 事件名，snake_case（`order_failed` / `ws_reconnect`） | ✅ |
| 业务字段 | coin / address / size / orderId / attempt 等 | 按需 |
| `err` | 异常时的错误信息 | 异常必填 |

### 7.4 查询与告警

```bash
journalctl -u sodex-watch -f                          # 实时跟随
journalctl -u sodex-watch -p err --since today        # 只看今天的错误
journalctl -u 'sodex-*' -o cat | jq 'select(.event=="order_failed")'  # 按事件过滤
```

异常告警两条路（互补）：
1. **进程崩溃** → systemd `OnFailure=tracker-alert@%n.service`（§6.3）。
2. **业务异常**（下单失败、漂移）→ 代码里 `logger.error(... event ...)` + 直接调现有 Telegram 通道推送。

---

## 8. 服务间通信（冷/暖/控制/热 四层）

按「急不急、量大不大」选机制，不要一种硬套全部。

| 路径 | 数据 | 频率 | 机制 |
|------|------|------|------|
| **冷** | discovery → 执行器：跟单目标名单 | 每周/手动 | **JSON 文件**（`targets.json`），执行器 inotify 监听变更热重载 |
| **暖** | 执行器 → Node：成交/异常/持仓状态 | 每笔/分钟级 | 全员 **JSON 日志 → journald**；规模大再上 Redis pub/sub |
| **控制** | 运维/Node → 执行器：健康检查、**强制平仓急停** | 偶发 | 执行器暴露 **127.0.0.1 小 HTTP 接口**（`/health` `/positions` `/flatten`） |
| **热** | live 行情（目标 fill、盘口） | 实时 | **不走服务间**——每个执行器**直连 HL WS** 自取 |

硬规则：
- **热路径绝不在自有服务间传**（叠加延迟 + 多故障点）。
- **不共享内存**（跨语言共享内存是坑），用上述进程间机制。
- **控制面用 HTTP 风格写**（哪怕现在是 `127.0.0.1`）：将来拆两台机只需改地址 + 加 TLS/token，逻辑不动（见 §11）。
- 现在**不上 Redis**：文件 + journald + localhost HTTP 已覆盖；有真实解耦需求再加。

急停优先级最高：**`/flatten`（一键平仓）先做**，做市出事能立刻人工止损。

---

## 9. 钱包与 nonce 隔离规则

Hyperliquid 的 nonce 必须**按地址严格单调递增**。若两个进程对**同一账户**并发签名，nonce 会撞车 → 订单被拒/乱序。

规则：
- **一个钱包只能由一个进程签名。**
- **copy-trader 与 mm-engine 使用不同的子账户/钱包**——各管各的 nonce 流，天然不冲突，同时隔离库存、风险与盈亏核算。
- 同一进程内若管多个账户，各账户独立 nonce 计数（SDK 内部已处理）。

---

## 10. 资源预算估算

| 服务 | 类型 | 内存基线 | 备注 |
|------|------|----------|------|
| sodex-watch | Node 常驻 | ~40-60M | WS 轻量 |
| HYPE-watch | Node 常驻 | ~40-60M | |
| copy-trader | Rust 常驻 | ~10-30M | |
| mm-engine | Rust 常驻 | ~10-30M | 高频下 CPU 占用上升，内存仍低 |
| notifier | Node 常驻 | ~30-40M | |
| **常驻合计** | | **~130-220M** | |
| discovery | Node 周期 | 峰值 200-400M | 每周一次，跑完即退，与常驻错峰 |

**结论**：当前一台普通 VPS（如 1-2GB）**充裕**运行全部四类服务（watch + discovery + 跟单 + 做市）。最紧的是 discovery 峰值那一刻，用 `MemoryMax=400M` 封顶 + 流式解析大榜单即可消除 OOM 隐患。

### 10.1 1GB / 1 核实测够用，但属「最低可用」

| 项 | 内存 |
|----|------|
| 系统底噪（Linux + systemd + journald + sshd） | ~150-250MB |
| 常驻服务（watch×2 + 跟单 + 做市 + notifier） | ~150-220MB |
| 平时合计 | ~300-470MB（剩 500-700MB 余量，宽松） |
| discovery 周期峰值（叠加常驻之上） | +200-400MB → 峰值 ~700-870MB（撞不破 1GB） |

1GB 跑全套够用，但两个边界要认清：① discovery 峰值时余量薄，再加服务就紧；② 单核上**温和做市行、激进高频做市撑不住**（抢 CPU 引入延迟抖动）。
小建议：1GB 加 1-2GB **swap** 作缓冲，但做市这种延迟敏感服务别让它落 swap（会抖）。

### 10.2 不同 VPS 配置 → 可承载业务对照表

判断逻辑：**内存**决定能跑几个服务 + discovery 峰值扛不扛得住；**CPU 核数**决定做市能多激进（做市是唯一 CPU 敏感的，监控/选人/跟单都 I/O 密集）。

| VPS 配置 | 平时舒服跑 | 可做业务 | 天花板/何时升级 |
|----------|-----------|---------|----------------|
| **512MB / 1核(共享)** | 1-2 个 watch + notifier | 纯监控 + 告警 | discovery 400MB 峰值塞不下；**不建议跑全套** |
| **1GB / 1核** | watch×2 + discovery + 跟单 + 温和做市 | 监控 + 选人 + 自动跟单 + 低频做市 | 最低可用；峰值紧、做市频率受单核限 |
| **2GB / 1-2核** ⭐ | 全套 + 更多监听地址 + 稳定做市 | 上面全部 + 多地址跟单 + 常规做市 | **性价比甜点，推荐起步档** |
| **4GB / 2核** | 多账户做市 + 几十个 watch + 两个 mm 引擎 | 多币种/多账户做市、规模化跟单 | 单核做市抖动消失；可作拆机前统一机 |
| **8GB+ / 4核** | 多对高频做市 + 全套分析 | 做市商级别、低延迟策略 | 此时考虑拆机/就近交易所而非堆单机 |

**选机建议**：
- 只做监控 + 选人 + 跟单（不做市或仅温和做市）→ **1GB 够，省钱**。
- 打算认真做现货做市 → 直接上 **2GB / 2核**，省得迁移；做市稳、余量足。
- **决定升级/拆机的多半不是内存，而是做市的 CPU**：做市压满核、或要做签名机安全隔离、或要就近交易所时才升核或拆第二台（拆法见 §11）。

---

## 11. 将来平滑拆成两台 VPS

**何时拆**（现在都不满足，不要提前拆）：
1. 单机内存/CPU 撞顶；
2. **安全隔离**：把持私钥、负责签名的执行服务单独放一台加固的最小机器；
3. **就近交易所**：做市机部署在离 HL 撮合最近的机房，分析服务放别处。

**怎么拆（跨机器通信）**：
- 两台放**同一云厂商、同一区域的内网（VPC）**，走**私有 IP** 通信（快、免费、不经公网）。
- 必做三件事：**TLS 加密** + **token/密钥鉴权** + **防火墙只放行彼此 IP**。
- 跨机器后：文件/localhost 都失效，冷数据改走「执行器拉取 Node 的 HTTP 接口」或共享 DB；控制面 HTTP 改成对方内网地址。

**为何平滑**：因为 §8 的控制面本来就用 HTTP 写——拆机时只把 `127.0.0.1` 改成 `10.0.0.x` 内网 IP，加上 TLS/token，**业务逻辑零改动**。这是现在用「网络风格通信」的回报。

---

## 12. 分阶段路线图 & 现在不做什么

**路线图**：
1. **现状**：全 Node（discovery + watch），单机 systemd。
2. **加跟单执行腿**：先 Node（复用 `@nktkas` 审计签名）或直接 Rust，**同机**新增 copy-trader，用文件吃 discovery 名单。
3. **做市真正上线**：新增 Rust mm-engine（独立子账户），先把 `/flatten` 急停做好。
4. **规模变大**：watch 扩到几十地址撞内存 → watch 层迁 Go；或把签名执行服务拆到第二台 VPS。

**现在明确不做**：
- ❌ 不上两台 VPS（一台够，徒增成本/延迟/复杂度）
- ❌ 不上 Redis（文件 + journald + localhost HTTP 已覆盖）
- ❌ 不重写 discovery/watch（能跑不动）
- ❌ 不用 Go / Python（无收益或双输）

---

## 附录：SDK 参考

| 语言 | SDK | 地址 | 状态 |
|------|-----|------|------|
| Node/TS | `@nktkas/hyperliquid` | github.com/nktkas/hyperliquid | **已通过安全审计**，跟单执行腿首选 |
| Rust | `infinitefield/hypersdk` | https://github.com/infinitefield/hypersdk | 做市/执行候选，**采用前须做与 @nktkas 同等的安全审计**（安装脚本/依赖/私钥处理/网络出口） |
| Rust | 官方 `hyperliquid-rust-sdk` | Hyperliquid 维护 | 备选，签名有官方保障 |

> 任何新 SDK 采用前的审计纪律：① 无 pre/postinstall 安装脚本；② 依赖极简无可疑包；③ 私钥不进 SDK（只收钱包/signer 对象）；④ 网络出口仅 HL 官方域名；⑤ 无 eval/spawn/远程加载。

---

*文档初版：2026-06-26。后续随架构演进增量更新。*
