# Spec 02 · 资金模型 + 最低本金算法

> 引用总纲 `00-overview.md`。流程 / 状态机 / 共享契约以总纲为准，本文只定义本子单元自身，**冲突以总纲为准**。
> 依赖：总纲 Phase0（类型 + `mapSymbol` + api 横切 mock）、子件 01（配置加载 + 标的映射，提供已映射的目标可映射仓列表）。
> 落地时本 spec 已读，**勿重新生成**；直接 `/k:task` 执行本阶段。

---

## 背景与目的

本子单元落地总纲 §3.2 中标 `02` 消费方的三个核心纯函数 —— `computeRatio` / `computeDesired` / `recommendMinCapital`，以及它们承载的「锚定首仓 + 分层 buffer + 保证金等比」资金模型（总纲 §3.3、clarify 资金模型节）。

对应总纲流程的「资金换算」环节（链路 `标的映射 → 资金换算 → 校验门`）：把**已映射的目标可映射仓**换算成我方 desired size 集合，并在开跟时给出推荐最低本金 + 可跟/跳过清单。

本子件**只负责换算与推荐**，不做校验门 / delta 收敛 / 下单（那是 03）。

## 选定方案

落点（遵守扁平结构，纯函数单文件不建文件夹）：

```
service/HYPE-copy/process/
  sizing.mjs       — computeRatio / computeDesired（锚定 + 等比换算）
  recommend.mjs    — recommendMinCapital（最低本金 + 可跟/跳过清单）
service/HYPE-copy/test/
  domain.test.mjs  — 本阶段追加 sizing / recommend 用例（与 01/03 共用同一测试文件）
```

- `sizing.mjs` 与 `recommend.mjs` 拆两文件：换算与推荐职责正交，推荐内部复用 `computeRatio` 的反解逻辑。
- 二者均为**无副作用纯函数**：入参显式传 `prices` / `avail`，不内部拉数据、不读 session、不触发签名。数据由 api 横切（Phase0）在 `main.mjs` 注入。
- 精度：金额 / size / 名义一律走 `process/precision.mjs`（`formatPrice`/`formatSize`，ROUND_DOWN，自实现；见 §精度约定），**禁用 `tool/format` 做精度运算**（其仅展示 / `isAddress`），**禁裸 `parseFloat` 做加减乘除比较**。

## 设计概要

### 数据来源

| 入参 | 来源 | 说明 |
|---|---|---|
| 目标可映射仓 `MappablePos[]` | 子件 01 `mapSymbol` 过滤后的列表 | 已剔除不可映射仓（PLTR 等）；每仓含 `{ coin, szi(净张), marginUsed, leverage, targetNotional }` |
| `ratio` | 本件 `computeRatio` 产出 | `anchored` 时锚定，`following` 期由调用方（03/main）固定传入 |
| `prices` | api 横切 `fetchHypePrices()` → `{ coin: midPx }` | hype 中价，用于名义 / size 折算 |
| `avail` | api 横切（账户可用余额） | 我方可用余额 |
| `initialDeployPct` / `maxDeployPct` | 子件 01 `loadTargets` → Target | 默认 0.5 / 0.9 |

> **ratio 分母铁律（总纲 §3.3）**：只累加**可映射仓**的 `marginUsed`，不含股票/商品仓。不可映射仓在 01 已被剔除，本件入参即「可映射仓」，无需再判定。

### 函数契约

#### `computeRatio(avail, deployPct, targetMappableMargin) → number`
```
ratio = (avail × deployPct) / targetMappableMargin
```
- `targetMappableMargin` = Σ 目标可映射仓 `marginUsed`（调用方先聚合好传入）。
- 锚定语义：在 `anchored` phase 调用一次，结果即该轮固定 ratio；`following` 期不再重算（总纲 §2.1）。
- 边界：`targetMappableMargin <= 0` → 返回 `0`（无可映射仓，等价 idle，不部署）。

#### `computeDesired(目标可映射仓[], ratio, prices) → {coin, size}[]`
每仓：
```
desiredMargin = pos.marginUsed × ratio
desiredNotional = desiredMargin × pos.leverage           // 等比放大回名义
size = desiredNotional / prices[pos.coin]                // 按 hype 中价折算张数
方向(符号)沿用 pos.szi 的正负（多/空）
```
- 输出 `{ coin, size }[]`，size 为带符号张数（多为正、空为负），与目标同方向。
- `prices[coin]` 缺失 → 该仓跳过并在返回结构标记（交由 03 校验门处理为告警），不抛错中断整批。
- **本件不做名义 < $10 / 触顶判定**（那是 03 校验门 + 部署上限），只产出理论 desired。
- 触顶（`capped`）由 03/main 在拿到 desired 后用 `min(目标保证金×ratio, avail×maxDeployPct)` 收口；本件不提前封顶，保持换算纯粹。

#### `recommendMinCapital(目标可映射仓[], prices, initialDeployPct) → { minCapital, ratioMin, perLeg }`
反解「要让每个仓的我方名义都 ≥ 交易所最小名义 $10」所需最低本金：
```
对每仓: targetNotional[coin] = pos.szi 绝对值 × prices[coin]
        legRatioMin[coin]    = MIN_ORDER_NOTIONAL_USD / targetNotional[coin]
ratioMin  = max over coins (legRatioMin)                 // 名义最小的仓卡门槛
minCapital = ratioMin × targetMappableMargin / initialDeployPct
```
- `targetMappableMargin` = Σ 可映射仓 `marginUsed`（同 `computeRatio` 分母）。
- `perLeg[]`：每仓 `{ coin, targetNotional, legRatioMin, canFollow, reason }`
  - 用当前实际 `ratio`（调用方传当前本金算出的 ratio）评估 `canFollow = (targetNotional × ratio) ≥ MIN_ORDER_NOTIONAL_USD`
  - `reason`：`"ok"` / `"below-min-notional"`（名义不足）/ `"no-price"`（缺价）
- 用途：开跟时（启动 / 每轮重锚）输出「推荐最低本金 + 当前本金能跟哪些仓 / 跳过哪些」，供 04 推送 + 日志。
- 边界：无可映射仓 → `minCapital=0, ratioMin=0, perLeg=[]`。

### 常量

| 常量 | 值 | 来源 |
|---|---|---|
| `MIN_ORDER_NOTIONAL_USD` | `10` | 交易所最小名义（总纲 §3.3 / clarify）；命名常量，禁裸 `10` |
| `INITIAL_DEPLOY_PCT` 默认 | `0.5` | Target.initialDeployPct（总纲 §3.1） |
| `MAX_DEPLOY_PCT` 默认 | `0.9` | Target.maxDeployPct（本件不消费，03 用；此处仅备注） |

### 精度约定

- 加减乘除 / 比较 / 舍入走 `process/precision.mjs`（ROUND_DOWN，自实现，依赖 decimal.js；总纲 §3.3/§3.4）；`tool/format` 仅展示 / `isAddress`，不做精度运算。
- `computeRatio` / `computeDesired` 的金额、名义、size 全程用 precision.mjs 精度计算，最终返回 number 或精度字符串（与 03 下单格式对齐，由 03 决定 px·sz 字符串化）。
- `ratioMin = max(legRatioMin)` 用 precision.mjs 精度比较取最大，禁 `Math.max(...parseFloat)`。

### 场景与变体

| 维度 | anchored（首轮锚定） | following（已锚定跟仓） | capped（触顶，03 收口） |
|---|---|---|---|
| ratio | `computeRatio` 现算并锚定 | 调用方传入固定值 | 同 following |
| desired | `computeDesired` 按锚定 ratio | 按固定 ratio | 03 用 `avail×maxDeployPct` 封顶 |
| recommend | 启动 / 重锚时算 | 不重算 | 不涉及 |

## i18n 文案

> 本件为后端 service 纯逻辑，无前端 i18n。推荐结果文案（推荐最低本金 / 跳过清单）由 04 推送子件汇总。

## 边界与约束

- **包含**：`computeRatio` / `computeDesired` / `recommendMinCapital` 三纯函数；锚定 ratio 计算；保证金等比 → 名义 → size 折算；最低本金反解 + 可跟/跳过清单；常量定义；纯函数单测（含数字用例）。
- **不包含**：
  - 校验门 `decideLeg`（skip-unmappable / mindust / capped / noop）—— 03。
  - 部署上限封顶 `min(..., avail×maxDeployPct)` 的实际执行 —— 03/main（本件只产理论 desired，备注公式）。
  - delta 收敛 `diffDelta` —— 03。
  - 不可映射仓过滤 —— 01（本件入参已是可映射仓）。
  - 杠杆同步 `updateLeverage` —— 03/下单腿。
  - 数据拉取（价格 / 余额 / 目标仓位）—— api 横切（Phase0），由 main 注入。
- **依赖缺口（标注，沿用总纲已知缺口）**：保证金不足降级策略未定，本件遇 `targetMappableMargin<=0` / 缺价仅返回安全值（0 / 标记），不做降级，交上层。

## 集成点

- 上游：子件 01 提供「已映射目标可映射仓 `MappablePos[]`」与 `Target` 配置（`initialDeployPct` / `maxDeployPct`）。
- 横切：Phase0 api（`fetchHypePrices` / 账户可用余额）注入 `prices` / `avail`；Phase0 mock 供单测 drop-in。
- 下游：03 `reconcile` 消费 `computeDesired` 输出（进校验门 + delta）；04 推送消费 `recommendMinCapital` 输出。
- 复用：`process/precision.mjs`（精度运算 / ROUND_DOWN，自实现）；`tool/format` 仅展示 / `isAddress`。
- 被消费签名见总纲 §3.2（`computeRatio` / `computeDesired` / `recommendMinCapital` 行）。

## 验收标准

- [ ] `computeRatio(avail, deployPct, targetMappableMargin)` = `(avail×deployPct)/targetMappableMargin`；分母 ≤0 返回 0。
- [ ] `computeRatio(500, 0.5, 4000)` === `0.0625`（6.25%）。
- [ ] `computeDesired` 按「保证金×ratio → ×leverage 名义 → /价格 size」折算，方向沿用 `szi` 符号。
- [ ] `computeDesired` 中某 coin 缺价 → 该仓标记跳过、不抛错、其余仓正常产出。
- [ ] `recommendMinCapital`：`ratioMin = max(10/目标名义[coin])`，`minCapital = ratioMin×targetMappableMargin/initialDeployPct`。
- [ ] `recommendMinCapital.perLeg` 标出每仓 `canFollow` 与 `reason`（ok / below-min-notional / no-price）。
- [ ] 无可映射仓 → 三函数均返回安全零值（ratio=0 / desired=[] / minCapital=0）。
- [ ] 全程走 `process/precision.mjs` 精度运算，源码无裸 `parseFloat` 参与算术 / 比较、不用 `tool/format` 做精度（grep 自检）。
- [ ] 纯函数单测全绿（含下方两场景数字用例 + 缺价 + 空仓边界）。

## 验收场景（Given/When/Then）

### 场景 1：单仓锚定换算（Happy Path · 对齐总纲场景1）
- **Given** 可用余额 `avail=500`，`initialDeployPct=0.5`；目标可映射仓仅 ETH 多 10 张（`marginUsed=4000`，`leverage=5`，`szi=+10`），hype 价 `ETH=8000`（名义 80000，保证金 16000？——以入参 `marginUsed=4000` 为准，价格仅折 size）
- **When** 调 `computeRatio(500, 0.5, 4000)` 再 `computeDesired([ETH仓], ratio, {ETH:8000})`
- **Then** `ratio === 0.0625`；ETH desired：`desiredMargin=4000×0.0625=250` → `desiredNotional=250×5=1250` → `size=1250/8000` —— 即 desired `{coin:"ETH", size:+0.15625}`（带正号=多）；无缺价跳过

> 注：总纲场景1 写「0.625 张」是按其示例价格口径；本件公式以入参为准，落地用例数字以 mock 固定的价格为准，单测断言用例内自洽的数字（如上 `0.15625`）。

### 场景 2：最低本金反解 + 小仓判定跳过（对齐 clarify 场景4）
- **Given** 目标两可映射仓：ETH（名义 `targetNotional=80000`）、DOGE（名义 `targetNotional=50`）；`targetMappableMargin=4200`；`initialDeployPct=0.5`；当前 `ratio=0.0625`；`MIN_ORDER_NOTIONAL_USD=10`
- **When** 调 `recommendMinCapital([ETH, DOGE], prices, 0.5)`
- **Then**
  - `legRatioMin(ETH)=10/80000≈0.000125`，`legRatioMin(DOGE)=10/50=0.2`
  - `ratioMin = max = 0.2`（被 DOGE 小仓卡门槛）
  - `minCapital = 0.2 × 4200 / 0.5 = 1680`
  - `perLeg`：ETH `canFollow=true`（80000×0.0625=5000≥10，reason `ok`）；DOGE `canFollow=false`（50×0.0625=3.125<10，reason `below-min-notional`）

### 场景 3：无可映射仓边界（idle 等价）
- **Given** 目标当前可映射仓列表为空（仅持不可映射股票仓，已被 01 剔除）；`avail=500`
- **When** 调 `computeRatio(500, 0.5, 0)`、`computeDesired([], 0, prices)`、`recommendMinCapital([], prices, 0.5)`
- **Then** `computeRatio` 返回 `0`（分母 ≤0）；`computeDesired` 返回 `[]`；`recommendMinCapital` 返回 `{ minCapital:0, ratioMin:0, perLeg:[] }`；均不抛错（上层据此维持 idle，不部署）
