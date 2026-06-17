# UI 反馈优化（Confirm 文案三阶段 & Try Again 超时）

## 核心需求

1. **Base Chain Confirm 步骤文案不清晰**：用户不知道"Confirm"按钮代表等待钱包确认还是交易进行中
2. **Try Again 按钮没有超时机制**：点击后按钮长时间显示 "Retrying..."，UI 卡住
3. **失败状态 UI 不友好**：Value Chain 失败时面板无法折叠，WarningIcon 和 loading spinner 没有同时显示

---

## 解决方案

### 1. Base Chain Confirm 步骤文案三阶段

| 状态 | 显示文案 | 说明 |
|---|---|---|
| **idle** | "Confirm in wallet" | 等待用户在钱包中确认交易 |
| **processing** | "Depositing into SoDEX (~3mins)" | 交易已提交到链上，等待确认和入账 |
| **completed** | "Confirm" | Bridge 确认完成，显示完成状态 |

**文案切换时机：**
- approve 完成后 → idle: "Confirm in wallet"
- 用户确认 bridge 交易后 → processing: "Depositing into SoDEX (~3mins)"
- bridge 交易确认后 → completed: "Confirm"

**相关文件：** `DepositToSodexStep.tsx` L45-68

### 2. Try Again 按钮 3 秒超时机制

```typescript
// 点击 Try Again 时
onClick: () => {
  if (isRetrying) return;
  setIsRetrying(true);
  vaultDeposit.retry();

  // 3秒后自动隐藏按钮
  retryTimeoutRef.current = setTimeout(() => {
    setIsRetrying(false);
    setShowTryAgain(false);
  }, 3000);
}

// 新错误时清理超时定时器
onError: (error) => {
  clearRetryTimeout();  // 清理超时定时器
  setIsRetrying(false);
  setShowTryAgain(isUserRejection);
}
```

**相关文件：** `Trading.tsx` L150-200

### 3. 失败状态 UI 改进

- 面板在失败状态下保持可折叠（`CollapsiblePanel` 的 `canToggle` 逻辑添加 `isFailed`）
- Value Chain 失败时同时显示 WarningIcon（面板级别）和 loading spinner（步骤级别）

**关键：** 失败步骤状态保持 `processing` 而非 `error`，这样步骤级别的 loading spinner 继续显示

**相关文件：** `CollapsiblePanel.tsx` L31-55, `useValueChainDeposit.tsx` L434-523

---

## 核心组件列表

| 文件 | 修改内容 |
|------|----------|
| `DepositToSodexStep.tsx` L45-68 | Confirm 步骤文案三阶段逻辑 |
| `Trading.tsx` L150-200 | Try Again 超时机制（setTimeout 3秒）|
| `CollapsiblePanel.tsx` L31-55 | 失败状态下面板保持可折叠 |
| `useBaseChainDeposit.ts` L380-420 | Base Chain UI 步骤状态更新 |
| `useValueChainDeposit.tsx` L434-523 | Value Chain 失败状态 processing 处理 |

---

## 影响

- ✅ 用户对 Base Chain 流程进度的理解更清晰
- ✅ Try Again 点击后 3 秒自动恢复，避免按钮状态卡住
- ✅ 失败状态的交互体验更友好，面板可折叠查看其他阶段

---

## 更新记录

- 2025-12-05 UI 反馈优化
  - Base Chain Confirm 步骤文案三阶段细化
  - Try Again 按钮点击后 3 秒自动隐藏
  - 失败状态下面板保持可折叠
  - Value Chain 失败时同时显示 WarningIcon 和 loading spinner
