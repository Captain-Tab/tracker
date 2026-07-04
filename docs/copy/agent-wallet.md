# Agent Wallet 授权与续签

> **状态**：授权/续签 CLI（`provision/`）+ 主动式到期检查（`service/HYPE-copy/expiry-check.mjs` + timer）**已实现**；真实签名下单接入 + 反应式到期处理留切实盘 Part B。dry-run 阶段不使用 agent。落地蓝图见 [`../../.claude/kit/spec/auto-copy-trade/09-go-live-real-trading.md`](../../.claude/kit/spec/auto-copy-trade/09-go-live-real-trading.md) §5、spec `2026-07-04-agent-expiry-notify.md`。
> 目的：记录"为什么用 agent wallet、怎么授权/续签/安全实现/到期怎么办"的完整原理与流程。

---

## 〇、完整生命周期流程（总览）

```
【现在 · dry-run】agent 未登场
   执行器只产 would-place（不签名）；expiry timer 空转跳过
        │
        │  ← Part A dry-run 观察确认 v3 输出合理（gate）
        ▼
【B-3 前夕 · 本地授权（你手动跑一次）】
   ① node provision/hype-copy-approve-agent.mjs --id=demo-1
      · 模式C 生成新 agent keypair（私钥+地址）
      · stdin 隐藏输入【主钱包私钥】（仅内存，用完弃）
      · 二次确认 网络/主地址/agent地址/有效期(默认180天)
      · 主钱包签 approveAgent(agentAddress, valid_until)
      · HL 记录授权关系「agent 可操作主账户，不能提现」
   ② 输出 agent 私钥 + 落盘命令 → 你贴到服务器：
      /etc/tracker/HYPE-copy-demo-1-agent.key (chmod600, trader-exec)
   ③ 填 targets.json.masterAddress = 你的主账户地址
        │
        ▼
【B-3~B-5 · 上线（改代码）】
   · placeDryRun 接真实 ExchangeClient.order（agent key 签单）
   · systemd LoadCredential 注入 agent key
   · dryRun: true→false（最后一步，主网小额）
        │
        ▼
【live 运行】
   执行器用【agent 私钥】签每一笔 order/updateLeverage/updateMargin
   → HL 验授权+未过期 → 用主账户的钱下单（agent 提不走钱）
        │
        ▼
【每日 · 到期监控（自动）】
   HYPE-copy-expiry.timer 每日查 extraAgents(masterAddress)
   · 剩 >7天 → 静默
   · 剩 <7天/已过期/被撤销 → TG 告警「本地 renew」（每天催）
        │
        │  ← 你收到提醒
        ▼
【续签（你本地跑一次）】
   node provision/hype-copy-approve-agent.mjs --renew --agent-address=0x.. --id=demo-1
   · 主钱包对同一 agent 再签 approveAgent(新 valid_until)
   · 次日 timer 查到新到期日 → 退出窗口 → 自动停止催
        │
        └──→ 回到【每日监控】循环
```

**谁在哪（贯穿全程）**：主钱包私钥只在本地（授权/续签用一次，永不上服务器）；agent 私钥在服务器 `/etc/tracker/`（天天签单）；授权关系在 HL 链上（expiry timer 只读查）；masterAddress 在 targets.json（余额/持仓/到期查询）。

---

## 一、概念：两把钥匙，权限不同

跟单执行**不裸持主钱包私钥**，而用 Hyperliquid 的 **Agent Wallet（API Wallet）** 机制。涉及两把**完全独立**的私钥：

| | 主钱包私钥 | Agent 私钥 |
|---|---|---|
| 是什么 | 你钱包本体的私钥 | 另外生成的一把独立私钥 |
| 地址 | 主账户地址（资金在此） | 全新地址，**不持有任何资金** |
| 权限 | 全权：交易 + 提现 + 转账 | **只能下单/撤单，不能提现/转账** |
| 放哪 | 只在本地，**永不上服务器** | 放服务器（执行器签单用） |
| 用途 | 只签一次授权（+ 续签） | 日常替主账户下单 |

两把钥匙**地址不同、私钥不同、无派生关系**（agent 私钥是随机生成的）。

**安全意义**：服务器只放 agent 私钥 → 即使服务器被入侵，攻击者能乱下单（可能亏钱），但**提不走本金**（agent 无提现权）。主私钥全程不上服务器，是本金安全的最后一道墙。

### 关系图：钥匙 × 钥匙 × 授权

用"委托操盘手"类比最直观——**授权不是第三把钥匙，是一条链上"权限关系记录"**：

```
  你本人 = 钱包私钥（有钱, 全权: 取钱/转账/交易）
     │
     │  ① 亲自签一次「委托书」 approveAgent(agent 地址)
     ▼
 ┌─────────────────────────────────────────────────┐
 │  Hyperliquid 上记录一条授权关系:                  │
 │    「agent 地址 可操作 主账户 的仓位, 不能提现」  │
 │     (可带有效期 valid_until, 可撤销)              │
 └─────────────────────────────────────────────────┘
     ▲
     │  ② 日常: agent 私钥 签每一笔订单
     │     HL 核验「该 agent 被授权吗? 未过期吗?」→ 是 → 放行
     │
 操盘手 = agent 私钥（没钱, 只能下单/撤单）
```

**谁签什么（最易混点）**：

| | 签什么 | 签几次 | 放哪 |
|---|---|---|---|
| 钱包私钥 | 那份"委托书"（授权） | **一次**（+ 续签） | 只在本地 |
| agent 私钥 | **每一笔订单** | 天天签 | 服务器 |
| 授权 | —（不是钥匙，是钱包私钥签出的一条记录） | — | HL 链上 |

**具体例子**：

```
钱包地址   0xAAA…（有 1000 USDC）
agent 地址 0xBBB…（0 USDC）
授权       用 0xAAA 私钥签 approveAgent(0xBBB) → HL 记「0xBBB 可操作 0xAAA 的仓位」
运行       服务器用 0xBBB 私钥下单 → HL 见授权 → 用 0xAAA 的 1000 USDC 开仓
           0xBBB 想提现 → HL 拒（agent 无提现权）
```

### 私钥都在哪 · HL 上只有什么

**铁律：私钥（任何私钥）永不发给任何人，包括 HL。** 只发"用私钥算出的签名"。

| 东西 | 在哪 | HL 服务器上有吗 |
|---|---|---|
| 钱包私钥 | 只在你本地机器（签授权那一次） | ❌ 从不 |
| agent 私钥 | **你自己的 VPS**：`/etc/tracker/HYPE-copy-<id>-agent.key`（trader-exec + chmod 600） | ❌ 从不 |
| agent 地址 | 由私钥派生的公开地址 | ✅ 有（公开，非私钥） |
| 授权关系 | 「agent 地址 可操作 主账户」这条记录 | ✅ 有（HL 链上） |

下单时只发"签名"，不发私钥：

```
你的 VPS:  agent 私钥 ──本地算出──> 签名(一次性证明)
              │ 私钥留本地             │ 只发【签名 + 订单内容】
              ▼                        ▼
          永不出 VPS               HL 验签「是被授权的 agent 签的吗」→ 是 → 下单
```

HL 拿到的只是签名，反推不出私钥（如同银行看到支票签名，而非你的手）。所以"服务器被黑 = 丢 agent 私钥"——它是唯一放在联网服务器上的私钥，且权限受限（不能提现）。

---

## 二、原理：授权只认地址 + 过期机制

授权的本质是主钱包签一条链上消息，把某个地址"登记为我的交易代理"：

```
主钱包.approveAgent({ agentAddress, agentName })
                       ↑ 只需地址        ↑ 名字里可塞 valid_until 后缀 = 到期时间
```

两个关键事实（据 SDK `@nktkas/hyperliquid` 实测）：

1. **授权只吃 `agentAddress`，不吃 agent 私钥**。授权跟 agent 私钥无关——agent 私钥只有之后**执行器签单**时才用。所以授权环节 agent 私钥可以完全不经过操作这台机器。
2. **`signatureChainId` / `hyperliquidChain` / `nonce` 由 SDK 自动填**，调用方只传 `agentAddress` + `agentName`。

**流程顺序（易错点）**：不是"授权后生成地址"，而是——

```
agent keypair 先存在（生成 / 已有）→ 地址由私钥派生 → 主钱包授权该地址
```

授权**不创造**地址，只是给一个已存在的地址**授予权限**。

---

## 三、三种模式（区别只在地址来源）

授权动作完全一样，区别仅在 `agentAddress` 从哪来：

| 模式 | 你手上有 | 怎么得到 agentAddress | agent 私钥是否经过本机 |
|---|---|---|---|
| **A · 已有 agent 私钥** | agent 私钥 | `privateKeyToAccount(私钥).address` 派生 | 是（你已持有，自行放服务器） |
| **B · 只有 agent 地址** | agent 地址（私钥在硬件/别处） | 直接用该地址 | **否，最安全** |
| **C · 全新生成** | 无 | `generatePrivateKey()` 生成 → 派生地址 | 是（脚本生成后交给你落盘） |

> 注意区分你"已有的私钥"是哪把：若是**主钱包私钥**（你的钱包），agent 仍需新生成（走 C）；若是**之前建好的 agent 私钥**，走 A。

---

## 四、授权流程（本地 CLI）

在**本地可信机器**（非服务器）执行。流程图：

```
 本地机器（你的 Mac，可信）
 ┌──────────────────────────────────────────────────────────┐
 │  agent keypair（私钥 + 地址）                              │
 │    A 已有私钥 ─派生─┐                                      │
 │    B 只有地址 ──────┼─→ agentAddress                       │
 │    C 现场生成 ─派生─┘   (generatePrivateKey)               │
 │                          │                                 │
 │  钱包私钥（stdin 隐藏输入，仅内存）                        │
 │        │                 │                                 │
 │        └──── 签 ────→ approveAgent(agentAddress, 有效期)   │
 │                          │                                 │
 └──────────────────────────┼─────────────────────────────── ┘
                            │ POST（官方端点，主网/测试网）
                            ▼
                    Hyperliquid：记录授权关系 → 返回 status:ok
                            │
                            ▼
 输出：agentAddress + (A/C 时) agent 私钥 + 服务器落盘命令
        │
        ▼
 你手动放服务器：/etc/tracker/HYPE-copy-<id>-agent.key (chmod 600, trader-exec)
```

分步：

```
① 确定 agentAddress（A 派生 / B 直用 / C 生成）
② 隐藏输入主钱包私钥（不回显、不留痕）
③ 二次确认：核对【网络】【主地址】【agent 地址】【名称+有效期】
④ 主钱包 approveAgent({ agentAddress, agentName })  ← 链上签一次
⑤ 确认 response.status === "ok"
⑥ 输出 agentAddress + （C/A 时）agent 私钥 + 服务器落盘命令
```

### 运行时：agent 私钥怎么被用（授权之后）

授权是一次性的；之后执行器**只用 agent 私钥**，主私钥再不出现：

```
 服务器（执行器 trader-exec，只有 agent 私钥）
   目标动 → 算单(v3) → agent 私钥 签订单 → HL
                                          │ 核验: agent 被授权? 未过期?
                                          ├─ 是 → 用主账户的钱下单（agent 碰不到提现）
                                          └─ 过期/未授权 → 拒 → 触发到期通知（§八）
```

落盘（你手动在服务器执行）：

```
echo '0xAGENT私钥' | sudo tee /etc/tracker/HYPE-copy-<id>-agent.key >/dev/null
sudo chmod 600 /etc/tracker/HYPE-copy-<id>-agent.key
sudo chown trader-exec /etc/tracker/HYPE-copy-<id>-agent.key
```

之后 systemd `LoadCredential` 把它注入执行器（spec 09 §4.5 / app/index.mjs）。

---

## 五、安全实现要点

| 项 | 要求 | 理由 |
|---|---|---|
| 主私钥输入 | **stdin 隐藏输入**（不回显），禁止命令行 inline / 环境变量 inline | inline 会进 shell history + `/proc/<pid>/environ`（审计 S7） |
| 主私钥内存 | 只在内存签一次，用完不持有；任何日志/错误消息不含私钥 | 防泄露（审计 S10） |
| agent 私钥输出 | 只打印终端、**绝不自动写 repo 文件**；打印后提示清屏 | 终端 scrollback 也是泄露面 |
| 落盘 | 脚本不产任何密钥文件；`provision/.gitignore` 兜底 `*.key`/`*.pem` | 防手滑提交 |
| 端点 | 官方地址硬编码（主网 / `--testnet`），无 env 覆盖 | 防钓鱼重定向（审计 S10） |
| 二次确认 | 签前显示网络 + 主地址 + agent 地址 + 名称，人工确认 | approveAgent 是真实链上动作 |
| 依赖 | `viem`（签名）走 lockfile，`npm ci` | 供应链完整性（审计 S5） |
| 运行环境 | 本地可信机器，非服务器 / 非 CI | 主私钥不进服务器 |

---

## 六、目录与放置

**`provision/hype-copy-approve-agent.mjs`（repo 根，`service/` 之外）**。

- 在部署单元 `service/` **之外** → 天然不随 rsync 上服务器（符合"主私钥工具只在本地"红线）。
- `provision` = 供给/配置凭据，语义即"一次性运维 provisioning"，与运行时代码、VPS setup 都分开。
- 不叫 `tool`（那是运行时 helper，会部署）。

结构：

```
provision/
  hype-copy-approve-agent.mjs   纯函数 approveAgentForCopy（只吃 agentAddress，可 mock 单测）+ CLI（隐藏输入/三模式/二次确认）
  .gitignore                    *.key *.pem *-secret* 兜底
```

---

## 七、有效期与续签

**过期机制**：`agentName = "hype-copy valid_until <毫秒时间戳>"`，HL 解析该后缀，到点自动失效。带过期比长期有效更安全（凭据不会永久有效）。

**有效期取值建议**：

| 取值 | 权衡 | 适用 |
|---|---|---|
| **180 天（默认）** | 泄露窗口与续签频率平衡；一年续 2 次 | ✅ 个人 bot 推荐 |
| 90 天 | 更安全（泄露自动失效更快），续签更勤 | 想更紧的安全 |
| 365 天 / 不过期 | 省事，但泄露的 agent key 长期有效 | 不推荐 |

- CLI 默认 `--expire-days=180`，可覆盖；`--no-expire` 走长期有效（不推荐）。
- **不缩到极短（如 7 天）配自动续签**——自动续签要主私钥在服务器，违背红线（§八 8.5）。人工续签就别设太勤。

时间线：

```
授权 ────────────────────────── valid_until ──────────────→
 │                          ▲(前 N 天)      │
 │                          │主动提醒续签   │过期: agent 失效
 approveAgent               │(§八)          │→ 签不了单 → 反应式告警+安全态
 (name valid_until=T)       └── renew ──────┘  (§八)
                            对同一地址再 approveAgent(新 T')
```

**续签 = 对同一 agentAddress 再授权一次（换新 valid_until）**：

- 链上动作与首次授权**完全相同**，故**核心签名函数复用同一个**（`approveAgentForCopy`），不另造逻辑。
- 但提供**独立 `renew` 入口/flag**：强制传已有 agentAddress、**禁止生成新 agent**——防止"想续签却误生成新 agent"（新 agent 未授权，旧仓位立即失管）。
- 一句话：**一个核心函数 + 一个薄 renew 包装**（禁生成、默认新有效期）。

---

## 八、到期通知（完整方案，live 刚需，Part B）

agent 过期的后果链：**过期 → 执行器签不了单 → 目标减仓/平仓跟不了 → 敞口失控**（正持仓时过期＝想平平不掉），比漏跟一次开仓严重得多。因此必须有通知。

### 8.1 到期信息来源：`extraAgents` 自动发现（不靠配置）

HL 提供只读查询 `info.extraAgents({ user: masterAddress })` → `[{ address, name, validUntil(ms|null) }]`：

- 按 `masterAddress` 查，**按 agentName 前缀 `hype-copy` 匹配**自己的 agent（Q1-A）→ 拿到 `validUntil`（多个取最早到期）。
- **只读、无签名、不需 agent 私钥**；**续签后自动反映最新 validUntil**（无配置漂移）。
- 优于"写死 config.validUntil"（续签忘更新就失真）。故**不存 validUntil，运行时自查**。

### 8.2 两层通知（**触发机制不同**）

| 层 | 触发方式 | 机制 | 必要性 |
|---|---|---|---|
| **反应式** | **执行器进程内（即时）** | 下单签名/提交失败且错误指向"未授权/过期"，**或** 本轮 extraAgents 查不到 agent / validUntil 已过 → 立即 TG 高优告警 + 进安全态 | **必需**（对真实下单失败做反应，必须在执行器里） |
| **主动式** | **独立 systemd timer（每日一次）** | 独立小脚本查 extraAgents，`validUntil − now < WARN_DAYS`（默认 7 天）或已过期/不在列表 → TG 提醒"agent 将于 X 过期，本地 renew" | 强烈建议（提醒续签） |

**主动式采纯查询 B1（第一性原理选型：更简单 + 更可靠）**：

- **零存储、零文件、零状态机**——validUntil 每次从 extraAgents 实时拿，不落盘、不写回、无漂移。
- **临期每天催，续签后次日自动停**：续签 → extraAgents 返回新的 validUntil → `now` 距新到期 >> 7 天 → 退出窗口 → 自动不再推。所以"每天催"不是无限 spam，是**催到你行动为止，一行动就停**。
- **不做去重**：宁可最后 7 天多催几次，也不能漏（关键凭据到期会冻结交易/失管仓位）。存储只为省几条消息，边际收益低还多个能出错的部件——不值。
- 弃用过的方案：写 validUntil 到文件供离线读（会漂移、要写回自愈、缺失要处理，是过早优化——省的是可忽略的每日 HTTP，加的是真复杂度）。

### 8.3 主动式为什么必须独立定时任务（不能挂在执行器/对账里）

- 主动提醒本质是"闹钟"，**不能依赖跟单进程活着**。若执行器崩溃 / 服务器重启未起 → 进程内检查根本不跑 → agent 静默过期，你收不到警告（**致命盲区**）。
- 「没跟单就不检查」只是半个问题：执行器有 180s 无条件兜底轮询，即使无跟单也每 3 分钟 tick，故"无活动"本身不挡检查——但"进程挂了"挡得死死的。
- 故**主动式 = 独立 systemd timer**（对齐项目现有 timer 基建，如快照定时单元）：
  - 只读查 `extraAgents(masterAddress)`，**无签名、连 agent 私钥都不用**（只需 masterAddress）。
  - 进程独立：执行器死活不影响它提醒你续签。
  - 每日一次；临期每天催、续签自停（B1，见 8.2）；网络失败某天 → 跳过，7 天窗口有 7 次机会 + `Persistent=true` 停机补跑。

### 8.4 反应式（执行器进程内，即时）

- 下单失败识别到过期/未授权错误码，或本轮 extraAgents 显示 agent 已过期/不在列表 → 立即告警 + 进安全态。
- 在执行器里，因为它要对"真实下单动作的结果"实时反应。

### 8.5 安全态（过期后行为）

- 进入 **"只减不加"**：禁止新开/加仓；若还能签，放行减/平（降风险方向）；完全签不了 → **停 + 高优告警**。
- 全程**不静默**：TG 高优 + JSONL 记录。

### 8.6 关于"自动续签"——不做

自动续签需主钱包私钥对联网进程可用 → **违背"主私钥永不上服务器"红线**。故**不自动续签**；到期前主动式提醒你，你在**本地**跑 `renew`（§七）。宁可人工，不把主私钥放服务器。

### 8.7 落点

- ✅ **主动式（已实现）**：`service/HYPE-copy/expiry-check.mjs`（server 端，只读 extraAgents，按 agentName 前缀 `hype-copy` 匹配）+ `app/index.mjs` 的 `HYPE-copy-expiry.{service,timer}`（每日 09:00 + `Persistent=true`，随 hypeCopy 启用）+ setup 集成。纯函数单测 8/8。dry-run 无 masterAddress 自动跳过。
- ⬜ **反应式（Part B）**：执行器 main 循环 + notify（下单失败/agent 失效 → 告警 + "只减不加"安全态）；耦合 B-3 真实签名。
- 无新增运行配置（validUntil 自查）；常量 `WARN_DAYS=7`。spec：`.claude/kit/spec/2026-07-04-agent-expiry-notify.md`。

---

## 九、撤销与核验

- 授权后可在 **HL 前端 → API / Agent Wallets** 核对该 agent 已列入，并可**随时撤销**。
- agent 只防"被提走"，**不防"被乱交易"**——急停 `/flatten`（Part B B-sec S3）仍必要。
- 每个账户/子账户各自独立授权各自的 agent（钱包隔离，blueprint §9/§10.7）。

---

## 十、现状与待实现

| 项 | 状态 |
|---|---|
| 概念 / 原理 / 流程 / 安全设计 | ✅ 本文档 |
| `provision/hype-copy-approve-agent.mjs`（授权 CLI + 纯函数 + 单测 8/8） | ✅ 已实现（本地运行，真正授权待 B-3 前夕再跑） |
| `renew` 续签入口（`--renew`） | ✅ 已实现（同上文件） |
| 主动式到期通知（expiry-check timer） | ✅ 已实现（`service/HYPE-copy/expiry-check.mjs` + app timer + setup；单测 8/8） |
| 反应式到期处理（签名失败 → 安全态） | ⬜ 未实现（Part B，配合 B-3/B-sec） |
| systemd 注入 agent key | ⬜ 未实现（Part B B-5，app/index.mjs LoadCredential 取消注释） |

> 依赖已就绪：`viem`（`generatePrivateKey`/`privateKeyToAccount`）+ `@nktkas/hyperliquid`（`ExchangeClient.approveAgent`）均已安装。
