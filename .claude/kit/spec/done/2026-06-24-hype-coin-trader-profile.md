# HYPE 用户币种画像与标签（hype-coin-trader-profile）

> 把 sodex 的「单账户按币种交易画像」对称扩展到 Hyperliquid（HYPE）。在 `service/HYPE-discovery/` 内新增入口。
> 母方案（sodex）：`.claude/kit/spec/2026-06-24-coin-trader-profile.md`；HYPE 接口置信度：`docs/api-confidence/hype.md`。

## 背景与目的

### 为什么做

sodex 已有「单账户按币种画像」（profile.mjs），HYPE 缺对称能力。HYPE 是手动跟单的主要场景之一（HYPE-watch 已在监听，且 watch 标注本就是按币种的：①BTC+ETH、③ZEC+BTC），需要回答「**这个 HYPE 地址擅长哪个币、在该币赚多少**」。

实测证据（2026-06-24，对 HYPE-watch 地址 `0xd05808...8524` 跑 userFills）：人工标注「③ZEC+BTC」与逐笔数据完全吻合——ZEC 1180 笔/Σ closedPnl $565k、BTC 370 笔/$282k 主导。证明 HYPE 上「按币种」语义天然成立、且画像可校验。

### HYPE 与 sodex 的数据模型差异（决定不能复用 sodex 内核）

| | HYPE | sodex |
|---|---|---|
| 盈利源 | `userFills.closedPnl`（逐笔，官方计算，权威，现成） | `positions.realized_pnl`（仓位级） |
| 币种字段 | 每笔 fill 自带 `coin` | positions 带 `symbol_id`，需 refreshSymbols 映射 |
| 交易重建 | `aggregateTrades` 按 coin 重建仓位周期（一笔交易常拆数十 fill） | 仓位即交易单元 |
| 拉取上限 | 2000 笔/次（活跃账户仅近期窗口） | limit=1000，多数账户全史 |

→ sodex 的 `metrics.mjs`（deriveMetricsFromClosed）/ `coinSlice.mjs` **不能复用**（数据模型正交）；但 HYPE 自身的 `aggregateTrades`（`HYPE-discovery/process/evaluate.mjs:30`，已按 coin 分组）可复用。

### 关键指标发现（实测，决定口径）

按币种做 trade 聚合后，**每币完整交易常仅 1~2 笔**（大仓滚仓 + 2000 截断把未平周期切掉，实测 ZEC 1180 fills→仅 2 完整交易、SPCX 358 fills→0）。后果：trade 级 **PF/胜率全是 100%/∞，统计失真不可靠**。但**逐笔 `closedPnl` 求和（净利）是权威可信的**。

→ **HYPE 按币种只用 Σ closedPnl 净利 + 笔数 + 集中度 + 名义规模，不展示 PF/胜率**（避免 100%/∞ 误导）。这是与 sodex coin-profile 的核心口径差异。

### 目标

给定一个 HYPE 地址，按 `coin` 切片其 userFills，产出每币种 `净利(Σ closedPnl)/fill笔数/完整交易数/中位名义/集中度` + 标签（专精档 × 盈亏），及整体画像一句话（如 `ZEC 专精盈利手`）。定位为分析/情报工具。

## 选定方案

**在 `service/HYPE-discovery/` 内新增 `profile.mjs` + `process/coinSlice.mjs`，复用本地 `aggregateTrades` 与 `api.fetchUserFills`。**

候选对比：
- A（选定）：HYPE-discovery 内新增，复用本地 aggregateTrades。改动小、与 sodex profile 对称、不跨服务。
- B：抽两交易所共享层。否决——数据模型正交（positions vs fills），强抽象会拧巴、过度设计。

## 设计概要

### 架构与调用关系

```
profile.mjs (新增入口)
   ├─ api/index.mjs        → fetchUserFills(address)   ← 唯一数据接口（1 次/账户）
   └─ process/coinSlice.mjs → 按 coin 分组 → 每币 Σ closedPnl 净利 + 完整交易数 + 集中度 + 标签
                                   │
                                   └─ aggregateTrades（复用 evaluate.mjs，按 coin 重建周期，仅取完整交易数）
```

### 文件改动（2 新增 + 1 改造）

| 文件 | 动作 | 内容 |
|------|------|------|
| `service/HYPE-discovery/process/coinSlice.mjs` | **新增** | `sliceByCoin(fills, opts)`：按 `f.coin` 分组 → 每币算 Σ closedPnl(净利) / nFills / 完整交易数(调 aggregateTrades) / 中位名义 / 集中度 pnlShare → 标签 → 整体画像 |
| `service/HYPE-discovery/process/evaluate.mjs` | **改造** | `aggregateTrades` 从 `__internals` 提升为具名 `export`（供 coinSlice import），逻辑不变 |
| `service/HYPE-discovery/profile.mjs` | **新增入口** | CLI：`--address=<0x..>` / `--save`；fetchUserFills → sliceByCoin → stdout 人读表 + 可选 `log/profile-<addr>-<ts>.json` |

### 核心数据结构

每币种画像项：
```
{
  coin: "ZEC",          // 原样（含 xyz: 前缀币种，如 "xyz:SPCX"）
  netPnl,               // Σ 该币 closedPnl（权威净利，盈利口径）
  feeTotal,             // Σ 该币 fee（展示透明用）
  nFills,               // 该币 fill 笔数
  nTrades,              // 完整仓位周期数（aggregateTrades 后该 coin 的周期数；展示是否滚仓型）
  medNotional,          // 中位单笔交易名义
  pnlShare,             // |netPnl| / Σ|各币 netPnl|（集中度，专精口径）
  label,                // "专精·盈利" / "主力·亏损" / "涉猎·盈利"（无 PF/胜率）
}
```

整体：`{ coins:[...], overall, totalFills, capped }`。`capped = totalFills >= 2000`。
整体画像：取 pnlShare 最高且盈利的币种 → `ZEC 专精盈利手（占比 53%，+$565688）`；无盈利币种 → `无明显盈利主力`。

### 标签口径

- **专精档（按 pnlShare）**：`专精 ≥0.7` / `主力 0.4–0.7` / `涉猎 <0.4`（与 sodex 对称，可校准）。
- **盈亏**：该币 `netPnl > 0` → 盈利，否则亏损。
- **不含 PF/胜率/样本不足档**：HYPE 按币种 trade 周期稀疏，这些指标失真，整体改用 `capped` 标记表达"近期窗口"局限。

### 不展示 PF/胜率（与 sodex 的关键差异）

sodex coin-profile 展示 winRate/PF；HYPE **不展示**——实测每币完整交易仅 1~2 笔，PF/胜率恒为 100%/∞ 失真。HYPE 主打 **净利 + 笔数 + 集中度 + 名义规模**。

## 边界与约束

**包含：**
- 单 HYPE 地址按 `coin` 切片画像 + 专精/盈亏标签 + 整体画像一句话。
- 盈利口径 = Σ 逐笔 closedPnl（权威）。
- stdout 人读 + 可选 json 落盘（`--save`）。
- `aggregateTrades` 提升为 export 供复用（逻辑不变）。

**不包含：**
- **PF / 胜率 / 恢复比**（HYPE 按币种 trade 周期稀疏，失真，不展示）。
- **全史翻页**（userFillsByTime）：本期只拉 1 次 userFills（近期 ≤2000 笔窗口），capped 标记提示局限；全史翻页列为 future（请求成本高）。
- 复用 sodex `metrics.mjs`/`coinSlice.mjs`（数据模型正交，不跨服务复用）。
- clearinghouseState（活跃仓位浮盈）、下单上链、TG 推送、预测建模。

**已知限制：**
- **2000 笔上限**：活跃账户只覆盖近期窗口，单币种完整交易周期可能被截断（实测 SPCX 358 fills→0 完整交易，仓位仍开）。capped 标记提示，但单币 netPnl 仍按窗口内 Σ closedPnl 计（部分平仓的 closedPnl 已计入，权威）。
- **完整交易数仅作展示**：nTrades 少不代表不活跃（大仓滚仓型 fill 多但周期少）。
- **fee 不计入 netPnl**：盈利口径取 Σ closedPnl（不含 fee），feeTotal 单列展示。

## 集成点

| 现有文件 / 接口 | 用途 |
|----------------|------|
| `service/HYPE-discovery/process/evaluate.mjs:30` | `aggregateTrades`（按 coin 重建仓位周期）提升为 export 并复用 |
| `service/HYPE-discovery/api/index.mjs` | 复用 `fetchUserFills` + 限流 gate（POST info，已有） |
| `POST https://api.hyperliquid.xyz/info {type:"userFills",user}` | 唯一数据接口，逐笔成交含 closedPnl/coin/fee（上限 2000） |
| `docs/api-confidence/hype.md` | 字段置信度依据（closedPnl 权威、leaderboard 头部全机器人、§五 fill 必须聚合、§六 2000 上限局限） |
| `service/sodex-discovery/profile.mjs` | 对称参照（输出形态、--save、整体画像一句话） |
| `docs/coin-profile.md` | sodex 同款操作文档，HYPE §六 已占位「待实现」，落地后回填本工具用法/输出 |

## 验收标准

- [ ] `node service/HYPE-discovery/profile.mjs --address=0xd05808946809c180d190608e13f473db30aa8524` 输出 ZEC 行：净利约 +$565k（Σ closedPnl）、fill 笔数约 1180，标签含「盈利」。
- [ ] 同一账户输出 BTC 行净利约 +$282k；各币种按 pnlShare 降序排列。
- [ ] 各币种 `pnlShare`（绝对额口径）之和 ≈ 1（浮点容差内）。
- [ ] 输出**不含** PF / 胜率列（仅净利/笔数/完整交易数/中位名义/集中度/标签）。
- [ ] `xyz:SPCX` 等带前缀币种原样显示，不报错。
- [ ] 账户 fills 满 2000 时整体标 `⚠近期窗口(capped)`。
- [ ] 某币种 netPnl < 0 时标签含「亏损」。
- [ ] 整体画像取 pnlShare 最高的盈利币种；无盈利币种时标 `无明显盈利主力`。
- [ ] `aggregateTrades` 提升为 export 后，HYPE-discovery 现有 `node --test` 不退化。
- [ ] `--save` 生成 `log/profile-<address>-<ts>.json`，含全币种画像数组 + 整体画像 + capped。

## 验收场景

### 场景 1：Happy Path — 按 address 出多币种画像
- **Given** HYPE 地址 `0xd05808946809c180d190608e13f473db30aa8524` 的 userFills 中 ZEC（约 1180 fill、Σ closedPnl 约 +$565k）与 BTC（约 370 fill、约 +$282k）主导
- **When** 执行 `node service/HYPE-discovery/profile.mjs --address=0xd05808946809c180d190608e13f473db30aa8524`
- **Then** stdout 按 pnlShare 降序列出各币种行，ZEC/BTC 在前且标签含「盈利」，输出不含 PF/胜率列，末尾整体画像一句话，账户满 2000 笔时标 `⚠近期窗口(capped)`

### 场景 2：边界 — 带前缀币种 + 未平周期
- **Given** 账户在 `xyz:SPCX` 上有大量 fill 但窗口内无完整仓位周期（aggregateTrades 得 0 完整交易）
- **When** 对该账户跑 profile
- **Then** `xyz:SPCX` 行原样显示币名，netPnl 按窗口内 Σ closedPnl 计、nTrades 显示 0，流程不崩、该币种仍在列表中

### 场景 3：异常 — 成交记录不足
- **Given** 某 HYPE 地址 userFills 返回空数组或不足 2 笔
- **When** 对该地址跑 profile
- **Then** 输出明确提示（如「成交记录不足」）并正常退出，不抛异常

### 场景 4：回归 — aggregateTrades 提升 export 不破坏深评
- **Given** `aggregateTrades` 从 `__internals` 提升为具名 export 之后
- **When** 运行 HYPE-discovery 现有测试（`node --test`）
- **Then** evaluate 相关测试全部不退化（aggregateTrades 逻辑未改）
