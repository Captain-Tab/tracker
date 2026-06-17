# Vault Deposit Migration — 2026-04-24

> 来源：sodex-web → sodex-next，方案 F Workflow Hook Pattern
> 阶段：Phase 0（scaffold）→ Phase 1（UI）→ Phase 2（logic）→ Phase 2.5（debug & fix）→ finalize

---

## 迁移概览

| 项目 | 结果 |
|---|---|
| tsc --noEmit | ✅ 0 errors |
| ESLint | ✅ pass |
| 方案 F 硬约束 | ✅（无 vaultDepositService / reducer 无 react / infra 无 toast）|
| Golden path 验证 | ✅ BASE_ETH 新用户 / VALUE_CHAIN 老用户两条路均测试通过 |
| Toast 生命周期 | ✅ 取消/错误/成功均正确关闭 |

---

## 架构产物

```
src/features/vault/
├── domain/
│   ├── depositStateMachine.ts   — 3 纯 reducer(top/baseChain/valueChain)
│   └── depositPermit.ts         — EIP-712 typed-data builder(2 步签名)
├── infra/chain/
│   └── vaultDepositInfra.ts     — 10 个原子 async 函数
├── containers/
│   ├── deposit/useVaultDepositMachine.ts  — workflow driver(reducer+effect)
│   ├── useSubmitVaultDeposit.ts           — 外层编排
│   ├── useVaultDepositForm.ts             — 表单状态
│   ├── depositFlowLogic.ts                — 纯派生函数
│   └── handleDepositServiceError.ts       — 错误→toast
└── components/dialogs/VaultDepositDialog/ — Phase 1 UI 层
```

---

## 关键修复记录

### Fix 1：新用户入口被 needsEnableTrading 拦截

**问题**：新用户（`accountId = ""`，空字符串）被判为老用户（`isFirstTimeUser = false`），
按钮显示 "Enable Trading" 而不是 "Deposit"，且 `enableTrading()` 静默失败（`useEnableTrading`
内部吞掉 SIGNATURE_REJECTED），用户永远进不了 Base 链存款流程。

**根因**：
1. `isFirstTimeUser = accountId === null || accountId === undefined`，漏判了 `""` 空字符串。
   `useAutoLogin` 对无链上账号的新用户写入 `accountId = ""`，导致判断失效。
2. 新用户 BASE_ETH 存款的 enable_trading 是机器内部步骤，不应走 standalone `enableTrading()`。

**修复**：
```ts
// 对齐旧项目 !user.id：null / undefined / "" 均视为新用户
const isFirstTimeUser = !accountId;

// 新用户 BASE_ETH 跳过 standalone enable trading
const needsStandaloneEnableTrading =
  needsEnableTrading && !(isFirstTimeUser && form.selectedChain === "BASE_ETH");
```

**文件**：`VaultDepositDialog/index.tsx`

---

### Fix 2：新用户 enable_trading callback 错误处理

**问题**：`useEnableTrading.enableTrading()` 在用户拒绝签名时静默返回（swallow error），
机器误判为 enable_trading 成功，直接进入 value chain，后续因无 API key 报错。

**修复**：改用 `useAuth.ensureApiKey()` 直接调用，加 15×1s 重试逻辑：
- `SIGNATURE_REJECTED` / `SIGNATURE_TIMEOUT` → 立即抛 `USER_REJECTED`，触发 Try Again
- `ACCOUNT_LOOKUP_FAILED` / `UNKNOWN` → 最多重试 15 次（bridge 后账号上链需要时间）
- 超时 → 抛 `ENABLE_TRADING_TIMEOUT`

**文件**：`useSubmitVaultDeposit.ts:onEnableTradingCallback`

**历史参照**：旧项目 `20260205-newuser-enabletrading-fix.md`（`isNewUser` 快照机制 +
`getUserIdByAddress` 15×1s 重试）

---

### Fix 3：isNewUser 快照（Trading UI 防 WS 推送覆盖）

**问题**：Base chain 完成后 WS 推送 `accountId`，`isFirstTimeUser` 从 true 变 false，
Trading UI 里的 enable_trading 面板消失（panel 依赖实时值判断）。

**修复**：Trading 阶段改用 `submission.currentInput?.isNewUser` 快照：
```ts
const isNewUserSnapshot = submission.currentInput?.isNewUser ?? isFirstTimeUser;
```

**文件**：`VaultDepositDialog/index.tsx`（Trading 分支）

---

### Fix 4：Value Chain token 地址错误（核心 bug）

**问题**：`isStake=true`（MAG7 存入）时，新项目错误地：
1. 执行 external staking（vMAG7 → vsMAG7）
2. 使用 `VSMAG7_TOKEN_ADDRESS` 作为 ERC-2612 permit token

实际上老项目注释掉了 staking（`步骤2`），vault 合约内部处理 vMAG7→vsMAG7 转换，
前端应直接用 `VMAG7_TOKEN_ADDRESS` 提交。

**根因**：spec/guide 文档记录的是设计意图（有 staking），但老项目运行代码已废弃该步骤。
迁移时以文档为准而非以代码为准。

**修复**：
```ts
// depositFlowLogic.ts
// needsStake 恒 false，对齐老项目
return { needsTransfer: ..., needsStake: false };

// useVaultDepositMachine.ts — approving
const permitTokenAddress = inp.token.isStake
  ? VMAG7_TOKEN_ADDRESS   // vMAG7 for MAG7 deposits（vault 内部 staking）
  : (inp.token.valueChainTokenAddress ?? VSMAG7_TOKEN_ADDRESS);

// confirm_signing 同上
const depositTokenAddress = inp.token.isStake
  ? VMAG7_TOKEN_ADDRESS
  : (inp.token.valueChainTokenAddress ?? VSMAG7_TOKEN_ADDRESS);
```

**已记录到 migration records**：`analyze:working-code-over-spec-as-ground-truth`

---

### Fix 5：CallForPermit `to` 地址

**问题**：`depositPermit.ts` 注释写 `to = VAULT_CALLER_ADDRESS`，但老项目实际用 `SLP_TOKEN_ADDRESS`。

**修复**：改用 `SLP_TOKEN_ADDRESS`，与老项目 `useVaultDepositWithPermit.vaultAddress` 对齐。

---

### Fix 6：Toast 不关闭

**问题**：
1. 用户拒签（USER_REJECTED）时 loading toast 永久残留（原设计保留 loading 供 retry，UX 不合理）
2. 弹窗 unmount 时 toast 未清理

**修复**：
```ts
// onError：所有错误（含 USER_REJECTED）统一 closeNotify()
closeNotify();

// useSubmitVaultDeposit useEffect cleanup
useEffect(() => { return () => { closeNotify(); }; }, []);
```

---

### Fix 7：onSuccess invalidate 缺失

**问题**：成功后 `slpBalance` / `hasMyActivity` / `activity` / `myActivity` 未 invalidate，
Activity tab 和 SLP 余额不刷新。

**修复**：补全 8 个 queryKey 的 invalidation。

---

## EIP-712 签名参数对照（验证通过）

### Step 1：ERC-2612 Token Permit

| 参数 | isStake=true（MAG7）| isStake=false（sMAG7）|
|---|---|---|
| token | `VMAG7_TOKEN_ADDRESS` | `VSMAG7_TOKEN_ADDRESS` |
| domain.name | `"SoDexToken: MAG7.ssi"`（链上读）| `"SoDexToken: sMAG7.ssi"`（链上读）|
| domain.version | `"1"` | `"1"` |
| spender | `CALL_FOR_PERMIT_ADDRESS` | `CALL_FOR_PERMIT_ADDRESS` |
| deadline | `now + 1800`（30 min） | 同左 |

### Step 2：CallForPermit 外层签名

| 参数 | 值 |
|---|---|
| domain.name | `"SoDexTokenCallForPermit"` |
| domain.version | `"1.0.0"` |
| domain.verifyingContract | `CALL_FOR_PERMIT_ADDRESS` |
| message.to | `SLP_TOKEN_ADDRESS` |
| message.cmdType | `"VaultDepositWithPermit2"` |
| message.nonce | `CallForPermit.nonces(account, key=3)`（bitmap packed nonce） |
| message.deadline | `now + 3600`（1h） |
| cmdData | `encodeAbiParameters(token, amount, permitDeadline, v, r, s)` |

---

## Nonce 格式说明

`getDepositCallForPermitNonce(key=3)` 返回的 nonce 格式为 **bitmap packed**：

```
nonce = 3 × 2^64 + bitPosition
// 首次使用：3 × 2^64 = 55340232221128654848
```

这是 `CallForPermit` 合约的分 key bitmap 方案，不是普通递增计数器。
后端接收后直接透传合约，合约验证 bit 是否已使用。

---

## 已知遗留问题（defer）

1. **Mobile trading Figma**：移动端 trading 界面 Figma 未提供，依赖响应式 Shell 自动处理
2. **interruption modal**：全局 interruptionModal 降级为 toast（无弹窗叠层）
3. **i18n**：部分 key 为硬编码英文，待 `/soso-translation-auto` 补全
4. **Token 选择器**：`onTokenClick` 待接入 shared `TokenSelector` + `useTokenConfig`
5. **Dashboard 刷新延迟**：`investInfo` 后端需要时间索引链上交易，首次 invalidate 后可能返回旧数据
