# 自动跟单执行腿 · hype（一期 dry-run）

> 执行端**恒在 hype**：所有镜像下单都在 Hyperliquid 完成，信号源可来自 sodex（跨所，仅监听）或 hype（同所）。
> 本文记录跟单**思路 / 端到端流程 / 核心方法 / 核心处理 / sodex-hype 差异 / 隔离安全 / 阶段边界**，作为团队理解与后续 sodex 执行腿移植的权威参考。
>
> 关联文档：
> - 策略思维（为什么这么跟）→ [`../principles/copy-trade-strategy.md`](../principles/copy-trade-strategy.md)
> - 实现蓝本（SDK 契约 / 收敛 / 滑点 / Agent Wallet）→ [`../hype/copy-trade-blueprint.md`](../hype/copy-trade-blueprint.md)
> - spec-set SSOT → `.claude/kit/spec/auto-copy-trade/00-overview.md` 及子件 01–05
> - sodex / hype 字段可信度 → [`../api-confidence/sodex.md`](../api-confidence/sodex.md) / [`../api-confidence/hype.md`](../api-confidence/hype.md)

代码落点：`service/HYPE-copy/`（`process/` 纯逻辑、`api/` IO 横切、`notify/` 出口、`main.mjs` 对账循环）。

---

## 一、目标与原理

自动跟单 = 监听高手目标仓位变化 → 按资金比例换算 → 在 hype 镜像下单。一期**止于 dry-run**（不签名、不发真实订单），跑通信号→换算→收敛→风控→推送全链路 + 隔离架构。

四条原理（详见 strategy §1、blueprint §3）：

1. **等比缩放**：按「我方可用余额 / 目标可映射保证金」缩放目标仓位，不照搬绝对张数。
2. **净仓位收敛**（非逐 fill）：只对账目标**当前净仓**与我方持仓的差额，不追每一笔成交——断线 / 漏单 / 重启都能自愈。
3. **完全跟随**：不自主止盈 / 止损 / 移动止损（风控粒度上移到目标级与账户级）。
4. **目标级风控**：单仓封顶（`maxPositionPct`）、部署上限（`maxDeployPct`）、最小名义（$10），防目标高杠杆单仓打爆。

---

## 二、端到端流程

```
sodex/hype 监听目标仓变化
   → 标的映射（mapSymbol：sodex 映射表 / hype 同所直通）
   → 资金换算（computeRatio 锚定 + computeDesired 等比折算）
   → 校验门（decideLeg 六分支）
   → 仅 place 进 dry-run would-place（placeDryRun，不签名）
   → 推送（独立跟单 TG）+ JSONL 日志
```

跟单目标生命周期（总纲 §2.1）：`idle → anchored → following → capped/flat`。
- `anchored`：目标首次出现可映射仓，锚定 `ratio`；
- `following`：固定 ratio 跟加 / 减仓；
- `capped`：部署需求触 `maxDeployPct`，仅拦加仓；
- `flat`：目标可映射净仓归零，释放并待下轮重锚。

对账触发二选一叠加：**watch 事件**（目标仓变化信号）+ **`RECONCILE_INTERVAL`（默认 15s）周期兜底**，两者进同一幂等 `reconcileOnce()`。

---

## 三、核心方法

### ① 资金模型：锚定首仓 + 分层 buffer + 保证金等比

- **分母是目标可映射保证金，不是净值**：只累加可映射仓的已用保证金（不含股票 / 商品仓）。
- 锚定 ratio（`computeRatio`，`service/HYPE-copy/process/sizing.mjs`）：

  ```
  ratio = (avail × initialDeployPct) / targetMappableMargin
  ```

  数字例：`avail=500`、`initialDeployPct=0.5`、目标 ETH 多仓 `marginUsed=4000` → `ratio = 250 / 4000 = 6.25%`。
  大保证金例：目标可映射保证金 `6w` → `ratio = 250 / 60000 ≈ 0.417%`（目标越重，等比缩放越小，本金不够则靠最低本金算法识别）。

- 等比换算 desired（`computeDesired`）：

  ```
  desiredMargin   = pos.marginUsed × ratio
  desiredNotional = desiredMargin × pos.leverage     // 等比放大回名义
  size            = desiredNotional / hypeMidPx       // 按 hype 中价折算张数（方向沿用 szi 符号）
  ```

  续上例：ETH `marginUsed=4000`、`leverage=5`、中价 `8000` → `desiredNotional=1250` → `size=0.15625`。

- 部署上限：`min(目标保证金×ratio, avail×maxDeployPct)`，触顶 → `capped`。

### ② 最低本金算法 `recommendMinCapital`（`process/recommend.mjs`）

反解「让每仓我方名义都 ≥ 最小名义 $10」所需最低本金：

```
legRatioMin[coin] = MIN_ORDER_NOTIONAL_USD / (|szi| × hypeMidPx)
ratioMin          = max over coins (legRatioMin)               // 名义最小的仓卡门槛
minCapital        = ratioMin × targetMappableMargin / initialDeployPct
```

输出 `perLeg` 标每仓 `canFollow` + `reason`（`ok` / `below-min-notional` / `no-price`）。开跟轮推送「推荐最低本金 + 当前本金可跟 / 跳过清单」。

### ③ 校验门六分支 `decideLeg`（`process/risk.mjs`，顺序铁律 = 总纲 §2.2）

先命中先返回，互斥：

| 顺序 | decision | 条件 | 动作 |
|---|---|---|---|
| 1 | `skip-unmappable` | 无 hype 映射（仅 sodex 跨所源可能命中） | 不下单，不计 ratio 分母 |
| 2 | `skip-mindust` | 本笔名义 `\|delta\|×px` < $10 | 跳过 + 告警 |
| 3 | `skip-maxpos` | 单仓名义 > `avail×maxPositionPct`（仅拦加仓） | 封顶拦截加仓部分 |
| 4 | `skip-capped` | 部署需求（已部署 + 本仓名义）> `avail×maxDeployPct`（仅拦加仓） | 拦加仓，**放行减仓 / 平仓** |
| 5 | `noop` | `\|delta\|` < 最小下单量，或 `\|delta\|/\|desired\|` < `minDeltaPct` | 跳过（防碎步追单） |
| 6 | `place` | 以上都不命中 | dry-run would-place |

### ④ 滚仓三层处理

| 层 | 机制 | 落点 |
|---|---|---|
| ① 收敛跳过中间态 | `diffDelta` 对齐最新净仓快照（非逐 fill）；100→150→120→200 一步对齐到 200 | `process/reconcile.mjs` |
| ② watch 分档去抖 | 上游合并滚仓信号、降触发频率 | watch（已存在） |
| ③ 最小变动阈值 | `decideLeg → noop` | `process/risk.mjs` |

---

## 四、核心处理

- **dry-run 不签名 / 不下单**：`placeDryRun`（`api/index.mjs`）只构造 IOC 限价 would-place 结构（对齐 blueprint §8.3 `order` 形状 `a/b/p/s/r/t`），`dryRun!==true` 时抛错占位（真实提交留后续阶段，不触 agent key）。
- **precision ROUND_DOWN**：px / sz / 金额运算全程走 `process/precision.mjs`（decimal.js，向零截断防超额）；`formatPrice` = 5 位有效数字 + perps 小数上限(6−szDecimals)，`formatSize` = szDecimals 位。**禁裸 `parseFloat` 算术 / 比较，禁用 `tool/format` 做精度**（其仅展示）。
- **滑点保护**：`MAX_SLIPPAGE_BPS`（IOC 限价偏移，买 +、卖 −）≠ `MAX_CHASE_BPS`（参考价偏离超此放弃跟单），两者语义不同不可混用。
- **收敛幂等自愈**：dry-run `current` 恒空 → 每轮 desired 即全量 would-place（唯一口径，可重放，无隐式累计态）。
- **触顶 / 跳过告警**：六分支 skip 类均落 JSONL + 推送告警（`noop` 去重不推但可记）。

---

## 五、sodex vs hype 跟单思路差异（重点）

| 维度 | hype（一期已实现 dry-run） | sodex（执行腿后续，先记差异） |
|------|---------------------------|------------------------------|
| 角色 | **执行所**（镜像下单） | **监听信号源**（目标仓位变化） |
| 标的 | 加密 perps（BTC/ETH/SOL…） | 含股票 / 商品 perps（PLTR/USTECH/XAUT/COPPER）→ **不可映射部分跳过** |
| 跨所映射 | sodex symbol → hype coin 映射表；不可映射 desired=0、不计 ratio 分母 | （同所执行时无需映射） |
| 数据模型 | clearinghouseState `szi` 带符号 / @nktkas SDK | state `data.P`（`sz/ep` 等缩写；保证金按 `\|sz\|×ep/leverage` 推算） |
| 盈利 / 保证金读取 | SDK clearinghouseState（`marginUsed` 精确直给） | sodex REST `/api/v1/perps/accounts/{addr}/state`（保证金需推算） |
| 下单签名 | EIP-712 phantom agent（@nktkas，后续阶段） | sodex 下单链路（执行腿后续设计，本期不做） |
| 滚仓 | 收敛 + watch 分档 + 最小变动阈值 三层 | 同理（监听侧 sodex-watch 分档已落地） |

**为何先 hype 执行**：执行腿设计只覆盖 Hyperliquid（@nktkas 已审计 SDK + Agent Wallet 安全机制），sodex 无执行腿；跨所跟单**只跟可映射加密标的**。sodex 仅监听不下单、不涉 agent。

> ⚠️ sodex REST state 的 `symbol` / `leverage` / `marginUsed` 缩写键未在权威文档列出，`api/index.mjs` 用候选键回退 + 派生，**首次实跑需 `--raw` 核对修正**（不臆造）。

---

## 六、隔离与安全

- **读侧 / 写侧分离**：watch / discovery（读）共享 `tracker` 用户；跟单执行（写）每目标独立进程 + **独立 agent wallet / 子账户**（一钱包一进程签名 → nonce 隔离，server-architecture §9）。
- **Agent Wallet（主私钥不上服务器）**：主钱包只签一次 `approveAgent`，授权独立 agent key（**只能下单 / 撤单，不能提现**）；执行器只持 agent key。即使服务器泄露，攻击者只能乱交易、无法转走资金（blueprint §10.7）。一期 **dry-run 不需真 key**，`targets.json` 仅留 `agentKeyRef` 占位。
- **trader-exec 用户 + systemd 模板单元**（`HYPE-copy@<id>.service`，套 server-architecture §6.4）：`User=trader-exec` / `MemoryMax=128M` / `CPUQuota=80%` / `TasksMax=32` / `NoNewPrivileges` / `ProtectSystem=strict` / `ProtectHome` / `PrivateTmp`。dry-run 阶段**不输出生效 `LoadCredential`**，仅注释占位。
- **三出口**：实时推送（独立跟单 TG，token / chat 与 watch 物理分离）/ 每动作 JSONL（`service/HYPE-copy/log/HYPE-copy-<target>-<date>.jsonl`，跨日滚动）/ journald 分级。

### 部署运维命令

编排走 `service/app/index.mjs`（config `hypeCopy.enabled` / `targets` 控制），不新建独立 systemd 文件：

```bash
# 一次性：创建写侧隔离用户（非本 CLI 职责）
sudo useradd --system --no-create-home --shell /usr/sbin/nologin trader-exec

# targets.json 权限收敛（含 agentKeyRef，仅 trader-exec 可读；CLI 不自动 chmod 业务文件）
sudo chown trader-exec:trader-exec <ROOT_DIR>/HYPE-copy/targets.json
sudo chmod 600 <ROOT_DIR>/HYPE-copy/targets.json

# 编排：render 干跑审查 → apply 写盘 + enable
node service/app/index.mjs render
node service/app/index.mjs apply
```

`hypeCopy.enabled=false`（默认）只装模板不 enable 实例；`enabled=true` + `targets:["<id>"]` 才 enable `HYPE-copy@<id>.service`。

---

## 七、阶段与边界

- **一期（本文）**：dry-run，不动真钱——信号 → 换算 → 收敛 → 风控 → 推送全链路 + 隔离架构就位，wallet 注入留占位。
- **后续 gated 阶段**（不在本期）：
  1. 独立多目标 + 资金分配层（`capitalWeight` 两层分配，N 个独立 1:1）；
  2. 测试网真实下单 → 主网小额；
  3. agent key 真实签名（EIP-712 phantom agent）；
  4. N:1 共享账户净额收敛；
  5. 目标熔断自动判定阈值；
  6. sodex 执行腿（对称加 `docs/copy/sodex.md`）。
