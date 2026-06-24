# HYPE-discovery 深评改造（HFT 过滤 + closedPnl 深评 + 修入口）

## 背景

诊断与数据见 `docs/api-confidence/hype.md §五`。根因：入口 `vlm≥$500万` 门槛系统性筛掉低频交易者（高 vlm 段最低 91 笔/天、低 vlm 段中位 6 笔/天），且无深评层，按 pnl 排序的 top 全是机器人。

## 目标

把 HYPE-discovery 从"只 leaderboard 粗筛→选出机器人"改为"能筛出低频可跟单交易者"：修入口门槛 + 新增深评层（HFT 过滤 + closedPnl 逐笔深评）。

## 范围（涉及文件）

| 文件 | 改动 |
|------|------|
| `service/HYPE-discovery/config.json` | vlm 门槛 $500万→$5万；新增 minEfficiency（pnl/vlm）≥1% |
| `service/HYPE-discovery/api/index.mjs` | 新增 info 封装（clearinghouseState / userFills）+ 限流 gate（并发≤4 + 间隔 + 退避） |
| `service/HYPE-discovery/process/filter.mjs` | 粗筛加 pnl/vlm 效率门槛 |
| `service/HYPE-discovery/process/evaluate.mjs`（新建） | HFT 频率过滤 + closedPnl 逐笔 PF/胜率/回撤/净利 + marginUsed 下注规模 |
| `service/HYPE-discovery/process/score.mjs`（新建） | 多维归一加权打分 |
| `service/HYPE-discovery/main.mjs` | 串接 collect→filter→evaluate→score→output |
| `service/HYPE-discovery/process/output.mjs` | 展示深评字段（PF/胜率/fills每天/保证金） |

## 参数（数据校准，见 hype.md §五）

- 粗筛：vlm ≥ $5万、pnl/vlm ≥ 1%（候选 879）
- 深评门槛：fills/天 ≤ 50（HFT 过滤）、PF ≥ 1.5、RF ≥ 1.0（沿用 sodex balanced）
- HFT 口径：userFills 2000 笔跨度算 fills/天；达 2000 上限直接判 HFT

## 状态机 / 数据契约

候选流转：`leaderboard 行 → 粗筛(pnl/vlm/efficiency) → 深评(HFT过滤→closedPnl统计→门槛) → 打分 → topK`。

深评数据源契约（HYPE 逐笔，见 hype.md §二）：
- 盈亏：`userFills[].closedPnl`（逐笔已实现，权威，非回放）
- 频率：`userFills[].time` 跨度
- 下注规模：`clearinghouseState` 活跃仓 `marginUsed`（精确）

## 验收场景

### 场景 1：机器人被滤
- Given：leaderboard top（pnl 高、fills/天 数千）
- When：跑 evaluate
- Then：fills/天 > 50 的账号在深评被剔除（reason=HFT）

### 场景 2：低频高手入选
- Given：低 vlm 高 pnl/vlm 账号（如 pnl $76k / vlm $651k / 0.3 笔/天）
- When：粗筛通过 + 深评
- Then：进入推荐名单，展示 PF/胜率/fills每天/保证金

### 场景 3：粗筛缩候选
- Given：39244 行 leaderboard
- When：vlm≥$5万 & pnl/vlm≥1%
- Then：候选 ≈ 879（非上万），深评可在限流下完成

### 场景 4：限流不触发封禁
- Given：879 候选逐个拉 userFills
- When：并发≤4 + 间隔 + 429 退避
- Then：全部完成，无 Hyperliquid 封禁

### 场景 5：closedPnl 深评正确
- Given：某账号 userFills 含 closedPnl
- When：算 PF=Σ正closedPnl/Σ负closedPnl、胜率、净利、回撤
- Then：与逐笔账本一致；PF<1.5 或 RF<1.0 被淘汰

## 实现蓝图

- 复用 sodex-discovery 的 evaluate/score 结构（门槛+双通道+归一加权）+ 限流 gate（CONCURRENCY=4/MIN_INTERVAL/退避）。
- evaluate 集成点：main.mjs 在 filter 后、output 前插入 evaluate→score（替换现有 rankTopK）。
- HFT 过滤在 evaluate 最前（先剔高频，省后续计算）。
- closedPnl 逐笔统计：遍历 userFills，正/负 closedPnl 累加 → PF/净利；按 closedPnl 时间序列算回撤。

## 排除（不做）

- 不改 leaderboard 数据源
- 不做 trades 逐笔回放（HYPE closedPnl 现成）
- 不动 sodex-discovery
