# Spec 02 · HYPE-watch（Phase 1）

> 引用总纲 `00-overview.md`。归一模型见总纲 §3.1，WS 驱动模型见 §2.3，命名/端点见 §3.5。冲突以总纲为准。
> 依赖：01（目录布局）。落地直接 `/k:task`。

## 背景与目的

新建 `service/HYPE-watch/`，对标 sodex-watch，实现 HYPE 账号 WS 实时监听 + 每日镜像 + TG 推送。**仅多地址 `--config`**，不做单地址 CLI / 纯快照 SnapshotMode。

## 选定方案

落点 `service/HYPE-watch/`：
```
main.mjs            仅 --config 分支（去单地址 positional + --snapshot）
config.json         总纲 §3.2 schema（TG 留空）
api/index.mjs       POST /info REST + TG + meta universe 缓存(coin→szDecimals,周期刷新) + 共享限流；砍 accountId 解析
process/
  watcher.mjs       抄 sodex watcher：WS 生命周期/ping/重连/防抖/指纹去重/scheduleDaily 镜像；换订阅格式 + 聚焦频道 + ping 格式；离场单变化提醒
  parse.mjs         HYPE 字段 → 总纲 §3.1 归一模型；CloseRecord 按 oid 聚合；diffExitOrders（PLACE/MODIFY/CANCEL）
  render.mjs        抄 sodex 卡片样式；精度用 szDecimals；解开 Sodex 符号缓存依赖；buildExitOrderBanner（离场提醒）
  config.mjs        loadConfig
```
**不含 `snapshot.mjs`**（每日镜像由 watcher.scheduleDaily 承担）。

## 设计概要

### 数据来源
总纲 §2.3 聚焦频道：`clearinghouseState`+`openOrders`（指纹）、`userFills`（平仓，首帧 isSnapshot 建 baseline）、`orderUpdates`（触发）。

### 场景与变体
| 维度 | 有持仓 | 无持仓 |
|---|---|---|
| 渲染 | 仓位卡片(coin/方向/杠杆/entry/mark/uPnl/roe)+离场挂单+平仓历史(oid 聚合) | "无持仓"快照 |
| 镜像 TG | 推送 | **跳过**（日志留痕） |

### 离场单变化提醒（独立 banner，前瞻信号）
来源 `frontendOpenOrders` 解析出的 `exitOrders`，watcher 存 `prevExitOrders`(oid Map) 每次 flush diff：
- **PLACE**：新 oid；**CANCEL**：oid 消失；**MODIFY**：同 oid 且 **price 变化**。
- **MODIFY 只认 price 变化**：HYPE `frontendOpenOrders.sz` 是剩余量，部分成交会让 sz 变小 → 不按 size 判改单，避免把部分成交误报为"调整"。
- **CANCEL/FILL 消歧**：消失的离场单若同窗口该 coin 有 `CLOSED/DECREASED` 事件（来自 `diffPositions`）→ 判为成交，**不报撤销**（与 sodex 同款）。
- 首帧 baseline 只建 `prevExitOrders`，不提醒。提醒在主报告之后独立 `🏹 离场挂单` banner 单发。
- 后续优化：解析 `orderUpdates` WS 频道 status 实时化（比快照 diff 更精确），本阶段先用 diff。

### 对标 sodex 抄写的机制参数（开工锚点，照搬现有值）
- 防抖：`debounceMs` 默认 3000 + `maxWaitMs` 默认 5000 封顶（对应 sodex `watcher.mjs:42-43,145-156`）。
- 指纹去重：fp = `canonicalPositionsFp(positions) + "|" + canonical(openOrders)`，**不含 pnl/mark**（mark 跳动被 dedup），对应 sodex `watcher.mjs:137,192-195`。
- 共享限流：HYPE-watch **独立 per-venue 限流**（不与 sodex-watch 跨进程共享，本就是独立进程）；backoff 退避抄 sodex `api/index.mjs` 的 enterSharedRateLimit/resetSharedBackoff。
- SIGINT：`main.mjs` 复用 `process.on("SIGINT", ...)` 关闭全部 watcher（对应 sodex `watch/main.mjs:62`）。
- meta universe 刷新间隔：与 sodex `SYMBOLS_REFRESH_MS`（6h）一致。
- WS 重连：ping/pong 超时 + 指数退避重连，抄 sodex watcher。

## i18n 文案

无（service 端 console/TG 中文文案直接写，无 locale 体系）。

## 边界与约束

- 包含：多地址 WS 监听 + 镜像 + group-by-oid 平仓 + 无持仓不推 + meta 缓存。
- 不包含：单地址 CLI / SnapshotMode / testnet（总纲全局边界）。
- HYPE WS ping 格式连上时验证（总纲 §0）。

## 集成点

- 复用 `service/tool/format.mjs`、`service/lib/WARP/index.mjs`（总纲 §3.4）。
- 参照抄写 `sodex-watch/{process,api}`（不共享代码）。
- 读自身 `HYPE-watch/config.json`。

## 验收标准

- [ ] `node service/HYPE-watch/main.mjs --config=service/HYPE-watch/config.json`（仅此模式）渲染各地址仓位 + 离场挂单 + 平仓历史（oid 聚合，一次平仓一行）。
- [ ] 无持仓地址输出"跳过 Telegram 推送"且不推；TG 留空不报错。
- [ ] 多地址启动 N 个 watcher，断线自动重连，指纹去重生效（mark 跳动不重复推）。
- [ ] meta universe 加载成功（coin→szDecimals）；加载失败精度回退默认不阻断。
- [ ] 离场单 PLACE/CANCEL 触发独立 `🏹 离场挂单` banner；同 oid 仅 price 变报 MODIFY、仅 size 变不报；离场单成交（同窗口仓位减/平）不误报撤销；首帧不提醒。

## 验收场景（Given/When/Then）

### 场景 1：监听有持仓地址（Happy Path）
- **Given** config 含持 HYPE 多单地址（szi=+200、entryPx=60.46、cross 3x），TG 留空
- **When** `node service/HYPE-watch/main.mjs --config=...`
- **Then** console 输出该地址仓位卡片（HYPE 3x LONG、持仓量 200、含 roe%）+ 离场挂单（若有）；TG 留空不发起 telegram 请求、不报错

### 场景 2：一次平仓多 fill 聚合一行
- **Given** 某地址一次市价平仓产生 3 笔同 oid 的 Close fill（closedPnl 分别 3.2/1.9/5.1）
- **When** 渲染平仓历史
- **Then** 该平仓显示为**一行**，closedPnl 合计 +10.2（按 oid 聚合，非三行）

### 场景 3：无持仓镜像跳过推送
- **Given** 地址 `assetPositions` 为空，每日镜像触发
- **When** fetchAndReport 执行
- **Then** console 渲染"无持仓"，日志"跳过 Telegram 推送"，不调 sendTelegram

### 场景 4：离场单撤销 vs 成交消歧
- **Given** 某 coin 持仓 + 一个 reduceOnly TP 单（oid=5）已在 prevExitOrders；本次该 TP 单消失
- **When** 同窗口 `diffPositions` 含该 coin 的 `CLOSED/DECREASED` 事件
- **Then** 判为成交，**不发** "撤销" 离场提醒（仓位变化已由主报告表达）；若仓位无变化则发 `🏹 撤销` 提醒
