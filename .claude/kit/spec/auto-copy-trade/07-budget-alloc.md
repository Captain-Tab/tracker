# Spec 07 · 资金分配模型 v3（每币独立预算 + 生存杠杆 + 逐仓保证金防守）

> 引用总纲 `00-overview.md`。流程 / 状态机 / 共享契约以总纲为准，本文只定义本子单元自身，**冲突以总纲为准**。
> 依赖：总纲 Phase0、子件 01（配置加载 + 标的映射）、子件 04（推送/日志，本件扩展其事件）。
> 落地时本 spec 已读，**勿重新生成**；直接 `/k:task` 执行本阶段。

---

## 0. 与既有子件关系 + 阶段边界（HARD）

**完全替换** ratio 模型（02 `computeRatio`/`computeDesired` 的"目标保证金×ratio"）+ 改造 03 校验门。理由：小资金跟集中型大户，ratio 缩完仍超单仓上限 → 整仓 skip（500 跟 0x267b…2566 LIT 5x 一分钱跟不了）。

| 阶段 | 范围 | 依赖 A5(逐仓浮盈加仓) |
|---|---|---|
| **Phase 1（本件，dry-run）** | 每币独立预算 + 生存杠杆 floor(L\*) + 逐仓保证金防守(updateIsolatedMargin) + 跟减/平 + maxCoinCapital 封顶 | **零依赖**，完整自包含 |
| **Phase 2（独立子件，gated）** | 自浮盈滚仓（盈利时跟目标加 size） | 依赖 A5 实盘验证（gate）；不在本件 |

> 本件**只写 Phase 1**，无悬空状态。Phase 2 是明确的下一阶段边界，非"未完成"。

| 旧（ratio） | 新（本件 Phase 1） | 处置 |
|---|---|---|
| size = 目标保证金×ratio | size = minOpenCapital×杠杆/价（每币独立定额） | 替换 |
| `skip-maxpos`/`skip-capped` 整仓不跟 | 预算即上限，不会超 | 删除两分支 |
| 无强平防守 | 逐仓 + 目标 lp 锚定，`updateIsolatedMargin` 补保证金 | 新增 |

---

## 1. 背景与目的

站在**自有固定资金**角度做预算分配，而非镜像目标绝对仓位。三支柱：

1. **加法·每币独立**：每个跟单币是独立沙盒（固定 `minOpenCapital` 开仓），互不抢占、不碎片。
2. **生存杠杆 floor(L\*)**：开仓杠杆取**整数** `floor(min(L*, maxLeverage))`，L\* 是让"我方强平价=目标 lp"的杠杆。整数 floor 使我方强平价**开仓即 ≥ 目标 lp**。
3. **逐仓保证金防守**：目标 lp 后撤 / 资金费侵蚀时，用 `updateIsolatedMargin` 补保证金（**size 不变、敞口不增**）把我方强平价追回 ≥ 目标 lp，封顶 `maxCoinCapital`。

一期 **dry-run**：不签名，产 `would-place` / `would-update-margin` / `would-update-leverage` 决策 + 推送。

---

## 2. 选定方案

```
service/HYPE-copy/process/
  allocation.mjs   — 新增：selectLeverage / planOpen / computeMyLiqPrice / planDefend（Phase B 已落）+ planFollow（Phase D 补，连接预算定额↔目标跟随，解 §0 偏移）
  reconcile.mjs    — 改造：planReconcile 接 allocation，去 ratio
  risk.mjs         — 改造：decideLeg 删 skip-maxpos/skip-capped，加 would-defend
  sizing.mjs       — 废弃 computeRatio/computeDesired（标 @deprecated，不删文件防 import 历史断裂）
  recommend.mjs    — 微调：minCapital 改"预算优先"口径
service/HYPE-copy/api/index.mjs
  normalizeTargetPositions — 加 lp 提取；parseHypeMeta — 加 maxLeverage；
  新增 placeDryRun 同级的 would-update-margin / would-update-leverage 构造（dry-run 不签名）
service/HYPE-copy/main.mjs — reconcileOnce 编排；state 持 myMarginByCoin（模拟逐仓保证金）
service/HYPE-copy/notify/{templates,index}.mjs — would-defend 文案 + JSONL 字段
docs/copy/allocation.md — 落地末阶段产出（Phase F）
```

- `allocation.mjs` 全部纯函数，精度走 `process/precision.mjs`（ROUND_DOWN，禁裸 parseFloat）。
- `getMyLiqPrice()` 注入抽象：dry-run 用 `computeMyLiqPrice`（读 `myMarginByCoin`）；实盘读 hype `liquidationPx`。决策逻辑两阶段共用。

---

## 3. 共享契约

### 3.1 接口/Action 依据表（全部已核实，禁臆测）

| Action | 精确字段 | 用途 | 依据 |
|---|---|---|---|
| `order` | `{a:assetIdx, b:isBuy, p:price(str), s:size(str), r:reduceOnly, t:{limit:{tif:"Ioc"}}}` | 开/加/减/平 size | SDK `order.d.ts` + 现有 `placeDryRun` |
| `updateIsolatedMargin` | `{asset:idx, isBuy:仓位方向(多true/空false), ntli:金额×1e6(整数, 正=加/负=减)}`；**size 不变** | 防守补保证金 | SDK `updateIsolatedMargin.js`（例 `isBuy:true, ntli:1*1e6`）+ HL docs |
| `updateLeverage` | `{asset:idx, isCross:false, leverage:整数≥1}` | 开仓设逐仓杠杆 | SDK `updateLeverage.d.ts`（`SafeInteger`+`MinValue 1`） |
| `clearinghouseState` | `assetPositions[].position.liquidationPx`（可 null）/`leverage{type,value}`/`marginUsed`/`maxLeverage` | 实盘读我方强平价 | 实测 curl |
| sodex `state.P[]` | `lp`(目标强平价)/`ep`(均价)/`l`(杠杆)/`sz`(净张)/`mu|co/l`(保证金) | 目标态 | 实测 curl（0x267b lp≈2.1225） |
| hype `meta.universe[]` | `name`/`szDecimals`/`maxLeverage` | 资产元数据 | 实测 meta（LIT maxLev=5, szDec=0） |

> **dry-run 表示**：以上三个 action 在 Phase 1 **不签名不提交**，各产一条 `would-*` 决策记录 + 推送：`would-place`(order) / `would-update-margin`(updateIsolatedMargin，含 ntli 金额/size不变/liqBefore→liqAfter) / `would-update-leverage`(updateLeverage)。真实签名提交占位 throw，留实盘阶段。

### 3.2 参数（targets.json 每币）

```ts
type Target = {
  // ...既有
  allocationModel: "budget";        // 恒 "budget"（ratio 废弃，留字段供 audit）
  minOpenCapital: number;           // 最小开仓资金(M0$)，定初始 size。默认 500
  maxCoinCapital: number;           // 单币最大投入=最大亏损，定能陪目标扛多深。默认 1000
  // @deprecated initialDeployPct / maxDeployPct / maxPositionPct
};
```
派生（不入配置）：
```
R(防守额度)   = maxCoinCapital − minOpenCapital
maxPositions = floor(availBalance / maxCoinCapital)   // 每槽预留满额 → 无跨币抢占
openLeverage = clamp(floor(L*), 1, maxLeverage)       // 整数，见 §3.3
mm           = 1 / (2 × maxLeverage)
```

### 3.3 核心函数契约（allocation.mjs）

#### `selectLeverage({entryPx, targetLp, mm, maxLeverage, side}) → {leverage, defendableToTargetLp}`
```
L*(short) = entryPx / (targetLp×(1+mm) − entryPx)
L*(long)  = entryPx / (entryPx − targetLp×(1−mm))
leverage  = clamp(floor(L*), 1, maxLeverage)          // 整数；floor → 强平价 ≥ 目标lp
defendableToTargetLp = (clamp 后 1x 时 computeMyLiqPrice 仍越过 targetLp)  // false=本金/最低杠杆都守不住
```
- `targetLp×(1+mm) ≤ entryPx`（short，即 L\*≤0）→ 开仓价已越目标 lp 侧 → 返回 `leverage=null`（不开，§4 守卫）。
- `targetLp="0"`（目标无强平风险）→ `leverage = clamp(目标 leverage, 1, maxLeverage)`，`defendableToTargetLp` 忽略（不防守，仅跟开平）。

#### `computeMyLiqPrice({entryPx, margin, size, side, mm}) → liqPx`（MM-aware；与实盘 liquidationPx 同口径）
```
short：liqPx = (margin + |size|×entryPx) / (|size|×(1 + mm))
long ：liqPx = (|size|×entryPx − margin) / (|size|×(1 − mm))
```
> 实盘忽略本式，读 hype `liquidationPx`；`getMyLiqPrice()` 切换数据源，决策共用。

#### `planOpen({minOpenCapital, openLeverage, entryPx, targetSzi, szDecimals}) → {size, M0, notional}`
```
M0       = minOpenCapital
notional = M0 × openLeverage
size     = signOf(targetSzi) × ROUND_DOWN(notional / entryPx, szDecimals)   // 镜像方向；LIT szDec=0 整数张
```
- `|size| × entryPx < MIN_ORDER_NOTIONAL_USD($10)` → 返回 skip-mindust（本金太小）。

#### `planDefend({entryPx, size, side, myLiqPx, targetLp, currentMargin, maxCoinCapital, mm}) → {wouldAddMargin, newLiqPx, exhausted}`
维持不变量「我方强平价越过目标 lp」，缺口用 `updateIsolatedMargin` 补（**size 不变**），封顶 maxCoinCapital。
```
若 targetLp="0" 或 myLiqPx 已越过 targetLp（short:≥ / long:≤）→ wouldAddMargin=0
否则 needMargin = |size| × |targetLp×(1±mm) − entryPx|        // short:+mm / long:−mm
     wouldAddMargin = min(needMargin − currentMargin, maxCoinCapital − currentMargin)
     newLiqPx = computeMyLiqPrice({entryPx, currentMargin+wouldAddMargin, size, side, mm})
     exhausted = (currentMargin + wouldAddMargin < needMargin)   // 到 maxCoinCapital 仍追不上
```
- `exhausted=true` → 推送告警「已达单币上限 $maxCoinCapital，强平价 newLiqPx 仍早于目标 lp，可能比目标先爆」，**认栽不再补**（损失封顶 maxCoinCapital）。

#### `planFollow({openSize, openTargetSzi, targetSzi, szDecimals}) → {desiredSize, followRatio}`
连接「size 由我方预算定」与「size 跟目标相对轨迹」——解决两口径偏移（§0 偏移修正）。
```
followRatio = min(1, |targetSzi| / |openTargetSzi|)                       // 封顶 1：增仓超开仓基线不跟（滚仓留 Phase 2）
desiredSize = signOf(targetSzi) × ROUND_DOWN(|openSize| × followRatio, szDecimals)
```
- `openSize` = 我方开仓张数 S0（预算定，planOpen 产出，**此后作基线固定**）；`openTargetSzi` = 开仓时目标净张 T0。
- followRatio<1（目标减）→ 我方 reduceOnly 减到 desiredSize；→0（目标平）→ 平。
- followRatio 封顶 1 → size **永不超 S0**（预算硬上限）；目标减后再加回 T0 → followRatio 回 1 → 我方回 S0（跟回基线，非新增敞口）。
- 与 planDefend 正交：planFollow 管 size（[0,S0] 区间），planDefend 管保证金（不改 size）。
- `|openTargetSzi|≤0`（异常）→ followRatio=1（退化为保持 S0）。

### 3.4 状态机 / 校验门（总纲 §2.1/§2.2 改造）

```ts
type LegDecision = "place" | "would-defend" | "skip-unmappable" | "skip-mindust" | "skip-no-open" | "noop";
//   删 skip-maxpos/skip-capped；加 would-defend(补保证金)/skip-no-open(L*≤0 不开)
```
| decision | 条件 | 动作 |
|---|---|---|
| `skip-unmappable` | 无 hype 映射 | 不下单，不计仓位数 |
| `skip-no-open` | `selectLeverage` 返回 null（开仓价已越目标 lp 侧） | 不开仓 + 告警 |
| `skip-mindust` | size 名义 < $10 或 size round 到 0 | 跳过 + 告警 |
| `place` | 新开（updateLeverage + order）/ 跟减 / 跟平 | dry-run would-place |
| `would-defend` | 已开仓且 `planDefend.wouldAddMargin>0` | dry-run would-update-margin（size 不变） |
| `noop` | 无需补、`|delta|<MIN_DELTA_PCT` | 跳过 |

**size 跟随（铁律，解 §0 偏移）**：开仓后我方 size **不再用 planOpen 重算**，改由 `planFollow` 按目标相对轨迹缩放——`desiredSize = signOf × ROUND_DOWN(|S0| × min(1, |目标szi|/|T0|))`。即 size 基线由预算定一次（S0），后续只在 [0, S0] 内跟目标减/平/回补，**永不超 S0**。
**退出**：目标减→`planFollow` 出更小 size → reduceOnly 减；目标平/被强平→ followRatio=0 → 平，同点出。单币最坏亏 maxCoinCapital。
**目标反手(long↔short)**：先 `order` 平原仓 → 再按新方向 `selectLeverage`+`planOpen` 开新仓（**重置 S0/T0/leverage**）。
**目标加 size（摊低亏损 / 滚仓）**：followRatio 封顶 1 → **不跟 size**；亏损只 `planDefend` 追 lp（防守 ≠ 加仓，§3.1）；盈利滚仓留 Phase 2。

### 3.5 ActionResult 扩展（总纲 §3.2 + 子件 04）

```ts
type ActionResult = {
  // ...既有 targetId/coin/side/decision/size/refPx/dryRun/reason
  M0?: string; openLeverage?: number; maxCoinCapital?: string;
  myLiqPx?: string; targetLp?: string; mm?: number;
  // would-defend 专属：
  wouldAddMargin?: string; ntli?: number; liqBefore?: string; liqAfter?: string; exhausted?: boolean;
};
```
04 `lineFor` 加 `would-defend` / `skip-no-open` 文案；卡片展示 M0 / 我方强平价 / 目标 lp / 已补保证金。

### 3.6 实现约定（消除一切卡点）

| 项 | 约定 |
|---|---|
| `selectLeverage` 调用 | **开仓一次**（用开仓时 entry/targetLp）；杠杆此后固定，防守靠 updateIsolatedMargin 调保证金不改杠杆 |
| `state.myPosByCoin` | `Map<coin, {margin, openSize, openTargetSzi, leverage, side}>`：开仓 set（margin=M0、openSize=S0、openTargetSzi=T0、leverage、side）；每轮 would-defend 累加 margin；planFollow 用 openSize/openTargetSzi 算跟随 size；平仓/flat 删除；**dry-run 模拟累计**；进程重启从空，靠下轮对账重建（重锚 S0/T0） |
| 防守频率 | 每轮对账重算 myLiqPx vs targetLp（eager），漂移即补；floor(L\*) 使开仓即安全，故补只在"目标 lp 后撤 / 资金费侵蚀"时触发 |
| 资金费侵蚀（实盘） | 每轮从 `liquidationPx` 实测漂移，planDefend 自动补；dry-run 可选模拟（一期可不模拟资金费，标注估算口径） |
| `size` 符号/精度 | `signOf(targetSzi)`；`ROUND_DOWN` 到 szDecimals；needMargin `ROUND_UP`（保证够补到 lp） |
| `maxPositions` | `floor(availBalance/maxCoinCapital)`；目标币数超之 → 跟 top-N（按目标名义降序）+ 告警 |
| size 跟随 | `planFollow`：desiredSize=signOf×ROUND_DOWN(\|S0\|×min(1,\|目标szi\|/\|T0\|))，[0,S0] 区间跟目标减/平/回补；不重锚杠杆；增仓超 T0 不跟（封顶 1） |
| `getMyLiqPrice` 注入 | dry-run：`computeMyLiqPrice`(读 myPosByCoin.margin)；实盘：读 `liquidationPx`，**null（无仓/cross无风险）→ 返回 null → 不补**；占位实现 dry-run 可跑、实盘分支 throw |

### 3.7 reconcileOnce 编排伪代码（消除模糊）

```
for coin in 目标可映射仓:
  P = myPosByCoin[coin]
  if P 无:  // 未持仓 → 开仓
    lev = selectLeverage(entry, targetLp, mm, maxLeverage, side)
    if lev == null: emit skip-no-open; continue
    {size, M0} = planOpen(minOpenCapital, lev, entry, targetSzi, szDecimals)
    if skip-mindust: emit skip-mindust; continue
    emit would-update-leverage(lev) + would-place(size)
    myPosByCoin[coin] = { margin:M0, openSize:size, openTargetSzi:targetSzi, leverage:lev, side }
  elif 目标反手(side 翻转):  // 先平后开
    emit would-place(平 P.openSize); delete myPosByCoin[coin] → 下轮走开仓分支
  else:  // 已持仓，同向
    // ① size 跟随（planFollow）：目标减/平/回补 → 调 size（[0,S0]）
    {desiredSize, followRatio} = planFollow(P.openSize, P.openTargetSzi, targetSzi, szDecimals)
    if |desiredSize| < |当前 size|: emit would-place(reduceOnly 减到 desiredSize)
    if followRatio == 0: emit would-place(平); delete myPosByCoin[coin]; continue
    // ② 防守（planDefend）：与 size 正交，只调保证金
    myLiq = getMyLiqPrice(coin)   // dry:computeMyLiqPrice(P.margin,desiredSize) / 实盘:liquidationPx
    d = planDefend(entry, desiredSize, side, myLiq, targetLp, P.margin, maxCoinCapital, mm)
    if d.wouldAddMargin > 0:
      emit would-update-margin(ntli=d.wouldAddMargin×1e6)   // size 不变
      P.margin += d.wouldAddMargin
      if d.exhausted: emit 告警(认栽封顶)
// 目标已无、我方仍持有的 coin → 视为目标平仓，emit would-place(平) + delete
// 目标币数 > maxPositions → 仅处理 top-N(目标名义降序)，其余 emit 告警
```
> 防守每轮重算（eager）；杠杆仅开仓设一次，此后只调保证金。资金费侵蚀：一期 dry-run **不模拟**（myMarginByCoin 不随时间衰减），标注估算口径；实盘由 `liquidationPx` 实测漂移自然驱动 planDefend。

---

## 4. 边界与守卫（全部显式）

| 场景 | 处理 |
|---|---|
| `selectLeverage` L\*≤0（开仓价已越目标 lp） | `skip-no-open`，不开 + 告警 |
| `defendableToTargetLp=false`（1x 仍守不住，目标 lp 极远） | 仍按 1x 开 + 标注「最低杠杆仍可能早于目标 lp」 |
| 目标 `lp="0"`（cross 无强平风险） | 杠杆=clamp(目标 lev)，不防守，仅跟开/平 |
| 缺价 / mm 缺失（coin 不在 asset index） | skip 该币 + 告警 |
| `size` round 到 0 / 名义 < $10 | `skip-mindust` |
| `availBalance < maxCoinCapital` | 开不出，"本金不足"降级 + 告警 |
| 目标币数 > maxPositions | 跟 top-N（目标名义降序）+ 告警「资金仅够跟 M 个」 |
| 实盘 `liquidationPx=null` | 视为无强平风险，不补 |
| 防守到 maxCoinCapital 仍追不上 | `exhausted` 告警，认栽封顶亏损 |

---

## 5. 集成点 + 清理面

**集成点**：
- `process/allocation.mjs` 新增四纯函数。
- `process/reconcile.mjs:27` `planReconcile` 接 allocation，去 ratio。
- `process/risk.mjs:9` `decideLeg` 改造（删 skip-maxpos/capped，加 would-defend/skip-no-open）。
- `api/index.mjs:127` `normalizeTargetPositions` 加 `lp`；`:186` `parseHypeMeta` 加 `maxLeverage`；新增 `buildWouldUpdateMargin`/`buildWouldUpdateLeverage`。
- `main.mjs reconcileOnce` 编排 selectLeverage→planOpen→planDefend；state `myMarginByCoin`。
- `notify/templates.mjs lineFor` + `notify/index.mjs toLogLine` 加 would-defend/skip-no-open。
- `docs/copy/allocation.md`（Phase F）。

**清理面（删 skip-maxpos/skip-capped 残留，必须同改）**：
| 文件:行 | 残留 | 处置 |
|---|---|---|
| `risk.mjs:33,38` | skip-maxpos/skip-capped 分支 | 删 |
| `main.mjs:145-150` | skip 类上下文注入字段 | 删 |
| `main.mjs:~221` | skippedCoins 传 buildPositionCards | 删 |
| `notify/index.mjs:13` | ALERT_RESULTS 含两者 | 移除；加 would-defend(非告警不加)/skip-no-open |
| `notify/templates.mjs:184-195` | 两者文案 | 删 |
| `test/domain.test.mjs` | 两者单测 | 删/改 budget 用例 |
> 落地先 grep 全仓 `skip-maxpos|skip-capped`（含 docs/notify/copy.md 示例）确认无遗漏。

---

## 6. 验收标准

- [ ] `selectLeverage`：L\*(short/long) 正确，整数 clamp[1,maxLev]；L\*≤0→null；lp=0 退化。
- [ ] `computeMyLiqPrice`：MM-aware，与实盘 liquidationPx 同口径，short/long 方向对。
- [ ] `planOpen`：size=signOf×ROUND_DOWN(M0×lev/价)；<$10→mindust。
- [ ] `planDefend`：维持"强平价越过 lp"，needMargin ROUND_UP，封顶 maxCoinCapital，exhausted 告警；size 全程不变。
- [ ] `planFollow`（Phase D）：followRatio=min(1,\|目标szi\|/\|T0\|)；desiredSize=signOf×ROUND_DOWN(\|S0\|×ratio)；size 永不超 S0；目标减→比例减、平→0、加超 T0→封顶不跟（解 §0 偏移）。
- [ ] 校验门：删 skip-maxpos/capped，加 would-defend/skip-no-open；开仓走 updateLeverage(isCross:false)+order。
- [ ] 500 跟 0x267b…2566 LIT 不再整仓 skip；杠杆=2、size=583、强平价 2.337>目标。
- [ ] 防守用 updateIsolatedMargin（size 不变）非加 size；目标"加 size 摊低"不跟 size。
- [ ] 退出跟目标；反手先平后开；单币最坏亏 maxCoinCapital，不波及其他币。
- [ ] maxPositions=floor(余额/maxCoinCapital)，超额跟 top-N。
- [ ] 全部边界守卫（§4）有分支，无静默/崩溃。
- [ ] dry-run 产 would-place/would-update-margin/would-update-leverage，不签名。
- [ ] 纯函数单测全绿。
- [ ] `docs/copy/allocation.md` 落地。

---

## 7. 验收场景（Given/When/Then，真实数据 + MM-aware 实算）

### 场景 1：500 跟单仓大户，预算优先开仓
- **Given** minOpenCapital=500，maxCoinCapital=1000，目标 0x267b…2566 仅 LIT 空仓（lp≈2.1225），hype LIT maxLev=5(mm=0.1)/szDec=0，mid=1.713
- **When** 对账
- **Then** L\*=2.755→leverage=**2**；would-update-leverage{asset,isCross:false,leverage:2}；size=signOf(−)×ROUND_DOWN(1000/1.713,0)=**做空 583 张**；M0=500；would-place；开仓真实强平价=(500+583×1.713)/(583×1.1)≈**2.337 > 目标 2.1225** ✓。**对比旧 ratio：该仓 skip-maxpos 不跟。**

### 场景 2：目标 lp 后撤超过我方强平价，补保证金防守（size 不变）
- **Given** 场景 1 已开（margin=500，size=583，开仓强平价 2.337）；目标补保证金 → 其 lp 后撤到 **2.50**（> 我方 2.337，触发防守；若 lp ≤ 2.337 则我方已安全，noop）
- **When** planDefend
- **Then** needMargin=583×(2.50×1.1−1.713)≈**605**→wouldAddMargin=605−500≈**105**（未达 maxCoin 1000）；would-update-margin{asset,isBuy:false,ntli:105×1e6}；**size 仍 583**；liqBefore 2.337→liqAfter≈**2.50** 越过目标 ✓

### 场景 3：防守到上限仍追不上
- **Given** 目标 lp 后撤到 3.20（极端），需 margin = 583×(3.20×1.1−1.713)≈**1053** > maxCoin 1000
- **When** planDefend
- **Then** wouldAddMargin=1000−500=500（补到 maxCoin 封顶）；exhausted=true；告警「已达单币上限$1000，强平价仍早于目标 lp」；认栽，最坏亏 $1000

### 场景 4：目标平仓跟随退出
- **Given** 已开镜像仓（S0=583，T0=−35600）
- **When** 目标 LIT 归零
- **Then** planFollow followRatio=0 → would-place 平仓（reduceOnly）；myPosByCoin 删 LIT；minOpenCapital 回收，下轮可开新币

### 场景 5：目标 lp=0（cross 无强平风险）
- **Given** 目标某仓 lp="0"
- **When** 对账
- **Then** 杠杆=clamp(目标 leverage,1,maxLev)，开仓；**不做 would-defend**；仅跟开/平；不报错

### 场景 6：目标减仓，size 按比例跟（解 §0 偏移）
- **Given** 已开镜像仓 S0=583（T0=−35600）；目标 LIT 减仓到 −17800（半仓）
- **When** planFollow
- **Then** followRatio=min(1,17800/35600)=0.5 → desiredSize=做空 ROUND_DOWN(583×0.5)=**291**；emit would-place(reduceOnly 减到 291)；**size 受我方预算基线 S0 约束，非镜像目标绝对量**。目标再加回 −35600 → followRatio 回 1 → 回 583（不超基线）。

---

## 8. 落地阶段（流水线）

> 每阶段读总纲+本件 → `/k:task` → `/k:check` → `/k:commit` → gate 停 → 下一阶段。

| Phase | 内容 | 依赖 |
|---|---|---|
| A | api 加 `lp` + `maxLeverage` 提取；`getMyLiqPrice` 注入抽象（dry-run 估算 + 实盘 liquidationPx 占位）；would-update-margin/leverage 构造 | 横切 |
| B | `allocation.mjs` 四纯函数 + 单测（selectLeverage/computeMyLiqPrice/planOpen/planDefend，含 short/long/边界） | A |
| C | 改造 `risk.mjs`（删 skip-maxpos/capped，加 would-defend/skip-no-open）+ 单测 | B |
| D | `allocation.mjs` 补 `planFollow`（+单测）；改造 `reconcile.mjs` + `main.mjs reconcileOnce` 编排（selectLeverage→planOpen→planFollow→planDefend；state `myPosByCoin`{margin/openSize/openTargetSzi/leverage/side}；反手/size跟随/top-N，伪代码见 §3.7） | C |
| E | `notify` would-defend/skip-no-open 文案 + 卡片 + JSONL；清理 skip-maxpos/capped 全仓残留 | D |
| **F** | **`docs/copy/allocation.md`**：保证金分配计算逻辑文档，分章节、**开头流程图**——流程图 + 核心原理 + 核心数据 + 参数 + 计算公式 + 核心计算流程(三个 hype action) + size vs 保证金概念 + LIT 实例 + 边界 + dry-run vs 实盘。设计已锁定可先建，Phase F 与代码对齐 | A–E 后 |

**Phase 2 边界（不在本件，独立子件 + gate）**：自浮盈滚仓——实盘验证「逐仓未实现浮盈能否给同仓加 size」（A5）作为准入 gate；通过后实现"盈利时跟目标 order 加 size"。

---

## 9. 依赖拓扑（并入总纲 §8）

```
01 配置(加 minOpenCapital/maxCoinCapital) → 07 资金分配 v3（本件，替换 02 + 改造 03）
                                              → 04 推送(扩展 would-defend/skip-no-open)
                                              → docs/copy/allocation.md (Phase F)
后续：Phase 2 自浮盈滚仓(gated by A5 实盘验证) / 实盘 liquidationPx 接通 / 多币并发实测
```
