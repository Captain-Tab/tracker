# 单账户按币种交易画像（coin-profile · HYPE）

`service/HYPE-discovery/profile.mjs` 的配套文档：输入一个 HYPE 钱包地址，输出其**各币种**的交易质量明细 + 专精/盈亏标签。
回答「这个地址擅长哪个币、在该币做得怎样」——这是 leaderboard 粗筛和 discovery（多维深评打分）都答不了的问题。

> 定位：**分析/情报工具**。HYPE 的盈利源是 `userFills.closedPnl` 逐笔权威已实现盈亏（官方计算），按 `coin` 切片即得各币净利，无需仓位回放。
> sodex 对称版见 [sodex.md](./sodex.md)；两者口径差异见本文 §六。

## 一、为什么需要

leaderboard 按全局 pnl 降序，靠前 ≠ 在某币种上盈利，且头部全是 HFT 机器人（见 `api-confidence/hype.md §四`）。某地址「在哪个币赚、在哪个币亏」藏在其逐笔成交里，**必须按 `coin` 切片才看得到**——一个地址 BTC 大赚、ETH 大亏，合并看只剩净额，专精方向被抹平。

## 二、用法

```bash
# 按钱包地址画像
node service/HYPE-discovery/profile.mjs --address=0xd05808946809c180d190608e13f473db30aa8524

# 额外落盘 JSON（机读）
node service/HYPE-discovery/profile.mjs --address=0x... --save
```

| 参数 | 说明 |
| --- | --- |
| `--address=<0x..>` | HYPE 钱包地址，直接作为 `userFills` 的 `user` 入参（合法性由 `isAddress` 校验） |
| `--save` | 额外写 `service/HYPE-discovery/log/profile-<address>-<YYYY-MM-DD-HHMM>.json`（全币种画像 + 整体画像） |

成交记录 < 2 笔时直接提示「记录不足，无法画像」并退出。

## 三、数据来源（唯一接口）

`POST https://api.hyperliquid.xyz/info` `{type:"userFills", user}`（封装 `fetchUserFills`）—— 逐笔成交真账本，每条带 `coin` + 权威 `closedPnl` + `fee` + `sz` + `px` + `side` + `startPosition` + `time`。币种切片、净利、集中度、名义规模、完整周期数**全部从这一份数据派生，零额外请求**。

> 为什么只用 userFills：`closedPnl` 是官方逐笔已实现盈亏，权威且现成；不必像 sodex 那样回放仓位（详见 `api-confidence/hype.md §二/§三`）。

## 四、输出字段

每币种一行（按集中度 `pnlShare` 降序）：

| 列 | 含义 |
| --- | --- |
| 币种 | `coin`（缺失时 `?`） |
| 净利 | 该币 `Σ closedPnl`（盈利口径，历史回看） |
| 手续费 | 该币 `Σ fee`（正数，成本） |
| 成交 | 该币逐笔 fill 数 |
| 完整交易 | 按 `startPosition` 重建的完整仓位周期数（持仓归 0 计一笔；窗口内未平周期不计入），仅展示是否滚仓型 |
| 中位名义 | 完整周期 `notional` 中位（`Σ|sz×px|`），下注规模 |
| 集中度 | `|该币净利| / Σ|全币种净利|`（专精口径） |
| 标签 | 专精档 · 盈利/亏损 |

**标签口径**：
- 专精档（按集中度 `pnlShare`）：`专精 ≥0.7` / `主力 0.4–0.7` / `涉猎 <0.4`（描述性分档，可校准，与 sodex 对称）。
- 盈亏：该币 `净利 > 0` → 盈利，否则亏损。

**整体画像**：取集中度最高且盈利的币种合成一句话（如 `BTC 主力盈利手（占比 52%，+$48069）`）；无盈利币种 → `无明显盈利主力`。

**capped 标记**：成交总数命中 `userFills` 单次 2000 笔上限时，标题标 `⚠近期窗口(capped，命中 2000 上限)`——此时画像只覆盖近期窗口，非全史。

## 五、已知限制

- **2000 笔上限截断**：`userFills` 单次最多 2000 笔，活跃/高频账号只覆盖近期窗口，净利/集中度非全史口径（标 `capped`）。
- **完整交易仅作展示**：窗口内未平仓的周期（`open` 残留）不计入完整交易数，故大仓滚仓型账号「完整交易」会偏少，不参与标签判定。
- **币名依赖逐笔 `coin` 字段**：缺失以 `?` 归并，不阻断。
- **资金费不在 closedPnl 内**：`userFunding` 的资金费收付不计入本画像净利（与盈利判定一致采用 closedPnl 口径，资金费修正见 `api-confidence/hype.md §一`）。

## 六、与 sodex 版的口径差异

| 维度 | HYPE（本文） | sodex |
| --- | --- | --- |
| 入参 | `address`，直接作 `userFills` 的 `user`，无链上 accountId 解析 | `account_id`（或 address 经链上解析为 accountId） |
| 盈利源 | `userFills.closedPnl` **逐笔**权威 | 仓位级 `realized_pnl`（已平仓位） |
| PF / 胜率 | **不展示** | 展示 |
| 展示维度 | 净利 + 笔数 + 完整周期 + 中位名义 + 集中度 | 笔数 + 胜率 + 盈亏比 + 净盈亏 + 集中度 + 活跃天 |

**为何 HYPE 不展示 PF / 胜率**（见 `process/coinSlice.mjs` 注释）：实测每币完整仓位周期常仅 1~2 笔——大仓滚仓把一笔交易拆成数十个 fill，叠加 2000 笔上限截断，trade 级 PF/胜率在单币粒度上极易失真（样本过稀）。故 HYPE 单币只用 **Σ closedPnl 净利 + 笔数 + 集中度 + 名义规模**这些对稀疏样本稳健的维度，不在每币上算 PF/胜率。

## 七、与其它脚本的关系

| 脚本 | 职责 | 入参 |
| --- | --- | --- |
| `HYPE-watch/*` | 当前持仓 + 账户保证金快照 | address |
| `HYPE-discovery/main.mjs` | 周期发现可跟单地址（leaderboard 粗筛 → 交易级深评 → 打分 topK） | 无（拉 leaderboard） |
| **`HYPE-discovery/profile.mjs`（本工具）** | 单地址按币种画像 + 标签 | address |
