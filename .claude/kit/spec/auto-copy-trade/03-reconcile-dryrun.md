# Spec 03 · 收敛对账 + 校验门 + dry-run 下单

> 引用总纲 `00-overview.md`。流程 / 状态机 / 共享契约以总纲为准，本文只定义本子单元自身，**冲突以总纲为准**。
> 依赖：Phase0（类型 / `mapSymbol` / api 横切 / mock）、01（配置加载 + 标的映射）、02（资金模型 `computeRatio` / `computeDesired` + 最低本金 `recommendMinCapital`）。
> 落地时本 spec 已读，**勿重新生成**；直接 `/k:task` 执行本阶段。

---

## 背景与目的

对应总纲 §2.2「每仓校验门决策」+ §3.2 `decideLeg` / `diffDelta` / `placeDryRun`，以及 clarify「下单逻辑（校验门→开仓→推送）」「滚仓处理三层」「dry-run」。

本子件把 02 算出的 desired（目标当前可映射净仓 × ratio 折算后的应有仓）落到执行：对账循环对齐**目标当前净仓快照**（非逐 fill）→ 算 delta → 每仓过校验门得 `LegDecision` → 仅 `place` 进入 dry-run would-place（不签名不下单）。本阶段产出可跑的执行器对账主循环，但**只打印 would-place**，真实推送 / 日志的成形归 04，本件只产出 would-place 结构体供 04 消费。

## 选定方案

落点（遵守扁平结构，单文件不建文件夹）：

- `service/HYPE-copy/process/reconcile.mjs` — 纯逻辑：`diffDelta`、对账编排辅助（算 desired→校验→收集 would-place 的顺序铁律）。
- `service/HYPE-copy/process/risk.mjs` — 纯逻辑：`decideLeg`（校验门 LegDecision）+ 各阈值判定（unmappable / mindust / maxpos / capped / noop）。
- `service/HYPE-copy/main.mjs` — 执行器入口，新增**对账循环**（事件触发 + `RECONCILE_INTERVAL` 周期），调用 reconcile / risk，调 `placeDryRun`。
- `placeDryRun` 本体在 api 横切 `service/HYPE-copy/api/index.mjs`（Phase0 已建骨架），本件补 dry-run 实现（拼 IOC 限价 + 滑点保护参考价，不签名）。
- 单测：`service/HYPE-copy/test/domain.test.mjs` 追加本件用例（复用 Phase0 mock）。

## 设计概要

### 数据来源（引用总纲 §3.2）

| 来源 | 函数 | 用途 |
|---|---|---|
| 目标当前可映射净仓 | `fetchTargetState(sodexAddr)` | 对账快照（含保证金 / 杠杆） |
| hype 参考价 | `fetchHypePrices()` → `{coin: midPx}` | desired size 折算 + 滑点保护参考价（allMids/L2） |
| desired 仓 | `computeDesired(目标可映射仓[], ratio, prices)` → `{coin,size}[]` | 02 产出，本件消费 |
| 校验门 | `decideLeg(desiredLeg, current, caps, prices)` → `LegDecision` | 本件定义 |
| delta | `diffDelta(desired[], current[])` → `delta[]` | 本件定义 |
| dry-run 下单 | `placeDryRun(leg, ctx)` → `WouldPlaceLog`（总纲 §3.2 ActionResult） | 本件实现（不签名） |

`current` = 我方 hype 当前持仓。dry-run 无真实成交，**current 恒空**（唯一口径，每轮 desired 即全量 would-place），不引入模拟累计态，避免双实现。

### 对账循环（main.mjs）

触发二选一叠加：① **事件触发**——watch 侧 debounce 后的目标仓变化信号；② **`RECONCILE_INTERVAL` 周期**——兜底轮询。两者都进同一 `reconcileOnce()`，幂等。

`reconcileOnce()` 顺序（**顺序铁律 = 总纲 §2.2**）：
```
① fetchTargetState + fetchHypePrices 拉快照
② computeDesired(目标可映射仓, ratio, prices)        ← 算 desired（02）
③ diffDelta(desired, current) → delta[]              ← 算变动
④ 逐仓 decideLeg(...) → LegDecision                  ← 【校验门】
⑤ 仅 decision==="place" 的 leg → placeDryRun → would-place
⑥ skip-* / noop 收集为告警条目（交 04 推送 / 日志）
```
铁律：校验在下单前，skip 类**绝不进 would-place**（总纲 §6 验收项）。

### `diffDelta(desired, current)`

对齐**净仓**做差，不逐 fill：
```
对每个 coin（desired ∪ current）：
  delta.size = desired.size - current.size   （精度用 process/precision.mjs，禁裸 parseFloat）
  delta.side = sign(delta.size)              （+ 加仓 / − 减仓 / 0 无变动）
返回 delta[]（coin, deltaSize, targetDesiredSize, currentSize）
```
desired 有、current 无 → 开仓；current 有、desired 归零 → 平仓；两侧都有 → 增减仓。这一层天然吸收滚仓中间态：目标 100→150→120→200，无论中途几跳，对账时只看最新 desired（对应 200）与 current 做差，一步对齐到 200（滚仓三层之①）。

### `decideLeg(desiredLeg, current, caps, prices)` → `LegDecision`（总纲 §2.2）

按总纲枚举顺序判定（先命中先返回，互斥）：

| 顺序 | decision | 判定条件 | 动作 |
|---|---|---|---|
| 1 | `skip-unmappable` | `mapSymbol(srcSymbol, srcPlatform) === null`（仅 sodex 跨所源可能命中；hype 同所直通不会） | desired=0，不进下单，**不计入 ratio 分母**（分母在 02 已排除，本件再次保险拦截） |
| 2 | `skip-mindust` | 我方名义 = `|delta.size| × prices[coin]` < 交易所最小名义（$10） | 跳过该仓 + 告警 |
| 3 | `skip-maxpos` | 我方该仓名义 > 余额×`caps.maxPositionPct`（单仓封顶，防目标高杠杆单仓打爆） | 封顶到上限；超出的加仓部分拦截 + 告警 |
| 4 | `skip-capped` | 已触 `caps.maxDeployPct`（部署需求 > 余额×MAX_DEPLOY_PCT） | 该仓不再加（仅拦**加仓**方向；减仓/平仓放行） |
| 5 | `noop` | `|delta| < MIN_DELTA_PCT`（相对目标 desired）或 `< 最小下单量` | 跳过（防碎步追单，滚仓三层之③） |
| 6 | `place` | 以上都不命中 | 进 would-place |

> `caps` = 从 02 / targets 透传的 `{ maxDeployPct, maxPositionPct, minDeltaPct, minNotional, minOrderSize, currentDeployedNotional, availBalance }`。
> `MIN_DELTA_PCT` 用 `target.minDeltaPct`（总纲 §3.1）；最小名义 / 最小下单量来自交易所约束常量。

### 滚仓处理（三层，clarify）

| 层 | 机制 | 落点 |
|---|---|---|
| ① 收敛跳过中间态 | `diffDelta` 对齐最新净仓快照，非逐 fill | 本件 `diffDelta` |
| ② watch 分档去抖 | 上游已合并滚仓信号、降低触发频率 | watch（已存在，本件消费其事件） |
| ③ 最小变动阈值 | `decideLeg` → `noop`（`|delta| < MIN_DELTA_PCT` 或 < 最小下单量） | 本件 `decideLeg` |

### `placeDryRun(leg)`（api 横切，dry-run）

**不签名、不调真实下单**。组装 would-place 结构并返回（推送 / 落盘归 04）：
```
{
  coin, side, size,                 // 来自 delta
  refPx,                            // fetchHypePrices 参考价（allMids；必要时 L2 mid）
  limitPx,                          // IOC 限价 = refPx ± 滑点保护 bps（买 +、卖 −）
  tif: "Ioc",
  slippageBps,                      // 滑点保护带宽
  dryRun: true,
  assetMeta,                        // asset index 等 hype 下单元数据（取自 SDK 类型/换算工具）
}
```
- px / sz 用 `process/precision.mjs` 的 `formatPrice`/`formatSize`（ROUND_DOWN，自实现；**非 `tool/format`**——后者无精度运算，见总纲 §3.3/§3.4）规整为字符串；禁裸 `parseFloat`。
- 滑点保护：限价偏移用 `MAX_SLIPPAGE_BPS`（默认 10~50，blueprint §10.6）；另有 `MAX_CHASE_BPS`（30~100）= 参考价偏离 fill 超此则**放弃跟单**——两者语义不同，勿混用。
- IOC 限价 + 滑点保护**只计算不发送**，dry-run 不触碰 agent key（总纲 §0 前置：dry-run 不需 key）。

## i18n 文案

不涉及（service 端纯逻辑 + JSONL/TG，TG 文案归 04）。

## 边界与约束

- 包含：对账循环（事件 + 周期）；`diffDelta` 净仓做差；`decideLeg` 六分支校验门 + 顺序铁律（unmappable → mindust → maxpos → capped → noop → place）；滚仓三层中本件负责的①③；`placeDryRun` dry-run would-place（IOC 限价 + 滑点保护参考价，不签名）；本件单测。
- 不包含：真实签名 / 真实下单（后续 gated）；推送文案成形与 JSONL 落盘聚合（→ 04）；资金模型 / ratio 锚定 / 最低本金算法（→ 02，本件只消费其产出）；标的映射表本体（→ Phase0/01）。
- `current`（我方持仓）取值约定：dry-run 无真实成交，**current 恒空**（唯一口径，每轮 desired 即首仓全量 would-place，最简、可重放）；不引入模拟累计态，避免双实现与隐式状态漂移。
- `skip-capped` 只拦加仓方向；目标减仓 / 平仓必须放行（风控不应阻止降风险）。

## 集成点

- 上游：`computeDesired` / `computeRatio`（02）、`mapSymbol`（Phase0/01）、`fetchTargetState` / `fetchHypePrices`（api 横切）。
- 下游：would-place 结构 + skip/noop 告警条目交 04（`process/notify` + `log`）。
- `service/HYPE-copy/main.mjs` 对账循环消费 watch 事件 + `RECONCILE_INTERVAL` 定时器。
- 复用：`process/precision.mjs`（px/sz ROUND_DOWN 精度，自实现）、`tool/format`（仅 isAddress/展示）、`@nktkas/hyperliquid`（asset meta / 价格换算类型，不签名）、`lib/WARP`（代理，经 api 横切）。

## 验收标准

- [ ] `diffDelta` 按净仓做差：开仓 / 增仓 / 减仓 / 平仓四类 delta 正确，精度走 `process/precision.mjs`、无裸 `parseFloat`。
- [ ] `decideLeg` **六分支**齐全且按总纲 §2.2 顺序互斥命中：unmappable / mindust / maxpos / capped / noop / place（skip-maxpos 封顶单仓、skip-capped 仅拦加仓）。
- [ ] 顺序铁律：算 desired → 校验门 → **仅 place 进 would-place**；skip-*/noop 不产生 would-place（单测断言）。
- [ ] `skip-capped` 仅拦加仓，减仓/平仓放行。
- [ ] 滚仓 100→150→120→200：对账一步对齐到 200，不逐步追（中间 150/120 不产生独立 would-place）。
- [ ] `|delta| < MIN_DELTA_PCT` 或 < 最小下单量 → `noop`，不下单。
- [ ] `placeDryRun` 输出 IOC 限价 + 滑点保护参考价（基于 allMids/L2）+ `dryRun:true`；不签名、不调真实下单、不触 agent key。
- [ ] 对账循环事件触发与周期触发都进同一 `reconcileOnce`，幂等。
- [ ] 纯函数单测全绿（`diffDelta` / 各 `LegDecision` 分支 / 滚仓对齐）。

## 验收场景（Given/When/Then）

### 场景 1：可映射目标 dry-run 跟单（对应总纲场景 1）
- **Given** 02 已锚定 ratio=6.25%，desired = hype ETH 多 0.625 张；我方 current 为空；hype ETH refPx 有效；名义 0.625×refPx > $10、未触顶、`|delta|` ≥ MIN_DELTA_PCT
- **When** `reconcileOnce()` 执行
- **Then** `diffDelta` 得 ETH +0.625；`decideLeg` 返回 `place`；`placeDryRun` 产出 `{coin:"ETH",side:"buy",size:"0.625",limitPx=refPx×(1+slippageBps),tif:"Ioc",dryRun:true}`；skip 类为空；would-place 列表仅 1 条交 04

### 场景 2：滚仓一步对齐（核心，对应总纲验收 §6 滚仓项）
- **Given** 目标 ETH 净仓在一个 debounce 窗口内经历 100→150→120→200，对账时最新快照 = 200 张；ratio 折算后 desired ETH = 12.5 张，我方 current = 8 张（上轮态），`|delta|`=4.5 ≥ MIN_DELTA_PCT、名义 > $10、未触顶
- **When** `reconcileOnce()` 执行
- **Then** `diffDelta` 只看最新 desired(12.5) − current(8) = +4.5，一次性 would-place ETH +4.5 张对齐到 12.5；中间态 150/120 不产生任何独立 would-place（收敛层①吸收）；仅 1 条 would-place

### 场景 3：触顶仅拦加仓、放行减仓
- **Given** 已触 `maxDeployPct`（capped）；目标本轮 ETH **减仓**，delta = −2 张（降风险方向），名义 > $10、`|delta|` ≥ MIN_DELTA_PCT
- **When** `decideLeg` 判定该 leg
- **Then** 虽处 capped，但 delta 为减仓方向 → **不**返回 `skip-capped`，落到 `place`，would-place ETH 卖 2 张（风控不阻止降风险）；若同轮另一仓为加仓且触顶 → 该加仓 leg 返回 `skip-capped` 不进 would-place

### 场景 4：碎步追单被 noop 拦截
- **Given** desired ETH = 0.625，current = 0.624，delta = 0.001，`|delta|` < `target.minDeltaPct`
- **When** `decideLeg` 判定
- **Then** 返回 `noop`，不产生 would-place（防 fee/滑点侵蚀，滚仓三层之③）；该条作为 noop 告警（可选静默）交 04
