# Spec 06 · 跟单系统文档（docs/copy/hype.md）

> 引用总纲 `00-overview.md`。流程/状态机/契约以总纲为准，本文只定义"要写哪份文档、记录什么"。
> 依赖：01-05 全部完成（系统成形后总结，确保文档与实现一致）。
> 落地时本 spec 已读，直接 `/k:task` 执行（写文档），不重新生成。

---

## 背景与目的

自动跟单系统成形后，在 `docs/` 新增一份**完整跟单文档**，记录 hype 与 sodex 的跟单思路差异、核心流程、核心方法、核心处理——作为团队理解与后续 sodex 执行腿移植的权威参考。对应总纲 §8 拓扑阶段 6（最后阶段）。

## 选定方案

落点 `docs/copy/hype.md`（延续 docs 按平台分文件约定）；将来 sodex 执行腿落地时对称加 `docs/copy/sodex.md`。本阶段写 hype 版 + 在其中记录"sodex 与 hype 的差异"小节（sodex 执行腿尚未实现，先记差异与设计意图）。

## 设计概要

### 文档必含章节（完整记录）
| 章节 | 内容 |
|------|------|
| 一、目标与原理 | 自动跟单做什么；等比缩放 + **净仓位收敛**（非逐 fill）+ 完全跟随（不止盈/止损）+ 目标级风控（引总纲 §1、blueprint §3） |
| 二、端到端流程 | sodex 监听 → 标的映射 → 资金换算 → 校验门 → dry-run would-place → 推送+日志（引总纲 §2 状态机 + §8 拓扑） |
| 三、核心方法 | ① 资金模型：锚定首仓 + 分层 buffer + **保证金等比**（分母=目标可映射保证金，非净值，附数字例 500/6w）；② 最低本金算法 recommendMinCapital；③ 校验门六分支 LegDecision；④ 滚仓三层处理 |
| 四、核心处理 | dry-run 不签名/不下单、precision ROUND_DOWN、滑点保护（MAX_SLIPPAGE_BPS 限价偏移 vs MAX_CHASE_BPS 放弃阈值）、收敛幂等自愈、触顶/跳过告警 |
| 五、**sodex vs hype 跟单思路差异（重点）** | 见下表 |
| 六、隔离与安全 | watch 共享/执行每目标独立进程+独立 agent wallet、Agent Wallet（主私钥不上服务器）、trader-exec 用户、JSONL 日志（引总纲 §3.5、05、server-architecture §6.4/§9） |
| 七、阶段与边界 | 一期 dry-run；测试网/主网/N:1/sodex 执行腿为后续 gated 阶段 |

### 五、sodex vs hype 跟单思路差异（文档核心，必须完整对比）
| 维度 | hype（一期已实现 dry-run） | sodex（执行腿后续，先记差异） |
|------|---------------------------|------------------------------|
| 角色 | **执行所**（镜像下单） | **监听信号源**（目标仓位变化） |
| 标的 | 加密 perps（BTC/ETH/SOL…） | 含股票/商品 perps（PLTR/USTECH/XAUT/COPPER）→ **不可映射部分跳过** |
| 跨所映射 | sodex symbol → hype coin 映射表；不可映射 desired=0、不计 ratio 分母 | （同所执行时无需映射） |
| 数据模型 | clearinghouseState `szi` 带符号 / @nktkas SDK | state `data.P`（`sz/ep/l/co` 等缩写，`co`=名义敞口、保证金≈`co/l`、`l`=杠杆） |
| 盈利/保证金读取 | SDK clearinghouseState | sodex REST `/api/v1/perps/accounts/{addr}/state` |
| 下单签名 | EIP-712 phantom agent（@nktkas，后续阶段） | sodex 下单链路（执行腿后续设计，本期不做） |
| 滚仓 | 收敛 + watch 分档 + 最小变动阈值 三层 | 同理（监听侧 sodex-watch 分档已落地） |

> 必须说明"为何先 hype 执行"：执行腿设计只覆盖 HL（@nktkas 已审计 SDK + agent wallet），sodex 无执行腿；跨所跟单只跟可映射加密标的。

## i18n 文案
不涉及（纯 markdown 文档）。

## 边界与约束
- 包含：写 `docs/copy/hype.md` 完整 7 章；sodex/hype 差异完整对比表。
- 不包含：`docs/copy/sodex.md`（sodex 执行腿落地时再写）；测试网/主网操作手册（后续阶段）。
- 文档须与最终实现一致（本阶段在 01-05 完成后执行，避免文档与代码漂移）。

## 集成点
- 新增 `docs/copy/hype.md`。
- 引用：总纲全章 + 01-05 子件 + `docs/hype/copy-trade-blueprint.md` + `docs/principles/copy-trade-strategy.md` + `docs/api-confidence/sodex.md`（sodex 字段）/`hype.md`。
- 与现有 docs 结构一致（`docs/<功能>/{平台}.md`，对齐 watch/discovery/coin-profile）。

## 验收标准
- [ ] `docs/copy/hype.md` 存在，含七章（目标原理/流程/核心方法/核心处理/sodex-hype差异/隔离安全/阶段边界）。
- [ ] 资金模型章含具体数字例（500/6w、锚定首仓、保证金等比、最低本金）。
- [ ] sodex vs hype 差异对比表完整（角色/标的/映射/数据模型/签名/滚仓）。
- [ ] 明确标注"一期 dry-run 不真实下单"与后续 gated 阶段。
- [ ] 内容与 00-overview + 01-05 实现一致，无矛盾。

## 验收场景（Given/When/Then）

### 场景 1：文档完整记录
- **Given** 01-05 已实现并通过 check
- **When** 执行阶段 6 写 `docs/copy/hype.md`
- **Then** 文档含七章；sodex/hype 差异表覆盖 ≥6 维度；资金模型含数字例；读者据此能理解跟单思路/流程/核心方法

### 场景 2：与实现一致性
- **Given** 文档写好
- **When** 对照 00-overview + 03（校验门六分支）+ 02（资金模型）核对
- **Then** 文档描述的 LegDecision 分支、资金公式、滑点参数名（MAX_SLIPPAGE_BPS/MAX_CHASE_BPS）与实现一致，无过时/矛盾表述
