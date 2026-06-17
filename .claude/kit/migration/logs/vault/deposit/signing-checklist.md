# Signing Checklist: vault-deposit

> 模块 5 EIP-712 / ERC2612 签名参数逐字段对照。
> 来源:老项目 `sodex-web/src/pages/vault/components/modals/funding/_hooks/useVaultDepositWithPermit.ts`。

---

## 1. ERC2612 Token Permit(第一步签名)

目的:用户授权 `VaultCaller` 合约在 `deadline` 之内可消费 `amountWei` 的 vault token。

| 字段 | 来源 | 示例值 | 老项目 | 新项目 |
|---|---|---|---|---|
| **domain.name** | `readContract token.eip712Domain()` 返回 `name` | "SoDexToken" | useVaultDepositWithPermit `_createTokenPermitDomain` | `infra.readTokenPermitDomain()` |
| **domain.version** | 同上返回 `version` | "1" | 同上 | 同上 |
| **domain.chainId** | VALUE_CHAIN_MAINNET.id | 286623 | `config.chainId` | 常量 |
| **domain.verifyingContract** | `tokenAddress`(随 isStake) | `VMAG7_TOKEN_ADDRESS` 或 `VSMAG7_TOKEN_ADDRESS` | 同上 | domain input `token.valueChainTokenAddress` |
| **types.Permit** | EIP-2612 标准结构 | `owner/spender/value/nonce/deadline` | 同上 | `buildVaultTokenPermitTypedData` |
| **message.owner** | wallet account | `user wallet address` | 同上 | `input.account` |
| **message.spender** | `VAULT_CALLER_ADDRESS` | 见 shared/constants/contracts | 同上 | 常量 |
| **message.value** | `parseUnits(amount, MAG7_DECIMALS=8)` | `"500000000"` for 5 | 同上 | `buildDepositAmountWei` |
| **message.nonce** | `readContract token.nonces(owner)` | bigint | `getTokenNonce` | `infra.getTokenPermitNonce` |
| **message.deadline** | `now + 30min` | unix timestamp | `deadlineRef.current = now + 3600` ⚠ 老项目是 1h,本模块改 30min(plan 提议,与 spec 一致) | `buildDepositApproveDeadlineSeconds` |

签名后用 `parseDepositSignatureVrs(sig)` 拆出 `{v, r, s}` 供 CallForPermit 引用。

**Gate**: `signTypedData` 前预检 chainId;如果钱包在 Base 链,需先切到 Value Chain(286623)。

---

## 2. CallForPermit 外层签名(第二步签名)

目的:用户授权后端 orchestrator 执行 `VaultCaller.VaultDepositWithPermit2(cmd)`,cmd 内含 ERC2612 v/r/s。

| 字段 | 来源 | 示例值 | 老项目 | 新项目 |
|---|---|---|---|---|
| **domain.name** | 常量 `SoDexTokenCallForPermit` | "SoDexTokenCallForPermit" | `CALL_FOR_PERMIT_DOMAIN_NAME` | 复用 |
| **domain.version** | 常量 `1.0.0` | "1.0.0" | `CALL_FOR_PERMIT_DOMAIN_VERSION` | 复用 |
| **domain.chainId** | VALUE_CHAIN_MAINNET.id | 286623 | | 常量 |
| **domain.verifyingContract** | `CALL_FOR_PERMIT_ADDRESS` | 见 shared/constants/contracts | `config.callForPermitAddress` | 常量 |
| **types.CallForPermit** | 4 字段 `to / cmd / nonce / deadline` | | 老项目 useVaultDepositWithPermit `types` | `buildVaultDepositCallForPermitTypedData` |
| **types.VaultDepositWithPermit2** | 6 字段 `token/amount/deadline/v/r/s` | | 同上 | 同上 |
| **message.to** | `VAULT_CALLER_ADDRESS` | | 同上 | 常量 |
| **message.cmd.token** | `tokenAddress` | VMAG7 或 VSMAG7 | 同上 | `token.valueChainTokenAddress` |
| **message.cmd.amount** | `parseUnits(amount, 8)` | string | 同上 | `amountWei.toString()` |
| **message.cmd.deadline** | ERC2612 permit deadline | string | 同上 | 第一步签名时记录的 deadline |
| **message.cmd.{v,r,s}** | 第一步签名结果 | — | `parseSignature` | `parseDepositSignatureVrs` |
| **message.nonce** | `readContract CallForPermit.nonces(account, VaultDepositWithPermit2=3)` | bigint | `getCallForPermitNonce` | `infra.getDepositCallForPermitNonce`(key=3n) |
| **message.deadline** | `now + 1h` | unix timestamp | `getDeadline()` | `buildDepositOuterDeadlineSeconds` |

签名后组 `CallForPermitRequest = { to, cmdType: "VaultDepositWithPermit2", cmdData, nonce, deadline, signature }`。
`cmdData` 由 `buildVaultDepositCmdData` 走 `encodeAbiParameters` 拼(token, amount, permitDeadline, v, r, s)。

---

## 3. 链上写入:ERC20.approve(仅 Base chain)

| 字段 | 来源 | 备注 |
|---|---|---|
| contract | `token.baseCoinAddress`(MAG7 / sMAG7 on Base) | 动态传入 |
| fn | `approve(spender, amount)` | |
| args | `spender=baseBridgeAddress, amount=parseUnits(amount, baseDecimals)` | baseDecimals 动态读或从 token config 传入 |
| chainId | `base.id` = 8453 | 切链必须 |
| wait confirmations | 2 | `DEPOSIT_BASE_TX_CONFIRMATIONS` |

---

## 4. 链上写入:IBridge.bridge(Base chain)

| 字段 | 来源 | 备注 |
|---|---|---|
| contract | `token.baseBridgeAddress` | token 配置,不在 shared |
| fn | `bridge(coinSymbol, to, amount, toClob)` | ERC20 币种 |
| args.coinSymbol | `token.baseCoinSymbol` | "MAG7.ssi" 或 "sMAG7.ssi" |
| args.to | user wallet | `input.account` |
| args.amount | `parseUnits(amount, baseDecimals)` | 同 approve |
| args.toClob | **恒 true** | history 20251107 统一 |
| fallback fn | `bridgeNativeToken(to, amount, toClob)` | 仅 SOSO(本模块不走) |
| chainId | 8453 | |
| wait confirmations | 2 | |

**Bridge 入账确认**:`readContract SOSO_DEPOSIT_QUERY_ADDRESS.getTransaction("BASE_ETH", bridgeTxHash)` 轮询 15×5s,`tx.txHash === target && tx.chain.toUpperCase() === "BASE_ETH" && tx.status === 1` 视为成功。超时兜底继续(不算失败)。

---

## 5. 链上写入:POST /biz/mirror/call_for_permit(Value chain permit 提交)

| 字段 | 来源 | 备注 |
|---|---|---|
| body | `CallForPermitRequest` | 见第 2 节组装 |
| cmdType | "VaultDepositWithPermit2" | **区分于 claim/unstake 的 CreateBridgeCallFor 和 withdraw 的 VaultRedeemWithPermit** |
| 返回 | `{ txHash }` | Value Chain 上的 tx hash |
| wait confirmations | 3 | `DEPOSIT_VALUE_TX_CONFIRMATIONS` on VALUE_CHAIN_MAINNET(history 20250107 修复) |

---

## 6. 关键风险 & checkpoints

- [x] cmdType 正确(VaultDepositWithPermit2,非 VaultRedeem / CreateBridge)
- [x] to 正确(VAULT_CALLER_ADDRESS,非 SLP token)
- [x] token decimals 动态读(Base chain 链上,Value chain 固定 8)
- [x] ERC2612 permit deadline 30min;CallForPermit 外层 deadline 1h
- [x] RETRY 时若 permit 签名未过期,跳过重签(isApproveDeadlineValid)
- [x] Base chain toClob=true 恒值
- [x] Value chain `waitForTransactionReceipt(confirmations=3)` 不缺(history 20250107 教训)
- [x] `isNewUser` 在 execute 开始锁 snapshot,reducer config 传入,不读 store(history 20260205)
- [x] 0 金额保护:`checkErc20Allowance` 抛 DEPOSIT_AMOUNT_ZERO
- [ ] **testnet tx ≥ 2 笔**(approve + deposit)—— 待真实钱包测试;暂记 defer 到手动 QA 阶段
