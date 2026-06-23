# Spec 总纲 · Hyperliquid 监听 + 排行发现（service 多交易所重构）

> **本文件是本功能 spec-set 的单一事实源（SSOT）**。所有子 spec 的流程、状态机、共享契约、命名、依赖顺序都以本文件为准；子 spec 只引用、不重定义。
> 与子 spec 冲突时以本总纲为准。
> 本文件是**实现蓝图**（给执行用），允许写 `/k:task`、HARD GATE、阶段编排等工具链内容，不做"工具链痕迹"清理。

---

## 0. 执行前置（HARD GATE）

- [x] 接口实测完成（2026-06-22）：WS 10 频道全 ack、info 9 端点 200、leaderboard 32.7MB/8.2-22s、exchange 未签名报 `Unable to recover signer.`。
- [x] `ws` 包可用（实测 import OK）。
- [ ] HYPE WS 心跳格式（`{op:"ping"}` vs `{method:"ping"}`）在 Phase 1 连上时验证，不臆测。

---

## 1. 背景与目的

现有 `service/` 仅支持 Sodex perps（`watch/` 账号 WS 监听 + 每日镜像 + TG；`discovery/` leaderboard 跟单候选发现）。目标：把同样能力扩展到 **Hyperliquid（HYPE）**，并把 `service/` 重构成「按交易所对称」布局，顺带修 Sodex watch 每次部署给所有地址重推 START WATCH 的噪音。

**第一阶段只做监听与排行发现，不实现跟单交易执行**（交易需私钥签名，信任边界完全不同，单独立项）。

选定方案：**平行模块 + 先简后扩**——四个对称模块 `sodex-watch / sodex-discovery / HYPE-watch / HYPE-discovery`，共享 `tool/`（格式化）+ `lib/`（WARP）+ `app/`（systemd 编排）。当前仅 2 个 venue，**不抽多交易所适配层**（YAGNI，第 3 个 venue 再抽）。

---

## 2. 全局流程状态机（核心交互逻辑 · SSOT）

### 2.1 Banner kind（沿用 sodex-watch，HYPE 复刻）

```ts
type BannerKind = "START" | "OPEN" | "CLOSE" | "INCREASE" | "REDUCE" | "SNAPSHOT" | "CHANGE";
```
- 首帧 baseline → `START`；每日镜像 force → `SNAPSHOT`；否则由仓位 diff 动词化。
- **无持仓 + kind=SNAPSHOT → 跳过 TG**（沿用现有镜像不推规则）。

### 2.2 START WATCH 门控（Phase 4 新增 · 两 venue 共用）

```ts
type AddrStartGate = "new" | "known";
```
| gate | 进入条件 | 表现 | 迁移 |
|---|---|---|---|
| `new` | address ∉ `.seen-addresses.json` | 首帧 baseline 推 START WATCH TG + 并入文件 | → known |
| `known` | address ∈ 文件 | 只建内部 baseline，**不推 TG** | 终态（删文件可重置为 new） |

> console banner 照常打；单地址 CLI 模式（仅 sodex-watch 有）不受门控影响。

### 2.3 HYPE WS 驱动模型（区别于 Sodex 单一 accountState）

聚焦频道而非 webData2：
- `clearinghouseState`（仓位+保证金，主快照源）+ `openOrders`（离场单）→ 驱动指纹（size+方向+离场单集合，**不含 pnl/mark**，mark 跳动被 dedup）。
- `userFills`（成交，含 closedPnl）→ 平仓盈亏源（首帧 isSnapshot 只建 baseline）。
- `orderUpdates` → 变化触发。

---

## 3. 共享契约（子 spec 只引用，不重定义）

### 3.1 HYPE 内部归一模型（HYPE-watch/parse 输出，render 只认它）

HYPE `mark/roe` 直接给，无需反推（比 Sodex 省事）。
```ts
type Position = { coin:string; size:number /*signed,来自 szi*/; dir:"LONG"|"SHORT";
  entry:number /*entryPx*/; mark:number /*markPx*/; unrealizedPnl:number; roe:number /*returnOnEquity*/;
  leverage:{ mode:"cross"|"isolated"; value:number }; liqPrice:number|null /*liquidationPx*/;
  marginUsed:number; positionValue:number; szDecimals:number };
type ExitOrder = { coin:string; side:string; price:number; size:number; reduceOnly:true;
  kind:"TP"|"SL"; triggerPx:number; oid:number };
type CloseRecord = { coin:string; dir:string /*"Close Long"|"Close Short"*/;
  closedPnl:number; fee:number; size:number; price:number; time:number; oid:number };
// CloseRecord 由 userFills 中 dir 含 "Close" 的 fills 按 oid 分组聚合（closedPnl/fee/size 求和），无状态。
```

### 3.2 config schema（TG 凭据先留空占位，用户后填；空则 sendTelegram no-op）

```jsonc
// HYPE-watch/config.json
{ "tgToken": "", "watches": [ { "address":"0x...", "tgChat":"", "label":"巨鲸A", "at":"20:00" } ] }
// HYPE-discovery/config.json
{ "tgToken":"", "tgChat":"", "window":"month",
  "thresholds":{ "minPnlUsd":{"month":100000}, "minVlmUsd":{"month":5000000} },
  "topK":20, "excludeWatched":true }
```

### 3.3 tool seen-addresses 门控（Phase 4 新增，两 venue 共用）

| 函数 | 位置 | 规则 / 边界 |
|---|---|---|
| `loadSeenAddresses(path)` | `service/tool/` | 文件不存在 → 空集；解析失败 → 空集 + 告警 |
| `computeNewAddresses(configAddrs, seen)` | `service/tool/` | 返回 configAddrs − seen（小写归一比对） |
| `saveSeen(path, addrs)` | `service/tool/` | 并集落盘（gitignore） |

### 3.4 复用件清单（直接 import，禁止重造）

| 需要 | 复用 |
|---|---|
| 数字/USD/百分比/时间/地址格式化、HH:MM 校验 | `service/tool/format.mjs` |
| fetch/WS 走 WARP 代理 | `service/lib/WARP/index.mjs` |
| TG 推送 / 共享限流 | 抄 `sodex-watch/api/index.mjs` 的 sendTelegram / enterSharedRateLimit 逻辑（不跨 venue 共享代码） |

### 3.5 命名 / 端点 / 资源约定

- 端点：info `POST https://api.hyperliquid.xyz/info`；WS `wss://api.hyperliquid.xyz/ws`（订阅 `{"method":"subscribe","subscription":{...}}`）；leaderboard `GET https://stats-data.hyperliquid.xyz/Mainnet/leaderboard`。
- asset：用整数 index（meta universe 下标），需 `coin→szDecimals` 缓存 + 周期刷新（类似 `SYMBOLS_REFRESH_MS`）；仅 Mainnet。
- 数字全为字符串 → parse 统一 `Number()`，空串/null → 内部 null，render 显示 `-`。
- systemd 单元：`sodex-watch.service` / `sodex-discovery.{service,timer}` / `HYPE-watch.service` / `HYPE-discovery.{service,timer}`。

---

## 4. Phase0 脚手架（子单元开工前完成）

本 spec-set 的 Phase0 = **子件 01（Sodex 重命名）**——它确立目录布局与 app/setup 引用，是 02/03/04 的地基。无独立的代码脚手架（归一模型内属 02，seen-addresses 内属 05）。

1. 完成 01 重命名 + 涟漪同步，`node --test` 41/41 不退化。
2. 确认 `tool/format` + `lib/WARP` 可被新模块直接 import。

---

## 5. 集成点（带行号锚点）

- `service/app/index.mjs:82-114` — `watchUnit/discoveryServiceUnit/discoveryTimerUnit/buildUnits` 单元名 + ExecStart 路径改 sodex-*；Phase 3 增 HYPE 单元。
- `service/app/index.mjs:21` — `OLD_WATCH_UNIT` 迁移链追加 `watch.service`→`sodex-watch.service`。
- `service/app/index.mjs:26-63` — `DEFAULT_CONFIG`/`loadConfig` 的 `watch`/`discovery` 键改名 + Phase 3 增 HYPE 键。
- `setup/Makefile:13-14,38,41-50` — sync-config / status / logs / restart 路径与单元名。
- `setup/setup-systemd.sh:20-21` — config 路径注释。
- `.gitignore` — watch/discovery config 路径改名 + 新增 HYPE config/log + `sodex-watch/.seen-addresses.json`。
- `service/watch/process/watcher.mjs:221,238` — START WATCH 无条件推送根因（Phase 4 改）。
- `docs/{update-log,systemd-setup,deploy-commands,watch-account-plan,discover-traders-plan,query-account}.md` — 路径/单元名同步。

---

## 6. 验收标准（总览，细化见各子 spec）

- [ ] 四模块对称落地，`node --test` 全程不退化（基线 41/41）。
- [ ] HYPE-watch 多地址监听 + 镜像 + group-by-oid 平仓 + 无持仓不推 + TG 留空不报错。
- [ ] HYPE-discovery leaderboard 粗筛 + excludeWatched + 落盘 + dry-run。
- [ ] app/ systemd 四模块单元正确 + 旧单元迁移不双开。
- [ ] sodex-watch 部署仅对新增地址推 START WATCH。
- [ ] NFR：错峰调度（两 discovery timer 不重叠）；HYPE-discovery 流式解析压低 264MB 峰值。

## 7. 验收场景（Given/When/Then）

### 场景 1：重命名后部署链路一致（Phase 0）
- **Given** 完成 `watch/`→`sodex-watch/`、`discovery/`→`sodex-discovery/` 及涟漪同步
- **When** 执行 `node service/app/index.mjs render`
- **Then** 三单元名为 `sodex-watch.service`/`sodex-discovery.service`/`sodex-discovery.timer`，ExecStart 指向 `sodex-watch/main.mjs`、`sodex-discovery/main.mjs`，迁移动作含旧 `watch.service`；`node --test` 41/41

### 场景 2：HYPE-watch 监听无持仓地址跳过推送（Phase 1）
- **Given** 配置一个 `clearinghouseState.assetPositions` 为空的地址，TG 留空
- **When** 镜像快照 `fetchAndReport` 触发
- **Then** console 渲染"无持仓"，日志输出"无持仓，跳过 Telegram 推送"，不调用 sendTelegram、不报错

### 场景 3：START WATCH 仅对新增地址推送（Phase 4）
- **Given** `sodex-watch/.seen-addresses.json` 含 X、Y；config.watches=[X,Y,Z]
- **When** 重启 sodex-watch，三地址各收首帧 accountState
- **Then** 仅 Z 推 START WATCH TG；X、Y 只建 baseline 不推；文件更新为 [X,Y,Z]

---

## 8. 子 spec 依赖拓扑（落地流水线脚本）

> 落地：每阶段读总纲+子件 → `/k:task` → `/k:check` → `/k:commit` → gate 停 → 确认 → 下一阶段。每阶段末同步对应 docs + update-log。

```
0(rename) → 1(HYPE-watch) → 2(HYPE-discovery) ┐
                          → (本地测试通过) ───→ 3(app systemd) → 4(START WATCH 修复,最后)
```

| 阶段 | 子 spec 文件 | 类型 | 依赖 |
|---|---|---|---|
| 0 | `01-sodex-rename.md` | 逻辑（机械重构） | 无（地基） |
| 1 | `02-hype-watch.md` | 逻辑 | 01 |
| 2 | `03-hype-discovery.md` | 逻辑 | 02（读 HYPE-watch/config 做 excludeWatched） |
| 3 | `04-app-systemd.md` | 逻辑 | 01 + 02 + 03 本地测试通过 |
| 4 | `05-startwatch-fix.md` | 逻辑 | 01（sodex-watch）+ 02（HYPE-watch），最后做 |

---

> 📌 TODO / 未证实 / 待部署动作的集中清单见横切文档 `todo-unverified.md`（本节是边界 SSOT，那里是可执行待办视图）。

## 不包含（全局边界）

- 跟单交易执行（Exchange / EIP-712 签名）。
- HYPE-discovery 逐笔真账本深度评估（evaluate/score，第二步）。
- 平仓有状态回放 / 跨 oid 聚合；testnet；HYPE roi 污染实证（第二步）。
- HYPE-watch 单地址 CLI / 纯快照 SnapshotMode（仅多地址 `--config`）。

## 已知限制

- 重构非零回归：重命名波及生产部署链路（app/setup/docs），Phase 0/3 谨慎验证。
- leaderboard 非官方端点：无分页、32MB、可能限流/schema 变更 → 每次只拉一次、失败跳过本轮、字段缺失跳过该行。
- meta universe 必须先加载；HYPE 上新变 index 需周期刷新；加载失败精度回退默认不阻断。
