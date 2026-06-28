# Spec 04 · 跟单推送 + 日志统计

> 引用总纲 `00-overview.md`。流程 / 状态机 / 共享契约以总纲为准，本文只定义本子单元自身，**冲突以总纲为准**。
> 依赖：03（收敛对账 + 校验门 + dry-run 下单）已产出可消费的「动作结果」；命名 / 日志路径见总纲 §3.5。
> 落地时本 spec 已读，**勿重新生成**；直接 `/k:task` 执行本阶段。

---

## 背景与目的

本子单元是总纲端到端链路的第三、四出口（实时推送 / 持久日志）。03 在校验门后产出每仓的「动作结果」（would-place / 各 skip / 触顶 / 失败），本件负责把这些结果：

1. 推到**独立于 watch 的跟单 TG**（执行视角，下单动作后推）；
2. 落成**结构化 JSONL**（每动作一条）并写 journald(pino)；
3. 提供**周期统计聚合**（笔数 / Σfee / 跟单净收益(fee erosion) / 滑点分布）。

对应总纲：
- 设计概要「跟单推送（独立 TG）」「日志统计（JSONL）」分支；
- §3.5 命名 / 日志路径；§2.2 LegDecision（推送 / 日志的 `result`/`reason` 取值来源）。

**三出口分工（铁律，不可混用）**：

| 出口 | 职责 | 本件 | 与 watch 区分 |
|---|---|---|---|
| 实时推送 | 单次动作即时播报（执行视角） | ✅ 跟单 TG（独立 tgChat） | watch 推送是「监听视角」，独立 tgToken，不复用 |
| 持久日志 | 每动作一条可回溯审计 | ✅ JSONL + journald | watch 无逐动作 JSONL |
| 周期统计 | 聚合分析 fee 侵蚀 / 滑点 | ✅ 从 JSONL 聚合 | — |

## 选定方案

落点 `service/HYPE-copy/`，遵守单文件不建文件夹：

```
service/HYPE-copy/
  notify/index.mjs        — 跟单 TG 推送（消费 03 动作结果，组装文案，去重，sendTelegram）
  log/                    — JSONL 落盘目录（总纲 §3.5）
  process/stats.mjs       — 周期统计聚合（读 JSONL → 笔数/Σfee/净收益/滑点分布）
```

- **推送**复用 watch 的 `sendTelegram` 调用模式（同样的 Bot API 封装），但 token/chat 走跟单独立配置：`tgChat` 取自 `targets.json` 每目标字段（总纲 §3.1），token 走文件根 `tgToken`（与 watch 物理分离）。
- **JSONL 写入**为同步追加单行（一动作一行），文件名 `HYPE-copy-<target>-<date>.jsonl`（date 按本地日，跨日自动滚新文件）。
- **stats** 为纯函数：输入 JSONL 行数组 → 输出聚合对象，便于单测 drop-in。

## 设计概要

### 数据来源

消费总纲 §3.2 / 03 产出的「动作结果」对象（03 定义其形状，本件不重定义）。本件假定每个动作结果至少携带：`targetId / action / coin / side / size / refPx / fillPx / fee / slippageBps / dryRun / result / reason`，与 JSONL schema 字段一一对应（见下）。`result`/`reason` 取值来自总纲 §2.2 LegDecision。

### JSONL 记录 schema（每动作一条，总纲 §3.5 路径）

```ts
type CopyLogLine = {
  ts: number;            // epoch ms
  targetId: string;
  action: "place" | "skip" | "cap-warn" | "min-capital" | "error";
  coin: string;          // hype coin；非仓位级动作(min-capital)可空串
  side: "long" | "short" | "";
  size: string;          // 精度字符串，禁裸 number
  refPx: string;         // 参考价(allMids/mid)
  fillPx: string;        // dry-run 下为 would-fill 估算价；无则空串
  fee: string;           // 估算手续费；dry-run 估算，无则 "0"
  slippageBps: number;   // (fillPx-refPx)/refPx*1e4；无则 0
  dryRun: boolean;       // 一期恒 true
  result: LegDecision | "ok" | "failed";  // place/skip-*/noop + ok/failed
  reason: string;        // skip/告警/失败原因（人读）
};
```

→ 落 `service/HYPE-copy/log/HYPE-copy-<target>-<date>.jsonl`，同步追加；同时 `pino` 一条到 journald（结构化，level 按 result：place/ok=info，skip/cap-warn=warn，error/failed=error）。

### 推送规则（下单动作后推，执行视角）

| 触发动作 | 是否推 | 文案要点 |
|---|---|---|
| `place`（dry-run） | ✅ | `[DRY-RUN] would-place` 前缀 + 目标标识 + 币·方向·量·价 + 换算 ratio + 成交估算 |
| `skip-unmappable` | ✅ 告警 | 标的无 hype 映射，跳过，不计入分母 |
| `skip-mindust` | ✅ 告警 | 我方名义 < 最小名义($10)，跳过 |
| `skip-capped` | ✅ 触顶告警 | 已达 MAX_DEPLOY_PCT，无法完全跟仓 |
| `min-capital` 建议 | ✅ | 推荐最低本金 + 当前本金可跟/跳过清单（来自 02 recommendMinCapital） |
| `noop`（delta=0 / `|delta|`<阈值） | ❌ **不推**（去重） | — |
| 执行失败 / 异常 | ✅ 告警 | failed/error + reason |

**去重铁律**：`noop`（delta=0 或 `|delta| < MIN_DELTA_PCT`）一律不推，避免碎步刷屏；但仍可按需落 JSONL（result=`noop`）供审计——推送与日志两条管线独立，不可因为「不推」就「不记」。

### 文案组装（独立跟单 bot，与 watch 区分）

- 前缀强标识执行视角：`[DRY-RUN]`（一期恒）；
- 必含字段：目标标识(targetId/截断地址) / 动作 / 币·方向·量·价 / 换算 ratio / 成交或拦截结论 / 告警类别（skip/触顶）/ 最低本金建议（开跟轮）；
- token/chat 走跟单独立配置，绝不复用 watch 的 tgToken（物理分离，避免两类消息混入同一会话）。

### 周期统计聚合（process/stats.mjs，纯函数）

输入：某 target 某时间窗的 JSONL 行数组；输出：

| 指标 | 算法 | 用途 |
|---|---|---|
| 笔数 | count(result∈{place,ok}) | 活跃度 |
| Σfee | sum(fee)（精度字符串累加，禁裸 +） | 成本 |
| 跟单净收益(fee erosion) | 名义收益 − Σfee（dry-run 下为估算口径，标注） | 评估侵蚀 |
| 滑点分布 | slippageBps 的 min/median/max/分桶 | 评估执行质量 |

- 所有金额累加用 `process/precision.mjs`（ROUND_DOWN，自实现；总纲 §3.3/§3.4 精度规则），禁裸 `parseFloat`/`+`、禁用 `tool/format` 做精度。
- dry-run 阶段 fee/收益均为估算口径，输出需标注 `dryRun: true`，不与真实成交混淆。

## i18n 文案

不涉及（service 端 TG 文案非前端 i18n 体系；推送文案直接内联中文/英文常量，集中在 `notify/index.mjs`）。

## 边界与约束

- **包含**：跟单 TG 推送（独立 tgChat，下单后推，dry-run 前缀，delta=0 去重，skip/触顶/失败/最低本金告警）；每动作 JSONL + journald(pino)；周期统计聚合（笔数/Σfee/净收益/滑点分布）纯函数。
- **不包含**：真实 fee（dry-run 为估算，主网阶段补真实 fill fee）；统计的定时调度落地（本件只提供聚合纯函数，调度由 05 部署或 main 循环挂载）；目标熔断阈值告警（总纲已知缺口，后续）；推送的多目标聚合（一期单目标）。
- **依赖未决**：03 动作结果对象的最终字段名以 03 为准；若 03 未提供 `fee`/`slippageBps` 估算，本件落 "0"/0 并在 stats 标注估算口径。

## 集成点

- 上游：03 收敛对账产出的动作结果（`service/HYPE-copy/process/reconcile.mjs` 等）。
- 复用：watch 的 `sendTelegram` 调用模式（Bot API）；`process/precision.mjs` 精度运算（ROUND_DOWN，自实现；总纲 §3.3/§3.4）——`tool/format` 仅展示 / `isAddress`；02 `recommendMinCapital` 输出（最低本金推送）。
- 配置：`targets.json` 的 `tgChat`（每目标）+ 根 `tgToken`（总纲 §3.1）。
- 路径：日志 `service/HYPE-copy/log/HYPE-copy-<target>-<date>.jsonl`（总纲 §3.5）。
- 下游：05 部署阶段挂载统计调度 / 确保 log 目录权限（trader-exec 用户可写）。
- 单测：`service/HYPE-copy/test/domain.test.mjs` 增 notify 文案组装 + stats 聚合用例。

## 验收标准

- [ ] 跟单推送走独立 `tgChat`/`tgToken`，与 watch 推送物理分离（不复用 watch token）。
- [ ] dry-run 动作推 `[DRY-RUN] would-place`，含目标/动作/币·方向·量·价/换算 ratio/结论。
- [ ] `noop`（delta=0 或 `|delta| < MIN_DELTA_PCT`）不推送（去重）。
- [ ] skip-unmappable / skip-mindust / skip-capped / 失败 / 最低本金建议均推对应告警。
- [ ] 每动作落一条 JSONL（含 `dryRun` 标记），字段与 §schema 一致，文件名按 `<target>-<date>` 跨日滚动。
- [ ] 同步写 journald(pino)，level 随 result 分级（place/ok=info、skip/cap-warn=warn、error=error）。
- [ ] stats 纯函数：从 JSONL 聚合出笔数 / Σfee（精度累加）/ 净收益(fee erosion) / 滑点分布；dry-run 口径标注。
- [ ] 推送与日志两条管线独立：`noop` 不推但可记。
- [ ] 金额累加用 `process/precision.mjs` 精度运算，无裸 `parseFloat`/`+`、不用 `tool/format` 做精度。
- [ ] notify 文案组装 + stats 聚合单测全绿。

## 验收场景（Given/When/Then）

### 场景 1：可映射 dry-run 动作推送 + 落日志
- **Given** 03 对账产出动作结果 `{targetId:"X", action:"place", coin:"ETH", side:"long", size:"0.625", refPx:"3000", dryRun:true, result:"place"}`；目标配 `tgChat=C1`
- **When** notify 消费该结果
- **Then** 向 `tgChat=C1`（跟单独立 token，非 watch token）推 `[DRY-RUN] 跟单目标X：开 ETH 多 0.625 @ 3000（ratio 6.25%）`；同步向 `HYPE-copy-X-<date>.jsonl` 追加一条字段一致的记录；pino 以 info level 写 journald

### 场景 2：delta=0 去重不推但可记
- **Given** 03 产出 `{targetId:"X", action:"skip", coin:"ETH", result:"noop", reason:"|delta|<MIN_DELTA_PCT"}`
- **When** notify 消费
- **Then** **不发送任何 TG 消息**（去重）；JSONL 仍按需追加一条 `result:"noop"`（两管线独立）；不抛错

### 场景 3：触顶告警推送 + warn 日志
- **Given** 03 对账判定 ETH 部署需求 562.5 > 余额×MAX(450) → `{action:"cap-warn", coin:"ETH", result:"skip-capped", reason:"已达资金上限"}`
- **When** notify 消费
- **Then** 向独立 tgChat 推触顶告警「已达资金上限，无法完全跟仓（封顶 450）」；JSONL 落一条 `result:"skip-capped"`；pino 以 warn level 写 journald

### 场景 4：周期统计聚合 fee 侵蚀与滑点
- **Given** 某 target 当日 JSONL 含 3 条 `place`（fee 各 "1.2"/"0.8"/"1.0"，slippageBps 12/8/20）、2 条 `noop`、1 条 `skip-capped`
- **When** stats.mjs 聚合该窗口
- **Then** 笔数=3（只计 place/ok）、Σfee="3.0"（精度累加非裸 +）、滑点 min=8/median=12/max=20、净收益按估算口径并标注 `dryRun:true`；noop/skip-capped 不计入笔数
