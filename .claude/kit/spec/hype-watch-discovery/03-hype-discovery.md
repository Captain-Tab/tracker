# Spec 03 · HYPE-discovery（Phase 2）

> 引用总纲 `00-overview.md`。config schema 见 §3.2，端点/NFR 见 §3.5 与总纲 NFR。冲突以总纲为准。
> 依赖：02（读 `HYPE-watch/config.json` 做 excludeWatched）。落地直接 `/k:task`。

## 背景与目的

新建 `service/HYPE-discovery/`，对标 sodex-discovery，第一步**只做 leaderboard 粗筛**：按 pnl/vlm 多窗口门槛筛候选 + 排除已监听 + 落盘 + TG。逐笔深度评估（evaluate/score）留第二步，**本次不建**。

## 选定方案

落点 `service/HYPE-discovery/`：
```
main.mjs            --dry-run / --no-push / --limit
config.json         总纲 §3.2 schema（TG 留空）
api/index.mjs       createRowScanner（流式逐行）+ streamLeaderboardRows（不缓存全文）
process/
  collect.mjs       流式拉 leaderboard → 逐行 flatten + 排除已监听 + 内联门槛（只留通过者）
  filter.mjs        passesThreshold（纯，流式内联）+ rankTopK（pnl 降序 + topK + truncated 计数）
  output.mjs        md/json 落盘（log/）+ TG（沿用 sodex 前5详展/紧凑样式）
```
（不建 evaluate/score）

## 设计概要

### 数据来源
leaderboard `GET .../Mainnet/leaderboard` → `leaderboardRows[].{ethAddress, accountValue, windowPerformances[day/week/month/allTime].{pnl,roi,vlm}}`，展平为 `{address, accountValue, day, week, month, allTime}`。

### 筛选规则
- 门槛优先 `pnl/vlm`（绝对额，口径明确），**不用 roi**（roi 污染未验证，总纲已记）。
- `excludeWatched=true` → 读 `HYPE-watch/config.json` 的 `watches[].address`（小写归一）剔除。路径解析对标 sodex-discovery 读 watch.config 的方式（相对 service 根定位 `../HYPE-watch/config.json`，文件缺失→空排除集不崩）。
- 主窗口 `window`（默认 month）排序，取 topK；**超出 topK 的过门槛者计入 `truncated` 显式记日志**（不静默截断）。

### NFR（总纲 NFR 落实，已实现）
- **流式逐行解析已落地**：`createRowScanner`（花括号配对 + 字符串态状态机，每 push 整体重扫保留尾部，零依赖）+ `streamLeaderboardRows`（`res.body` 异步迭代 + `TextDecoder({stream})`，不缓存 32MB 全文）。门槛在流式中内联（39k 候选不落地）。**实测峰值 98MB**（对比非流式 264MB）。
- 超时 40s（实测 8-22s 不稳定）+ 失败跳过本轮；单行 JSON 解析失败跳过该行；字段缺失窗口跳过；0 候选照常出文件。

> ⚠️ **Pitfall（scanner 状态机）**：流式增量解析切忌让 `depth/inString` 等扫描状态**跨 push 保留又从 buf 头重扫**——会重复计数花括号、depth 永不归零、buf 永不裁剪，内存反升（实测一版升到 546MB）。正解：每次 push 重置状态、整体重扫已裁到对象边界的小 buf。单测必须用**逐字符喂入**验证 chunk 边界（整块喂入会漏掉此类 bug）。

## i18n 文案

无。

## 边界与约束

- 包含：leaderboard 粗筛 + excludeWatched + 落盘 + dry-run/no-push。
- 不包含：逐笔 evaluate/score（第二步）；roi 作主门槛；testnet。

## 集成点

- 复用 `service/tool/format.mjs`、`service/lib/WARP/index.mjs`。
- 读 `HYPE-watch/config.json`（excludeWatched）。
- 参照抄写 `sodex-discovery/{process,api}`（不共享代码）。
- 输出 `HYPE-discovery/log/`（gitignore）。

## 验收标准

- [ ] `node service/HYPE-discovery/main.mjs --dry-run` 拉 leaderboard、按 pnl/vlm 门槛粗筛、排除已监听、输出候选 md/json。
- [ ] `--no-push` 落盘不推；0 候选照常出文件。
- [x] 流式解析峰值显著低于 264MB（实测 98MB）。
- [ ] leaderboard 拉取失败 → 跳过本轮不崩；字段缺失行被跳过。
- [ ] topK 截断显式记日志（truncated），不静默丢弃过门槛者。

## 验收场景（Given/When/Then）

### 场景 1：粗筛排除已监听（Happy Path）
- **Given** leaderboard 含地址 A（month pnl=20万U、vlm=800万U）与 B（A 已在 HYPE-watch/config 的 watches），门槛 month pnl≥10万U & vlm≥500万U
- **When** `node service/HYPE-discovery/main.mjs --dry-run`
- **Then** 候选含满足门槛且未监听地址，**不含 A**（excludeWatched 滤除）；输出 md/json 到 log

### 场景 2：拉取失败兜底
- **Given** leaderboard 端点超时/返回非 JSON
- **When** 执行 discovery
- **Then** 日志记错误、跳过本轮、进程正常退出（不渲染空数据、不崩）
