# State Machine Diagram: vault-deposit

> 模块 5 三层状态机时序(Top / BaseChain / ValueChain)。
> 来源:`src/features/vault/domain/depositStateMachine.ts`。

---

## 顶层 top reducer

```
                    ┌──────┐
            START   │      │
            ─────▶  │ idle │
                    │      │
                    └──┬───┘
                       │
        ┌──────────────┼───────────────┐
        │ needsBaseChain=true          │ needsBaseChain=false
        ▼                              ▼
┌───────────────────┐          ┌────────────────────┐
│ base_chain_phase  │          │ value_chain_phase  │
└────┬──────────────┘          └────┬───────────────┘
     │ BASE_CHAIN_COMPLETED         │ VALUE_CHAIN_COMPLETED
     ├───────────── isNewUser ──────┐
     │                              │
     ▼ no                           ▼
┌────────────────────┐   ┌──────────────────┐
│ value_chain_phase  │   │ enable_trading   │
└────────┬───────────┘   └────────┬─────────┘
         │                        │ ENABLE_TRADING_COMPLETED
         │                        │
         │                        ▼
         │              ┌──────────────────┐
         └──────────────│value_chain_phase │
                        └────────┬─────────┘
                                 │ VALUE_CHAIN_COMPLETED
                                 ▼
                          ┌────────────┐
                          │ completed  │
                          └────────────┘

任何 phase FAILED → failed { phase, error }
             │
             RETRY → 回到对应 phase(不清缓存)
             RESET → idle
```

---

## BaseChain 子机

```
idle ─START→ checking_allowance
                │
                │ ALLOWANCE_CHECKED
                ├── needsApprove=true  → approving ──APPROVE_SUBMITTED→
                │                        approve_confirming ─APPROVE_CONFIRMED→
                │                        approve_completed
                │
                └── needsApprove=false → approve_completed
                                          │
                                          │ (500ms sleep + bridge tx)
                                          │ BRIDGE_SUBMITTED
                                          ▼
                                   bridge_confirming ─BRIDGE_CONFIRMED→
                                   bridge_settling ─SETTLING_COMPLETED→
                                   completed
                                          │
                                          ▼
                                    Top: BASE_CHAIN_COMPLETED

任何一步 FAILED(step=approve | confirm)→ failed
  RETRY:
    step=approve   → checking_allowance(全新查 allowance)
    step=confirm   → approve_completed(复用 approveTxHash,跳过 approve)
```

---

## ValueChain 子机(config: needsTransfer / needsStake)

```
idle ─START→
       │
       ├── needsTransfer=true → transferring ─TRANSFER_COMPLETED→
       │                                      │
       └──────────────────────────────────────┴→ approving
                                                  │ APPROVE_COMPLETED (sig + deadline)
                                                  ▼
                                            approve_completed
                                                  │ CONFIRM_STARTED (自动)
                                                  ▼
                                            confirm_signing ─CONFIRM_SIGNATURE_COMPLETED→
                                            confirm_proceeding ─CONFIRM_COMPLETED→
                                            completed
                                                  │
                                                  ▼
                                            Top: VALUE_CHAIN_COMPLETED

注:新项目 staking 步骤保留 reducer 节点但当前 config.needsStake 默认不走,
   对齐老项目 useNewValueChainDeposit 的 staking 已注释状态。

任何一步 FAILED(stepName ∈ transfer/stake/approve/confirm)→ failed(stepName, stepIndex, cache)
  RETRY 策略:
    transfer → transferring
    stake    → staking
    approve  → approving
    confirm  → 若 approveDeadline > now 复用签名 → approve_completed;否则 approving
```

---

## 驱动映射(useVaultDepositMachine effect driver)

| top state | 触发 |
|---|---|
| `base_chain_phase` | dispatchBase(START) |
| `enable_trading` | callbacks.onEnableTrading() |
| `value_chain_phase` | dispatchValue(START) |
| `completed` | callbacks.onSuccess(txHash) |
| `failed` | callbacks.onError(error, phase) |

| base state | 触发 side-effect |
|---|---|
| `checking_allowance` | readErc20Decimals + checkErc20Allowance → dispatch(ALLOWANCE_CHECKED) |
| `approving` | approveErc20 → dispatch(APPROVE_SUBMITTED) |
| `approve_confirming` | waitBaseReceipt → dispatch(APPROVE_CONFIRMED) |
| `approve_completed` | sleep(500ms) + bridgeToValueChain → dispatch(BRIDGE_SUBMITTED) |
| `bridge_confirming` | waitBaseReceipt → dispatch(BRIDGE_CONFIRMED, approveTxHash) |
| `bridge_settling` | pollBridgeSettle(15×5s) → dispatch(SETTLING_COMPLETED) + dispatchTop(BASE_CHAIN_COMPLETED) |

| value state | 触发 side-effect |
|---|---|
| `transferring` | callbacks.onTransferNeeded → dispatch(TRANSFER_COMPLETED) |
| `approving` | getTokenPermitNonce + readTokenPermitDomain + signEip712(Permit) → dispatch(APPROVE_COMPLETED) |
| `approve_completed` | dispatch(CONFIRM_STARTED)(同步) |
| `confirm_signing` | getDepositCallForPermitNonce + build cmdData + signEip712(CallForPermit) → dispatch(CONFIRM_SIGNATURE_COMPLETED) |
| `confirm_proceeding` | submitDepositPermit + waitValueReceipt(3) → dispatch(CONFIRM_COMPLETED) + dispatchTop(VALUE_CHAIN_COMPLETED) |

---

## 防重入

- `prevTopKindRef` / `prevBaseKindRef` / `prevValueKindRef` 挡 StrictMode 双跑
- `isUnmountedRef` 每次 await 后检查,unmount 则不 dispatch
- `AbortController` 预留(本版未对 pollBridgeSettle 接入;follow-up 可加)
- `reset()` 清所有 prev ref + abort

## RETRY 时缓存

- `approveTxHashRef`(base)
- `approveSignatureRef` + `approveDeadlineRef`(value)
- `confirmPayloadRef`(confirm_signing 失败则清)
