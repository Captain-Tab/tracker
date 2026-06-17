# 完善 SOSO + ValueChain 硬编码逻辑文档

**日期**: 2026-04-08 | **类型**: docs | **范围**: trade

---

## 变更概述

补充完善 SOSO + ValueChain 硬编码充值逻辑的文档记录，包括配置文件、链注入、状态检测、UI 覆盖行为等。

---

## 核心变更

### 1. 新增 sosoValueChainConfig 配置说明

**文件**: `src/pages/_components/deposit/_config/sosoValueChainConfig.ts`

文档新增该配置文件的完整说明：`VALUE_CHAIN_INFO`、`isSosoValueChain()`、`shouldAppendValueChain()` 等导出。

### 2. 新增 ValueChain 网络配置

**文件**: `src/config/networks.ts`

文档补充 `VALUE_CHAIN_MAINNET`（chainId: 286623）和 `VALUE_CHAIN_TESTNET`（chainId: 138565）配置。

### 3. 扩展特殊币种处理规则

新增 SOSO + ValueChain 硬编码行为对照表（8 项覆盖）：充值方式、充值地址、地址检查、确认蒙层、充值时间、最小充值提示、状态追踪、UI 提示。

### 4. 补充充值状态检测逻辑

**文件**: `src/pages/_components/deposit/WaitingTransferStatus.tsx`

文档记录 ValueChain 事件驱动检测：跳过 API 轮询，改为监听 `NATIVE_TRANSFER_ARRIVED` 事件。

### 5. 补充文件结构和代码位置索引

新增 `_config/sosoValueChainConfig.ts`、`WaitingTransferStatus.tsx`、`networks.ts`、`contracts.ts`、`appkit.ts` 等 5 个文件位置。

---

## 文件变更列表

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `reference/trade/trade-deposit-guide.md` | 修改 | 7 个章节差量更新 |

---

## 关联文档

- **Reference**: `.claude/kit/context/library/sodex-web/reference/trade/trade-deposit-guide.md`
