# hype 跟单：dry-run → 实盘 待办清单（go-live checklist）

> 一期落地止于 **dry-run**（不签名、不发真实订单）。本文是**摘要清单**；**权威落地蓝图见 [`.claude/kit/spec/auto-copy-trade/09-go-live-real-trading.md`](../../.claude/kit/spec/auto-copy-trade/09-go-live-real-trading.md)**（经 v3缺口/SDK契约/对抗复查/安全审计四轮核实）。
> 总纲后续阶段见 `.claude/kit/spec/auto-copy-trade/00-overview.md §8`；实现细节见 [`hype.md`](./hype.md)。

> **⚠️ 三个前置事实（详见 spec 09 §0/§3.6/§8）：**
> 1. **v3 资金分配 Part A 已全部接线（2026-07-04）**——`main.mjs` 现跑 `planBudgetReconcile`（每币独立预算 + 生存杠杆 + 逐仓保证金防守），`allocation.mjs` 有 `planFollow`，`risk.mjs` 已四分支，配置走 minOpenCapital/maxCoinCapital。**仍 dry-run**（不签名）；真钱走 Part B。
> 2. **部署只跟"部署后新开的仓"，不接盘存量仓**（启动基线快照已实现，spec 09 §3.6 / `tool/copyStateStore.mjs`）——首轮快照目标存量为 baseline 永不跟，持久化跨重启，损坏降级重新快照。既是需求也是 v3 安全刚需（生存杠杆锚定目标 entryPx，中途接盘失效）。
> 3. **安全审计已产出 14 条缺口**（spec 09 §8），其中 S2/S3/S4/S5/S6/S7 为切实盘硬阻断（空响应防全平、flatten 急停、价格 sanity、依赖 pin+去 root、配置错配拒启动、agent key 仅 LoadCredential）。

---

## 一、已完成（dry-run 可跑）

- 配置加载 + 单目标硬限制（`process/mapping.mjs`）、标的映射（sodex 映射表 / hype 直通 + **hype universe 实时校验**）。
- **v3 资金模型已接入主循环**：每币独立预算 + 生存杠杆 + 逐仓保证金防守（`process/allocation.mjs` selectLeverage/planOpen/planFollow/planDefend + `reconcile.mjs` `planBudgetReconcile` 顶层编排）、校验门四分支（`process/risk.mjs`）、启动基线快照 + 状态持久化（`main.mjs` + `tool/copyStateStore.mjs`）。
- 纯函数单测全绿（HYPE-copy 80 + copy-signal 6 + watch 回归 sodex 25/HYPE 20 = 131）。
- dry-run would-place 构造（`api/index.mjs` `placeDryRun`，**不签名**）、事件分类通知 + JSONL + 计时 + 统计（`notify/`、`process/stats.mjs`）。
- systemd 隔离编排（`app/index.mjs`，trader-exec + 资源上限 + 加固，wallet 注入留占位）。
- **事件驱动（watch 检测 → 信号 → copy 执行）已实现**：信号库 `lib/copy-signal/`（脏标 + 原子写 + fs.watchFile + single-flight）、watch WS-change 点 emit（`sodex-watch`/`HYPE-watch` watcher，加法+开关）、copy 订阅触发 + 180s 兜底（`main.mjs`）。流程见 [`core-flow.md`](./core-flow.md)，设计见 spec `2026-06-29-hype-copy-event-driven.md`。
- **sodex 字段已实测核对**（真实 CL-USD 仓）：`s/sz/ep/l` 命中、marginUsed=`co/l` 精确；hype 价格/meta 实通。

---

## 二、切实盘必须逐项关闭的缺口（gated）

> ✅ 已闭合移除：~~#1 sodex 字段核对~~（真实数据已核：s/sz/ep/l + co/l）、~~#8 事件触发~~（已实现，见 §一）。

| # | 缺口 | 当前状态 | 代码触点 | 阶段 |
|---|------|----------|----------|------|
| 2 | **真实可用余额** | dry-run 用 `targets.json.availBalanceSim` 模拟 | `main.mjs` `avail`（注释标 dry-run 模拟） | 接 hype `clearinghouseState({user}).withdrawable` 替换模拟值 |
| 3 | **Agent Wallet 授权** | 仅占位 `agentKeyRef`，无真实 key | 设置 5 步见总纲 §3.6 / blueprint §10.7 | 主钱包 `approveAgent` → 生成独立 agent key → `/etc/tracker/HYPE-copy-<id>-agent.key`(chmod 600, trader-exec) |
| 4 | **systemd 注入 key** | 模板里 `LoadCredential` 仅注释 | `app/index.mjs` `hypeCopyTemplateUnit`（取消注释那两行） | 配合 #3，执行器读 `$CREDENTIALS_DIRECTORY/agent-key` |
| 5 | **真实下单签名** | `placeDryRun` 在 `dryRun!==true` 时 `throw` 占位 | `api/index.mjs` `placeDryRun` 的 throw 分支 | 接 EIP-712 phantom agent 签名 + `@nktkas` `ExchangeClient.order`（blueprint §8.2/§8.3） |
| 6 | **dryRun 标志翻转** | `targets.json.dryRun=true` 恒真 | `targets.json` | 测试网验证通过后逐目标置 false |
| 7 | **杠杆同步（=自算生存杠杆，非镜像目标杠杆）** | v3 `selectLeverage`/`buildWouldUpdateLeverage` 已实现但 main 未调用 | `api/index.mjs:252`（dry-run 构造已就绪）+ main 接线 | Part A 接线（生存杠杆 floor L\*）；实盘 `exchange.updateLeverage`，**失败仅告警不阻断下单** |
| 9 | **真实 fee / 滑点** | dry-run 估算 `fee="0"`/`slippageBps=0`（fillPx 假定=refPx） | `main.mjs:161/176` emit place、`notify` toLogLine | **⚠️ 修正：`order` 回执无 fee**（只有 `statuses[].filled.totalSz/avgPx`）→ 真实 fee 必须回查 `InfoClient.userFills`（`fee`/`closedPnl`）；滑点 = avgPx vs refPx 自算（spec 09 §2.4） |
| 10 | **MAX_CHASE_BPS 放弃逻辑** | 参数语义已写文档，**放弃跟单判定未接线** | `process/risk.mjs` 或 `main.mjs`（参考价偏离超阈值放弃） | 真实下单前补（防追高接盘，blueprint §10.5） |

---

## 三、灰度顺序建议（从安全到激进）

> 注：事件驱动（watch→信号→copy）已在 dry-run 期完成（见 §一），下面是切实盘的剩余灰度。

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
