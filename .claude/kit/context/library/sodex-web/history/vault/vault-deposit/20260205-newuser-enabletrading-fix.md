# 新用户 Enable Trading 问题修复

## 核心需求

**问题描述**：
- 新用户没有 `user.id`
- 在 Vault 进行 deposit
- 在 Value Chain 阶段报错 "API key not found"

**根本原因**：
- Base 阶段完成后，WS 推送 `SODEX_USER_NOTICE` 消息
- 触发 `spotOrder.ts` 中的 `rootUser.setUserIdByAddress(data.userAddress)`
- 导致 `user.id` 被设置，`isNewUser` 从 `true` 变为 `false`
- 状态机跳过了 `enable_trading` 阶段

---

## 解决方案

### 1. isNewUser 快照机制

在 `execute()` 开始时锁定 `isNewUser` 状态，整个流程使用快照值：

```typescript
// useVaultDeposit.ts
const isNewUserSnapshotRef = useRef<boolean>(false);
const configRef = useRef({
  needsBaseChain: selectedChain === "BASE_ETH",
  isNewUser: false
});

const execute = useCallback(() => {
  // 🔒 锁定 isNewUser 快照
  isNewUserSnapshotRef.current = !user.id;
  configRef.current.isNewUser = isNewUserSnapshotRef.current;
  dispatch({ type: 'START' });
}, [user.id]);
```

### 2. Enable Trading 重试机制

等待 `user.id` 就绪，最多重试 10 次（每次 1 秒）：

```typescript
case 'enable_trading': {
  const MAX_RETRY = 10;
  const RETRY_INTERVAL = 1000;
  
  let userId = user.id;
  let retryCount = 0;
  
  while (!userId && retryCount < MAX_RETRY) {
    retryCount++;
    await new Promise(r => setTimeout(r, RETRY_INTERVAL));
    await user.getUserIdByAddress(address! as `0x${string}`);
    userId = user.id;
  }
  
  if (!userId) {
    throw new Error('User account creation timeout, please try again');
  }
  // ... 执行签名
}
```

### 3. 兜底错误处理

- 超时后抛出友好错误提示（英文，由 UI 层统一处理）
- 签名取消/失败有明确的错误类型

---

## 核心流程图

```
新用户点击 Deposit
    ↓
execute() 锁定 isNewUser 快照 = true
    ↓
dispatch({ type: 'START' })
    ↓
[Base Chain 阶段]
    ├─ Approve
    ├─ Confirm (Bridge)
    └─ Settle (合约轮询)
    ↓
WS 推送 → setUserIdByAddress → user.id 被设置
    ↓ (但 isNewUser 快照仍为 true！)
dispatch({ type: 'BASE_CHAIN_COMPLETED' })
    ↓
reducer 检查 configRef.current.isNewUser = true
    ↓
返回 { type: 'enable_trading' }  ← 不会被跳过！
    ↓
[Enable Trading 阶段]
    ├─ 等待 user.id 就绪（已有，无需等待）
    └─ 执行签名 signMessage()
    ↓
dispatch({ type: 'ENABLE_TRADING_COMPLETED' })
    ↓
[Value Chain 阶段]
    ├─ Transfer
    ├─ Stake
    ├─ Approve
    └─ Confirm
    ↓
✅ 完成
```

---

## 核心组件列表

| 文件 | 修改内容 |
|------|----------|
| `useVaultDeposit.ts` | 快照机制、重试逻辑、兜底处理 |
| `useBaseChainDeposit.ts` | SETTLE_MAX_ATTEMPTS 增加到 15 |

---

## 修改前后对比

| 场景 | 修改前 | 修改后 |
|------|--------|--------|
| 新用户 Base Chain 完成后 | `isNewUser` 被 WS 改为 `false`，跳过 Enable Trading | 快照值保持 `true`，正常进入 Enable Trading |
| `user.id` 延迟就绪 | 可能导致签名失败 | 重试等待最多 10 秒 |
| `user.id` 始终无法获取 | 卡死或不明错误 | 友好提示"User account creation timeout" |

---

## 更新记录

- 2026-02-05 修复新用户 Enable Trading 被跳过问题
  - 添加 `isNewUser` 快照机制
  - 添加 `user.id` 重试机制（10次/1秒）
  - 添加兜底错误处理
  - SETTLE_MAX_ATTEMPTS 从 10 增加到 15
