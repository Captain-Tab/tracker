---
id: trade-feerate-mobx
tags: [mobx, store, react, 响应式]
related_feature: trade-feerate
severity: high
trigger: [store, mobx, observable, 响应式]
date: 2026-03-22
---

# MobX 缺少 makeObservable 导致组件不渲染

---

## 问题描述

trade feerate 数据成功写入 store（日志显示 FETCH DONE），但组件始终显示 fallback，数据从未展示出来。

## 调试过程中的误判

**误判 1：关注条件逻辑**
初始怀疑 `isLogin` / `address` 时序不一致，导致 `clear()` 被提前调用清空数据。这是表象，不是根因。

**误判 2：日志"空白期"归因错误**
日志显示 fetch 成功后有 14 秒空白，随后出现 `usingFallback:true`。误以为是状态变化导致数据被清空。
实际：空白期间**没有任何 render 日志**，说明组件根本没有重新渲染，而不是渲染后被清空。

**误判 3：假设装饰器自动生效**
看到 `@observable` 就默认响应式正常工作，没有验证 `makeObservable` 是否被调用。

## 根因

`feeRate.ts` store 缺少 `makeObservable(this)` 调用。项目中其他所有 store 都有这一行，唯独这个没有，导致 `@observable` 装饰器不生效，数据变化无法触发组件重新渲染。

```ts
// ❌ feeRate.ts 缺少
constructor() {
  // makeObservable(this) ← 遗漏
}

// ✅ 其他 store 的写法
constructor() {
  makeObservable(this)
}
```

## 避免方式

新建 MobX store 时，**先验证响应式是否工作**，再深入业务逻辑：

1. 检查 constructor 是否有 `makeObservable(this)`
2. 写入 store 后，若组件没有重新渲染 → 优先怀疑响应式配置，而非条件逻辑
3. 调试时"fetch 成功但无 render 日志" = 响应式断裂，直接去查 store 配置
