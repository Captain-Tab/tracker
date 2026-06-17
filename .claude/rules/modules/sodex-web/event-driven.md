---
description: 事件驱动方案的风险检查规则
globs: "**/eventBus*,**/hooks/**,**/models/**,**/*Polling*,**/*Status*"
---

# 事件驱动风险检查

当方案依赖事件（eventBus/自定义事件/回调）驱动状态变更时，必须逐项检查以下三个维度：

## 1. 跨系统干扰
- 该事件是否会被其他系统误触发？
- 例：WS 推送和轮询都 emit 同一事件 → 重复处理

## 2. 同系统内干扰
- 同一来源的不同操作类型是否都会触发该事件？
- 事件 payload 是否足够区分目标场景？
- 例：native_transfer 轮询检测到 deposit/withdraw/stake/transfer，但弹窗只关心 deposit

## 3. 接收端状态覆盖
- 同一组件是否监听多个事件且写入同一个 state？
- 事件 A 设置的状态是否会被事件 B 覆盖？
- 例：NATIVE_TRANSFER_ARRIVED 设 completed，DEPOSIT_RECORD_REFRESH 的 updateStatus 又覆盖回 waiting

## 检查清单

```
□ 事件来源唯一性：是否需要专用事件避免跨系统干扰？
□ payload 精确性：接收端是否有足够上下文过滤非目标操作？
□ 状态写入穷举：目标 state 的所有写入路径是否互不冲突？
```
