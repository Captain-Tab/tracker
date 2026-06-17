# Sentry 错误监控模块指南

## 概述

全局错误监控基础设施，基于 `@sentry/react`，提供错误上报、敏感数据过滤和安全防护。

### 架构图

```
错误发生
    ↓
[上报入口] 三种路径
    ├─ reportError(error, options?)        ← 通用错误（axios 拦截器等）
    ├─ reportWalletError(error, action)    ← 钱包操作（自动过滤用户取消）
    └─ Sentry.captureException()           ← 未捕获异常（自动采集）
    ↓
[beforeSend 过滤管线]
    ├─ sanitizeData: 字段黑名单过滤 → [REDACTED]
    ├─ PRIVATE_KEY_REGEX: 64位 hex → [REDACTED_KEY]
    ├─ JWT_REGEX: JWT 格式 → [REDACTED_JWT]
    ├─ filterPromptInjection: 中英文恶意指令 → [SUSPICIOUS_CONTENT_FILTERED]
    ├─ MAX_STRING_LENGTH: >50KB → [TRUNCATED]
    └─ MAX_DEPTH: >10层 → [MAX_DEPTH_EXCEEDED]
    ↓
[Sentry 后台] → 安全存储 → Dashboard 展示
```

### 环境策略

| 环境 | enabled | tracesSampleRate | 说明 |
|------|---------|-----------------|------|
| `mainnet` / `preview` | true | 0.1 (10%) | 生产启用 |
| `testnet` / `bugfix` / `test` | false | 1.0 | 开发禁用 |

---

## 核心组件

| 文件 | 作用 |
|------|------|
| `src/utils/sentry.ts` | 核心模块：初始化、过滤管线、公开 API |
| `src/axios.config.ts` | 网络请求错误上报（axios 拦截器） |
| `src/App.tsx` | `initSentry()` 入口（应用启动时调用） |

---

## 公开 API

### initSentry

```typescript
export function initSentry(): void  // L146-216
```

应用启动时调用，配置 DSN、环境、采样率、beforeSend 过滤管线、ignoreErrors。

### reportError

```typescript
export function reportError(  // L250-267
  error: Error | string,
  options?: { tags?: Record<string, string>; extra?: Record<string, unknown> }
): void
```

通用错误上报，支持自定义 tags 和 extra 上下文。字符串自动转为 Error 对象。

### reportWalletError

```typescript
export function reportWalletError(  // L278-295
  error: unknown,
  walletAction: string,
  context?: Record<string, unknown>
): void
```

钱包操作专用，自动过滤用户取消（`isUserCancel` 检测 4001 / "User Rejected"）。`walletAction` 作为 Sentry tag 标记操作类型。

### reportMessage

```typescript
export function reportMessage(  // L270-275
  message: string,
  level: SeverityLevel = 'info'
): void
```

上报信息级消息（debug/info/warning/error/fatal）。

### setUserContext / clearUserContext

```typescript
export function setUserContext(userId: string, email?: string): void  // L219-224
export function clearUserContext(): void  // L227-229
```

关联/清除用户身份（登录/登出时调用）。

### useSentryScope

```typescript
export function useSentryScope(): {  // L232-241
  setTag: (key: string, value: string) => void;
  setContext: (name: string, context: Record<string, unknown>) => void;
}
```

Hook 形式设置自定义 tag 和 context。

---

## 安全过滤管线

### 敏感字段黑名单

字段名（忽略大小写）匹配时替换为 `[REDACTED]`：

| 类别 | 字段 |
|------|------|
| 签名 | message, signature |
| 私钥 | privatekey, private_key, secretkey, secret_key, mnemonic, seed, passphrase |
| Token | token, accesstoken, access_token, refreshtoken, refresh_token, authorization, bearer, apikey, api_key |
| 密码 | password, passwd, pwd |
| Session | session, sessionid, session_id, cookie |
| 加密 | secret, cipher, encrypted |
| 凭证 | credential, credentials |
| 验证码 | otp, totp, verificationcode, verification_code |

### 正则过滤

| 模式 | 替换 | 说明 |
|------|------|------|
| `(?:0x)?[a-fA-F0-9]{64}` | `[REDACTED_KEY]` | 64位 hex 私钥 |
| `eyJ...eyJ...` | `[REDACTED_JWT]` | JWT 格式 |

### Prompt Injection 过滤

中英文双语检测，匹配内容替换为 `[SUSPICIOUS_CONTENT_FILTERED]`。

英文模式：ignore previous instruction, disregard, forget everything, you are now, act as, pretend to be, system prompt, jailbreak, bypass security/filter 等 18 条。

中文模式：忽略指令, 无视/忘记, 你现在是, 假装, 扮演, 新的指令, 越狱, 绕过安全 等 18 条。

### 性能限制

| 参数 | 值 | 行为 |
|------|-----|------|
| MAX_STRING_LENGTH | 50KB | 超出截断 + `[TRUNCATED]` |
| MAX_DEPTH | 10 | 超出返回 `[MAX_DEPTH_EXCEEDED]` |

### 异常容错

```typescript
// beforeSend 内部 try-catch
try {
  // 过滤逻辑
} catch (e) {
  console.warn('[Sentry] sanitizeData failed, fallback to original', e);
}
```

过滤失败时降级为原样上报，保证错误监控可用性。

---

## 网络请求错误上报

`src/axios.config.ts` 中通过 `reportError` 上报，统一使用 `module: 'axios-global'` tag。

| error_type | 场景 | 说明 |
|-----------|------|------|
| `business_futures` | Futures API returnCode != 0 | 业务错误 |
| `business_spot` | Spot API code != 0 | 业务错误 |
| `unknown_format` | 非标准响应格式 | 兜底 |
| `network` | ERR_NETWORK | 网络不可达 |
| `response` | HTTP 非 200（排除 401/403） | 服务端错误 |
| `no_response` | 无 response（超时等） | 超时/断连 |

**过滤规则**：
- 取消请求（`ERR_CANCELED`）不上报
- 401/403 认证错误不上报

---

## 钱包交互错误上报

通过 `reportWalletError` 上报，`walletAction` tag 标识操作来源。

### Enable Trading 流程

| walletAction | 文件 | 场景 |
|-------------|------|------|
| `signMessage` | `contexts/login/index.tsx` | PC 签名失败 / refreshPrivateKey 返回 false |
| `signMessageMobile` | `contexts/login/index.tsx` | 移动端签名失败 / refreshPrivateKey 返回 false |
| `enableTrading` | `hooks/useEnableTrading.ts` | Enable Trading 流程异常（catch 块） |
| `enableTrading.privateKeyRefresh` | `hooks/useEnableTrading.ts` | 签名后私钥状态未更新 |
| `enableGasfreeTradingFlow.privateKeyRefresh` | `modals/tradingProcess/enableGasfreeTradingFlow.ts` | 邮箱自动 enable 私钥刷新失败 |
| `autoEmailEnable` | `contexts/login/index.tsx` | 邮箱自动 enable 流程异常 |

### Deposit / Withdraw / Transfer

| walletAction | 文件 | 场景 |
|-------------|------|------|
| `Deposit.flashDeposit` | `_components/deposit/useDeposit.ts` | Deposit Hook 钱包操作 |
| `Deposit.handleFlashDeposit` | `_components/deposit/DepositStepByStep.tsx` | 分步 Deposit 失败 |
| `Withdraw.handleSubmit` | `_components/withdraw/WithdrawModal.tsx` | Withdraw 提交 |
| `Withdraw.sosoTransfer` | `_components/withdraw/WithdrawModal.tsx` | SOSO Transfer 操作 |
| `Transfer.handleApproveForPermit` | `modals/spot/transfer/index.tsx` | Transfer Permit 授权 |
| `Transfer.executeTransfer` | `modals/spot/transfer/index.tsx` | Transfer 执行 |

### Vault 操作

| walletAction | 文件 | 场景 |
|-------------|------|------|
| `VaultDeposit.baseChain.${state.type}` | `useBaseChainDeposit.ts` | Vault Base Chain 阶段（动态状态） |
| `VaultDeposit.valueChain.${state.type}` | `useNewValueChainDeposit.tsx` | Vault Value Chain 阶段（动态状态） |
| `VaultDeposit.enableTrading` | `useVaultDeposit.ts` | Vault 内 Enable Trading |
| `VaultClaim.handleClaim` | `vault/claim/index.tsx` | Vault Claim |
| `VaultUnstake.execute` | `useUnstakeWithTransfer.ts` | Vault Unstake+Transfer |
| `VaultWithdraw.executeActions` | `vault/withdraw/Trading.tsx` | Vault Withdraw 交易 |

### Stake

| walletAction | 文件 | 场景 |
|-------------|------|------|
| `StakeSoso.handleTransfer` | `modals/stakeSoso/StakeSoso.tsx` | Stake SOSO Transfer |
| `StakeSoso.handleStake` | `modals/stakeSoso/StakeSoso.tsx` | Stake SOSO 质押 |

### walletLogger 间接上报

`src/utils/walletLogger.ts` 封装了 `reportWalletError`，以下模块通过 `walletLogger.error(action, error)` 间接上报：

| walletAction 模式 | 文件 | 场景 |
|------------------|------|------|
| `signNewOrder-spark/bolt` | `useSparkSigner.ts` / `useBoltSigner.ts` | 下单签名失败 |
| `signCancelOrder-spark/bolt` | `useSparkSigner.ts` / `useBoltSigner.ts` | 取消订单签名失败 |
| `signTransferAsset-spark` | `useSparkSigner.ts` | 资产转移签名失败 |
| `signUpdateMargin-bolt` | `useBoltSigner.ts` | 调整保证金签名失败 |
| `signUpdateLeverage-bolt` | `useBoltSigner.ts` | 调整杠杆签名失败 |
| `signBatchNewOrder-bolt` | `useBoltSigner.ts` | 批量下单签名失败 |
| `switchChain` / `switchChain-privy` | `useNetworkChecker.ts` / `useAddNetwork.ts` / `useCompatibleSign.ts` | 切链失败 |
| `addChain` | `useAddNetwork.ts` / `chainUtils.ts` | 添加链失败 |
| `sendTransaction` | `useCompatibleSign.ts` | 发送交易失败 |
| `signTypedData` | `useCompatibleSign.ts` | EIP-712 签名失败 |
| `getWalletClient` | `chainUtils.ts` | 获取钱包客户端失败 |

### reportError 非钱包错误上报

以下场景使用 `reportError`（通用上报），因为不涉及钱包签名，无需附加钱包信息：

| action tag | 文件 | 场景 |
|-----------|------|------|
| `Deposit.checkAddressStatus` | `DepositStepByStep.tsx` | 检查充值地址状态失败 |
| `Deposit.pollAddressStatus` | `DepositStepByStep.tsx` | 轮询充值地址状态失败 |
| `Deposit.generateAddress` | `DepositStepByStep.tsx` | 生成充值地址失败 |
| `Deposit.getWallets` | `DepositStepByStep.tsx` | 获取钱包列表失败 |
| `Deposit.polling` | `useDeposit.ts` | 充值轮询异常 |
| `Withdraw.enableTrading` | `WithdrawModal.tsx` | Withdraw 内 Enable Trading 异常 |

---

## 被过滤的错误

### ignoreErrors

```typescript
[
  'ResizeObserver loop limit exceeded',
  'ResizeObserver loop completed with undelivered notifications',
  'Non-Error promise rejection captured',
  /Loading chunk \d+ failed/,
  /Network Error/i,
]
```

### reportWalletError 自动过滤

- 错误码 4001（用户在钱包中点击拒绝）
- "User Rejected" / "User denied" 等消息

### signMessage / signMessageMobile 过滤

- `userCancelCheck` 检测用户取消 → 返回 "cancel"，不触发 sentry

---

## 注意事项

1. **DSN 是公开的**：Sentry DSN 设计为可暴露在客户端代码中，仅有上报权限
2. **SDK 不影响应用**：额度用完或网络断开时 SDK 静默丢弃事件，不抛异常
3. **添加新上报点**：钱包操作用 `reportWalletError`（自动过滤取消），其他用 `reportError`
4. **walletAction 命名**：使用 `模块.操作` 格式（如 `VaultDeposit.baseChain.approve`）

---

## 更新记录

- 2026-03-27 初始版本：sentry.ts 安全增强（敏感数据过滤 + Prompt Injection 防护）
- 2026-03-28 网络请求上报：axios 拦截器集成 reportError
- 2026-03-29 钱包错误上报：11 个模块集成 reportWalletError
- 2026-03-30 Enable Trading 上报：signMessage + useEnableTrading + enableGasfreeTradingFlow
