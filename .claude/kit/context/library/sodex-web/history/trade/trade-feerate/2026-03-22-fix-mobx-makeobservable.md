# 修复 MobX 响应式失效

**日期**: 2026-03-22 | **类型**: fix | **范围**: trade-feerate

---

## 变更概述

在 `feeRate.ts` 中添加 `makeObservable(this)` 构造函数调用，修复 MobX 6 装饰器不生效导致的响应式失效问题。

---

## 核心变更

### 1. 添加 makeObservable 调用

**文件**: `src/models/feeRate.ts`

```typescript
import { action, observable, runInAction, makeObservable } from 'mobx';

export default class FeeRate {
  @observable spotFeeData: FeeRateData | null = null;
  @observable perpsFeeData: FeeRateData | null = null;
  // ...

  constructor() {
    makeObservable(this);
  }
  
  // ...
}
```

---

## 根因分析

- **问题现象**：API 成功获取费率数据后，组件不重新渲染，始终显示 fallback
- **初始误判**：以为是 `isLogin` vs `address` 时序问题
- **真正原因**：`feeRate.ts` 缺少 `makeObservable(this)` 调用
- **MobX 6 要求**：使用装饰器语法（`@observable`, `@action`）时，必须在构造函数中调用 `makeObservable(this)`，否则装饰器不生效

---

## 调试过程教训

1. 应优先验证基础假设（响应式是否工作）再分析业务逻辑
2. FETCH DONE 后没有 render 日志 → 响应式链路断裂
3. 对比其他 store 发现都有 `makeObservable`，唯独 `feeRate.ts` 遗漏

---

## 文件变更列表

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `src/models/feeRate.ts` | 修改 | 添加 constructor + makeObservable(this) |

---

## 关联文档

- **Reference**: `.cursor/kit/context/library/sodex-web/reference/trade/trade-feerate-guide.md`
