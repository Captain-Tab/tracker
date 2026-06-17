# chain-call-semantics

跨迁移的**链上调用语义对齐**类坑(合约地址映射、call 目标、函数签名)。

---

## chain-call:callForPermit-cmdType-to-address-mapping

- **tags**: chain-call, CallForPermit, to-address, cmdType
- **severity**: high
- **created**: 2026-04-23
- **source**: sodex-web → sodex-next vault-withdraw

### 触发场景

迁移 `sodex_call_for` API 的 CallForPermit 签名调用(claim / unstake / withdraw / deposit 都涉及)。不同 `cmdType` 对应不同的 `to` 目标合约,迁移时容易按"都是 CallForPermit 就一律 `to=VAULT_CALLER_ADDRESS`"的惯性错写。

### 典型症状

后端返回 `{code: -1, msg: ""}`(无详细错误),消息为"缺失 txHash"。

### 根因

老项目 `useProcessOptions.tsx:100` 明确:
```ts
vaultAddress: SLP_TOKEN_ADDRESS,  // VaultRedeemWithPermit 的 to
```

而 claim/unstake 的 `CreateBridgeCallFor` 走 `VAULT_CALLER_ADDRESS`。

**规律**:`to` 是目标合约地址,由 `cmdType` 决定,不是固定值:

| cmdType | to 目标 |
|---------|--------|
| `CreateBridgeCallFor` | `VAULT_CALLER_ADDRESS`(Vault Caller 合约) |
| `VaultRedeemWithPermit` | `SLP_TOKEN_ADDRESS`(SLP Vault 合约直调) |
| `VaultDepositWithPermit2` | (未确认,按老项目源码) |
| `DepositERC20WithPermit` | (未确认) |

### 避坑动作

1. **实现 CallForPermit 前**,打开老项目对应 hook / process options,grep `to:`,确认该 cmdType 实际传的 `to` 值
2. 严禁按 cmdType 名字猜:`VaultRedeem*` 看上去"通过 VaultCaller",其实是直调 SLP
3. 错误响应只有 `code=-1 msg=""` 时,**先怀疑 `to` 地址**,不是签名/nonce

### 关联
- 本 bug:withdraw 把 `to=VAULT_CALLER` 写进 typedData message 和 post body,前后端都验证不过
- 参考迁移:claim(cmdType=CreateBridgeCallFor)用 `to=VAULT_CALLER` 就是对的,别把它的范式照搬到 VaultRedeem


---

## chain-call:token-decimals-dynamic-read

- **tags**: chain-call, decimals, token, dynamic
- **severity**: high
- **created**: 2026-04-23
- **source**: sodex-web → sodex-next vault-withdraw(root cause assets=0)

### 触发场景

在不同合约/代币间计算数量(permit amount / shares / assets / balance)时,涉及多种 decimals:
- SLP token:链上 18
- vMAG7:8
- vsMAG7:8

### 典型症状

redeem tx 成功但解析出的 assets = 0;后续 unstake 因 `inAmount=0` 被合约拒绝 `in amount must be greater than 0`。

### 根因

调用方 parseUnits 时用了**错的 decimals 常量**:
- 用 `VAULT_TOKEN_DECIMAL=8` parse SLP 金额 → shares = 4e8(应为 4e18)
- 合约按小 10^10 倍的 shares 计算 assets,向下取整为 0

### 避坑动作

1. **不同合约的 decimals 必须独立读**,不要复用常量
2. 从链上 ERC20 `decimals()` 动态读(可配合 React Query cache)
3. 常量只做 fallback,不做主源

### 关联
- 老项目 useTokenConfig.ts 也是动态读 + 常量 fallback
- 新项目 `useSlpBalanceQuery` 已动态读 decimals;`buildWithdrawAmountWei` 接受 `slpDecimals` 参数
