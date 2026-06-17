# Value Chain 失败状态 UI 优化

## 核心需求

**问题描述：**
- Value Chain 某步骤失败时，失败步骤之前已完成的步骤错误显示为 `pending`（灰色）
- stake 失败后重试 (Try Again) 错误回退到 transfer 步骤重新执行
- Value Chain 直接开始的流程没有 `CollapsiblePanel` 包装，与 Base Chain 流程 UI 不一致

---

## 解决方案

### 1. getStepStatus 失败状态处理

修改 `getStepStatus` 函数，在 `failed` 状态下根据 `stepIndex` 判断各步骤状态：

```typescript
if (type === "failed") {
  // 构建实际执行的步骤顺序
  const actualSteps = [];
  if (config.needsTransfer) actualSteps.push("transfer");
  if (config.needsStake) actualSteps.push("stake");
  actualSteps.push("approve", "confirm");

  const currentStepIndex = actualSteps.indexOf(step);
  const failedStepIndex = currentState.stepIndex;

  if (currentStepIndex < failedStepIndex) return "completed";   // 失败前的步骤 → 绿色 ✓
  if (currentStepIndex === failedStepIndex) return "processing"; // 失败步骤 → loading spinner
  return "pending";  // 失败后的步骤
}
```

### 2. RETRY 逻辑修复

stake 失败后直接重试 stake（不再错误回退到 transfer）：
- `transfer` 完成后资金已在 EVM-Funding，无需重新执行
- RETRY 时从失败步骤本身重新开始，而非从头

### 3. Value Chain UI 统一

Value Chain 直接开始的流程也使用 `CollapsiblePanel` 包装：
- 与 Base Chain 流程 UI 结构保持一致
- 支持失败状态显示 WarningIcon
- 面板支持折叠/展开

---

## 失败状态 UI 规范

| 阶段 | WarningIcon | Loading Spinner | 面板可折叠 |
|---|---|---|---|
| **Base Chain 失败** | ✅ 显示 | ❌ 不显示 | ✅ 是 |
| **Value Chain 失败** | ✅ 显示 | ✅ 显示（步骤状态为 processing） | ✅ 是 |

**关键实现（CollapsiblePanel）：**
```typescript
const canToggle =
  (isActive && isExpandable) ||  // 当前激活且可展开
  isFailed;                       // 或者失败状态（保持可折叠）
```

---

## 核心组件列表

| 文件 | 修改内容 |
|------|----------|
| `useValueChainDeposit.tsx` L426-476 | getStepStatus 添加 failed 状态处理 |
| `useValueChainDeposit.tsx` L312-341 | RETRY 逻辑（直接重试当前失败步骤）|
| `Trading.tsx` L327-349 | renderValueChainUI 添加 CollapsiblePanel 包装 |

---

## 影响

- ✅ 失败状态下用户能清晰看到哪些步骤已完成（绿色 ✓）
- ✅ Try Again 重试当前步骤而非回退到最初步骤
- ✅ Value Chain 和 Base Chain UI 结构统一，视觉体验一致

---

## 更新记录

- 2025-12-19 Value Chain 失败状态 UI 优化
  - getStepStatus 函数添加 failed 状态特殊处理
  - RETRY 逻辑修复：stake 失败后直接重试 stake
  - Value Chain 直接开始的流程添加 CollapsiblePanel 包装
