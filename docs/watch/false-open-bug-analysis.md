# sodex-watch 误报 OPEN 事件 — 根因分析（修订版）

> 2026-07-09 基于 MW (`0xbe...1c8a`) 和 USTECH100赚 (`0x8d...7480`) 两个实际案例。
> 已考虑 `d4c03e8` 和 `b095fed` 两个修复 commit 的改动。

---

## 零、已有修复回顾

`d4c03e8` `b095fed` 做了以下修复，但它们没有解决根因：

| 修复 | 效果 |
|------|------|
| `onclose` 重置 `baselineLogged = false` | ✅ WS 重连后 REST 兜底能运行 |
| REST 兜底条件拆分（有数据才覆盖 positions） | ✅ REST 返回空时不再误覆盖 |
| `fetchPositionHistory` → `fetchAccountState` | ✅ 数据源从"平仓历史"改为"当前持仓" |
| `forceReport`/`tgReason` 移除，daily 独立化 | ✅ daily snapshot 不再耦合 WS 状态 |
| `prevCoins.includes()` → `prevCoins.has()` | ✅ Set API bug 修复 |

**未修复的根因（见下文 A/B/C）**：REST 格式与 WS 格式不兼容、stateFp 锁死、saveLastPositions 写盘损坏。

---

## 一、当前代码中的三个 Bug

### Bug A：`restCurr` 格式与 `diffPositions` 不兼容

`watcher.mjs:275-280` — REST 兜底生成 `restCurr`：

```javascript
const restCurr = restPositions.map((p) => ({
    coin: baseCoin(String(p.s ?? "")),       // ← 只有 coin，没有 symbol
    dir: Number(p.sz) > 0 ? "LONG" : "SHORT", // ← 只有 dir，没有 posSide
    size: Math.abs(Number(p.sz)),             // ← 取了绝对值
    entry: Number(p.ep),
}));
```

但 `diffPositions` (`parse.mjs:142`) 用 `baseCoin(p.symbol)` + `positionDirection(p)` 做 key：

```javascript
const key = (p) => `${baseCoin(p.symbol)}:${positionDirection(p)}`;
```

`positionDirection` (`parse.mjs:73-76`)：

```javascript
export function positionDirection(p) {
    if (p.posSide === "LONG" || p.posSide === "SHORT") return p.posSide;
    return Number(p.size) < 0 ? "SHORT" : "LONG";  // ← 回退逻辑
}
```

**对 REST 格式对象的影响：**

| REST 字段 | 实际值 | `diffPositions` 读取 | 结果 |
|-----------|--------|---------------------|------|
| `symbol` | **undefined** | `baseCoin(undefined)` | `"undefined"` |
| `posSide` | **undefined** | 走回退 `Number(size) < 0` | 永远 `"LONG"`（size 是 `Math.abs`，≥0） |

**所有 REST 仓位的 key 坍缩为 `"undefined:LONG"`**，Map 中多个仓位互相覆盖。

### Bug B：`stateFp` 指纹锁死，阻止自我修复

`handleMessage` (line 182-186) 和 REST 兜底 (line 269-292) 的执行顺序：

```
① handleMessage:
   this.positions = parseWsPosition(data.P)    // ← WS 格式
   stateFp = canonicalPositionsFp(WS格式)       // ← 指纹锁定为 WS 格式
   scheduleFetch(true)

② fetchAndReport → REST 兜底:
   this.positions = restCurr                    // ← 覆盖为 REST 格式！

③ 下一次同内容 WS 推送:
   this.positions = parseWsPosition(data.P)    // ← WS 格式
   fp = canonicalPositionsFp(WS格式)
   fp === stateFp  → 跳过 scheduleFetch()       // ← 指纹锁死！
   lastPositions 永远停在 REST 格式
```

**只有仓位真正变化时才会触发 fetch**，此时 `diffPositions(REST格式, WS格式)` 就产生虚假事件。

### Bug C：`saveLastPositions` 正常路径写盘 `coin:"undefined"`

`watcher.mjs:352-353` — 正常 `fetchAndReport` 推送成功后：

```javascript
this.lastPositions = this.positions;  // line 307, WS 格式
// ...
saveLastPositions(this.stateDir, this.address, this.lastPositions);
```

`saveLastPositions` (`lastPositionsStore.mjs:35-36`) 提取：

```javascript
coin: String(p.coin),   // WS 格式没有 coin  → "undefined"
dir: String(p.dir),     // WS 格式没有 dir   → "undefined"
```

**证据**：VPS 上 4/5 个地址的持久化文件都是 `coin: "undefined"`：

```
state/lastPositions-05847...7027.json  coin:"undefined" x3
state/lastPositions-08d56...7480.json  coin:"undefined" x1
state/lastPositions-0bead...1c8a.json  coin:"undefined" x1   ← MW
state/lastPositions-0f936...8EC0.json  coin:"undefined" x1
```

只有一个文件正确（`0267b...2566` `coin:"US500"`）——因为它是 `dailySnapshot` 路径保存的，那条路径格式正确。

---

## 二、完整触发链路（当前代码，以 MW 为例）

```
┌─────────────────────────────────────────────────────────────────┐
│ 运营中：baselineLogged=true                                     │
│ positions = lastPositions = WS格式 [MSTR LONG, CL SHORT]        │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ ① WS 断连 → onclose: baselineLogged = false                     │
│    (d4c03e8 修复 ✅)                                             │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ ② WS 重连 → accountState 到达                                   │
│                                                                 │
│   handleMessage:                                                 │
│     this.positions = parseWsPosition()  ← WS格式                 │
│     stateFp = "MSTR-USD:LONG:...,CL-USD:SHORT:..." ← 指纹锁定   │
│     scheduleFetch(true)                                          │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ ③ fetchAndReport (isBaseline=true)                              │
│                                                                 │
│   REST 兜底 (fetchAccountState):                                 │
│     restCurr = [                                                 │
│       {coin:"MSTR", dir:"LONG",  size:11.119},    ← Bug A!      │
│       {coin:"CL",   dir:"SHORT", size:574.658},   ← Bug A!      │
│     ]                                                            │
│     this.positions = restCurr          ← 覆盖为 REST 格式        │
│     this.lastPositions = persisted      ← 或 restCurr            │
│                                                                 │
│   baselineLogged = true                                          │
│   kind = "START" → 全景消息，不拆事件（TG 跳过，已知地址）        │
│                                                                 │
│   ⚠️ stateFp 仍是 WS 格式指纹，无人重置                          │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ ④ 指纹锁死 (Bug B)                                               │
│                                                                 │
│   下一个 accountState (仓位未变: MSTR+CL):                        │
│     this.positions = parseWsPosition()  ← WS格式                 │
│     fp = canonicalPositionsFp(WS)                                 │
│     fp === stateFp → ❌ 跳过 scheduleFetch()                     │
│                                                                 │
│   持续 8 小时，lastPositions 永远停在 REST 格式                   │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ ⑤ CL SHORT 平仓 → accountState 变为 [MSTR LONG only]            │
│                                                                 │
│   handleMessage:                                                 │
│     fp 改变 → scheduleFetch(true)                                │
│                                                                 │
│   fetchAndReport (isBaseline=false):                             │
│                                                                 │
│     diffPositions(lastPositions_REST, positions_WS):             │
│                                                                 │
│       lastPositions (REST格式):                                  │
│         MSTR: key = "undefined:LONG"  ← Bug A                   │
│         CL:   key = "undefined:LONG"  ← 坍缩，覆盖 MSTR         │
│                                                                 │
│       positions (WS格式):                                        │
│         MSTR: key = "MSTR:LONG"                                  │
│                                                                 │
│       diff:                                                      │
│         "MSTR:LONG" not in lastPositions → OPENED LONG MSTR 🔴  │
│         "undefined:LONG" not in positions → 垃圾 CLOSED 事件     │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ ⑥ TG 推送                                                        │
│                                                                 │
│   buildEventMessages:                                            │
│     events中有 "OPENED" → 🟢 OPEN POSITION 开仓 MSTR            │
│     newPosIds中有 CL 平仓 → 🔴 CLOSE POSITION 平仓 CL SHORT     │
│                                                                 │
│   saveLastPositions:                                             │
│     this.lastPositions = WS格式 (line 307)                       │
│     → 提取 coin:"undefined", dir:"undefined"  ← Bug C           │
│     → 写盘损坏                                                   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 三、两个实际案例

| | MW (`0xbe...1c8a`) | USTECH100赚 (`0x8d...7480`) |
|---|---|---|
| **REST 兜底** | 07/08 06:05 UTC | 07/09 01:09 UTC |
| **兜底时仓位** | MSTR LONG + CL SHORT | US500 SHORT + LIT SHORT |
| **console 显示** | `undefined 0x LONG` x2 | `undefined 0x LONG` x2 |
| **误报** | 07/08 14:39 UTC 🟢 OPEN MSTR LONG | 07/09 01:12 UTC 🟢 OPEN US500 SHORT |
| **实际变化** | CL SHORT 平仓 | LIT SHORT 平仓 |
| **静默时长** | 8h34m | 3m |
| **持久化文件** | `coin:"undefined"` `size:11.119` | `coin:"undefined"` `size:-32.5` |

---

## 四、修复方向

| Bug | 位置 | 修复思路 |
|-----|------|---------|
| **A** | `watcher.mjs:275-280` | `restCurr` 输出 WS 兼容格式：加 `symbol` (从 `s` 保留或拼 `coin-USD`)、加 `posSide`、`size` 保留原始带符号值 |
| **B** | `watcher.mjs:183` + `watcher.mjs:282` | REST 兜底覆盖 `this.positions` 后同步更新 `this.stateFp`，或不做覆盖而是仅更新 `lastPositions` |
| **C** | `watcher.mjs:352-353` or `lastPositionsStore.mjs:35-36` | `saveLastPositions` 从 `baseCoin(p.symbol)` 和 `positionDirection(p)` 推导 `coin`/`dir`，兼容 WS 格式 |
