# Spec · HYPE-copy 事件驱动（watch 检测 → 信号 → copy 执行）

> 把 copy 的触发模型从"纯轮询"改为"watch 检测到目标变化 → 发信号 → copy 执行对账"，REST 周期降为兜底。
> 由 go-live §〇 抽出独立成 spec 专门执行。dry-run 阶段；不含真实下单/签名。

---

## 背景与目的

当前 `service/HYPE-copy/main.mjs` 是纯 60s REST 轮询（空转查接口 + 最多 60s 延迟），与"目标不动我们不动"不符。本档改为事件驱动：复用**已在跑**的 `sodex-watch`/`HYPE-watch`（它们已 WS 订阅目标），让 watch 检测到变化时发一个轻量信号触发 copy 对账，把延迟从 60s 压到秒级，且目标不动时 copy 不空转。

## 选定方案

**watch 加"变化信号"输出 + copy 订阅触发，REST 180s 兜底。**

**核心原则（铁律，避免造第二个 watcher）**：
1. **不新建 watch / 不开第二条 WS**：复用已跑的 watcher；copy 不跑第二份 watcher 逻辑。
2. **watch 先、copy 后（串行）**：watch 检测完变化 → 发信号 → copy 是下游消费者，不自己监听。
3. **信号是脏标，不带快照**：watch 只发 `{seq, ts, address}`；copy 收到走自己的 `fetchTargetState`（单一数据路径，不耦合 watch 的 WS 格式）。
4. **对账仍必要**：信号定"何时动"，对账定"怎么动"——对齐目标完整净仓，自愈断线/重启/部分成交/漏单。

（否决：copy 自持 WS = 重复造 watcher + 双 WS 连接；信号带快照 = WS↔REST 格式耦合 + 双数据路径。）

## 设计概要

### 核心流程（端到端节点：目标动作 → 我方镜像完成）

```
[交易所] N0 目标在 sodex/hype 真实开/平/加/减仓
   │ (WS 物理传播)
   ▼
┌─ watch 进程（tracker 用户，只读，已在跑）──────────────────┐
│ N1  WS(accountState) 推送 → 更新 this.positions（内存，免 REST）│
│ N2  指纹去重确认"真变化"(stateFp) + 分档防抖（结构变化即时/滚仓合并）│
│ N3 ★信号注入点★ 变化确认那刻（TG 推送之前；优先 WS-change 点，见下）│
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
│ N6  notify：每动作 recordAction(JSONL+journald,含 fullMs/execMs)│
│      → 事件分类 开/加/减/平 + 去重 → pushRoundSummary 一条汇总  │
│      → 更新 lastWouldHold / lastAlertFp / wasFollowing         │
└──────────────────────────────────────────────────────────────┘

兜底地板（copy 常驻并行）：每 180s 无条件 reconcileOnce → 信号全丢也 180s 内对账补齐
```

### 信号注入点（延迟关键）

- **优先发在 WS-change 点**（`handleMessage` 里 `stateFp` 一变即发）——此刻 `this.positions` 已被 WS 更新，**不必等分档防抖、不必等 watch 自己那次 REST**。滚仓 burst 时 copy 多次唤醒由 coalesce + 对账幂等 + noop 吸收。
- 次选 `fetchAndReport` 确认点（防抖后）——少唤醒但 +防抖(滚仓可达数秒)+watch REST 延迟。
- 两者都在 **watch TG 推送之前**，避免 TG 网络往返(≤8s)阻塞 copy。

### 端到端延迟估算 [推理]（含接口请求，已修正）

| 段 | 估计 | 说明 |
|---|---|---|
| N0→N1 WS 传播 | 50–300ms | 交易所→watch，经 WARP |
| N1→N3 发信号 | ~0（WS-change 点）| 不等防抖/watch REST |
| N3→N4 信号检测 | ~1s（轮询；可调 0.5s / fs.watch 事件近 0） | 主导项之一 |
| N4→N5 **copy 拉接口** | **0.3–1s+** | **不可省**：sizing 必须 hype 实时价；sodex∥hype 并行经 WARP，慢网更高 |
| N5 处理+构造 | ~10ms | 纯计算（execMs） |

> **修正**：之前 1–2s 偏乐观。copy 的接口请求（至少 hype 价格，sizing 必需、**不可省**）经 WARP **实测可能 0.3–1s+**，且与 1s 轮询叠加。
> **现实估算 ~2–3s 典型**，慢网/WARP 抖动可达 3s+。只有计算段(~10ms)可忽略，其余 WS+轮询+接口三段网络耗时累加是大头。
> 对比当前 60s 轮询，仍是 **20–30 倍**提升；持仓型跟单（非 HFT，永远跑在目标后）2–3s 完全可接受。接口请求是 reconcile 固有成本（兜底路径同样要拉），不因事件驱动而消除。

### 跨进程信号机制

- 传输：watch **原子写**（tmp+rename）`signal/<target>.json`，copy `fs.watchFile`（轮询 stat，对 rename 免疫；非 `fs.watch` 盯 inode 会被换掉失效）。零依赖、跨重启存活。
- `fs.watchFile` 每秒一次 `fs.stat`（微秒级），资源可忽略（远低于 REST 轮询）。
- 隔离：watch=tracker 写 / copy=trader-exec 读，目录组权限，两进程不混。

### 映射自动化（正交）

`mapSymbol`（sodex→hype）在 copy 侧拿到原始仓位**之后**翻译。"不定期更新映射"用 hype 实时 universe 校验：`buildHypeAssetIndex` 已每 6h 拉 meta，coin 不在 universe = 不可映射，随上下架自动跟，零手维护（阶段1 留的口子）。

## 边界与约束

**包含**：watch 加变化信号输出（加法+开关，不动检测主体）；信号契约（seq/ts/address 编解码 + 原子写 + fs.watchFile reader）；copy 订阅触发 + 180s 兜底 + coalesce；mapSymbol hype universe 校验。
**不包含**：真实下单/签名/agent key；每日镜像；多目标；把 fullMs 起点前移到信号到达（事件驱动后可选增强）。
**已知限制**：延迟下限受 copy 必拉的 hype 价格接口约束（~2–3s 典型），非纯计算；信号注入点取 WS-change 时滚仓 burst 会多唤醒（coalesce 吸收）。

## 集成点（落地子计划 4 阶段，每阶段 实现→测试→/k:check→commit）

| 阶段 | 改动 | 代码触点 | 风险 |
|---|---|---|---|
| P0 信号契约 | seq/ts/address 编解码（纯函数）+ 原子写 + `fs.watchFile` reader | 新建 `service/lib/copy-signal/` | 低 |
| P3 映射自动化 | mapSymbol 接 hype universe 校验（与 watch 无关，先做降风险） | `service/HYPE-copy/process/mapping.mjs` + `api/index.mjs`（buildHypeAssetIndex） | 低 |
| P1 watch 发信号 | WS-change 点 emit 脏标；**加法+配置开关**，不动检测主体；sodex+hype 对称 | `sodex-watch/process/watcher.mjs`、`HYPE-watch/process/watcher.mjs` | **中**（动 live 服务，需回归：watch TG 输出 diff=0） |
| P2 copy 订阅触发 | 轮询主触发 → 订阅信号触发；REST 降 180s 兜底；coalesce | `service/HYPE-copy/main.mjs` | 低 |

> 推荐顺序 **P0 → P3 → P1 → P2**。工作量约半天~1 天人力当量（~4 次提交），P1 回归是主要耗时。
> 复用：`process/reconcile.mjs`（零改）、`process/precision.mjs`、`lib/WARP`。

## 验收标准

- [ ] watch 在变化确认点（TG 推送之前）原子写脏标信号 `{seq,ts,address}`，不带快照；信号是加法、配置可关。
- [ ] watch TG 推送内容/频率在加 emit 前后 **diff=0**（回归）。
- [ ] copy 用 `fs.watchFile` 订阅信号，`seq>lastSeq` 才触发；正在跑则 coalesce 补跑一次。
- [ ] copy 收信号 → 走自己 `fetchTargetState` 对账（与兜底同一数据路径），不吃 watch 快照。
- [ ] REST 180s 兜底常驻：信号全丢仍能 180s 内对账补齐（混沌测：删信号/杀 watch/写半截 → copy 仍收敛）。
- [ ] `fs.watchFile` 对原子 rename 免疫（rename 覆盖后仍触发）。
- [ ] mapSymbol 接 hype universe：coin 不在当前 universe → 不可映射。
- [ ] 进程隔离：watch=tracker 写、copy=trader-exec 读，权限正确。
- [ ] `reconcile.mjs`/`diffDelta` 零改。
- [ ] 纯函数单测（信号编解码 / seq 去重 / coalesce / universe 校验）全绿；`/k:check` 三闸门过。

## 验收场景

### 场景 1：信号快路（目标动 → copy 秒级对账）
- **Given** watch 已跑、订阅目标；copy 订阅信号 + 180s 兜底；目标新开一仓
- **When** watch WS 收到变化 → WS-change 点写脏标信号（seq+1）
- **Then** copy `fs.watchFile` 在 ~1s 内发现 → seq 递增 → 触发 reconcileOnce（自拉 sodex+hype）→ would-place；端到端 ~2–3s（含接口）；watch TG 照常推（并行，不阻塞 copy）

### 场景 2：兜底不漏（信号全丢仍收敛）
- **Given** 信号通道故障（文件删除 / watch 未发 / copy 漏接）；目标在此期间加仓
- **When** copy 的 180s 兜底 tick 触发
- **Then** copy 照常 reconcileOnce 对齐目标完整净仓，把加仓补齐；不依赖信号、不漏仓位（对账=全量收敛）

### 场景 3：rename 不丢信号
- **Given** watch 用 tmp+rename 原子覆盖信号文件；copy 用 `fs.watchFile`
- **When** 连续多次原子写
- **Then** copy 每次 stat 到新 mtime/ino → 触发；不出现 `fs.watch` 盯 inode 被 rename 换掉而停触发的情况

### 场景 4：滚仓 burst 不刷爆 copy
- **Given** 信号发在 WS-change 点；目标短时间内 100→150→120→200 多跳
- **When** copy 连收多个信号
- **Then** coalesce 合并（跑中置 pending，结束补跑一次）→ 最终一轮对账对齐到 200；中间态不产生独立 would-place（对账幂等 + noop 吸收）
