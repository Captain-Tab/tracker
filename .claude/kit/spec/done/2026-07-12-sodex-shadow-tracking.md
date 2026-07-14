# Spec: sodex 影子跟踪 + 预测台账（闭环反馈阶段 1）

> 闭环反馈体系（见 `docs/discovery/feedback-loop.md`）的**阶段 1 · sodex 侧**：sodex-discovery ⑦ shadow 影子跟踪 + 预测台账 + 对照组。**纯采集，不含 calibrate**（阶段 2 另开 spec）。**仅 sodex**；HYPE 同款已落地（`2026-07-11-hype-shadow-tracking.md`），本 spec 是其忠实镜像 + sodex 数据口径适配。

---

## 背景与目的

**问题**：sodex-discovery + observing 与 HYPE 同构，同样是**开环**——每周独立预测候选，却从不复盘上一批预测准不准。`log/discovery/` 记录了「预测」，但没有一条「结果」。

**根因**：缺的不是数据量，是**给预测贴事后结果标签，并回读**。门槛/权重全靠拍脑袋。

**目的（阶段 1）**：加一个**旁路数据层**，让 sodex 从下周起**记账**——每周把预测写入台账，并持续拉这些账户的真实盈亏回填结果。攒够带标签数据后（阶段 2）才能校准。不改现有 discovery 逻辑（observing 仅加返回值 `promotedAddresses`，行为不变）。

**与 HYPE 的关系**：台账 schema 统一（calibrate 阶段 2 跨平台复用），骨架照搬 HYPE，唯一实质差异是 (B) 回填腿的盈亏口径（sodex positions.realized_pnl vs HYPE userFills.closedPnl）。

---

## 选定方案

**方案**：sodex-discovery 加 ⑦ shadow 阶段（复用每周跑）+ 预测台账 `log/ledger.json` + 规则采样对照组。骨架**照搬 HYPE `shadow.mjs` + 4 处 sodex 口径适配**（绝非整段 copy，照抄会踩坑）：

| # | HYPE 写法 | sodex 必改 | 不改的后果 |
| --- | --- | --- | --- |
| ① 地址字段 | `lc(a.address)`（HYPE 元素有 `.address`） | **`lc(s.walletAddress)`**（sodex 元素只有 `walletAddress`，无 `.address`） | 🔴 recommended/control 腿全得 `undefined`，id 变 `week\|`，(A) 预测腿静默失效 |
| ② 双键 | 行只存 `address` | 行加存 `accountId`（三条腿都带） | 🔴 (B) 回填无 accountId 可用 |
| ③ 回填接口 | `fetchUserFills(row.address)`+`aggregateTrades` | `fetchPositions(row.accountId, limit)`+`filter(size===0 && updated_at>recAt)`（无聚合） | 🔴 sodex 不导出 aggregateTrades，import 即报错 |
| ④ 回撤函数 | `computeMaxDrawdown` 用 `t.closeMs`/`t.pnl` | 换 `updated_at`/`realized_pnl` | 🔴 字段 undefined，回撤恒 0 |

可直接照搬的（零改）：ledger I/O 容错、去重、2w/4w 窗口 + MATURE_WEEKS、对照组 `ranked.length` slice 边界、dry-run 不写盘、console 日志、PREDICT_FIELDS 五字段（sodex 精确同名）、`isoWeekId` 复用。

- **影子跟踪**：不真跟单，每周持续拉「曾被推荐账户」的 positions，算它推荐**之后**的真实盈亏
- **预测台账**：一行 = 一次预测（predict 侧）+ 它的事后结果（outcome 侧，逐周回填）
- **对照组**：每周采「过门槛但排名 topK 外」的 N 个（`scored` 里 topK+1..topK+N）

**sodex 独特数据处理（本 spec 核心差异）**：

1. **盈亏数据源**：sodex 用 `fetchPositions(accountId, limit)` 拉逐笔已平仓位（`api/index.mjs:173`），positions 本身即逐笔真账本，**无需也没有 aggregateTrades**。回填 = `filter(size===0 && updated_at>recommendedAt)` → `Σ realized_pnl`。对比 HYPE 是 `fetchUserFills(address)` → `aggregateTrades` 聚合成交易 → `Σ closedPnl`。
2. **账户双键**：sodex 台账行须同时落 `address`（walletAddress 小写，台账 key）+ `accountId`（回填时调 `fetchPositions` 必需）。HYPE 只有 address 单键。feedback-loop.md §5 schema 的 `accountId` 字段正是为 sodex 设计。
3. **limit 传参**：`fetchPositions` 默认 200 会截断长历史，须传 `config.positionsLimit`（1000）。经 **ctx 注入**（`main.mjs` 把 `config.positionsLimit` 塞进 ctx），shadow 签名保持 `(scored, ranked, promotedAddrs, ctx)` 与 HYPE 完全一致。
4. **symbol_id 币名解析不涉及**：shadow 只求 Σpnl/笔数/回撤，跨币种合并求和，不解析币名。

**影子跟踪定位（须立住）**：只能**证伪不能证真**——账户赚 ≠ 跟得上（滑点/跟单率看不见）。可靠**排除坏的**，不能确认好的。

---

## 设计概要

### 架构：sodex-discovery 管线加 ⑦ 阶段

`sodex-discovery/main.mjs` 在 ⑥ observing 后（observing 调用在 `main.mjs:199`，`:200` 是 log 行，折入其后）调 `shadow(scored, ranked, promotedAddrs, ctx)`。⑦ **只写 `log/ledger.json`**；try/catch 隔离，异常不中断 ①-⑥。每周随 discovery 自动跑。

`promotedAddrs` = observing 新增返回的「本周🟢地址列表」（walletAddress 小写）；shadow 用每个 address 去 `scored` 回查完整 predict 字段（含 recoveryFactor **和 accountId**），因 observing 的 promoted 对象缺 recoveryFactor 且不含 accountId。

```
①-⑤ → ⑥ observing → ⑦ shadow ┬─ (A) 写预测：recommended + observing🟢
                              ├─ (A') 写对照：scored 里 topK+1..topK+N（stage:control）
                              └─ (B) 回填：台账「跟踪中」行重拉 fetchPositions，算推荐后 Σrealized_pnl
```

### 关键数据结构：`log/ledger.json`

按 `week|address` 唯一键（address = walletAddress 小写），一行一预测（load-modify-save，同 observing 模式）：

```jsonc
{
  "2026-W28|0xabc...": {
    "week": "2026-W28",
    "recommendedAt": 1782230400000,
    "address": "0xabc...",                   // walletAddress 小写（台账 key）
    "accountId": "13462",                    // sodex 双键：回填调 fetchPositions 必需
    "stage": "discovery",                    // discovery | observing | control
    "predict": { "score": 72, "profitFactor": 3.5, "winRate": 0.79, "recoveryFactor": 2.1, "netProfit": 12000 },
    "outcome": {
      "baselinePnl": 12000,                  // 数据完整性哨兵（非计算用）
      "pnlSince": { "2w": 800, "4w": 3200 }, // 推荐后新增 Σrealized_pnl（主 2 周 + 尾 4 周）
      "tradesSince": { "2w": 5, "4w": 14 },  // 推荐后已平仓位数：区分休眠(0) vs 活跃没赚
      "maxDrawdownSince": { "4w": -1900 },   // 推荐后期间最大回撤（负值）：识别回本型陷阱
      "lastPulledAt": 1783440000000,
      "matured": false                       // 满 4 周冻结停跟
    }
  }
}
```

### ⑦ shadow 逻辑

```
ledger = loadLedger(ledgerPath)                       # 自带 JSON I/O，读失败容错 {}
weekId = observing.__internals.isoWeekId(new Date())  # 复用 sodex observing 现成 ISO 周工具
positionsLimit = ctx.positionsLimit ?? 1000           # ctx 注入，兜底 1000

# 统一建行工厂：sodex 地址字段是 walletAddress（非 .address！），双键必带 accountId
mkRow(s, stage) = { ...pick(s, PREDICT_FIELDS), address: lc(s.walletAddress), accountId: s.accountId, stage }

# (A) 写预测（同 id 去重）
# recommended 腿：ranked 元素完整（含 walletAddress + accountId + recoveryFactor）
predictRows = ranked.map(s => mkRow(s, "discovery"))
# observing🟢 腿：promoted 只给 address(小写 walletAddress)，回查 scored 补全（recoveryFactor + accountId）
for addr of promotedAddrs:
  s = scored.find(x => lc(x.walletAddress) == addr)   # 按 walletAddress 匹配，非 .address
  if s: predictRows.push(mkRow(s, "observing"))
# (A') 写对照（scored 排 topK 外的前 N 个；N=recommended 数）
# 用 ranked.length 作边界（ranked = scored.slice(0, topK)，已传参，天然自洽），不引入裸 topK
control = scored.slice(ranked.length, ranked.length + N)   # N = ranked.length；过门槛但未入选
predictRows.push(...control.map(s => mkRow(s, "control")))

for r of predictRows:
  id = `${weekId}|${r.address}`                        # r.address 已是小写 walletAddress
  if !ledger[id]: ledger[id] = { week, recommendedAt:now, address:r.address, accountId:r.accountId, stage:r.stage,
                                 predict:pick(r, PREDICT_FIELDS),
                                 outcome:{ baselinePnl:r.netProfit, pnlSince:{}, tradesSince:{}, maxDrawdownSince:{}, lastPulledAt:null, matured:false } }

# (B) 回填「跟踪中」行（未成熟且满 2 周）
for row of ledger where !matured 且 weeksElapsed≥2:
  positions = fetchPositions(row.accountId, positionsLimit)  # sodex 用 accountId + limit！
  postClosed = positions where (Number(size)===0 且 Number(updated_at) > recommendedAt)  # 已平仓 + 推荐后
  weeksElapsed = round((now - recommendedAt)/周)
  bucket = weeksElapsed≥4 ? "4w" : "2w"
  row.outcome.pnlSince[bucket] = Σ Number(realized_pnl)
  row.outcome.tradesSince[bucket] = postClosed.length                 # 已平仓位数
  row.outcome.maxDrawdownSince[bucket] = -computeMaxDrawdown(postClosed)  # 按 updated_at 升序累计 realized_pnl 峰谷回撤，取负
  row.outcome.lastPulledAt = now
  if weeksElapsed ≥ 4: row.outcome.matured = true

saveLedger(ledgerPath, ledger)   # dry-run 不写
log(`⑦ 影子跟踪：记账 X 条 · 回填 Y 条 · 成熟 Z 条`)   # console，journalctl 可见
```

**sodex 口径**：outcome 盈亏用 `positions.realized_pnl`（已平仓位逐笔），非 HYPE 的 userFills 聚合。`推荐后盈亏` = 推荐时间后平仓（`updated_at > recommendedAt`）的 positions 的 Σrealized_pnl。回撤复用 sodex `metrics.mjs` 的已平仓位回撤口径（按 `updated_at` 升序累计）。

### observing 返回值改动（前置依赖）

sodex `observing()` 三个 return（dry-run `:196` / 正常 `:210` / catch `:213` return null）。给 **dry-run + 正常两个 return** 各加 `promotedAddresses: promoted.map(p => p.address)`（promoted 对象的 `.address` 是小写 walletAddress，`observing.mjs:154-157`），逻辑不改。catch 的 `return null` 不动，shadow 侧用 `?? []` 兜底。

### 时机

- 一条预测 W0 落账 → W2 记 2 周结果（首信号）→ W4 记 4 周结果并冻结停跟
- 系统上线后头 4 周只采集（样本未成熟），calibrate（阶段 2）等 4 周后才有料

---

## 边界与约束

**包含：**
- sodex 侧 shadow ⑦ 阶段（`shadow.mjs`）+ 预测台账 `ledger.json` + 对照组（scored topK 外采样）
- outcome 三窗口字段：`pnlSince / tradesSince / maxDrawdownSince`（主 2 周 + 尾 4 周）
- 台账行双键 `address`(walletAddress) + `accountId`
- observing 两个 return 补 `promotedAddresses`
- ⑦ console 日志；复用 `fetchPositions` + sodex `observing.__internals.isoWeekId`
- 文档：`docs/discovery/feedback-loop.md`（标 sodex 阶段1）+ `sodex.md` 六→七阶段 + `update-log`

**不包含：**
- **calibrate 回看校准**（阶段 2 另开 spec）
- HYPE 侧（已落地）
- gate-failed「擦边淘汰」对照（需 evaluate 吐擦边落选画像，阶段 2）
- 自动调参、执行真值（阶段 3）
- symbol_id 币名解析（shadow 只求 Σpnl，跨币合并）
- **不推 TG、不落 md**（阶段 1 纯采集，无结论可报）

**已知限制：**
- **影子只能证伪不能证真**：账户赚 ≠ 跟得上 → 定位是排除坏的
- 幸存者偏差**残留**：对照组是「过门槛未入选」，部分缓解非根治
- 头 4 周无成熟样本（数据规律，非 bug）
- 账户无新平仓 → positions 空/全未平 → outcome 记 0 + tradesSince=0（标休眠，不算负样本），不报错
- `positionsLimit=1000` 对活跃账号（实测最多 445 条/账户，`main.mjs:43` 注释）足够；若日后某账号平仓 >1000 条会截断，届时阶段2 calibrate 打折
- ISO 周依赖运行机器时区

---

## 集成点

| 文件 | 改动 |
| --- | --- |
| `service/sodex-discovery/process/shadow.mjs` | **新增**：⑦ 逻辑 + 自带 ledger JSON 读写，导出 `shadow(scored, ranked, promotedAddrs, ctx)`；(B) 回填用 `fetchPositions(accountId, ctx.positionsLimit)` + `filter(size===0 && updated_at>recAt)` + `Σrealized_pnl` |
| `service/sodex-discovery/main.mjs` | ⑥ 后调 ⑦（try/catch 隔离）；传 `scored`（已有）+ `ranked` + `obsRes?.promotedAddresses ?? []` + ctx；ctx 注入 `positionsLimit: config.positionsLimit` |
| `service/sodex-discovery/process/observing.mjs` | **仅加返回值**：两个 return（dry-run `:196` + 正常 `:210`）各加 `promotedAddresses`（=`promoted.map(p => p.address)`），不改逻辑；`isoWeekId` 已在 `__internals` 导出供 ⑦ 复用 |
| `service/sodex-discovery/api/index.mjs` | **复用不改**：`fetchPositions(accountId, limit)` |
| `service/sodex-discovery/process/evaluate.mjs`（含 `metrics.mjs`） | **复用参考不改**：已平仓位回撤口径（按 `updated_at` 升序累计 realized_pnl）供 shadow 内联 `computeMaxDrawdown` 参考 |
| `service/sodex-discovery/log/ledger.json` | **新建** `{}`（运行时自动创建） |
| `.gitignore` | **已自动覆盖**：`service/sodex-discovery/log/` 目录已在忽略列表，`ledger.json` 天然不入库 |
| `docs/discovery/feedback-loop.md` | 标 sodex 阶段 1 已实现 |
| `docs/discovery/sodex.md` | 六阶段 → 七阶段（加 ⑦ shadow） |
| `docs/update-log.md` | **最后一步**：feat(sodex-discovery) shadow 记录 |

**不动**：discovery ①-⑥ 逻辑、evaluate 门槛内核、TG 推送；observing 仅加返回值不改逻辑。

---

## 验收标准

- [ ] `shadow.mjs` 存在且导出 `shadow(scored, ranked, promotedAddrs, ctx)`；签名与 HYPE 一致；自带 ledger JSON 读写（读失败容错 `{}`）；仅写 `ledger.json`
- [ ] `main.mjs` ⑥ 后 try/catch 调 ⑦，异常不中断 ①-⑥；ctx 注入 `positionsLimit: config.positionsLimit`；`node --check` 通过
- [ ] `observing()` 两个 return（dry-run `:196` + 正常 `:210`）都加 `promotedAddresses`（=`promoted.map(p => p.address)`），否则 dry-run 下 ⑦ 拿到 `undefined`
- [ ] shadow 侧 `promotedAddrs` 用 `?? []` 兜底（observing 异常返回 `null` 时不抛）
- [ ] (A) 预测落账：recommended 标 `discovery` / observing🟢 标 `observing`（回查 scored 补 recoveryFactor + accountId），同 `week|address` 去重
- [ ] (A') 对照组：`scored.slice(ranked.length, ranked.length+N)` 标 `stage:control`，N=recommended 数（不足则取现有）；不引入裸 `topK` 变量
- [ ] **地址字段读 `walletAddress` 不是 `.address`**：三条腿建行统一 `address: lc(s.walletAddress)`、observing🟢 腿 `scored.find(x => lc(x.walletAddress) == addr)`（照抄 HYPE 的 `.address` 会静默失效，id 变 `week|`）
- [ ] **每行双键**：`address`(walletAddress 小写) + `accountId` 都落账；(B) 回填用 `accountId` 调 `fetchPositions`
- [ ] (B) 回填：跟踪中行 `fetchPositions(accountId, positionsLimit)` → `filter(size===0 && updated_at>recAt)` → 写 pnlSince(Σrealized_pnl)/tradesSince(平仓位数)/maxDrawdownSince 到 2w/4w 桶；满 4 周 `matured=true` 停跟
- [ ] `maxDrawdownSince` 落账取负值（按 `updated_at` 升序累计 realized_pnl 峰谷回撤）
- [ ] `tradesSince=0` 的休眠账户不误标负样本；账户无平仓/返空不报错
- [ ] outcome 含 `baselinePnl`（哨兵）+ 三窗口字段；台账往返读写保留全字段
- [ ] ⑦ 打 console 日志 `记账X·回填Y·成熟Z`；**不推 TG、不落 md**
- [ ] `dry-run` 下 ⑦ 不写台账（对齐 output/observing dry-run）
- [ ] 性能：⑦ 仅对台账已知账户各拉 1 次 fetchPositions，走现有限流，不碰榜单
- [ ] `.gitignore` 覆盖 `ledger.json`（`log/` 目录已忽略，天然满足，无需改文件）
- [ ] **实测门禁**：确定性多周模拟 + 真实数据回填链路全部通过
- [ ] `docs/discovery/feedback-loop.md` 标 sodex 阶段1、`sodex.md` 六→七阶段（实测通过后）
- [ ] **最后一步**：`docs/update-log.md` 顶部新增 feat 记录

---

## 验收场景

### 场景 1：新推荐落账 → 预测侧写入（双键）
- **Given** 本周（2026-W28）sodex discovery ranked 含 `{walletAddress:0xA, accountId:"555", score:72, profitFactor:3.5, netProfit:12000}`，台账无 `2026-W28|0xa`
- **When** ⑦ 执行 (A)
- **Then** `ledger.json` 新增 `2026-W28|0xa...: {stage:"discovery", address:"0xa", accountId:"555", predict:{score:72,...}, outcome:{baselinePnl:12000, pnlSince:{}, matured:false}}`

### 场景 2：对照组采样 → topK 外前 N 个
- **Given** 本周 `scored` 有 18 个（过门槛，降序），`ranked` = scored.slice(0,10) → 10 个；N=10
- **When** ⑦ 执行 (A')
- **Then** `scored[10..17]`（8 个，不足 10 取现有）写入台账 `stage:"control"`，各含 address+accountId

### 场景 3：满 2 周 → 首个结果回填（sodex positions 口径）
- **Given** 台账有 `2026-W28|0xA {accountId:"555", recommendedAt:W28, matured:false}`，现在 2026-W30（+2周）。`fetchPositions("555",1000)` 返回 3 条 `size===0 && updated_at>W28` 的平仓位，Σrealized_pnl=+$800，按 updated_at 升序峰谷回撤 $300
- **When** ⑦(B) 执行
- **Then** `0xA.outcome.pnlSince["2w"]=800`、`tradesSince["2w"]=3`、`maxDrawdownSince["2w"]=-300`；`matured` 仍 false

### 场景 4：满 4 周 → 冻结停跟
- **Given** 台账有 `0xA {accountId:"555", recommendedAt:W28}`，现在 2026-W32（+4周）
- **When** ⑦(B) 执行
- **Then** `0xA.outcome.pnlSince["4w"]` 记入、`matured=true`；此后 ⑦(B) 不再重拉 `0xA`

### 场景 5：休眠账户 → 不误判负样本
- **Given** 台账有 `0xB {accountId:"777", recommendedAt:W28}`，`0xB` 推荐后无任何平仓（`fetchPositions` 返回全 `size>0` 或空）
- **When** ⑦(B) 执行
- **Then** `0xB.outcome.pnlSince["2w"]=0`、`tradesSince["2w"]=0`（标休眠，calibrate 不计入负样本）；不报错

### 场景 6：observing🟢 腿回查补全 accountId
- **Given** observing 本周🟢 promoted 含 `{address:"0xc"}`（无 accountId），`scored` 里 `0xc` 对应 `{walletAddress:"0xc", accountId:"888", recoveryFactor:2.1, ...}`
- **When** ⑦ 执行 (A) observing 腿
- **Then** 台账 `2026-W28|0xc` 落账 `stage:"observing"`、`accountId:"888"`、`predict.recoveryFactor:2.1`（回查 scored 补全）

### 场景 7：⑦ 异常 → 不中断 ①-⑥
- **Given** ⑤/⑥ 已完成，⑦ 执行时 `ledger.json` 读取抛错（文件损坏）
- **When** ⑦ 捕获异常
- **Then** discovery 进程正常退出，①-⑥ 产物保留，console 打 ⑦ 告警，不抛出
