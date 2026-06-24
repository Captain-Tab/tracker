# Hyperliquid 接口字段置信度（实测）

> 用途：同 [sodex.md](./sodex.md)，记录 Hyperliquid 接口字段的可参考性 + discovery 算法影响。
> 证据来源：2026-06-23 实测 leaderboard top5 + BobbyBigSize（0x7fdafde5…）的 info 接口。

---

## 一、接口清单

| 接口 | 路径 | 角色 | 上限 |
|------|------|------|------|
| leaderboard | `GET https://stats-data.hyperliquid.xyz/Mainnet/leaderboard` | 全量榜（~32MB 流式） | 一次全量 |
| info: clearinghouseState | `POST https://api.hyperliquid.xyz/info` `{type,user}` | 当前持仓 + 账户保证金 | — |
| info: userFills | `POST .../info` `{type:"userFills",user}` | **逐笔成交（含 closedPnl）** | **2000 笔/次** |
| info: userFillsByTime | `POST .../info` `{type,user,startTime,endTime}` | 同上，按时间翻页拿全史 | 2000 笔/次 |

---

## 二、字段置信度

### ✅ 高置信（可作筛选/盈利判定）

| 字段 | 来源 | 说明 |
|------|------|------|
| **`closedPnl`（逐笔）** | userFills | **HYPE 独有优势**：每笔平仓成交直接给已实现盈亏（官方计算，权威）。实测 1242/2000 笔非零。**无需回放、无需仓位聚合** |
| `fee` / `dir` / `px` / `sz` / `time`（逐笔） | userFills | 手续费 / 方向(Close Long/Short/Open) / 价 / 量 / 时间戳——逐笔账本完整 |
| `marginUsed`（单仓 + 账户 `totalMarginUsed`） | clearinghouseState | **精确保证金占用**（不像 sodex 要 名义÷杠杆 推算）。BobbyBigSize BTC 仓 marginUsed $823,943 |
| `unrealizedPnl` / `returnOnEquity` | clearinghouseState | 活跃仓位浮盈 / 回报率 |
| `positionValue` / `szi` / `entryPx` / `leverage` | clearinghouseState | 名义敞口 / 带方向size / 均价 / 杠杆 |
| `pnl` / `vlm`（绝对额） | leaderboard | 粗筛门槛用（HYPE-discovery 现用） |

### ❌ 低置信 / 不可参考

| 字段 | 来源 | 原因 |
|------|------|------|
| `roi` | leaderboard `windowPerformances` | 充提污染（同 sodex；HYPE-discovery `filter.mjs` 已弃用，只用 pnl/vlm 绝对额） |
| **排序（按 pnl 降序）** | leaderboard | **头部 100% 是 HFT/做市机器人**（见下），直接取 topK 推荐 = 全是机器人 |

---

## 三、与 sodex 的关键差异（HYPE 数据更强）

| 数据 | HYPE | sodex |
|------|------|-------|
| 逐笔已实现盈亏 | ✅ `userFills.closedPnl` **现成** | ❌ 无，只有仓位级 `realized_pnl`，活跃仓位 cr 另取 |
| 精确保证金 | ✅ `marginUsed` 直给 | ❌ 平仓历史 initial_margin 清零，须 名义÷杠杆 推算 |
| 活跃浮盈 | ✅ `unrealizedPnl` | ✅ state `ur` |
| 逐笔成交上限 | 2000/次，`userFillsByTime` 时间翻页 | trades 1000/次，cursor 翻页 |

> 结论：HYPE 做"逐笔盈亏深评"比 sodex **更容易、更准**——closedPnl 现成，不必回放。

---

## 四、核心问题：leaderboard 头部全是 HFT 机器人（实测坐实）

leaderboard 按 pnl 降序，top5 真实成交频率：

| 排名 | fills/天（实测） |
|------|------------------|
| #1 Penision Fund | 4,202 |
| #2 | 7,303 |
| #3 BobbyBigSize | 13,624 |
| #4 | 4,379 |
| #5 | 19,800 |

全是数千~两万笔/天的高频/做市机器人，持仓以秒/分计——**人手无法跟单**。旧版 HYPE-discovery 只做 leaderboard 粗筛（pnl/vlm 门槛 + pnl 排序 top20）、**无深度评估**，所以推荐名单几乎全是机器人，对手动跟单零参考价值。（2026-06-24 已修复，见 §五。）

---

## 五、算法诊断、调整方案与实施结果（已实施 2026-06-24）

HYPE-discovery 现状：`collect → filter(gate) → rankTopK(按pnl降序) → output`，**缺 `evaluate`/`score`，且 api 无限流 gate**（对照 sodex-discovery 有深评+打分+CONCURRENCY gate）。

### 根因诊断（2026-06-23 实测校准，链条如下）

| 步骤 | 发现 | 数据 |
|------|------|------|
| 初判 | "加 HFT 频率过滤剔除机器人" | — |
| **证伪** | 过粗筛门槛（pnl≥$10万 & **vlm≥$500万**）的账号 fills/天 **最低 91、中位 369**——没有一个 <50/天，HFT 门槛会**清空候选池** | 29 样本 |
| **找到根因** | 入口门槛 `vlm≥$500万` 本身定义了高频池（月成交 $500万必然高频），系统性筛掉所有低频交易者 | — |
| **验证** | 低 vlm 段（pnl≥$5万、vlm $5万~150万）fills/天 **中位仅 6 笔、<10/天 占 16/27**——低频可跟单高手都在这里，全被旧门槛挡掉 | 27 样本 |

典型被误杀样本：`pnl $76k / vlm $651k / 0.3 笔/天`（ROI 11.7% 低频高手）。

> 结论：HYPE 问题**不是"按 pnl 排序选出机器人"，而是入口 vlm 门槛把低频交易者全挡在池外**——排序再改、深评再准，旧池子里也没有可跟单标的。

### 调整方案（顺序不可颠倒）

| 步骤 | 调整 | 数据依据 |
|------|------|----------|
| **① 修入口（最关键）** | `config.json` vlm 门槛 $500万 → **$5万**（对齐 sodex `minVolume`） | 低 vlm 段才有低频交易者 |
| **② 加 HFT 频率过滤** | 深评剔除 fills/天 > 阈值（建议 **≤50**） | 低 vlm 段 <50/天 占 23/27；剔高频留低频 |
| **③ 加 closedPnl 深评** | `userFills.closedPnl` 逐笔算 PF/胜率/回撤/净利 | HYPE closedPnl 现成（§三） |
| ④ 下注规模 | `clearinghouseState.marginUsed`（精确） | §二 |

**顺序铁律**：必须先 ① 修入口，否则池子无低频候选，②③ 在旧池上等于清空（这是"加 HFT 过滤"方案被证伪的原因）。

### 落地影响（工程量评估）

- ① 改 config 一行。候选规模**全量实测**（扫 39244 行）：`vlm≥$5万`=1314；加 `pnl/vlm≥1%` 辅助门槛缩至 **879**——**千级非上万**（`pnl≥$5万` 全网仅 1691）。
- ② ③ 需新建 `evaluate`（HFT 过滤 + closedPnl 深评）+ `score`，并给 api **加限流 gate**（HYPE api 现在没有）。
- userFills 2000/次上限：对 HFT 只覆盖几小时（正好作 HFT 判据），低频交易者通常 < 2000 笔即全史；全史需 `userFillsByTime` 按时间翻页。

### 实施结果（2026-06-24）—— 实施中两个方案被实测推翻、修正为根本解

| 原方案 | 实测推翻 | 修正后（根本解）|
|--------|---------|----------------|
| ② "fills/天 ≤50 判 HFT" | fill 是"一笔交易拆数十 fill 执行"（#1: 529 fill = 10 笔交易），fills/天把**大单拆单误判高频** | **聚合成交易后用 trades/天** |
| ③ "fill 级 closedPnl 算 PF/胜率" | fill 级指标全失真（#1 fill 级 PF155万/胜99.8% → 聚合后 6 笔交易/真实低频大单）| 按 `startPosition` **重建仓位周期，交易级**算所有指标 |

**最终算法**：`collect(粗筛 pnl≥$5万 & vlm≥$5万 & pnl/vlm≥1% & poolMax≤300) → evaluate(拉 userFills → aggregateTrades 重建仓位周期 → 交易级 PF/胜率/RF/频率/名义/单笔利润) → score(PF/RF/胜率/净额 加权 × capped降权) → topK`。

**最终深评门槛**：交易数≥5 / 活跃≥7天 / 中位名义≥$1万 / 中位单笔利润≥$100 / trades/天≤20 / PF≥1.5 / RF≥1.0。

**性能**：evaluate 每候选 **1 次 userFills**（去 clearinghouseState，请求减半）+ 聚合 O(fills)。实测 vlm≥$5万 后幸存 817，深评阶段 VPS 内存 575MB+swap 81MB 接近 OOM。2026-06-24 加 `poolMax=300`（对标 sodex poolMax），硬上限截断到 300 候选进深评，耗时 ~3-5 分钟、内存 ~200-300MB。

**最终画像**：低频（0.1~1.5 笔/天）+ 大单（名义中位 $3万~$733万）+ 大利润（中位单笔 $204~$32万）方向性交易者。§六 4 瑕疵已通过 capped 降权 + 净额维度 + 名义/活跃/单笔利润三门槛打磨收敛。

---

## 六、已知局限处置（2026-06-23 方案审查 + 2026-06-24 打磨）

| 局限 | 说明 | plan 处理方向 |
|------|------|---------------|
| **userFills 2000 上限** | 活跃/中高频账号 `closedPnl`/PF 只覆盖近期窗口、非全史 | `userFillsByTime` 翻页拿全史 vs 接受"近期画像"（权衡请求成本） |
| **HFT 阈值 50 是单点小样本估计** | 基于小样本（高 vlm 段最低 91、低 vlm 段中位 6），非严格双峰分界，可能误杀 50~91 间中频 | 实现前拉**大样本** fills/天 分布找真分界 |
| **marginUsed 历史口径未定** | 已平历史交易无 `marginUsed`（仅活跃仓有）；且门槛/加分/展示定位未定 | 历史用 `fills sz×px` 推算名义；定位类比 sodex `betSize`（加分不设门槛） |

> `pnl/vlm≥1%` 粗筛是**辅助**（缩候选 + 降频率倾向），实测不充分（高效率组仍有 3020 笔/天）——精确判低频靠深评 fills/天，不能用 pnl/vlm 替代。
