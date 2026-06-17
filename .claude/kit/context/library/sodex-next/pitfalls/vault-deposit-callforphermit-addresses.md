---
id: vault-deposit-callforpermit-addresses
tags: [vault, deposit, signing, permit, callforpermit, address]
severity: critical
date: 2026-04-24
related_history: vault-deposit-base-chain-debug-2026-04-24
---

# Vault Deposit：三个 CallForPermit 地址易混淆

## 问题

Vault deposit 涉及三个不同语义的合约地址，命名相近易混淆，填错全部导致服务端 `code=-1`。

## 正确映射

| 字段 | 正确值 | 错误的直觉 |
|---|---|---|
| ERC-2612 permit `spender` | `CALL_FOR_PERMIT_ADDRESS` | ❌ VAULT_CALLER_ADDRESS |
| CallForPermit typed data `to` | `SLP_TOKEN_ADDRESS` | ❌ VAULT_CALLER_ADDRESS |
| CallForPermit API request `to` | `SLP_TOKEN_ADDRESS` | ❌ VAULT_CALLER_ADDRESS |
| Staking `to` 字段 | `VAULT_CALLER_ADDRESS` | — |
| Staking `verifyingContract` | `CALL_FOR_PERMIT_ADDRESS` | — |

## 验证方法

参考 `logs/vault/deposit/signing-checklist.md`，每次实现前逐字段与老项目对比（execute Step 2.5）。
