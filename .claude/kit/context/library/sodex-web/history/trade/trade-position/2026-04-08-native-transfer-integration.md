# Transfer History 整合 native_transfer 数据源

**日期**: 2026-04-08 | **类型**: feat | **范围**: trade

---

## 变更概述

Transfer History Tab 新增 native_transfer 数据源，支持 SOSO 原生链上充提记录展示，并引入独立轮询通知机制。

---

## 核心变更

### 1. BC 合并接口对接

**文件**: `src/models/spotOrder.ts`, `src/http/user/index.ts`

原 `getTransferHistory`（接口 B）替换为 `getCombinedTransferHistory`（BC 合并接口），同时返回 fund_transfer 和 native_transfer 记录。`mergeTransferHistoryData` 新增 txHash 去重逻辑（A 优先）。

### 2. native_transfer 记录转换

**文件**: `src/models/spotOrder.ts`

`convertTransferHistoryToMerged` 新增 `source === "native_transfer"` 分支：零地址和 WSOSO 统一识别为 "SOSO"，actionType 映射为 deposit/withdraw/transfer/stake。

### 3. 轮询通知（四层防护）

**文件**: `src/hooks/useNativeTransferPolling.ts`（新文件）

3 秒轮询 BC 接口检测新 native_transfer 记录，四层 toast 防护防重复：内存去重 → 10 分钟时间窗口 → WS 注入标记 → localStorage 持久化。

### 4. baseInfoRequester 集成

**文件**: `src/components/baseInfoRequester/index.tsx`

随钱包地址启动/停止轮询，与 WS 并行运行。

### 5. 统一方向映射工具

**文件**: `src/utils/nativeTransfer.ts`（新文件）

`resolveNativeActionType` 统一 actionType="transfer" 按 sender/receiver 解析为 deposit/withdraw 方向。

---

## 文件变更列表

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `src/http/user/index.ts` | 新增 | getCombinedTransferHistory 函数 |
| `src/http/user/api.d.ts` | 新增 | CombinedTransferHistory 类型 |
| `src/models/spotOrder.ts` | 修改 | BC 接口替换、native 分支、txHash 去重、守卫修复 |
| `src/hooks/useNativeTransferPolling.ts` | 新增 | 轮询 + toast 四层防护 |
| `src/utils/nativeTransfer.ts` | 新增 | 方向映射工具函数 |
| `src/components/baseInfoRequester/index.tsx` | 修改 | 集成轮询启动/停止 |
| `src/pages/spot/main/position/tab/transferHistory/index.tsx` | 修改 | isSOSO 零地址扩展、Action 列新增 transfer |
| `src/pages/spot/main/position/tab/transferHistory/modals/Failed.tsx` | 修改 | isSOSO 零地址扩展 |

---

## 关联文档

- **Reference**: `.claude/kit/context/library/sodex-web/reference/trade/trade-position-guide.md`
- **Spec**: `.claude/kit/spec/2026-04-03-trade-deposit-withdraw-native-transfer-integration.md`
