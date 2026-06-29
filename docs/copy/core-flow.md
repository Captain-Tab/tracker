# HYPE-copy 核心流程（事件驱动：watch 检测 → 信号 → copy 执行）

> 目标动作 → 我方镜像完成的完整链路与节点拆解。
> 完整落地方案（信号契约 / 延迟 / P0-P3 子计划 / 验收）见 spec：`.claude/kit/spec/2026-06-29-hype-copy-event-driven.md`。

---

## 总览

```
[交易所] N0 目标在 sodex/hype 真实开/平/加/减仓
   │ (WS 物理传播)
   ▼
┌─ watch 进程（tracker 用户，只读，已在跑）──────────────────┐
│ N1  WS(accountState) 推送 → 更新 this.positions（内存，免 REST）│
│ N2  指纹去重确认"真变化"(stateFp/outFp) + 分档防抖             │
│      （结构变化=开/平/反手 走短档即时；滚仓 走长档合并）        │
│ N3 ★信号注入点★ 变化确认那刻（outFp 通过、**TG 推送之前**）    │
│      → 原子写 脏标信号文件 {seq, ts, address}（不带快照）       │
│      → watch 随后继续自己的 render + TG 推送（与 copy 并行）    │
└────────────────────────────┬───────────────────────────────┘
              信号文件 = 跨进程边界（tracker 写 / trader-exec 读）
                             │
┌─ copy 进程（trader-exec 用户，持 agent key，dry-run 不签）─────┐
│ N4  fs.watchFile 轮询(~1s,可调) 发现 mtime 变 → 读 → seq>lastSeq 才触发 │
│      （正在跑则置 pending，结束补跑一次 = coalesce 合并）        │
│ N5  reconcileOnce（对账，幂等）：                              │
│      t0─ 并行拉 [fetchTargetState(sodex) ∥ fetchHypePrices(hype) ∥ assetIndex(缓存)] ─t1 │
│        → mapSymbol(sodex→hype + hype universe 校验) 过滤可映射  │
│        → computeRatio(锚定) → computeDesired(保证金等比换算)    │
│        → planReconcile(desired, current=lastWouldHold)         │
│        → diffDelta → decideLeg 六分支校验门                    │
│        → placeDryRun(IOC would-place，不签名) ─t2             │
│ N6  notify：                                                  │
│      → 每动作 recordAction（JSONL+journald，含 fullMs/execMs） │
│      → 事件分类 开/加/减/平 + 去重 → pushRoundSummary 一条汇总  │
│      → 更新 lastWouldHold / lastAlertFp / wasFollowing         │
└──────────────────────────────────────────────────────────────┘

兜底地板（copy 常驻并行）：每 180s 无条件 reconcileOnce 一次
   → 信号全丢也能在 180s 内对账补齐（对账=全量收敛，不漏仓位）
```

---

## N0 · 目标动作（交易所）

- **属主**：交易所（sodex / hype）撮合
- **做什么**：被跟目标真实开 / 平 / 加 / 减仓
- **数据源**：—
- **延迟**：—（起点）

---

## watch 段（tracker 用户，只读，已在跑）

### N1 · WS 接收，更新内存仓位

- **属主**：watch（`AccountWatcher`）
- **做什么**：WS `accountState` 推送到达 → 更新 `this.positions`（内存）
- **数据源**：WebSocket（**非 REST**，免一次请求）
- **延迟**：WS 物理传播 50–300ms（经 WARP）

### N2 · 去重确认 + 分档防抖

- **属主**：watch
- **做什么**：指纹（`stateFp`/`outFp`）去重确认"真变化"；分档防抖——结构变化（开/平/反手）走短档即时，滚仓走长档合并
- **数据源**：内存指纹
- **延迟**：短档亚秒~1-2s / 滚仓合并可达数秒（**信号若发在此点之后，这段会上路径**）

### N3 · ★信号注入点★

- **属主**：watch
- **做什么**：变化确认那刻（**TG 推送之前**）原子写脏标信号文件 `{seq, ts, address}`（**不带快照**）；watch 随后继续 render + TG 推送，与 copy 并行
- **数据源**：内存 `this.positions`（已由 N1 更新）
- **延迟**：~0（优先发在 WS-change 点，不等防抖 / watch 自身 REST）
- **要点**：信号是脏标不带快照——copy 走自己数据路径，不耦合 watch 的 WS 格式

---

## 跨进程边界 · 信号文件

- **机制**：原子写（tmp + rename）`signal/<target>.json`；copy 用 `fs.watchFile`（轮询 stat，对 rename 免疫）
- **隔离**：watch=`tracker` 写 / copy=`trader-exec` 读，目录组权限，两进程不混
- **资源**：`fs.watchFile` 每秒一次 `fs.stat`（微秒级，可忽略）

---

## copy 段（trader-exec 用户，持 agent key，dry-run 不签）

### N4 · 信号订阅触发

- **属主**：copy（`main.mjs`）
- **做什么**：`fs.watchFile` 轮询(~1s,可调) 发现 mtime 变 → 读 → `seq>lastSeq` 才触发；正在跑则置 pending，结束补跑一次（**coalesce 合并**）
- **数据源**：信号文件
- **延迟**：~1s（轮询；可调 0.5s / `fs.watch` 事件近 0）

### N5 · reconcileOnce（对账，幂等）

- **属主**：copy（`process/*`）
- **做什么**：
  - `t0` → 并行拉 `fetchTargetState(sodex)` ∥ `fetchHypePrices(hype)` ∥ `buildHypeAssetIndex(缓存)` → `t1`
  - `mapSymbol`（sodex→hype + hype universe 校验）过滤可映射
  - `computeRatio`（锚定）→ `computeDesired`（保证金等比换算）
  - `planReconcile(desired, current=lastWouldHold)` → `diffDelta` → `decideLeg` 六分支校验门
  - `placeDryRun`（IOC would-place，不签名）→ `t2`
- **数据源**：sodex REST（目标仓）+ hype REST（价格）+ 缓存（assetIndex）
- **延迟**：拉取 0.3–1s+（并行，经 WARP）+ 计算 ~10ms
- **要点**：对账 = 对齐目标完整净仓（非复制单动作），自愈断线/重启/部分成交/漏单

### N6 · notify

- **属主**：copy（`notify/*`）
- **做什么**：
  - 每动作 `recordAction`（JSONL + journald，含 `fullMs=t2-t0` / `execMs=t2-t1`）
  - 事件分类 开/加/减/平 + 去重 → `pushRoundSummary` 一条 TG 汇总
  - 更新 `lastWouldHold` / `lastAlertFp` / `wasFollowing`
- **数据源**：本轮动作结果
- **延迟**：JSONL 同步写 ~ms；TG 推送是出口（不在 would-place 关键路径）

---

## 兜底地板（copy 常驻并行）

- **做什么**：每 180s 无条件 `reconcileOnce` 一次
- **作用**：信号全丢也能在 180s 内对账补齐——对账是**全量状态收敛**，漏信号 ≠ 漏仓位
- **要点**：copy 对信号**零硬依赖**，最坏退回轮询，不会比现在更差（fail-safe）

---

## 两条路径分工

| 路径 | 角色 | 频率 | 职责 |
|---|---|---|---|
| 信号快路（N3→N4） | 加速器 | 目标一动即触发 | 延迟从 60s 压到秒级 |
| REST 兜底（180s） | 地板 | 固定 180s | 信号链坏掉时不漏不停 |
