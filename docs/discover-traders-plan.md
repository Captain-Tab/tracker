# 跟单候选发现系统：方案 / 流程 / 核心算法

`script/discovery/` 的方案文档。定位：周期性（每周）从公开排行榜筛出**值得合约跟单**的一批地址，产物喂给已有的 `script/watch-account.mjs` 实时监听。配套精确实现规格见 `.claude/kit/spec/2026-06-20-copy-trade-discovery.md`。

> 本期只做**合约 perps**。现货 pnl 多为被动持仓浮盈、无可跟单动作，且 watcher 当前只监听 perps，故现货账户直接排除。

---

## 一、核心思路（为什么这么做）

### 1.1 榜单 PNL 会严重误导 —— 整个系统存在的理由

排行榜 `pnl_usd` ≈ **账户净值 − 净入金**（deposit-accounting），把空投 / 转入 / 现货浮盈 / Vault 全混进去，**不等于交易技能**。实测 7D PNL 榜前 10，多数榜首是空投农民和亏损户（详见 §七样本）。

**结论**：naive 跟单 top-PNL = 跟垃圾。唯一对合约跟单有意义的信号是 `perps_closed_pnl_usd`（逐笔权威已实现盈亏）+ 真实成交量 + 跨时间持续性。系统的全部价值在于**把"PNL 排行榜"转换成"可跟单交易者榜"**。

### 1.2 三条设计哲学

1. **收敛漏斗 + 分层省钱**：12.6 万账户里只看头部前 100 名，先用便宜接口（leaderboard / overview）砍掉 90% 噪声，再用贵接口（chart / positions）给少数幸存者做深度体检。全程只 ~215 个请求。
2. **风险调整后的可复制性，而非绝对收益**：排序比的不是谁赚得多（偏向本金大的人），而是谁赚得**稳、可持续、能被跟**。盈亏比（控亏质量）权重最高，胜率单看会骗人。
3. **两类画像，不漏低频高手**：交易者分"中频稳健型"和"低频精准型"，写死的 `minTrades` 会误杀后者（实测 rank1/rank3 顶级交易者只有 12~14 笔），故用组合门槛双通道。

### 1.3 算法选出的人长什么样（目标画像）

一句话：**风控扎实、持续活跃、风险调整后稳健盈利的中频实盘合约手**——不是赚得最多的，是赚得稳、控得住、跟得动的。

| 维度 | 门槛 | 含义 |
| --- | --- | --- |
| 真合约盈利 | perps 绝对额 + 主导 | 钱是合约交易赚的，非空投/现货/转入 |
| 持续活跃 | `activeSpanDays ≥ 15` | 有持续记录，非闪现/单笔运气 |
| 风险调整 | `PF ≥ 1.5` & `RF ≥ 1` | 净盈利 > 最大回撤，亏得起 |
| 不靠单点 | `maxDayShare ≤ 0.7` | 没有一笔/一天吞掉全局（RF 已兜单笔尾部） |
| 近期健康 | `freshNet ≥ 0` | 当下没在亏，不跟过气标的 |
| 持仓节奏 | 展示 `avgHoldMin` | 日内到波段（非高频套利、非长期囤仓） |

**故意不看**：①胜率高低本身（35%~85% 都收，靠 PF/RF 兜，单看胜率会骗人）；②绝对收益规模（本金大≠跟得动，**可复制性 > 绝对收益**）；③ROI（D4）。

> 取舍本质：找"能稳定跟一段时间、回撤可控、不会某天突然爆掉"的标的，而非榜单上账面赚最多的鲸鱼——这正是跟单（镜像每一笔）该要的人。

---

## 二、数据源（四个公开接口，无鉴权，已实测）

全部走 data host `https://mainnet-data.sodex.dev`，用 `dataClient`（未经 `withAuth`，无 `Authorization`）。入参可传**任意** address / account_id（与 `query`/`watch` 同，可观察任何人）。

| 接口 | 角色 | 给出什么 | Method + Path | 关键参数 |
| --- | --- | --- | --- | --- |
| 排行榜 | **漏斗入口（便宜）** | 头部账户 `wallet_address + account_id + pnl + volume + rank` | `GET /api/v1/leaderboard` | `window_type`=24H\|7D\|30D\|ALL_TIME · `sort_by`=pnl\|volume · `sort_order` · `page` · `page_size`(**≤50**) |
| PNL 概览 | **真伪鉴别（便宜）** | PNL 分项构成 | `GET /api/v1/wallet/portfolio/overview` | `account_id` · `window`=7D\|30D\|90D\|1Y |
| PNL 曲线 | **稳定性画像（贵）** | 每日 pnl 序列（90 个日点） | `GET /api/v1/wallet/portfolio/chart` | `account_id` · `window` |
| 平仓历史 | **逐笔真账本（贵）** | 每笔平仓权威 `realized_pnl` | `GET /api/v1/perps/positions` | `account_id` · **`limit`** |

### 两个实测关键点

- **`positions` 默认只返 40 条，必须带 `&limit=N`（实测 `limit=100` 返 100 条；`page`/`size`/`offset` 全部无效）**。逐笔指标靠 `limit` 拿全，否则老账户胜率/盈亏比失真。这条也适用于改进现有 `watch-account.mjs`。
- 后端榜单为**整点定时快照**（四个窗口共享同一 `snapshot_ts`），`[推理]` 小时级刷新。→ 比这更频繁地跑 discover 无意义，定每周一次。

### overview 字段（决定门槛）

`total_pnl_usd` / `roi` / `account_value_usd` / `net_deposit_usd` / `spot_pnl_usd` / `perps_unrealized_pnl_usd` / `perps_closed_pnl_usd` / `vault_pnl_usd` / `volume_usd` / `first_trade_ts_ms`。

> **ROI 不用作门槛/排序**：分母（本金/净值）接近 0 或为负时失真（实测 2119 的 `roi=106` 即 10600%），且系统性偏向微账户（小本金 ROI 虚高，但容量不足最不该跟）。其"赚得好不好"已被盈亏比 + Sharpe 更准刻画，冗余。

---

## 三、系统流程（五阶段 + 文件架构）

### 3.1 五阶段

```
12.6万账户 ─①采集─> ~150候选 ─②筛选─> ~30 ─③评估─> 十几个 ─④打分─> top10 ─⑤输出─> log/ 结果文件 + TG（不写 watch.config）
```

| 阶段 | 文件 | 接口 | 请求量 | 输入→输出 | 性质 |
| --- | --- | --- | --- | --- | --- |
| **① 采集** Collect | `collect.mjs` | `/leaderboard` | ~4 | 12.6万 → ~150 | 漏斗拉候选，4 路并集去重，**剔除 watch.config 已监听地址** |
| **② 筛选** Filter | `filter.mjs` | `/overview` | ~150 | ~150 → ~30 | 轻量粗筛，绝对额门槛砍 90%（省钱关键） |
| **③ 评估** Evaluate | `evaluate.mjs` | `/chart` + `/positions?limit` | ~60 | ~30 → 十几个 | 深度画像 + 硬门槛一票否决 |
| **④ 打分** Score | `score.mjs` | 无（纯算） | 0 | 十几个 → top10 | 6 维归一×权重→排序取 topK |
| **⑤ 输出** Output | `output.mjs` | 无 | 0 | top10 → 名单 | 生成 log/ 结果文件(json+md) + 推 TG（**不写 watch.config**） |

**合计 ~215 个请求，只覆盖榜单前 100 名**（由 `pages` 控制：`pages=4` → 前 200 名、~400 请求）。绝不全量。

### 3.2 文件架构

```
script/discovery/
  main.mjs              # 入口：CLI、读 config、读 watch.config 得 excludeAddresses、编排五阶段
  api/
    index.mjs          # 所有 HTTP 接口 + WS 声明（JSDoc：path/请求参数/返回字段）+ httpGetJson/限流
  process/
    collect.mjs        # ① 采集
    filter.mjs         # ② 筛选
    evaluate.mjs       # ③ 评估（画像 + 硬门槛）
    score.mjs          # ④ 打分
    output.mjs         # ⑤ 输出（log/ 结果文件 json+md + TG 推送；不写 watch.config）
  config.json          # 配置（gitignore，含 tgChat）
  log/                 # 输出目录（gitignore，每次跑生成带时间戳文件）
    discovery-YYYY-MM-DD-HHmm.json   # 完整画像 + 分数（机读）
    discovery-YYYY-MM-DD-HHmm.md     # 人读详情（TG 推送源，比 TG 更全）
```

- 入口与五阶段解耦，每阶段是纯函数 `(input, config) → output`，便于单测和 `--dry-run` 在任一阶段截断。
- discovery **自带轻量限流**（并发≤4 + 每请求小间隔；429/409 优先 `Retry-After`，否则指数退避 2→60s + jitter）+ 大整数安全解析 + HTTP 超时 10s。**不 import watch 的限流单例**（独立模块、隔离）。

---

## 四、核心算法

### 4.1 派生指标（评估阶段每候选算出）

> **v2 修正（dry-run 实测后，权威）**：evaluate 全部逐笔指标改用 **positions 真账本**。原因：①`chart.pnl_usd` 实测是**累计曲线**非单日，当单日算会让 Sharpe/maxDD 全错；②`overview` 短窗是**净值快照口径(deposit-accounting)**，混入转入/提现，与本系统要消灭的「榜单 pnl 误导」同源（实测 192916 overview7D=−39805 实为提现误记，真账本近期全盈利）。filter 仍用 overview 30D 做便宜初筛，但 evaluate 一律 positions。

| 指标 | 来源 | 公式 |
| --- | --- | --- |
| 合约已实现盈亏 `perpsPnl` | overview(30D) | `perps_closed_pnl_usd`（展示/filter，非 evaluate 门槛） |
| 成交量 `volume` | overview | `volume_usd` |
| 平仓笔数 `nTrades` | positions(size=0) | 记录数 |
| 逐笔胜率 `winRate` | positions | `realized_pnl>0 笔数 / nTrades` |
| 盈亏比 `profitFactor` | positions | `Σ盈利 / |Σ亏损|`（无亏→∞） |
| 净盈利 `netProfit` | positions | `Σ盈 − Σ亏` |
| 最大回撤 `maxDD` | positions 累计 | 按 updated_at 升序累计实现曲线峰谷回落 |
| **恢复比 `recoveryFactor`** | positions | `netProfit / maxDD`（maxDD→0 即 ∞ 满分，永不爆炸） |
| 活跃跨度 `activeSpanDays` | positions | `(末笔 − 首笔 updated_at)/天` |
| 单日集中度 `maxDayShare` | positions 按日聚合 | `max(单日实现) / Σ正单日` |
| 时效 `freshNet` | positions(近7D) | `Σ realized where updated_at≥now−7D`（`<0`=正在亏） |
| 最大单笔盈/亏 `maxWin`/`maxLoss` | positions | 仅展示（RF 已兜尾部风险，不设门槛） |
| 平均持仓时长 `avgHoldMin` | positions | `mean(updated_at − created_at)` |

> **弃用三项**：①`tradeRatio`（`total_pnl≈0` 爆炸）；②日级 `sharpe`（稀疏离散交易低信号，真实值 0.03~0.31，旧门槛 0.5 是 chart-bug 虚高产物）；③`maxDD/总盈利` 比（分母趋零爆炸，实测 28.56/∞，同 tradeRatio 之病）。风险调整统一由 **Recovery Factor** 承担。

### 4.2 硬门槛（④评估内一票否决，命中即淘汰）

1. **基础**：`perpsPnl > minPerpsPnl`（合约真赚，filter 用 overview 30D）、perps 主导、`volume ≥ minVolume`、`activeSpanDays ≥ minActiveDays`（首末交易间隔，不惩罚低频）。
2. **交易资格双通道**（替代写死的 `minTrades≥20`，防误杀低频高手）：
   - 中频路：`nTrades ≥ 20`，**或**
   - 低频精准路：`nTrades ≥ 8 且 profitFactor ≥ 3 且 winRate ≥ 70%`
3. **preset 门槛**：`minProfitFactor / minRecoveryFactor / maxDayShare`（见 §五；v2 用 RF 替代 maxDD比+Sharpe）。
4. **qualityFilters**（默认开，三合一）：反空投（净入金异常）/ 反一把梭（`maxDayShare`）/ **时效（positions 近 7 天逐笔实现 `freshNet ≥ 0`；`<0`=正在亏才淘汰，`=0` 休眠放行——不误杀近期没出手的高手，能抓正在回撤的）**。

### 4.3 软评分（⑤打分，0–100 加权排序，不淘汰）

每维归一到 `[0,1]` × preset 权重，`score = Σ`（v2 弃 Sharpe 维，maxDD 维并入 Recovery Factor）：

| 维度 | 原值 | 归一公式（clamp 到 [0,1]） |
| --- | --- | --- |
| 盈亏比 | `profitFactor`（倍数） | `clamp((pf − 1) / 2, 0, 1)`，pf≥3 满分；∞ 满分 |
| 恢复比 | `recoveryFactor` | `clamp(RF / 3, 0, 1)`，RF≥3 满分；∞(无回撤) 满分 |
| 胜率 | 0–1 | 直接取值 |
| 跨窗持续 | 命中窗数/要求窗数 | `命中数 / len(persistWindows)`；persistWindows 固定=采集窗 |
| 成交量 | USD | `clamp((log10(vol) − 4.7) / 2, 0, 1)`，5万→0、500万→~0.86 |

降序取 `topK`。

---

## 五、配置（固定参数 + 可配置参数）

### 5.1 固定参数（写死，不暴露）

| 参数 | 值 | 为什么固定 |
| --- | --- | --- |
| `sortBy` | `"pnl"` | volume 路价值低 |
| `lookbackDays` | 90 | chart 上限即 90 |
| `positionsLimit` | 200 | 实测 positions 靠 `limit` 拿全，实现细节 |
| `poolMax` | 1000 | 候选安全上限，防请求爆炸 |
| `perpsMustDominate` | true | 恒启用，替代失真 tradeRatio |
| `concurrency` | 4 | 画像并发，限流保护 |

### 5.2 可配置参数（类型 + 默认 + 取值）

```jsonc
{
  "sampling": { "windows": ["7D","30D"], "pages": 2 },  // array<enum> / number(1..10)
  "riskPreset": "balanced",          // enum: conservative|balanced|aggressive ← 主旋钮
  "style": "any",                    // enum: any|scalper|intraday|swing|position (v2)
  "gates": {
    "minPerpsPnl":   200,            // number(USD) ≥0
    "minVolume":     50000,          // number(USD) ≥0
    "minActiveDays": 15,             // number(天)  0..90
    "minTrades":     20              // number(整数) ≥1
  },
  "qualityFilters": true,            // boolean
  "topK": 10,                        // number(整数) ≥1
  "output": { "tgChat": "-5570447525" }  // 仅推送目标；不写 watch.config
  // 高级覆盖(可选): "weights": {...}, "lowFreqException": {...}, "persistWindows": [...]
}
```

### 5.3 `riskPreset` 字符串 → 可计算数值的展开映射 ⭐

`"balanced"` 是下面这一列具体数字的命名快照，加载时展开（门槛用于比较、权重用于 score）：

| 展开字段 | 单位 | conservative | **balanced** | aggressive |
| --- | --- | --- | --- | --- |
| `minProfitFactor` | 倍数 | 2.0 | **1.5** | 1.2 |
| `minRecoveryFactor` | 倍数 | 2.0 | **1.0** | 0.7 |
| `maxDayShare` | 比例 0–1 | 0.50 | **0.70** | 0.90 |
| `w.profitFactor` | 权重分 | 35 | **30** | 25 |
| `w.recoveryFactor` | 权重分 | 30 | **25** | 15 |
| `w.winRate` | 权重分 | 10 | **20** | 25 |
| `w.persist` | 权重分 | 15 | **15** | 20 |
| `w.volume` | 权重分 | 10 | **10** | 15 |

> v2：弃 `maxDrawdownRatio`(不稳定) 与 `minSharpe`(低信号)，风险调整由 Recovery Factor 承担。三列权重各和=100。conservative 把分集中在"稳"（盈亏比/恢复比共 65 分），aggressive 挪向"收益/活跃/胜率"。

### 5.4 `style` 枚举 → 数值区间（v2，按 `avgHoldMin` 过滤）

`scalper`<30min · `intraday` 30–480 · `swing` 480–4320 · `position`>4320 · `any` 不限。

---

## 六、输出（结果目录 + 地址数 + TG 推送）

### 6.1 输出多少个地址：推荐 `topK = 10`（上限，非目标）

`topK` 是**上限**：合格者（过完所有硬门槛）不足 10 个时输出就少于 10，**不放宽门槛、不凑数**，宁缺毋滥。采集阶段已剔除 `watch.config.json` 已监听地址，故结果全是新发现。

| 理由 | 说明 |
| --- | --- |
| 跟单精力 | 一个人能有效盯的标的有限，10 个够分散又不分心 |
| VPS 容量 | 每地址一条 WS 长连，1G/1核 VPS 实测跑 5–10 地址最舒适（见 `watch-account-plan.md §十一`） |
| 门槛后稀缺 | 前 100 名经严格门槛后金字塔尖也就十几个，取 top 10 即精华 |
| 可调 | `topK` 可配置，想激进跟更多调高 |

### 6.2 结果文件（`script/discovery/log/`）

每次运行生成两个带时间戳文件：

- **`discovery-YYYY-MM-DD-HHmm.json`**（机读）：全候选池 + topK 的完整画像、分数、命中/淘汰原因。供回溯和阈值校准。
- **`discovery-YYYY-MM-DD-HHmm.md`**（人读 / TG 源）：比 TG 更全，每推荐含 盈亏比/胜率/Sharpe/合约盈利/成交量/最大回撤/平均持仓/笔数/命中窗 + 末尾「淘汰摘要」。

### 6.3 推送 Telegram（不写 watch.config）

- TG 推送：把摘要推到 `output.tgChat`（复用 watch 的 bot）。手机友好排版（每指标独占一行）：头部 4 行（标题+日期 / 候选→通过→推荐 / 排除N在监听·不足topK不凑）+ **前 5 名详展卡片** + **第 6 起紧凑单行** + 尾部详情文件名。
- **0 通过不算失败**：合格者为 0 时照常生成结果文件，TG 推「📭 本周无合格候选」提示（非静默，确认脚本活着）。
- **不写 watch.config**：结果只产出文件 + TG。是否纳入监听由人工看结果后**手动**编辑 `watch.config.json`，再 `node script/watch-account.mjs --config=...` 接手实时跟单。

---

## 七、样本参考（实测证据）

### 7.1 7D PNL 榜前 10 体检 —— 印证榜单误导（通过 1/10）

```
acct     Rk     榜pnl  perps已实现      vol    胜率  盈亏比  笔数  判定
2119      1    10676         0    10680    0%   0.00    0   ✗ 转入提走
192916    2    10055    +10196  6160983   79%   3.55   14   ✗ 笔数(实为高手,见7.2)
40232     3     7946         0        0    0%   0.00    0   ✗ 现货零成交
1046      7     4462     -7679   950658   30%   1.66   40   ✗ 合约巨亏7679
20361     4     7111      +608   728327   70%   5.75   40   ✅ 通过
```

### 7.2 4 个人工标注"赚"地址验证 —— 校准出"低频精准型"通道

```
label        acct    Rk30   perps已实现    胜率  盈亏比  Sharpe  笔数   判定
ETH/PLTR赚    3602      34      +410       65%   1.38   1.77   40   ✅ 中频稳健型
USTECH100赚 204502       3   +19733       83%   5.55   0.39   12   低频精准(旧门槛误杀)
XAut赚      192916       1   +10196       79%   3.55   0.48   14   低频精准(旧门槛误杀)
PLTR赚       17139  126501     -8375       42%   0.87   0.45   40   ✗ 当前30D合约真亏
```

**两点结论**：① `minTrades=20` 写死会误杀 rank1/rank3 顶级低频高手 → 双通道门槛；② PLTR赚"标注时赚、现在亏"证明标的会过气 → 必须每周刷新 + 时效检查。

### 7.3 验证用真实地址

- 中频稳健：`account_id=3602`（ETH/PLTR赚，rank30，40笔）
- 低频精准：`account_id=204502`（USTECH100赚，rank3，盈亏比5.55）
- 反例（合约亏）：`account_id=17139`（PLTR赚，30D合约 −8375）

---

## 八、边界与约束

**包含**：五阶段发现管线、preset 配置、双通道门槛、结果文件(json+md)、TG 推送、api/index.mjs 接口收口。**明确不做**：自动写 watch.config（只读它排除已监听，纳入监听由人工手动编辑）。

**不包含**：
- 现货跟单（无可跟动作，且 watcher 只监听 perps）。
- `style` 风格过滤的完整实现（v2，MVP 默认 `any`）。
- 实际下单 / 上链（纯只读发现，跟单执行交给 watcher + 人工）。

**风险**：
- 跟单 ≠ 复制收益；发现的是"过去 N 天表现好"，不保证未来。本系统只做候选发现。
- 幸存者偏差：榜单只看赢家，靠跨窗持续性 + `--dry-run` 分布缓解。
- 标的过气：每周刷新 + 时效检查兜。

**隐私**：同 `watch-account-plan.md §八` —— 读公开数据不通知对方，唯一可见方是网关运营方服务端日志（源 IP）；监听与本人账户隔离。

---

## 九、与现有脚本的关系

| 脚本 | 职责 | 入参 | 产物 |
| --- | --- | --- | --- |
| `query-account.mjs` | 单地址快照 | address | 仓位 + 委托 |
| `watch-account.mjs` | 多地址实时监听 + 平仓历史 | address(es) | TG/console 跟单信号 |
| **`discovery/`（本方案）** | 周期发现可跟单地址 | 无（拉榜） | log/ 结果文件 + TG（人工据此手动维护 watch.config） |

闭环：**发现（discover）→ 监听（watch）→ 核查（query）**。
