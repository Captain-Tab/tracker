# Spec: HYPE 影子跟踪 + 预测台账（闭环反馈阶段 1）

> 闭环反馈体系（见 `docs/discovery/feedback-loop.md`）的**阶段 1**：HYPE 侧 shadow 影子跟踪 + 预测台账 + 对照组。**纯采集，不含 calibrate**（回看校准是阶段 2 另开 spec）。**仅 HYPE**；sodex 同款另案。

---

## 背景与目的

**问题**：现在 HYPE discovery + observing 是**开环**——每周独立预测候选，却**从不复盘自己上一批预测准不准**。`log/discovery/` 记录了「预测」（recommended + 全指标），但**没有一条「结果」**：系统从没回答过「上周推荐的人，后来真的赚了吗？」。

**根因**：缺的不是数据量，是**给预测贴事后结果标签，并回读**。门槛/权重（`PRESETS` 权重数字）全靠拍脑袋，改了也不知对不对。

**目的（阶段 1）**：加一个**旁路数据层**，让系统从下周起**记账**——每周把预测写入台账，并持续拉这些地址的真实盈亏回填结果。攒够带标签数据后（阶段 2）才能校准。不改现有 discovery 逻辑（observing 仅加返回值 `promotedAddresses`，行为不变）。

---

## 选定方案

**方案**：discovery 加 ⑦ shadow 阶段（复用每周跑）+ 预测台账 `ledger.json` + 规则采样对照组。

- **影子跟踪**：不真跟单，每周持续拉「曾被推荐地址」的 userFills，算它推荐**之后**的真实盈亏
- **预测台账**：一行 = 一次预测（predict 侧）+ 它的事后结果（outcome 侧，逐周回填），带标签数据集
- **对照组**：每周采「过门槛但排名 topK 外」的 N 个（`scored` 里 topK+1..topK+N），破除幸存者偏差

**为什么 ⑦ 折进 discovery**：shadow 要跟 discovery 同频（每周记账），discovery 已无人值守每周跑，折成 ⑦ 最省（无需另设 cron）。calibrate 需等样本成熟、月度离线，是**阶段 2 独立 CLI**，不在本 spec。

**对照组口径（阶段 1 的可行取舍）**：用「过门槛但未入选 topK」（`scored` 已暴露、有完整指标、零改 evaluate），测「topK 那条线/打分准不准」的边界。gate-failed 的「擦边淘汰」需 evaluate 额外吐擦边落选画像，留阶段 2。

**影子跟踪定位（须立住）**：只能**证伪不能证真**——影子测「他账户赚没赚」，测不到「我跟着能赚」（滑点/跟单率看不见）。它可靠**排除坏的**，不能确认好的。

---

## 设计概要

### 架构：discovery 管线加 ⑦ 阶段

`HYPE-discovery/main.mjs` 在 ⑥ observing 后调 `shadow(scored, ranked, promotedAddrs, ctx)`。⑦ **只写 `log/ledger.json`**；try/catch 隔离，异常不中断 ①-⑥。每周随 discovery 自动跑。

`promotedAddrs` = observing 新增返回的「本周🟢地址列表」；shadow 用每个 address 去 `scored` 回查完整 predict 字段（含 recoveryFactor），因 observing 的 promoted 对象缺 recoveryFactor。

```
①-⑤ → ⑥ observing → ⑦ shadow ┬─ (A) 写预测：recommended + observing🟢
                              ├─ (A') 写对照：scored 里 topK+1..topK+N（stage:control）
                              └─ (B) 回填：台账「跟踪中」行重拉 userFills，算推荐后盈亏
```

### 关键数据结构：`log/ledger.json`

按 `week|address` 唯一键，一行一预测（load-modify-save，同 observing 模式）：

```jsonc
{
  "2026-W28|0xabc...": {
    "week": "2026-W28",
    "recommendedAt": 1782230400000,
    "address": "0xabc...",
    "stage": "discovery",                    // discovery | observing | control
    "predict": { "score": 72, "profitFactor": 3.5, "winRate": 0.79, "recoveryFactor": 2.1, "netProfit": 12000 },
    "outcome": {
      "baselinePnl": 12000,                  // 数据完整性哨兵（非计算用）
      "pnlSince": { "2w": 800, "4w": 3200 }, // 推荐后新增真实盈亏（主 2 周 + 尾 4 周）
      "tradesSince": { "2w": 5, "4w": 14 },  // 推荐后交易笔数：区分休眠(0) vs 活跃没赚(有笔但pnl≤0)
      "maxDrawdownSince": { "4w": -1900 },   // 推荐后期间最大回撤：识别回本型陷阱
      "lastPulledAt": 1783440000000,
      "matured": false                       // 满 4 周冻结停跟
    }
  }
}
```

### ⑦ shadow 逻辑

```
ledger = loadLedger(ledgerPath)                       # 自带 JSON I/O，读失败容错 {}
weekId = observing.__internals.isoWeekId(new Date())  # 复用 observing 现成 ISO 周工具，不另造

# (A) 写预测（同 id 去重）
# recommended 腿：直接用 a 的完整字段，stage:discovery
# observing🟢 腿：只有 address，用它回查 scored 补全 predict
predictRows = [...recommended(stage:discovery)]
for addr of promotedAddrs:                            # observing🟢 只给 address（promoted 对象缺 recoveryFactor）
  s = scored.find(x => x.address == addr)             # 从 scored 回查完整 predict 字段（含 recoveryFactor）；地址全程小写，直接匹配
  if s: predictRows.push({ ...pick(s, [score,profitFactor,winRate,recoveryFactor,netProfit]), address:addr, stage:"observing" })
for a of predictRows:
  id = `${weekId}|${a.address.toLowerCase()}`
  if !ledger[id]: ledger[id] = { week, recommendedAt:now, address, stage,
                                 predict:{score,profitFactor,winRate,recoveryFactor,netProfit},
                                 outcome:{ baselinePnl:a.netProfit, pnlSince:{}, tradesSince:{}, maxDrawdownSince:{}, matured:false } }

# (A') 写对照（scored 排 topK 外的前 N 个；N=recommended 数）
# topK 边界不作为参数传入——用 ranked.length（ranked = scored.slice(0, topK)，已传参，天然自洽）
control = scored.slice(ranked.length, ranked.length + N)   # 过门槛但未入选；N = recommended 腿数量
for a of control: 同上写行，stage:control

# (B) 回填「跟踪中」行（推荐 ≤4 周且未成熟）
for row of ledger where (now - recommendedAt) ≤ 4周 且 !matured:
  fills = fetchUserFills(row.address)                 # 复用现成接口
  postFills = fills where time > recommendedAt        # 推荐后的成交（fills cap 只截老历史，postFills 恒最新不丢）
  trades = aggregateTrades(postFills)                 # 复用 evaluate.__internals.aggregateTrades
  weeksElapsed = round((now - recommendedAt)/周)
  bucket = weeksElapsed≥4 ? "4w" : weeksElapsed≥2 ? "2w" : null
  if bucket:
    row.outcome.pnlSince[bucket] = Σ trade.pnl
    row.outcome.tradesSince[bucket] = trades.length
    row.outcome.maxDrawdownSince[bucket] = 按 closeMs 升序累计的峰谷最大回撤
  row.outcome.lastPulledAt = now
  if weeksElapsed ≥ 4: row.outcome.matured = true

saveLedger(ledgerPath, ledger)
log(`⑦ 影子跟踪：记账 X 条 · 回填 Y 条 · 成熟 Z 条`)   # console，journalctl 可见
```

**HYPE 口径**：outcome 盈亏用 `userFills` 聚合成交易（`aggregateTrades` 复用），非 sodex 的 positions。`推荐后盈亏` = 推荐时间后成交的 fills 聚合交易的 Σpnl。

### 时机

- 一条预测 W0 落账 → W2 记 2 周结果（首信号）→ W4 记 4 周结果并冻结停跟
- 系统上线后头 4 周只采集（样本未成熟），calibrate（阶段 2）等 4 周后才有料

---

## 边界与约束

**包含：**
- HYPE 侧 shadow ⑦ 阶段（`shadow.mjs`）+ 预测台账 `ledger.json` + 对照组（scored topK 外采样）
- outcome 三窗口字段：`pnlSince / tradesSince / maxDrawdownSince`（主 2 周 + 尾 4 周）
- ⑦ console 日志；复用 `fetchUserFills` + `aggregateTrades`
- 文档：`docs/discovery/feedback-loop.md`（标阶段1）+ `hype.md` 六→七阶段 + `update-log`

**不包含：**
- **calibrate 回看校准**（阶段 2 另开 spec）
- sodex 侧（另案）
- gate-failed「擦边淘汰」对照（需 evaluate 吐擦边落选画像，阶段 2）
- 自动调参、执行真值（跟单滑点/跟单率，阶段 3）
- **不推 TG、不落 md**（阶段 1 纯采集，无结论可报）

**已知限制：**
- **影子只能证伪不能证真**：账户赚 ≠ 跟得上（滑点/跟单率看不见）→ 定位是排除坏的
- 幸存者偏差**残留**：对照组是「过门槛未入选」，仍未覆盖「门槛外可能会赚的」→ 部分缓解非根治
- 头 4 周无成熟样本（数据规律，非 bug）
- 地址销户/无新成交 → userFills 空 → outcome 记 0 + tradesSince=0（标休眠，不算负样本），不报错
- fills 2000 cap 对 2w 桶不影响；4w 活跃账号（>2000 fill）可能截断早期 post-rec fill 致 pnlSince 少算——已知限制，阶段2 calibrate 对高频账号结果打折
- ISO 周依赖运行机器时区

---

## 集成点

| 文件 | 改动 |
| --- | --- |
| `service/HYPE-discovery/process/shadow.mjs` | **新增**：⑦ 逻辑 + 自带 ledger JSON 读写，导出 `shadow(scored, ranked, promotedAddrs, ctx)` |
| `service/HYPE-discovery/main.mjs` | ⑥ 后调 ⑦（try/catch 隔离）；传 `scored`（已有）+ `ranked` + observing promotedAddrs + ctx |
| `service/HYPE-discovery/process/evaluate.mjs` | **复用不改**：`__internals.aggregateTrades` 供 ⑦ 聚合推荐后 fills |
| `service/HYPE-discovery/process/observing.mjs` | **仅加返回值**：`observing()` 两个 return（dry-run + 正常）各加 `promotedAddresses`（=`promoted.map(p => p.address)`，本周🟢 `address`），不改任何逻辑；`isoWeekId` 已在 `__internals` 导出供 ⑦ 复用 |
| `service/HYPE-discovery/api/index.mjs` | **复用不改**：`fetchUserFills` |
| `service/HYPE-discovery/log/ledger.json` | **新建** `{}` |
| `.gitignore` | **已自动覆盖**：`service/HYPE-discovery/log/` 目录已在忽略列表，`ledger.json` 落此目录本就不入库，无需新增行 |
| `docs/discovery/feedback-loop.md` | 标阶段 1 已实现 |
| `docs/discovery/hype.md` | 六阶段 → 七阶段（加 ⑦ shadow） |
| `docs/update-log.md` | **最后一步**：feat(HYPE-discovery) shadow 记录 |

**不动**：discovery ①-⑥ 逻辑、evaluate 门槛/aggregateTrades 内核、TG 推送；observing 仅加返回值不改逻辑。

---

## 验证策略（实测门禁）

代码写完、更新文档前，必须实测通过：

1. **确定性多周模拟**：合成台账 + 分周喂 shadow（合成 scored/recommended/promoted + 合成 fills），验证：预测落账去重、对照组采样（topK 外 N 个）、逐周回填 pnlSince/tradesSince/maxDrawdownSince、满 4 周冻结、休眠地址（0 笔）容错、地址消失容错。**打印台账演变到对话**。
2. **真实数据回填**：用现有 HYPE log 里的推荐地址跑一次 ⑦(B)，`fetchUserFills` + `aggregateTrades` 算推荐后盈亏，验证链路成立（探针）。
3. **有问题就地修复复跑，通过才更新文档**；测试产物不入库。

---

## 验收标准

- [ ] `shadow.mjs` 存在且导出 `shadow()`；自带 ledger JSON 读写（读失败容错 `{}`）；仅写 `ledger.json`
- [ ] `main.mjs` ⑥ 后 try/catch 调 ⑦，异常不中断 ①-⑥；`node --check` 通过
- [ ] `observing()` 两个 return 都加 `promotedAddresses`（=`promoted.map(p => p.address)`）：dry-run 分支 + 正常分支，否则 dry-run 下 ⑦ 拿到 `undefined`
- [ ] shadow 侧 `promotedAddrs` 用 `?? []` 兜底（observing 异常返回 `null` 时不抛）
- [ ] (A) 预测落账：recommended 标 `discovery` / observing🟢 标 `observing`，同 `week|address` 去重
- [ ] (A') 对照组：`scored.slice(ranked.length, ranked.length+N)` 标 `stage:control`，N=recommended 数（不足则取现有）；不引入裸 `topK` 变量
- [ ] (B) 回填：跟踪中行重拉 `fetchUserFills` → `aggregateTrades` 聚合推荐后成交 → 写 pnlSince/tradesSince/maxDrawdownSince 到 2w/4w 桶；满 4 周 `matured=true` 停跟
- [ ] `tradesSince=0` 的休眠地址不误标负样本；地址无成交/销户返空不报错
- [ ] outcome 含 `baselinePnl`（哨兵）+ 三窗口字段；台账往返读写保留全字段
- [ ] ⑦ 打 console 日志 `记账X·回填Y·成熟Z`；**不推 TG、不落 md**
- [ ] `dry-run` 下 ⑦ 不写台账（对齐 output dry-run）
- [ ] 性能：⑦ 仅对台账已知地址各拉 1 次 userFills，走现有限流，不碰榜单
- [ ] `.gitignore` 覆盖 `ledger.json`（`log/` 目录已忽略，天然满足，无需改文件）
- [ ] **实测门禁**：确定性多周模拟 + 真实数据回填链路全部通过
- [ ] `docs/discovery/feedback-loop.md` 标阶段1、`hype.md` 六→七阶段（实测通过后）
- [ ] **最后一步**：`docs/update-log.md` 顶部新增 feat 记录

---

## 验收场景

### 场景 1：新推荐落账 → 预测侧写入
- **Given** 本周（2026-W28）discovery recommended 含 `0xA`（score 72, PF 3.5, netProfit 12000），台账无 `0xA`
- **When** ⑦ 执行
- **Then** `ledger.json` 新增 `2026-W28|0xa...: {stage:"discovery", predict:{score:72,...}, outcome:{baselinePnl:12000, pnlSince:{}, matured:false}}`

### 场景 2：对照组采样 → topK 外前 N 个
- **Given** 本周 `scored` 有 18 个（过门槛），topK=10 → recommended 10 个；N=10
- **When** ⑦ 执行 (A')
- **Then** `scored[10..17]`（8 个，不足 10 取现有）写入台账 `stage:"control"`

### 场景 3：满 2 周 → 首个结果回填
- **Given** 台账有 `2026-W28|0xA {recommendedAt:W28, matured:false}`，现在 2026-W30（+2周），`0xA` 推荐后成交聚合出 5 笔、Σpnl +$800、最大回撤 −$300
- **When** ⑦(B) 执行
- **Then** `0xA.outcome.pnlSince["2w"]=800`、`tradesSince["2w"]=5`、`maxDrawdownSince` 记录；`matured` 仍 false

### 场景 4：满 4 周 → 冻结停跟
- **Given** 台账有 `0xA {recommendedAt:W28}`，现在 2026-W32（+4周）
- **When** ⑦(B) 执行
- **Then** `0xA.outcome.pnlSince["4w"]` 记入、`matured=true`；此后 ⑦(B) 不再重拉 `0xA`

### 场景 5：休眠地址 → 不误判负样本
- **Given** 台账有 `0xB {recommendedAt:W28}`，`0xB` 推荐后无任何成交（`fetchUserFills` 推荐后为空）
- **When** ⑦(B) 执行
- **Then** `0xB.outcome.pnlSince["2w"]=0`、`tradesSince["2w"]=0`（标休眠，calibrate 阶段不计入负样本）；不报错

### 场景 6：⑦ 异常 → 不中断 ①-⑥
- **Given** ⑤/⑥ 已完成，⑦ 执行时 `ledger.json` 读取抛错（文件损坏）
- **When** ⑦ 捕获异常
- **Then** discovery 进程正常退出，①-⑥ 产物（log/discovery、observing、主 TG）保留，console 打 ⑦ 告警，不抛出
