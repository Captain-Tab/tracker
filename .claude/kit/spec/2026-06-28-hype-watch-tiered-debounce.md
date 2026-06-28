# Spec: HYPE-watch 分档 debounce（对齐 sodex 治理滚仓刷屏）

## 背景与目的

把 sodex-watch 已落地的分档 debounce（`2026-06-28-watch-tiered-debounce`）对称移植到 HYPE-watch。两端 watcher 高度同构（`scheduleFetch`/`fetchAndReport`/防抖结构一致），HYPE 同样存在"同一仓位反复加减仓（滚仓）刷屏"问题。

用真实数据定位（地址 `0xaf0fdd39e5d92499b0ed9f68693da99c0ec1e92e`，HYPE 多币活跃大户，5 仓 / 2000 fills / 502h）：

- HYPE 成交**亚秒级密集**（间隔 p50=0s / p75=0.6s / p90=64s），现状 3s debounce 已合并簇内大半（1762 成交事件 → 330 推送）。
- 长档主要合并"簇间仍在滚仓"的情况；分档收益小于 sodex 但开平即时性零损失。
- 该号当前 95 个挂单全为 `reduceOnly:false` 开仓限价单——大量限价单陆续成交是其亚秒密集成交、`canonicalOpenOrdersFp` 频繁变动的根源。

目的：**开/平/反手/离场单变化即时推，滚仓加减仓合并**，不丢跟单信号，行为与 sodex 对齐。

## 选定方案

**方案：逻辑对齐 sodex + 参数按 HYPE 实测拐点适配。** 按持仓 `{coin:dir}` 键集合或离场单子集是否变化分两档。

关键事实（实测）：HYPE `wsOrders`（openOrders 频道）单**含 `reduceOnly` / `isPositionTpsl` 字段**（与 `frontendOpenOrders` 同构），因此可在 `recomputeStateFp`（fetch 前）拎出离场单子集判结构变化，与 sodex 完全对齐，无需降级。

参数选择（sim5 实测扫描，短档固定 3s/5s）：

| 长档 | 推送 | 压缩 | 孤立动作延迟 |
|------|------|------|------|
| 3s/5s（现状） | 330 | 5.3x | — |
| 12s/45s（选定） | 256 | 6.9x | 4% 延迟 12s |
| 20s/90s（sodex 同值） | 239 | 7.4x | 4% 延迟 20s |

选 12s/45s：HYPE 节奏快，边际收益拐点在 8~12s（12→20s 仅多合 17 条却把孤立动作延迟拉到 20s），更契合 HYPE。

## 设计概要

### 两档定义

| 档位 | 判别（本地，fetch 前） | debounce / maxWait | 行为 |
|------|------------------------|-------------------|------|
| 短档（关键节点） | 持仓键集合 `{coin:dir}` 变化（开仓/平仓/反手）**或** 离场单子集（`reduceOnly\|\|isPositionTpsl`）集合变化 | 3s / 5s（维持现状） | 即时推 |
| 长档（滚仓） | 键集合与离场单子集均不变（仅开仓单 `sz` 递减 / 持仓 `size` 变） | 12s / 45s（可配 flag） | 合并 |

### 核心逻辑

1. `parse.mjs` 新增两个纯函数：
   - `positionKeysFp(positions)`：HYPE 归一持仓的 `coin:dir` 排序指纹（不含 size）。HYPE `parsePositions` 已 filter `szi≠0`，直接 `map(p => `${p.coin}:${p.dir}`)`。
   - `canonicalExitOrdersFp(wsOrders)`：从原始 `wsOrders` filter `reduceOnly || isPositionTpsl`，`map(o => `${o.oid}:${o.limitPx}:${o.sz}`)` 排序。
2. `recomputeStateFp`：触发指纹 `fp` **保持现状**（`canonicalPositionsFp + canonicalOpenOrdersFp(全部挂单)`，灵敏度不变）；额外比对「当前 `positionKeysFp` / 离场单子集指纹」与「上次推送基准」是否变化，得出 `structural`，传 `scheduleFetch(structural)`。
3. `scheduleFetch(structural)`：structural → 短档；否则长档。`pendingStructural` 只升不降（窗口内取最紧急），到点强制 flush 时清空。
4. **档位只由 `clearinghouseState`/`openOrders`（recomputeStateFp）决定**；`userFills` / `orderUpdates` 触发的 `scheduleFetch(false)` 维持当前档位、不升级（无持仓上下文，仅"重新评估"提示）。
5. 基准 `lastKeysFp` / `lastExitFp` + `pendingStructural` 在 `fetchAndReport` 确认推送处（`lastPositions` 更新点）推进/重置；`outFp` 去重 / 限流 return 不动；fetch 重入 `scheduleFetch(this.pendingStructural)` 保留紧急度。
6. daily 镜像 `scheduleFetch(true)` 走短档即时。
7. 基准初值 `null`，使首帧 baseline（含空仓）必判结构变化 → 短档即时推 START WATCH。

### 参数与回退

- 短档复用现有 `debounce-ms=3000` / `max-wait-ms=5000`；长档 `tier-debounce-ms=12000` / `tier-max-wait-ms=45000`。
- flag 可覆盖；长档设为与短档相同即回退现状统一防抖。

## 边界与约束

**包含：**
- 滚仓（持仓键不变、仅 size/开仓单 sz 变）合并；
- 开仓 / 平仓 / 反手 / 离场单变化即时推；
- 滚仓窗口中途结构变化即时降档；
- 长档 flag 与回退能力。

**不包含：**
- 触发灵敏度调整（触发指纹保持 `canonicalOpenOrdersFp` 全量挂单，不改）；
- `userFills` 上限 2000 之外的历史回溯；
- WS 端到端实时验证（上线后观察项，非门禁）；
- 监听侧额外节流（接收全收，节流闸只保留 debounce 一道）。

**已知限制：**
- WS 抖动推来异常空持仓 → 键集合骤空误判平仓即时推；现状同样存在，靠 `outFp` 去重兜底，属 WS 数据质量问题。
- 孤立独立动作（实测约 4%）若被判滚仓，延迟至多 12s；可接受。
- HYPE 分档收益本就小于 sodex（现状 3s 已 5.3x），分档为锦上添花 + 高频号兜底。

## 集成点

- `service/HYPE-watch/process/parse.mjs`：新增 `positionKeysFp` + `canonicalExitOrdersFp`。
- `service/HYPE-watch/process/watcher.mjs`：构造函数新增字段；`recomputeStateFp` 算 structural；`scheduleFetch(structural)` 分档；基准在推送处推进；`userFills`/`orderUpdates` 不升级；daily 走短档。
- `service/HYPE-watch/main.mjs`：usage 补 `--tier-debounce-ms` / `--tier-max-wait-ms`（flag 已整体透传，仅补文档）。
- `service/HYPE-watch/test/domain.test.mjs`：新增 `positionKeysFp` + `canonicalExitOrdersFp` 单测。

## 验收标准

- [ ] 新增 `positionKeysFp`，输出 `coin:dir` 排序、与 size 无关。
- [ ] 新增 `canonicalExitOrdersFp`，仅取 `reduceOnly||isPositionTpsl` 单，产出 `oid:limitPx:sz` 排序指纹。
- [ ] 持仓键集合新增键（开仓）→ structural → 短档。
- [ ] 持仓键集合消失键（平仓）→ structural → 短档。
- [ ] 键方向翻转（反手）→ structural → 短档。
- [ ] 离场单子集变化（持仓键与 size 不变）→ structural → 短档。
- [ ] 仅开仓单 sz / 持仓 size 变（滚仓）→ 非 structural → 长档。
- [ ] 长档窗口期内出现结构变化 → 升级短档并尽快 flush。
- [ ] `userFills`/`orderUpdates` 触发不改变/不升级当前档位。
- [ ] 长档 flag 设为短档同值 → 行为与现状一致（回退可用）。
- [ ] 单测全绿（`node --test`）；分档结论与 sim4/sim5 实测（330→256 @12s、开平延迟中位 3s）方向一致。

## 验收场景

### 场景 1：开仓即时推（Happy Path）
- **Given** HYPE-watch 上次推送时持仓键集合为 `{ETH:SHORT, SOL:LONG}`，无离场单；当前 `clearinghouseState` 推来新增 `NEAR:LONG` 仓位（szi≠0），键集合变为含 `NEAR:LONG`
- **When** `recomputeStateFp` 处理该帧
- **Then** structural=true，`scheduleFetch` 走短档（3s/5s），≤5s 内 flush 推送

### 场景 2：滚仓合并
- **Given** 持仓键集合稳定为 `{SOL:LONG}`，一波亚秒~十几秒间隔的限价开仓单陆续成交（持仓 size 持续增大），其间键集合与离场单子集均不变
- **When** 这些 `clearinghouseState`/`openOrders` 帧持续触发 `scheduleFetch`
- **Then** 全程非 structural 走长档（12s/45s），推送数显著少于现状（实测同号 330→256），每次推当前真实累计持仓

### 场景 3：滚仓途中平仓 → 即时降档
- **Given** 正处于长档滚仓窗口、已等待约 10s（未到 45s 封顶），持仓键集合 `{SOL:LONG}`
- **When** 到达一帧使 SOL 仓位 szi=0（键集合移除 `SOL:LONG`）
- **Then** structural=true，窗口升级短档，因已等待 ≥ 短档 maxWait（5s）立即 flush 推送平仓

### 场景 4：userFills 频道不乱改档位
- **Given** 当前处于长档滚仓窗口（structural=false）
- **When** 收到 `userFills` 频道消息触发 `scheduleFetch(false)`
- **Then** 不升级短档、不重置档位，沿用当前长档窗口

### 场景 5：离场单挂单即时推
- **Given** 持仓键集合 `{SOL:LONG}` 稳定、size 不变；当前 `openOrders` 帧新增一个 `reduceOnly:true` 止盈单
- **When** `recomputeStateFp` 处理该帧
- **Then** 离场单子集指纹变化 → structural=true → 短档即时推
