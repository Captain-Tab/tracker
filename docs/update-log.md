# 更新日志（watch-account）

`script/watch-account.mjs`（perps 账户监听）的版本变更记录。最新在上。

---

## v2.0 — 2026-06-20

多地址 + 平仓历史 + 离场挂单前瞻 + banner 去重。围绕"跟/盯某交易者、预判其操作"的增强。

### 新增

- **多地址监听**：`--config=script/watch.config.json`，一进程同时盯多个地址，各自独立 WS（物理隔离）+ 独立 Telegram 会话（全局 `tgToken` + 每地址 `tgChat`，地址项可选 `tgToken` 覆盖）。
- **离场挂单（reduceOnly）前瞻**：仓位卡片末尾显示该仓的止盈/止损出场计划 `离场挂单 {止盈|止损} @ 价 (全平/部分 量)`；挂/改/撤离场单另发独立轻提醒。这是唯一的前瞻信号。
- **`label` 别名**：config 项可选 `label`，banner 头从 `【accountId】` 变为 `【accountId-label】`（如 `【1046-xiao】`）。
- **每地址独立每日镜像时刻 `at`**：config 项可选 `at`（`HH:MM`），每地址各自触发 SNAPSHOT 可错峰；优先级 地址项 `at` > 全局 `--at` > 默认 `20:00`，非法值告警回退。
- **模块级共享限流**：所有地址 REST 走同一闸，一处 429/409 全员退避；冷却结束唤醒**全部** watcher（防其余地址漏报冷却期内变化）。
- **内存限容**：长跑去重集合超阈值用当前数据重建，防泄漏。

### 变更

- **平仓历史替换成交历史**：原逐笔成交（trades）+ 客户端回放估算 Realized PnL → 改用 `perps/positions` 的**权威** `realized_pnl` / 资金费 / 均价（更准，直接表达"这个仓位平掉赚了多少"）。客户端按 `updated_at` 降序取最近 N（接口按 position_id 返回，非平仓时间）。
- **banner 去重**：删掉与仓位卡片重复的 `OPENED/CLOSED…` 明细行，banner = 头部一行（动词由头部表达、币/量/价由仓位卡片表达、平仓由「平仓历史」表达）。
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
