# Spec 08 · 仓位状态持久化 + 启动 REST 兜底

> 引用总纲 `00-overview.md`。冲突以总纲为准。
> 依赖：sodex-watch / HYPE-watch（watcher.mjs）。

---

## 0. 问题流程图

```
时间轴 (UTC)               Hyperliquid                service/HYPE-watch          用户看到
═══════════════════════════════════════════════════════════════════════════════════════════

正常运行时
  0x267b 开仓              clearinghouseState
  xyz:BB SHORT -1969张 ──▶ assetPositions: [{szi:"-1969",...}]
                                  │
                                  ▼
                             watcher.positions = [xyz:BB SHORT -1969]
                             watcher.lastPositions = [xyz:BB SHORT -1969]
                                  │
                                  ▼
                             ✅ 仓位状态正确

15:55  ⚡ 服务重启          WS 重连 → subscribe
                                  │
                                  ▼
                             clearinghouseState 快照: []  ← HL WS 不完整！
                             this.positions = []          ← 基线错误
                             lastPositions = []            ← 内存丢失
                                  │
                                  ▼
                             fetchAndReport(isBaseline=true):
                               diffPositions([], []) = []
                               → START WATCH: "无持仓"     ❌ 漏报开仓

19:59  平仓成交              userFills WS →
  fill OID#1: 500@11.359
                                  │
                             fetchAndReport():
                               events = diffPositions([], []) = []
                               → 仓位始终为空，无法显示剩余仓位
                               → 跨帧检测: newOids→造CLOSE   ❌ 重复推送

20:33  fill OID#2-4 到达         │
20:34  fill OID#5 到达           │
                             (同上)                         ❌ 连续4条CLOSE
                                  │
                                  ▼
═══════════════════════════════════════════════════════════════════════════════════════════
总结: 服务重启 → lastPositions 丢失 + HL WS 快照不完整 → 基线错误 → 连锁反应
═══════════════════════════════════════════════════════════════════════════════════════════
```

---

## 1. 背景

### 1.1 触发场景

2026-07-03 15:55 服务强推重启。`0x267b` 地址在 Hyperliquid 上持有 `xyz:BB SHORT ~1969张`（05:34 开仓，19:59 平仓），但重启后 clearinghouseState WS 快照返回空数组。

### 1.2 根因

三层缺失：

| 层 | 问题 | 后果 |
|----|------|------|
| 状态持久化 | `lastPositions` 纯内存，重启清零 | 丢失仓位历史，无法 diff |
| 启动验证 | 完全信任 WS 首条快照，不做交叉验证 | 快照不完整时基线错误 |
| 跨帧 CLOSE | `buildEventMessages` 跨帧补丁无守卫 | fill 延迟到达时重复推送 |

### 1.3 证据

| 断言 | 依据 |
|------|------|
| clearinghouseState 返回空 | journalctl：15:55 START WATCH "无持仓"，16:41 "无实质仓位变化" |
| 仓位确实存在 | HL API：Open 20条(1969张) @ 05:34-05:58 / Close 13条(1969张) @ 19:59-20:34 |
| parsePositions 过滤 szi=0 | `parse.mjs:17` — `.filter(p => p && Number(p.szi) !== 0)` |
| 跨帧补丁无条件触发 | `watcher.mjs:328` — `!closedSummaries.length && newOids.size` |
| 去重被 OID 变化绕过 | `watcher.mjs:244` — `outFp` 含 `closedFp`（OID 列表），新 OID 改变指纹 |

---

## 2. 方案：三层防御

```
Layer 1: 持久化 lastPositions     ← 治本（重启不丢状态）
Layer 2: REST 兜底验证（启动时）    ← 纠正 WS 快照偏差 + 覆盖 downtime 变化
Layer 3: 跨帧 CLOSE 守卫           ← 运行时兜底
```

### 2.1 Layer 1：lastPositions 持久化

**写入**：每次 `fetchAndReport` 推送成功后，将 `this.lastPositions` 写盘。

**存储位置**：`service/<watch>/state/lastPositions-<normalized-address>.json`

```json
{
  "positions": [
    {"coin":"xyz:BB","dir":"SHORT","size":-1969,"entry":11.7}
  ],
  "updatedAt": 1782950000000
}
```

**读取**：构造函数中加载。文件缺失/解析失败 → `[]`（退化到当前行为）。

**共用工具**：`service/tool/lastPositionsStore.mjs` — `loadLastPositions(path)` / `saveLastPositions(path, positions)`。

### 2.2 Layer 2：启动 REST 兜底

**时机**：仅在 `isBaseline=true`（首帧 START WATCH）时执行一次。

**REST 端点**：
- HYPE-watch：`/info` `{type:"clearinghouseState", user:address}` — 与 WS 同格式，`parsePositions` 直接复用
- sodex-watch：已有 `fetchTargetState` 读仓位

**比对逻辑**（`fetchAndReport` 首帧）：

```
persisted = loadLastPositions(address)
rest      = parsePositions(REST.assetPositions)   // 权威数据源

events = diffPositions(persisted, rest)           // 覆盖 downtime 变化
this.positions = rest                             // 以 REST 为准
this.lastPositions = persisted                    // 用于 diff

if events 不为空:
  → 走正常事件推送（OPEN/CLOSE/INCREASE/DECREASE）
  → 说明 downtime 期间发生过仓位变化
```

**边界**：
- REST 调用失败 → 降级：`persisted` 作为 fallback，标注 "REST 不可用，状态可能过期"
- persisted 与 REST 一致 → 无事件，不推送
- 首帧之外不调 REST（避免额外请求）

### 2.3 Layer 3：跨帧 CLOSE 守卫

`buildEventMessages` 中跨帧补丁加条件：

```javascript
// 仅当受影响的 coin 在 prevPositions 中存在时才补 CLOSE
if (!closedSummaries.length && newOids.size) {
  const prevCoins = new Set(prevPositions.map(p => p.coin));
  const affected = [...new Set(
    histRecords.filter(r => newOids.has(r.oid)).map(r => r.coin)
  )];
  if (affected.some(c => prevCoins.includes(c))) {
    closedSummaries = affected.filter(c => prevCoins.includes(c)).map(coin => {
      const r = histRecords.find(x => x.coin === coin && newOids.has(x.oid));
      return { coin, dir: String(r?.dir ?? "").includes("Long") ? "LONG" : "SHORT" };
    });
  }
}
```

---

## 3. 改动范围

| 文件 | 改动 | 层 |
|------|------|:--:|
| `service/tool/lastPositionsStore.mjs` | **新建**：持久化读写工具函数 | 1 |
| `service/sodex-watch/process/watcher.mjs` | 读/写 lastPositions + 启动 REST 比对 + 跨帧守卫 | 1+2+3 |
| `service/HYPE-watch/process/watcher.mjs` | 同上（对称） | 1+2+3 |
| `service/HYPE-watch/api/index.mjs` | 新增 `fetchClearinghouseState(user)` REST 调用 | 2 |
| `service/sodex-watch/api/index.mjs` | 确认 `fetchTargetState` 可用于启动兜底 | 2 |
| `service/HYPE-watch/test/domain.test.mjs` | 新增持久化 + 跨帧守卫单测 | 1+3 |
| `service/sodex-watch/test/domain.test.mjs` | 同上 | 1+3 |

### 不变

- `parse.mjs` / `render.mjs` 签名不改
- WS 主循环照旧
- HYPE-copy 不受影响

---

## 4. 边界与守卫

| 场景 | 处理 |
|------|------|
| 持久化文件缺失/损坏 | 降级到 `[]`，行为与当前一致 |
| REST 调用失败 | 降级到 persisted，日志告警 |
| 同名文件并发写 | 单进程模型，无并发风险 |
| 空仓持久化 | 也写盘（覆盖旧文件），防止重启后读到过期仓位 |
| WS 运行中 clearinghouseState 不准 | Layer 3 兜底；不额外调 REST（避免性能影响） |
| sodex-watch REST 端点不可用 | 降级到 WS 快照 |

---

## 5. 验收标准

- [ ] 服务重启后 `lastPositions` 从磁盘恢复，不丢失仓位历史
- [ ] 启动时调 REST 交叉验证，downtime 仓位变化被正确检测
- [ ] 跨帧 CLOSE 不重复推送（受影响 coin 不在 prevPositions → 跳过）
- [ ] 持久化文件缺失/损坏 → 退化到当前行为（不崩溃）
- [ ] REST 调用失败 → 降级不阻塞启动
- [ ] 纯函数单测全绿
- [ ] sodex-watch / HYPE-watch 两端对称

---

## 6. 落地阶段

| Phase | 内容 | 依赖 |
|-------|------|------|
| A | `lastPositionsStore.mjs` 工具函数 + 单测 | — |
| B | HYPE-watch `api/index.mjs` 加 `fetchClearinghouseState` | — |
| C | HYPE-watch `watcher.mjs` 三层改动（持久化 + REST 兜底 + 跨帧守卫） | A, B |
| D | sodex-watch `watcher.mjs` 对称改动 | A |
| E | 单测 + 部署验证 | C, D |

---

## 7. 依赖拓扑

```
lastPositionsStore (A) ─┬─ HYPE-watch watcher (C) ─┐
                        │                          ├─ 单测 (E)
fetchClearinghouse (B) ─┘   sodex-watch watcher (D) ┘
```
