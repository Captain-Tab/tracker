# 更新日志（tracker）

`service/`（perps 账户监听 watch + 跟单候选发现 discovery + 编排 app + 基建 lib + 共享 tool）的版本变更记录。最新在上。

---

## 2026-07-14 — fix(watch): 修复 WS 重连后真 OPEN 被吞 + 持久化格式错位（两端）

**背景**：commit `d4c03e8` 引入 `baselineLogged = false`（onclose 重置）以消除 WS 重连后持久化格式错位导致的假 OPEN。但 `kind = isBaseline ? "START" : classifyBanner(...)` 把真 OPEN 也吞了——1256 地址在 WS 断连期间开仓 XAUt，重连后首帧被标为 START WATCH，TG 静默不推，用户只看到后续的 INCREASE。

根因有两层：(1) `parseWsPosition`（sodex）不产出 `coin`/`dir`，`saveLastPositions` 写 `coin`/`dir` → 持久化为 `coin:"undefined"` → 加载后 `diffPositions` key 坍缩为 `"undefined:LONG"` → 与 WS 新帧 `"XAUt:LONG"` 永远不匹配 → 重连必产假 OPEN；(2) `baselineLogged` 一刀切覆盖，不分真假。

**改动**：

- `service/sodex-watch/process/parse.mjs` — `parseWsPosition` 加 `coin`/`dir` 别名（`baseCoin(s)` / `positionDirection({posSide, size})`），供持久化写入
- `service/tool/lastPositionsStore.mjs` — `loadLastPositions` 返回 `{symbol, posSide, coin, dir, size}`（两端 `diffPositions` 各自取需）。兼容旧格式（`symbol`/`posSide` → 反推 `coin`/`dir`）。过渡期 `coin:"undefined"` 条目过滤（等效首次启动，1 周期后新格式写回自愈）
- `service/sodex-watch/process/watcher.mjs` — 删除 `baselineLogged`，新增 `hasEverReported`（只升不降，构造函数 `false`，`fetchAndReport` 末尾设 `true`，`onclose` 不重置）。`isBaseline` → `hasNoBaseline = !hasEverReported`。首次启动仍静默建基线；WS 重连后 `hasEverReported` 保持 `true` → `classifyBanner` 正常 → 真 OPEN 不被吞；全平后重开同理
- `service/HYPE-watch/process/watcher.mjs` — 同构 + Layer 2 覆盖修复（`this.lastPositions = persisted` 之后补 `this.lastPositions = this.positions`，防止重启首周期写回旧数据）

**影响**：(1) 持久化格式永久修复：`diffPositions` key 正确，重连不产假 OPEN；(2) `baselineLogged` 删除：真 OPEN 不再被吞，无论 WS 重连、服务重启、全平后重开；(3) 过渡期一次自愈：旧文件 `coin:"undefined"` 被过滤 → 等效首次启动 → 1 周期后正确数据写回。HYPE 端不受格式错位影响（原生产出 `coin`/`dir`），仅受益于 `baselineLogged` 删除。验证：全量 86/86 单测绿 + 6+5 diffPositions 场景穷举通过 + 冒烟 4/4（读写往返/过滤/混合/兼容）。

---

## 2026-07-12 — feat(sodex-discovery): 新增 ⑦ shadow 影子跟踪（闭环反馈阶段1）

**背景**：sodex-discovery 与 HYPE 同构，同样开环——每周独立预测却从不复盘上一批准不准。继 HYPE ⑦ shadow 后，sodex 侧同款落地，台账 schema 统一（阶段2 calibrate 跨平台复用）。设计见 `docs/discovery/feedback-loop.md`。

**改动**（`service/sodex-discovery/`）：

- `process/shadow.mjs`（新增）— ⑦ 阶段：维护 `log/ledger.json` 预测台账。(A) 写预测（recommended 标 discovery / observing🟢 标 observing）+ (A') 写对照（`scored.slice(ranked.length, ranked.length+N)` 标 control）+ (B) 回填（未成熟且满 2 周行重拉 `fetchPositions(accountId, ctx.positionsLimit)`→`filter(size===0 && updated_at>recommendedAt)`→`Σrealized_pnl`，写 2w/4w 桶，满 4 周 matured 冻结）；复用 `api.fetchPositions` + `observing.__internals.isoWeekId`；自带 ledger JSON 读写（读失败容错 `{}`）；maxDrawdown 按 `updated_at` 升序累计取负
- **sodex 口径差异**（区别于 HYPE 的 `userFills`+`aggregateTrades`）：positions 本身即逐笔已平仓真账本，无需聚合；**台账行双键 `address`(walletAddress 小写) + `accountId`**（回填调 `fetchPositions` 用 accountId）；三腿建行统一 `mkRow` 工厂读 `walletAddress`（非 `.address`），observing🟢 腿回查 scored 补 recoveryFactor+accountId
- `process/observing.mjs` — 仅加返回值：两个 return（dry-run + 正常）各加 `promotedAddresses`（=`promoted.map(p=>p.address)`），逻辑不变
- `main.mjs` — ⑥ 后 try/catch 调 `shadow(scored, ranked, obsRes?.promotedAddresses ?? [], ctx)`，ctx 注入 `positionsLimit: config.positionsLimit`，异常仅 console.error 不中断 ①-⑥

**影响**：sodex discovery 由六阶段变七阶段，每周随 discovery（周一）自动记账。ledger.json 落 `log/` 目录（已 gitignore，VPS 本地）。**影子只能证伪不能证真**（账户赚≠跟得上），定位排除坏的。实测：确定性多周模拟（去重/对照采样/双键落账/observing🟢回查补全/逐周回填/满4周冻结/休眠+销户容错/dry-run 全通过）+ 真实数据回填探针（2 个真实推荐账户，`fetchPositions`→`filter`→`Σrealized_pnl` 链路端到端贯通）。HYPE 侧同款已落地（commit 3a63b11）。

---

## 2026-07-12 — feat(HYPE-discovery): 新增 ⑦ shadow 影子跟踪（闭环反馈阶段1）

**背景**：HYPE discovery+observing 是**开环**——每周独立预测候选，却从不复盘上一批预测准不准。缺的不是数据量，是「给预测贴事后结果标签并回读」。本次加旁路数据层让系统从下周起记账，攒够带标签数据后（阶段2）才能校准。设计见 `docs/discovery/feedback-loop.md`。

**改动**（`service/HYPE-discovery/`）：

- `process/shadow.mjs`（新增）— ⑦ 阶段：维护 `log/ledger.json` 预测台账。(A) 写预测（recommended 标 discovery / observing🟢 标 observing，后者回查 `scored` 补全 recoveryFactor）+ (A') 写对照（`scored.slice(ranked.length, ranked.length+N)` 标 control，N=recommended 数，破幸存者偏差）+ (B) 回填（未成熟且满 2 周行重拉 `fetchUserFills`→过滤推荐后 fills→`aggregateTrades` 聚合→写 pnlSince/tradesSince/maxDrawdownSince 到 2w/4w 桶，满 4 周 matured 冻结停跟）；复用 `evaluate.aggregateTrades` + `api.fetchUserFills` + `observing.__internals.isoWeekId`；自带 ledger JSON 读写（读失败容错 `{}`）；maxDrawdown 落账取负值；休眠(0笔)/销户(fetch 抛错) 均容错记 0 不误判负样本；纯采集不推 TG、不落 md；dry-run 不写台账
- `process/observing.mjs` — 仅加返回值：两个 return（dry-run + 正常）各加 `promotedAddresses`（=`promoted.map(p=>p.address)`），逻辑不变
- `main.mjs` — ⑥ 后 try/catch 调 `shadow(scored, ranked, obsRes?.promotedAddresses ?? [], ctx)`，异常仅 console.error 不中断 ①-⑥

**影响**：HYPE discovery 由六阶段变七阶段，每周随 discovery 自动记账（网络增量 ~80-100 次 userFills，与 evaluate 同量级）。**触发**：`HYPE-discovery.timer`（`app/index.mjs` 生成 `OnCalendar=Mon *-*-* 10:00:00 Asia/Shanghai`）每周一 10:00 跑 `main.mjs`（无 `--dry-run`），①-⑥ 后执行 ⑦。**日志**：数据台账 `log/ledger.json`（load-modify-save，已 gitignore，VPS 本地）；运行日志一行 `⑦ 影子跟踪：记账X·回填Y·成熟Z` 进 systemd journal，`journalctl -u HYPE-discovery.service` 可查。首轮 ledger 不存在时 `loadLedger` 容错建空，仅预测侧落账（回填=成熟=0，符合头 4 周只采集）。台账 schema 即阶段2 calibrate 接口契约（见 feedback-loop.md 附录A.6）。**影子只能证伪不能证真**（账户赚≠跟得上，滑点/跟单率看不见），定位是排除坏的。实测：确定性多周模拟（去重/对照采样/逐周回填/满4周冻结/休眠+销户容错/dry-run 全通过）+ 真实数据回填探针（2 个真实推荐地址，链路端到端贯通，含 2000 fill cap 触顶案例）。sodex 侧同款另案。

---

## 2026-07-11 — feat(sodex-discovery): 新增 ⑥ observing 观察态中间层

**背景**：HYPE 侧已落地 observing 观察态（discovery→watch 之间「先观察两周再推荐」的稀缺资源守门）。sodex 是同构管线，本次同款复制，处理 sodex 特有口径差异（accountId+positions 逐笔真账本、symbol_id 币名解析）。

**改动**（`service/sodex-discovery/`）：

- `process/observing.mjs`（新增）— ⑥ 阶段：维护 `sodex-watch/watch-observing.json`，本周 `scored`（∉watch ∉parked）连续 2 周达标 → 🟢 结算推荐升 watch，断 streak → 🔴 移出（绝不 park；已进排除集者静默清出），新入 → 🟡；按 **walletAddress 归一 + 存 accountId**（🔴 按 accountId 反查 evalElim 精确原因）；自带 JSON 读写（schema `{since,weeksSeen[],recommended,lastScore,accountId,reason}`）；近期精彩用 topTrades 经 `refreshSymbols` 解析币名；观察态 TG（B 版 🟢→🔴→🟡，三段全空静默）；落盘 `log/observing/`；dry-run 打印 stdout；异常 try/catch 不中断 ①-⑤
- `process/score.mjs` — 返回 `Array` → `{ranked, scored}`（scored 供 ⑥）
- `process/evaluate.mjs` — 从在手 positions 抽 top-2 盈利平仓挂 `profile.topTrades`（metrics.mjs 零改）
- `process/output.mjs` — 导出 `sendTelegram`；`serializeProfile` 剔 `topTrades`；写盘 `log/` → `log/discovery/`
- `main.mjs` — ⑤ 后调 `observing(scored, evalElim, {...ctx, excludeSet})`；候选路径 `watch-candidates.json` → `watch-parked.json`
- `service/tool/watchCandidates.mjs` — 修 date bug（`:17` 去 `if(entry.date)` 硬要求，date 可选）：sodex 两条人工记录（缺 date）此前根本没进 excludeSet，修后生效；HYPE 无影响（条目均有 date）；`watchCandidates.test.mjs` 回归 10/10
- 文件：`sodex-watch/watch-candidates.json` → `watch-parked.json`（「无需关注」留），新建 `watch-observing.json`（「待观察」迁入种子）；`log/` 分 `discovery/`+`observing/`；`.gitignore` 同步

**影响**：sodex discovery 由五阶段变六阶段，无人值守每周（周一 9 点）自动维护观察态并推 🟢 升 watch 推荐。excludeSet 逻辑不变（watches∪parked，observing 不排除以持续观察）。实测：确定性 6 场景 + 真实 3 周日志回放（收集到 1 个跨周持续候选 acct 7239）+ 近期精彩币名解析全部通过。设计见 `docs/discovery/sodex.md §3.3`。

---

## 2026-07-11 — feat(HYPE-discovery): 新增 ⑥ observing 观察态中间层

**背景**：HYPE discovery 每周产出一批过硬门槛地址，但 watch（实时监听）是稀缺资源（每地址一条 WS 长连，VPS 舒适 5-10）。单周上榜可能昙花，直接纳入 watch 有资源与质量风险。缺一个「先观察两周确认持续性、再推荐升 watch」的中间态。

**改动**（`service/HYPE-discovery/`）：

- `process/observing.mjs`（新增）— ⑥ 阶段：维护 `HYPE-watch/watch-observing.json`，本周 `scored`（∉watch ∉parked）连续 2 周达标 → 🟢 结算推荐升 watch，断 streak → 🔴 移出（绝不自动 park；已被人工移入 watch/parked 者静默清出不误报 🔴），新入 → 🟡 观察第 1 周；自带 JSON 读写（条目 `{since,weeksSeen[],recommended,lastScore,reason}`，ISO 周去重）；观察态 TG（B 版 🟢→🔴→🟡，🟢 含 ≤2 近期精彩、🔴 含精确淘汰原因，三段全空静默）；落盘 `log/observing/observing-*.{json,md}`；异常 try/catch 不中断 ①-⑤；dry-run 打印消息到 stdout
- `process/score.mjs` — 额外返回全量 `scored`（pre-topK 带分）供 ⑥
- `process/evaluate.mjs` — `aggregateTrades` trade 加 `coin`，`deriveTradeMetrics` 返回 `trades`（供「近期精彩」）
- `process/output.mjs` — 导出 `sendTelegram` 供 ⑥ 复用；json 序列化剔除 `trades` 防膨胀；写盘路径 `log/` → `log/discovery/`
- `main.mjs` — ⑤ 后调 `observing(scored, evalEliminated, {...ctx, excludeSet})`；排除集文件 `watch-candidates.json` → `watch-parked.json`
- 文件：`HYPE-watch/watch-candidates.json` → `watch-parked.json`（纯 parked 语义）；新建 `watch-observing.json`；`log/` 分 `discovery/`+`observing/` 子目录；`.gitignore` 同步

**影响**：discovery 由五阶段变六阶段，无人值守每周自动维护观察态并推 🟢 升 watch 推荐；人工只需看 TG 决定是否搬入 watch。excludeSet 逻辑不变（仍 watches∪parked，observing 不排除以持续观察）。仅 HYPE；sodex 同款复制另案。设计见 `docs/discovery/hype.md §3.3`。

---

## 2026-07-11 — fix(watch): TG 推送加响应检查 + await + 本地消息日志

**背景**：7/6 HYPE-watch 检测到 0x610b 开仓 + 加仓事件，console 正常输出，但 TG 未收到消息。排查发现 `sendTelegram` 存在两个静默失败点：fetch 返回值被丢弃（TG API `ok:false` 被忽略）、调用方 fire-and-forget（Promise 悬空）。

**修复**（`service/{HYPE,sodex}-watch/`）：

- `api/index.mjs` — `sendTelegram` 读 `res.json()` 并检查 `body.ok`，失败时 log TG 错误码和描述；新增本地消息日志写入 `log/tg-${date}.jsonl`（message_id + ok + 文本预览），写入失败不影响主流程
- `process/watcher.mjs` — 全景消息 `sendTelegram` 加 `await`；事件驱动多条改为 `await Promise.all(messages.map(...))` 并发发送，确保 Promise 完成才继续

**影响**：此后 TG 推送失败可在 `journalctl` 看到具体错误码，`log/tg-*.jsonl` 提供审计轨迹。不解决 TG 拒绝消息的根因（需等下次复现从日志获取 error_code）。

---

## 2026-07-09 — fix(sodex-watch): 修复 banner 分类错误与离场单 "无持仓" 文案

**背景**：REST 兜底（Layer 2）使用 `/accounts/{address}/state` 仅返活跃仓位，覆盖 `lastPositions` 后导致 `diffPositions` 漏报 CLOSED 事件。连锁引发：cancel 离场单过滤失效 → "无持仓" 误报；`classifyBanner` OPENED 优先 → console/TG 结论矛盾。

**修复**（`service/sodex-watch/process/`）：
- `watcher.mjs:405` — `computeExitChanges` 签名加 `records, newPosIds`，`reducedCoins` 从 events + newPosIds 双源提取，REST 漏报时由平仓历史反查补全
- `render.mjs:107` — `classifyBanner` 加 OPENED+CLOSED 同时 → CHANGE 分支
- `render.mjs:216` — `buildExitOrderMessage` 无活跃仓位文案 "无持仓" → "仓位已平仓"
- `const/bannerLabels.mjs` — 新增 `CHANGE` label
- `sodex-watch/test/domain.test.mjs:212` — 更新 `classifyBanner` 测试断言

---

## 2026-07-09
- **fix(sodex-watch)**: REST 兜底 `restCurr` 复用 `parseWsPosition` 产出 WS 兼容格式，消除误报 OPEN 事件
  - `watcher.mjs:275-280` — 内联映射 `{coin, dir, Math.abs(size)}` 替换为 `parseWsPosition(p)`
  - 根因：内联映射缺少 `symbol`/`posSide` 字段，导致 `diffPositions` 中 `baseCoin(undefined)` = `"undefined"` + `positionDirection(Math.abs(size))` 永远返回 `"LONG"`，所有仓位 key 坍缩为 `"undefined:LONG"`。WS 重连后 REST 兜底污染 `lastPositions`，`stateFp` 指纹锁死阻止自我修复，下次仓位变化时触发误报 🟢 OPEN
  - 验证：VPS 真实 REST 数据 `{s, ps, sz, ep}` 字段命中 `parseWsPosition` 别名回退（`p.s ?? p.symbol` / `p.ps ?? p.positionSide`），输出完整 WS 兼容格式
  - 已知遗留：`saveLastPositions` 正常路径写盘 `coin:"undefined"`（WS 格式无 `coin`/`dir` 字段）— 另案处理

---

## 2026-07-08
- **fix(sodex-watch)**: CLOSE 摘要币名统一从 `histRecords` + `symbolMeta` 取，消除 `undefined`
  - `watcher.mjs` — `closedSummaries` 构造从 events 字符串 split 改为 `histRecords` 遍历 + `symbolMeta(r.symbolId).baseCoin`
  - 根因：旧主线从 `events` 字符串解析 coin（依赖 `diffPositions` → `lastPositions` → `baseCoin(p.symbol)`），旧备线依赖 `prevPositions.map(p => p.coin)`（WS 格式无 `coin` 字段），两条线都因持久化/REST 兜底格式缺字段而失效
  - 新方案：只用 `histRecords`（REST API）+ `symbolMeta`（符号缓存），与平仓历史渲染完全同源

---

## 2026-07-07
- **fix(sodex-watch)**: `dailySnapshot` 添加符号缓存垫片，防止缓存空时平仓历史显示 #xx
  - `api/index.mjs` — 新增 `ensureSymbolsLoaded(env)`，`symbolsById` 为空时补刷
  - `dailySnapshot.mjs` — 构建 TG 前调用 `ensureSymbolsLoaded`
  - 根因：平仓历史渲染(`renderPositionHistory`)通过数字 `symbolId` 查 `symbolMeta()`，缓存未命中无法推导币名（仓位渲染通过 `symbolMetaBySymbol` 有 `baseCoin()` 回退，但数字 ID 无法提取币名）
  - 触发条件：独立调用 `dailySnapshot` 或进程启动时 `refreshSymbols` 失败

---

## HYPE-watch 每日镜像独立化 + sodex-watch 每日镜像独立化 + WS 稳定性优化 — 2026-07-07

sodex-watch / HYPE-watch 每日镜像均通过 `scheduleDaily → scheduleFetch → fetchAndReport` 路径与 WS 事件耦合。WS 断连导致 `baselineLogged=false` 时镜像被劫持为 START WATCH，TG 不推送。两个服务分别抽离独立的 `dailySnapshot.mjs` 模块。

### 变更

- **`service/HYPE-watch/process/dailySnapshot.mjs`（新建）**：独立 REST 快照模块，`fetchClearinghouseState`(native+xyz) + `fetchUserFills` 拿仓位和平仓历史，复用 `parsePositions`/`parseCloseRecords`/`buildTgMessage`。
- **`service/HYPE-watch/process/watcher.mjs`**：`scheduleDaily` 改为调用 `dailySnapshot(ctx)`；移除 `forceReport`/`tgReason` 字段；`kind` 简化为 `isBaseline ? "START" : classifyBanner(...)`；`isOverview` 简化为 `isBaseline`。
- **`service/sodex-watch/process/dailySnapshot.mjs`**：position 映射补全 `symbol/unrealizedPnl/leverage/liqPrice/marginMode/coin/dir` 字段，对齐 WS `parseWsPosition` 格式；新增 `reportSkipReason` 空仓跳过逻辑。
- **`service/sodex-watch/process/watcher.mjs`**：`scheduleDaily` 改为调用 `dailySnapshot(ctx)`；移除 `forceReport`/`tgReason` 字段及相关引用；简化 `kind`/`isOverview`、G5/G6 补拉 guard。
- **`service/sodex-watch/api/index.mjs`**：新增 `fetchAccountState`（`/api/v1/perps/accounts/<address>/state`），替换平仓历史接口作为 REST 兜底数据源。

### Bug 修复

- **`service/HYPE-watch/process/watcher.mjs:134`**、**`service/sodex-watch/process/watcher.mjs:122`**：`onclose` 重置 `baselineLogged = false`。WS 断连重连后触发 Layer 2 REST 交叉验证，消除碎片化假 OPEN 事件。
- **`service/sodex-watch/process/watcher.mjs:269`**：REST 兜底条件拆分——REST 返回空时不再覆盖 WS 仓位（原接口为平仓历史，正常不返回当前持仓），仅用持久化做 diff 基线。
- **`service/sodex-watch/process/watcher.mjs:115`**：`onopen` 重连计数器改为 30s 稳定后才清零，避免 sodex 服务器「连上即踢」的退避重置循环。
- **`service/sodex-watch/process/watcher.mjs`**：移除 `parseRestPositions` 死导入。

### 验证

- VPS 强制触发 `dailySnapshot` 成功，sodex-watch 5 地址 / HYPE-watch 6 地址 TG 均收到 SNAPSHOT
- `fetchAccountState` 端点返回真实当前持仓（非平仓历史）
- HYPE `parsePositions`/`parseCloseRecords` 复用正确，native+xyz 仓位合并无遗漏
- 强平价 Cross 模式为 null（API 行为），显示 `-`；Isolated 有值正常
- 服务部署后无 ERROR，sodex-watch 5 地址 / HYPE-watch 6 地址正常运行

---

## HYPE-watch xyz index perps 仓位支持 + 配置整理 — 2026-07-06

HYPE-watch 的 `clearinghouseState` / `frontendOpenOrders` 未传 `dex` 参数，导致 xyz index perps 仓位完全不可见（Hyperliquid 的 HIP-3 perps 使用独立清算系统）。同时整理了 watch config 中不活跃地址。

### 变更

- **`service/HYPE-watch/api/index.mjs`**：`fetchClearinghouseState` / `fetchFrontendOpenOrders` 新增可选 `dex` 参数；`refreshMeta` 支持 `dex` 并用 `Map.set` 逐条合并，避免不同 dex 互相覆盖。
- **`service/HYPE-watch/main.mjs`**：启动时同时刷新 native + xyz meta 缓存，周期刷新覆盖两个 dex。
- **`service/HYPE-watch/process/watcher.mjs`**：仓位/订单按 dex 分储（`nativePositions` / `xyzPositions`），通过 getter 合并保持下游兼容；WS 订阅 native 4 频道 + xyz 3 频道；`handleMessage` 按 `msg.data.dex` 分发；REST 拉取及基线交叉验证并行查两个 dex。
- **`service/HYPE-watch/config.json`**：移出 ③多币种活跃 / ⑤净额69万 / ①BTC+ETH → candidate；新增 ada赚+btc做空赚 / 胜率高 / 多仓高手。
- **`service/HYPE-watch/watch-candidates.json`**：更新/新增 8 条候选项，含不活跃、仓位多、待观察等分类原因。
- **`service/sodex-watch/watch-candidates.json`**：新增 `0xcca2...` 待观察。

### Bug 修复

- **`service/HYPE-watch/process/watcher.mjs:398-399`**：`prevCoins.includes()` → `prevCoins.has()`（Set 不支持 `includes`，运行时会抛 TypeError，VPS 日志已捕获）。
- **`service/sodex-watch/process/watcher.mjs:381-382`**：同步修复相同 bug。

### 验证

- API 测试：不加 `dex`→0 仓位；加 `dex:"xyz"`→11 个 xyz 空单，与 hyperx.trade 一致
- WS 测试：native + xyz 双频道独立推送，`msg.data.dex` 可靠区分来源
- `userFills` 验证：不需要 `dex`，始终返回所有 dex 的成交
- VPS 日志对 2566 地址始终显示「无持仓」→ 根因确认为 `dex` 参数缺失，非仓位不存在
- **`service/HYPE-copy/api/index.mjs`**：`fetchHypePrices` / `buildHypeAssetIndex` 同步支持 xyz——并行查 native + xyz 的 `allMids` / `meta` 并合并结果，避免 xyz 币种在下单时因缺元数据被跳过。

---

## HYPE-copy dry-run 部署 + provision CLI 改进 + 快捷部署脚本 — 2026-07-04

Part A（v3 dry-run）首次 VPS 部署与联网观察，搭配 provision 脚本交互改进。

### 变更

- **`provision/hype-copy-approve-agent.mjs`**：stdout flush 修复提示行缓冲不显示；兼容 Ethereum 64 字符纯 hex 私钥自动补 `0x`；`const`→`let`；格式错误时打印输入长度/前缀便于定位。
- **`setup/deploy-copy.sh`（新建）**：一键推代码 + 重启 + 验证的快捷脚本（sync/restart/status/logs/log-jsonl），补 `make sync` 排除 `config.json` 导致 watch config 遗漏的坑。
- **`docs/copy/dry-run-report-2026-07-04.md`（新建）**：首次部署观察报告（baseline / 黑名单 / HL universe / top-N alert 全部跑通；ETH 因模拟预算不足未触发 would-place）。

### 边界

- 部署时发现 sodex-watch config 未含 target 地址（`make sync` 设计排除 `config.json`），手动推送后修复。
- MSTR/XAUT 正确 skip-unmappable；ETH alert（资金仅够跟 0 个币）因 `availBalanceSim=500` 太小。
- 基线逻辑验证通过：部署前存量仓不跟，重启盘恢复 baseline 不重复接盘。

### 验证

- 四服务全绿；71 次 reconcile 无崩溃；baseline / unmappable / alert 三类输出均与预期一致。

---

## HYPE-copy Agent Wallet 授权 CLI + 到期检查 timer（Part B 前置）— 2026-07-04

切实盘 Part B 的密钥/凭据基建：本地授权 agent wallet 的 CLI + server 端 agent 到期主动提醒。**不动真钱、不签单**；真正授权待 B-3 前夕再本地跑。设计见 `docs/copy/agent-wallet.md`，spec `.claude/kit/spec/2026-07-04-agent-expiry-notify.md`。

### 背景

执行器不裸持主钱包私钥，用 Hyperliquid Agent Wallet：主钱包本地签一次 `approveAgent(agentAddress)` 授权一个"只能交易不能提现"的独立 agent 私钥，服务器只存 agent key。agent 带 `valid_until` 过期，过期会导致签不了单、仓位失管，需主动提醒续签。

### 变更

- **`provision/hype-copy-approve-agent.mjs`（新建，repo 根，部署树外）**：agent wallet 授权/续签 CLI。纯函数 `approveAgentForCopy`（只吃 agentAddress，不碰 agent 私钥）+ `resolveAgent`（三模式：A 已有私钥派生 / B 只给地址 / C 生成）+ `formatAgentName`（valid_until 后缀，默认 180 天）；CLI 主私钥 stdin 隐藏输入、仅内存、二次确认；`--renew` 续签（禁生成）。放 `service/` 外 → 永不随部署上服务器（主私钥工具只在本地）。单测 8/8。
- **`service/HYPE-copy/expiry-check.mjs`（新建，server 端）**：agent 到期主动检查。纯函数 `evaluateExpiry`（据 extraAgents 判 not-found/expired/expiring/ok）+ `buildExpiryMessage` + 薄 IO（查 `info.extraAgents(masterAddress)` → 按 agentName 前缀 `hype-copy` 匹配 → 临期/过期/撤销 TG 告警）。**B1 纯查询**：零存储、validUntil 实时查、临期每天催、续签自停；dry-run 无 masterAddress → 静默跳过。单测 8/8。
- **`service/app/index.mjs`**：新增 `HYPE-copy-expiry.{service,timer}`（oneshot + 每日 09:00 Asia/Shanghai + `Persistent=true`，随 `hypeCopy.enabled` 启用；OnFailure 告警）。
- **`setup/setup-copy.sh`**：完成提示补 expiry timer（app apply 自动建单元）。
- **`.gitignore`**：合并 provision 密钥兜底（`*.key`/`*.pem`）+ copy 运行期 `service/HYPE-copy/state/`；删冗余 `provision/.gitignore`。
- **文档**：`docs/copy/agent-wallet.md`（新建，十章 + 流程图：概念/原理/三模式/授权流程/安全/续签/到期通知 B1/撤销）；spec 09 §5 指向之。

### 边界

- **不动真钱、不签单**：provision CLI 本地手动跑、真正授权待 B-3 前夕；expiry-check 只读无密钥。
- **反应式到期处理**（执行器签名失败 → 安全态）留 Part B（耦合 B-3 真实签名）。
- 不自动续签（需主私钥在服务器，违背红线）；到期由 timer 提醒、人工本地 renew。

### 验证

- 单测：expiry-check 8 + provision 8；HYPE-copy 全量 88/88 绿；`node --check` 全通过。
- `app render` 确认 `HYPE-copy-expiry.{service,timer}` 单元生成正确（每日 09:00 / Persistent / 随 hypeCopy 启用）。
- subagent 独立审核 PASS（evaluateExpiry 边界/多agent/null、B1 零存储、三条错误路径、SDK extraAgents 字段、名称前缀匹配、systemd 单元、只读无密钥安全均核实）。

---

## HYPE-copy 切实盘 spec + v3 资金模型接入主循环（Part A 全量，仍 dry-run）— 2026-07-04

取消 dry-run 切真实下单的落地蓝图 + 把 v3 资金分配（每币独立预算 + 生存杠杆 + 逐仓保证金防守）完整接入主循环。**Part A 全部完成（A-C/A-D1/A-D2/A-D3/A-E）**，dry-run 现按 v3 输出；真钱（Part B）另行。spec：`.claude/kit/spec/auto-copy-trade/09-go-live-real-trading.md`。

### 背景

排查发现 v3 资金分配（spec 07）只落了 Phase A（api）+ B（allocation 四纯函数），**C/D/E 从未接线**：`main.mjs` 仍跑旧 ratio、`allocation.mjs` 缺 `planFollow`、`risk.mjs` 未删 skip-maxpos/capped、`targets.json` 已填 v3 字段但代码不读（风控错配）。本次补完接线，dry-run 才真正反映 v3 决策，为动真钱前验证铺路。

### 变更

- **`.claude/kit/spec/auto-copy-trade/09-go-live-real-trading.md`（新建）**：经 4 轮 subagent 核实（v3 缺口 / SDK 契约 / 对抗复查 / 安全审计）。Part A（补完 v3，dry-run）→ gate → Part B（真钱）。含已核实 SDK 契约（§2，**修正：order 回执无 fee 须查 `userFills`**）、启动基线快照（§3.6）、Agent Wallet 操作指引（§5）、14 条安全缺口（§8，S2–S7 为切实盘硬阻断）。
- **`process/allocation.mjs`（A-D1）**：新增 `planFollow`（size 跟随，followRatio=min(1,|目标szi|/|T0|)，[0,S0] 区间跟减/平/回补，封顶 S0）。
- **`process/risk.mjs`（A-C）**：`decideLeg` 六分支→四分支，删 skip-maxpos/skip-capped（v3 由 maxCoinCapital 定额 + maxPositions 槽位封顶替代）。
- **`process/reconcile.mjs`（A-D2）**：新增顶层编排 `planBudgetReconcile`（spec 07 §3.7 纯函数）——baseline 过滤 → 逐币分派（新开 selectLeverage+planOpen / 反手先平 / 同向 planFollow+planDefend / 目标消失平仓）→ decideLeg 单点 gate → top-N（maxPositions 槽位）+ mm=1/(2×maxLeverage) 折算，产 actions/stateUpdates/alerts。`planReconcile` 标 @deprecated。
- **`main.mjs`（A-D3）**：`reconcileOnce` 从旧 ratio 切到 `planBudgetReconcile`；新增 `state.myPosByCoin`（{margin,openSize,openTargetSzi,leverage,side,curSize}）+ `applyStateUpdate`（set/delete/setCurSize/addMargin/baseline-remove）；**启动基线快照**（只跟部署后新开仓，spec 09 §3.6）；would-place 前先 would-update-leverage（生存杠杆）、would-defend 走 would-update-margin。
- **`tool/copyStateStore.mjs`（新建，A-D3）**：baseline + myPos 原子落盘/恢复；损坏/缺失 → 降级"未建基线"（重新快照当前为 baseline，绝不当新开跟，安全默认）。
- **notify（A-E）**：`templates.lineFor` 加 `would-defend`(🛡)/`skip-no-open` 文案、删 skip-maxpos/capped；`index` ALERT_RESULTS 去 maxpos/capped 加 skip-no-open、actionOf 加 defend。
- **`process/mapping.mjs` + `targets.example.jsonc`（A-E）**：配置 schema 换 v3 字段（allocationModel/minOpenCapital/maxCoinCapital），loadTargets 校验（>0、max≥min、实盘必填 masterAddress）。
- **`docs/copy/*`**：hype-go-live / hype / core-flow 同步 v3；allocation.md 补 planFollow/planBudgetReconcile。修正 #7（生存杠杆非镜像）、#9（fee 查 userFills）。
- **`targets.json`**：`chmod 600`（原 0644 含活 TG token，安全审计 S1）。**依赖**：补 `viem`（Part B 签名）。

### 边界

- **仍 dry-run**：`placeDryRun`/`buildWouldUpdate*` 恒 `dryRun!==true` throw 占位；真实余额仍用 availBalanceSim。真钱走 Part B（B-1 余额 / B-2 agent wallet / B-3 签名 / B-4 fee+chase / B-sec 安全 / B-5 翻转）。
- 平仓（target-gone/reverse-close）出富 close 卡片，dry-run 用上轮快照目标 cr/cf 折算 mirrorPnl（`|我方size|/|目标szi|×targetCr`）；权威 closedPnl 回填留 Part B（userFills）。
- 编排告警（top-N 未跟币 / 防守认栽封顶 exhausted）经 `result:"alert"` → lineFor(⚠️) + ALERT_RESULTS 去重进 TG 推送，保证 dry-run gate 可观察。

### 验证

- `node --check` 全模块通过；单测 HYPE-copy 80（+planFollow 6 / planBudgetReconcile 10 / copyStateStore 3，删 maxpos/capped 2）、copy-signal 6、watch 回归 sodex 25 / HYPE 20，合计 **131/131 全绿**。
- 集成冒烟（含重启恢复）：开仓(生存杠杆 L*=2/size 583)→重启从盘恢复→跟随减仓(291)→防守补保证金(封顶 500/exhausted)→平仓删除，全链路 stateUpdate op 契约一致。

---

## 仓位状态持久化 + 启动 REST 兜底（sodex-watch + HYPE-watch 对称）— 2026-07-04

修复服务重启后 `lastPositions` 丢失导致仓位基线错误，引发开仓漏报、剩余仓位不显示、fill 重复推送 CLOSE 的连锁问题。spec：`.claude/kit/spec/auto-copy-trade/08-position-persistence.md`。

### 变更

- **`tool/lastPositionsStore.mjs`（新建）**：仓位快照 + accountId 持久化工具（读写/多地址隔离/损坏降级）。
- **`HYPE-watch/process/watcher.mjs`（三层防御）**：
  - Layer 1：推送成功后 `saveLastPositions` 写盘。
  - Layer 2：首帧调 `fetchClearinghouseState` REST 交叉验证，纠正 HL WS 重连快照不完整。
  - Layer 3：跨帧 CLOSE 补丁加 `prevPositions` 守卫。
- **`sodex-watch/process/watcher.mjs`（三层防御）**：
  - Layer 1：推送成功后 `saveLastPositions` 写盘。
  - Layer 2：持久化 `accountId`（WS 拿到后写盘，重启从磁盘恢复）；首帧调 `fetchPositionHistory` REST 获取当前仓位交叉验证，无需等 WS 连接。
  - Layer 3：跨帧 CLOSE 补丁加 `prevPositions` 守卫。
- **`sodex-watch/process/parse.mjs`**：新增 `parseRestPositions`（REST 仓位 → WS 兼容格式）。
- **`HYPE-watch/main.mjs` / `sodex-watch/main.mjs`**：传入 `stateDir` 参数。
- **`HYPE-watch/test/lastPositionsStore.test.mjs`**：5 个单测。

### 边界

持久化文件缺失/损坏 → 降级空数组。REST 失败 → 降级到持久化数据 + 告警。WS 运行中丢帧 → Layer 3 兜底。

---

## HYPE-watch WS 心跳优化 + 断连诊断 — 2026-07-04

HYPE-watch WS 断连频繁（356 次/周），优化 ping 间隔并加断连原因诊断。

### 变更

- **`HYPE-watch/process/watcher.mjs`**：ping 间隔 15s→30s（对齐 GoldRush 推荐，HL 超时 60s）；`onclose` 日志加 `reason` 字段，用于诊断断连根因。

### 效果

- 每小时 ping 从 240 次降至 120 次，减少心跳开销。
- 断连日志含 `reason`，一周后可分析根因（code=1000 reason="" → HL 连接时长限制；reason="Going Away" → 服务端重启）。

---

## 服务运行日志聚合脚本 — 2026-07-04

新增 `service/running-log/`：从 VPS journalctl 聚合提取核心运行事件（部署/重启、WS 断连、API 错误、崩溃、业务异常），生成 markdown 周报用于复盘。

### 变更

- **`script/generate.sh`（新建）**：单次 SSH 在 VPS 执行 journalctl 聚合查询，按服务 × 事件类型统计并输出 markdown 报告。支持日期范围参数，默认最近 7 天。
- **`log/`（新建）**：存放生成的周报（`weekly-YYYY-MM-DD.md`）。

### 设计

- **聚合而非全量**：只提取 5 类核心事件（重启/WS 断连/API 错误/崩溃/业务异常），不做全量日志搬运。
- **本地执行**：脚本在 Mac 运行，ssh 到 VPS 查询，不污染服务器。
- **用法**：`bash generate.sh [开始日期] [结束日期]`，部署后复盘用。

---

## 通知按币种/动作拆多条消息（sodex-watch + HYPE-watch 对称）— 2026-07-03

原 watch 通知冗余：仓位卡片全币种展示、离场单变化额外单发一条 banner、平仓历史一次列多条、多动作同帧被 banner 优先级压缩成一个动词。重构为「一帧发 N 条独立消息」，只留本次变化、一眼看清哪个币做了什么动作。

### 变更（两端对称：`process/render.mjs` + `process/watcher.mjs`）

- **`fetchAndReport` 消息循环**：从"一帧一条（`classifyBanner` 取最高优先级）"改为按 `events` / `exitChanges` 拆多条——非平仓变化币（OPEN/INCREASE/REDUCE）各一条仅该币卡片；平仓（CLOSE）合并一条（摘要 + 剩余全景 + 每平仓币 1 条历史）；离场单变化按币各一条；`events` 与 `exitChanges` 全空（纯抖动）不发。新增 `buildEventMessages` 方法编排。
- **离场单双发消除**：删主报告后独立 `buildExitOrderBanner` 单发，合并进离场单消息，banner 按动作细化（ORDER PLACED/CANCELED/MODIFIED，同币多动作回退 OPEN ORDER），变化挂单行前 ⭐️。
- **加/减仓量级 + 保证金变化**：卡片新增 `⭐️ 增加/减少持仓 5→8 (+3)` 与 `⭐️ 保证金 $754→$1,206 (+$452)`；watcher 推进 `lastPositions` 前快照 prev，渲染层重算（HYPE 读 `marginUsed`，sodex 用 `(size×entry)/lev`）。`diffPositions` events 字符串签名不变。
- **⭐️ 全站统一**：开仓 `📊 仓位` 行前、加/减仓变化行、离场单变化行、平仓历史行；平仓历史 `★` → `⭐️`，事件平仓去掉"（最近N条）"且仅每平仓币 1 条。
- **`const/bannerLabels.mjs`**：`WATCH_BANNER_LABEL` 删 `CHANGE`；新增 `EXIT_ORDER_BANNER_LABEL`（place/cancel/modify/mixed）。连带清理两端 `bannerHead` 的 `?? CHANGE` 兜底、`BANNER_EMOJI.CHANGE`，`classifyBanner` 无动词改返 `{ kind: null }`（不再兜底 CHANGE，避免渲染 "undefined"）。
- **console 不拆**：仍单条聚合全景留痕，仅 TG 按币种/动作拆多条；纯抖动帧 console 记一行不推。`reportGate` skip 仅作用于 START/SNAPSHOT 全景。
- **`test/domain.test.mjs`**：sodex classifyBanner 兜底断言改 null；HYPE 新增 classifyBanner 单测。

### 边界

- HYPE-copy 未改（仅依赖 copySignal 脏标 + 独立 templates，`this.positions` 仍全量获取只渲染过滤）；数据获取层不变（WS 全量 + REST 全量，仅渲染过滤）。

### 验证

- sodex-watch 25/25、HYPE-watch 15/15、HYPE-copy 68/68，全量 171/171 单测全绿；`node --check` 两端 render/watcher 通过；渲染冒烟脚本核对 8 种消息面板与设计稿一致。

---

## banner 文案集中到 service/const 并加中文（中英同行）— 2026-07-03

watch banner 原为纯英文、两端各存一份重复；copy banner 原为纯中文。统一抽到共享常量，每条 banner 英文 + 中文同行（如 `OPEN POSITION 开仓`）。

### 变更

- **`const/bannerLabels.mjs`（新建）**：导出 `WATCH_BANNER_LABEL`（7 种：START/SNAPSHOT/OPEN/CLOSE/INCREASE/REDUCE/CHANGE）+ `COPY_BANNER_LABEL`（6 种：initial_sync/startup/round_open/round_close/round/shutdown）。图标不入此表，仍由各 render/templates 按 kind 决定。
- **`sodex-watch` / `HYPE-watch` 的 `process/render.mjs`**：删本地 `BANNER_VERB`，import `WATCH_BANNER_LABEL`，`bannerHead` 改用之。
- **`HYPE-copy/notify/templates.mjs`**：删本地 `BANNER_ACTION`，import `COPY_BANNER_LABEL`，`buildBanner` 改用之（icon 逻辑保留）。
- **`HYPE-copy/test/domain.test.mjs`**：banner 头断言更新为中英同行文案。

### 中文映射

START WATCH 开始监控 / SNAPSHOT 每日快照 / OPEN POSITION 开仓 / CLOSE POSITION 平仓 / INCREASE POSITION 加仓 / REDUCE POSITION 减仓 / POSITION CHANGE 仓位变化；copy 另有 COPY START 跟单启动 / RECONCILE 跟单对账 / COPY STOP 跟单关闭。

### 验证

- sodex 25/25、HYPE-watch 14/14、HYPE-copy 68/68 单测全绿。

---

## sodex-watch 开平跨帧跳过的平仓凭记录判 CLOSE（classifyBanner 增吃新平仓集合）— 2026-07-03

场景②-b：仓位在两次轮询之间「开→平」，仓位 diff（`diffPositions`）从没抓到 CLOSED 边沿，只剩一条平仓历史记录。此前 `classifyBanner` 只看 `events`，events 空 → 兜底 POSITION CHANGE，真实平仓被漏报。

### 变更（仅 sodex-watch，HYPE 不适用见下）

- **`process/render.mjs`**：`classifyBanner(events)` → `classifyBanner(events, newClosedIds)`；兜底 CHANGE 前加一道：`events` 无 CLOSED 但 `newClosedIds` 非空 → 判 `CLOSE`（有平仓记录为证，唯一合理解释是开平被跨帧跳过）。
- **`process/watcher.mjs`**：调用点传入本轮新平仓集合 `newPosIds`。
- **`test/domain.test.mjs`**：新增 classifyBanner 单测（动词优先级、新平仓判 CLOSE、无记录兜底 CHANGE、不传参安全、有 CLOSED 不受影响）。

### 为何 HYPE-watch 不做此改动（非对称）

sodex 有 G5/G6 guard（`watcher.mjs:246`：检测到 CLOSED 但 `newPosIds` 空 → 2s 重拉、不报），保证"仓位平了但平仓记录未到"时不报、等记录到齐同帧才报唯一一次 CLOSE；新分支只在真·开平跨帧跳过（从无 events CLOSED）时触发，不与正常 CLOSE 重复。

HYPE **无此 guard**：positions 走 WS `clearinghouseState`、平仓记录走 REST `fetchUserFills`，两源异步。若给 HYPE 加同款分支，正常平仓会重复报——t0 仓位消失（events CLOSED）报一次 CLOSE，t1 REST fill 迟到（events 空、newOids 非空）又报一次 CLOSE。故 HYPE 保持原样，平仓仅靠 events 里的 CLOSED 触发。

### 效果

- 正常平仓延迟仍由 G5/G6 + events 里的 CLOSED 触发（不走此分支），不会重复报。
- 仅"开平跨帧跳过"这一子情况凭记录升级为 🔴 CLOSE，不再降级为 CHANGE。

### 验证

- sodex 25/25、HYPE 14/14 单测全绿。

---

## sodex-watch 全平被降级为 POSITION CHANGE 修复（基准推进时序）— 2026-07-03

全平仓位被显示成 🟡 POSITION CHANGE 而非 🔴 CLOSE POSITION。根因：`fetchAndReport` 的 G5/G6 补拉分支（检测到 CLOSED 但平仓历史索引未跟上 → 2s 重拉）在 `return` 抑制本次上报**之前**已推进 diff 基准（`lastPositions` 等），导致 2s 重拉时以"变化后 vs 变化后"对照，算不出任何动词、`classifyBanner` 兜底成 CHANGE。同帧夹带的加/减仓动词一并被吞。HYPE-watch 无此 guard 分支，不受影响。

### 变更

- **`process/watcher.mjs`**：把基准推进五行（`lastOutFp` / `lastPositions` / `lastKeysFp` / `lastReduceFp` / `pendingStructural`）从 G5/G6 补拉 `return` 之前下移到之后（`:252-258`）。`diffPositions` 仍在 guard 之前计算（guard 依赖 `events`）。纯时序调整，渲染层未改。

### 效果

- 全平仓位 2s 重拉时以"变化前"为对照，正确算出 CLOSED，banner 显示 🔴 CLOSE POSITION。
- 同帧"加/减仓 + 另一仓全平"不再把加减仓动词吞成 CHANGE。
- 修后 POSITION CHANGE 仅剩"仓位量确实未变"场景（离场单挂撤改 / 平仓历史延迟到达但仓位上帧已更新）。

### 遗留（未在本次处理）

- 多币同帧 / 反手（平多开空）仍只显示优先级最高的单个 banner 动词，逐币种动作明细未渲染——`diffPositions` 数据层已带量级（`parse.mjs:128` `5→3`），属渲染层增强项。

---

## HYPE-copy 资金分配 v3（预算优先 + 生存杠杆 + 逐仓保证金防守）spec + Phase A/B — 2026-06-30

完全替换 ratio 资金模型：每币独立预算（minOpenCapital/maxCoinCapital）+ 生存杠杆 floor(L\*)（开仓即让我方强平价 ≥ 目标 lp）+ 逐仓保证金防守（updateIsolatedMargin 补保证金、size 不变、封顶 maxCoinCapital）。解决小资金跟集中型大户被 skip-maxpos 整仓拦截、一分钱跟不了的问题。spec：`.claude/kit/spec/auto-copy-trade/07-budget-alloc.md`；原理文档：`docs/copy/allocation.md`。

### 变更

- **`api/index.mjs`（Phase A）**：`normalizeTargetPositions` 加 `lp`（目标强平价）；`parseHypeMeta` 加 `maxLeverage`（供 mm=1/(2×maxLeverage) + 杠杆上限）；新增 `getMyLiqPrice` 注入抽象（dry-run 委托 estimate / 实盘读 liquidationPx 占位 throw）；新增 `buildWouldUpdateLeverage` / `buildWouldUpdateMargin` dry-run 构造（对齐 SDK action 字段）。
- **`process/allocation.mjs`（Phase B，新建）**：四纯函数 `sideOf` / `selectLeverage`（floor(L\*) clamp[1,maxLev]，L\*≤0 不开、lp=0 退化）/ `computeMyLiqPrice`（MM-aware short/long，与实盘 liquidationPx 同口径）/ `planOpen`（size=signOf×ROUND_DOWN，<$10 mindust）/ `planDefend`（needMargin ROUND_UP、封顶 maxCoinCapital、exhausted 认栽）。
- **`process/precision.mjs`**：加 `ceilTo`（ROUND_UP，needMargin 向上取整保证补足）。
- **`process/sizing.mjs`**：`computeRatio`/`computeDesired` 标 `@deprecated`（保留防 import 断裂，v3 已替换）。
- **接口依据**：三个 hype action（order/updateIsolatedMargin/updateLeverage）字段经 `@nktkas/hyperliquid` SDK 源码核实；liquidationPx/lp/maxLeverage 经实测 curl 确认。

### 效果

- 500 跟 0x267b…2566 LIT 不再整仓 skip：2x、做空 583 张、开仓真实强平价 2.337 > 目标 2.1225。
- 防守用 updateIsolatedMargin（补保证金不增 size），目标 lp 后撤时追平；超 maxCoinCapital 认栽、单币最坏亏封顶。

### 验证

- 纯函数单测 68/68 全绿（含 selectLeverage short/long/边界、computeMyLiqPrice、planOpen mindust、planDefend 补/exhausted/lp=0）。
- Phase A / Phase B 各过三闸门 `/k:check`。

### 边界（阶段）

- 一期 **dry-run**：三个 action 只产 would-\* 决策 + 推送，不签名。
- Phase C（risk 校验门改造）/ D（reconcile+main 编排）/ E（notify 文案）尚未实现；自浮盈滚仓为 Phase 2（gated by 实盘 A5 验证）。

---

## HYPE-copy 平仓盈亏 + 双卡片全集 + banner 自适应 — 2026-06-29

### 变更

- **`api/index.mjs`**：`normalizeTargetPositions` 补 `cr`（累计已实现盈亏）/ `cf`（累计资金费率）提取。
- **`main.mjs`**：state 加 `lastCrByCoin`/`lastCfByCoin`/`lastTargetSziByCoin`/`lastLeverageByCoin`（平仓快照）；`mappable`/`desiredEnriched` 补 `cr`/`cf`；平仓检测（`prevRatio` 快照解 ratio=null 问题）；banner kind 改为币种级推导（`newCoins`/`hasClose` 对 `prevCoins` 做差，解 skip-maxpos 拦截后无法识别问题）；`current` 过滤平仓币（防 planReconcile 重复产 place 事件）；仓位卡片所有轮次展示（不限于启动轮）；无仓位时展示"无持仓"。
- **`notify/templates.mjs`**：`BANNER_ACTION`/`buildBanner` 加 round_close/round_open；`lineFor` close 改为双卡片格式（目标+跟单平仓卡片，含平仓前持仓/盈亏/费用，空行分隔）；`buildPositionCards` 加 `skippedCoins` 参数（skip-maxpos 币种跟单卡片标 ⛔ 不跟）。
- **`test/domain.test.mjs`**：新增平仓盈亏双卡片单测。

### 效果

- 平仓消息含目标/跟单双维度盈亏 + 费用（`cr`/`cf` 来自 sodex REST，零新增请求）。
- 所有轮次统一双卡片（🎯 目标 + 📊 跟单），平仓亦双卡片格式。
- Banner 自适应开仓/平仓/对账（币种级检测），不再一律 ⏫。
- skip-maxpos 货币跟单卡片标 ⛔ 不跟，避免「显示了仓位但说不跟」的混淆。

### 验证

- 纯函数单测 59/59 全绿。

---

## HYPE-copy 通知模板重构（卡片式 + 目标/跟单双卡片）— 2026-06-29

通知模板从纯文本行重构为 watch 卡片式风格：banner 头（动作+时间+ID）+ 仓位双卡片（🎯 目标 / 📊 跟单，空行分隔）+ 明细行 + 计时页脚。

### 变更

- **`notify/templates.mjs`**：重写，新增 `buildBanner` / `buildPositionCards`（目标+跟单双卡片，含目标持仓量/开仓价/标记价/保证金 + 跟单持仓量/仓位价值/保证金）/ `buildDeltaLine` / `buildRoundSummary` / `fmtDisplaySize` / `fmtDisplayUsd`；方向改为"做多/做空"；文案 `initial_sync` 统一为"跟单启动"；`skip-maxpos` 消息带上下文（需 X > 上限 Y + 公式）。
- **`main.mjs`**：`mappable` 补 `entryPx`；新增 `desiredEnriched`（补 leverage / szDecimals / targetEntryPx / targetSzi）；事件对象补上下文（`positionNotional` / `maxPosNotional` / `availBalance` / `maxPositionPct`）；汇总改走 `buildRoundSummary`。
- **`notify/index.mjs`**：无逻辑变更。

### 部署相关

- **`setup/setup-copy.sh`**：加 `tracker` 用户创建（`[1/6]`）；步骤重新编号。
- **`setup/Makefile`**：`make deploy` 补 `decimal.js @nktkas/hyperliquid` 依赖。
- **`service/app/index.mjs`**：注释 `User=trader-exec`/`Group=trader-exec`、移除 `ProtectHome=true`（dry-run 期 `/root` 路径兼容，切实盘前迁至 `/opt/tracker` 后恢复）。
- **`docs/deploy/hype-copy.md`**：修正步骤编号，补充 `/root` 路径与 systemd 加固冲突说明。
- **`targets.json` / `targets.example.jsonc`**：`maxPositionPct` 0.5→0.6。

### 验证

- 纯函数单测 58/58 全绿；watch 回归（sodex 21 / HYPE 14）+ copy-signal 6 全绿。
- VPS `HYPE-copy@demo-1` 已部署运行，JSONL 持续记录。

### /k:check 修复（同版增量）

- **`main.mjs`**：加 `hasContent` guard（常规轮无变化静默不推，仅启动轮/有变化轮推送）；时钟改用 `fmtClock()` 北京时间。
- **`notify/templates.mjs`**：`fmtClock` 改为导出；`levStr` 空格修正。
- **`notify/index.mjs`**：`toLogLine` 补 `szDecimals` / `positionNotional` / `maxPosNotional` 字段。
- **`test/domain.test.mjs`**：新增 5 组单测（`fmtDisplaySize` / `fmtDisplayUsd` / `buildPositionCards` 空+单仓 / `buildRoundSummary` initial_sync+round）。
- **`notify/templates.mjs`**：min-capital 文案「最低本金参考」→「最低本金下界」（附含义说明）。
- **`docs/notify/copy.md`**：round icon `🆕`→`⏫` 对齐代码；min-capital 文案同步。

### 验证

- 纯函数单测 58/58 全绿；watch 回归 + copy-signal 全绿；`/k:check` 三闸门通过。

---

## HYPE-copy 自动跟单执行系统（dry-run + 事件驱动）— 2026-06-29

新增 `service/HYPE-copy/`：监听高手仓位变化 → 按资金比例换算 → 在 Hyperliquid 镜像 would-place。**执行端恒 hype**；信号源支持 sodex（跨所映射）/ hype（同所直通）。一期止于 **dry-run**（不签名、不发真实单），跑通 信号→换算→收敛→风控→推送 全链路 + 隔离架构 + 事件驱动触发。spec-set：`.claude/kit/spec/auto-copy-trade/`。

### 新增

- **`HYPE-copy/process/`**：`mapping`（loadTargets 单目标硬限制 + mapSymbol，sodex 映射表 / hype 直通 + hype universe 实时校验）、`precision`（decimal.js ROUND_DOWN，formatPrice/Size + 算术）、`sizing`（computeRatio 锚定 + computeDesired 保证金等比）、`recommend`（最低本金反解）、`risk`（decideLeg 六分支校验门）、`reconcile`（diffDelta 净仓收敛 + planReconcile 顺序铁律）、`stats`（聚合纯函数）。
- **`HYPE-copy/api/index.mjs`**：sodex 目标态读 + hype 价格/meta + placeDryRun（IOC would-place，不签名；真实提交 throw 占位）。两端共享限流退避。
- **`HYPE-copy/notify/`**：事件分类推送（🆕开/⏫加/⏬减/🏁平/▶启/⏹关）一轮一条汇总 + 指纹去重 + 计时页脚（fullMs/execMs）；每动作 JSONL + journald；`templates.mjs` 文案与逻辑分离。
- **`lib/copy-signal/`**：跨进程脏标信号（原子写 + `fs.watchFile` mtime gate + ts 去重，对 rename 免疫）+ `makeSingleFlight`（信号∥兜底并发合并，防双下单）+ `DEFAULT_SIGNAL_DIR`。
- **`HYPE-copy/main.mjs`**：对账循环执行器——事件驱动主触发（订阅信号）+ REST 180s 兜底 + single-flight + 生命周期状态机（idle/anchored/following/capped/flat）+ SIGTERM 关闭推送。
- **部署**：`setup/setup-copy.sh`（trader-exec + 信号目录 + targets 权限一键）；`docs/copy/{hype,core-flow,hype-go-live,hype-dry-run-testing}.md` + `docs/deploy/hype-copy.md` + `docs/notify/copy.md`。

### 变更

- **`sodex-watch`/`HYPE-watch` watcher.mjs**：WS-change 点加 `emitCopySignal`（加法 + `copySignal`/`copySignalDir` 开关，未配 no-op、TG 行为 diff=0、检测主体零改）。config.mjs/main.mjs 解析并按 `<dir>/<address 小写>.json` 派生信号路径（与 copy 派生口径一致，大小写自动归一）。
- **`app/index.mjs`**：纳入 `HYPE-copy@.service` systemd 模板单元（trader-exec + 资源上限 + 加固，dry-run 不注入 LoadCredential），`hypeCopy` config 段（默认 enabled=false）。
- **`setup/setup-systemd.sh`** + **`package.json`**：补 `decimal.js`/`@nktkas/hyperliquid`（copy 执行器）+ `undici`/`https-proxy-agent`（WARP 运行时）。

### 范围 / 效果

- 一期 **dry-run**：用 `availBalanceSim` 模拟余额，不碰 agent key、不签名、不发真实单。事件驱动：目标动 → watch 写信号 → copy ~1s 触发对账（估算端到端 ~2-3s，含接口拉取）；任一未配 → 自动退化 180s 轮询兜底。`reconcile.mjs`/`diffDelta` 全程零改。
- 后续 gated（不在本版）：真实余额、Agent Wallet 签名、dryRun 翻转、杠杆同步、真实 fee/熔断、sodex 执行腿——见 `docs/copy/hype-go-live.md`。

### 验证

- 纯函数单测：HYPE-copy domain 53 + copy-signal 6 + watch 回归（sodex 21 / HYPE 14）全绿。
- **真实数据实测**：hype allMids 928 币 / meta 230 perps 实通；sodex 真实仓 CL-USD 字段核对（`s/sz/ep/l` 命中、marginUsed=`co/l` 精确）。
- 事件驱动端到端接线验证（config→派生→emit→可解码、大小写对齐、single-flight burst 合并）；多轮 `/k:check` 三闸门通过。

### 部署易用性收尾（同版增量）

- **默认事件驱动**：watch config.mjs 改为「自定义 copySignalDir > 显式 copySignal(true/false) > **信号目录存在即默认开**」——`setup-copy.sh` 建了目录即自动启用，无需 flag；纯监听部署（无目录）零影响、diff=0。opt-out：`copySignal:false`。
- **一键部署**：`setup/setup-copy.sh` 扩为唯一手填 = `targets.json`，其余全自动（建 trader-exec + 信号目录 + chmod + 读 target.id 合并启用 app `hypeCopy` + `app apply`），含空 targets 守卫。
- `package.json`/`setup-systemd.sh` 补 `decimal.js`/`@nktkas/hyperliquid`/`undici`/`https-proxy-agent`。部署指南 `docs/deploy/hype-copy.md`。

---

## HYPE-watch 分档 debounce（对齐 sodex 治理滚仓刷屏）— 2026-06-28

把 sodex-watch 的分档 debounce 对称移植到 HYPE-watch（两端 watcher 同构）。真实数据（地址 `0xaf0fdd39e5d92499b0ed9f68693da99c0ec1e92e`，5 仓 / 2000 fills / 502h）：HYPE 成交亚秒级密集（间隔 p50=0s / p90=64s），现状 3s 已合并簇内大半，长档主要合并簇间滚仓。实抓 WS openOrders 帧确认 `wsOrders` 带 `reduceOnly`/`isPositionTpsl`，故能完全对齐 sodex 的结构判别。

### 新增

- **`HYPE-watch/process/parse.mjs`**：`positionKeysFp`（`coin:dir` 键集合指纹，不含 size）+ `canonicalExitOrdersFp`（`wsOrders` 中 `reduceOnly||isPositionTpsl` 子集指纹）。
- **`HYPE-watch/test/domain.test.mjs`**：+5 单测（滚仓不改指纹 / 开平反手 / 离场单子集 / 开仓单 sz 变不计 / 空数组）。

### 变更

- **`HYPE-watch/process/watcher.mjs`**：`scheduleFetch(structural)` 分档（短档 3s/5s、长档 **12s/45s**，HYPE 实测拐点；pendingStructural 只升不降）；`recomputeStateFp` 比对键集合+离场单子集判结构变化，`userFills`/`orderUpdates` 不升级；触发指纹保持全量挂单不变（灵敏度不变）；基准在推送处推进；daily 走短档；首帧基准初值 null 保证 START WATCH 即时。
- **`HYPE-watch/main.mjs`**：usage 补 `--tier-debounce-ms` / `--tier-max-wait-ms`（设短档同值即回退）。

### 范围 / 效果

- 仅 HYPE-watch；不动 sodex-watch、不改触发灵敏度。开平/反手/离场单即时（中位 3s）；滚仓合并（sim 实测 330→256@12s）。

### 验证

- `node --test` 14/14 全绿（含新增 5 项）；`node --check` 三文件语法 OK。

---

## sodex-watch 分档 debounce（治理滚仓刷屏）— 2026-06-28

跟单监控账户**同一仓位内反复加减仓（滚仓）**会刷屏式推 Telegram。真实数据定位（account 17139 / ETH，408 笔成交）：瓶颈是 `scheduleFetch` 的 trailing debounce=3s，成交间隔 7~22s 全部 > 3s 各自 flush。按持仓 `{币种:方向}` 键集合是否变化分两档——开/平/反手/离场单走短档即时，滚仓走长档合并。

### 新增

- **`sodex-watch/process/parse.mjs`**：`positionKeysFp`——不含 size 的 `{symbol:dir}` 键集合指纹，用于区分结构变化（键变）与滚仓（仅 size 变）。
- **`sodex-watch/test/domain.test.mjs`**：+5 单测（滚仓不改指纹 / 开仓 / 平仓 / 反手 / 排序稳定）。

### 变更

- **`sodex-watch/process/watcher.mjs`**：`scheduleFetch(structural)` 分档（短档 3s/5s、长档 20s/90s，pendingStructural 只升不降取最紧急）；`handleMessage` 比对键集合判结构变化，`accountTrade`/`accountOrderUpdate` 不改档位；基准与 pendingStructural 在推送成功处推进；CLOSED 补拉 / daily 快照走短档即时；首帧基准初值 null 保证 START WATCH 即时。
- **`sodex-watch/main.mjs`**：usage 补 `--tier-debounce-ms` / `--tier-max-wait-ms`（设为短档同值即回退旧行为）。

### 范围 / 效果

- 仅 sodex-watch；HYPE-watch 独立同构，本次不动。开/平/反手即时性不变（实测开平延迟中位 3s）；滚仓合并（sim3 离线模拟 287→104 条）。

### 验证

- `node --test` 21/21 全绿（含新增 5 项 positionKeysFp）；`node --check` 三文件语法 OK。

---

## discovery 候选地址历史记录（watch-candidates）— 2026-06-26

新增 `watch-candidates.json` 持久化存储所有曾加入 watch 的地址（追加不删），discovery 排除"当前监听 + 历史候选"并集，防止已移除的地址在下一轮重新出现。

### 新增

- **`service/tool/watchCandidates.mjs`**：`loadCandidates` / `saveCandidates` / `mergeCandidates` / `candidateAddresses` + 10 项单测。格式 `{"0x...": {"date":"...", "reason":"..."}}`，兼容旧纯日期字符串。
- **`service/sodex-watch/watch-candidates.json`** + `service/HYPE-watch/watch-candidates.json`：初始空文件，手动维护（本地编辑 + scp 推送）。

### 变更

- **`sodex-discovery/main.mjs`** + **`HYPE-discovery/main.mjs`**：排除集从"仅 watch config"扩展为"watch config ∪ watch-candidates"，日志展示分项计数。
- **`.gitignore`**：排除 `watch-candidates.json`。

### 验证

- `node --test` 82/82 全绿（tool 10 + watch 18 + discovery 54）。

---

## fetchUserFillsByTime 修复 + HYPE-watch 候选刷新 — 2026-06-26

`fetchUserFillsByTime(startTime=0)` 在 HYPE API 返回截断数据（实测某帐号漏近 7 天 200 条 fill），修复为 falsy startTime 时回退到 `fetchUserFills`。同时深评刷新 HYPE-watch 监听池——保留 ①/② 基准，新增 ③ 多币种活跃（#7）、④ 5仓大户（#6）、⑤ 净额 69 万（#5）。

### 修复

- **`api/index.mjs`**：`fetchUserFillsByTime` 加 startTime guard——0/null/undefined 回退 `fetchUserFills`。

### 变更

- **`HYPE-watch/config.json`**：替换 ② 全胜截断户、⑤ 最弱户 → 新增 ③/④/⑤ 三人。
- **`HYPE-watch/watch-candidates.json`**：追加 4 个淘汰地址 + 原因。

---

## HYPE-discovery 修复 fee 符号 + funding 真实 PnL 增强 — 2026-06-26

竞品 HyperX 调研中发现「跟单者手续费侵蚀」指标，回查代码时发现 `evaluate.mjs:43` 周期净额误用 `closedPnl + fee`（实测 `fee` 为正成本，方向反了 → 系统性高估盈亏、且越高频被夸大越多）。一并落地 funding 真实 PnL 增强（资金费不在 closedPnl 内，实测某户净 +$65k）。三端点（userFills.fee / userFunding / userNonFundingLedgerUpdates）已用真实地址 `0xace0a4c0…` 实测验证。

### 修复

- **`process/evaluate.mjs:43`**：`closedPnl + fee` → `closedPnl - fee`（净额=已实现盈亏减手续费）。`domain.test.mjs` 加单测锁定（开1平10、(0−1)+(100−1)=98，退回 bug 则 102）。

### 新增

- **`api/index.mjs`**：`fetchUserFunding(address, startTime)`（userFunding 端点，`delta.usdc` 正收/负付）。
- **`process/evaluate.mjs`**：evaluate 内拉 funding（startTime 取最早 fill、对齐 fills 时间窗、`>=2 fill` + `isFinite` 守卫）；产出账户级 `fundingTotal` + `truePnl = Σ(closedPnl−fee) + Σ funding`。
- **`process/score.mjs`**：规模维度改用 `truePnl ?? netProfit`（真实 PnL 优先，回退安全）。
- **`process/output.mjs`**：md 增「真实 PnL = 净额 + 资金费」展示行（`truePnl !== undefined` guard）。

### 关键决策

- **funding 账户级、不逐笔**：PF/RF/胜率仍按 trade-level（funding 无法归因单笔），funding 只叠加到账户级 truePnl + 规模评分。
- **仅 HYPE 侧**：sodex-discovery 数据源不同、无对应 funding 接口，无需对称改动。

### 验证

- `node --check` 全 5 文件通过；`domain.test.mjs` 11 pass / 0 fail。
- 真实接口实测（`0xace0a4c0…`）：netProfit(净 fee) −$288,193.71、funding 29 条 −$153.19、truePnl −$288,346.9，链路全通。
- `/k:check` 三闸门（subagent + 主 review + verify.sh）一致 PASS（首轮 FAIL 仅文档标签滞后，已修）。

---

## 调研竞品 HyperX，沉淀 Agent Wallet 安全机制与筛选阈值对照 — 2026-06-26

调研 Hyperliquid 跟单平台 HyperX（hyperx.trade + GitBook），提取对本项目有用的机制。最大收获：**Agent Wallet（API Wallet）授权**——主钱包只签一次 `approveAgent`，授权一个只能交易、不能提现的 agent key，执行器只持 agent key，VPS 被攻破也丢不了本金。其余多为对我们方向的验证（~5s 延迟印证「只跟低频高手」）与参数校准。

### 变更

- **`docs/copy-trade-blueprint.md`**：新增 §10.7 Agent Wallet 安全设计（@nktkas 支持 approveAgent）+ 硬规则第④条；§10.4 补定额跟单模式 + 收敛模型覆盖说明（认真分析后排除「方向一致才跟」「≥10USDC 门槛」等不适配/冗余项，不灌水）。
- **`docs/server-architecture.md`**：§5/§6.4 同步——systemd 注入的是 agent key（非主私钥）。
- **`docs/discover-traders-plan.md`**：新增 §7.4 竞品筛选阈值对照（HyperX 余额≥$5k / 交易 5-100 / ROI 含存款分母），作 sanity-check 锚点，不替换本系统 PF/RF/真账本方法论。

### 关键决策

- **私钥安全升级**：执行器从「裸持主私钥」改为「持只能交易的 Agent Wallet key」，主私钥不上服务器；agent 仍能亏损交易 → 风控/急停依然必要。
- **机制取舍按「删了会怎样」筛**：定额模式记（真分叉）；加减仓/复制当前仓位被收敛天然覆盖只补一句；方向一致才跟不适配收敛模型不记；≥10USDC 等价 MIN_NOTIONAL 不记。

---

## 新增服务端架构与部署设计文档（docs/server-architecture.md）— 2026-06-26

为后续扩展执行腿（跟单 + 现货做市）规划服务端总图。读/写分离：Node 管只读分析（discovery 选人 + watch 监控），Rust 管写操作（签名下单）。背景：分析开源 Hyperliquid-Copy-Trading-Bot 时发现其含私钥窃取木马（`index.ts:10` + 恶意 `sucrase` 依赖，已记入 `copy-trade-blueprint.md`）；改用经安全审计的 `@nktkas/hyperliquid`（Node）/ 候选 `infinitefield/hypersdk`（Rust）。

### 新增

- **`docs/server-architecture.md`**：12 章 + SDK 附录。含可直接抄的 systemd unit 模板（watch 常驻 / discovery timer / OnFailure 告警 / Rust 执行服务 + LoadCredential 私钥注入）、pino+tracing 日志规范、服务间通信冷/暖/控制/热四层、钱包 nonce 隔离规则、资源预算、两台 VPS 平滑拆分方案、分阶段路线图。
- **`docs/copy-trade-blueprint.md`**（前序）：跟单业务逻辑参考蓝本（含木马安全警告）。

### 关键决策

- **语言选型**：留 Node（复用审计签名 + 现有逻辑，I/O 密集语言无所谓）；做市/执行用 Rust（无 GC 抖动→延迟确定性）；暂不用 Go（无官方签名 SDK）/ Python（性能内存双输）。
- **单机多服务**：当前一台 VPS（1-2GB）即可跑 watch + discovery + 跟单 + 做市；用 cgroup（MemoryMax/CPUQuota）隔离，discovery 峰值封顶 400M。
- **通信前瞻**：控制面用本机 HTTP 风格写，将来拆两台机只改地址 + TLS/token，逻辑不动。
- **钱包隔离**：一个钱包只能一个进程签名；跟单与做市用不同子账户，隔离 nonce/库存/盈亏。
- **私钥安全**：viem `privateKeyToAccount` 本地持钥，systemd LoadCredential 注入，私钥不进 SDK、不离本机。

### 不做（边界）

- 现在不上两台 VPS、不上 Redis、不重写 discovery/watch。
- 本文只讲部署/隔离/通信，业务逻辑在 `copy-trade-blueprint.md`，不重复。

---

## sodex-discovery 新增单账户按币种画像工具（coin-profile 模块1）— 2026-06-24

回答现有工具答不了的问题：「这个地址擅长哪个币、做得怎样」。`query.mjs` 只给仓位快照、`evaluate.mjs` 只给全币种合并总账，都无币种粒度。实测证据：全局 PNL 榜靠前 ≠ 在某币种上盈利（account 3602 全靠 ETH +$48069，BTC −$20342）——必须按 `symbol_id` 切片才看得到。定位为分析/情报工具（数据已证伪「靠跟单小额币种专精户赚钱」：500 池 ETH 盈利户净利中位仅 $40）。设计 spec 见 `.claude/kit/spec/2026-06-24-coin-trader-profile.md`。

### 新增

- **`process/metrics.mjs`**（新建）：从 `evaluate.mjs` 抽出共享指标内核 `deriveMetricsFromClosed(closed, now)`，evaluate（全币种）与 coinSlice（按币种）共用，单一真相源。
- **`process/coinSlice.mjs`**（新建）：`sliceByCoin` 按 `symbol_id` 分组 → 各币种调 metrics → 集中度 `pnlShare=|该币净盈亏|/Σ|全币种净盈亏|` + 笔数占比 → 标签（专精档 ≥0.7/0.4-0.7/<0.4 × 盈亏 × 样本不足<8笔）→ 整体画像一句话。
- **`profile.mjs`**（新建入口）：CLI `--account=<id>` / `--address=<0x..>`（链上解析）/ `--save`；拉 positions + refreshSymbols → coinSlice → stdout 人读表 + 可选 `log/profile-<id>-<ts>.json`。

### 变更

- **`process/evaluate.mjs`**：`derivePositionMetrics` 改为 `filter(size=0)` + 调 `deriveMetricsFromClosed`，删 92 行内联重复；`__internals` 移除已外迁的 `dailyNetMap`。行为等价。
- **`api/index.mjs`**：新增 `BASE_BIZ`/`BASE_CHAIN`/`BIZ_ENV` 常量 + `refreshSymbols()`（symbol_id→baseCoin 映射，失败回退 `#<id>`）+ `resolveAccountId(address)`（链上解析 primaryAccountId）。

### 关键决策

- **专精口径用 |盈亏|占比**（非笔数占比）：实测集中度中位仅 11%、纯专精户极稀，故集中度只作排名/展示与标签，**不设硬门槛**（避免清空榜单）。
- **盈利口径历史回看**：`positions.realized_pnl` 逐笔真账本，不读 overview 污染字段。
- **PF/胜率不设硬门槛、全币种全列**：单账户画像不做候选淘汰，所有币种打标由人工判断。
- **A1 抽取而非复制**：metrics 内核单一真相源，承担 evaluate 改造回归风险，由 golden 对比兜底。

### 验证

- `node --check` 全 5 文件通过；`output.test.mjs` 1 pass/0 fail 不退化。
- **回归等价**：account 1046（445 条平仓）改造前后 `derivePositionMetrics` 15 字段逐项相等（golden 对比）。
- 5 验收场景全跑通：account=3602 多币种画像（ETH 盈利/BTC 亏损按集中度降序）、address 解析一致、样本不足标签不淘汰、币名映射不可用降级 `#<id>`、回归等价。
- `/k:check` 三闸门（subagent + 主 review + verify.sh）一致 PASS。

### 不做（边界）

- **模块2 币种专精发现**（对候选池逐个跑画像 + 排名）：数据量稀薄（盈利专精户个位数、净利中位 $40），参考价值低，暂不做。
- **模块3 watcher 币种过滤**（只跟目标指定币种单）：与模块2 价值绑定，暂不做，仅记录。
- 现货 / 下单上链 / 预测建模 / TG 推送。

---

## HYPE-discovery 加 poolMax 候选池上限 + 标题文案修正 — 2026-06-24

新门槛 vlm≥$5万（vs 旧 $500万）使候选池从 557 膨胀到 817，深评阶段 VPS 内存 575MB + swap 81MB 接近 OOM。根因是 HYPE-discovery 缺少 sodex-discovery 的 `poolMax` 候选池硬上限。

### 变更

- **`config.json`**：新增 `poolMax: 300`（对标 sodex poolMax，保守值因 HYPE userFills 更重）
- **`main.mjs`**：解析 `poolMax` + collect 返回后 `slice(0, poolMax)` 截断（leaderboard 按 pnl 降序，取前 N 幸存者语义合理）
- **`output.mjs` / `main.mjs`**：启动日志与 TG/MD 标题"粗筛"→"发现"（标题文案对齐深评改造后的实际管线）

### 关键决策

- poolMax 默认 300：sodex poolMax=1000 但 positions 仅 445 条/候选，HYPE userFills 2000 条/候选重 4-5 倍 → 300 约 3-5 分钟 / 200-300MB，1GB VPS 安全
- leaderboard 按 pnl 降序 → 截断丢弃的是 pnl 最低的幸存者，深评后合格者数量影响小（低 pnl 尾部大概率被深评门槛淘汰）

### 验证

- `node --check` 通过；端到端 dry-run 待 VPS 实测

### 不做（边界）

- 不加 pages 分页机制（HYPE leaderboard 是单文件流式解析，非 REST 分页 API）
- 不压缩 evaluate 并发数（4 并发合理，瓶颈是候选量不是并发）

---

## HYPE-discovery 深评改造：fill 聚合成交易 + 踢做市 — 2026-06-24

把 HYPE-discovery 从"只 leaderboard 粗筛→选出全是机器人"改为"深评筛低频大单方向性可跟单交易者"。诊断/数据/最终算法见 `docs/api-confidence/hype.md §五·六`。

### 新增

- **`api/index.mjs`**：info 封装（`fetchClearinghouseState`/`fetchUserFills`/`fetchUserFillsByTime`）+ 限流 gate（并发≤4 + 间隔 + 429/503 退避）。
- **`process/evaluate.mjs`**（新建）：拉 userFills → `aggregateTrades` 按 `startPosition` 重建仓位周期（持仓归 0 = 一笔交易）→ 交易级算 PF/胜率/RF/频率/名义/单笔利润 + 门槛过滤。
- **`process/score.mjs`**（新建）：PF/RF/胜率/净额规模 归一加权 × capped 降权(0.9)。

### 变更

- **`config.json`**：vlm 门槛 $500万→$5万 + 新增 `minEfficiency`(pnl/vlm)≥1%（修入口——旧门槛系统性筛掉所有低频交易者）。
- **`process/filter.mjs`**：粗筛加 pnl/vlm 效率门槛。
- **`main.mjs`**：串接 collect→filter→evaluate→score→output（替换 rankTopK）。
- **`process/output.mjs`**：展示交易级深评字段（PF/胜率/trades每天/名义/单笔利润）。
- **`api/index.mjs`**：修预存 bug——leaderboard early-stop 用 `return` 替代 `controller.abort()`（abort 抛 AbortError 被误当采集失败）。

### 关键决策（实施中两方案被实测推翻）

- **fill 必须聚合成交易**：HYPE 一笔交易拆数十 fill 执行（#1: 529 fill=10 交易），fill 级 PF/胜率/频率/单笔利润**全失真**（#1 被误判 PF155万做市，实为低频大单高手）。改为交易级。
- **HFT 判据用 trades/天（非 fills/天）**：fills/天会把大单拆单误判高频。
- **去 clearinghouseState**：marginUsed 仅展示、不进 score，去掉使请求减半（性能优化）。
- **踢做市**：中位单笔利润≥$100 门槛剔"名义够但单笔微利"的做市残留。
- **capped 降权**：userFills 2000 上限→近期画像，PF∞ 乐观，评分×0.9。

### 验证

- `node --check` 全通过；端到端 dry-run（--limit=2000）：扫 2000→粗筛 116→深评合格 23→推荐 20。
- 画像收敛：低频（0.1~1.5 笔/天）+ 大单（名义中位 $3万~$733万）+ 大利润（中位单笔 $204~$32万）方向性交易者；做市/高频/小单/微利全被门槛剔除。
- closedPnl 聚合正确性手算验证（#1 6 笔交易/全赢，与代码一致）。

### 不做（边界）

- 不做 userFillsByTime 全史翻页（接受近期画像，capped 降权应对）；不动 sodex-discovery；下注规模维度未进 score（HYPE 名义锚点未校准，仅展示+用净额维度）。

## sodex-discovery 新增下注规模（betSize）评分维度 — 2026-06-23

算法原本只看比率（PF/RF/胜率），不看下注规模，导致"大量小单刷高 volume"被误判优质（ETH/PLTR volume $14M 拿高分，但中位保证金仅 $2.6k 全是小单）。新增 betSize 维度修正"可跟性"盲区。

### 新增

- **`evaluate.mjs`**：`derivePositionMetrics` 推算每仓保证金（`名义÷杠杆`；平仓历史 `initial_margin` 已清零=0，只能推算），输出 `medMargin`/`maxMargin`（中位/最大）。
- **`score.mjs`**：第 6 评分维度 `betSize`，中位保证金对数归一。锚点经 **leaderboard 前 100 名实测分布校准**（75 有效样本：p50≈$700→0、p90≈$25k→1），专门修正 volume 的"小单刷量"盲区。
- **`output.mjs`**：md 报告新增"投入保证金(名义÷杠杆推算)：中位/最大"展示行。

### 变更

- **`main.mjs`**：三 preset 权重新增 `betSize`（balanced 12 / conservative 8 / aggressive 15，从 volume 等匀出，各档和=100）。

### 设计约束

- betSize **只加分、不作硬门槛**——重仓亏更危险（须与 PF/RF 组合）；避免误杀小本金高手 + 阈值拍脑袋。
- CROSS 模式保证金为"名义÷杠杆"**近似**（非精确占用），展示标注"推算"。
- 锚点基于"30D pnl 前 100 名"池，换窗口/全市场可能略偏；样本少，待积累校准。

### 验证

- `node --test` 1/1 全绿；`node --check` 通过；三 preset 权重和均 = 100。
- aggressive 实测：XAut（betSize 1.0、中位 $27k）由 #2 反超 #1；ETH/PLTR（betSize 0.36、小单）降分——精准修正 volume 小单刷量失真，判定门槛不变（仍 3 个通过，只改排名）。

---

## sodex-discovery nTrades 语义正名 + 滚仓盲区记录 — 2026-06-23

`nTrades`（已平仓位数）此前被当"成交频率/经验"代理使用，实测证明仓位数严重低估真实成交频率（0727h 318 仓位 vs 111 笔/天成交；USTECH100 12 仓位 vs 384 笔/天，单仓由 3~83 笔成交拼成）。本次仅做**零成本正名**，不动判定逻辑、不加接口。

### 变更

- **`evaluate.mjs`**：`nTrades` 注释正名为"已平仓位数（非成交笔数）"；`classifyTradeEligibility` 加注滚仓型（持仓不平、仓位数少）可能因 `nTrades<8` 被误杀，指向 docs 盲区记录。判定门槛（`minTrades=20`/`lowFreq=8`）零改动。
- **`output.mjs`**：md 报告展示文案正名——"近90D笔数"→"已平仓位数"、"近90D净额"→"已实现净额"（对齐全历史含义）；`profileType` 加注分档基于仓位数而非成交频率。
- **`docs/api-confidence/sodex.md`**：第六节补充仓位生命周期、两接口（positions 平仓历史 / state 活跃仓位 `cr`）分工、完整已实现利润公式，及**处置决定表**。

### 不做（边界，已记录为盲区）

- **滚仓型资格误杀 / 评估不可靠**：彻底解需 trades 逐笔回放（盈亏质量必须基于已结束交易，活跃仓位 `cr` 无逐笔结构无法算 PF/胜率），该方案请求暴增（cursor 全量 ~17 次/账号）+ funding 回放风险，且滚仓型未在样本观测到，必要性未证明——暂不实现，等观测到真实样本再评估。
- 不采用"低频候选查 trades 让其过资格"折中：过资格但 PF/胜率仍基于极少仓位、统计不可靠，半截子补丁。

### 验证

- `node --test` 1/1 全绿；`node --check` 通过；`/k:check` 三闸门（subagent + 主 review + verify.sh）一致 PASS。

---

## sodex-discovery 去污染字段 + 去截断 + 503 容错 — 2026-06-23

修复粗筛/评估误用 `overview` 受污染字段，导致真盈利账户被误杀的链路问题。证据：账户 2566 近30天逐笔真账本 +$3072、全历史 +$19216，但 `overview.perps_closed_pnl_usd(30D)` 记 −$6129（混入充提/资金费），filter 据此把它在第一关淘汰。

### 变更

- **`filter.mjs`**：删除 `perps_closed_pnl_usd` 盈利门槛与 perps 主导判定（该字段实测污染）；粗筛只保留实测可信的 `volume` 门槛。盈利/合约主导判定下沉到 evaluate 用 positions 逐笔真账本。
- **`evaluate.mjs`**：`perpsPnl` 改取 positions 逐笔净额 `pm.netProfit`（权威），不再读 `overview.perps_closed_pnl_usd`；antiAirdrop 同步基于逐笔净额。
- **`main.mjs`**：`positionsLimit` 200 → 1000。原 200 会截断长历史账户（实测 ETH/PLTR 318 条、MW 445 条），致 `activeSpan/netProfit/maxDD/RF` 失真；实测单账户最多 445 条(~220KB)，1000 覆盖全历史且内存安全（契合 1G 服务器）。删除已无引用的 `FIXED.perpsMustDominate`。
- **`api/index.mjs`**：重试集合纳入 `503`。overview 接口高频偶发 503（同账户时好时坏），原仅 429/409 重试，致 filter 把接口抖动误判为不合格——实测 25 候选 22 个被 503 误杀（88%）。

### 验证

- `node --test` 1/1 全绿；6 文件 `node --check` 通过。
- 端到端 `--dry-run --limit=25` 实测：修复前 filter 幸存 3（22 淘汰中绝大多数为 503 误杀）→ 修复后幸存 20、淘汰 5；XAut 账户 192916 由"被误杀"恢复为推荐 #1（评分 94.2，合约盈利走逐笔真账本 $51,005、最大单笔 $42,703、活跃跨度 49 天）。

### 不做（边界，需后续校准，不猜测）

- **开仓名义 / 单笔盈利维度**：实测能区分重仓方向性（2566/XAut 中位开仓 $72k/$372k）与小额高频（MW $1.5k），有跟单参考价值；但门槛阈值需数据校准，本次不拍脑袋落地。
- **evaluate 流式化**：当前 `pages=2` 候选 ~100、单账户 ≤220KB，无 OOM 证据，暂不改造（仅在调大 pages 时需注意）。

## HYPE-watch 账户保证金展示 — 2026-06-23

从 `clearinghouseState.marginSummary` 提取 per-position 保证金，TG 和 console 两端同步展示。

### 变更

- **`watcher.mjs`**：保存 `marginSummary` + `withdrawable`，传入 render 函数。
- **`render.mjs`**：每仓位"保证金模式"改为"保证金 $XXX (Cross/Isolated)"，`buildTgMessage` 和 `renderPositions` 同步。

### 验证

- `node --test` 70/70 全绿。

---

## discovery TG 报告文件上传 — 2026-06-23

两个 discovery 模块 TG 推送新增 `.md` 报告文件上传——点击即可下载到本地（Telegram `sendDocument`，永久有效）。

### 新增

- **`sendTelegramDocument`**（两个 `output.mjs`）：`readFileSync` + `Blob` + `FormData` → POST `sendDocument`，8s 超时，失败不阻断。
- TG 文本消息尾部改为 `📄 完整报告见附件`（原为不可点击的文件名引用）。

### 变更

- `sodex-discovery/process/output.mjs` + `HYPE-discovery/process/output.mjs`：两 venue 对称新增 `sendTelegramDocument`，`--no-push` / `--dry-run` 自然跳过。
- `buildTgMessage` 签名移除死参数 `mdFileName`（文案改为固定"见附件"后不再需要）。
- `output.test.mjs`：测试断言同步 + 移除 `mdFileName` 变量。

### 验证

- `node --test` 10/10 全绿（HYPE-discovery 9 + sodex-discovery output 1）。

---

## Phase 4：START WATCH 门控（仅新增地址推送）— 2026-06-23

修掉 watch 每次部署对所有地址重推 `👀 START WATCH` 的噪音——只对 config 相比上次**新增**的地址推。

### 新增

- **`tool/seenAddresses.mjs`**：`loadSeenAddresses`/`computeNewAddresses`/`saveSeen` 纯函数门控，sodex-watch 与 HYPE-watch **共用**（+ 5 项单测）。
- 状态文件 `{sodex,HYPE}-watch/.seen-addresses.json`（gitignore）：记录已通知过 START 的地址集合，跨部署比对；启动时并集落盘。

### 变更

- `sodex-watch/main.mjs` + `HYPE-watch/main.mjs`（多地址路径）：启动 load seen → computeNewAddresses → saveSeen，把 `isNew` 传入各 watcher。
- 两 watcher 首帧 `kind==="START"` 时**仅 `isNew` 推 TG**（console banner 照常）；`isNew` 缺省 true → **单地址 CLI 模式不门控**。
- **强制重推**：删 `.seen-addresses.json` 后下次启动全部地址重新推 START。

### 验证

- `node --test` 全绿（新增 tool 门控 5 项）。
- 实测：seen 文件含 X、Y，config=[X,Y,Z] → 仅 Z 推 START，X/Y 日志"已知地址，跳过"；删文件 → 全部重推。

---

## HYPE Phase 1-3：监听 + 排行发现 + systemd 编排 — 2026-06-23

为 Hyperliquid（HYPE）扩展监听 + 排行发现，与 Sodex 平行对称（spec-set `.claude/kit/spec/hype-watch-discovery/`）。

### 新增

- **`HYPE-watch/`**：HYPE 账号 WS 监听（聚焦频道 clearinghouseState/openOrders/userFills/orderUpdates，ping=`{method:ping}`）+ 每日镜像 + TG。归一模型（szi 带符号方向、mark=positionValue/|size| 反推、roe 直给）；平仓按 **oid 聚合**；**离场单变化提醒**（PLACE/MODIFY/CANCEL，MODIFY 仅认价格变，撤销/成交消歧）；无持仓不推；仅多地址 `--config`。
- **`HYPE-discovery/`**：leaderboard 粗筛（pnl/vlm 门槛，不用 roi）+ 排除已监听 + 落盘/TG。**流式逐行解析**（`createRowScanner` + `streamLeaderboardRows`，不缓存 32MB 全文，内联门槛）——峰值 **264MB→98MB**；topK 截断显式记日志（不静默）。
- **app systemd 扩展**：`buildUnits` 增 `HYPE-watch.service` + `HYPE-discovery.{service,timer}`（共 6 单元）；config 增 `hypeWatch`/`hypeDiscovery` 键（`watch`/`discovery` 仍控 sodex）；两 discovery **默认错峰**（sodex 9 点 / HYPE 10 点），相同 OnCalendar 时 render/apply/status 告警。

### 变更

- `setup/{Makefile,setup-systemd.sh}` 增 HYPE sync-config/logs/status；`docs/{systemd-setup,deploy-commands}` 四服务化；`.gitignore` 忽略 HYPE config/log。

### 验证

- `node --test` 60 项全绿（sodex + HYPE-watch 11 + HYPE-discovery 9）。
- HYPE-watch 真实地址实测：有仓渲染（HYPE 3x LONG / mark 反推 / ROE）、空仓"无持仓"、TG 留空不报错。
- HYPE-discovery dry-run 实测：39288 行 → 排除 2 已监听 → 粗筛 20，峰值 98MB（`/usr/bin/time -l`）。
- `app render` 6 单元正确、错峰告警生效。

### 已知限制 / 后续

- 流式 scanner 一版曾因跨 push 状态残留重复计花括号 → 峰值反升 546MB，已修（spec 03 记 Pitfall）。
- HYPE roi 受充提污染未实证；逐笔深度评估、`orderUpdates` 实时化离场提醒留第二步。

---

## service 多交易所重构 Phase 0：Sodex 重命名 — 2026-06-22

为扩展 Hyperliquid（HYPE）监听 + 排行发现，把 `service/` 重构成「按交易所对称」布局。Phase 0 先重命名 Sodex 模块，逻辑零变更（详见 spec-set `.claude/kit/spec/hype-watch-discovery/`）。

### 变更

- **目录重命名**：`service/watch/` → `service/sodex-watch/`、`service/discovery/` → `service/sodex-discovery/`（`git mv` 整树改名，相对 import 不变）。
- **systemd 单元改名**：`watch.service`→`sodex-watch.service`、`discovery.service`→`sodex-discovery.service`、`discovery.timer`→`sodex-discovery.timer`。`app/index.mjs` 的 ExecStart 路径、buildUnits 单元名、status 探测同步。
- **迁移链泛化**：`OLD_WATCH_UNIT` 单值改为 `LEGACY_UNITS` 数组（`watch-account.service` / `watch.service` / `discovery.service` / `discovery.timer`），`apply` 时逐个 disable+删除，防新旧单元双开。
- **涟漪同步**：`setup/{Makefile,setup-systemd.sh}`、`.gitignore`、docs（systemd-setup/deploy-commands/watch-account-plan/discover-traders-plan/query-account）路径与单元名全部更新。
- **暂不改 config 键**：`app/config.json` 的 `watch`/`discovery` 键名保留，留 Phase 3 加 HYPE 键时统一重构 schema。

### 验证

- `node service/app/index.mjs render` 三单元名均为 sodex-*，ExecStart 指向 sodex-watch/sodex-discovery，迁移动作含旧单元。
- `node --test` 41/41 不退化。

---

## discovery TG 消息钱包地址完整展示 + VPS 首次部署 — 2026-06-21

### 变更

- **TG 消息地址完整展示**：`output.mjs` 删除 `shortAddr()` 截断函数，`📡` 行展示完整钱包地址（`0x32649e956cda9b18acae74193d5839097f6144e5` 而非 `0x3264…44e5`），避免跟单地址信息丢失。
- **VPS 首次部署**：`racknerd-25e541f`（107.172.90.184）完成新结构部署。从旧 `~/watch-account/`（扁平 `script/`）迁移到 `~/service/`（分层 `service/app/` + `watch/` + `discovery/` + `lib/WARP/` + `tool/`）。`app apply` 自动迁移旧 `watch-account.service` → 新 `watch.service` + `discovery.timer`。discovery 首次运行产出 163 候选 → 7 推荐。
- **Makefile 新增 `pull-logs`**：一键下载 discovery 日志到本地 `service/discovery/log/`。

### 验证

- `output.test.mjs` 7/7 全通过，TG 消息地址已完整不含 `…` 截断。
- `node --check` 通过；`app status` 两服务 active。
- 旧 `watch-account.service` 已 disable+删除，无残留。

---

## discovery TG 消息格式优化 — 2026-06-20

通知消息标题与日期分行 + 移除紧凑单行格式（第 6 起不展示）。

### 变更

- **标题与日期分行**：第一行 `🔭 跟单候选发现`（纯标题），第二行 `⌚ YYYY-MM-DD`（时间带 emoji），避免日期干扰标题语义。
- **移除紧凑单行**：TG 仅展示前 5 名详展卡片，删掉 `#N addr · score · PFx.xx xx%` 紧凑格式（`DETAIL_CARDS` 从"分界线"改为"截断线"）。手机端窄屏下紧凑行与上一条卡片无视觉分隔，易混淆。

### 验证

- 示例数据构建 TG 消息，`node service/discovery/process/output.test.mjs` 全 7 项检查通过，未真实推送。

---

## 定时镜像无持仓不推 TG + formatDisplayId 测试对齐 — 2026-06-20

定时/镜像快照当前无持仓时不再推送 Telegram（仅 console 留痕）；顺带修掉既有 formatDisplayId 测试失败。

### 变更

- **镜像快照无持仓跳过 TG**：`watch/process/snapshot.mjs` 纯快照模式当前无持仓（`positions.some(size!==0)` 为假）时早返回，不推 TG；`watch/process/watcher.mjs` 每日定时镜像（`kind === "SNAPSHOT"`）同理跳过，**事件驱动的开/平仓提醒不受影响**仍照常推送。
- **formatDisplayId 测试对齐**：保留实现的 `】 🎯 label` 空格格式（更易读），把注释示例与 `tool/format.test.mjs` 预期同步为带空格，修掉历史遗留的 1 个 fail。

### 验证

- `node --test` 41/41 全绿（消除既有 formatDisplayId fail）。
- 本地实测 `0x8d56…7480`（当前无持仓）：snapshot 模式正确输出 `镜像快照：当前无持仓，跳过 Telegram 推送`，console 仍完整渲染仓位/平仓历史。

---

## app 编排层 + 统一代理 + service 改名 — 2026-06-20

集中编排两个服务（watch / discovery）+ 统一 WARP 代理 + discovery 可配调度；顶层 `script/` 改名 `service/`。

### 新增

- **`service/app/`（编排层）**：`config.json`（开关 + discovery 调度，gitignore）+ `config.example.jsonc`（注释枚举全部取值）+ `index.mjs`（`render`/`apply`/`status`）。按 config 生成 systemd 单元 `watch.service` + `discovery.service`(oneshot) + `discovery.timer`（OnCalendar 带 `Asia/Shanghai` + `Persistent=true`）。两个独立单元 = **进程隔离**；单 config + CLI = **集中管理**。`apply` 幂等（仅 unit 内容变才 restart，不误重启 watch）+ 自动迁移旧 `watch-account.service`。
- **`service/lib/WARP/`（统一代理）**：`installFetchProxy`(undici) + `installWsProxy`(ws)。**修复 discovery 无代理 bug**（VPS 走 WARP 不再裸连/泄漏 IP）+ 去重 watch 的 fetch/WS 代理。
- **discovery 可配调度**：`app/config.json` 的 `discovery.schedule`——`freq`(weekly/monthly/daily) + `day`（weekly 用 cron 0-6：0=周日..6=周六；monthly 1-28）+ `hour`(0-23，Asia/Shanghai)。

### 变更

- **目录改名 `script/` → `service/`**（整树改名，相对 import 不变）；VPS 部署根 `/root/watch-account` → `/root/service`；单元名 `watch-account.service` → `watch.service`（apply 自动迁移）。`setup/{setup-systemd.sh,Makefile}` + `docs` + `.gitignore` 同步。
- discovery/watch 改用 `lib/WARP`（discovery/api、watch/api、watch/watcher）。

### discovery 算法 v2（同期）

弃 `chart`（实测 pnl_usd 是累计曲线非单日，致 Sharpe/maxDD 全错）/ 日级 `Sharpe`（稀疏离散低信号）/ `maxDD/总盈利`比（分母趋零爆炸）；改 **positions 逐笔真账本** + **Recovery Factor**（净盈利/maxDD，永不爆炸）；freshness 改用 positions 近 7 天逐笔实现（overview 短窗是快照口径，与榜单误导同源）。

### 验证

- `node --check` 全过；`node --test` 基线 40/41（1 既有 formatDisplayId fail）。
- 本地实测：`app render` 三单元正确（OnCalendar 含 Asia/Shanghai）；discovery 前 5 名 + watch snapshot（0x8d56…）行为正常、不推 TG；day 0-6 → OnCalendar 三种正确。

---

## watch 结构重组 — 2026-06-20

把根目录单体脚本按「层」重组到 `script/watch/`，并抽全局共享格式化层 `script/tool/`（纯结构迁移，行为零变更）。

### 变更

- **抽 `script/tool/format.mjs`**：数字/千分位/去尾零/USD/百分比/时间格式化 + 地址(shortAddress/formatDisplayId/isAddress)/HH:MM(isValidHHMM/pickAt) 校验，供 watch/discovery/query 共享。
- **`watch-account.mjs`(1090 行) 按层拆**：`watch/main.mjs`(入口) + `watch/api/index.mjs`(REST IO+共享限流+TG+符号缓存) + `watch/process/{parse(归一+diff), render(渲染), watcher(AccountWatcher+WS), snapshot(SnapshotMode), config(loadConfig)}.mjs`。WS polyfill 留在 watcher（保 query 不依赖 ws）；共享限流状态经 ES module live binding 跨模块引用。
- **`query-account.mjs` → `watch/query.mjs`**：复用 `api/index.mjs` 的 httpGetJson/resolveAccountIdViaChain 与 `tool/format` 的 isAddress，删内部重复实现。
- **`watch.config.json` → `watch/config.json`**（gitignore 路径同步）。
- **测试**：原 `format.test.mjs` 按被测模块拆为 `tool/format.test.mjs`(format/校验) + `watch/test/domain.test.mjs`(parse/render)。

### 验证

- `node --check` 全 9 个 .mjs 通过；`node --test` 基线不退化（40 pass / 1 既有 formatDisplayId fail，原样保留）。
- watch --snapshot / query 行为与迁移前一致（纯结构迁移）。

---

## discovery v1 — 2026-06-20

新增跟单候选发现系统 `script/discovery/`（五阶段管线：collect→filter→evaluate→score→output）。

### 新增

- **五阶段纯函数管线 + 零依赖**（Node18 fetch）：`main.mjs` + `api/index.mjs` + `process/{collect,filter,evaluate,score,output}.mjs` + `config.json`。漏斗 ~150→~30→十几→topK，只覆盖榜单前 100 名。
- **api/index.mjs 接口收口**：4 个 HTTP（leaderboard/overview/chart/positions，JSDoc 契约）+ WS 声明 + 自带轻量限流（并发≤4 + 间隔 + 429/409 退避）+ 大整数安全解析。
- **D1-D4**：positions 带 `limit=200`；弃 tradeRatio 用 perps 绝对额；双通道门槛（中频≥20 或 低频≥8&PF≥3&win≥70%）；不用 ROI。
- **输出**：`log/discovery-YYYY-MM-DD-HHmm.{json,md}` + TG 推送（前5详展/第6起紧凑）；只读 watch.config 排除已监听，**绝不写**；topK 是上限不凑数；0 通过照常出文件。
- CLI：`--dry-run`（仅 stdout）/`--no-push`（落盘不推 TG）/`--limit=N`/`--top`/`--pages`/`--config`。

### 算法 v2 根因修正（dry-run 实测后）

- **D5 chart 弃用**：`chart.pnl_usd` 实测是累计曲线非单日，evaluate 全部逐笔指标改用 positions 真账本。
- **D6 freshness 改 positions**：overview 短窗是净值快照口径（混转入/提现，与榜单 pnl 误导同源），改用 positions 近 7 天逐笔实现（`<0`=正在亏淘汰，`=0` 休眠放行）。
- **D7 弃 Sharpe/ddRatio，用 Recovery Factor**：日级 Sharpe 低信号、`maxDD/总盈利` 分母趋零爆炸（D2 同病）；统一用 `RF=净盈利/maxDD`（永不爆炸）。preset 矩阵随之重校准。
- 新增 `maxWin/maxLoss` 仅展示（RF 已数学兜住单笔尾部，不设门槛）。

### 验证

- `node --check` 全 7 文件通过；`node --test` 基线 40/41（1 个 format.test 为既有失败，未触碰）。
- 真实地址校验：3602(中频)/192916(低频) 通过；17139(合约亏)/204502(单日集中) 淘汰。
- dry-run 收敛 162→42→7，0 落盘/0 推送验证 dry-run 与 --no-push。

---

## watch-account v2.1 — 2026-06-20

通知样式优化（手机 TG 防折行 + emoji 标识）+ displayId 改地址 + 每地址镜像时刻。

### 变更

- **displayId 改用地址**：banner 头默认 `【短地址】`（前 4 位含 `0x` + `...` + 后 4，如 `【0x58...7027】`）；config 项有 `label` 时用 🎯 追加（如 `【0x58...7027】🎯 xiao`），不再显示交易所内部 accountId。新增 `shortAddress()` / `formatDisplayId()` 工具。
- **通知防折行 + emoji**（手机 TG 窄屏）：仓位卡片隔断线缩为原宽 50%（8 段）；banner 头分**三行**（👀🟢🔴📈📉📸🔄 动作 / 🕐 时间 / 📡 身份+🎯label），离场单 🏹 同步三行；平仓历史时间精简为 `MM/DD HH:mm` 挪到行尾、`已实现盈亏→盈亏`、**数量单独成行 `数量：N`**（开仓→平仓行不再被数量挤折）。

### 新增

- **每地址独立每日镜像时刻 `at`**：config 项可选 `at`（`HH:MM`），每地址各自触发 SNAPSHOT 可错峰；优先级 地址项 `at` > 全局 `--at` > 默认 `20:00`，非法值告警回退。

### 验证

- `node --check` 通过；`node --test` 41/41 全绿（v2.0 基础上新增 at / fmtTimeShort / formatDisplayId 测试）。

---

## v2.0 — 2026-06-20

多地址 + 平仓历史 + 离场挂单前瞻 + banner 去重。围绕"跟/盯某交易者、预判其操作"的增强。

### 新增

- **多地址监听**：`--config=script/watch.config.json`，一进程同时盯多个地址，各自独立 WS（物理隔离）+ 独立 Telegram 会话（全局 `tgToken` + 每地址 `tgChat`，地址项可选 `tgToken` 覆盖）。
- **离场挂单（reduceOnly）前瞻**：仓位卡片末尾显示该仓的止盈/止损出场计划 `离场挂单 {止盈|止损} @ 价 (全平/部分 量)`；挂/改/撤离场单另发独立轻提醒。这是唯一的前瞻信号。
- **`label` 别名**：config 项可选 `label` 给地址起别名，banner 头显示（具体格式见 v2.1）。
- **模块级共享限流**：所有地址 REST 走同一闸，一处 429/409 全员退避；冷却结束唤醒**全部** watcher（防其余地址漏报冷却期内变化）。
- **内存限容**：长跑去重集合超阈值用当前数据重建，防泄漏。

### 变更

- **平仓历史替换成交历史**：原逐笔成交（trades）+ 客户端回放估算 Realized PnL → 改用 `perps/positions` 的**权威** `realized_pnl` / 资金费 / 均价（更准，直接表达"这个仓位平掉赚了多少"）。客户端按 `updated_at` 降序取最近 N（接口按 position_id 返回，非平仓时间）。
- **banner 去重**：删掉与仓位卡片重复的 `OPENED/CLOSED…` 明细行，banner = 头部（动词由头部表达、币/量/价由仓位卡片表达、平仓由「平仓历史」表达）。通知样式的进一步防折行优化见 v2.1。
- **★ 新记录改键**：从成交 `trade_id` 换为平仓 `position_id`，沿用首帧基线不标、之后标新的机制。

### 删除

- `fetchTradesNext` / `fetchTradesWeb` / `computeRealizedPnl` / `renderTrades` / `--all` 翻页 / `--enable-web-fallback`（trades 备路）。

### 不做（边界）

- 开仓挂单（`R:false`）监听（churn 噪声）；单 WS 多路复用（≤10 地址无收益）；多地址快照（`--config` 与 `--snapshot` 互斥）；部分减仓的即时权威 PnL（接口只返已平仓 size=0）。

### 兼容性

- 保留单地址 CLI：`node script/watch-account.mjs 0xAddr` 行为不变。
- 配置文件含 TG 凭据 → `.gitignore`，仅服务器本地存在。
- 依赖 `ws` 包（`npm install ws`）；代理(WARP)另需 `undici` + `https-proxy-agent`。

### 验证

- `node --test`（script/）32/32 全绿（原 20 + 新增 12）；`node --check` 通过。
- 真实地址 `0x5847…7027`（accountId 3602）端到端实测：平仓历史权威盈亏、离场挂单 TP/SL、G3 排序、G4 数字枚举映射均正确。

---

## v1.1 — 2026-06-19

- 项目结构重组为 `script/` `docs/` `setup/` 目录（commit a24138c）。
- 消息格式化：统一 `fmtNum/fmtUsd/fmtPct/fmtTime`，千分位 + 去尾零 + 北京时间 `YYYY/MM/DD HH:mm:ss`；动词化 banner（commit d977386）。

## v1.0 — 2026-06-18

- 初版：单地址实时 WS 监听 perps 账户，REST 拉成交历史 + 客户端回放估算 Realized PnL。
- 指纹去重 + 防抖合并 + 限流退避 + 失败兜底（per-instance）。
- `--snapshot` 快照模式（按需 + 每日定时）；Telegram 推送；零鉴权（实测验证）（commit c6c43d6 / 013aa20）。
