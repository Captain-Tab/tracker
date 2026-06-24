# 用户币种画像与标签（coin-trader-profile）

> 在 `service/sodex-discovery/` 内新增「单账户按币种交易画像」工具：输入一个账户，输出其**各币种**的交易质量明细 + 专精/盈亏标签。
> 配套母方案：`.claude/kit/spec/2026-06-20-copy-trade-discovery.md`、`docs/discover-traders-plan.md`、字段置信度 `docs/api-confidence/sodex.md`。

---

## 背景与目的

### 为什么做

现有发现/查询工具都答不了「**这个地址是谁、擅长哪个币、做得怎样**」：

- `sodex-watch/query.mjs` 只给当前仓位快照，无历史质量、无币种维度。
- `sodex-discovery/` 的 `evaluate.mjs` 给的是**全币种合并总账**（胜率/PF/净盈利混所有币），看不出他在某个币上的真实水平。

实测证据（2026-06-24，对 7D 榜前 500 账户跑 positions）暴露核心问题：**全局 PNL 榜靠前 ≠ 在某币种上盈利**。典型 `account_id=3602` 全局靠前完全靠 ETH（+$48069），但其 BTC −$20342。"某币种谁在盈利"藏在账户内部，**必须按 symbol_id 切片才看得到**。

### 目标

给定一个账户，按币种切片其逐笔平仓真账本（`realized_pnl`），产出每个币种的 `笔数/胜率/盈亏比/净盈利/恢复比/活跃跨度/集中度` + 标签（专精档 × 盈亏 × 样本可信度），以及一句话整体画像（如 `ETH 主力盈利手`）。

### 定位（避免过度设计）

本工具定位为**分析/情报工具**，不是"跟单赚钱机器"。实测数据已证伪"靠跟单小额币种专精户赚钱"的假设（500 池里 ETH 盈利户净利中位仅 $40，真专精户 1~2 个）。确定性价值在**画像与标签能力本身**，不依赖"跟了能赚"这一未证明假设。

---

## 选定方案

**方案 A1：在 `service/sodex-discovery/` 内新增入口 + 抽取共享指标内核。**

候选放置方案对比后选定 A1，核心理由：单账户画像 80% 的工作是"指标计算"，而指标内核 `derivePositionMetrics` 与限流版 `fetchPositions` 都已在 discovery；放这里复用最大、零重复基建。相对 A2（不动存量、容忍重复），A1 选择一步抽干净（DRY、单一真相源），承担对已验证 `evaluate.mjs` 的可控回归风险，由其改造后逻辑等价 + 回归对比兜底。

放置候选与取舍：
- A（选定）：discovery 内新增，抽取共享内核。改动小、复用最大。
- B：新建 `service/sodex-profile/` 独立服务。语义最干净但复制 api/限流、跨服务 import 指标内核，改动中、风险中。
- C：放 `sodex-watch/` 挨着 query.mjs。与 query 同类但指标内核在 discovery，跨服务 import 更乱。

---

## 设计概要

### 架构与调用关系

```
profile.mjs (新增入口)
   ├─ api/index.mjs        → fetchPositions(accountId) + refreshSymbols() + resolveAccountId(address)
   └─ process/coinSlice.mjs → 按 symbol_id 分组 → 各币种指标 + 集中度 + 标签   ← 画像内核
                                   │
                                   └─ process/metrics.mjs  deriveMetricsFromClosed(closed, now)  ← 共享指标内核
                                          ▲
                                          └── evaluate.mjs 也调它（全币种=不分组的特例）
```

### 文件改动（3 新增 + 2 改造）

| 文件 | 动作 | 内容 |
|------|------|------|
| `service/sodex-discovery/process/metrics.mjs` | **新增** | 从 `evaluate.mjs` 抽出纯函数 `deriveMetricsFromClosed(closed, now)`：输入一组已平仓记录（size=0），输出 `nTrades/winRate/profitFactor/netProfit/maxDD/recoveryFactor/activeSpanDays/avgHoldMin/maxDayShare/freshNet/maxWin/maxLoss/blowupRatio/medMargin/maxMargin`。逻辑与现有完全等价。 |
| `service/sodex-discovery/process/coinSlice.mjs` | **新增** | `sliceByCoin(positions, now, symbolMeta)`：filter size=0 → 按 `symbol_id` 分组 → 每组调 `deriveMetricsFromClosed` → 追加跨币种派生（集中度、笔数占比）→ 每币打标签 → 返回币种画像数组 + 整体画像。 |
| `service/sodex-discovery/process/evaluate.mjs` | **改造** | `derivePositionMetrics` 改为 `filter(size=0)` 后调 `deriveMetricsFromClosed`，删除内联重复计算。行为不变。 |
| `service/sodex-discovery/api/index.mjs` | **改造** | 新增 `refreshSymbols()`（拉 `biz/futures/symbols`，建 `symbol_id ↔ baseCoin` 映射，参照 `sodex-watch/api/index.mjs:134`）；新增 `resolveAccountId(address)`（`{chain}/chain/address/{addr}/accounts`，参照 api-confidence §一）。 |
| `service/sodex-discovery/profile.mjs` | **新增入口** | CLI：`--account=<id>` 直接用；`--address=<0x..>` 经 resolveAccountId 解析。拉 positions + refreshSymbols → coinSlice → stdout 人读表 + 可选 `--save` 写 `log/profile-<account>-<ts>.json`。 |

### 核心数据结构

每个币种画像项：
```
{
  coin: "ETH", symbolId: 2,
  nTrades, winRate, profitFactor, netProfit, recoveryFactor,
  activeSpanDays, avgHoldMin, maxWin, maxLoss,
  pnlShare,        // |该币净盈亏绝对额| / Σ|全币种净盈亏绝对额|  ← 专精口径
  tradeShare,      // 该币笔数 / 总笔数（展示参考）
  truncated,       // 该账户 positions 命中 limit 上限（统计可能截断）
  label,           // "专精·盈利" / "主力·亏损" / "涉猎·盈利" ...
}
```

整体画像：取 `pnlShare` 最高且盈利的币种合成一句话，如 `ETH 主力盈利手（占比 38%，+$48069）`；无盈利币种则标 `无明显盈利主力`。

### 标签口径

- **专精档（按 `pnlShare`）**：`专精 ≥0.7` / `主力 0.4–0.7` / `涉猎 <0.4`。阈值为**描述性分档**，可按实测分布校准（实测集中度中位 11%、p75 26%，纯专精稀有），不作硬门槛、不淘汰任何币种。
- **盈亏**：该币 `netProfit > 0` → 盈利，否则亏损。盈利口径为历史回看（`realized_pnl` 真账本）。
- **样本可信度**：`nTrades < 8` 的币种标 `样本不足` 后缀，提示统计噪声大。

### 不预设硬阈值

模块1 是单账户画像、**不做候选淘汰**，故不存在"门槛阈值"问题——所有币种全部列出并打标，由人工读标签判断。专精分档线为可校准的展示参数。

---

## 边界与约束

**包含：**
- 单账户按币种切片画像 + 标签 + 整体画像一句话。
- 输入支持 `account_id` 与 `address`（后者经链上解析）。
- stdout 人读输出 + 可选 json 落盘（`--save`）。
- 共享指标内核 `metrics.mjs` 抽取，`evaluate.mjs` 复用之（A1）。

**不包含：**
- **模块2 币种专精发现**（对候选池逐个跑画像 + 排名）：因数据量稀薄（实测某币种盈利专精户个位数、净利中位 $40），参考价值低，本期不做。待有足够数据量或明确需求再评估，届时复用 `coinSlice.mjs` 内核。
- **模块3 watcher 币种过滤**（watch 条目加 `coins` 字段，只跟目标指定币种单）：本期不做，仅记录。与模块2 价值绑定——watcher 现状（`sodex-watch/config.json` 条目仅 `{address,tgChat,label,at}`）按地址全盘镜像、不分币种；没有模块3，"只跟某用户的 ETH 单"在执行端不成立，模块2 选出的杂食型盈利户跟单会复制其非目标币种盈亏。
- 现货、实际下单/上链、预测建模（仅历史回看）。

**已知限制：**
- **活跃仓位 `cr` 缺口**（api-confidence §六）：positions 只统计已平仓位（size=0），漏掉持仓中已实现的 `cr`。滚仓型/长期持仓型账户的单币种统计会被低估，切到单币后样本更小、放大此低估。MVP 不补，截断账户标 `⚠截断`。
- **小样本噪声**：单币种 <8 笔的胜率/PF 是噪声，标 `样本不足`，不隐藏。
- **币名映射依赖** `biz/futures/symbols` 可用性；映射缺失时币种以 `#<symbol_id>` 显示，不阻断。

---

## 集成点

| 现有文件 / 接口 | 用途 |
|----------------|------|
| `service/sodex-discovery/process/evaluate.mjs` | 抽取 `deriveMetricsFromClosed` 至 metrics.mjs 并改为复用（改造目标） |
| `service/sodex-discovery/api/index.mjs` | 复用 `httpGetJson`/`fetchPositions`/限流；新增 `refreshSymbols`、`resolveAccountId` |
| `service/sodex-watch/api/index.mjs:134` | `refreshSymbols` 实现参照（symbol_id↔baseCoin、精度字段） |
| `GET /api/v1/perps/positions?account_id=&limit=1000` | 唯一数据接口，逐笔平仓真账本 |
| `GET {biz}/biz/futures/symbols?env=mainnet` | 币种元数据（id→baseCoin） |
| `{chain}/chain/address/{addr}/accounts` | address→account_id 解析 |
| `docs/api-confidence/sodex.md` | 字段置信度依据（realized_pnl 权威、overview 字段禁用、limit 截断、§六 cr 缺口） |

---

## 验收标准

- [ ] `node service/sodex-discovery/profile.mjs --account=3602` 输出 ETH 行：约 `38 笔 / 63%win / PF≈2.48 / 净≈+$48069`，标签含「盈利」。
- [ ] 同一账户输出 BTC 行为亏损（`netProfit<0`，约 −$20342），标签含「亏损」。
- [ ] `--address=0x584743497098d00733d5d29fe80e020280427027` 经链上解析得到与 `--account=3602` 一致的画像。
- [ ] 各币种 `pnlShare`（绝对额口径）之和 ≈ 1（浮点容差内）。
- [ ] 某币种 `nTrades < 8` 时标签带「样本不足」后缀，且该币种仍出现在列表中（不淘汰）。
- [ ] positions 命中 limit 上限（返回 ≥1000 条）时该画像标 `⚠截断`。
- [ ] `metrics.mjs` 抽取后，对同一账户跑改造前后的 `evaluate`，全币种指标（胜率/PF/netProfit/maxDD/recoveryFactor/activeSpanDays）逐项一致。
- [ ] 币名映射不可用时，币种以 `#<symbol_id>` 显示且流程不崩。
- [ ] `--save` 生成 `log/profile-<account>-<ts>.json`，含全币种画像数组 + 整体画像。
- [ ] 整体画像一句话正确取 `pnlShare` 最高的盈利币种；无盈利币种时标 `无明显盈利主力`。

---

## 验收场景

### 场景 1：Happy Path — 按 account_id 出多币种画像
- **Given** 账户 `account_id=3602` 在 positions 真账本中有已平仓位覆盖 ETH（38 笔、净≈+$48069）与 BTC（97 笔、净≈−$20342），且 positions 返回 < 1000 条（未截断）
- **When** 执行 `node service/sodex-discovery/profile.mjs --account=3602`
- **Then** stdout 按 `pnlShare` 降序列出各币种行，ETH 行显示 `63%win / PF≈2.48 / +$48069 / 盈利`，BTC 行显示净为负且标签含「亏损」，末尾输出整体画像一句话

### 场景 2：address 输入经链上解析
- **Given** 地址 `0x584743497098d00733d5d29fe80e020280427027` 在链上对应 `account_id=3602`，链上解析接口可用
- **When** 执行 `node service/sodex-discovery/profile.mjs --address=0x584743497098d00733d5d29fe80e020280427027`
- **Then** 解析得到 `account_id=3602` 并输出与场景 1 完全一致的画像

### 场景 3：边界 — 单币种样本不足
- **Given** 某账户在 SOL 上仅有 3 笔已平仓位（`nTrades=3 < 8`）
- **When** 对该账户执行 profile
- **Then** SOL 行正常显示指标，标签带「样本不足」后缀，且仍出现在列表中（不淘汰）

### 场景 4：异常 — 币名映射不可用
- **Given** `biz/futures/symbols` 接口返回空或失败
- **When** 对任意账户执行 profile
- **Then** 各币种以 `#<symbol_id>`（如 `#2`）显示，指标计算正常，流程不崩

### 场景 5：回归 — evaluate 抽取等价
- **Given** 抽取 `deriveMetricsFromClosed` 至 metrics.mjs 之后，选取任一账户（如 `account_id=1046`，445 条平仓）
- **When** 对比改造前后 `evaluate` 的 `derivePositionMetrics` 输出
- **Then** 全币种合并指标（nTrades/winRate/profitFactor/netProfit/maxDD/recoveryFactor/activeSpanDays/maxDayShare/freshNet）逐项一致
