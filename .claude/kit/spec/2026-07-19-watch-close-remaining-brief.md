# Spec: watch 平仓消息剩余仓位摘要化 + 全景平仓历史收敛

> 日期：2026-07-19 · 范围：sodex-watch + HYPE-watch · 类型：TG 消息渲染优化

## 背景

HYPE 大户普遍同时持有多个仓位，平仓合并消息中「剩余仓位」逐仓渲染完整卡片（每仓 10+ 行：数量/开仓价/标记价/仓位价值/浮盈/强平价/保证金/离场挂单），平 1 仓剩 N 仓时消息长达 40+ 行，平仓本身的关键信息被淹没。剩余仓位的核心价值仅是回答「清仓离场还是调仓」，且完整卡片另有两个兜底入口（START WATCH / 每日镜像）。

## 需求 1：剩余仓位摘要化

`buildCloseMessage` 中剩余仓位从逐仓 `pushPositionCard` 改为每仓一行：

```
剩余仓位 (3)
  🟢 SNDK 5x   231.5 → 245.2   +$1.2k
  🔴 ETH 3x    3,098.2 → 3,121.4   -$300
  🟢 CL 10x    64.8 → 64.9   +$85
```

- 方向：🟢 = LONG（做多）、🔴 = SHORT（做空）
- 行要素：emoji 方向 · 币种 · 杠杆倍数（`leverage.value` + "x"）· 开仓价 → 标记价（按 `pricePrecision` 格式化）· 浮盈（`unrealizedPnl`，`fmtUsd` 带符号）
- 标题：`剩余仓位 (N)`，N 为剩余仓数
- 不显示：持仓数量、名义价值、保证金、强平价、离场挂单

### 涉及文件

| 文件 | 位置 | 改动 |
|---|---|---|
| service/HYPE-watch/process/render.mjs | buildCloseMessage (136-148) | 卡片循环 → 一行摘要；签名移除闲置 `exitOrders` 参数 |
| service/HYPE-watch/process/watcher.mjs | buildCloseMessage 调用处 (~415) | 调用同步去掉 exitOrders 实参 |
| service/sodex-watch/process/render.mjs | buildCloseMessage (192-206) | 同构（保留其 `size !== 0` 过滤）；签名移除闲置 `reduceOnly` 参数 |
| service/sodex-watch/process/watcher.mjs | buildCloseMessage 调用处 | 调用同步去掉 reduceOnly 实参 |

## 需求 2：全景平仓历史默认条数 2 → 1

START WATCH 与每日镜像（SNAPSHOT）消息中平仓历史默认显示条数从 2 改为 1。`--history-limit` CLI flag 覆盖机制保留。

### 涉及文件

| 文件 | 位置 | 改动 |
|---|---|---|
| service/HYPE-watch/process/watcher.mjs | :64 | `?? 2` → `?? 1` |
| service/HYPE-watch/process/dailySnapshot.mjs | :44 | 兜底 `?? 2` → `?? 1` |
| service/sodex-watch/process/watcher.mjs | :55 | `?? 2` → `?? 1` |
| service/sodex-watch/process/snapshot.mjs | :24 | `?? 2` → `?? 1` |

## 明确排除

- OPEN / INCREASE / REDUCE / 离场单 / START / SNAPSHOT 的仓位卡片渲染逻辑不动
- 平仓消息底部「平仓历史」（每平仓币 1 条，showCount=false）逻辑不动
- 清仓分支 `📊 仓位：无持仓` 原样保留
- 平仓摘要行（`平仓：BTC LONG`）不动

## 验收场景

1. **Given** 地址平 1 仓且剩 3 仓（含多空混合），**When** 触发平仓合并消息，**Then** 剩余仓位为 3 行摘要（emoji 方向/币种/杠杆/开仓→标记/浮盈），无完整卡片分隔线。
2. **Given** 地址全部清仓，**When** 触发平仓合并消息，**Then** 显示 `📊 仓位：无持仓`，与现状一致。
3. **Given** 剩余仓位含 SHORT 且标记价高于开仓价，**When** 渲染摘要行，**Then** emoji 为 🔴 且浮盈为负值，方向与盈亏自洽。
4. **Given** 服务以默认参数启动，**When** 推送 START WATCH 消息，**Then** 平仓历史仅 1 条。
5. **Given** 到达每日镜像时间（sodex snapshot / HYPE dailySnapshot），**When** 推送 SNAPSHOT 消息，**Then** 平仓历史仅 1 条。
6. **Given** 启动时传 `--history-limit=3`，**When** 推送全景消息，**Then** 平仓历史 3 条（flag 覆盖仍生效）。
7. **Given** 触发 OPEN/INCREASE/REDUCE/离场单消息，**When** 渲染，**Then** 输出与改动前完全一致。

## 验证与部署

1. `node --test` 跑 HYPE-watch/test、sodex-watch/test 现有测试
2. 冒烟：本地构造 0 仓 / 1 仓 / 多空混合输入调 `buildCloseMessage` 检查输出
3. `make sync`（先 dry-run 核对差异）→ `make restart-watch restart-hype-watch`

<!-- VERDICT=simple SCORE=0 REDLINE=none (2026-07-19 complexity-score.sh 实测) -->
