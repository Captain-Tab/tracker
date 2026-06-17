# 轮询动态频率 + 多项修复

**日期**: 2026-04-10 | **类型**: feat | **范围**: trade

---

## 变更概述

NativeTransferPolling 新增 boost/unboost 动态频率切换，配合多项 correctness 修复（withdraw 重复 toast、列表刷新解耦、空值防护等）。

---

## 核心变更

### 1. 动态频率切换（boost/unboost）

**文件**: `src/hooks/useNativeTransferPolling.ts`

新增 `boost()` / `unboost()` 方法，SOSO+ValueChain Deposit 弹窗打开时切到 3s 高频轮询，关闭后渐退（3s×3→15s）。`stop()` 清除所有频率状态。

### 2. Deposit 弹窗接入

**文件**: `src/pages/_components/deposit/DepositStepByStep.tsx`

通过 useEffect + `isSosoValueChain` 判断，打开时 `boost()`，cleanup 时 `unboost()`。

### 3. Withdraw 重复 toast 修复

**文件**: `src/pages/_components/withdraw/WithdrawModal.tsx`

SOSO 提现发送交易后立即 `addNotifiedTxHash(txHash)`，阻止轮询弹重复 toast。

### 4. 列表刷新与 toast 解耦

**文件**: `src/hooks/useNativeTransferPolling.ts`

`hasNewNativeRecord` 赋值移到 toast 去重检查之前，确保 toast 被跳过时列表和余额仍刷新。

### 5. resolveNativeActionType 防御性改进

**文件**: `src/utils/nativeTransfer.ts`

sender/userAddress 空值回退 deposit，白名单校验替代 `as` 强转。

### 6. 其他修复

- `combined_transfers` baseURL 改用 `BASE_API_SERVER_URL`（修复跨环境问题）
- SOSO+ValueChain Deposit 隐藏 Minimum Deposit 提示
- native_transfer 记录补齐 `n: ""`，`account` 改用 `assetAddress`

---

## 文件变更列表

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `src/hooks/useNativeTransferPolling.ts` | 修改 | boost/unboost/getInterval + 动态频率 + 刷新解耦 |
| `src/pages/_components/deposit/DepositStepByStep.tsx` | 修改 | boost/unboost 接入 + 隐藏 min deposit |
| `src/pages/_components/withdraw/WithdrawModal.tsx` | 修改 | txHash 注入去重 |
| `src/utils/nativeTransfer.ts` | 修改 | 空值防护 + 白名单校验 |
| `src/models/spotOrder.ts` | 修改 | 补齐 n 字段 + account 修正 |
| `src/http/user/index.ts` | 修改 | baseURL 环境切换 |

---

## 关联文档

- **Reference**: `.claude/kit/context/library/sodex-web/reference/trade/trade-position-guide.md`
