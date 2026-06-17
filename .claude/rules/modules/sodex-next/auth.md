# Auth & Capability 使用规范

外部 feature 在需要"当前用户身份"、"签名凭据"或"触发鉴权 UI"时必须遵循本文件。`src/features/auth/` 内部实现不受约束。

外部消费方**只跟 `useAuthState()` + `ensure*` 闸门 + `getCurrent*Capability()` 打交道**，不需要也不允许关心 Session kind / JWT 存储 / 钱包签名细节。

---

## 1. 公共 API（只能从 `@/features/auth` import）

禁止深路径 import（`@/features/auth/stores/...` / `@/features/auth/services/...` / `@/features/auth/infra/...` / `@/features/auth/domain/...`）。所有消费入口必须走 `features/auth/index.ts`。

| 类别              | 允许使用                                                                                                                                                                                                                             | 用途                                                                               |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| 类型              | `Session` / `IdentityWithJwt` / `ExchangeCapability` / `OnChainCapability` / `ApiKey`                                                                                                                                                | Service 形参类型；narrow 通过 hook + capability getter 派生，不直接消费 DU variant |
| 响应式 hook       | `useAuthState()`                                                                                                                                                                                                                     | UI / Query `enabled` / 派生展示信号——**外部消费派生信号的唯一入口**                |
| 鉴权闸门          | `ensureReadIdentity` / `ensureWriteIdentity` / `ensureExchangeCapability` / `ensureOnChainCapability`                                                                                                                                | 按"接下来要做什么"分流，await 即拿 capability/identity                             |
| Capability getter | `getCurrentExchangeCapability` / `getCurrentPrimaryExchangeCapability` / `getCurrentOnChainCapability` / `getCurrentIdentityCredential` / `getCurrentReadIdentityCredential` / `getCurrentBearerToken` / `hasLiveExchangeCapability` | action / mutation 内部命令式读凭据；HTTP 注入                                      |
| 顶层 action       | `logout()` / `waitForAccountReady()`                                                                                                                                                                                                 | 登出；bridge 后等链上 account 注册完成（命令式前置）                               |
| UI 辅助 hook      | `useWalletSigningText()` / `useAuthApproveMode()`                                                                                                                                                                                    | 钱包签名 i18n 文案；inline approve 按钮 silent / prompt 状态                       |
| App 顶层挂载      | `AuthAppRoot` / `setupAuthHttpInterceptor()` / `registerAuthQueryClient` / `registerAuthWagmiConfig`                                                                                                                                 | 仅 `App.tsx` 单点使用                                                              |
| Feature widgets   | `HeaderConnectWallet` / `ConnectWalletGuard` / `openConnectWalletDialog` / `openStaySignedInDialog` / `QrLoginGate`                                                                                                                  | App / Page 层组合                                                                  |

`useAuthState()` 暴露的派生原子值（直接解构使用）：

```ts
{
  // 操作身份
  address,            // 当前操作身份地址（业务用；admin-watch 下自动是 watchedAddress）
  accountId,          // 链上 / exchange accountId；进 queryKey
  connectedAddress,   // wagmi 物理连接的钱包地址（直接来自 useAccount().address）；qr/anonymous 下 null
  // 鉴权状态
  isAuthenticated,    // JWT 已落地、非 watch
  apiKeyValid,        // active ExchangeCapability 可用且未过期
  isSilentSigner,     // 当前 signer 是 Privy embedded（可静默签）
  // session 类型
  isWatching,         // watch 模式
  // 瞬态信号
  isAuthInitializing, // cold-start 编排中
  isAccountIdProbing, // 链上 accountId probe 中
  isAddressSwitching, // wagmi 已切但 session 未追上的瞬态
}
```

---

## 2. Session × Capability 对照

| Session kind           | Identity (JWT) | accountId | Exchange (apiKey) | OnChain (signer) | 来源                          |
| ---------------------- | -------------- | --------- | ----------------- | ---------------- | ----------------------------- |
| `anonymous`            | ❌             | ❌        | ❌                | ❌               | 未登录                        |
| `wallet-connected`     | ❌             | ⚠️        | ❌                | ✅               | 仅连了钱包，未签 JWT          |
| `wallet-identity-only` | ✅             | ⚠️        | ❌                | ✅               | 钱包签了 JWT，链上未建账户    |
| `wallet-session`       | ✅             | ✅        | ✅                | ✅               | 完整钱包登录                  |
| `qr-session`           | ✅             | ✅        | ✅                | **❌**           | 手机扫 PC QR                  |
| `watch`                | ❌（adminJwt） | ✅        | ❌                | ❌               | URL `?watch=0x…` (`&admin=1`) |

⚠️ = `chainAccountId`，仅表示"链上探到此 address 已注册账户"，**不**等于持有 apiKey。

**三个易错点**：

1. **`qr-session` 无 OnChain** — 任何链上签名（permit deposit / withdraw 链上 leg / approve）都被 `ensureOnChainCapability()` 拒。要切到 wallet 必须先 `logout()`。
2. **`watch` 模式只读** — 所有 `ensureWriteIdentity` / `ensureExchangeCapability` / `ensureOnChainCapability` 都拒，闸内已 toast，调用方不必关心。
3. **QR ↔ Wallet 物理互斥** — qr-session 期间 wagmi 强制 disconnected。不要尝试在 qr-session 上叠加钱包连接。

### `address` vs `connectedAddress`

两个字段语义正交，**不可互换**：

| 字段               | 含义               | 来源                   | qr-session 下    | watch 下           |
| ------------------ | ------------------ | ---------------------- | ---------------- | ------------------ |
| `address`          | 当前操作身份地址   | session 派生           | identity.address | watchedAddress     |
| `connectedAddress` | wagmi 物理连接钱包 | `useAccount().address` | null             | admin 钱包（若有） |

| 用途                                                                                   | 取哪个                            |
| -------------------------------------------------------------------------------------- | --------------------------------- |
| 当前用户的业务数据（积分 / referral / 资产 / deposit 历史）                            | `useAuthState().address`          |
| "钱包是否真在这台设备上"（vault dialog 守门、ConnectWalletGuard、ERC-20 readContract） | `useAuthState().connectedAddress` |
| 业务签名 receiver / allowance owner / bridge receiver                                  | `OnChainCapability.signerAddress` |

链上签名场景**绝不能用** `address`——QR session 下身份地址 ≠ 实际连着的钱包，会签错户。

---

## 3. 业务入口选择

按"用户点击这个按钮，需要什么前置条件"选 API。`ensure*` 闸门内部自动按 cache / silent / 钱包签名 fallback 顺序复用最少签名，调用方不必关心实现。

| 场景                                                             | API                                                 | 返回 / reject                                                                                               |
| ---------------------------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 仅打开 Connect Wallet UI（不要鉴权）                             | `openConnectWalletDialog()`                         | void，只打开钱包选择器                                                                                      |
| 读身份绑定数据（inbox / 积分 / referral 列表；admin-watch 通过） | `ensureReadIdentity({ reason, title, step2Text })`  | `Promise<IdentityWithJwt>`；reject `NOT_AUTHENTICATED`                                                      |
| 以业务身份写（join referral / mutation；watch 拒）               | `ensureWriteIdentity({ reason, title, step2Text })` | `Promise<IdentityWithJwt>`；reject `NOT_AUTHENTICATED`                                                      |
| 交易所签名（下单 / 撤单 / TP-SL / Transfer / Withdraw）          | `ensureExchangeCapability({ title, step2Text })`    | `Promise<ExchangeCapability>`；reject `EXCHANGE_CAPABILITY_MISSING`                                         |
| 链上签名（permit deposit / withdraw 链上 leg / EIP-712 等）      | `ensureOnChainCapability()`                         | `Promise<OnChainCapability>`；reject `QR_MODE_BLOCK` / `WATCH_MODE_BLOCK` / `NOT_CONNECTED`（闸内已 toast） |
| 区域级 UI 阻塞（控件遮蔽，未点击）                               | `<ConnectWalletGuard>`                              | 纯展示 guard                                                                                                |

```ts
const id = await ensureReadIdentity({ reason, title, step2Text }); // id.jwt / id.address
const id = await ensureWriteIdentity({ reason, title, step2Text }); // 同上，watch 拒
const ex = await ensureExchangeCapability({ title, step2Text }); // ex.apiKey / ex.accountId
const oc = await ensureOnChainCapability(); // oc.signerAddress / oc.walletClient / oc.ensureChain
```

**错误处理**：所有 `ensure*` 失败时闸内已 toast / notify。调用方多数 `try/catch` 吞掉即可；mutation 里把 `EXCHANGE_CAPABILITY_MISSING` / `NOT_AUTHENTICATED` 映射成业务 ServiceError 的 USER_REJECTED，由 `handleServiceError` 统一展示，不要把闸门错误码暴露到 UI。

---

## 4. 按"要做什么"选最小 capability

消费方按职责选最小能力集，禁止统一传 Session 或整个 state。

| 场景                                                      | 选什么                                                |
| --------------------------------------------------------- | ----------------------------------------------------- |
| 读身份绑定数据（积分 / referral / KYC / notification）    | `IdentityWithJwt`（来自 `ensureReadIdentity` 返回值） |
| 读账户公开数据（positions / orders / history / balances） | `useAuthState().accountId` 进 queryKey                |
| 向交易所签名（下单 / 撤单 / TP-SL / 账户间划转）          | `ExchangeCapability`（active 账户）                   |
| Withdraw 前的 Spot → Funding 过户                         | Primary `ExchangeCapability`                          |
| 链上签名（permit deposit / withdraw 链上 leg）            | `OnChainCapability`                                   |

Query 读账户级数据时，标准做法：从 `useAuthState()` 取 `accountId` 进 queryKey，`enabled: !!accountId`；HTTP 401 由全局拦截器统一处理，feature 无需拿 JWT。

---

## 5. 两条消费路径

凭据可能被 session health check 静默刷新——**响应式信号用 hook**，**实际使用凭据用 call-time getter / ensure 闸门**。

### 5.1 UI / Query `enabled` → `useAuthState()`

```tsx
const { isAuthenticated, apiKeyValid, accountId } = useAuthState();

useQuery({
  queryKey: queryKeys.xxx.list(accountId),
  queryFn: () => xxxApi.list(accountId!),
  enabled: !!accountId,
});
```

### 5.2 action / mutation → `await ensure*()`

```ts
useMutation({
  mutationFn: async (params) => {
    const cap = await ensureExchangeCapability({ title, step2Text });
    return submitOrderService(cap, params);
  },
});
```

### 5.3 多步流程需要快照初始 capability

withdraw 等多步流程在中途要"定住发起时身份"，在 `onMutate` 里用 `getCurrent*Capability()` 拿一份保存，避免静默刷新后用错凭据。

### 5.4 Click handler

```ts
async function handleOpenInbox() {
  try {
    await ensureReadIdentity({ reason: "inbox", title, step2Text });
    onOpen();
  } catch {
    /* 闸门已 toast */
  }
}
```

---

## 6. Service 层签名约定

Command Service / Domain 层凡使用凭据的函数，**capability 必须是第一参数**，Service 内部禁止读凭据 / 触发签名：

```ts
// ✅ 正确
export async function submitOrder(
  capability: ExchangeCapability,
  params: SubmitOrderParams,
): Promise<OrderResult> { /* ... */ }

// ❌ 错误：Service 不读凭据
export async function submitOrder(params: SubmitOrderParams) {
  const cap = getCurrentExchangeCapability(); // 禁止
}

// ❌ 错误：Service 不触发钱包签名
export async function submitOrder(params: SubmitOrderParams) {
  await authApi.fetchNonce({ ... });   // 禁止
  await signLoginMessage(message);     // 禁止
}
```

---

## 7. `wallet_address` 参数约定

所有"查当前登录用户数据"的业务端点（points / referral / airdrop / consent / apikey 等）前端必须显式传 `wallet_address`，后端按此参数定位返回数据，JWT 仅做鉴权。

```ts
// ✅ 正确——无论 GET/POST，都走 querystring
authedBizClient.post("biz/xxx/list", {
  searchParams: { wallet_address: walletAddress },
  json: { page, pageSize }, // body 只放其它分页参数
});

// ❌ 错误（后端收不到）
searchParams: {
  walletAddress;
} // 没 snake_case
json: {
  wallet_address: walletAddress;
} // POST 也不能放 body
```

硬规则：

- `walletAddress` 一律取自 `useAuthState().address`（admin-watch 下自动是被观察用户地址）
- 出线字段名一律 snake_case `wallet_address`，**位置在 querystring**（不管 GET/POST）
- queryKey 必须包含该 address
- 禁止 infra 层自己读 session 拼参数——必须 container 显式传入

---

## 8. 硬禁止

- 禁止 import `useAuthStore` 或任何深路径 (`features/auth/{stores,services,infra,domain}/...`)
- 禁止外部触发钱包签名（`fetchNonce` / `signLoginMessage` / `verifySignature` / `signTypedData`）——只能在 auth feature 内
- 禁止外部读写 JWT 存储 / 新建 typed token bucket（全站一张 JWT）
- 禁止外部写 session（`setSession` / `setJwtToken`）
- 禁止 Service 内部调 `getCurrent*Capability()` 或签名函数——capability 必须形参传入
- 禁止手写 `isConnected / isAuthenticated` 的 2×2 分支自己拼"未连接 → 连接钱包 + 签名"流程，统一走 `ensure*`
- 禁止把原始凭据（`jwt` / `privateKey` / `apiKey`）穿透到 UI 组件
- 禁止用 `useAuthState().address` 作为链上签名 receiver / allowance owner——必须 `OnChainCapability.signerAddress`
- 禁止在 render 期把 capability 解构到闭包后给 mutation 用——mutation 在 `mutationFn` / `onMutate` 内 call-time 读取
- 禁止业务代码里 `session.kind === "xxx"` 分支判断——用 type guard 或 capability null 判断；按 kind 给提示文案的极少数场景才用 `getCurrentSessionKind()`
- 禁止在 qr-session 上叠加 wagmi 连接（物理互斥，要切先 `logout()`）
- 禁止重新实现 `useAuthState()` 已暴露的派生信号（`isSilentSigner` / `connectedAddress` / `isAuthenticated` / `apiKeyValid` 等）——单点维护；新增类似派生信号也优先加到 `useAuthState()`

---

## 9. 生成/修改代码后自检

- [ ] 涉及 auth 的 import 是否全部来自 `@/features/auth`？（无深路径 / 无 `useAuthStore` / `authService` / `authApi`）
- [ ] 鉴权入口选对了吗？（读身份 → `ensureReadIdentity`、写身份 → `ensureWriteIdentity`、签单 → `ensureExchangeCapability`、链上签 tx → `ensureOnChainCapability`）
- [ ] mutation 是否 `await ensure*()` 一行拿 capability，而不是先 ensure 再 getter？
- [ ] 多步流程是否在 `onMutate` 用 `getCurrent*Capability()` 快照？
- [ ] Query `enabled` / queryKey 是否走 `useAuthState()` 派生字段（而非自己读 session）？
- [ ] 选了最小 capability 吗？（读账户公开 = `accountId` query；身份数据 = Identity；下单 = active Exchange；过户 = primary Exchange；链上签 = OnChain）
- [ ] Service 函数是否 `capability` 作首参，内部不读凭据 / 不触发签名？
- [ ] 链上签名 receiver / allowance owner 是否取自 `OnChainCapability.signerAddress`（不是 `useAuthState().address`）？
- [ ] 凭据原始字段（`jwt` / `privateKey` / `apiKey`）是否未穿透到 UI？
- [ ] 没有 `session.kind === "xxx"` 分支吧？
- [ ] 没在 qr-session 上叠加 wagmi 吧？
- [ ] 没重新实现 `useAuthState()` 已有的派生信号吧？
- [ ] 新"查登录用户数据"端点：`wallet_address` 走 querystring（snake_case），container 从 `useAuthState().address` 取并进 queryKey？
