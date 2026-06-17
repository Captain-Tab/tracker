# 添加 Sentry 错误上报

**日期**: 2026-03-29 | **类型**: feat | **范围**: trade

---

## 变更概述

在 Transfer 弹窗的两个 catch 块中添加 `reportWalletError` 调用，实现划转失败的 Sentry 错误上报。同时修正 context 文档中 `transferAccountSwitcher` 的路径错误（单文件 → 目录）。

---

## 核心变更

### 1. handleApproveForPermit 添加 Sentry 上报

**文件**: `src/components_tw/modals/spot/transfer/index.tsx`

Funding→Spot permit 签名流程的 catch 块新增 `reportWalletError(error, "Transfer.handleApproveForPermit")`。

### 2. executeTransfer 添加 Sentry 上报

**文件**: `src/components_tw/modals/spot/transfer/index.tsx`

Spot↔Perps 签名划转的 catch 块新增 `reportWalletError(error, "Transfer.executeTransfer")`。

`reportWalletError` 内部自动过滤 `isUserCancel`，不会上报用户主动拒绝事件。

---

## 文件变更列表

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `src/components_tw/modals/spot/transfer/index.tsx` | 修改 | 添加 Sentry import + 两处 reportWalletError 调用 |

---

## 关联文档

- **Reference**: `.claude/kit/context/library/sodex-web/reference/trade/trade-transfer-guide.md`
