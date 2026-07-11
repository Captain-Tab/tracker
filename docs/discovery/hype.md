# HYPE 跟单候选发现系统：方案 / 流程 / 核心算法

`service/HYPE-discovery/` 的方案文档。定位与 [sodex 版](./sodex.md) 对称：周期性从 Hyperliquid 公开榜单筛出**值得合约跟单**的一批地址，产物喂给 `service/HYPE-watch/main.mjs` 实时监听。数据源与盈利判定口径不同——HYPE 走 Hyperliquid 公开 info 接口，逐笔 `closedPnl` 现成权威，无需仓位回放。

> 接口字段置信度见 [`api-confidence/hype.md`](../api-confidence/hype.md)。按币种画像（coin-profile）不在本文档范围。

---

## 一、核心思路（为什么这么做）

### 1.1 leaderboard 头部全是机器人 —— 整个系统存在的理由

Hyperliquid leaderboard 按 `pnl` 降序，**头部 100% 是 HFT/做市机器人**（实测 top5 成交频率 4202~19800 fills/天，持仓以秒/分计），人手无法跟单。直接取 top-PNL 推荐 = 全是机器人，对手动跟单零参考价值。

但与 sodex 不同，HYPE 的**真问题不止"排序选出机器人"**。实测校准（`api-confidence/hype.md §五`）找到更深的根因：旧入口门槛 `vlm≥$500万` 本身就**定义了高频池**（月成交 $500万必然高频），把所有低频可跟单交易者挡在池外——典型被误杀样本 `pnl $76k / vlm $651k / 0.3 笔/天`（低频高手）。

**结论**：必须①修入口门槛（vlm $500万 → $5万，放低频进池）→ ②聚合 fill 成交易后用交易级频率踢机器人 → ③用 `closedPnl` 逐笔真账本深评。顺序铁律：先修入口，否则池子无低频候选，后两步在旧池上等于清空。

### 1.2 fill ≠ 交易 —— HYPE 特有的关键修正

HYPE 一笔交易常拆成数十个 fill 执行（实测 #1 是 10 笔交易拆成 529 个 fill）。**fill 级算 PF/胜率/频率/单笔利润全部失真**（#1 fill 级 PF=155万、胜率 99.8%、19 笔/天 → 聚合后真实为 10 笔交易、单笔中位 $2072、0.36 笔/天的低频大单账号）。

故所有指标必须在「交易级」算：按 `coin` 跟踪持仓（`startPosition + Σ signed sz`），持仓归 0 = 一笔交易完成。这是 HYPE 与 sodex 最大的算法差异——sodex 的 `positions` 已经是仓位级真账本，HYPE 的 `userFills` 是 fill 级，必须先重建仓位周期。

### 1.3 算法选出的人长什么样（目标画像）

一句话：**低频（0.1~1.5 笔/天）+ 大单（名义中位 $3万~$733万）+ 大利润（单笔中位 $204~$32万）的方向性合约交易者**——不是赚得最多的机器人，是开平节奏人手跟得动、单笔规模值得跟、风险调整后稳健的实盘手。

| 维度 | 门槛 | 含义 |
| --- | --- | --- |
| 跟得动的节奏 | `tradesPerDay ≤ 20` | 交易级频率，踢掉 HFT/做市机器人 |
| 足够样本 | `nTrades ≥ 5` | 完整仓位周期数（低频大单天然样本少，不宜过高） |
| 持续活跃 | `activeDays ≥ 7` | 首末 fill 间隔，剔近期高频爆发/样本期过短 |
| 可跟单规模 | `medNotional ≥ $1万` | 交易级名义中位，剔极小单 |
| 单笔有肉 | `medTradePnl ≥ $100` | 中位盈利交易净利，剔做市残留微利 |
| 风险调整 | `PF ≥ 1.5` & `RF ≥ 1.0` | 净盈利 > 最大回撤，沿用 sodex balanced |

---

## 二、数据源（Hyperliquid 公开接口，无鉴权，已实测）

leaderboard 走非官方 stats 域名（GET 全量流式）；info 系列走官方 `POST /info`。入参可传**任意** address（公开数据）。

| 接口 | 角色 | 给出什么 | Method + Path | 上限 |
| --- | --- | --- | --- | --- |
| leaderboard | **漏斗入口（便宜）** | 全量榜 `ethAddress + displayName + accountValue + windowPerformances` | `GET https://stats-data.hyperliquid.xyz/Mainnet/leaderboard` | 一次全量 ~32MB |
| userFills | **逐笔真账本（贵）** | 逐笔成交，**含 `closedPnl`/`fee`/`dir`/`px`/`sz`/`time`/`startPosition`** | `POST /info {type:"userFills",user}` | **2000 笔/次** |
| userFillsByTime | 翻页拿全史 | 同上，`startTime` 递增翻页 | `POST /info {type:"userFillsByTime",user,startTime}` | 2000 笔/次 |
| userFunding | **真实 PnL 修正** | 资金费收付（`delta.usdc` 正=净收/负=净付）**不在 closedPnl 内** | `POST /info {type:"userFunding",user,startTime}` | 时间窗 |
| clearinghouseState | 备用（精确保证金） | 活跃持仓 + `marginUsed`/`unrealizedPnl` | `POST /info {type:"clearinghouseState",user}` | — |

### 三个实测关键点

- **`closedPnl` 是 HYPE 独有优势**：每笔平仓 fill 直接给官方计算的已实现盈亏（实测 1242/2000 非零），**无需回放、无需仓位级 PnL 推算**。这是相对 sodex 的核心数据优势。
- **leaderboard 的 `roi` 充提污染、不可用**：与 sodex 同病，filter 已弃用，只用 `pnl`/`vlm` 绝对额。leaderboard 排序更不能直接取 topK（全是机器人）。
- **userFills 2000/次上限**：活跃账号只覆盖近期窗口（`capped` 标记），非全史；低频交易者通常 < 2000 笔即全史。全史需 `userFillsByTime` 翻页（注意 `startTime=0` 时回退到 `userFills`，否则实测会漏近 7 天数据）。

### windowPerformances 字段（决定门槛）

每个 window（`day`/`week`/`month`/`allTime`）给 `{ pnl, roi, vlm }`。`flattenRow` 展平为 `perf` 对象，门槛只取主窗口（默认 `month`）的 `pnl`/`vlm`。`roi` 解析但**不作门槛/排序**（充提污染）。

---

## 三、系统流程（六阶段 + 文件架构）

### 3.1 六阶段

```
~3.9万账户 ─①采集─> 千级 ─②筛选─> ≤300(poolMax) ─③深评─> 十几个 ─④打分─> topK ─⑤输出─> log/discovery/ + TG
                                                                              └─⑥观察态─> log/observing/ + 维护 watch-observing.json + 观察态 TG
```

| 阶段 | 文件 | 接口 | 输入→输出 | 性质 |
| --- | --- | --- | --- | --- |
| **① 采集** Collect | `collect.mjs` | `/leaderboard` | ~3.9万 → 千级 | **流式逐行**展平 + 排除已监听/parked + **内联门槛**，只留通过者（39k 不落地，内存峰值几十 MB） |
| **② 筛选** Filter | `filter.mjs` | 无（采集内联） | — | `passesThreshold` 门槛判定（流式调用），pnl/vlm/efficiency 绝对额砍噪声 |
| **③ 深评** Evaluate | `evaluate.mjs` | `/userFills` + `/userFunding` | ≤300 → 十几个 | 拉 userFills → **聚合 fill 成交易** → 交易级 PF/胜率/RF/频率/名义/单笔利润 + 硬门槛一票否决 + funding 真实 PnL 修正 |
| **④ 打分** Score | `score.mjs` | 无（纯算） | 十几个 → topK | 4 维归一×权重→排序取 topK（capped 降权）；额外返回全量 `scored`（pre-topK 带分）供 ⑥ |
| **⑤ 输出** Output | `output.mjs` | 无 | topK → 名单 | log/discovery/ 结果文件(json+md) + TG（**不写 watch.config**） |
| **⑥ 观察态** Observing | `observing.mjs` | 无 | scored → 观察态 | ⑤ 后同进程；维护 `watch-observing.json`：连续 2 周达标 → 🟢 结算推荐升 watch，断 streak → 🔴 移出，新入 → 🟡；只写 observing，异常不中断 ①-⑤ |

> **poolMax 硬上限**：leaderboard 按 pnl 降序，门槛后幸存者可能上千，深评每候选 1 次 userFills（2000 fill 聚合）内存吃紧（实测 817 幸存时 VPS 575MB+swap 接近 OOM）。故 `poolMax=300` 截断到前 300 进深评（对标 sodex poolMax），耗时 ~3-5 分钟、内存 ~200-300MB。截断数显式记日志，不静默。

### 3.2 文件架构

```
service/HYPE-discovery/
  main.mjs              # 入口：CLI、读 config、读 HYPE-watch/config + watch-parked 得 excludeSet、编排六阶段
  api/
    index.mjs          # leaderboard 流式扫描器 + info 接口封装 + 限流 gate（并发≤4 + 间隔 120ms + 429/503 退避）
  process/
    collect.mjs        # ① 采集（流式 + 内联门槛）
    filter.mjs         # ② 门槛判定（passesThreshold / gateOf）
    evaluate.mjs       # ③ 深评（aggregateTrades + deriveTradeMetrics + 硬门槛 + funding 修正）
    score.mjs          # ④ 打分（返回 {ranked, truncated, scored}）
    output.mjs         # ⑤ 输出（json+md + TG；不写 watch.config；导出 sendTelegram 供 ⑥）
    observing.mjs      # ⑥ 观察态（三态维护 + 观察态 TG + log/observing 落盘；自带 JSON 读写）
  config.json          # 配置（含 tgToken/tgChat）
  log/
    discovery/         # ⑤ 结果文件（discovery-<stamp>.{json,md}，每次跑生成）
    observing/         # ⑥ 观察态快照 + 决策（observing-<stamp>.{json,md}，每次跑生成）
```

- 每阶段是纯函数 `(input, config) → output`，`--dry-run` 只 stdout 不落盘（⑥ 打印观察态消息到 stdout）、`--no-push` 落盘不推、`--limit=N` 扫够 N 行即停（测试）。
- **自带限流**（info 接口并发≤4 + 间隔 120ms；429/503 指数退避 2→60s + jitter，最多 6 次）+ HTTP 超时（info 10s / leaderboard 40s）。fetch 走 WARP 代理全局注入。
- 排除集 = `HYPE-watch/config.json` 已监听地址 **∪** `HYPE-watch/watch-parked.json` parked 归档（人工判定不监听的不再推荐）。observing 不进排除集，故仍被采集、可持续观察。leaderboard 拉取失败 → 跳过本轮，不崩。

### 3.3 观察态三态（discovery → watch 的衔接）

发现的地址进 watch（实时监听、稀缺 WS 槽 5-10）前先经观察态验证持续性，三态各一文件：

| 态 | 文件 | 进 excludeSet | 写者 | 语义 |
| --- | --- | --- | --- | --- |
| **watch** | `HYPE-watch/config.json` `watches[]` | 是 | 人工 | 正在实时监听 |
| **parked** | `HYPE-watch/watch-parked.json` | 是 | 人工 | 判定不监听的归档，可人工捞回；**park 永远人工** |
| **observing** | `HYPE-watch/watch-observing.json` | 否 | ⑥ 自动 | 观察暂存，连续 2 周达标即 🟢 推荐升 watch |

- **⑥ 逻辑**：本周 `scored`（∉watch ∉parked）→ 已在 observing 则追加当周 ISO 周（去重）、满 2 周且未推过 → 🟢 结算推荐；不在则新入 🟡 观察第 1 周。observing 里本周未达标者 → 🔴 断 streak 移出（**绝不自动 park**，原因取 ③ 淘汰记录或兜底「掉出榜单」）；若该址已被人工移入 watch/parked（进排除集）则静默清出、不报 🔴（是升级/归档非掉出）。
- **观察态 TG**（B 版，顺序 🟢→🔴→🟡）：🟢 全展含 ≤2 近期精彩交易，🔴/🟡 各 ≤5 超出计数，三段全空静默不推。
- **人工闭环**：看 TG 🟢 推荐 → 手动把地址搬进 `config.watches[]`；不要的手动移 `watch-parked.json`。⑥ 只写 observing，watch/parked 全人工。
- `watch-observing.json` 条目：`{ since, weeksSeen[], recommended, lastScore, reason }`（ISO 周 id，地址小写归一；自带 JSON 读写，不经 watch-parked 的 `{date,reason}` schema）。

---

## 四、核心算法

### 4.1 派生指标（③深评每候选算出，全部交易级）

> **核心前置：`aggregateTrades`**。按 `coin` 跟踪持仓 `startPosition + Σ signed sz`（`side==="B"` 为 +、`"A"` 为 −），持仓归 0（`|endPos| < 1e-9`）即一笔交易完成；每笔交易 `pnl = Σ(closedPnl − fee)`、`notional = Σ|sz×px|`、记 `fills`/`openMs`/`closeMs`。未平仓周期（open 残留）= 当前活跃仓位，不计入。

| 指标 | 来源 | 公式 |
| --- | --- | --- |
| fill 数 / capped | userFills | `fills.length`；`≥2000` 即 `capped`（近期窗口，全史未覆盖） |
| 交易数 `nTrades` | aggregateTrades | 完整仓位周期数 |
| 交易频率 `tradesPerDay` | 交易级 | `nTrades / spanDays`（**HFT 判据**，非 fills/天） |
| 逐笔胜率 `winRate` | 交易级 | `pnl>0 交易数 / nTrades` |
| 盈亏比 `profitFactor` | 交易级 | `Σ盈利交易 / |Σ亏损交易|`（无亏→∞） |
| 净盈利 `netProfit` | 交易级 | `Σ盈 − Σ亏` |
| 最大回撤 `maxDD` | 交易级累计 | 按 `closeMs` 升序累计净额曲线峰谷回落 |
| 恢复比 `recoveryFactor` | 交易级 | `netProfit / maxDD`（maxDD→0 且净利>0 → ∞ 满分） |
| 活跃跨度 `activeDays` | userFills | `(末 fill − 首 fill time)/天` |
| 下注规模 `medNotional`/`maxNotional` | 交易级名义 | 中位 / 最大交易名义 |
| 中位单笔利润 `medTradePnl` | 交易级 | 盈利交易净利中位 |
| 最大单笔盈/亏 `maxWin`/`maxLoss` | 交易级 | 仅展示 |
| 资金费 `fundingTotal` | userFunding | `Σ delta.usdc`（账户级，正净收/负净付） |
| **真实 PnL `truePnl`** | 组合 | `netProfit + fundingTotal` = `Σ(closedPnl − fee) + Σ funding` |

> **funding 量级可观**（实测某户净 +$65k，完全不在 closedPnl 内），故真实 PnL 须叠加资金费。funding 与 fills 对齐同窗：`startTime` 取最早 fill 时间，活跃账号 fills 被 2000 截断时 funding 也只算近期窗口。

### 4.2 硬门槛（③深评内一票否决，命中即淘汰）

按顺序判定，任一不过即淘汰并记 `reason`：

1. **成交记录不足**：`fills.length < 2` → 直接淘汰。
2. **交易样本**：`nTrades ≥ 5`（多为未平仓/单边则不足）。
3. **活跃跨度**：`activeDays ≥ 7`（样本期不足/近期爆发淘汰）。
4. **可跟单规模**：`medNotional ≥ $10000`（极小单非可跟规模）。
5. **单笔利润**：`medTradePnl ≥ $100`（微利做市残留淘汰）。
6. **HFT 频率**：`tradesPerDay ≤ 20`（超出即机器人）。
7. **风险调整**：`profitFactor ≥ 1.5` 且 `recoveryFactor ≥ 1.0`。

### 4.3 软评分（④打分，0–100 加权排序，不淘汰）

每维归一到 `[0,1]` × 权重，`score = Σ × (capped ? 0.9 : 1)`，默认权重和=100：

| 维度 | 权重 | 归一公式（clamp 到 [0,1]） |
| --- | --- | --- |
| 盈亏比 `profitFactor` | 30 | `clamp((pf − 1) / 2, 0, 1)`，pf≥3 满分；∞ 满分 |
| 恢复比 `recoveryFactor` | 20 | `clamp(rf / 3, 0, 1)`，rf≥3 满分；∞(无回撤) 满分 |
| 胜率 `winRate` | 20 | 直接取值 |
| 净额规模 `netProfit` | 30 | `clamp((log10(pnlScale) − 4) / 2, 0, 1)`，$1万→0、$100万→1；`pnlScale = truePnl ?? netProfit` |

- **净额规模维度的作用**：区分一堆 PF=∞/满分的账号，让真正的大户排前（避免微利满分户混入头部）。
- **capped 降权 10%**：userFills 2000 上限只覆盖近期，PF∞/高胜率是近期乐观估计、全史未覆盖，故 `score × 0.9`。
- **下注规模（medNotional/marginUsed）不进 score**，只走 output 展示——HYPE 名义规模锚点尚未校准，避免拍脑袋纳入（待拉分布校准）。

降序取 `topK`，截断数显式记日志。

---

## 五、配置（固定参数 + 可配置参数）

### 5.1 固定参数（写死，深评门槛 `evaluate.mjs DEFAULTS`，可被 `config.evaluate` 覆盖）

| 参数 | 默认 | 含义 |
| --- | --- | --- |
| `maxTradesPerDay` | 20 | HFT 上限（交易级频率） |
| `minTrades` | 5 | 交易样本下限 |
| `minActiveDays` | 7 | 活跃跨度下限 |
| `minMedNotional` | 10000 | 中位交易名义下限（USD） |
| `minMedTradePnl` | 100 | 中位单笔利润下限（USD） |
| `minProfitFactor` | 1.5 | 沿用 sodex balanced |
| `minRecoveryFactor` | 1.0 | 同上 |
| `CONCURRENCY` | 4 | info 并发上限 |

### 5.2 可配置参数（`config.json`）

```jsonc
{
  "tgToken": "...",                       // TG bot token
  "tgChat": "...",                        // 推送目标
  "window": "month",                      // 主窗口：day|week|month|allTime
  "thresholds": {
    "minPnlUsd": { "month": 50000 },      // 粗筛 pnl 门槛（USD）——修入口的关键值
    "minVlmUsd": { "month": 50000 }       // 粗筛 vlm 门槛（USD）——从 $500万降到 $5万放低频进池
  },
  "minEfficiency": 0.01,                  // pnl/vlm 辅助门槛（滤大量小单刷量，降频率倾向）
  "topK": 20,                             // 推荐上限（不凑数）
  "poolMax": 300,                         // 进深评的候选硬上限（防 OOM）
  "excludeWatched": true                  // 是否排除 watch.config 已监听
  // 可选覆盖："weights": {...}, "evaluate": {...}
}
```

> **不用 sodex 的 riskPreset/style 那套**：HYPE 深评门槛写在 `evaluate.mjs DEFAULTS`，可被 `config.evaluate` 整体覆盖；权重可被 `config.weights` 覆盖。门槛尚处「dry-run 20 样本初定」阶段，待更大样本校准。

---

## 六、输出（结果目录 + TG 推送）

### 6.1 推荐多少：`topK = 20`（上限，非目标）

合格者（过完所有硬门槛）不足时输出就少于 topK，**不放宽门槛、不凑数**。采集已排除已监听 + parked，结果全是新发现。

### 6.2 结果文件（`service/HYPE-discovery/log/discovery/`）

每次运行生成两个带时间戳文件（`discovery-YYYY-MM-DD-HHmm.{json,md}`）：

- **json**（机读）：`generatedAt` + window + gate + summary + 全 topK 完整画像（逐笔 trades 剔除，仅内存供 ⑥ 用）。
- **md**（人读 / TG 附件源）：每推荐含 盈亏比/胜率/恢复比/笔交易每天 · 净额/交易数/fill 数/中位单笔/活跃天数 · **真实 PnL（净额 + 资金费）** · 下注名义中位/最大 · window 榜 pnl/vlm/roi（标注充提污染仅参考）· 账户净值。

> ⑥ 观察态另在 `log/observing/` 生成 `observing-<stamp>.{json,md}`（状态快照 + 本轮 🟢/🔴/🟡 决策），见 §3.3。

### 6.3 推送 Telegram（不写 watch.config）

- TG 摘要（手机友好排版）：头部 3 行（标题 / 日期+窗口 / 扫描→过门槛→推荐·排除N在监听）+ **前 5 名详展卡片**（地址 + 盈亏比/胜率/频率 + 净额/中位单笔/笔数）+ 「📄 完整报告见附件」，再 `sendDocument` 上传 .md 全文。
- ⑤ 主消息之后，⑥ 另推一条**观察态消息**（🟢 结算升 watch / 🔴 移出 / 🟡 观察中，见 §3.3），三段全空则静默。
- **0 通过不算失败**：合格者为 0 时照常生成结果文件，TG 推「📭 本轮无合格候选」（非静默，确认脚本活着）。
- **不写 watch.config**：是否纳入监听由人工看结果后手动编辑 `service/HYPE-watch/config.json`，再启动 watcher 接手实时跟单。

---

## 七、与 sodex 发现系统的关键差异

| 维度 | HYPE | sodex |
| --- | --- | --- |
| 数据源 | Hyperliquid 公开 leaderboard + info（无鉴权） | sodex data host `/leaderboard` `/overview` `/chart` `/positions` |
| 逐笔盈利源 | `userFills.closedPnl`（fill 级，官方现成） | `positions.realized_pnl`（已是仓位级真账本） |
| 真账本粒度 | **fill 级 → 必须 `aggregateTrades` 重建仓位周期成交易级** | 仓位级，直接用 |
| funding 校正 | ✅ `truePnl = Σ(closedPnl−fee) + Σ funding`（资金费量级可观） | 无单独 funding 校正 |
| 入口门槛 | pnl/vlm 绝对额（vlm 从 $500万降到 $5万放低频进池——核心修复） | pnl/vlm 绝对额 + 双通道交易资格 |
| HFT 过滤 | **交易级 `tradesPerDay ≤ 20`**（fill 级会把拆单误判高频） | 无（sodex 无 fill 拆单问题） |
| 风险调整 | PF + RF（同 sodex balanced） | PF + RF |
| 候选池保护 | poolMax=300（防深评 OOM） | poolMax=1000 |
| 配置范式 | `evaluate.mjs DEFAULTS` + 可覆盖 | riskPreset/style 命名快照展开 |
| overview 污染字段 | 不用（leaderboard 只取 pnl/vlm，roi 弃） | filter 用 overview 30D，evaluate 弃用（同源污染） |

---

## 八、边界与约束

**包含**：五阶段发现管线、流式 leaderboard 扫描、fill→交易聚合深评、funding 真实 PnL 修正、结果文件(json+md)、TG 推送、限流 gate。

**明确不做**：
- 自动写 watch.config（只读它 + watch-candidates 排除，纳入监听由人工手动编辑）。
- 现货跟单（watcher 只监听 perps）。
- 实际下单 / 上链（纯只读发现，执行交给 watcher + 人工）。
- 按币种画像（coin-profile）——见独立文档，本系统是全币种合并总账视角。

**已知局限**（详见 `api-confidence/hype.md §六`）：
- **userFills 2000 上限**：活跃/中高频账号画像只覆盖近期窗口（`capped` 标记 + 降权），非全史。全史需 `userFillsByTime` 翻页（权衡请求成本）。
- **HFT 阈值 20 笔交易/天**：基于 dry-run 小样本初定，非严格双峰分界，待更大样本校准。
- **名义规模锚点未校准**：medNotional 走展示不进 score 门槛，待拉分布校准再纳入。

**风险**：跟单 ≠ 复制收益；发现的是"过去 N 天表现好"，不保证未来。幸存者偏差靠交易级真账本 + `--dry-run` 分布缓解；标的过气靠每周刷新兜。

---

## 九、与现有脚本的关系

| 脚本 | 职责 | 入参 | 产物 |
| --- | --- | --- | --- |
| `service/HYPE-watch/main.mjs` | 多地址实时监听 + 成交推送 | address(es) | TG/console 跟单信号 |
| **`HYPE-discovery/`（本方案）** | 周期发现可跟单地址 | 无（拉榜） | log/ 结果文件 + TG（人工据此手动维护 watch.config） |

闭环：**发现（discover）→ 监听（watch）**。
