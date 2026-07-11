# Spec: HYPE observing 观察态中间层

> discovery → watch 之间新增自动化「观察 → 结算 → 推荐」中间层。**仅 HYPE 首期**；sodex 复制与 `lifecycle.md` 体系文档另开 spec。

---

## 背景与目的

**问题**：HYPE discovery 每周（systemd oneshot timer，周一 10 点无人值守）产出一批过硬门槛的候选地址，但 watch（实时监听）是**稀缺资源**——每地址一条 WS 长连，1G/1核 VPS 实测舒适跑 5-10 地址。把每周新发现的地址直接纳入 watch 会资源爆炸，且单周上榜可能是昙花，不足以证明可跟单价值。

**现状缺口**：现有只有 watch（config.watches[]）和 `watch-candidates.json`（被 discovery `excludeSet` 排除的地址）两态。`watch-candidates.json` 混了「人工判定不监听的归档」语义，且一旦地址进入就被 discovery 永久排除、从未来 log 消失——**无法表达「已知晓但想继续观察」**。因此缺一个「先观察两周确认稳定、再推荐纳入 watch」的中间态。

**目的**：新增 observing 观察态，由 discovery 自动维护。地址连续 2 周过硬门槛才结算推荐升 watch，把稀缺 watch 槽留给经过持续性验证的地址。全程 discovery 自动跑，人工只在收到 TG 🟢 推荐后手动决定是否搬入 watch。

---

## 选定方案

**方案**：三态三文件 + discovery 第 ⑥ 阶段自动维护 observing，无独立命令。

三态（HYPE，各对应一个文件）：

| 态 | 文件 | 进 discovery excludeSet | 写者 | 语义 |
| --- | --- | --- | --- | --- |
| watch | `HYPE-watch/config.json` → `watches[]` | 是 | 人工 | 正在实时监听（稀缺槽 5-10） |
| parked | `HYPE-watch/watch-candidates.json` → 重命名 **`watch-parked.json`** | 是 | 人工 | 人工判定不监听的归档，可人工捞回；**park 永远人工** |
| observing | 新建 **`HYPE-watch/watch-observing.json`** | **否**（继续被采集） | **discovery ⑥ 自动** | 观察暂存，连续 2 周达标即结算推荐 |

**为什么无独立 slash 命令**：discovery 无人值守每周自动跑，人工命令会与自动数据更新失步。核心逻辑折进 discovery ⑥ 阶段，与数据同频。observing→watch / observing→parked 的升级助手命令列二期可选，不在本期。

**为什么 ⑥ 用内存 `scored` 而非读 log 文件**：log 的 `recommended[]` 是 topK 截断后的（`output.mjs:146`），读它会漏掉排名 11+ 的合格地址。⑥ 同进程直接用带分的**全量 `scored`**（④打分后、topK 截断前，未截断且含 `score` 字段）无盲点。注意：`profile` 本身无 `score`（`score` 在 `score.mjs` 才算出），故 ⑥ 必须吃 `scored` 不能吃 `profiles`——为此 `score.mjs` 需额外返回全量 `scored`（见集成点）。时序上仍是「⑤ 文件写完之后」，数据走内存。

**放置**：新增 `service/HYPE-discovery/process/observing.mjs`（与 collect/filter/evaluate/score/output 同级的第 6 个管线阶段，扁平文件，不新增目录）。

---

## 设计概要

### 架构：discovery 管线加 ⑥ 阶段

```
① collect → ② filter → ③ evaluate → ④ score → ⑤ output(写 log+推 TG+附件)
                                                    ↓ 同进程、⑤ 之后
                                         ⑥ observing(读 profiles+eliminated → 更新 observing 文件 → 独立推 TG)
```

`main.mjs` 在 `output()` 返回后调 `observing(scored, evalEliminated, ctx)`；`scored` = ④打分后的**全量带分列表**（pre-topK，含 `score`），`evalEliminated` = ③淘汰的逐址记录（含精确原因）。⑥ **只写 `watch-observing.json` 一个文件**；watch / parked 全人工。excludeSet 逻辑不变（仍 `watches ∪ parked`，observing 文件 discovery 从不加载 = 天然不排除）。⑥ 内部异常用 try/catch 包裹，不得中断已完成的 ①-⑤。

### 关键数据结构：`watch-observing.json`

```jsonc
{
  "0xabc...def": {          // 地址小写归一
    "since": "2026-W28",    // 进 observing 的 ISO 周
    "weeksSeen": ["2026-W28", "2026-W29"],  // 每次达标追加当周 ISO 周（去重）
    "recommended": false,   // 是否已推过 🟢（防重复推）
    "lastScore": 61,        // 最近一次达标时的评分（供 🔴 移出卡片显示「上周评分」）
    "reason": ""            // 备用（人工备注）
  }
}
```

**读写不能复用 `watchCandidates.mjs` 的 `loadCandidates/saveCandidates`**：那两个函数 schema 写死为 `{date, reason}`（`saveCandidates` 只序列化这两字段、会丢弃 `since/weeksSeen/recommended/lastScore`；`loadCandidates` 又因条目无 `date` 被 `:17` 全量丢弃）。故 `observing.mjs` **自带通用 JSON 读写**（`readFileSync`+`JSON.parse` / `writeFileSync`+`JSON.stringify`，读失败容错返回 `{}`）。parked 侧仍复用 `watchCandidates.mjs`（其条目是 `{date,reason}` 兼容）。

### 核心逻辑（⑥ observing 阶段）

按 address 小写归一。设本周 `scored` 为过硬门槛+带分集合，`watchSet` = config.watches 地址，`parkedSet` = watch-parked 地址（后者复用 `candidateAddresses(loadCandidates(parkedPath))` 读取）。

```
对本周 scored 里 ∉watchSet ∉parkedSet 的地址 A：
  A ∈ observing:
    weeksSeen 追加本周 ISO 周(已存在则不重复 → 防同周多跑虚增)
    lastScore = A.score  (每周达标刷新，供未来 🔴 显示)
    若 weeksSeen.length ≥ 2 且 recommended == false:
      → 🟢 结算：加入 TG 推荐名单，置 recommended = true
  A ∉ observing:
    → 新入 { since: 本周, weeksSeen: [本周], recommended: false, lastScore: A.score }
    → 🟡 观察第 1 周

对 observing 里本周 scored 未出现的地址 B：
  → 若 B 已进排除集(人工已移入 watch/parked) → 静默从 observing 删除，不报 🔴（是升级/归档非掉出）
  → 否则断 streak：从 observing 删除，加入 🔴 移出名单（绝不自动 park）
  → 移出卡片显示 B.lastScore（存量字段）+ 原因
  → 移出原因：查本周 evalEliminated 中 B 的 reason（精确，格式以真实为准，如「盈亏比不足 1.20 < 1.50」）；
     查不到(掉出榜单或 collect/filter 阶段出局，那两阶段仅返计数) → 兜底「掉出榜单（pnl/量下滑）」
```

`weeksSeen` 因「断即删」只在连续达标周累积，故 `length ≥ 2` 天然等价「连续两周」（per-address 满 2 周即结算）。

### 「近期精彩操作」数据来源（需改 evaluate）

`aggregateTrades`（evaluate.mjs:38-56）现产出的 trade 对象 `{pnl, notional, fills, openMs, closeMs}` **不含币种**，且 `deriveTradeMetrics` 不返回 trades 数组。为支持 🟢 卡片展示 ≤2 笔近期精彩：

- `aggregateTrades`：trade 对象增加 `coin` 字段（`open[coin] = { coin, pnl:0, ... }`）
- `deriveTradeMetrics`：返回值追加 `trades` 数组
- ⑥ 对 🟢 地址取「盈利交易(pnl>0)中按 pnl 降序前 2 笔」，展示 `币种 +pnl（closeMs 相对今天几天前）`

向后兼容（纯追加字段），不影响 score/门槛。**注意日志膨胀**：`trades` 追加进 profile 后会随 `scored/ranked` 被 `output.mjs:146` 全量写进 discovery json（每地址数十上百笔）。故 `output.mjs` 序列化 json 前须剔除 `trades` 字段（`serializeProfile` 或 map 时 `omit trades`），仅内存传给 ⑥ 用。

### TG 通知（B 分段卡片版，顺序 🟢→🔴→🟡）

作为 discovery 主消息+附件之后的**独立后续消息**，复用 `output.mjs` 导出的 `sendTelegram`，⑥ 自建 `buildObservingTgMessage`。风格对齐现有：`🔬` 头 + `⌚` 北京日期 + `·` 分隔 + `📡` 地址锚点 + 短地址 `0xabc…def` + plain text。

```
🔬 HYPE 观察态 · 2026-07-13

🟢 结算·升 watch（连续 2 周达标）
  #1 📡 0xabc…def 评分72 · 盈亏比3.5 · 胜率79% · 净额$12k · 观察2周
     近期精彩：BTC +$4.2k（3天前）· ETH +$2.8k（6天前）

🔴 本周移出（断 streak）
  📡 0xmno…012 上周评分58 · 盈亏比跌破门槛 1.2<1.5
  …另有 2 个移出

🟡 观察中（第 1 周，下周结算）
  📡 0xghi…789 评分61
  …另有 3 个观察中
```

**数量限制**：🟢 全展（行动项、满 2 周者稀少，漏一个=漏一个升级机会）；🔴 / 🟡 各 ≤5，超出 `…另有 N 个`。**三段全空 → 静默不推**（discovery 主消息已证脚本存活，避免噪音）。`noPush` 下 ⑥ 不发 TG 但仍落盘。`dryRun` 下 ⑥ 不写文件、不发 TG，改为把 observing 消息文本 `console.log` 打印到 stdout（对齐 `output.mjs` dry-run 打印 md 的行为），供实测核对通知内容。

### 日志落盘 + log 目录重构

`log/` 目录从平铺改为**按阶段分子目录**：

```
service/HYPE-discovery/log/
  discovery/   ← ⑤ output 产物迁入（原平铺的 discovery-*.{json,md} 移到这里）
  observing/   ← ⑥ 新产物：每次结算的 observing 快照 + 决策
```

- **⑤ output**：`output.mjs` 写盘路径从 `logDir/` 改为 `logDir/discovery/`（`mkdirSync` 该子目录）。
- **⑥ observing**：每次运行落盘 `logDir/observing/observing-<stamp>.{json,md}`（对齐 discovery 双文件风格）：
  - `.json`（机读）：本次完整 observing 状态快照 + 本轮 🟢结算/🔴移出/🟡观察中 决策明细，供回溯
  - `.md`（人读）：即 TG 「观察态」消息的完整版
- **迁移**：现有 `log/discovery-*.{json,md}` 移入 `log/discovery/`（gitignore 目录，`mv`）。
- `dryRun` 下 ⑥ 不落盘（对齐 output dry-run）。

---

## 运营流程对照（改动前后）

**discovery 管线**：5 阶段 → 6 阶段（①-⑤ 不变，⑥ observing 纯追加收尾）。

**数据文件**：2 态 → 3 态。

| | 改前 | 改后 |
| --- | --- | --- |
| 归档 | `watch-candidates.json` | `watch-parked.json`（重命名，纯归档） |
| 观察 | — | `watch-observing.json`（新，⑥ 自动写） |
| 监听 | `config.watches[]` | 不变 |
| 排除集 | watches ∪ candidates | watches ∪ **parked**（observing 不排除，继续被采集） |

**每周自动新增**：过门槛新地址自动进 observing；已在者自动累积周数、掉出自动移出；满连续 2 周自动 🟢 结算推荐；多推一条「观察态」TG（三段全空则静默）。

**人工介入点变化（核心）**：

| | 改前 | 改后 |
| --- | --- | --- |
| 判断依据 | 单周推荐名单，一次上榜就拍板 | 等 🟢 结算（已连续 2 周验证）再决定 |
| 何时动手 | 每周看推荐、逐个权衡 | 仅在收到 🟢 时把地址搬进 watch config |
| 淘汰归档 | 人工写 candidates | 看 🔴 提示决定是否 park（park 仍人工） |
| 稳定性验证 | 无，靠人眼记忆 | 系统跨周自动验证，昙花地址进不了 🟢 |

**单地址生命周期**：`上榜过门槛 → 自动进 observing(🟡) → {下周仍达标 → 🟢 → 人工升 watch} | {下周掉出 → 🔴 自动移出} | {人工判定不要 → 手动移 parked}`。

**不变**：discovery ①-⑤ 逻辑/门槛/打分/主 TG+附件、excludeSet 并集方式、watch 监听进程、升 watch 与 park 的人工属性、systemd 每周调度。

---

## 边界与约束

**包含：**
- HYPE 侧 observing 观察态：新文件 `watch-observing.json` + discovery ⑥ 阶段 `observing.mjs` + B 版 TG 通知
- `watch-candidates.json` → `watch-parked.json` 重命名（语义收敛为纯 parked）
- evaluate 小改（trade 加 coin + 返回 trades）支持「近期精彩」
- output 导出 `sendTelegram` 供 ⑥ 复用
- `log/` 目录重构为 `log/discovery/` + `log/observing/`，⑥ 落盘 observing 日志
- 实测门禁：真实数据 + 三态测试文件跑 `--dry-run`、TG 消息打印到 stdout 核对，通过才更新文档
- 文档更新：`docs/discovery/hype.md`（设计）+ `docs/update-log.md`（变更记录）

**不包含：**
- sodex 侧同款复制（另开 spec）
- `docs/discovery/lifecycle.md` 体系文档（另开 spec）
- observing→watch / observing→parked 升级助手命令（二期可选）
- 独立 `/w:analysis` slash 命令（核心已折进 discovery，不做）
- 自动 park / 自动写 watch（park 与升 watch 永远人工）

**已知限制：**
- 🔴 移出原因：仅 evaluate 阶段淘汰有逐址精确原因；collect/filter 阶段出局或掉出榜单只能给兜底原因（那两阶段仅返计数不返逐址）
- `watch-observing.json` 需 gitignore（同 config/candidates，含运行时状态、VPS 本地）
- date bug（`watchCandidates.mjs:17` 丢弃无 date 条目）：HYPE 侧 `watch-candidates.json` 条目均有 date，parked 排除正常，本期不受影响，不修（留 sodex 阶段处理）
- ISO 周依赖运行机器时区；同周多跑靠 ISO 周去重兜底

---

## 集成点

| 文件 | 改动 |
| --- | --- |
| `service/HYPE-discovery/process/observing.mjs` | **新增**：⑥ 逻辑 + 自带 observing JSON 读写 + `buildObservingTgMessage` + 落盘 `log/observing/observing-*.{json,md}`，导出 `observing(scored, evalEliminated, ctx)` |
| `service/HYPE-discovery/process/score.mjs` | 额外返回全量 `scored`（pre-topK 带分），供 ⑥ 用（现只返回 `{ranked, truncated}`） |
| `service/HYPE-discovery/process/output.mjs` | 导出 `sendTelegram`（现私有）供 ⑥ 复用；json 序列化剔除 `trades` 字段防膨胀；写盘路径 `logDir/` → `logDir/discovery/` |
| `service/HYPE-discovery/process/evaluate.mjs` | `aggregateTrades` trade 加 `coin`；`deriveTradeMetrics` 返回 `trades` |
| `service/HYPE-discovery/main.mjs` | ⑤ 后调 ⑥（传 `scored`）；接住 score 的 `scored`；`watch-candidates.json` 路径改 `watch-parked.json`（变量 `historyCandidates`→`parkedAddresses`、日志文案） |
| `service/HYPE-discovery/log/` | **目录重构**：现有 `discovery-*.{json,md}` 迁入 `log/discovery/`（`mv`）；新增 `log/observing/` 存 ⑥ 产物 |
| `service/HYPE-watch/watch-candidates.json` | **重命名** `watch-parked.json`（gitignore 非跟踪，用 `mv`） |
| `service/HYPE-watch/watch-observing.json` | **新建** `{}` |
| `.gitignore:14-16` | 更新：parked + observing 两行，注释改语义 |
| `service/tool/watchCandidates.mjs` | **仅 parked 复用不改**（其 `{date,reason}` schema 不适配 observing，observing 自带读写） |
| `docs/discovery/hype.md` | 更新设计文档：新增 ⑥ observing 阶段 + 三态模型 + log 目录结构章节 |
| `docs/update-log.md` | **实现完成的最后一步**：顶部新增一条 `feat(HYPE-discovery)` 记录（背景/改动/影响，含涉及文件） |

**不动**：excludeSet 合并逻辑（仍 `watches ∪ parked`）、evaluate 门槛、collect/filter、score 的打分算法（仅加一个返回字段）。

---

## 验证策略（实测门禁）

代码写完后、更新文档前，**必须用真实 discovery 数据实测 ⑥ 走查三态，通过才算完成**：

1. **构造覆盖三态的测试数据**：预置一份测试 `watch-observing.json`——含一个 `weeksSeen` 已 1 周的地址（本轮达标 → 应 🟢 结算）、一个已在观察但本轮掉出的地址（应 🔴 移出）；真实本周 profiles 里的新地址应进 🟡。
2. **跑 `--dry-run`**：⑥ 把 observing 通知消息文本 **`console.log` 打印到 stdout（= 输出到对话）**，不发 TG、不写文件、不动测试数据。
3. **严格核对打印的消息**：🟢→🔴→🟡 顺序、🟢 含指标行 + ≤2 近期精彩、🔴 含 lastScore + 精确原因、🟡 含评分、数量限制「…另有 N 个」、三段全空静默——逐项对照 spec。
4. **有问题就地修复再复跑**，直到消息与决策完全正确。
5. **测试产物不入库、不更新文档**（测试用的 observing 文件与打印仅用于验证，`docs/discovery/hype.md`、`docs/update-log.md` 的更新在实测通过之后才做）。

> 实测通过是 hype.md / update-log 文档更新与整体验收的**前置门禁**。

---

## 验收标准

- [ ] `service/HYPE-watch/watch-candidates.json` 已重命名为 `watch-parked.json`，`watch-observing.json` 已建（内容 `{}`），`.gitignore` 覆盖两者
- [ ] `HYPE-discovery/main.mjs` 排除集加载指向 `watch-parked.json`，`node --check` 通过，无 `historyCandidates`/`watch-candidates` 残留
- [ ] excludeSet 仍为 `watches ∪ parked`，observing 文件不参与排除（observing 地址下周仍被 collect 采集）
- [ ] `evaluate.mjs` 的 trade 对象含 `coin`，`deriveTradeMetrics` 返回值含 `trades` 数组；既有 profile 字段与门槛行为不变
- [ ] `score.mjs` 额外返回全量 `scored`（pre-topK 带 `score`）；打分算法与 `ranked` 不变
- [ ] `output.mjs` 导出 `sendTelegram`（⑤ 原有推送不变）；写 json 时剔除 `trades`，日志不含逐笔 trades
- [ ] `observing.mjs` 存在且导出 `observing()`；**自带 observing JSON 读写（不经 watchCandidates 的 save/load）**；仅读 scored/evalEliminated/parked，仅写 `watch-observing.json`，不写 watch/parked
- [ ] observing 条目往返读写保留 `since/weeksSeen/recommended/lastScore/reason` 全字段（不被 date-only schema 丢弃）
- [ ] ⑥ 逻辑：新地址入 observing（weeksSeen=[本周], lastScore=本周分）；已在者追加当周并 ISO 周去重、刷新 lastScore；`weeksSeen.length≥2 && !recommended` 触发 🟢 并置 `recommended=true`；本周未出现者从 observing 删除并记 🔴
- [ ] 🔴 卡片显示存量 `lastScore` + 原因（优先取 evalEliminated 精确 reason，缺失时兜底「掉出榜单（pnl/量下滑）」）
- [ ] TG 通知：顺序 🟢→🔴→🟡；🟢 全展含 ≤2 近期精彩；🔴/🟡 各 ≤5 且超出显示「…另有 N 个」；三段全空静默不推
- [ ] log 目录重构：`output.mjs` 写入 `log/discovery/`；现有 `discovery-*.{json,md}` 已迁入 `log/discovery/`
- [ ] ⑥ 每次运行落盘 `log/observing/observing-<stamp>.{json,md}`（json 含状态快照+决策，md 为 TG 完整版）；三段全空时仍可落盘快照（仅不推 TG）
- [ ] ⑥ 异常被 try/catch 捕获，不影响 ①-⑤ 已完成的 log 落盘
- [ ] `dry-run` 下 ⑥ 不写文件、不发 TG，改为 `console.log` 打印 observing 消息到 stdout；`no-push` 下 ⑥ 不发 TG 但仍落盘（均读 `ctx`）
- [ ] **实测门禁**：用真实 discovery 数据 + 预置三态测试 observing 文件跑 `--dry-run`，打印的通知消息经严格核对（顺序/指标/精彩/原因/lastScore/数量限制/静默）全部正确；发现问题已修复复跑通过
- [ ] `docs/discovery/hype.md` 已加 ⑥ observing 阶段 + 三态模型 + log 目录结构说明（**实测通过后才更新**）
- [ ] **最后一步**：`docs/update-log.md` 顶部新增本次 `feat(HYPE-discovery)` 记录（背景/改动/影响 + 涉及文件），格式对齐现有条目（**实测通过后才更新**）

---

## 验收场景

### 场景 1：新地址首次达标 → 进 observing 观察第 1 周
- **Given** 本周（2026-W28）discovery `scored` 含地址 `0xA`（过全部硬门槛，`score`=61），`0xA` 不在 config.watches、不在 watch-parked、不在 watch-observing
- **When** ⑥ observing 阶段执行
- **Then** `watch-observing.json` 新增 `0xA: {since:"2026-W28", weeksSeen:["2026-W28"], recommended:false, lastScore:61}`；TG 🟡 段出现 `0xA 评分61`；🟢 段无 `0xA`

### 场景 2：连续第 2 周达标 → 结算推荐升 watch
- **Given** `watch-observing.json` 已有 `0xA: {since:"2026-W28", weeksSeen:["2026-W28"], recommended:false, lastScore:61}`，本周（2026-W29）`scored` 仍含 `0xA`（score 72、盈亏比 3.5 胜率 79% 净额 $12k），其盈利交易前 2 为 BTC +$4.2k、ETH +$2.8k
- **When** ⑥ 执行
- **Then** `0xA.weeksSeen` 变 `["2026-W28","2026-W29"]`、`lastScore` 刷新为 72、`recommended` 置 `true`；TG 🟢 段出现 `0xA` 卡片含指标行（评分72）+ `近期精彩：BTC +$4.2k … · ETH +$2.8k …`（≤2 笔）；`log/observing/observing-<stamp>.{json,md}` 落盘含本轮决策

### 场景 3：observing 地址本周未达标 → 断 streak 移出并记原因
- **Given** `watch-observing.json` 有 `0xB: {weeksSeen:["2026-W28"], recommended:false, lastScore:58}`，本周 `0xB` 不在 `scored`，但在本周 `evalEliminated` 中 reason=`盈亏比不足 1.20 < 1.50`
- **When** ⑥ 执行
- **Then** `watch-observing.json` 删除 `0xB`；TG 🔴 段出现 `0xB 上周评分58 · 盈亏比不足 1.20 < 1.50`；`0xB` 未被写入 watch-parked（不自动 park）

### 场景 4：同周多次运行 discovery → ISO 周去重不虚增
- **Given** `watch-observing.json` 有 `0xC: {weeksSeen:["2026-W28"], recommended:false, lastScore:60}`（本周 2026-W28 已跑过一次），同一 ISO 周内 discovery 再次运行且 `scored` 仍含 `0xC`
- **When** ⑥ 第二次执行
- **Then** `0xC.weeksSeen` 仍为 `["2026-W28"]`（当周不重复追加），`recommended` 保持 `false`，🟢 段不出现 `0xC`

### 场景 5：本周无任何 observing 变动 → 静默不推
- **Given** 本周 `scored` 中 ∉watch∉parked 的地址集合与 `watch-observing.json` 完全一致且无人满 2 周、无人掉出（无新增、无结算、无移出）
- **When** ⑥ 执行
- **Then** `watch-observing.json` 内容不变（除 weeksSeen 当周去重后无变化）；不推送任何 observing TG 消息；但仍落盘 `log/observing/observing-<stamp>.{json,md}`（快照当前状态，供审计）

### 场景 6：⑥ 内部异常 → 不影响 ①-⑤ 落盘
- **Given** ⑤ output 已成功写出 `discovery-*.json/md` 并推送主消息，⑥ 执行时 `watch-observing.json` 读取抛错（文件损坏）
- **When** ⑥ 捕获异常
- **Then** discovery 进程正常退出（exit 0 语义），已写的 log 文件与主 TG 消息保留，控制台打印 ⑥ 告警，不抛出中断主流程
