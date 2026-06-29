# hype 跟单：dry-run → 实盘 待办清单（go-live checklist）

> 一期落地止于 **dry-run**（不签名、不发真实订单）。本文记录从 dry-run 切到真实下单**还差什么**，每项带代码触点，便于后续逐项 gated 推进。
> 总纲后续阶段见 `.claude/kit/spec/auto-copy-trade/00-overview.md §8`；实现细节见 [`hype.md`](./hype.md)。

---

## 〇、🔝 最优先：watch 检测 → 信号 → copy 执行（事件驱动）

> **优先级高于本文其余所有项**，是本档的**核心流程**。当前 `main.mjs` 是纯轮询（空转查接口 + 延迟），与"目标不动我们不动"不符。本节为收敛后的最终落地蓝图。

### 核心流程（端到端节点：目标动作 → 我方镜像完成）

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

### 两条路径分工（fail-safe 结构）

| 路径 | 角色 | 频率 | 职责 |
|---|---|---|---|
| 信号快路（N3→N4） | 加速器 | 目标一动即触发 | 延迟从 60s 压到 ~1s |
| REST 兜底（180s） | 地板 | 固定 180s | 信号链坏掉时不漏不停 |

> copy 对信号**零硬依赖**——最坏退回轮询，不会比现在更差。

### 关键设计决策（收敛后铁律）

| 点 | 决定 | 理由 |
|---|---|---|
| 不新建 watch | 复用已跑的 `sodex-watch`/`HYPE-watch` | 已订阅 WS，copy 不开第二条、不跑第二份 watcher |
| watch 先 copy 后 | watch 检测完 → 发信号 → copy 才执行 | copy 是下游消费者，不自己监听 |
| 信号时点 | 变化确认后、**TG 推送之前** | 省掉 watch TG 网络往返(≤8s)对 copy 的阻塞 |
| 信号内容 | **脏标** {seq,ts,address}，**不带快照** | 单一数据路径 + 不耦合 watch 的 WS 格式（WS 与 REST 字段不同源、WS 无 marginUsed） |
| copy 自拉数据 | 走自己 `fetchTargetState`（REST） | 与**必拉的 hype 价格并行**(Promise.all)，几乎不加串行延迟；且信号触发与兜底触发**同一条数据路径** |
| 传输 | 原子写文件(tmp+rename) + **`fs.watchFile` 轮询** | 零依赖、对 rename 免疫（`fs.watch` 盯 inode 会被 rename 换掉而失效）、跨重启存活 |
| 触发延迟 | ~1s（interval 可调到 0.5s） | 持仓型跟单足够（永远跑在目标后，非 HFT）；dry-run 无所谓 |
| 资源 | `fs.watchFile` 每秒一次 `fs.stat`（微秒级） | 比 60s REST 轮询便宜几个数量级，CPU/IO 不可见 |
| 对账 | 收到信号后**对齐完整净仓** | 自愈断线/重启/部分成交/漏单（事件定"何时动"，对账定"怎么动"） |
| 映射 | hype 实时 universe 校验 | `buildHypeAssetIndex` 已每 6h 拉 meta；coin 不在 universe=不可映射，随上下架自动跟，零手维护 |
| 隔离 | watch=tracker 写 / copy=trader-exec 读 | 信号文件目录组权限，两进程不混 |

### 时间度量（落 JSONL + 推送页脚）

- `fullMs = t2−t0`：copy 一轮完整（拉取 + 处理）；`execMs = t2−t1`：copy 处理段（不含拉取）。
- 真·端到端（N0→N6）另含 WS 传播 + watch 防抖 + ~1s 信号检测（均在 watch 侧）；事件驱动后可把 `fullMs` 起点前移到信号到达时刻量化端到端。

### 落地子计划（4 阶段，每阶段 实现→测试→/k:check→commit）

| 阶段 | 改动 | 代码触点 | 风险 |
|---|---|---|---|
| P0 信号契约 | seq/ts/address 编解码（纯函数）+ 原子写 + `fs.watchFile` reader | 新建 `service/lib/copy-signal/` | 低 |
| P1 watch 发信号 | 在"变化确认"点(outFp 通过、TG 前) emit；**加法 + 配置开关**，不动检测主体 | `sodex-watch/process/watcher.mjs`、`HYPE-watch` 对称点 | **中**（动 live 服务，需回归：watch TG 输出 diff=0） |
| P2 copy 订阅触发 | 轮询主触发 → 订阅信号触发；REST 降 180s 兜底；coalesce 合并 | `service/HYPE-copy/main.mjs` | 低 |
| P3 映射自动化 | mapSymbol 接 hype universe 校验 | `process/mapping.mjs` + `buildHypeAssetIndex` | 低 |

> 工作量估：聚焦投入约半天~1 天人力当量（~4 次提交）；P1 回归验证是主要耗时项。
> 建议顺序 **P0→P3→P1→P2**：P3 与 watch 无关可先做降风险；P1 单独 checkpoint 跑回归；P2 最后接通。

---

## 一、一期已完成（dry-run 可跑）

- 配置加载 + 单目标硬限制（`process/mapping.mjs`）、标的映射（sodex 映射表 / hype 直通）。
- 资金模型（`process/sizing.mjs`、`recommend.mjs`）、校验门六分支（`process/risk.mjs`）、收敛对账（`process/reconcile.mjs`）。
- dry-run would-place 构造（`api/index.mjs` `placeDryRun`，**不签名**）、推送 + JSONL + 统计（`notify/index.mjs`、`process/stats.mjs`）。
- systemd 隔离编排（`app/index.mjs`，trader-exec + 资源上限 + 加固，wallet 注入留占位）。
- 46 条纯函数单测全绿。

---

## 二、切实盘必须逐项关闭的缺口（gated）

| # | 缺口 | 当前状态 | 代码触点 | 阶段 |
|---|------|----------|----------|------|
| 1 | **sodex 字段核对** | `symbol`/`leverage`/`marginUsed` 缩写键未经权威文档证实，用候选键回退 + 派生 | `api/index.mjs` `normalizeTargetPositions`（标了 TO-VERIFY） | 实跑前 **必做**：`node service/sodex-watch/query.mjs <addr> --raw` 核对真实字段名后修正 |
| 2 | **真实可用余额** | dry-run 用 `targets.json.availBalanceSim` 模拟 | `main.mjs` `avail`（注释标 dry-run 模拟） | 接 hype `clearinghouseState({user}).withdrawable` 替换模拟值 |
| 3 | **Agent Wallet 授权** | 仅占位 `agentKeyRef`，无真实 key | 设置 5 步见总纲 §3.6 / blueprint §10.7 | 主钱包 `approveAgent` → 生成独立 agent key → `/etc/tracker/HYPE-copy-<id>-agent.key`(chmod 600, trader-exec) |
| 4 | **systemd 注入 key** | 模板里 `LoadCredential` 仅注释 | `app/index.mjs` `hypeCopyTemplateUnit`（取消注释那两行） | 配合 #3，执行器读 `$CREDENTIALS_DIRECTORY/agent-key` |
| 5 | **真实下单签名** | `placeDryRun` 在 `dryRun!==true` 时 `throw` 占位 | `api/index.mjs` `placeDryRun` 的 throw 分支 | 接 EIP-712 phantom agent 签名 + `@nktkas` `ExchangeClient.order`（blueprint §8.2/§8.3） |
| 6 | **dryRun 标志翻转** | `targets.json.dryRun=true` 恒真 | `targets.json` | 测试网验证通过后逐目标置 false |
| 7 | **杠杆同步** | 总纲 §3.2 列了 `wouldUpdateLeverage`，**一期未实现** | 新增 `process/` 逻辑 + `api` `updateLeverage`（blueprint §8.3 长键参数） | 真实下单前补；下单前同步目标杠杆 |
| 8 | **事件触发** | `main.mjs` 仅 `RECONCILE_INTERVAL` 周期轮询；watch 事件触发**未接线** | 见 **§〇 最优先档**（抽 PositionStream 复用 watcher） | **最优先**（已提到 §〇），不是可选 |
| 9 | **真实 fee / 滑点** | dry-run 估算 `fee="0"`/`slippageBps=0`（fillPx 假定=refPx） | `main.mjs` emit place、`notify` toLogLine | 主网读回执实际 `status.filled` / fill fee 回填 |
| 10 | **MAX_CHASE_BPS 放弃逻辑** | 参数语义已写文档，**放弃跟单判定未接线** | `process/risk.mjs` 或 `main.mjs`（参考价偏离超阈值放弃） | 真实下单前补（防追高接盘，blueprint §10.5） |

---

## 三、灰度顺序建议（从安全到激进）

> 注：**§〇 事件驱动重构**与本灰度正交——它是触发机制改造，应在 **dry-run 期**完成（不依赖真实下单），优先级最高，先于下面实盘灰度。

1. **字段核对**（#1）：先 `--raw` 跑通，确认 sodex 仓位 / 保证金 / 杠杆解析正确——否则 ratio 分母错，全盘皆错。
2. **dry-run 联网观察**：保持 `dryRun=true`，部署后看 JSONL / 推送的 would-place 是否合理（名义、方向、ratio）。
3. **Agent Wallet + 测试网**（#3#4#5#7）：测试网真实下单，小额验证签名 / 精度 / 滑点保护。
4. **主网小额**（#6）：单目标、低 `maxDeployPct`、小 `availBalance`，观察 fee 侵蚀（`stats.mjs`）。
5. **逐步放开**：确认稳定后再调高部署比例 / 真实 fee 回填（#9）。

---

## 四、更远的增量（不在切实盘关键路径）

- 独立多目标 + 资金分配层（放开单目标硬限制；`capitalWeight` 两层分配，N 个独立 1:1）。
- N:1 共享账户净额收敛。
- 目标熔断自动判定阈值（累计回撤超阈值停跟平仓）。
- sodex 执行腿（对称加 `docs/copy/sodex.md`）。

---

## 五、部署前检查清单

- [ ] `targets.json` 已按 `targets.example.jsonc` 填好（单目标、真实 `source.address`）。
- [ ] `sodex` 字段已 `--raw` 核对（#1）。
- [ ] `trader-exec` 用户已建、`targets.json` 已 `chmod 600` + `chown trader-exec`（见 `hype.md §六`）。
- [ ] WARP 代理可用（`HTTP_PROXY`），sodex gateway + hype info 可达。
- [ ] `app/config.json` 的 `hypeCopy.enabled` / `targets` 已配置。
- [ ] **真实下单前**：#3#4#5#7#10 全部关闭并经测试网验证。
