# Spec: sodex observing 观察态中间层

> HYPE observing 观察态（见 `.claude/kit/spec/2026-07-11-hype-observing-state.md` + `docs/discovery/hype.md §3.3`）的 sodex 同款复制。**仅 sodex 本次**；`lifecycle.md` 体系文档仍另案。

---

## 背景与目的

**问题**：sodex discovery 每周（systemd oneshot，周一 9 点无人值守）产出一批过硬门槛地址，但 watch（实时监听）是稀缺资源（每地址一条 WS 长连，VPS 舒适 5-10）。单周上榜可能昙花，直接纳入 watch 有资源与质量风险。缺一个「先观察两周确认持续性、再推荐升 watch」的中间态。

**现状**：HYPE 侧已落地 observing 观察态（discovery ⑥ 阶段 + 三态三文件）。sodex 是 HYPE 的姊妹平台，管线同构（collect→filter→evaluate→score→output）但口径不同（accountId + positions 逐笔真账本 vs HYPE address + userFills）。本 spec 把同一套观察态机制复制到 sodex，并处理 sodex 特有差异。

**目的**：sodex discovery 无人值守每周自动维护 observing，连续 2 周达标才 🟢 结算推荐升 watch，人工只在收到 TG 推荐后手动搬入 watch。

---

## 选定方案

**方案**：三态三文件 + discovery 第 ⑥ 阶段自动维护 observing，无独立命令。与 HYPE 完全对齐，差异点按 sodex 口径适配。

三态（sodex，各对应一个文件）：

| 态 | 文件 | 进 discovery excludeSet | 写者 | 语义 |
| --- | --- | --- | --- | --- |
| watch | `sodex-watch/config.json` `watches[]` | 是 | 人工 | 正在实时监听 |
| parked | `sodex-watch/watch-candidates.json` → 重命名 **`watch-parked.json`** | 是 | 人工 | 判定不监听的归档，可人工捞回；**park 永远人工** |
| observing | 新建 **`sodex-watch/watch-observing.json`** | 否（继续被采集） | discovery ⑥ 自动 | 观察暂存，连续 2 周达标即 🟢 推荐升 watch |

**已验证数据支持**（探针实测，非假设）：
- sodex 历史 log `recommended[]` 含 `walletAddress / accountId / score / profitFactor / winRate / netProfit / hitWindows`（observing 输入 + 回放测试齐全）
- positions 带 `symbol_id / realized_pnl / updated_at`（`coinSlice.mjs:41` 生产已用）；`refreshSymbols()` 返 79 币种 `symbol_id→baseCoin` 映射；近期精彩端到端解析成功（实测 `SPCX +$0.2k（26天前）`）

---

## 设计概要

### 架构：discovery 管线加 ⑥ 阶段

`sodex-discovery/main.mjs` 在 ⑤ `output()` 后调 `observing(scored, evalElim, {...ctx, excludeSet})`。⑥ **只写 `watch-observing.json`**；watch / parked 全人工。excludeSet 逻辑不变（仍 `watches ∪ parked`，observing 不加载 = 不排除）。⑥ 内部异常 try/catch 包裹，不中断 ①-⑤。每周 9 点 systemd 自动跑。

### 关键数据结构：`watch-observing.json`

按 **walletAddress 小写**归一，schema **比 HYPE 多一个 `accountId`**：

```jsonc
{
  "0xwallet...": {
    "since": "2026-W28",
    "weeksSeen": ["2026-W28", "2026-W29"],
    "recommended": false,
    "lastScore": 71.9,
    "accountId": "13462",   // sodex 特有：🔴 移出时按 accountId 反查 evalElim 精确原因
    "reason": ""
  }
}
```

`accountId` 必要性：sodex `evalElim` 记录按 **accountId** keyed（`evaluate.mjs:51,85` push `{accountId,stage,reason}`），而 observing 按 walletAddress 归一；🔴 移出时用存量 `entry.accountId` 反查精确原因，查不到 → 兜底「掉出榜单」。

observing 自带 JSON 读写（`readFileSync`+`JSON.parse` / `writeFileSync`+`JSON.stringify`，读失败容错 `{}`），**不复用 `watchCandidates.mjs` 的 `loadCandidates/saveCandidates`**（其 `{date,reason}` schema 会丢弃 observing 富字段）。parked 侧仍复用 `watchCandidates.mjs`（`{date,reason}` 兼容）。

### 核心逻辑（⑥ observing 阶段，与 HYPE 同）

按 walletAddress 小写归一。本周 `scored`（∉watch ∉parked，excludeSet 过滤）：

```
对本周 scored 里 ∉excludeSet 的地址 A（key=walletAddress 小写）：
  A ∈ observing:
    weeksSeen 追加本周 ISO 周(去重)；lastScore=A.score；若 entry.accountId 缺失则补 A.accountId
    若 weeksSeen.length ≥ 2 且 !recommended → 🟢 结算：加入推荐名单，置 recommended=true
  A ∉ observing:
    新入 {since:本周, weeksSeen:[本周], recommended:false, lastScore:A.score, accountId:A.accountId} → 🟡 观察第 1 周

对 observing 里本周 scored 未出现的地址 B：
  若 B ∈ excludeSet(人工已移入 watch/parked) → 静默从 observing 删除，不报 🔴（升级/归档非掉出）
  否则断 streak：删除 + 加入 🔴 移出名单（绝不自动 park）
    原因：用 B.accountId 查本周 evalElim 的 reason；查不到 → 兜底「掉出榜单（pnl/量下滑）」
```

`weeksSeen` 因「断即删」只在连续达标周累积，`length ≥ 2` 天然等价连续 2 周。常量 `PROMOTE_WEEKS=2 / MAX_LIST=5 / HIGHLIGHT_MAX=2`（同 HYPE）。

### 「近期精彩」（sodex 特有链路）

- `evaluate.mjs` 已 `fetchPositions(s.accountId)` 在作用域（:40），**直接从 positions 抽 top-2 盈利平仓**（`{symbol_id, realized_pnl, updated_at}`）挂 `profile.topTrades`——**metrics.mjs 零改**。
- ⑥ 仅当有 🟢 promoted 时调 `refreshSymbols()`（一次网络，返 `Map<symbol_id, baseCoin>`），把 topTrades 的 `symbol_id` 解析成币名（如 2→ETH），展示 `币种 +pnl（updated_at 相对今天几天前）`。
- `refreshSymbols` 失败返空 Map → 币名回退 `#<symbol_id>`，不阻断（⑥ try/catch 兜底）。
- `topTrades` 从 discovery json 剔除（同 HYPE，防膨胀）。

### TG 通知（B 分段卡片版，顺序 🟢→🔴→🟡）

discovery 主消息+附件之后的独立后续消息，复用 `output.mjs` 导出的 `sendTelegram`，⑥ 自建 `buildObservingTgMessage`。**格式对齐 sodex output 现有风格**（头部/分隔/formatter 用 sodex 风格，非照搬 HYPE 的 🔬/compactUsd）：

```
🔬 sodex 观察态 · 2026-07-13

🟢 结算·升 watch（连续 2 周达标）
  #1 📡 0xabc…def 评分71.9 · 盈亏比2.86 · 胜率78% · 净额$1.1k · 观察2周
     近期精彩：ETH +$4.2k（3天前）· BTC +$2.8k（6天前）

🔴 本周移出（断 streak）
  📡 0xmno…012 上周评分58 · 盈亏比不足 1.20 < 1.50
  …另有 2 个移出

🟡 观察中（第 1 周，下周结算）
  📡 0xghi…789 评分61
  …另有 3 个观察中
```

**数量限制**：🟢 全展；🔴/🟡 各 ≤5 超出 `…另有 N 个`；三段全空静默不推。`dryRun` 下 ⑥ 不写文件、不发 TG、改 `console.log` 打印消息到 stdout；`noPush` 不发 TG 但落盘。

### 日志落盘 + log 目录重构

`sodex-discovery/log/` 从平铺改为 `log/discovery/`（⑤ 产物迁入）+ `log/observing/`（⑥ 产物 `observing-<stamp>.{json,md}`）。`output.mjs` 写盘路径 `logDir/` → `logDir/discovery/`；现有 3 个 `discovery-*.{json,md}` 迁入 `log/discovery/`（`mv`）。dryRun 下 ⑥ 不落盘。

### score 返回形状适配

sodex `score.mjs` 现返回 `Array`（`scored.slice(0, topK)`，:45）。改为返回 `{ranked, scored}`（scored=全量带分 pre-topK），`main.mjs:167` 解构改 `const { ranked, scored } = score(...)`。**唯一调用方是 main:167**（无 test 引用），零其它影响。

### date bug 修复

`service/tool/watchCandidates.mjs:17` `if (entry.date)` 丢弃无 date 条目 → 改为无条件 `map.set`（date 可选）。sodex `watch-candidates.json` 两条人工记录缺 date（当前根本没进 excludeSet），修后生效。**对 HYPE 无影响**（HYPE 条目均有 date）。

### 数据迁移（一次性）

`watch-candidates.json` → `watch-parked.json`：
- 「无需关注」`0x584743…7027`（parked 语义）→ 留 `watch-parked.json`
- 「待观察」`0xcca23…37be`（observing 语义）→ 迁入 `watch-observing.json` 种子：`{since:"2026-W28", weeksSeen:["2026-W28"], recommended:false, lastScore:null, accountId:null, reason:"待观察(迁移)"}`；accountId 待首轮采集时 ⑥ 补齐

> ⚠️ **seed head-start 语义（刻意，须知晓）**：种子预置了 W28 一周，等于「白送一周」——该地址只要**下一轮（W29）真实达标一次**就立即 🟢 自动推荐升 watch，尽管它从未被算法在 W28 验证过（这是人工「待观察」判断的延续）。若不想给 head-start，可把 seed 的 `weeksSeen` 置空 `[]`，则需 W29+W30 两周真实达标才结算。**默认给 head-start**（尊重人工既有判断）。

---

## 边界与约束

**包含：**
- sodex 侧 observing 观察态：新 `watch-observing.json` + discovery ⑥ `observing.mjs` + B 版 TG
- `watch-candidates.json` → `watch-parked.json` 重命名 + 「待观察」迁 observing 种子
- evaluate 抽 topTrades（不改 metrics.mjs）+ ⑥ 用 refreshSymbols 解析币名
- score 返回 `{ranked, scored}`；output 导出 sendTelegram + 剔 topTrades + 写 log/discovery/
- date bug 修复（`watchCandidates.mjs`，惠及两平台）
- `.gitignore` sodex 行更新；`log/` 分 discovery/observing
- 文档：`docs/discovery/sodex.md` + `docs/update-log.md`

**不包含：**
- HYPE 侧（已完成，不动）
- `docs/discovery/lifecycle.md` 体系文档（另案）
- observing→watch / observing→parked 升级助手命令（二期可选）
- 自动 park / 自动写 watch（park 与升 watch 永远人工）

**已知限制：**
- 🔴 精确原因仅当 evalElim 有该 accountId 记录（evaluate 阶段淘汰）；掉出榜单/前阶段出局或 seed 无 accountId → 兜底原因
- ⑥ 含一次网络调用（refreshSymbols，仅有 🟢 时）——失败降级 `#<id>`，非纯离线（HYPE ⑥ 纯离线）
- 待观察 seed 初始 `lastScore:null / accountId:null`，首轮采集后补齐；seed 有「白送一周」head-start（见数据迁移）
- 🟢 推荐**只播一次**（`recommended=true` 后续命分支 `!recommended` 短路，不再进任何 TG 段）——人工漏看当周 TG 则不复播（继承自 HYPE，非 sodex 新增）
- ISO 周依赖运行机器时区；同周多跑靠 ISO 周去重

---

## 集成点

| 文件 | 改动 |
| --- | --- |
| `service/sodex-discovery/process/observing.mjs` | **新增**：⑥ 逻辑 + 自带 observing JSON 读写 + `buildObservingTgMessage`（sodex 风格）+ refreshSymbols 解析币名 + 落盘，导出 `observing(scored, evalElim, ctx)` |
| `service/sodex-discovery/process/score.mjs` | 返回 `Array` → `{ranked, scored}` |
| `service/sodex-discovery/process/output.mjs` | 导出 `sendTelegram`（现私有 :53）；**在 `serializeProfile`（:177 `{...p}` 会带出 topTrades）里 `const {topTrades, ...rest}` 剔除**（字段名 `topTrades`，≠HYPE 的 `trades`，勿照抄）；写盘 `logDir/` → `logDir/discovery/` |
| `service/sodex-discovery/process/evaluate.mjs` | 从 positions 抽 top-2 盈利平仓挂 `profile.topTrades`（symbol_id/realized_pnl/updated_at） |
| `service/sodex-discovery/main.mjs` | ⑤ 后调 ⑥（传 `scored, evalElim, {...ctx, excludeSet}`）；接住 score 的 `scored`（:167）；候选路径 `watch-candidates.json`→`watch-parked.json` |
| `service/sodex-discovery/log/` | **目录重构**：现有 `discovery-*.{json,md}` 迁入 `log/discovery/`；新增 `log/observing/` |
| `service/sodex-watch/watch-candidates.json` | **重命名** `watch-parked.json`（gitignore 非跟踪，`mv`）+ 迁「待观察」出去 |
| `service/sodex-watch/watch-observing.json` | **新建**（含待观察种子） |
| `.gitignore` | `:15` sodex 行 `watch-candidates.json` → `watch-parked.json` + 新增 `watch-observing.json` |
| `service/tool/watchCandidates.mjs` | 修 date bug（`:17` date 可选）；parked 侧仍复用其 load/save |
| `docs/discovery/sodex.md` | 更新：⑥ observing 阶段 + 三态模型 + log 目录结构章节 |
| `docs/update-log.md` | **最后一步**：顶部新增 `feat(sodex-discovery)` 记录 |

**不动**：excludeSet 合并逻辑（仍 `watches ∪ parked`）、evaluate 门槛、collect/filter、score 打分算法（仅改返回形状）、metrics.mjs、HYPE 侧全部。

---

## 验证策略（实测门禁）

代码写完后、更新文档前，**必须实测通过才算完成**：

1. **确定性三态测试**：构造覆盖三态的测试 `watch-observing.json`（1 周待结算 / 已在待掉出）+ 合成 scored（含 accountId），直接驱动 `observing()` 覆盖场景 1-6，`--dry-run` 把消息 `console.log` 到对话严格核对（顺序/指标/近期精彩/lastScore/精确原因/数量限制/静默/excl静默清出/异常隔离）。
2. **真实日志回放 + 收集数据**：按 ISO 周去重取每周最新，链式喂 sodex 最近 3 周日志给 `observing()`，**打印每周观察态消息 + 最终 watch-observing.json 状态 + 结算出的真实 🟢 候选到对话**（收集真实数据，如 HYPE 回放产出 3 个跨周持续候选）。字段已验证齐全。
3. **近期精彩链路**：实测 `fetchPositions + refreshSymbols` 解析币名（已探针验证成立）。
4. **date bug 回归护栏**：跑 `node --test service/tool/watchCandidates.test.mjs` 确认修改 `:17` 后既有测试仍全绿（fixture 均带 date，无用例断言无-date 丢弃，应通过）。
5. **有问题就地修复复跑，通过才继续**；测试产物不入库、不更新文档；实测通过是文档更新前置门禁。

---

## 验收标准

- [ ] `sodex-watch/watch-candidates.json` 重命名 `watch-parked.json`（「无需关注」留），`watch-observing.json` 建（含「待观察」种子），`.gitignore:15` 更新为 parked+observing
- [ ] `watchCandidates.mjs:17` date bug 修复；sodex 两条 parked 记录真正进 excludeSet；HYPE 行为不变；`node --test service/tool/watchCandidates.test.mjs` 回归全绿
- [ ] `main.mjs` 候选路径指向 `watch-parked.json`，`node --check` 通过，无 `watch-candidates`/`historyCandidates` 残留
- [ ] excludeSet 仍 `watches ∪ parked`，observing 不参与排除
- [ ] `score.mjs` 返回 `{ranked, scored}`（scored 带 score，pre-topK）；main:167 解构更新；打分算法不变
- [ ] `evaluate.mjs` profile 含 `topTrades`（top-2 盈利平仓，symbol_id/realized_pnl/updated_at）；既有字段与门槛不变
- [ ] `output.mjs` 导出 `sendTelegram`；json 剔 `topTrades`；写盘 `log/discovery/`；现有 log 迁入
- [ ] `observing.mjs` 存在导出 `observing()`；自带 JSON 读写；仅写 `watch-observing.json`，不写 watch/parked
- [ ] observing 条目往返保留 `since/weeksSeen/recommended/lastScore/accountId/reason` 全字段
- [ ] ⑥ 逻辑：新入 🟡（weeksSeen=[本周], lastScore, accountId）；续命追加当周+去重+刷 lastScore+补 accountId；满 2 周触发 🟢 置 recommended；断 streak 移出记 🔴（excl 者静默清出不报 🔴）；🔴 原因按 accountId 反查 evalElim 或兜底
- [ ] 近期精彩：⑥ 有 🟢 时 refreshSymbols 解析 symbol_id→币名；失败回退 `#<id>`
- [ ] TG 顺序 🟢→🔴→🟡；🟢 含 ≤2 近期精彩；🔴/🟡 各 ≤5 超出「…另有 N 个」；三段全空静默；格式对齐 sodex 风格
- [ ] `dry-run` 下 ⑥ 不写不发、console.log 打印；`no-push` 不发但落盘
- [ ] ⑥ 异常 try/catch 不中断 ①-⑤
- [ ] **实测门禁**：确定性三态测试 + 真实日志回放 + 近期精彩链路全部实测通过
- [ ] `docs/discovery/sodex.md` 已加 ⑥ + 三态 + log 结构（实测通过后）
- [ ] **最后一步**：`docs/update-log.md` 顶部新增 `feat(sodex-discovery)` 记录（实测通过后）

---

## 验收场景

### 场景 1：新地址首次达标 → 进 observing 观察第 1 周
- **Given** 本周（2026-W28）sodex `scored` 含 `walletAddress=0xA / accountId=13462`（过硬门槛，score=61），`0xA` 不在 watch/parked/observing
- **When** ⑥ 执行
- **Then** `watch-observing.json` 新增 `0xa…: {since:"2026-W28", weeksSeen:["2026-W28"], recommended:false, lastScore:61, accountId:"13462"}`；TG 🟡 段出现 `0xA 评分61`；🟢 段无 `0xA`

### 场景 2：连续第 2 周达标 → 结算推荐 + 近期精彩解析
- **Given** `watch-observing.json` 有 `0xA: {weeksSeen:["2026-W28"], recommended:false, lastScore:61, accountId:"13462"}`，本周（2026-W29）scored 仍含 `0xA`（score72/PF2.86/胜率78%/净额$1.1k），其 positions top-2 盈利平仓为 symbol_id 2(ETH)+$4.2k、3(BTC)+$2.8k
- **When** ⑥ 执行（有 🟢 → 调 refreshSymbols）
- **Then** `0xA.weeksSeen=["2026-W28","2026-W29"]`、`recommended=true`、`lastScore=72`；TG 🟢 卡片含指标行 + `近期精彩：ETH +$4.2k… · BTC +$2.8k…`（symbol_id 解析成币名）

### 场景 3：observing 地址断 streak 移出 → accountId 反查精确原因
- **Given** `watch-observing.json` 有 `0xB: {weeksSeen:["2026-W28"], lastScore:58, accountId:"999"}`，本周 `0xB` 不在 scored 且 ∉excludeSet，但本周 `evalElim` 含 `{accountId:"999", reason:"盈亏比不足 1.20 < 1.50"}`
- **When** ⑥ 执行
- **Then** `watch-observing.json` 删除 `0xB`；TG 🔴 段 `0xB 上周评分58 · 盈亏比不足 1.20 < 1.50`；未写入 watch-parked

### 场景 4：promoted 地址被人工升 watch → 次周静默清出不报 🔴
- **Given** `watch-observing.json` 有 `0xC: {weeksSeen:["2026-W28","2026-W29"], recommended:true, lastScore:80, accountId:"111"}`，人工已把 `0xC` 加入 `config.watches[]`（本周进 excludeSet），本周 scored 不含 `0xC`
- **When** ⑥ 执行
- **Then** `watch-observing.json` 删除 `0xC`；TG 🔴 段**不出现** `0xC`（静默清出，非掉出）

### 场景 5：同 ISO 周多跑 → weeksSeen 去重不虚增
- **Given** `watch-observing.json` 有 `0xD: {weeksSeen:["2026-W28"], recommended:false, accountId:"222"}`，同一 2026-W28 内 discovery 二次运行且 scored 仍含 `0xD`
- **When** ⑥ 第二次执行（非 dry-run）
- **Then** `0xD.weeksSeen` 仍 `["2026-W28"]`（不重复追加），`recommended` 保持 false

### 场景 6：⑥ 内部异常 → 不中断 ①-⑤
- **Given** ⑤ 已写出 `log/discovery/discovery-*.{json,md}` 并推主消息，⑥ 执行时 `watch-observing.json` 读取抛错（文件损坏）
- **When** ⑥ 捕获异常
- **Then** discovery 进程正常退出，已写 log 与主 TG 保留，控制台打印 ⑥ 告警，不抛出中断主流程
