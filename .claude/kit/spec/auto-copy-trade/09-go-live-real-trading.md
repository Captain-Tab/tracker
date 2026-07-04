# Spec 09 · dry-run → 实盘落地（取消 dry-run，真实下单）

> 引用总纲 `00-overview.md` + 子件 `07-budget-alloc.md`（v3 模型）+ `08-position-persistence.md`（S0/T0 持久化，见 §4.3）。流程 / 状态机 / 共享契约以总纲为准，SDK 契约以本文 §2 为准（已核实）。
> 落地时本 spec 已读，**勿重新生成**；按 §7 流水线 `/k:task` 逐 Phase 执行。
> 依据：`docs/copy/hype-go-live.md`（缺口清单）、`docs/hype/copy-trade-blueprint.md §8/§10`、SDK `@nktkas/hyperliquid@0.33.1` 源码实测。

---

## 0. 前置事实（HARD，落地前必须理解）

调研已证实两件影响范围的事实：

1. **v3 资金分配（spec 07）只落了 Phase A（api）+ B（allocation 四纯函数），Phase C/D/E 从未落地**：
   - `allocation.mjs` 缺 `planFollow`（size 跟随，spec 07 §3.3 已定义但未实现）。
   - `main.mjs` 仍用旧 ratio（`computeRatio`:88 / `computeDesired`:98），**从未调用** `selectLeverage`/`planOpen`/`planDefend`。
   - `risk.mjs` 仍是旧六分支，未删 `skip-maxpos`(:33)/`skip-capped`(:38)，未加 `would-defend`/`skip-no-open`。
   - `targets.json` 已填 v3 字段（`minOpenCapital:500`/`maxCoinCapital:1000`/`allocationModel:"budget"`），但 `main.mjs` 读旧字段 `initialDeployPct`（配置里没有）→ **当前 dry-run 的 ratio 计算实为 NaN，输出不可信**。`targets.example.jsonc` 也还是旧 ratio 字段。

2. **`order` 回执不含手续费**：SDK `order` 返回 `response.response.data.statuses[].filled` 只有 `totalSz`/`avgPx`，**无 fee/closedPnl**。真实 fee 必须回查 `InfoClient.userFills`（含 `fee`/`closedPnl`/`builderFee`）。go-live 文档 #9 与 blueprint §8.4 未点明此坑，本 spec 修正。

**因此本次"取消 dry-run"是两段串行工作，不可跳过第一段**：

| 段 | 范围 | 动真钱 | gate |
|---|---|---|---|
| **Part A** | 补完 spec 07 Phase C/D/E（dry-run 内接线 v3），跑通验证生存杠杆/保证金防守/size 跟随 | ❌ | dry-run 观察合理后进 Part B |
| **Part B** | 真实余额 → agent wallet 签名 → 真实下单/杠杆/保证金 → fee 回填 → chase 放弃 → dryRun 翻转 → systemd 注入 key | ✅ | 每 Phase diff 过审 + 主网小额观察 |

上线路径：**直接主网小额**（用户选定，跳过测试网）。因此 Part A 的 dry-run 验证是唯一的"上真钱前"防线，务必充分。

---

## 1. 目标与边界

- **目标**：单目标跟单执行器从 dry-run 切真实主网下单，资金/杠杆/保证金走 spec 07 v3 预算模型。
- **不做（本 spec 外）**：spec 07 Phase 2 自浮盈滚仓（A5 gate）；多目标资金分配；N:1 净额收敛；目标熔断自动判定；sodex 执行腿。
- **信号源**：`targets.json` 现为 `source.platform:"sodex"`（跨所映射），执行端恒 hype。不变。

---

## 2. SDK 契约（SSOT，已核实 @nktkas/hyperliquid@0.33.1 · 禁臆测）

> 全部行号相对 `node_modules/@nktkas/hyperliquid/esm/`。构造用法见 §5.2。

### 2.1 transport / client 构造
```js
import { HttpTransport, InfoClient, ExchangeClient } from "@nktkas/hyperliquid";
import { privateKeyToAccount } from "viem/accounts";

const transport = new HttpTransport({ isTestnet: false, timeout: 10_000 }); // 切网用 isTestnet，非 baseUrl
const info = new InfoClient({ transport });
const wallet = privateKeyToAccount(AGENT_PRIVATE_KEY);   // viem local account 直接满足 AbstractWallet
const exchange = new ExchangeClient({ transport, wallet });
```
- transport **无 fetch 注入参数**；WARP 代理靠 `lib/WARP/installFetchProxy()` 的 **undici `setGlobalDispatcher(ProxyAgent)`**（改的是 Node 全局 fetch 底层 dispatcher，**不是** 替换 `globalThis.fetch`）。**仅当 SDK 用 Node 全局 fetch 时才生效**——若 SDK 内部自建 undici Agent 则代理不生效、签名请求走真实 IP。**Part B 前必须抓包验证 SDK 出网确经代理**；且 `installFetchProxy` 失败/undici 缺失时当前是静默直连（`WARP/index.mjs:14-16`），实盘应改为强制失败退出（见 §9 安全缺口）。
- nonce **SDK 自动管理**（`Date.now()`+每钱包单调计数），无需自实现。

### 2.2 InfoClient.clearinghouseState（读余额 + 我方仓位/强平价）
`info.clearinghouseState({ user })` → 字段（全 string）：
| 用途 | 路径 |
|---|---|
| **可用余额** | `withdrawable`（顶层）— 跟单 avail 用此 |
| 权益 | `marginSummary.accountValue` |
| 我方仓位 | `assetPositions[].position`：`coin` / `szi`(有符号) / `entryPx` / **`liquidationPx: string\|null`**（null=无强平风险）/ `marginUsed` / `leverage:{type,value,rawUsd?}`（倍数取 `.value`） |

### 2.3 ExchangeClient 写动作（真实签名提交）
| 方法 | 参数 | 返回关键字段 |
|---|---|---|
| `order` | `{ orders:[{a:idx, b:isBuy, p:"px", s:"sz", r:reduceOnly, t:{limit:{tif:"Ioc"}}}], grouping:"na" }` | `response.response.data.statuses[i]`：`{filled:{totalSz,avgPx,oid}}` / `{resting:{oid}}` / `{error:string}` / `"waitingForFill"`。**无 fee** |
| `updateLeverage` | `{ asset:idx, isCross:false, leverage:整数≥1 }` | ok/err |
| `updateIsolatedMargin` | `{ asset:idx, isBuy:仓位方向(多true/空false), ntli:金额×1e6(整数,正=加/负=减) }` | ok/err |
| `approveAgent` | `{ agentAddress:"0x..", agentName?:"tracker-bot" }`（chainId/hyperliquidChain/nonce 由 SDK 自动填） | `{status:"ok"}` |

- tif 枚举：`"Gtc"|"Ioc"|"Alo"|"FrontendMarket"`。跟单沿用现有 `Ioc`（IOC + 滑点保护价）。
- **成交量/均价**在 `statuses[i].filled.totalSz`/`avgPx`；`totalSz<下单 s`=部分成交（IOC 剩余已撤）；`error`=该单被拒；顶层 `status:"err"` 直接 **throw `ApiRequestError`**（带 `.response`）。

### 2.4 真实手续费 / 已实现盈亏（回填必须）
`order` 回执无 fee。切实盘后每笔成交回查：
`info.userFills({ user })` → `UserFill[]`：`fee:string`(负=返佣) / `closedPnl:string` / `builderFee?:string` / `feeToken` / `oid`(对回下单单) / `crossed:boolean`(taker) / `px`/`sz`。
滑点 = `filled.avgPx` vs 下单参考价 `refPx` 自算。

### 2.5 与 blueprint §8 出入（修正记录）
1. **order 回执无 fee** → 必查 userFills（blueprint §8.4 未强调，本 spec §2.4 修正）。
2. user-signed 动作（approveAgent）`signatureChainId`/`hyperliquidChain` **由 SDK 自动填，调用方不传**（blueprint §8.2 未说明）。
3. 代理靠全局 fetch（transport 无注入点）。
4. 其余（order 字段 / nonce / updateLeverage / transport 用 isTestnet）blueprint 描述准确。

---

## 3. Part A — 补完 v3 接线（dry-run，spec 07 Phase C/D/E）

> 完整设计见 spec 07 §3.3/§3.6/§3.7。本节只列落地清单与代码触点，不重复公式。

### 3.1 Phase C：改造 `risk.mjs`（校验门）
- **删** `skip-maxpos`(:33) / `skip-capped`(:38) 两分支（预算即上限，maxCoinCapital 封顶 + maxPositions 槽位替代百分比封顶）。
- 保留 `skip-unmappable`(:11) / `skip-mindust`(:29) / `noop`(:41) / `place`(:45)。
- 新增 `would-defend`（planDefend.wouldAddMargin>0）/ `skip-no-open`（selectLeverage 返回 null）。
- `caps` 入参去 `maxDeployPct`/`maxPositionPct`，改 `minOpenCapital`/`maxCoinCapital`。
- 单测同步删/改（`test/domain.test.mjs` 两分支用例）。

### 3.2 Phase D-1：补 `allocation.mjs` `planFollow`（size 跟随）
签名（spec 07 §3.3）：
```js
export function planFollow({ openSize, openTargetSzi, targetSzi, szDecimals }) → { desiredSize, followRatio }
// followRatio = min(1, |targetSzi|/|openTargetSzi|)  ；封顶 1（增仓超 T0 不跟，滚仓留 Phase 2）
// desiredSize = signOf(targetSzi) × ROUND_DOWN(|openSize| × followRatio, szDecimals)
// |openTargetSzi|≤0 异常 → followRatio=1（保持 S0）
```
纯函数 + 单测（目标减/平/回补/增仓封顶四场景，spec 07 §7 场景 6）。

### 3.3 Phase D-2：新增顶层编排 `planBudgetReconcile`（纯函数，放 `reconcile.mjs`）
> 落在 `reconcile.mjs`（对账编排层，取代同文件 `planReconcile` 的 ratio 链路、已 import risk/allocation），非 `allocation.mjs`（后者只放逐币原语）。
把 spec 07 §3.7 伪代码实现为纯函数，main 只做 I/O + state 副作用：
```js
export function planBudgetReconcile({
  mappable,        // [{coin, szi, leverage, entryPx, lp, marginUsed}]
  prices,          // coin→mid(str)
  assetIndex,      // coin→{index, szDecimals, maxLeverage}
  myPosByCoin,     // Map<coin,{margin,openSize,openTargetSzi,leverage,side}>（只读）
  config,          // {minOpenCapital, maxCoinCapital}
  availBalance,
  getMyLiqPrice,   // 注入：dry-run=computeMyLiqPrice 闭包 / 实盘=liquidationPx
}) → {
  actions,         // [{coin, decision, isBuy, reduceOnly, desiredSize, size, refPx, openLeverage, M0,
                   //   wouldAddMargin, ntli, liqBefore, liqAfter, exhausted, targetLp, myLiqPx, mm, reason}]
  stateUpdates,    // [{coin, op:"set"|"addMargin"|"delete", ...payload}]  ← 副作用留 main
  alerts,          // top-N 超限 / 本金不足 / exhausted
}
```
内部分派（spec 07 §3.7）：无仓→`selectLeverage`(null→skip-no-open)+`planOpen`(mindust→skip)；反手→平后删；同向→`planFollow`(size)+`planDefend`(margin)；目标消失→平。
- `mm = 1/(2×maxLeverage)` 在此折算（maxLeverage 来自 `assetIndex.get(coin).maxLeverage`）——**当前无归属，本函数补**。
- `maxPositions = floor(availBalance/maxCoinCapital)`；目标币数超之 → 跟 top-N（目标名义降序）+ alert。
- 纯函数不改 Map，`stateUpdates` 交 main 落。
- **`decideLeg` 调用点（消歧）**：`planBudgetReconcile` 算出每币 `desiredSize` 后，对该腿调一次改造后的 `decideLeg`（§3.1，只剩 unmappable/mindust/noop/place）做最后校验门——即 orchestrator 定 size、decideLeg 定放不放行，**单点 gate 不双重**。would-defend/skip-no-open 由 orchestrator 直接产出（不过 decideLeg）。
- **`reconcile.mjs` 处置**：`planReconcile`(:27) 的"diffDelta→decideLeg→ratio"链路被 orchestrator 取代 → **标 @deprecated 或删**（连同 :8 "dry-run current 恒 null"注释）。`diffDelta` 若 orchestrator 内部复用则保留导出，否则一并废弃。落地时确认无其他 import。

### 3.4 Phase D-3：`main.mjs reconcileOnce` 接线（改动清单）
| main.mjs 行 | 现状 | 改动 |
|---|---|---|
| :6-7 | import computeRatio/computeDesired/recommendMinCapital | 改 import `planBudgetReconcile`（+ dry-run 用 `computeMyLiqPrice`）；删旧三个 |
| :35-46 | state 无 myPosByCoin | **新增** `state.myPosByCoin = new Map()`；entry = `{margin, openSize(S0), openTargetSzi(T0), leverage, side, curSize}`（在 spec 07 §3.6 基础上加 `curSize`=当前实际镜像 size，供 orchestrator 算 delta；每轮 setCurSize 更新） |
| :64-68 | mappable.push 未带 lp | 加 `lp`（normalizeTargetPositions 已产 :149，只需带进对象） |
| :86-122 | hasMappable 分支 ratio/anchoredRatio/computeDesired/desiredEnriched | 整块替换为 `planBudgetReconcile(...)` 调用；ratio/anchoredRatio 删 |
| :94-96 | recommendMinCapital + min-capital event | 删或改预算口径（非编排必需） |
| :124-138 | current/caps/planReconcile | 删（决策进 orchestrator）；caps 换 minOpenCapital/maxCoinCapital |
| :140-162 | actions 循环仅 place | 扩展：place 且新开→先 `buildWouldUpdateLeverage` 再 placeDryRun；新增 `would-defend`→`buildWouldUpdateMargin`；`skip-no-open` 分支 |
| :143-151 | skip-maxpos/skip-capped 上下文注入 | **删** |
| :73-77 | P&L 快照 lastCrByCoin/lastCfByCoin/lastTargetSziByCoin/lastLeverageByCoin | 保留（平仓卡片 P&L 仍需目标 cr/cf 快照）；并入 myPosByCoin 或维持旁路 Map |
| :164-183 | 平仓检测（prevCoins/lastWouldHold 差集 → close 事件 + P&L） | **改**：平仓判定移入 `planBudgetReconcile`（目标消失→decision:"place"平仓 + stateUpdates delete，spec 07 §3.7）；main 只据 orchestrator 的平仓 action 出 close 卡片，**不再自己算差集**（防与 orchestrator 双发）。**P&L 口径（v3 无 ratio）**：mirrorPnl 改用平仓时我方 size 的实际盈亏——dry-run 用 `我方size/目标szi × targetCr` 折算（近似），实盘用 userFills.closedPnl 权威回填（§2.4） |
| :204 | lastWouldHold=desired 镜像 | 由 `stateUpdates` 维护 myPosByCoin 派生 |
| :211-217 | banner kind 推导（hasClose 基于 prevCoins 差集） | 改：hasClose/hasOpen 从 orchestrator 的 actions（含平仓/新开 decision）判定，不再靠 lastWouldHold 差集 |
| :221 | skippedCoins 取 skip-maxpos | **删** |
- dry-run getMyLiqPrice 注入：`getMyLiqPrice({dryRun:true, estimate:()=>computeMyLiqPrice({entryPx, margin, size:desiredSize, side, mm})})`，margin 取 `myPosByCoin[coin].margin`。
- state 落地：按 `stateUpdates` 对 `myPosByCoin` set/addMargin/delete（开仓 set margin=M0/openSize=S0/openTargetSzi=T0/leverage/side；would-defend addMargin；平仓 delete）。dry-run 模拟累计，重启从空重锚。

### 3.5 Phase E：notify + 配置 + 清理
- `notify/templates.mjs`：加 `would-defend`（补保证金 ntli/liqBefore→liqAfter/size不变）/ `skip-no-open` 文案；删 skip-maxpos/skip-capped 文案(:184-195)。
- `notify/index.mjs`：`ALERT_RESULTS` 去 skip-maxpos/capped，加 skip-no-open（would-defend 非告警）。
- `targets.example.jsonc`：**加** `allocationModel:"budget"`/`minOpenCapital`/`maxCoinCapital`/**`masterAddress`**，标 `@deprecated initialDeployPct/maxDeployPct/maxPositionPct`。
- **`masterAddress`（新必填字段，Part A 一次性加，勿拖到 Part B）**：我方持仓账户地址（= agent wallet 授权的主钱包地址）。**与 `source.address`（目标地址）正交**，不可混用、不可从 agent key 反推（单凭 agent key 无一次 SDK 调用能反查主钱包）。dry-run 阶段可留空（不查真实余额/持仓），实盘 B-1/B-3 必须有 → `loadTargets` 校验：`dryRun===false && !masterAddress` → 拒绝启动。
- `loadTargets`（mapping.mjs）：校验 v3 字段（minOpenCapital/maxCoinCapital 存在且 >0；availBalance ≥ maxCoinCapital 否则告警"本金不足"；实盘 masterAddress 必填）。
- **全仓 grep `skip-maxpos|skip-capped`**（含 docs/notify/copy.md 示例）确认无残留。
- `docs/copy/allocation.md`（spec 07 Phase F）与代码对齐。

### 3.6 启动基线快照 —— 只跟部署后的新开仓（HARD 需求）

**现状（要改）**：`main.mjs` 启动轮（`pendingStartup`:41）把目标**当前全部持仓**锚定并镜像（kind`initial_sync`:212，对存量仓产 would-place :98/:138/:156）。实盘下=一部署就接盘存量仓。

**要求**：部署后**只跟目标新开的仓**，**不跟部署时已存在的仓**。理由不仅是行为预期，更是 v3 安全刚需——`selectLeverage`/`planOpen` 用目标 `entryPx` 定生存杠杆/size（`allocation.mjs:33/55`），中途接盘时目标 entry 与当前 mid 已背离，"开仓即强平价≥目标 lp"的保证失效。

**设计（重启安全，走 spec 08 持久化）**：
- **首次部署**（持久化文件缺失）：快照目标当前持仓币种 → `state.baselineCoins: Set<coin>`，落盘。这些币**永不跟**。
- **followable 判定**：目标某币，`!baselineCoins.has(coin) && !myPosByCoin.has(coin)` 且目标该币有仓 = 部署后新开 → 走开仓分支；在 `baselineCoins` 中 → 完全跳过（不开、不跟增减、不防守）。
- **baseline 币平掉后移出**：目标平掉某 baseline 币（从目标持仓消失）→ 从 `baselineCoins` 删并落盘；将来再开 = 新开 → 跟。
- **重启不重拍**：`baselineCoins` + `myPosByCoin`（含 S0/T0，§4.3）都持久化；重启恢复，不重新快照、不重新镜像存量、不把在跟的仓误当新基线。
- **⚠️ 持久化损坏/丢失的降级（HARD，安全默认）**：spec 08 store 损坏/缺失时降级空数组——此时**绝不能**把目标现有仓当新开去跟（否则=全额接盘存量，正是要防的 bug）。降级铁律：**状态不可信 → 重新把目标当前全部持仓快照为 `baselineCoins`（视同首次部署）+ `myPosByCoin` 置空**。宁可"漏跟已在跟的仓"（保守、无资金损失），绝不"接盘存量仓"。用一个独立持久化标志 `baselineCaptured:true` 区分"确已建过基线但当前无仓"与"状态丢失"，避免误判。
- **反手边界**：目标 baseline 币 long→short（szi 不过 0、币未从目标持仓消失）→ 保持在 baselineCoins，**仍跳过**（我方未从该仓起点参与，中途接反向仓同样破坏生存杠杆锚定）。仅当该币真正归零消失再重开才跟。
- **启动 banner**：kind 从 `initial_sync`（镜像存量）改为"基线已记录，等待新开仓"，列出被忽略的 baseline 币；`main.mjs:196/211-217` 的 startup 分支相应调整。
- **落地位置**：`planBudgetReconcile` 入参加 `baselineCoins`，在遍历目标币时先过滤；main 负责首轮/降级快照 + 落盘 + 平仓移出。

### 3.7 Part A 验收（dry-run）
- 纯函数单测全绿（planFollow + planBudgetReconcile + 既有）。
- spec 07 §7 六场景 dry-run 复现：500 跟 LIT 5x 不再整仓 skip；杠杆=2、size≈583、强平价≈2.337>目标；目标减→size 按比例减；防守补 margin size 不变；exhausted 告警。
- 部署 dry-run 联网观察 JSONL / 推送：would-place（名义/方向/杠杆）+ would-update-leverage + would-update-margin 合理。
- **gate：dry-run 输出合理 → 进 Part B。**

---

## 4. Part B — 切实盘（真实下单）

### 4.1 Phase 1：真实可用余额 + 我方持仓（无签名，最安全，先做）
- `api/index.mjs`：新增 `fetchMyState(env, masterAddress)` → **单次** `new InfoClient({transport}).clearinghouseState({user:masterAddress})`，一次拉取同时供：`withdrawable`（可用余额）+ `assetPositions[].position`（我方持仓 szi/entryPx/marginUsed/liquidationPx/leverage）。**不拆成两次调用**（余额与 getMyLiqPrice 的实盘数据源是同一端点同一 user，合并一次）。
- `main.mjs:248-252`：`avail` 从 `availBalanceSim` 改为 `fetchMyState(...).withdrawable`；保留 `--avail` 覆盖用于 dry-run。`reconcileOnce` 内与目标态/价并行 `Promise.all`（实盘 4 路：目标态 + 价 + meta + 我方态）。
- `masterAddress` 来源：**`targets.json.masterAddress`（§3.5 已定为必填字段）**。查的是主账户地址，**不是** agent 地址；**不可从 agent key 反推**（措辞已删）。dry-run 下此 Phase 不启用（仍用 availBalanceSim），实盘启用。

### 4.2 Phase 2：Agent Wallet（本地一次性，见 §5）
新增 `tool/approve-agent.mjs`（本地跑）。部署产物：`/etc/tracker/HYPE-copy-<id>-agent.key`（chmod 600 + trader-exec）。

### 4.3 Phase 3：真实签名下单 + 杠杆 + 保证金
- `api/index.mjs`：新增 `makeExchangeClient(agentKey)`（transport+wallet+ExchangeClient 单例，进程启动一次）。
- `placeDryRun` throw 分支(:216-219)：`dryRun!==true` 时改为 `await exchange.order({orders:[order], grouping:"na"})`，解析 `statuses[0]`：`filled`→回填 totalSz/avgPx；`error`→告警不重发；`resting`（IOC 理论不 resting）→告警。
- `buildWouldUpdateLeverage` throw(:253)：实盘 `await exchange.updateLeverage({asset, isCross:false, leverage})`；**失败仅告警不阻断下单**（blueprint §8/§9 铁律）。**语义漂移提示**：go-live #7"杠杆同步"原义=镜像目标杠杆，v3 已改为**自算生存杠杆** `selectLeverage(floor L*)`（不跟目标杠杆），此处 updateLeverage 设的是生存杠杆值，非目标杠杆。
- `buildWouldUpdateMargin` throw(:265)：实盘 `await exchange.updateIsolatedMargin({asset, isBuy, ntli})`。
- `getMyLiqPrice` 实盘分支(:247)：读 `fetchMyState` 的 `assetPositions[].position.liquidationPx`（null→不补）；`margin` 读 `marginUsed`。这两个是**当前态**，权威，不再模拟累计。
- **⚠️ HIGH：实盘 S0/T0 基线必须持久化，不能从 clearinghouseState 读**。planFollow 依赖 `openSize(S0)`/`openTargetSzi(T0)`（开仓时基线），而 clearinghouseState 只有**当前** szi/margin/liqPx，**没有开仓基线**。因此：
  - `margin`/`liqPx`/当前 szi → 实盘从 clearinghouseState 读（当前态）。
  - `openSize(S0)`/`openTargetSzi(T0)` → **走 spec 08 持久化**（`tool/lastPositionsStore.mjs` 同款落盘，或新增 copy 专用 store）：开仓时写盘，重启从盘恢复。**严禁**用当前 clearinghouseState 当 T0（会把已减仓后的现状当基线，followRatio 误归 1，后续减仓跟随失准）。
  - 落地：`myPosByCoin` 拆两源——{margin,liqPx,curSzi}=clearinghouseState（实盘）/模拟（dry-run）；{S0,T0,leverage,side}=持久化（两阶段都要落盘，dry-run 亦然以对齐行为）。
- agent key 读取：`process.env.AGENT_KEY` 或 `$CREDENTIALS_DIRECTORY/agent-key`（systemd LoadCredential）。

### 4.4 Phase 4：真实 fee/滑点 + MAX_CHASE_BPS
- **fee 回填**：下单成交后（或每轮末）`info.userFills({user})` 按 oid 匹配本轮下单，回填 `fee`/`closedPnl` 到 event/JSONL/stats（替换 `main.mjs:161` 的 `fee:"0"`、:176 的 `mirrorFee:"0"`）。滑点 = avgPx vs refPx。
- **MAX_CHASE_BPS**（新增，默认 30-100，spec 由 dry-run 实测偏离分布标定）：下单前比 `allMids()` 最新 refPx 与"目标成交价基准"偏离，超阈值 → `skip-chase` 放弃该单 + 告警（blueprint §10.5）。落点：`planBudgetReconcile` 或 main 下单前。dry-run 期先"只记录不放弃"打偏离分布。

### 4.5 Phase 5：翻转 + systemd 注入 key
- `app/index.mjs`：`hypeCopyTemplateUnit`(:159) 取消注释 `LoadCredential=agent-key:/etc/tracker/HYPE-copy-%i-agent.key`(:173)；启用 `User=trader-exec`/`Group=trader-exec`(:166) + `ProtectHome`（需先迁移代码到 `/opt/tracker`，见 :171 注释）。
- `targets.json`：`dryRun:true→false`（**最后一步**，主网小额观察确认后）。（`masterAddress` 已在 Part A §3.5 加为必填，此处不重复。）
- 主网小额：小 `availBalance` / 单目标 / 观察 fee 侵蚀（stats.mjs）。

### 4.6 Part B 验收（主网小额）
- Phase 1 单独部署：dry-run + 真实余额，确认余额拉取正确。
- Phase 3 后小额真实下单：单币开仓 → 确认链上 fill / 杠杆 / 逐仓保证金正确；updateLeverage 失败不阻断验证。
- fee 回填与 userFills 一致；滑点在 MAX_SLIPPAGE_BPS 内。
- 目标平仓 → 我方 reduceOnly 平，closedPnl 正确。
- 全局急停 `/flatten` 可用（若未实现，列为 Part B 前置，blueprint §10.6）。

---

## 5. Agent Wallet 授权与续签

> **完整设计（概念/原理/三模式/流程/安全/续签/到期通知/撤销）见 [`docs/copy/agent-wallet.md`](../../../docs/copy/agent-wallet.md)**。本节只留 spec 层要点，细节以该文档为准。

### 5.1 原理
主钱包私钥**永不上服务器**，本地签一次 `approveAgent(agentAddress)` 把一个独立 agent 地址登记为交易代理；agent **只能交易不能提现/转账**。**授权只吃 agentAddress，不吃 agent 私钥**（私钥只在之后执行器签单用）。服务器只存 agent key。可过期（`agentName` 带 `valid_until`）/ 可撤销；急停仍必要（agent 能下亏损单）。

### 5.2 落地（Phase 2 提供 `provision/hype-copy-approve-agent.mjs`，用户本地执行）
- **放置**：`provision/`（repo 根，`service/` 之外，**不随部署上服务器**）——**非** `tool/`（那是运行时 helper 会部署）。
- **形态**：纯函数 `approveAgentForCopy({mainPrivateKey, agentAddress, agentName, isTestnet})`（只吃地址、可 mock 单测）+ CLI（三模式解析地址 / 隐藏输入主私钥 / 二次确认）+ 薄 `renew` 包装（禁生成、换新 valid_until）。
- **三模式**：A 已有 agent 私钥（派生地址）/ B 只有 agent 地址（私钥不碰本机，最安全）/ C 生成新 agent。
- **安全铁律**：主私钥走 **stdin 隐藏输入**（禁 inline env / 命令行，审计 S7）、仅内存用完即弃、不进日志；agent 私钥只打印不落盘；端点硬编码；`provision/.gitignore` 兜底 `*.key`。
- **续签**：对同一 agentAddress 再授权换新 `valid_until`，复用同一签名函数 + `renew` 入口。
- **到期通知（Part B）**：反应式（签名失败→告警+安全态，必需）+ 主动式（到期前 N 天提醒，建议）。
- **落盘 + 注入**：`echo agentKey | tee /etc/tracker/HYPE-copy-<id>-agent.key` + chmod 600 + chown trader-exec；systemd `LoadCredential`（Phase 5 取消注释）。

---

## 6. 落地流水线（每 Phase：读 spec → /k:task → /k:check → diff 过审 → /k:commit → gate）

| Phase | 内容 | 动真钱 | 依赖 |
|---|---|---|---|
| A-C | risk.mjs 改造 + 单测 | ❌ | — |
| A-D1 | allocation.planFollow + 单测 | ❌ | A-C |
| A-D2 | allocation.planBudgetReconcile + 单测 | ❌ | A-D1 |
| A-D3 | main.mjs 接线 + myPosByCoin state + **启动基线快照（§3.6，只跟新开仓，持久化）** | ❌ | A-D2 |
| A-E | notify + 配置 schema + 清理 skip-maxpos/capped + allocation.md | ❌ | A-D3 |
| **gate** | **dry-run 联网观察合理（§3.7）** | — | A-E |
| B-1 | 真实余额 fetchMyBalance | ❌ | gate |
| B-2 | approve-agent.mjs（本地授权，用户执行） | ❌ | — |
| B-3 | 真实 order/updateLeverage/updateIsolatedMargin + getMyLiqPrice 实盘 | ✅ | B-1,B-2 |
| B-4 | fee 回填(userFills) + MAX_CHASE_BPS | ✅ | B-3 |
| B-sec | **安全硬阻断**（§8 S2/S3/S4/S5/S6/S7）：空响应防全平 + flatten 急停 + 价格 sanity/size 硬顶 + lockfile/去 root + agent key 仅 LoadCredential | ✅(前置) | B-3 |
| B-5 | systemd 注入 key + dryRun→false + 主网小额 | ✅ | B-4, B-sec |

---

## 7. 风险与守卫

| 风险 | 守卫 |
|---|---|
| v3 逻辑未验证就动真钱 | Part A dry-run gate 强制（本 spec §0/§3.7） |
| 部署即接盘目标存量仓（entry 背离，生存杠杆失效） | 启动基线快照，只跟部署后新开仓（§3.6，持久化重启安全） |
| updateLeverage 失败阻断下单 | 失败仅告警不阻断（§4.3，blueprint 铁律） |
| IOC 部分成交盲目重发 | 读 totalSz，剩余交下轮对账，不重发（§2.3） |
| 追高接盘 | MAX_CHASE_BPS 放弃（§4.4） |
| 主私钥泄露 | agent wallet，主私钥不上服务器（§5） |
| agent 授权过期 | 监控授权状态，到期前重新 approveAgent（§5.1） |
| agent 乱交易 | 急停 /flatten（§4.6 前置） |
| 重启丢 S0/T0 基线 | **S0/T0 走 spec 08 持久化落盘/恢复**（§4.3 HIGH）；margin/liqPx 实盘从 clearinghouseState 读。严禁用当前态当 T0 |
| fee 用 0 估算失真 | userFills 回填真实 fee（§2.4/§4.4） |

---

## 8. 安全缺口（subagent 审计产出 · 切实盘 HARD 前置）

> dry-run 现状基本安全（下单三闸门 `dryRun!==true` 强拦、默认 dryRun:true、gitignore 到位、single-flight 正确、限流退避不打爆）。以下多为 Part B 新增攻击面；标「当前」的 dry-run 期也要处理。

| # | 缺口 | 级别 | 触点 | 处置（Part B 前必堵 = 阻断项） |
|---|---|---|---|---|
| S1 | targets.json 含活的 TG token，曾 0644 world-readable | Critical·当前 | `targets.json:2/17` | ✅ 已 `chmod 600`；**用户需轮换该 bot token**（曾本地明文）。部署脚本确保 600 + trader-exec |
| S2 | 目标态"空/畸形 200 响应"→ 误判目标清仓 → **全仓平仓** | High·Part B | `api/index.mjs:49/161`→`main.mjs:166-183` | **阻断**：区分"确认空仓"与"读取失败"；空 P[] 且上轮有仓 → 要求连续 N 轮确认 + 校验 `json.data`/schema 完整性才允许平仓，否则视为失败跳过 |
| S3 | 无急停 / flatten（blueprint 自列前置，零实现） | High·Part B | `service/HYPE-copy/*` 无命中 | **阻断**：实现"平掉所有仓(reduceOnly)+停"的 flatten 命令（SIGTERM 只停不平，不够） |
| S4 | 价格投毒放大 size，maxpos 用同一投毒价无法约束；卖/开空方向 IOC 无保护 | High·Part B | `sizing.mjs:31`/`risk.mjs:32-33` | **阻断**：价格相对上轮 mid 偏离 > X% 则 skip 该 coin（与 §4.4 MAX_CHASE_BPS 一并）；用 `maxCoinCapital` 对 size 做**绝对硬顶**（非只看名义） |
| S5 | 依赖未 pin（package-lock gitignore，VPS 临时 npm install）+ dry-run 以 root 跑 = 供应链→root+agent key | High·Part B | `.gitignore`/`app/index.mjs:166` | **阻断**：提交 lockfile / `npm ci` 完整性校验；启用 `User=trader-exec`；agent key 仅 trader-exec 可读 |
| S6 | 风控字段错配：`maxCoinCapital/minOpenCapital` 被忽略，实际走默认 `maxDeployPct/maxPositionPct` | High·当前 | `main.mjs:88/98/129-137` | Part A 接线即修；**接线完成前 loadTargets 对"填 budget 字段却走旧模型"拒启动** |
| S7 | agent key 经 `process.env.AGENT_KEY` 备选（进 /proc/environ）；approve-agent 主私钥内联进 shell history | High/Med·Part B | `09§4.3`/`09§5.2` | **阻断**：agent key 只走 `$CREDENTIALS_DIRECTORY/agent-key`（删 env 备选）；approve-agent 主私钥改 `read -rs`/一次性文件，禁内联 |
| S8 | 无跨进程单实例锁 → 手动+systemd 双跑 = 双下单/nonce 冲突 | Med·Part B | `copy-signal` 仅进程内 | 启动 `flock <runtime>/HYPE-copy-<id>.lock`，已锁拒启动 |
| S9 | `lastWouldHold=desired` 假设全额成交，IOC 部分成交静默欠跟 | Med·Part B | `main.mjs:204` | current 必须来自真实 `clearinghouseState.assetPositions`（当前态），不用"假设成交的 desired"（与 §3.4/§4.1 一致） |
| S10 | SDK 是否经 WARP 未验证 + 失败静默直连；TG 错误日志可能带 token URL | Med | `WARP/index.mjs:14-16`/`notify/index.mjs:91-98` | 抓包验证 SDK 经代理；代理强制失败即 exit；TG 错误日志脱敏 token |
| S11 | `ntli` 用裸 `Number`（破 Decimal 纪律）+ 符号错则反向补保证金 | Med·Part B | `api/index.mjs:269` | planDefend 落地时断言 amountUsd>0 + side 显式；ntli 用 Decimal 转换；加单笔 margin 变动上限 |
| S12 | 对账连续失败被吞 → 目标平仓期间漏跟 → 敞口滞留（无告警升级） | Med·Part B | `main.mjs:257-258` | 连续 N 轮失败 → TG 告警 + 进"只减不加"保护态 |
| S13 | 下单后 recordAction 失败无 try/catch → 真实成交无 JSONL → 状态失步 | Med·Part B | `main.mjs:194-199` | write-ahead（先记 intent 再下单）；log 目录进 ReadWritePaths；记录失败不静默 |
| S14 | systemd 加固缺 ProtectHome/ReadWritePaths/SystemCallFilter | Med·Part B | `app/index.mjs:171` | 迁 /opt/tracker + ProtectHome=read-only + 显式 ReadWritePaths(log/copy-signal) + 系统调用过滤 |

**Part B 启动 gate**：S2/S3/S4/S5/S6/S7 为**硬阻断**，全部关闭并验证前 `dryRun` 不得翻转 false。

---

## 9. 验收总纲

- [ ] Part A：v3 六场景 dry-run 复现（spec 07 §7）；单测全绿；配置/代码字段一致；无 skip-maxpos/capped 残留。
- [ ] Part B：真实余额准确；agent wallet 授权成功且只能交易；真实 fill/杠杆/逐仓保证金正确；updateLeverage 失败不阻断；fee 回填与 userFills 一致；MAX_CHASE_BPS 生效；急停可用。
- [ ] dryRun→false 为最后一步，主网小额观察通过后翻转。
