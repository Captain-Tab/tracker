# HYPE-copy 核心流程（事件驱动：watch 检测 → 信号 → copy 执行）

> 目标动作 → 我方镜像完成的完整链路与节点拆解。
> 完整落地方案（信号契约 / 延迟 / P0-P3 子计划 / 验收）见 spec：`.claude/kit/spec/2026-06-29-hype-copy-event-driven.md`。
> **⚠️ 2026-07-04（Part A 完成）**：主循环已切 **v3 预算模型**——`reconcile.planBudgetReconcile`（每币预算 + 生存杠杆 + 逐仓防守）取代旧 `computeRatio/computeDesired`；`decideLeg` 四分支；启动基线快照只跟部署后新开仓。下方框图 N5 的 ratio 步骤为旧描述，实际见文末 N5 文字说明。

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
│ N3 ★信号注入点★ 优先 WS-change 点（stateFp 一变即发，**TG 推送之前**）│
│      → 原子写 脏标信号文件 {seq, ts, address}（不带快照）       │
│      → watch 随后继续自己的 render + TG 推送（与 copy 并行）    │
└────────────────────────────┬───────────────────────────────┘
              信号文件 = 跨进程边界（tracker 写 / trader-exec 读）
                             │
┌─ copy 进程（trader-exec 用户，持 agent key，dry-run 不签）─────┐
│ N4  fs.watchFile(~1s) mtime 变即触发 → ts 去重 → single-flight │
│      （跑中则置 pending，结束补跑一次取最新态 = coalesce）       │
│ N5  reconcileOnce（对账，幂等）：                              │
│      t0─ 并行拉 [fetchTargetState(sodex) ∥ fetchHypePrices(hype) ∥ assetIndex(缓存)] ─t1 │
│        → mapSymbol(sodex→hype + hype universe 校验) 过滤可映射  │
│        → computeRatio(锚定) → computeDesired(保证金等比换算)    │
│        → planReconcile(desired, current=lastWouldHold)         │
│        → diffDelta → decideLeg 四分支校验门                    │
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
- **做什么**：`fs.watchFile`(~1s) **mtime 变即触发**（非 `seq>lastSeq`，否则 watch 重启 seq 归零会漏信号）→ `ts` 去重 → **single-flight**（同时只一个 reconcile，跑中置 pending、结束补跑一次取最新态 = coalesce）
- **数据源**：信号文件（`{seq, ts, address}`，seq/ts 仅去重+缺口检测，非触发 gate）
- **延迟**：~1s（轮询；可调 0.5s / `fs.watch` 事件近 0）
- **要点**：single-flight 防信号与 180s 兜底**并发**改 `myPosByCoin` / 双记录 /（实盘）双下单

### N5 · reconcileOnce（对账，幂等）

- **属主**：copy（`process/*`）
- **做什么**：
  - `t0` → 并行拉 `fetchTargetState(sodex)` ∥ `fetchHypePrices(hype)` ∥ `buildHypeAssetIndex(缓存)` → `t1`
  - `mapSymbol`（sodex→hype + hype universe 校验）过滤可映射
  - `planBudgetReconcile`（v3 编排）：baseline 过滤 → 逐币分派（新开 `selectLeverage`+`planOpen` / 反手先平 / 同向 `planFollow`+`planDefend` / 目标消失平仓）→ `decideLeg` 四分支单点 gate → 产 actions/stateUpdates/alerts
  - 执行：新开先 `buildWouldUpdateLeverage`（生存杠杆）再 `placeDryRun`（IOC would-place）；防守走 `buildWouldUpdateMargin`；均不签名 → `t2`
  - `applyStateUpdate` 落 `myPosByCoin` + `copyStateStore` 持久化（跨重启）
- **数据源**：sodex REST（目标仓）+ hype REST（价格）+ 缓存（assetIndex）
- **延迟**：拉取 0.3–1s+（并行，经 WARP）+ 计算 ~10ms
- **要点**：对账 = 对齐目标完整净仓（非复制单动作），自愈断线/重启/部分成交/漏单

### N6 · notify

- **属主**：copy（`notify/*`）
- **做什么**：
  - 每动作 `recordAction`（JSONL + journald，含 `fullMs=t2-t0` / `execMs=t2-t1`）
  - 事件分类 开/加/减/平 + 去重 → `pushRoundSummary` 一条 TG 汇总
  - 应用 `stateUpdates` 到 `myPosByCoin` + `copyStateStore` 落盘 / 更新 `lastAlertFp`
- **数据源**：本轮动作结果
- **延迟**：JSONL 同步写 ~ms；TG 推送是出口（不在 would-place 关键路径）

---

## 兜底地板（copy 常驻并行）

- **做什么**：每 180s 无条件 `reconcileOnce` 一次
- **作用**：信号全丢也能在 180s 内对账补齐——对账是**全量状态收敛**，漏信号 ≠ 漏仓位
- **要点**：copy 对信号**零硬依赖**，最坏退回轮询，不会比现在更差（fail-safe）

---

## 开启事件驱动（默认开，零配置）

**"信号目录是否存在" = 事件驱动开关**——`setup-copy.sh` 建了目录 → watch/copy **自动启用**，无需任何 flag：

1. 填 `HYPE-copy/targets.json`（唯一手填）→ `sudo bash setup/setup-copy.sh`（建信号目录等一条龙）。
2. 重启 watch（`systemctl restart {sodex,HYPE}-watch`）→ 它检测到信号目录存在，自动向 `<dir>/<address 小写>.json` 写信号。

**copy 零配置**：按 `<DEFAULT_SIGNAL_DIR>/<source.address 小写>.json` 派生订阅（与 watch 同一常量、同一小写口径，**自动对齐**）。

- 默认逻辑（config.mjs）：自定义 `copySignalDir` > 显式 `copySignal`(true/false) > **默认：目录存在则开，否则不发**（纯监听部署零影响、diff=0）。
- 关掉：watch config `"copySignal": false` → 退 180s 轮询兜底。
- 信号 `{seq,ts,address}` 非敏感 → 0755 即可，省共享组。

## 两条路径分工

| 路径 | 角色 | 频率 | 职责 |
|---|---|---|---|
| 信号快路（N3→N4） | 加速器 | 目标一动即触发 | 延迟从 60s 压到秒级 |
| REST 兜底（180s） | 地板 | 固定 180s | 信号链坏掉时不漏不停 |
