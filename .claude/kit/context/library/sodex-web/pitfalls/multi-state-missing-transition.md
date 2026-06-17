---
id: multi-state-missing-transition
tags: [state-machine, redirect, useEffect, spec]
related_feature: maintenance
severity: high
gate: true
gate_rule: 需求涉及多状态（≥3 个枚举值）时，spec 阶段必须构建 N×N 状态转换矩阵，逐格填写期望处理
trigger: [状态, state, level, status, 模式, mode, 维护, 枚举, enum]
date: 2026-04-14
---

# 多状态遗漏转换路径：spec 定义错误导致 check 也无法捕获

## 问题描述

维护模式有 3 个等级（0=正常, 1=全局维护, 2=链维护）。useEffect 只处理了"进入维护"(0→1) 和"恢复正常"(1→0) 两条路径，遗漏了"降级"(1→2) 路径。导致从全局维护切换到链维护时，用户卡在 /maintenance 页面无法离开。

## 调试过程中的误判

这不是一个"开发写错代码"的问题。spec 场景 7 明确写了"模式二下 /maintenance 页可访问，用户可手动导航"，check 对照 spec 验证代码，判定通过。逻辑报告也将 1→2 标记为 ✅。误判的根源在 spec 设计阶段——只思考了两条主路径（进入/恢复），没有穷举所有转换。

## 根因

设计阶段缺少状态转换矩阵。3 个状态有 9 种转换（含自身不变），但 spec 只覆盖了 2 条主路径。`level === 0 && isMaintenancePage` 这个条件是在"只有恢复正常才跳回"的思路下写出的，而非"只要不是全局维护就该离开维护页"。

## 避免方式

当需求涉及 ≥3 个状态值时，在 spec 阶段强制构建完整的状态转换矩阵：

```
for each (fromState × toState × currentLocation) {
  问：用户应该看到什么？（而非：代码会做什么？）
}
```

逐格填写后，自然会发现 1→2 这格的期望是"跳回交易页"而非"留在维护页"。

修复方式：将 `status.level === 0` 改为 `!status.isFullMaintenance`，一个条件覆盖 level=0 和 level=2 两种离开全局维护的情况。
