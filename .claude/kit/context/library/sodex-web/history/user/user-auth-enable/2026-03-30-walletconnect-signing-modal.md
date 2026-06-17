# 补充 WalletConnect 签名提示弹窗参数

**日期**: 2026-03-30 | **类型**: feat | **范围**: user

---

## 变更概述

SOD-21 移动端钱包签名交互统一优化，为 useEnableTrading 新增 `showWalletConnectSigningModal` 参数，支持在按钮空间不足时弹出 WalletConnect 签名提示弹窗。

---

## 核心变更

### 1. useEnableTrading 接口扩展

**文件**: `src/hooks/useEnableTrading.ts`

新增 `showWalletConnectSigningModal?: boolean` 选项（L30-31），当 `connectorType === "walletConnect"` 时，在签名阶段弹出 `walletConnectSigningHintModal` 提示用户在手机端确认。

---

## 文件变更列表

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `src/hooks/useEnableTrading.ts` | 修改 | 新增 showWalletConnectSigningModal 参数及弹窗逻辑 |
| `src/components_tw/modals/spot/index.tsx` | 修改 | walletConnectSigningHintModal 已存在，被 SOD-21 统一调用 |

---

## 关联文档

- **Reference**: `.claude/kit/context/library/sodex-web/reference/user/user-auth-enable-guide.md`
