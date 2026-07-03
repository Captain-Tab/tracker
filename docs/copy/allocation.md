# 保证金分配计算逻辑（跟单资金分配模型 v3）

> 执行腿 `service/HYPE-copy/` 的资金分配核心。每币独立预算 + 生存杠杆 + 逐仓保证金防守。
> 设计 SSOT：`.claude/kit/spec/auto-copy-trade/07-budget-alloc.md`。一期 dry-run（不签名）。

---

## 一、流程图

```
 输入：目标态(sodex P[]: lp/ep/sz/l) + hype(mid/maxLeverage/szDecimals) + 我方(minOpenCapital/maxCoinCapital)
        │
        ▼
   目标有可映射仓？ ──否──▶ idle（等目标开仓）
        │是
        ▼
 ① selectLeverage：L* = entryPx/(targetLp×(1+mm)−entryPx) → floor → clamp[1, maxLeverage]
        │
        ├─ L*≤0（开仓价已越目标 lp 侧）─────▶ skip-no-open（不开 + 告警）
        ├─ targetLp=0（无强平风险）──────────▶ 杠杆=clamp(目标 lev)，开仓但不防守
        │正常
        ▼
 ② planOpen：size = signOf(sz) × ROUND_DOWN(minOpenCapital×杠杆/entryPx, szDecimals)；M0 = minOpenCapital
        │
        ├─ 名义 < $10 ───────────────────────▶ skip-mindust（本金太小）
        │
        ▼
   开仓：updateLeverage(isCross:false, 杠杆) + order(size)   ‖ myMarginByCoin[coin] = M0
        │
        ▼
 ┌──────────────────── 每轮对账循环（eager）────────────────────┐
 │ 算 myLiqPx（dry-run:computeMyLiqPrice / 实盘:liquidationPx） vs 目标当前 lp │
 │                                                                            │
 │  ├ myLiqPx 已越过 lp ───────────▶ 安全，noop                               │
 │  │                                                                         │
 │  ├ 漂移（目标 lp 后撤 / 资金费侵蚀）─▶ ③ planDefend：                       │
 │  │     needMargin = |size|×|targetLp×(1±mm)−entryPx|（ROUND_UP）            │
 │  │     补Δ = min(needMargin−当前保证金, maxCoinCapital−当前保证金)          │
 │  │     updateIsolatedMargin(ntli = Δ×1e6)   ‖ size 不变、敞口不增           │
 │  │     └ 补到 maxCoinCapital 仍不够 ─▶ exhausted（认栽，封顶亏损）          │
 │  │                                                                         │
 │  ├ 目标减仓 ───────────────────▶ order(reduceOnly，按比例减)               │
 │  ├ 目标"加 size 摊低亏损" ──────▶ 不跟 size（只 planDefend 追 lp）          │
 │  ├ 目标反手(多↔空) ────────────▶ 先 order 平 → 再 ①② 按新方向开            │
 │  └ 目标平 / 被强平 ─────────────▶ order 平，删 myMargin，回收 minOpenCapital │
 └────────────────────────────────────────────────────────────────────────┘
```

---

## 二、核心原理（三支柱）

| 支柱 | 解决什么 | 一句话 |
|------|---------|--------|
| **加法·每币独立** | 跨币分配 | 每个跟单币是独立沙盒，固定 `minOpenCapital` 开仓，互不抢占、不碎片 |
| **生存杠杆 floor(L\*)** | 开仓即安全 | 杠杆取整数 floor，我方强平价开仓即 ≥ 目标 lp |
| **逐仓保证金防守** | 币内扛回撤 | 目标 lp 后撤/资金费侵蚀时补保证金（size 不变）追回 lp，封顶 `maxCoinCapital` |

**为何替换旧 ratio 模型**：ratio = 目标保证金 × 缩放因子，小资金跟集中型大户时缩完仍超单仓上限 → 整仓 skip（500 跟 LIT 5x 一分钱跟不了）。budget-first 改为"自有固定资金定额"，从根上绕开。

---

## 三、核心数据（输入来源）

| 数据 | 字段 | 来源 |
|------|------|------|
| 目标强平价 | `lp` | sodex `state.P[].lp`（实测 0x267b…2566 LIT ≈2.1225） |
| 目标均价 / 净张 / 杠杆 | `ep` / `sz` / `l` | sodex `state.P[]` |
| 我方开仓价 | hype mid | hype `allMids`（dry-run 假定按 mid 开仓） |
| 资产最大杠杆 / 精度 | `maxLeverage` / `szDecimals` | hype `meta.universe[]`（实测 LIT=5 / 0） |
| 维持保证金率 | `mm = 1/(2×maxLeverage)` | HL 规则（LIT=0.1） |
| 我方实盘强平价 | `liquidationPx` | hype `clearinghouseState`（可 null；含 MM 精确） |

---

## 四、参数

| 参数 | 含义 | 默认 |
|------|------|------|
| `minOpenCapital` | 最小开仓资金（M0），决定初始 size | $500 |
| `maxCoinCapital` | 单币最大投入 = 最大亏损，决定能陪目标扛多深 | $1000 |

派生（不入配置）：
```
R(防守额度)   = maxCoinCapital − minOpenCapital
maxPositions = floor(可用余额 / maxCoinCapital)   // 每槽预留满额 → 无跨币抢占
openLeverage = clamp(floor(L*), 1, maxLeverage)   // 整数
mm           = 1 / (2 × maxLeverage)
```

---

## 五、计算公式

**① 生存杠杆 L\***（让我方强平价=目标 lp 的杠杆）
```
short：L* = entryPx / (targetLp×(1+mm) − entryPx)
long ：L* = entryPx / (entryPx − targetLp×(1−mm))
openLeverage = clamp(floor(L*), 1, maxLeverage)   // floor → 强平价 ≥ 目标 lp
```

**② 我方强平价（MM-aware，与实盘 liquidationPx 同口径）**
```
short：liqPx = (margin + |size|×entryPx) / (|size|×(1+mm))
long ：liqPx = (|size|×entryPx − margin) / (|size|×(1−mm))
```
> 推导：强平在 `保证金 + 持仓盈亏 = 维持保证金(名义×mm)` 时触发，解 liqPx 即上式。
> ⚠️ 朴素式 `entryPx + margin/size` 乐观约 120%（LIT 5x 实测），必须扣 mm。

**③ 开仓 size**
```
size = signOf(targetSzi) × ROUND_DOWN(minOpenCapital × openLeverage / entryPx, szDecimals)
```

**④ 防守所需保证金**
```
needMargin = |size| × |targetLp×(1±mm) − entryPx|   // short:+mm / long:−mm；ROUND_UP
wouldAddMargin = min(needMargin − 当前保证金, maxCoinCapital − 当前保证金)
```

---

## 六、核心计算流程（含三个 hype 操作）

| 步骤 | 操作 | hype action | size 变? | 钱从哪 |
|------|------|-------------|---------|-------|
| 开仓设杠杆 | 设逐仓杠杆 floor(L\*) | `updateLeverage{asset, isCross:false, leverage}` | — | — |
| 开仓 | 下单 size | `order{a,b,p,s,r,t}` | 建仓 | minOpenCapital |
| **防守追 lp** | **补保证金** | **`updateIsolatedMargin{asset, isBuy:仓位方向, ntli:Δ×1e6}`** | **不变** | R |
| 跟减仓 | reduceOnly 减 | `order(r:true)` | ↓ | 释放 |
| 跟平仓 | 平 | `order` | 清零 | — |

> dry-run：以上不签名，各产 `would-update-leverage` / `would-place` / `would-update-margin` 决策 + 推送。

---

## 七、关键概念：size（货）vs 保证金（备用现金）

| | 干啥 | size(持仓量) | 风险 | hype 操作 |
|--|------|-------------|------|----------|
| **加 size** | 多买合约 | ↑变多 | ↑变大 | `order` |
| **补保证金（防守）** | 只塞现金垫背 | 不变 | 不变 | `updateIsolatedMargin` |

- **防守爆仓 = 补保证金（size 不变，把强平价推远）**——目标 lp 后撤时我们这样陪它扛。
- **"加 size 摊低亏损"** 会放大风险，把小账户押进亏损仓 = 爆仓死法 → **坚决不跟**。
- 同叫"加仓"，底层是两个 action，风险性质相反。

---

## 八、完整实例（LIT $500，真实数据）

```
参数：minOpenCapital=$500, maxCoinCapital=$1000
目标：LIT 做空，lp≈2.1225；hype LIT maxLeverage=5(mm=0.1)/szDecimals=0，mid=1.713

① 选杠杆：L* = 1.713/(2.1225×1.1−1.713) = 2.755 → floor=2 → 2x
② 开仓：size = 做空 ROUND_DOWN(500×2/1.713,0) = 583 张；M0=$500
        updateLeverage(isCross:false,2) + order(做空583张)
   开仓真实强平价 = (500+583×1.713)/(583×1.1) ≈ 2.337 > 目标 2.1225 ✓（开仓即安全）
③ 目标 lp 后撤到 2.50（> 开仓强平价 2.337 才触发防守；≤2.337 则已安全 noop）：
        needMargin = 583×(2.50×1.1−1.713) ≈ 605
        补 Δ = 605−500 = 105 → updateIsolatedMargin(ntli=105×1e6)，size 仍 583
        强平价 2.337 → ≈2.50，越过新 lp ✓
④ 目标 lp 极端后撤到 3.20：need = 583×(3.20×1.1−1.713) ≈ 1053 > maxCoinCapital 1000
        补到 1000 封顶（Δ=500），exhausted 告警，认栽，最坏亏 $1000
⑤ 目标平仓：order 平 583 张，回收 $500，下个币可用
单币最坏亏损 = maxCoinCapital = $1000，不波及其他币
```

对比旧 ratio 模型：该仓 skip-maxpos 整仓不跟，一分钱跟不了。

---

## 九、边界与守卫

| 场景 | 处理 |
|------|------|
| L\*≤0（开仓价已越目标 lp） | `skip-no-open`，不开 + 告警 |
| 1x 仍守不住（目标 lp 极远） | 按 1x 开 + 标注"最低杠杆仍可能早于目标 lp" |
| 目标 `lp=0`（cross 无强平风险） | 杠杆=clamp(目标 lev)，不防守，仅跟开/平 |
| 缺价 / mm 缺失 | skip 该币 |
| size round 到 0 / 名义 < $10 | `skip-mindust` |
| 可用余额 < maxCoinCapital | "本金不足"降级 |
| 目标币数 > maxPositions | 跟 top-N（目标名义降序）+ 告警 |
| 实盘 `liquidationPx=null` | 视为无强平风险，不补 |
| 防守到 maxCoinCapital 仍追不上 | `exhausted` 告警，认栽封顶 |

---

## 十、dry-run vs 实盘

| | dry-run（一期） | 实盘 |
|--|----------------|------|
| 我方强平价 | `computeMyLiqPrice`（读 `myMarginByCoin` 模拟保证金） | 读 hype `liquidationPx`（含 MM 精确） |
| 三个 action | 只产 `would-*` 决策 + 推送，不签名 | EIP-712 签名 + 提交 |
| 抽象 | `getMyLiqPrice()` 注入，决策逻辑两阶段共用 | — |

> 实盘准入 gate：开第一笔真实仓 → 对比 hype 真实 `liquidationPx` 与 dry-run 估算式，确认未乐观跑偏。

---

## 附：资本不对称的固有约束

目标账户大、能无限摊低死扛；我方单币封顶 `maxCoinCapital`。当目标防守到超出我方上限的极端 lp，我方认栽亏 `maxCoinCapital`、可能被甩出而目标存活反弹——这是小资金跟单的固有宿命，**靠 `maxCoinCapital` 旋钮调节"能陪扛多深"，无法消除**。我方坚决不跟"加 size 摊低"，因为那是用小账户赌目标永远正确 = 爆仓死法。
