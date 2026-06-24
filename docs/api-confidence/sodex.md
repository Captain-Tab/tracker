# Sodex 接口字段置信度（实测）

> 用途：跟单候选发现/分析时，哪些接口字段能作筛选依据，哪些受充提/口径污染**不可参考**。
> 证据来源：2026-06-23 对 5 个真实账户实测（account_id：17139 PLTR赚 / 192916 XAut赚 / 204502 USTECH100赚 / 3602 ETH-PLTR赚 / 1046 MW），逐笔真账本与 overview 聚合字段交叉比对。
> 数据源域名：`https://mainnet-data.sodex.dev`（全链路 public 只读，无鉴权）。

---

## 一、接口清单

| 接口 | 路径 | 角色 | 可用性 |
|------|------|------|--------|
| `fetchLeaderboard` | `/api/v1/leaderboard?window_type=&sort_by=pnl&page=&page_size=` | 漏斗入口（便宜） | 稳定 |
| `fetchOverview` | `/api/v1/wallet/portfolio/overview?account_id=&window=` | PNL 分项聚合 | **频繁 503** |
| `fetchChart` | `/api/v1/wallet/portfolio/chart?account_id=&window=` | 每日 pnl 序列 | 未专项实测 |
| `fetchPositions` | `/api/v1/perps/positions?account_id=&limit=` | **仓位级平仓真账本**（realized_pnl 权威） | 稳定，默认 40，靠 limit 拿全 |
| perps/trades | `/api/v1/perps/trades?account_id=&limit=` | **逐笔成交流水**（频率/手续费校正） | 稳定，默认 40，**limit 上限 1000**（拿不全历史） | 
| `resolveAccountIdViaChain` | `{chain}/chain/address/{addr}/accounts` | address→accountId | 稳定 |

---

## 二、字段置信度分级

### ✅ 高置信（可作筛选/盈利判定依据）

| 字段 | 来源 | 证据 |
|------|------|------|
| `realized_pnl`（逐笔） | `fetchPositions` | **唯一权威盈利源**。2566 全量 133 笔 Σ=$19,216，与方向一致；逐笔为单仓位真实已实现，不含充提 |
| `max_size` × `avg_entry_price` | `fetchPositions` | 开仓名义敞口可算，且与 `overview.volume` 交叉吻合（见下） |
| `created_at` / `updated_at` | `fetchPositions` | 持仓时长、活跃跨度、近 N 天时效，时间戳口径可靠 |
| `volume_usd` | `fetchOverview` | **三账户与逐笔名义高度吻合**：2566 $20,840k vs 逐笔×2 $20,563k；XAut $6,161k vs $5,304k；MW $951k vs $1,058k。可信 |
| `account_id` / `wallet_address` / `rank` | `fetchLeaderboard` | 结构性字段 |
| `ts_ms` / `price` / `quantity` / `fee` / `is_maker` | perps/trades | 逐笔成交，校正真实交易频率/手续费（无 per-trade pnl） |

### ❌ 低置信 / 不可参考（**禁止**作盈利筛选）

| 字段 | 来源 | 污染证据 |
|------|------|----------|
| `perps_closed_pnl_usd` | `fetchOverview` | **系统性失真**。三账户近 30 天逐笔真账本 vs 该字段全部对不上：2566 真 **+$3,072** / 字段 **−$6,129**；ETH 真 +$12,502 / 字段 +$2,878；MW 真 −$3,704 / 字段 −$7,566。混入充提/资金费。**曾导致真盈利账户在粗筛被误杀** |
| `roi` | `fetchOverview` | **完全不可用**。出现 7940%、36421% 等荒谬值（分母为净值快照/净入金，被充提污染至趋零） |
| `total_pnl_usd` | `fetchOverview` | 受 `net_deposit` 污染。2566 7D total=$7,941 但同期 perps_closed=−$19,608，差额来自净提款 −$29,670。表达的是"账户净值变化"而非"交易盈亏" |

### ⚠️ 中置信（仅作辅助信号，不单独决策）

| 字段 | 来源 | 说明 |
|------|------|------|
| `net_deposit_usd` | `fetchOverview` | 仅用于 antiAirdrop（净入金为负 + 逐笔几乎不赚 → 疑似空投农民），不作盈利判定 |
| `spot_pnl_usd` | `fetchOverview` | 现货盈亏，未专项验证；原 perps 主导判定依赖它+污染的 perps_closed，已废弃 |

---

## 三、503 处理方式

`overview` 接口高频偶发 503（30D/90D/1Y 尤甚，同一账户时好时坏，属临时不可用）。

处理：`service/sodex-discovery/api/index.mjs` 将 `503` 纳入重试集合 `THROTTLE_STATUSES`（与 429/409 同列），由 `fetchWithRetry` 走指数退避（2→4→8…封顶 60s，±20% jitter），最多 `MAX_RETRIES=6` 次。

效果实测：filter 误杀率从 **88%**（25 候选 22 淘汰，绝大多数为 503）降至 **5/25**。

---

## 四、截断陷阱（limit）

`fetchPositions` **默认只返 40 条**，`page/size/offset` 全部无效，必须显式传 `limit` 拿全量。

证据：未传 limit 时 2566 只拿 40 条 Σ=$2.8k（严重低估）；传 `limit=1000` 后拿全 133 条 Σ=$19.2k。实测单账户最多 445 条（MW），响应体 ~220KB，1000 足够覆盖且内存安全。当前 `positionsLimit=1000`。

---

## 五、当前算法用法

跟单发现/评估的全部交易形态指标（胜率/盈亏比/持仓时长/最大回撤/活跃跨度/单笔盈亏/开仓名义）**均基于 `fetchPositions` 逐笔平仓真账本**，盈利不再读任何 overview 聚合字段（仅 `volume`/`net_deposit` 作辅助）。

> 注：盈利/形态用 `fetchPositions`（仓位级 realized_pnl 权威）。逐笔成交流水另有 REST `/api/v1/perps/trades`（含 ts_ms/price/quantity/fee/is_maker，**无 per-trade pnl**；单次 limit 上限 1000，但响应带 `meta.next_cursor`，**cursor 分页可拿全历史**）。trades 仅用于校正**真实交易频率**——实测仓位频率严重低估真实成交频率（单仓由 3~83 笔成交拼成），盈利校正仍需 positions。

---

## 六、仓位生命周期 & 活跃仓位已实现利润缺口（重要，影响 discovery 正确性）

**仓位模型（实测）**：一个 `position_id` 是一轮**持仓周期**——从 0 开仓 → 反复加减仓 → 完全平掉（size=0）才结束。`realized_pnl`/`cr` 在仓位**还活着时就随每次部分减仓累积**，不需要 size=0。证据：0727h（aid 3602）活跃仓位 BTC `cc`(累计已平)=4.5 > `ms`(最大持仓)=2.4、ETH `cc`=221 > `ms`=90 —— 同一未平仓位内反复滚仓，`cr` 已累积 −$1730 / +$2404。

**两个独立接口，各持一半已实现利润**：

| 接口 | 覆盖 | 已实现利润字段 |
|------|------|----------------|
| `/api/v1/perps/positions`（平仓历史） | 已平仓位（size=0） | `realized_pnl` |
| `/api/v1/perps/accounts/{address}/state`（当前状态，gateway 域名） | **活跃仓位**（sz≠0） | `P[].cr`（已实现）/ `ur`（浮盈，不算已实现）|

> state 的 `P[]` 字段缩写：`i`=position_id `sz`=当前size `ms`=max_size `cc`=累计已平量 `cr`=已实现 `ur`=未实现 `ep`=均价 `cp`=均平价 `cf`=资金费 `ct/ut`=创建/更新时间。

**完整已实现利润 = 平仓历史 Σ`realized_pnl` ＋ 当前活跃仓位 Σ`cr`**（浮盈 `ur` 不计）。

**⚠️ 已知缺陷**：discovery `evaluate.mjs` 的 `positions.filter(size===0)` 只取平仓历史，**漏掉活跃仓位的 `cr`**。后果：
- **滚仓型/长期持有型账号被系统性低估**——极端情况下，全靠"持仓不平、反复高抛低吸"的高手平仓历史几乎为空，仓位数（`nTrades`）很少，会因 `nTrades < 8` 触发资格门槛被**误杀**。
- 连带 `nTrades`（已平仓位数）当频率代理也失真——实测仓位数严重低估真实成交频率（0727h 318 仓位 vs 111 笔/天成交；USTECH100 12 仓位 vs 384 笔/天）。基于 nTrades 的"低频精准/中频稳健"分类**语义不准**。

**处置决定（2026-06-23）**：

| 危害 | 处置 | 理由 |
|------|------|------|
| nTrades 当频率代理的**标签误导** | ✅ **正名**：代码/输出把 `nTrades` 明确为"已平仓位数"，不再暗示成交频率（0 请求） | 零成本消除误导 |
| 滚仓型**资格门槛误杀** + 评估不可靠 | ⏸️ **记录为盲区，暂不修** | 彻底解需 trades 逐笔回放（盈亏质量必须基于已结束交易，活跃仓位 `cr` 无逐笔结构，无法算 PF/胜率）；该方案请求暴增（cursor 全量 ~17 次/账号）+ funding 回放风险，且**滚仓型至今未在样本中观测到**，必要性未证明。等真观测到滚仓型候选再评估是否上回放。 |

> 不采用"低频候选查 trades 让其过资格"的折中方案：它能让滚仓型过资格，但 PF/胜率仍基于极少已平仓位、统计不可靠——过了也评不准，是半截子补丁。
