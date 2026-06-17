# 表单金额被 useEffect 覆盖问题修复

## 核心需求

**问题 1 描述**：
- 用户输入金额后点击 Deposit
- OKX 钱包弹出时显示 "第三方合约执行失败"
- 跳过 Approve 阶段直接进入 Bridge 导致失败

**问题 2 描述**：
- 用户输入金额后点击 "Enable Trading" 按钮
- 金额变成 0

---

## 根本原因分析

### 问题 1：交易流程中金额被覆盖

```
用户输入金额 (5)
    ↓
点击 Deposit → tradingStatus = "preview"
    ↓
某些状态变化（selectedChain/isNewUser/token）
    ↓
触发 useEffect → 调用 auto-fill 函数
    ↓
autoFillAmount(余额) → setValue("amount", "0.00")
    ↓
金额 0 → needsApprove = false → 跳过 Approve
    ↓
Bridge 合约拒绝 0 金额 → "第三方合约执行失败"
```

### 问题 2：Enable Trading 后金额被覆盖

```
用户输入金额 (5)
    ↓
点击 Enable Trading（此时 tradingStatus 仍是 "idle"）
    ↓
Enable Trading 完成 → user.id 被设置
    ↓
isNewUser 从 true → false
    ↓
触发依赖 isNewUser 的 useEffect
    ↓
调用 handleValueChainSwitchForExistingUser()
    ↓
守卫 tradingStatus !== "idle" 不生效（因为仍是 idle）
    ↓
autoFillAmount(余额) → 金额变成 0
```

---

## 解决方案

### 修复 1：添加 tradingStatus 守卫

在 4 个 auto-fill 函数中添加守卫，交易流程开始后不覆盖用户输入：

```typescript
// deposit/index.tsx
const handleBaseChainSwitch = useCallback(() => {
  if (tradingStatus !== "idle") {
    console.log("[handleBaseChainSwitch] 跳过：交易流程进行中");
    return;
  }
  const balance = mag7Data.base.balances[currentToken] || "0";
  autoFillAmount(balance);
}, [mag7Data.base.balances, currentToken, autoFillAmount, tradingStatus]);

// 同样处理：
// - handleValueChainSwitchForNewUser
// - handleValueChainSwitchForExistingUser
// - handleTokenSwitchForValueChain
```

### 修复 2：使用 Ref 避免 isNewUser 变化触发 useEffect

```typescript
// deposit/index.tsx

// Ref 用于读取最新值，但不触发 useEffect
const isNewUserRef = useRef(isNewUser);
isNewUserRef.current = isNewUser;

// useEffect 只依赖 selectedChain?.chain，不依赖 isNewUser
useEffect(() => {
  if (selectedChain?.chain === "VALUE_CHAIN") {
    if (isNewUserRef.current) {
      handleValueChainSwitchForNewUser();
    } else {
      handleValueChainSwitchForExistingUser();
    }
  }
}, [selectedChain?.chain]); // 移除 isNewUser 依赖
```

### 修复 3：添加 0 金额验证

```typescript
// useBaseChainDeposit.ts
const amountRaw = parseUnits(formData.amount, actualDecimals);

if (amountRaw === BigInt(0)) {
  throw new Error("Deposit amount cannot be zero");
}
```

---

## 核心组件列表

| 文件 | 修改内容 |
|------|----------|
| `deposit/index.tsx` | 添加 tradingStatus 守卫、isNewUserRef、改进注释 |
| `useBaseChainDeposit.ts` | 添加 0 金额验证 |

---

## 与已有修复的兼容性

| 修复 | 文件 | 作用层次 | Ref 名称 |
|------|------|----------|----------|
| 本次修复 | `deposit/index.tsx` | 表单 auto-fill | `isNewUserRef` |
| 2026-02-05 修复 | `useVaultDeposit.ts` | 状态机流程控制 | `isNewUserSnapshotRef` |

两个 Ref 作用于不同层次，互不干扰：
- `isNewUserRef`：避免 auto-fill 覆盖金额
- `isNewUserSnapshotRef`：确保状态机正确执行 Enable Trading

---

## 修改前后对比

| 场景 | 修改前 | 修改后 |
|------|--------|--------|
| 交易流程中状态变化 | 触发 auto-fill 覆盖金额 | 守卫阻止，保留用户输入 |
| Enable Trading 完成 | isNewUser 变化触发 auto-fill | Ref 方案不触发 useEffect |
| 金额为 0 | Bridge 合约模拟失败 | 提前抛出友好错误 |

---

## 更新记录

- 2026-03-06 修复表单金额被 useEffect 覆盖问题
  - 添加 `tradingStatus !== "idle"` 守卫到 4 个 auto-fill 函数
  - 添加 `isNewUserRef` 避免 Enable Trading 后金额被覆盖
  - 添加 0 金额验证，提前抛出错误
  - 修复 OKX 钱包 "第三方合约执行失败" 问题
