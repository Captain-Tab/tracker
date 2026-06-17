---
id: vault-deposit-chain-switch-sync-delays
tags: [vault, deposit, chain-switch, delay, sync, transfer]
severity: high
date: 2026-04-24
related_history: vault-deposit-base-chain-debug-2026-04-24
---

# Vault Deposit：链切换和 transfer 后必须等待服务端同步

## 问题

两处若不等待直接进入下一步，必现服务端错误。

## 延迟位置

### 1. 链切换后等 2s（signing 前）

`signEip712TypedData` 中 `switchChain` 成功后：
```typescript
await switchChain(wagmiConfig, { chainId: ... });
await new Promise(resolve => setTimeout(resolve, 2000)); // 等钱包/RPC 稳定
return await signTypedData(wagmiConfig, { ... });
```

**不加的后果**：`InternalRpcError: Provided chainId X must match active chainId Y`（即使 switchChain 已返回成功）。

### 2. Transfer 完成后等 2s（进入 approving 前）

`runValueChainState.transferring` 完成后：
```typescript
await callbacksRef.current.onTransferNeeded({...});
await sleep(DEPOSIT_BRIDGE_SYNC_DELAY_MS = 2000); // 等服务端余额同步
dispatchValue({ type: "TRANSFER_COMPLETED" });
```

**不加的后果**：`TRANSFER_FAILED: SERVER_ERROR`（服务端 EVM-Funding 余额未更新，approving 读到 0）。

## 参考

老项目同位置：`useNewValueChainDeposit.tsx:658`（transfer 后 sleep 2000）和 `approving case:779`（switchToTargetNetwork 后 sleep 2000）。
