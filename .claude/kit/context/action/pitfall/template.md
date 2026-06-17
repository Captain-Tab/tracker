---
id: [kebab-case]
tags: [tag1, tag2, tag3]
related_feature: [context-feature-id]
severity: high | medium | low
gate: true | false
gate_rule: [一句话检查规则，仅 gate:true 时填写]
trigger: [触发关键词列表，仅 gate:true 时填写，用于匹配 spec/plan 内容]
date: YYYY-MM-DD
---

# [标题]

## 问题描述

[遇到了什么现象]

## 调试过程中的误判

[最初以为是什么，实际是什么，为什么会误判]

## 根因

[真正的原因]

## 避免方式

[下次开发时应该先做什么验证]

---

## Gate 分类说明

> **gate: true** — 此问题可能在其他功能中重复发生，自动成为 plan 阶段的预检门
> **gate: false** — 一次性问题，仅供查询参考
>
> 判断标准：涉及通用模式（MobX/calculate/签名等）、不限于特定功能、根因是"忘了固定步骤"→ gate:true

---

> 记录完成后：更新 `pitfalls/index.json`，添加对应条目。
