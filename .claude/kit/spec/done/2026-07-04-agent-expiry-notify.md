# Agent Wallet 到期通知（主动式 timer + 反应式执行器）

> 完整原理见 [`docs/copy/agent-wallet.md`](../../../docs/copy/agent-wallet.md) §八，本 spec 只定实现契约，不重复原理正文。
>
> **落地状态（2026-07-04）**：**主动式（expiry-check timer）已实现**——`service/HYPE-copy/expiry-check.mjs` + `app/index.mjs` timer 单元 + setup 集成，纯函数单测 8/8。dry-run 无 masterAddress 自动跳过，切实盘填 masterAddress 后生效。**反应式（执行器签名失败→安全态）仍留 Part B**（耦合 B-3 真实签名）。

## 背景与目的

agent wallet 带 `valid_until` 过期。过期后果链：**过期 → 执行器签不了单 → 目标减/平跟不了 → 敞口失控**（正持仓时过期＝想平平不掉），比漏跟一次开仓严重得多。需在过期前可靠提醒续签，且过期发生时不静默失败。dry-run 不用 agent，故本功能全属 Part B。

## 选定方案

**B1 · 纯查询（无存储）** —— 主动式独立 systemd timer 每日查 `extraAgents`，临期/过期/被撤销即 TG 告警；反应式在执行器内对真实签名失败做安全态。

第一性原理选型：可靠性来自"更少能出错的东西"。对比：
- 纯文件（approve 写 validUntil 供离线读）：会漂移、要写回自愈、缺失要处理——为省"可忽略的每日 HTTP"加了真复杂度，弃用。
- 纯查询 B1：validUntil 每次从 extraAgents 实时拿，**零存储、零漂移、续签自停**，活动部件最少。每日一次 ~100ms 查询开销可忽略。

## 设计概要

### 两层（触发机制不同）

| 层 | 触发 | 逻辑 |
|---|---|---|
| 主动式 | **独立 systemd timer（每日 09:00）** | 查 `info.extraAgents({user: masterAddress})` → **按 agentName 前缀 `hype-copy` 匹配（Q1-A）** → `validUntil−now < WARN_DAYS(7)` 或 已过期 / 不在列表 → TG 提醒"本地 renew"（多 agent 取最早到期） |
| 反应式 | **执行器进程内（即时）** | `order/updateLeverage/updateIsolatedMargin` 抛"未授权/过期"类错误，或本轮 extraAgents 显示失效 → 立即高优告警 + 进"只减不加"安全态 |

### 主动式关键行为（B1）

- **零存储**：不写 validUntil 文件、不写去重记号；每次实时查。
- **临期每天催、续签自停**：续签 → 下次查 extraAgents 得新 validUntil → 退出 7 天窗口 → 自动不再推。"每天催" = 催到你行动为止，一行动就停。
- **不去重**：宁可最后 7 天多催几次，也不能漏（关键凭据）。
- **只读、无签名、不需 agent 私钥**（只需 masterAddress）；进程独立于执行器（执行器崩了照样提醒）。

### 反应式安全态

- 进入"只减不加"：禁新开/加仓；若还能签，放行减/平（降风险）；完全签不了 → 停 + 高优告警。全程不静默（TG 高优 + JSONL）。

## 边界与约束

**包含：**
- 主动式：独立小脚本（如 `provision/agent-expiry-check.mjs`）+ systemd timer（每日，`Persistent=true`）
- 反应式：执行器 `main.mjs`/`notify` 对签名失败 / agent 失效的告警 + 安全态
- 常量 `WARN_DAYS=7`

**不包含：**
- 自动续签（需主私钥在联网进程 → 违背"主私钥永不上服务器"红线；续签由人本地跑 `renew`）
- validUntil 落盘 / 去重存储（B1 零存储）
- dry-run 阶段（不用 agent）

**已知限制：**
- 网络失败某天 → 跳过；靠 7 天窗口 7 次机会 + `Persistent=true` 停机补跑兜底。
- 远离到期时主动撤销 agent → 主动式窗口未开发现不了，但反应式（执行器签名失败）即时兜住。

## 集成点

- ✅ **已建 `service/HYPE-copy/expiry-check.mjs`**（server 端，只读 extraAgents + TG 告警；纯函数 `evaluateExpiry`/`buildExpiryMessage` + 薄 IO；WARP 代理复用）——放 `service/`（server 端定时任务，与 approve CLI 的本地属性区分）
- ✅ **`service/app/index.mjs`**：新增 `HYPE-copy-expiry.{service,timer}` 单元（每日 09:00 Asia/Shanghai + `Persistent=true`，随 `hypeCopy.enabled` 启用），对齐现有 discovery timer 范式
- ✅ **`setup/setup-copy.sh`**：完成提示补 expiry timer（app apply 自动建单元，无需额外命令）
- ✅ **依赖**：`@nktkas/hyperliquid` `info.extraAgents`（已装）；config 复用 `targets.json` 的 masterAddress / tgToken / tgChat
- ⬜ **Part B 待做**：`service/HYPE-copy/main.mjs` + `notify/` 反应式——下单调用（B-3 的 `order/updateLeverage/updateIsolatedMargin`）失败识别过期/未授权 → 告警 + "只减不加"安全态

## 验收标准

- [ ] 主动式 timer 每日运行，查 extraAgents 只读、无签名、只需 masterAddress
- [ ] `validUntil−now < 7天` → 发一条 TG 提醒（含 agent 地址 + 到期时间 + 本地 renew 指引）
- [ ] 续签后次日自动不再推（extraAgents 返回新 validUntil → 退出窗口）
- [ ] agent 已过期 / 不在 extraAgents 列表 → 告警（不静默）
- [ ] `masterAddress` 未配：dry-run（`dryRun:true`）→ 静默跳过退出 0；live（`dryRun:false`）→ loadTargets 拒 → 退出非零触发 OnFailure
- [ ] 网络失败某天 → 跳过不崩，次日重试；timer `Persistent=true` 停机补跑
- [ ] 反应式：执行器下单签名失败识别过期/未授权 → 立即高优告警 + 进"只减不加"安全态
- [ ] 无新增运行配置、无 validUntil 落盘、无去重存储（B1 零存储）
- [ ] 主动式脚本进程独立：执行器停止不影响其运行

## 验收场景

### 场景 1：临期提醒（Happy Path）
- **Given** agent 已授权，`validUntil = now + 5 天`；masterAddress 已配；timer 每日运行
- **When** 主动式脚本执行，查 extraAgents 得该 agent `validUntil`
- **Then** `validUntil − now = 5 天 < 7` → 发一条 TG 提醒，含 agent 地址 + 到期时间 + "本地 renew" 指引

### 场景 2：续签后自动停推
- **Given** 处于临期窗口（每天在推提醒），用户本地跑 `renew` 使 `validUntil = now + 180 天`
- **When** 次日 timer 再次查 extraAgents
- **Then** `validUntil − now ≈ 180 天 >> 7` → 退出窗口 → **不再发提醒**（无需任何存储/手动清除）

### 场景 3：过期 + 反应式安全态
- **Given** agent 已过期（`validUntil < now`），执行器正持有镜像仓，目标此时减仓
- **When** 执行器尝试 `order`（reduceOnly 跟减）→ 因 agent 过期签名/提交失败
- **Then** 立即发 TG 高优告警 + 进"只减不加"安全态（记 JSONL），不静默失败

### 场景 4：agent 被撤销（远离到期）
- **Given** `validUntil` 还有 60 天，但用户在 HL 前端撤销了该 agent（不在 extraAgents 列表）
- **When** 执行器下一次尝试下单
- **Then** 反应式识别"未授权" → 高优告警 + 安全态（主动式窗口未开，靠反应式兜住）

### 场景 5：masterAddress 未配置
- **Given** dry-run（`dryRun:true`）的 `targets.json` 缺 `masterAddress`
- **When** 主动式脚本执行
- **Then** 静默跳过、退出 0（dry-run 无 agent，正常）；日志记"无 masterAddress 跳过"

### 场景 6：live 缺 masterAddress（配置错误）
- **Given** `dryRun:false` 但 `targets.json` 缺 `masterAddress`
- **When** 主动式脚本执行（`loadTargets` 校验）
- **Then** `loadTargets` 抛错 → 脚本退出非零 → OnFailure 告警（监控自身配置坏了要知道，不静默）
