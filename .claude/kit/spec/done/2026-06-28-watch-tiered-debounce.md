# Spec: sodex-watch 分档 debounce（治理滚仓刷屏）

## 背景与目的

sodex-watch 监听跟单候选账户的 perps 仓位变化并推 Telegram。当账户在**同一仓位内反复加减仓（滚仓）**时，会刷屏式推送大量消息。

用真实数据定位根因（account 17139 = `0x267b408d84ff9546bc92e25d53e0137c7e952566`，ETH/symbol_id=2）：

- 触发推送的瓶颈是 `watcher.mjs:scheduleFetch` 的 **trailing debounce=3s**，而非 maxWait。成交间隔 p50=7.8s / p75=14.7s 全部 > 3s，导致每笔成交各自 flush。
- 实测一段 16 分钟密集建仓窗：42 笔成交 → 现状推 35 条；ETH 全量 408 笔 / 387h → 现状推 287 条。
- 关键区分：刷屏全部来自**滚仓**（持仓"币种:方向"不变，仅 size 变；实测 INCREASE×160 / DECREASE×236）；而**开仓/平仓/反手是低频关键节点**（实测 OPEN×6 / CLOSE×6），跟单必须即时收到。

目的：**滚仓加减仓合并后再推，开/平/反手保持即时**，在不丢跟单信号的前提下消除刷屏。

范围收口：本次仅优化 **sodex-watch** 的 Telegram 推送刷屏；`HYPE-watch` 为独立同构代码，本次不动（未来可对称移植）。注意 `watcher.mjs:fetchAndReport` 内 `console.log` 日志与 `sendTelegram` 同一次触发，故合并会让 **TG 与 console 日志同步减少**（符合预期，journal 同样不刷屏）。

## 选定方案

**方案：按持仓 `{币种:方向}` 键集合是否变化，给 debounce 分两档。**

对比与否决：
- ❌ 拉长 maxWait：实测无效（35→35、287→287），瓶颈是 debounce 不是 maxWait。
- ❌ 固定长 debounce（一刀切 20s）：会把开/平仓也延迟 20s，是打补丁。
- ✅ 差异化分档：用一次本地键集合比对区分滚仓与开平仓，关键节点即时、滚仓合并。改动小、可回滚、风险低。

实测验证（sim3，含 6 个完整开平周期）：差异化总推送 287 → **104** 条；开/平/反手 12 个事件推送延迟中位 **3.0s**、最大 **3.7s**，与现状完全一致（即开平仓零额外延迟）。

## 设计概要

### 两档定义

| 档位 | 判别（本地，无需拉接口） | debounce / maxWait | 行为 |
|------|------------------------|-------------------|------|
| 短档（关键节点） | 持仓键集合 `{symbol:dir}` 变化（新增=开仓 / 消失=平仓 / 方向翻转=反手）**或** reduceOnly 离场单集合变化 | 3s / 5s（维持现状） | 即时推 |
| 长档（滚仓） | 键集合不变、仅 `abs(size)` 变 | 20s / 90s（可配 flag） | 合并 |

### 核心逻辑

1. 新增 helper `positionKeysFp(positions)`：对 `size≠0` 的持仓产出 **不含 size** 的 `symbol:dir` 排序指纹（复用 `parse.mjs:positionDirection`）。**不得复用 `canonicalPositionsFp`**（那个含 `abs(size)`）。
2. `handleMessage` 的 `accountState` 分支：在算触发指纹时，额外比对「当前键集合指纹 + reduceOnly 集合指纹」与「上次推送时的对应快照」是否变化，得出本次是否为 **structural（结构变化）**。
3. `scheduleFetch` 增加档位选择：structural → 短档参数；否则长档参数。窗口期内任一帧 structural=true 即**升级为短档并重排定时器**（取最紧急）；到点强制 flush 时清空升级标记。
4. **档位只由 `accountState` 比对决定**；`accountTrade` / `accountOrderUpdate` 触发的 `scheduleFetch` 维持当前窗口档位、**不升级、不重置档位**（它们无 positions 上下文，仅作"重新评估"提示）。

### 键集合基准

比对基准用 `this.lastPositions` / 上次推送的 reduceOnly 快照——它们仅在 `fetchAndReport` 成功推送时更新（`outFp` 去重 return 时不更新），因此始终代表"上次真正推送的状态"，比对语义正确。首帧 baseline：上次为空集 → 有仓即 structural → 短档即时推 START WATCH。

### 参数与回退

- 长档默认 `tier-debounce-ms=20000` / `tier-max-wait-ms=90000`，短档复用现有 `debounce-ms=3000` / `max-wait-ms=5000`。
- 全部经 flag 可覆盖；长档设为与短档相同值即完全回退现状行为。

## 边界与约束

**包含：**
- 滚仓（同币同向 size 变化）的合并；
- 开仓 / 平仓 / 反手 / 离场单变化的即时推；
- 滚仓窗口中途出现结构变化时的即时降档；
- 长档可配 flag 与回退现状能力。

**不包含：**
- `HYPE-watch` 的同类优化（独立同构代码，本次不动）；
- 离场单"拖单刷屏"治理（与成交滚仓正交，非实测痛点，未来单独评估）；
- WS 端到端实时验证（作上线后观察项，非门禁）；
- 监听侧的额外节流（监听侧必须全量接收，节流闸只保留 debounce 一道）。

**已知限制：**
- WS 抖动推来异常空 `P` → 键集合骤空 → 可能误判平仓走短档即时推。现状同样存在（fp 也会变），靠现有 `outFp` 去重 + G5/G6 平仓历史校验兜底，属 WS 数据质量问题，不在本方案范围。
- 孤立独立动作（前后无近邻成交，实测占比约 4%）若被判为滚仓，会延迟至多 20s；可接受。

## 集成点

- `service/sodex-watch/process/watcher.mjs`：`scheduleFetch`（档位选择）、`handleMessage`（accountState 键集合比对 + structural 标记）、构造函数（新增长档参数字段与默认值）。
- `service/sodex-watch/process/parse.mjs`：新增 `positionKeysFp`（不含 size 的键集合指纹）。
- `service/sodex-watch/main.mjs`：透传 `--tier-debounce-ms` / `--tier-max-wait-ms` flag。
- `service/sodex-watch/test/domain.test.mjs`：新增分档逻辑单测。

## 验收标准

- [ ] 新增 `positionKeysFp`，输出与 size 无关，仅随 `symbol`/方向变化。
- [ ] 持仓键集合新增一个键（开仓）→ 判 structural → 短档。
- [ ] 持仓键集合消失一个键（平仓）→ 判 structural → 短档。
- [ ] 键方向翻转（LONG↔SHORT 反手）→ 判 structural → 短档。
- [ ] 键集合不变、仅 abs(size) 变（滚仓）→ 判非 structural → 长档。
- [ ] reduceOnly 离场单集合变化（键集合与 size 均不变）→ 判 structural → 短档。
- [ ] 长档窗口期内出现结构变化帧 → 升级短档并尽快 flush。
- [ ] `accountTrade`/`accountOrderUpdate` 触发不改变 / 不升级当前档位。
- [ ] 长档 flag 设为与短档相同值 → 行为与现状一致（回退可用）。
- [ ] 单测全绿；分档结论与 sim3 实测（287→104、开平延迟中位 3s）方向一致。

## 验收场景

### 场景 1：开仓即时推（Happy Path）
- **Given** watcher 上次推送时持仓键集合为 `{ETH:LONG}`、无离场单；当前 `accountState` 推来新增 `BTC:SHORT` 仓位（size≠0），键集合变为 `{ETH:LONG, BTC:SHORT}`
- **When** `handleMessage` 处理该 `accountState` 帧
- **Then** 本次判为 structural，`scheduleFetch` 走短档（debounce 3s / maxWait 5s），≤5s 内 flush 推送

### 场景 2：滚仓合并
- **Given** 持仓键集合稳定为 `{ETH:LONG}`，16 分钟内连续到达 42 帧 size 变化（间隔 7~22s），其间键集合始终不变、无离场单变化
- **When** 这些帧持续触发 `scheduleFetch`
- **Then** 全程判非 structural 走长档（debounce 20s / maxWait 90s），推送数显著少于现状（实测同形态 35→8 量级），每次推的是当前最新累计持仓

### 场景 3：滚仓途中平仓 → 即时降档
- **Given** 正处于长档滚仓合并窗口、已等待约 18s（未到 90s 封顶），持仓键集合 `{ETH:LONG}`
- **When** 到达一帧使键集合变为 `{}`（ETH 仓位 size=0 平掉）
- **Then** 该帧判为 structural，窗口升级为短档，因已等待 ≥ 短档 maxWait（5s）而立即 flush 推送平仓

### 场景 4：非 accountState 频道不乱改档位
- **Given** 当前处于长档滚仓窗口（structural=false）
- **When** 收到 `accountTrade` 频道消息触发 `scheduleFetch`
- **Then** 不升级为短档、不重置档位，沿用当前长档窗口
