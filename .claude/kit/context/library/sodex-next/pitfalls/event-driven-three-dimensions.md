---
id: event-driven-three-dimensions
tags: [event, eventBus, polling, websocket, state-machine, race-condition]
related_feature: shared
severity: high
gate: true
gate_rule: 方案依赖事件驱动（eventBus/自定义事件/回调/轮询/WS 推送）变更状态时，必须逐项审查三维度——跨系统干扰、同系统内 payload 区分度、接收端状态写入互斥
trigger: [eventBus, emit, on(, 事件, 轮询, polling, websocket, ws 推送, 推送, native_transfer, NATIVE_TRANSFER_ARRIVED, callback, 回调]
date: 2026-05-09
---

# 事件驱动方案三维度审查

## 问题描述

事件驱动方案（eventBus / 自定义事件 / 回调 / 轮询触发 emit / WS 推送）容易在以下三类场景中出 bug：

1. **跨系统干扰**：WS 推送和轮询都 emit 同一事件 → 接收端被重复处理
2. **同系统内干扰**：同一来源不同操作类型都触发该事件，但 payload 不足以区分目标场景
3. **接收端状态覆盖**：同一组件监听多个事件且写入同一个 state，事件 A 设的状态被事件 B 覆盖

## 调试过程中的误判

历史误判模式：

- 以为"事件加上了，状态就会改"——忽略多个事件源共用一个事件名时的重复触发
- 以为"payload 有 type 字段就够了"——接收端只用其中一部分字段过滤，剩余维度漏判
- 以为"两个事件 handler 互不相关"——实际写入同一个 state，时序上后者覆盖前者

## 根因

事件驱动天然解耦发送端和接收端。解耦的代价是**全局命名空间的语义被发送端各自定义**——接收端无法约束谁可以 emit、emit 时带什么 payload、什么时候 emit。如果不在设计阶段穷举：

- 谁会 emit 这个事件？（跨系统）
- 接收端关心的是其中哪些子场景？（payload 区分）
- 同一 state 被几个事件共同写？（写入互斥）

任何一条漏审 → 上线后随机性 bug。

## 避免方式

### 三维度审查清单

设计或修改事件驱动方案时，逐项过：

- [ ] **跨系统干扰**：grep 全部 `emit('eventName')` / 全部 `eventBus.emit` 调用点，列出所有发送方，确认是否需要专用事件名分流
- [ ] **payload 区分度**：列出接收端关心的子场景，逐条检查 payload 字段是否足以过滤——找出 payload 中**实际被接收端用到的字段**和**接收端忽略的字段**
- [ ] **状态写入穷举**：定位接收端写入的目标 state，grep 该 state 的所有写入点（多个事件 handler / 直接 setState / store action），确认时序冲突时哪一方应胜出

### 历史案例

**案例 1：WS + 轮询双触发**
WS 推送和轮询都 emit `DEPOSIT_RECORD_REFRESH` → 同一笔订单被处理两次。
修复：拆分专用事件 `WS_DEPOSIT_PUSH` / `POLL_DEPOSIT_REFRESH`，接收端按需订阅。

**案例 2：payload 区分度不足**
`native_transfer` 轮询会检测 deposit/withdraw/stake/transfer 全部链上动作并统一 emit `NATIVE_TRANSFER_ARRIVED`，弹窗只关心 deposit 但 payload 没区分操作类型。
修复：payload 加 `actionType`，接收端 filter。

**案例 3：状态覆盖**
组件同时监听 `NATIVE_TRANSFER_ARRIVED`（设 completed）和 `DEPOSIT_RECORD_REFRESH`（updateStatus 设 waiting），后到的 refresh 把 completed 覆盖回 waiting。
修复：状态机化，禁止 completed → waiting 的逆向迁移。

### 设计阶段强制问

- 这个事件名在仓库中**只有一个 emit 调用点**吗？不是 → 标 D1 风险
- 接收端**忽略**的 payload 字段，是否真的与本接收端无关？
- 接收端写入的 state，**所有写入路径**是否枚举完毕？

---

**相关文件**：
- 历史 emit/on 模式可 grep `eventBus|emit\\(|\\.on\\(` 定位
