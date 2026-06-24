# 单账户按币种交易画像（coin-profile）

`service/sodex-discovery/profile.mjs` 的配套文档：输入一个账户，输出其**各币种**的交易质量明细 + 专精/盈亏标签。
回答「这个地址擅长哪个币、在该币做得怎样」——这是 `query.mjs`（仓位快照）和 discovery（全币种合并总账）都答不了的问题。

> 定位：**分析/情报工具**，不是跟单赚钱机器。实测数据已证伪「靠跟单小额币种专精户赚钱」（500 池 ETH 盈利户净利中位仅 $40）。价值在「理解谁在做什么币、做得如何」这一确定性产出。
> 完整设计见 spec `.claude/kit/spec/2026-06-24-coin-trader-profile.md`。

## 一、为什么需要

全局 PNL 榜靠前 ≠ 在某币种上盈利。实测 `account_id=3602` 全局靠前完全靠 ETH（+$48069），但其 BTC −$20342。「某币种谁在盈利」藏在账户内部，**必须按 `symbol_id` 切片才看得到**。

## 二、用法

```bash
# 按 account_id 直接查
node service/sodex-discovery/profile.mjs --account=3602

# 按钱包地址查（经链上解析为 accountId）
node service/sodex-discovery/profile.mjs --address=0x584743497098d00733d5d29fe80e020280427027

# 额外落盘 JSON（机读）
node service/sodex-discovery/profile.mjs --account=3602 --save
```

| 参数 | 说明 |
| --- | --- |
| `--account=<id>` | 交易所 account_id，直接使用 |
| `--address=<0x..>` | 钱包地址，经 `{chain}/chain/address/{addr}/accounts` 解析为 primaryAccountId |
| `--save` | 额外写 `log/profile-<account>-<YYYY-MM-DD-HHMM>.json`（全币种画像 + 整体画像） |

`--account` 与 `--address` 二选一，前者优先。

## 三、数据来源（唯一接口）

`GET /api/v1/perps/positions?account_id=&limit=1000` —— 逐笔平仓真账本，每条带 `symbol_id` + 权威 `realized_pnl`。币种切片、集中度、各币种指标**全部从这一份数据派生，零额外请求**。币名映射走 `biz/futures/symbols`（symbol_id→baseCoin，失败回退 `#<id>`）。

> 为什么只用 positions：`realized_pnl` 是唯一权威盈利源，overview 聚合字段受充提污染（详见 `api-confidence/sodex.md`）。

## 四、输出字段

每币种一行（按集中度 `pnlShare` 降序）：

| 列 | 含义 |
| --- | --- |
| 币种 | baseCoin（映射缺失时 `#<symbol_id>`） |
| 笔数 | 该币已平仓位数 |
| 胜率 | `realized_pnl>0 笔数 / 笔数` |
| 盈亏比 | `Σ盈利 / |Σ亏损|`（无亏→∞） |
| 净盈亏 | 该币 `Σ realized_pnl`（盈利口径，历史回看） |
| 集中度 | `|该币净盈亏| / Σ|全币种净盈亏|`（专精口径） |
| 活跃天 | 该币首末交易间隔天数 |
| 标签 | 专精档 × 盈亏（+ 样本不足）|

**标签口径**：
- 专精档（按集中度）：`专精 ≥0.7` / `主力 0.4–0.7` / `涉猎 <0.4`（描述性分档，可校准）。
- 盈亏：该币 `净盈亏 > 0` → 盈利，否则亏损。
- `样本不足`：该币 < 8 笔（统计噪声大），标注但不淘汰。

**整体画像**：取集中度最高且盈利的币种合成一句话（如 `ETH 主力盈利手（占比 38%，+$48069）`）；无盈利币种 → `无明显盈利主力`。

## 五、已知限制

- **活跃仓位 `cr` 缺口**：positions 只统计已平仓位（size=0），漏掉持仓中已实现的 `cr`（详见 `api-confidence/sodex.md §六`）。滚仓型/长期持仓型账户单币种统计会偏低估。
- **小样本噪声**：单币 < 8 笔的胜率/盈亏比是噪声，标 `样本不足`，不隐藏。
- **截断**：positions 命中 limit 上限（≥1000 条）时整体标 `⚠截断`。
- **币名映射依赖** `biz/futures/symbols` 可用性，缺失以 `#<id>` 显示，不阻断。

## 六、HYPE 对称扩展（待实现）

Hyperliquid 的同款画像因数据模型不同而口径有别，已单独 spec：`.claude/kit/spec/2026-06-24-hype-coin-trader-profile.md`。
关键差异：盈利源用 `userFills.closedPnl`（逐笔权威）按 `coin` 切片；**不展示 PF/胜率**——实测每币完整仓位周期仅 1~2 笔（大仓滚仓 + 2000 笔上限截断），trade 级 PF/胜率失真，故只用 Σ closedPnl 净利 + 笔数 + 集中度 + 名义规模。代码落 `service/HYPE-discovery/profile.mjs`。

## 七、与其它脚本的关系

| 脚本 | 职责 | 入参 |
| --- | --- | --- |
| `sodex-watch/query.mjs` | 当前仓位 + 委托快照 | address |
| `sodex-discovery/main.mjs` | 周期发现可跟单地址（全币种合并） | 无（拉榜） |
| **`sodex-discovery/profile.mjs`（本工具）** | 单账户按币种画像 + 标签 | account_id / address |
