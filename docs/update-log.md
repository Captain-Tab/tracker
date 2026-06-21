# 更新日志（tracker）

`service/`（perps 账户监听 watch + 跟单候选发现 discovery + 编排 app + 基建 lib + 共享 tool）的版本变更记录。最新在上。

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
