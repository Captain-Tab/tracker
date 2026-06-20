# 跟单候选发现系统：五阶段管线 + preset 配置 + 结果产出

**创建日期**: 2026-06-20 | **复杂度**: medium（脚本评定）| **状态**: 草稿 | **分支**: dev

> 功能 spec。目标文件：新增 `script/discovery/main.mjs` + `script/discovery/api/index.mjs` + `script/discovery/process/{collect,filter,evaluate,score,output}.mjs` + `script/discovery/config.json` + `script/discovery/log/`；同步 `docs/discover-traders-plan.md`、`docs/update-log.md`。方案文档：`docs/discover-traders-plan.md`。

## 实现者须知（新会话先读，避免踩坑）

> 本 spec 经多轮澄清 + 真实接口实测 + 正样本反向验证（双画像/组合门槛/ROI 砍除/limit 分页）。以下是实测得来、不读会踩的关键约束：

1. **目录/命令**：代码在 `script/discovery/` 子目录。语法 `node --check script/discovery/main.mjs`；测试 `cd script && node --test`（沿用现有 `node --test` 基线，**先跑通再改**）。
2. **零依赖**：Node 18+ 内置 fetch，无 SDK、无鉴权（全链路 public，同 `query-account.mjs`）。
3. **最易踩的 4 个坑（务必照 spec，别凭直觉）**：
   - **D1 positions 分页**：`/api/v1/perps/positions` **默认只返 40 条**，必须带 `&limit=N`（实测 `limit=100`→100 条；`page`/`size`/`offset` **全部无效**）。逐笔指标（盈亏比/胜率）不带 limit 会因截断失真。
   - **D2 弃用 tradeRatio**：**禁止**用 `trade_pnl/total_pnl` 做门槛——实测 `total_pnl≈0` 或为负时爆炸（221%、−334% 误杀真高手）。改用 `perps_closed_pnl_usd` 绝对额 + perps 主导判定。
   - **D3 双通道门槛**：**禁止**写死 `minTrades≥20` 单条——会误杀低频精准高手（实测 rank1 的 192916 仅 14 笔、rank3 的 204502 仅 12 笔，盈亏比 3.55/5.55 是顶级）。须中频路 `≥20` **或** 低频路 `≥8 且 PF≥3 且 win≥70%`。
   - **D4 ROI 不用**：`roi` 分母不稳定（微账户虚高），不作门槛/排序，仅在 antiAirdrop 里做辅助信号。
4. **不要凭记忆改 API 字段**；用真实 account_id 验证：`3602`(中频)、`204502`(低频,PF5.55)、`17139`(合约亏,反例)、`192916`(近期波动)。

> **⚠️ D5-D7：dry-run 实测后的算法根因修正（v2，权威，覆盖下方旧描述）**
>
> - **D5 chart 是累计曲线，不是单日**：`chart[].pnl_usd` 实测为累计 PnL 曲线（末点 == overview 同窗 total_pnl），直接当单日值算会让 Sharpe/maxDD/maxDayShare 全错。**evaluate 已弃用 chart**，所有逐笔指标改用 positions。
> - **D6 overview 短窗是快照口径(deposit-accounting)，不可信于 ≤30D**：`overview.perps_closed_pnl_usd` 短窗与 positions 真账本对不上（实测 192916 overview7D=−39805 实为提现误记，真账本近期两笔全盈利；长窗 90D 两者吻合）。这与 §1.1 要消灭的「榜单 pnl 误导」同源。**filter 仍用 overview 30D 做便宜初筛(D2)，但 evaluate 的逐笔指标与 freshness 一律用 positions 真账本**。
> - **D7 日级 Sharpe 是低信号工具 + ddRatio 是 D2 同病**：稀疏离散交易日 Sharpe 噪声大（真实值挤在 0.03~0.31，旧门槛 0.5 是 cumulative-bug 虚高值的产物）；`maxDD/总盈利` 分母趋零爆炸（实测 28.56/∞），与 D2 拒用 tradeRatio 同因。**已弃 Sharpe（门槛+打分维），改用 Recovery Factor `RF=净盈利/maxDD`**（maxDD→0 即满分，永不爆炸）承担风险调整。
>
> 单笔尾部风险（maxLoss）**只展示不设门槛**：RF≥1 已数学兜住（maxLoss≤maxDD≤净盈利 → 爆仓比≤1/RF≤1），加门槛冗余。
5. **隐私**：`config.json` 含 TG 凭据 → 进 `.gitignore`；`log/` 含被观察地址 → 也进 `.gitignore`。
6. **流程**：脚本评定 medium → `/k:plan` 规划 → `/k:task` 实现 → `/k:check` 验收。

## 背景与目的

排行榜 `pnl_usd` ≈ **账户净值 − 净入金**，混入空投/转入/现货浮盈/Vault，**不等于交易技能**（实测 7D 榜前 10 仅 1 个真合约盈利、榜2 合约亏 4 万）。本系统把"PNL 榜"转换成"可跟单交易者榜"：周期性（每周）从公开榜筛出值得**合约跟单**的 top-K 地址，产物喂给 `watch-account.mjs` 实时监听。

动机：现有 `watch.config.json` 的跟单地址靠人工发现，本系统自动化"发现"环节，补全 **发现 → 监听 → 核查** 闭环。

## 选定方案

**方案 A：五阶段纯函数管线，每阶段一文件，入口编排。**

| 方案 | 思路 | 优点 | 缺点 | 选否 |
|---|---|---|---|---|
| **A（选定）** | `main.mjs` 编排 `collect/filter/evaluate/score/output` 五个纯函数文件 | 阶段解耦、可单测、`--dry-run` 任一阶段截断；分层粗筛省请求 | 文件多 | ✅ |
| B | 单文件全流程 | 文件少 | 难测、难调参、阶段耦合 | ✗ |

**分层省请求**（核心工程决策）：①采集用便宜的 leaderboard（~4 请求拿 ~150 候选），②筛选每候选只打 1 个 overview 砍到 ~30，③评估才对幸存者打贵接口 chart+positions（~60）。总 ~215 请求，只覆盖榜单前 100 名（`pages×50`/窗）。

## 设计概要

### 1. 配置文件（`script/discovery/config.json`，gitignore）

```jsonc
{
  "sampling": { "windows": ["7D","30D"], "pages": 2 },
  "riskPreset": "balanced",
  "style": "any",
  "gates": { "minPerpsPnl": 200, "minVolume": 50000, "minActiveDays": 15, "minTrades": 20 },
  "qualityFilters": true,
  "topK": 10,
  "output": { "tgChat": "-5570447525", "tgToken": "可选,默认复用 watch" }  // 仅推送目标，不写 watch.config
  // 高级可选: "weights": {...}, "lowFreqException": {...}, "persistWindows": ["7D","30D"]
}
```

**类型约定**：`windows` array<enum⊂{24H,7D,30D,ALL_TIME}>；`pages` number(1..10)；`riskPreset`/`style`/`output.mode` string enum；`gates.*` number(USD/天/整数)；`qualityFilters` boolean；`topK` number(≥1)。

**固定参数（硬编码，不读 config）**：`sortBy="pnl"`、`lookbackDays=90`、`positionsLimit=200`、`poolMax=1000`、`perpsMustDominate=true`、`concurrency=4`、`httpTimeoutMs=10000`。

### 2. riskPreset 展开映射（`main.mjs` 加载时把字符串展开为数值）

> v2：风险调整由 Recovery Factor 承担，已弃 `maxDrawdownRatio`(不稳定) 与 `minSharpe`(低信号)，见 D7。

| 展开字段 | conservative | balanced | aggressive |
|---|---|---|---|
| `minProfitFactor` | 2.0 | 1.5 | 1.2 |
| `minRecoveryFactor` | 2.0 | 1.0 | 0.7 |
| `maxDayShare` | 0.50 | 0.70 | 0.90 |
| `w.profitFactor` | 35 | 30 | 25 |
| `w.recoveryFactor` | 30 | 25 | 15 |
| `w.winRate` | 10 | 20 | 25 |
| `w.persist` | 15 | 15 | 20 |
| `w.volume` | 10 | 10 | 15 |

`config.weights` 非空时覆盖该 preset 的权重列；其余门槛字段同理可被高级字段覆盖。

### 3. ① 采集 `collect.mjs`

- `collect(config, excludeAddresses:Set) → candidates[]`：对 `windows × ["pnl"] × [1..pages]` 拉 `GET /api/v1/leaderboard?window_type=W&sort_by=pnl&sort_order=desc&page=P&page_size=50`。
- 并集去重（按 `account_id`，记录命中的 windows 集合供跨窗持续性用）。
- **排除已监听地址（防重复筛选）**：`main.mjs` 启动时读 `script/watch.config.json` 的 `watches[].address`，小写归一成 `excludeAddresses` 传入；候选 `walletAddress`（小写）命中即剔除——discovery 只发现**新**地址，不重复评估已在监听的。watch.config 缺失/解析失败 → 空集，不阻断。
- 截断到 `poolMax`。返回 `{ accountId, walletAddress, hitWindows:Set, lbPnl, lbVolume, rank }[]`。

### 4. ② 筛选 `filter.mjs`

- `filter(candidates, config) → survivors[]`：每候选打 1 个 `GET /api/v1/wallet/portfolio/overview?account_id=N&window=30D`。
- **粗筛门槛**（便宜、绝对额）：`perps_closed_pnl_usd > minPerpsPnl` **且** perps 主导（`perps_closed >= |spot_pnl|`）**且** `volume_usd >= minVolume`。
- 命中即保留，附 overview 数据下传。砍掉 ~90%。

### 5. ③ 评估 `evaluate.mjs`

- `evaluate(survivors, config) → profiles[]`：对每个幸存者并发（`concurrency=4`）打：
  - `GET /api/v1/perps/positions?account_id=N&limit=200`（**D1：必须带 limit**）——**唯一数据源**，D5 已弃用 chart。
- 算派生指标（见下，全部基于 positions 真账本），再过**硬门槛**（一票否决）：
  - 基础：`activeSpanDays >= minActiveDays`（首末交易间隔，衡量持续记录，不惩罚低频）
  - **D3 交易资格双通道**：`nTrades >= minTrades` **OR** (`nTrades >= lowFreq.minTrades` && `profitFactor >= lowFreq.minPF` && `winRate >= lowFreq.minWin`)（默认低频 `{8, 3, 0.70}`）
  - preset 门槛：`profitFactor >= minProfitFactor` && **`recoveryFactor >= minRecoveryFactor`**（D7：RF 替代 maxDD比/Sharpe）&& `maxDayShare <= maxDayShare`
  - **qualityFilters**（默认开）：antiAirdrop(`net_deposit < 0 && perps_closed ≈ 0` 排除) / antiOneShot(`maxDayShare` 已含) / **freshness：positions 近 7 天逐笔实现 `freshNet >= 0`**（D6：用真账本不用 overview 快照；`<0`=正在亏才淘汰，`=0` 休眠放行，不误杀近期没出手的高手）
- 派生指标公式（全部 positions(size=0)；**D5 弃 chart、D6 弃 overview 短窗、D7 弃 sharpe**）：

| 指标 | 来源 | 公式 |
|---|---|---|
| `perpsPnl` | overview(30D) | `perps_closed_pnl_usd`（仅展示/filter 用，非 evaluate 门槛） |
| `nTrades` | positions(size=0) | 计数 |
| `winRate` | positions | `realized_pnl>0 数/nTrades` |
| `profitFactor` | positions | `Σ盈/\|Σ亏\|`（无亏→∞） |
| `netProfit` | positions | `Σ盈 − Σ亏` |
| `maxDD` | positions 累计 | 按 updated_at 升序累计实现曲线峰谷回落 |
| `recoveryFactor` | positions | `netProfit/maxDD`；maxDD→0 即 ∞（满分，永不爆炸） |
| `activeSpanDays` | positions | `(末笔 − 首笔 updated_at)/天` |
| `maxDayShare` | positions 按日聚合 | `max(单日实现)/Σ正单日` |
| `freshNet` | positions(近7D) | `Σ realized_pnl where updated_at≥now−7D` |
| `maxWin`/`maxLoss` | positions | 最大单笔盈利/亏损（**仅展示，不设门槛**，RF 已兜尾部风险） |
| `avgHoldMin` | positions | `mean((updated_at−created_at)/60000)` |

> **D2**：禁止用 `tradeRatio`。**大整数**：`account_id`/`position_id` 16+ 位转字符串（同 watch）。

### 6. ④ 打分 `score.mjs`

- `score(profiles, config) → ranked[]`：**5 维**归一×权重，`score=Σ`，降序取 `topK`。
- **`topK` 是上限非目标**：`ranked.slice(0, topK)`。合格者（过完所有硬门槛）不足 `topK` 时，输出就少于 `topK`——**不放宽门槛、不降低评分线、不凑数**。宁缺毋滥。
- 归一公式（clamp [0,1]；D7 已弃 sharpe 维、maxDD 维并入 recoveryFactor）：

| 维度 | 归一 |
|---|---|
| profitFactor | `clamp((pf−1)/2,0,1)`；∞→满分 |
| recoveryFactor | `clamp(RF/3,0,1)`；∞(无回撤)→满分 |
| winRate | 直接 |
| persist | `命中windows数/len(persistWindows)`；**persistWindows 固定=采集窗(默认7D+30D)，命中数直接取采集的 hitWindows，零额外请求**（不查 ALL_TIME） |
| volume | `clamp((log10(vol)−4.7)/2,0,1)` |

### 7. ⑤ 输出 `output.mjs`

- `output(ranked, allProfiles, config)`：**最终结果只产出文件 + TG 推送，绝不写 watch.config**。
  1. **结果文件**（目录 `script/discovery/log/`，本地时间戳）：
     - `discovery-YYYY-MM-DD-HHmm.json`：机读全量——`{ generatedAt, config, summary{scanned,candidates,excluded,passed,recommended}, recommended[](完整画像+score+profile+hitWindows), eliminated[]({accountId,stage,reason}) }`。
     - `discovery-YYYY-MM-DD-HHmm.md`：人读详情——比 TG 更全，每个推荐含 盈亏比/胜率/RF/合约盈利/成交量/最大回撤/最大单笔盈亏/平均持仓/笔数/活跃跨度/命中窗 + 末尾「淘汰摘要」。
  2. **TG 推送**：推到 `output.tgChat`（复用 watch bot）。**手机友好排版**（对齐 `watch-account-plan.md §九`「每项独占一行」，避免窄屏折行，用 `\n` 逐行短文本、非 Markdown 表格）：
     - 头部 4 行：标题+日期(北京 UTC+8) / 候选→通过→推荐 / 排除N个在监听·不足topK不凑。
     - **前 5 名详展卡片**：标题 `#N · 评分X · 画像类型` / `📡 短地址` / 盈亏比 / 胜率 / 合约盈利 / 成交量 / 命中窗（各占一行）。
     - **第 6 名起紧凑**：每人 1 行 `#N 0x..短址 · 评分 · PF胜率`。
     - 尾部：`📄 详情 discovery-YYYY-MM-DD-HHmm.md`（不含"写入 watch.config"字样）。
  3. **不写 watch.config**：是否纳入监听由人工看结果文件后**手动**编辑 `watch.config.json` 决定。output 不修改它。
  4. **0 通过不算失败**：合格者为 0 时仍算成功跑——照常生成结果文件（recommended 为空），TG 推一条「📭 本周无合格候选（候选N→通过0）」提示（确认脚本活着、非静默）。
- `--dry-run`：只 stdout 打印 md 详情，不落盘、不推 TG。

### 8. 入口 `main.mjs`

- 解析 CLI（仅 `--dry-run`、`--config=`、`--top=`、`--pages=`）。**门槛阈值统一走 config.json**，不提供 `--min-*` 扁平 flag（避免 flat→nested 映射歧义）。
- 读 config.json + 上述少量 CLI 覆盖 + 展开 riskPreset → 完整 effectiveConfig。
- 读 `script/watch.config.json` → `excludeAddresses`（已监听地址，小写归一）传给 `collect`（**只读不写**）。
- 串行 `collect → filter → evaluate → score → output`，各阶段 log 进度（候选数收敛、排除了几个已监听）。
- 错误兜底：单候选画像失败 → 跳过该候选不污染池；限流见 api/index.mjs（discovery 自带，不复用 watch）。

### 9. 接口声明 `api/index.mjs`（集中管理所有接口 + WS）

- 单一收口：所有 HTTP 接口与 WS 订阅的 baseURL / path / 请求参数 / 返回字段在此声明，其余阶段文件只 import 调用，不散落 URL。
- **每个导出函数用 JSDoc 注释**声明契约（`@param {type} name - 说明` + `@returns {type} - 返回字段说明`），文档即源码注释，不另建 md；下表为概览。
- **HTTP**（`BASE_DATA = https://mainnet-data.sodex.dev`）：

| 函数 | path | 请求参数 | 返回关键字段 |
|---|---|---|---|
| `fetchLeaderboard` | `/api/v1/leaderboard` | `window_type`(enum) · `sort_by=pnl` · `sort_order=desc` · `page` · `page_size`≤50 | `data.total` · `data.items[]{wallet_address,account_id,pnl_usd,volume_usd,rank}` |
| `fetchOverview` | `/api/v1/wallet/portfolio/overview` | `account_id` · `window`(7D/30D/90D/1Y) | `data{total_pnl_usd,perps_closed_pnl_usd,spot_pnl_usd,perps_unrealized_pnl_usd,volume_usd,net_deposit_usd,roi}` |
| `fetchChart` | `/api/v1/wallet/portfolio/chart` | `account_id` · `window` | `data.chart[]{ts_ms,pnl_usd(**累计曲线**),perps_pnl_usd,...}` ——**D5：evaluate 已弃用**，保留为接口收口备查 |
| `fetchPositions` | `/api/v1/perps/positions` | `account_id` · **`limit`(必带,默认200)** | `data[]{position_id,size,realized_pnl,created_at,updated_at,position_side}` |

- **WS**（声明备查，discovery 本身不用，watch 用 `wss://mainnet-gw.sodex.dev/ws/perps`）：订阅 `accountState/accountUpdate/accountOrderUpdate/accountTrade`，`user=address`，无鉴权。列在此处便于整个跟单系统接口单点维护。
- 公共：`httpGetJson(url)` 超时 10s + AbortController + 大整数安全解析 + **discovery 自带轻量限流**（并发≤4 + 每请求小间隔；命中 429/409 时按 `Retry-After` 或指数退避 2→60s+jitter）。**不 import watch-account.mjs 的限流单例**（独立模块、隔离，不动已稳定的 watch）。
- **WS 声明保留**（discovery 不调用，仅作整个跟单系统接口收口备查）。

### CLI 用法

```bash
node script/discovery/main.mjs --dry-run                       # 干跑：只 stdout，不落盘不推 TG
node script/discovery/main.mjs --top=10                        # 正式：写 log/ 结果文件 + 推 TG（不动 watch.config）
node script/discovery/main.mjs --pages=4                       # 看前200名
node script/discovery/main.mjs --config=script/discovery/config.json
```

## 边界与约束

**包含**：五阶段管线、preset 展开、双通道门槛、qualityFilters、结果文件(json+md)、TG 推送、dry-run、api/index.mjs 接口收口。

**明确不做**：自动写 `watch.config.json`——结果只产出文件 + TG，是否纳入监听由人工看结果后手动编辑 watch.config。

**不包含**：
- 现货跟单（无可跟动作，watcher 只监听 perps）。
- `style` 风格过滤的完整实现 —— v2，MVP 接受 `style` 字段但默认 `any` 不过滤。
- 实际下单/上链 —— 纯只读发现，跟单执行交给 watcher + 人工。
- 多窗口画像（overview 只取 30D；跨窗持续性靠 ①采集 的 hitWindows，不额外拉别的窗 overview）。

**已知限制**：
- positions 即便 `limit=200` 仍可能截断超长历史交易者（极少数），盈亏比按可见样本算。
- `chart` 上限 90 天，稳定性指标最多 90 个日点。
- 榜单整点快照、小时级刷新 → 每周跑一次足够，更频无意义。

## 集成点

| 文件 / 符号 | 改动 |
|---|---|
| `script/discovery/main.mjs` | **新增** 入口编排 + CLI + preset 展开 + 读 watch.config 得 excludeAddresses |
| `script/discovery/api/index.mjs` | **新增** 所有 HTTP 接口 + WS 声明（baseURL/path/请求参数/返回字段）+ httpGetJson/限流 |
| `script/watch.config.json` | **只读**（取 `watches[].address` 排除已监听，**绝不修改**） |
| `script/discovery/process/collect.mjs` | **新增** ① 采集（调 api.fetchLeaderboard） |
| `script/discovery/process/filter.mjs` | **新增** ② 筛选 |
| `script/discovery/process/evaluate.mjs` | **新增** ③ 评估（画像+硬门槛，positions 带 limit） |
| `script/discovery/process/score.mjs` | **新增** ④ 打分 |
| `script/discovery/process/output.mjs` | **新增** ⑤ 输出（log/ 结果文件 json+md + TG 推送；**不写 watch.config**） |
| `script/discovery/config.json` | **新增**（gitignore） |
| `script/discovery/log/` | **新增** 结果目录（gitignore） |
| `.gitignore` | 追加 `script/discovery/config.json`、`script/discovery/log/` |
| `script/watch-account.mjs` | （可选）拉平仓历史改带 `&limit`，复用 D1 发现 |
| `docs/discover-traders-plan.md` / `docs/update-log.md` | 同步 |

## 验收标准

- [ ] `node script/discovery/main.mjs --dry-run` 打印候选收敛（~150→~30→十几→top10）+ topK 摘要表，不落盘不推 TG
- [ ] 正式跑在 `log/` 生成 `discovery-YYYY-MM-DD-HHmm.json`（全画像+分数+淘汰原因）+ `.md`（人读详情）
- [ ] **不写/不改 watch.config.json**（只读它做排除）
- [ ] 采集后排除 `watch.config.json` 已有 address（已监听的不重复评估、不出现在结果里）
- [ ] 合格者 < topK 时输出少于 topK（不凑数、不放宽门槛）；合格者 ≥ topK 时取前 topK
- [ ] TG 收到推送：前 5 名详展卡片（每指标独占一行）+ 第 6 起紧凑单行
- [ ] 所有接口/WS 声明集中在 `api/index.mjs`，阶段文件无散落 URL
- [ ] **D1**：evaluate 拉 positions 带 `&limit=200`（验证老账户拿到 >40 条）
- [ ] **D2**：无 `tradeRatio` 计算；门槛用 perpsPnl 绝对额 + perps 主导
- [ ] **D3**：低频高手不被误杀 —— `account_id=204502`(12笔,PF5.55,win83%) 通过双通道
- [ ] **D4**：无 ROI 门槛/排序
- [ ] 总请求量 ≤ ~250（pages=2），只覆盖榜前 100 名
- [ ] config.json / log/ 已入 .gitignore
- [ ] `node --check` 通过；`node --test`（script/）全绿

## 验收场景

### 场景 1：dry-run 校准
- **Given** config 默认（balanced, pages=2）
- **When** `node script/discovery/main.mjs --dry-run`
- **Then** stdout 打印五阶段收敛计数 + topK 摘要表（地址/分数/盈亏比/胜率/Sharpe/成交量/命中窗）；不写任何文件、不推 TG、不动 watch.config

### 场景 2：低频精准高手不被误杀（D3）
- **Given** `account_id=204502`（rank3, 12 笔, profitFactor 5.55, winRate 83%）进入评估
- **When** 过硬门槛
- **Then** 中频路 `12<20` 不过，但低频路 `12≥8 && 5.55≥3 && 0.83≥0.70` 通过 → 进入打分（不被 minTrades 误杀）

### 场景 3：positions 分页拿全（D1）
- **Given** `account_id=159659`（>40 条平仓历史）
- **When** evaluate 拉 `GET /api/v1/perps/positions?account_id=159659&limit=200`
- **Then** 返回 >40 条（默认 40 会截断）；盈亏比/胜率按完整样本算

### 场景 4：空投农民被淘汰（qualityFilters）
- **Given** `account_id=2119`（total_pnl 10676, perps_closed≈0, net_deposit −10676, volume 10680）
- **When** ②筛选 / antiAirdrop
- **Then** `perps_closed > minPerpsPnl` 不成立 → ②筛选即淘汰（不进评估，省请求）

### 场景 5：排除已监听地址 + 不凑满
- **Given** `watch.config.json` 已含 `0x5847…7027`；本次采集候选含该地址；过完门槛仅 6 个合格者（< topK=10）
- **When** 跑完整管线
- **Then** ① `0x5847…7027` 在采集后即被剔除（不进 filter/evaluate）；② 最终结果 6 个（不放宽门槛凑到 10）

### 场景 6：只产出文件，不碰 watch.config
- **Given** 本次推荐 7 个新地址，`watch.config.json` 存在
- **When** output 阶段执行
- **Then** ① `log/discovery-YYYY-MM-DD-HHmm.{json,md}` 两文件生成；② TG 收到推送；③ `watch.config.json` **内容不变**（仅被读取过）

### 场景 7：标的过气需刷新（freshness）
- **Given** `account_id=17139`（90D 累计曾盈利但近 7 天合约转亏，30D perps_closed −8375）
- **When** 过 freshness / 基础门槛
- **Then** `perps_closed > minPerpsPnl` 不成立或 freshness 不过 → 淘汰（不跟已过气标的）

<!-- COMPLEXITY: medium（complexity-score.sh 评定）→ 推荐 /k:plan；spec 已含完整实现蓝图(五文件职责+函数签名+D1-D4+归一公式+preset映射+6场景)，可经用户确认直接 /k:task -->
