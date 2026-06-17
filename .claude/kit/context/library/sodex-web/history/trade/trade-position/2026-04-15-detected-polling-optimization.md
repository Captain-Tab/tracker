# 轮询优化 - detected 轻接口替代直接轮询

**日期**: 2026-04-15 | **类型**: feat | **范围**: trade

---

## 变更概述

移除 NativeTransferPolling 的 boost/unboost 动态频率机制，改用 `/chain/transfer/detected` 轻量接口（3s 轮询）检测新区块，仅当 blockNumber 变化时才调用 combined_transfers，减少约 93% 的重接口调用。

---

## 核心变更

### 1. NativeTransferPolling 重构

**文件**: `src/hooks/useNativeTransferPolling.ts`

移除 `boost()`、`unboost()`、`getInterval()` 方法和 `boosted`、`remainingFastPolls` 属性。新增 `cachedBlockNumber` 属性。`start()` 改为 async，首次调 `combined_transfers` 初始化 blockNumber。`loop()` 改为每 3s 调 detected 接口，blockNumber 变化时才调 `poll()`。

### 2. 新增 HTTP 接口

**文件**: `src/http/user/index.ts` + `src/http/user/api.d.ts`

新增 `getTransferDetected` 函数和 `TransferDetected` 类型，调用 `/chain/transfer/detected` 接口。

### 3. DepositStepByStep 清理

**文件**: `src/pages/_components/deposit/DepositStepByStep.tsx`

移除 boost/unboost 的 useEffect 及 `nativeTransferPolling` import。

---

## 文件变更列表

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `src/hooks/useNativeTransferPolling.ts` | 修改 | 移除 boost/unboost，新增 detected 轮询 + cachedBlockNumber |
| `src/http/user/index.ts` | 修改 | 新增 getTransferDetected 接口函数 |
| `src/http/user/api.d.ts` | 修改 | 新增 TransferDetected 类型定义 |
| `src/pages/_components/deposit/DepositStepByStep.tsx` | 修改 | 移除 boost/unboost useEffect 及 import |

---

## 关联文档

- **Reference**: `.claude/kit/context/library/sodex-web/reference/trade/trade-position-guide.md`

---

## 追加变更：修复 cachedBlockNumber 驱动源

将 `cachedBlockNumber` 更新从 `poll()` 的 `fundTransfers maxBlock` 移到 `loop()` 的 `detected latestBlock`。避免两个接口 blockNumber 不一致时 `latestBlock > cachedBlockNumber` 永远为 true，导致每 3s 都调 combined_transfers。

| 文件 | 变更 |
|------|------|
| `src/hooks/useNativeTransferPolling.ts` | loop() 中 `cachedBlockNumber = latestBlock` 在 poll 前更新；poll() 移除 maxBlock 赋值 |

---

## 追加变更：消除 TransferHistory Tab 切换重复请求

Tab 切换时父组件 tabHandleClick 和子组件 useEffect 各调一次 `fetchMergedTransferHistory`（→ `combined_transfers`），导致重复请求。添加 `isInitialMount` ref，首次挂载跳过子组件请求（由父组件负责），钱包切换时仍正常请求。

| 文件 | 变更 |
|------|------|
| `src/pages/spot/main/position/tab/transferHistory/index.tsx` | useEffect 添加 isInitialMount ref 跳过首次挂载请求 |
