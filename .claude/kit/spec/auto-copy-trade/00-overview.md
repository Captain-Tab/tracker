# Spec 总纲 · 自动跟单执行系统（一期 dry-run）

> **本文件是本功能 spec-set 的单一事实源（SSOT）**。子 spec 只引用、不重定义；冲突以本总纲为准。
> 本文件是实现蓝图，允许写 `/k:task`、HARD GATE、阶段编排等工具链内容。

---

## 0. 执行前置（HARD GATE）

- [ ] 先 commit 工作区累积的 docs 拆分改动（避免与本功能混提）。
- [ ] 确认 `@nktkas/hyperliquid` 已安装于 `service/`（dry-run 用其类型/价格读取，不签名）；**当前 package.json 仅 `ws`，未装**，开工前补。
- [ ] **精度依赖**：下单 px/sz 必须 ROUND_DOWN 到合法精度——`service/tool/format.mjs` 只有展示格式化（原生 Number，无精度运算）。需新增 `service/HYPE-copy/process/precision.mjs`（`formatPrice`/`formatSize`，ROUND_DOWN），依赖 `decimal.js`（未装，开工前补）或用整数 step 自实现。
- [ ] 一期 **dry-run 不需要 agent key**；隔离架构（trader-exec 用户 / systemd 模板）需就位但 wallet 注入留占位。

---

## 1. 背景与目的

在已有「选人(discovery) + 监听(watch)」基础上，新增**自动跟单执行腿**：监听高手目标仓位变化 → 按资金比例换算 → 在 Hyperliquid 镜像下单。**执行端统一在 hype**；信号源可来自 **sodex 账号（跨所，仅监听不下单，只跟可映射加密标的）** 或 **hype 账号（同所，标的直通）**。一期**止于 dry-run**（不动真钱），跑通信号→换算→收敛→风控→推送全链路 + 隔离架构；测试网、主网小额为后续 gated 阶段。

选定方案：Node + 已审计 `@nktkas/hyperliquid`；**执行端恒 hype**（sodex 仅监听不下单，无 sodex 执行腿）；信号源支持 sodex（跨所映射）/ hype（同所直通）；dry-run 先行；每目标独立进程 + 独立 agent wallet。

依据：`docs/hype/copy-trade-blueprint.md`、`docs/principles/copy-trade-strategy.md`、`docs/server-architecture.md`、`docs/watch/sodex.md`。

---

## 2. 全局流程状态机（核心交互逻辑 · SSOT）

### 2.1 跟单目标生命周期
```ts
type FollowPhase = "idle" | "anchored" | "following" | "capped" | "flat";
```
| phase | 进入条件 | 表现 | 迁移到 |
|---|---|---|---|
| `idle` | 启动，目标无可映射仓 | 不部署，等目标开仓 | anchored（目标开可映射仓） |
| `anchored` | 目标首次出现可映射仓 | 锚定 `ratio=(余额×INITIAL_DEPLOY_PCT)/目标可映射保证金` | following |
| `following` | 已锚定，正常对账 | 按 ratio 跟目标加/减仓，收敛 delta | capped / flat |
| `capped` | 部署需求 > 余额×MAX_DEPLOY_PCT | 封顶部署 + 触顶告警 | following（目标减仓回落）/ flat |
| `flat` | 目标可映射净仓归零 | 释放全部 | anchored（下轮新开，重锚 ratio） |

### 2.2 每仓校验门决策（下单前 gate）
```ts
type LegDecision = "place" | "skip-unmappable" | "skip-mindust" | "skip-maxpos" | "skip-capped" | "noop";
```
| decision | 条件 | 动作 |
|---|---|---|
| `skip-unmappable` | sodex 标的无 hype 映射 | desired=0，告警，**不进下单**，不计入 ratio 分母 |
| `skip-mindust` | 我方名义 < 交易所最小名义($10) | 跳过该仓 + 告警 |
| `skip-maxpos` | 我方该仓名义 > 余额×maxPositionPct | 封顶到上限；超出的加仓部分拦截 + 告警 |
| `skip-capped` | 已触 MAX_DEPLOY_PCT | 仅拦**加仓方向**，放行减仓/平仓（不阻止降风险）+ 告警 |
| `noop` | `|delta| < MIN_DELTA_PCT` 或 < 最小下单量 | 跳过（防碎步追单） |
| `place` | 以上都不命中 | dry-run would-place → 推送 + 日志 |

**顺序铁律**：① 算 desired → ②【校验门】LegDecision → ③ 仅 `place` 进 would-place → ④ 执行后推送（含各 skip 告警）。校验在下单前。

---

## 3. 共享契约（子 spec 只引用，不重定义）

### 3.1 targets.json schema（单目标硬限制）
```ts
type Target = {
  id: string;
  source: { platform: "sodex" | "hype"; address: string };  // 监听信号源（两所均可）
  exchange: "hype";                                   // 执行所恒 hype——sodex 仅监听不下单，无 sodex 执行腿
  agentKeyRef?: string;                               // systemd LoadCredential 名（dry-run 可空）
  subAccount?: string;
  initialDeployPct: number;                           // 默认 0.5
  maxDeployPct: number;                               // 默认 0.9
  capitalWeight?: number;                             // 多目标分配权重（增量阶段用；一期单目标=1，用全部可分配余额）
  maxPositionPct: number;                             // 单仓占比硬封顶
  minDeltaPct: number;                                // 最小变动阈值
  dryRun: boolean;                                    // 一期恒 true
  tgChat?: string;                                    // 跟单推送独立 chat
};
// 文件根：{ tgToken, targets: Target[] }；targets.length>1 → 拒绝启动
```

### 3.2 暴露给子件的核心函数签名
| 函数 | 签名 | 消费方 |
|---|---|---|
| `loadTargets` | `(path) → {tgToken, target}` | 01；>1 目标抛错 |
| `mapSymbol` | `(srcSymbol, srcPlatform) → hypeCoin \| null`；**sodex 源走映射表（跨所）；hype 源同所直通**（coin→coin，仅校验 hype 有该 coin） | 01/02/03 |
| `computeRatio` | `(avail, deployPct, targetMappableMargin) → number` | 02 |
| `computeDesired` | `(target当前可映射仓[], ratio, prices) → {coin, size}[]` | 02/03 |
| `recommendMinCapital` | `(目标可映射仓[], prices, initialDeployPct) → {minCapital, ratioMin, perLeg:{coin,targetNotional,legRatioMin,canFollow,reason}[]}` | 02 |
| `decideLeg` | `(desiredLeg, current, caps, prices) → LegDecision`；`caps = {maxDeployPct, maxPositionPct, minDeltaPct, minNotional, minOrderSize, currentDeployedNotional, availBalance}` | 03 |
| `diffDelta` | `(desired[], current[]) → delta[]` | 03 |
| `wouldUpdateLeverage` | `(leg) → wouldUpdateLeverageLog`（dry-run 产出"将同步杠杆"记录，不签名） | 03 |
| `fetchTargetState` | `(env, sodexAddr) → 仓位[]含保证金/杠杆` | api 横切 |
| `fetchHypePrices` | `(env) → {coin: midPx}` | api 横切 |
| `placeDryRun` | `(leg, ctx{assetIndex, szDecimals, slippageBps, dryRun}) → WouldPlaceLog` | 03（dry-run 不签名） |

**动作结果 schema（03 产出 → 04 消费，SSOT，消除子件间"字段名以 03 为准"未决）**：
```ts
type ActionResult = {
  targetId: string; coin: string; side: "buy" | "sell";
  decision: LegDecision;
  size: string; refPx: string; fillPx?: string;   // dry-run: fillPx 假定=refPx
  fee?: string; slippageBps?: number;              // dry-run 估算，缺失落 "0"/0
  dryRun: true; reason?: string;
};
```

### 3.3 资金模型规则与边界
| 项 | 规则 |
|---|---|
| ratio 分母 | **只算可映射仓**的目标已用保证金（不含股票/商品仓） |
| ratio 锚定 | `anchored` 时锚定；`following` 期固定；`flat`→下轮重锚 |
| 部署上限 | `min(目标保证金×ratio, 余额×maxDeployPct)`，触顶 → capped |
| 最低本金 | `ratio_min = max(最小名义/目标名义[coin])`；`minCapital = ratio_min×目标可映射保证金/initialDeployPct` |
| 单仓封顶 | `maxPositionPct`：某仓我方名义 > 余额×maxPositionPct → 封顶到上限（防目标高杠杆单仓打爆），校验门 `skip-maxpos` 拦加仓部分 |
| 精度 | px/sz 走 `process/precision.mjs` 的 `formatPrice`/`formatSize`（ROUND_DOWN）；**禁用 `tool/format`（仅展示，无精度运算）**、禁裸 `parseFloat` 运算 |
| 参数默认（采 blueprint §10.6） | `RECONCILE_INTERVAL_SEC`=10~30、`MAX_SLIPPAGE_BPS`=10~50（限价保护偏移）、`MAX_CHASE_BPS`=30~100（参考价偏离超此放弃跟单）、`MIN_DELTA_PCT`≈blueprint `RECONCILE_TOLERANCE_BPS` 20~50（容差防 churn，同概念不同名） |

### 3.4 复用件清单（直接 import，禁止重造）
| 需要 | 复用 |
|---|---|
| 代理 | `lib/WARP` |
| 展示格式化 / isAddress | `tool/format`（**仅展示与地址校验，无精度运算**） |
| 下单精度 ROUND_DOWN（formatPrice/formatSize） | **自实现 `HYPE-copy/process/precision.mjs`**（blueprint §8.3；依赖 decimal.js）——tool/format 不具备 |
| sodex 目标仓位读取 | 复用 `sodex-watch` 的 state 拉取（clearinghouseState 等价） |
| hype SDK / 价格 | `@nktkas/hyperliquid` |
| 限流退避模式 | 参考 `sodex-watch/api/index.mjs` 共享限流 |

### 3.5 命名 / 路由约定
- service：`service/HYPE-copy/`（一期）；将来 `service/sodex-copy/` 对称。
- systemd：`HYPE-copy@<target>.service`（trader-exec 用户 + LoadCredential）。
- 日志：`service/HYPE-copy/log/HYPE-copy-<target>-<date>.jsonl`。
- 文档：`docs/copy/hype.md`。

### 3.6 Agent Wallet（真实下单阶段；dry-run 不需要，仅占位）

> 核心设计原理见 `docs/hype/copy-trade-blueprint.md §10.7`（approveAgent / 只交易不提现 / 主私钥不上服务器 / 可过期撤销 / 每子账户独立授权）。本节为落地操作 SSOT。

**钱包角色（回答"能否用已有钱包"）**：
- **主钱包**（持资金/持仓）：**恒一个 hype 账户（公用，用你已有的钱包，不新建）**——所有跟单都在 hype 执行，无论信号源是 sodex 还是 hype；**sodex 仅监听不下单、不涉 agent**。只签 `approveAgent` 授权，之后永不上服务器（可离线/另一台机保管）。多目标隔离靠该主钱包下的**多个子账户**（每目标一个子账户 + 一个独立 agent，均由这一个主钱包授权）。一期单目标 = 1 子账户 + 1 agent。
- **agent 钱包**（代理签名）：**必须独立**（blueprint §10.7「授权一个独立的 agent 密钥」）——**推荐每个跟单子账户新生成一个空钱包**。**禁止用主钱包或有资产的钱包当 agent**（agent key 要放服务器，用主钱包=主私钥上服务器=最大风险）。

**为何 agent 必须独立空钱包**：agent key 有服务器泄露敞口，独立空钱包泄露损失最小——只能乱交易主账户（不能提现）、本身无资产；且可独立撤销/轮换、每子账户独立授权。

**设置 5 步（真实下单阶段）**：① 本地生成独立 agent 钱包 → ② 主钱包 `approveAgent(agentAddress)` → ③ agent 仅能下单/撤单不能提现 → ④ agent 私钥存 `/etc/tracker/HYPE-copy-agent.key`（chmod 600, trader-exec）→ ⑤ systemd `LoadCredential` 注入，执行器读 `$CREDENTIALS_DIRECTORY/agent-key` 做 EIP-712 签名。

**dry-run（一期）**：不签名、不需要真 agent key，targets.json 仅留 `agentKeyRef` 占位。agent 授权可过期 → 真实阶段需监控状态。

---

## 4. Phase0 脚手架（子件开工前完成）

1. **类型 + targets schema**（§3.1）+ `loadTargets`（单目标校验）。
2. **标的映射表 `mapSymbol`**（sodex symbol → hype coin；不可映射返回 null）+ 单测。
3. **api 横切封装**（`fetchTargetState` / `fetchHypePrices` / `placeDryRun`）——见 `auto-copy-trade-api.md`。
4. **mock**：目标仓位 / 价格 mock，供纯函数单测 drop-in。

---

## 5. 集成点（带锚点）

- `service/HYPE-copy/main.mjs` — 执行器入口（单目标，对账循环）。
- `service/HYPE-copy/process/{mapping,sizing,reconcile,risk,recommend,precision}.mjs` — 纯逻辑（`precision` = ROUND_DOWN 下单精度，自实现）。
- `service/HYPE-copy/api/index.mjs` — sodex 读 + hype 价格/dry-run 封装。
- `service/HYPE-copy/{targets.json,log/,test/domain.test.mjs}`。
- `service/app/index.mjs` — 纳入 `HYPE-copy@.service` 模板单元编排。
- `docs/copy/hype.md` — 执行腿文档。

---

## 6. 验收标准（总览，细化见各子 spec）

- [ ] 单目标启动；≥2 目标拒绝启动。
- [ ] 标的映射正确，不可映射跳过 + 不计入 ratio 分母。
- [ ] 资金模型：锚定/跟仓/触顶/释放重锚全状态正确。
- [ ] 最低本金算法输出推荐额 + 可跟/跳过清单。
- [ ] 校验门顺序：skip 类不产生 would-place。
- [ ] dry-run 只打印 would-place、不签名；滚仓对齐最新净仓不逐步追。
- [ ] 跟单 TG 推送独立、delta=0 不推。
- [ ] JSONL 日志每动作一条。
- [ ] 隔离：trader-exec 用户 + 每目标独立进程 + wallet 占位。
- [ ] 纯函数单测全绿。

## 7. 验收场景（Given/When/Then）

### 场景 1：可映射目标 dry-run 跟单
- **Given** 单目标，余额 500，INITIAL_DEPLOY_PCT=50%，dryRun=true；目标持 sodex ETH 多 10 张（可映射，保证金 4000，5x）
- **When** 执行器对账
- **Then** ratio=6.25%，would-place hype ETH 多 0.625 张；推 `[DRY-RUN]`；落一条 JSONL

### 场景 2：不可映射 + 触顶
- **Given** 目标含 PLTR 仓（hype 无）；另目标 ETH 保证金从 4000 加到 9000，余额 500/MAX 90%
- **When** 对账
- **Then** PLTR→skip-unmappable（不计分母）；ETH 需求 562.5>450→capped 封顶 450 + 告警

### 场景 3：单目标硬限制
- **Given** targets.json 配 2 个目标
- **When** 启动
- **Then** 拒绝启动 + 报错"一期仅支持单目标"

---

## 8. 子 spec 依赖拓扑（落地流水线脚本）

```
前置 → Phase0(类型+映射+api横切+mock)
        → 01 配置加载+标的映射
        → 02 资金模型+最低本金算法
        → 03 收敛对账+校验门+dry-run下单
        → 04 推送+日志
05 隔离与部署（依赖 03/04 有可跑执行器，可最后并行）
        → 06 文档（系统成形后，写 docs/copy/hype.md 记录跟单思路/流程/方法/sodex-hype 差异）
auto-copy-trade-api.md（横切，Phase0 底座，01-04 共享）
```

| 阶段 | 子 spec | 类型 | 依赖 |
|---|---|---|---|
| Phase0 | （总纲 §4 + api 横切） | 逻辑 | 前置 |
| 1 | `01-config-mapping.md` | 逻辑 | Phase0 |
| 2 | `02-sizing-recommend.md` | 逻辑 | 01 |
| 3 | `03-reconcile-dryrun.md` | 逻辑 | 02 |
| 4 | `04-notify-log.md` | 逻辑 | 03 |
| 5 | `05-isolation-deploy.md` | 逻辑/部署 | 03、04 |
| 6 | `06-docs.md` | 文档 | 01-05（系统成形后总结，写 `docs/copy/hype.md`） |
| 横切 | `auto-copy-trade-api.md` | 逻辑 | Phase0 |

> 落地：每阶段读总纲+子件 → `/k:task` → `/k:check` → `/k:commit` → gate 停 → 下一阶段。冲突以总纲为准。
> **后续阶段（不在本 spec-set）**：
> ① **独立多目标 + 资金分配层（紧接增量）**——放开单目标限制；`targets[]` 多条，每条 `capitalWeight` 按 `weight/Σweight` 把主钱包资金分配到各子账户额度。**两层分配**：层1 主钱包→各子账户额度（Σ≤总资金×部署上限，留缓冲）；层2 **复用单目标"锚定首仓+90% buffer+保证金等比+最低本金"模型**（把"余额"换成"子账户额度"）。是 **N 个独立 1:1**（独立子账户/资金/agent，互不影响），**非 N:1 共享，无需净额收敛**。dry-run 不真实划拨，模拟。
> ② 测试网真实下单 → 主网小额；③ agent key 真实签名；④ N:1 共享账户净额收敛（更远，如需）；⑤ 目标熔断自动判定阈值；⑥ sodex 执行腿。
