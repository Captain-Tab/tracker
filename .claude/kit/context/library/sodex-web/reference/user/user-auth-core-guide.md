# 用户鉴权核心机制

## 概述

SoDEX 项目的鉴权系统基于 JWT Token，通过钱包签名验证用户身份。整体分为三层：

1. **API 层**：`/auth/check`、`/auth/v2/nonce`、`/auth/v2/verify`
2. **全局鉴权层**：`useAuthTokenValidation` - 自动校验和刷新 Token
3. **页面级鉴权层**：`usePageAuth` - 状态机管理页面鉴权流程

```
┌─────────────────────────────────────────────────────────────────┐
│                         用户鉴权架构                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    页面级鉴权层                          │   │
│  │         usePageAuth (状态机: idle→checking→auth)        │   │
│  │   src/hooks/usePageAuth.ts                              │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              ↓                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    全局鉴权层                            │   │
│  │   useAuthTokenValidation (自动校验/刷新)                 │   │
│  │   src/hooks/useAuthTokenValidation.ts                   │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              ↓                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                      API 层                              │   │
│  │   /auth/check  /auth/v2/nonce  /auth/v2/verify          │   │
│  │   src/http/auth/index.ts                                │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              ↓                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    Token 存储层                          │   │
│  │   localStorage: __auth_token_map__                       │   │
│  │   src/utils/storage/local.ts                            │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 核心概念

### Auth Token

- **类型**: JWT (JSON Web Token)
- **用途**: 验证用户身份，调用需要鉴权的 API
- **存储**: `localStorage`，按钱包地址隔离
- **有效期**: 服务端控制，前端通过 `/auth/check` 验证

### Auth Sign Type

签名类型，用于区分不同场景：

```typescript
// src/http/auth/index.ts Line 7-13
export type AuthSignType =
  | "sign_in"        // 普通登录/刷新 token
  | "terms_of_use"   // 用户协议签署
  | "referral"       // 邀请页面鉴权
  | "referral_join"  // 邀请码绑定
  | "point"          // 积分页面鉴权
  | "airdrop_claim"; // 空投领取
```

### 私钥 (Private Key)

- 本地存储的私钥，用于自动签名刷新 Token
- 分为 `webkey`（浏览器）和 `mobilekey`（手机扫码）
- 有过期时间，需要与服务端校验

---

## API 接口

### 1. 检查 Token 有效性

```typescript
// src/http/auth/index.ts Line 53-61
POST /auth/check
Headers: { Authorization: "Bearer ${token}" }

// 响应
interface CheckAuthTokenResponse {
  active: boolean;
}
```

### 2. 获取 Nonce

```typescript
// src/http/auth/index.ts Line 64-69
POST /auth/v2/nonce

interface GetAuthNonceParams {
  address: string;
  type?: AuthSignType;
}

interface GetAuthNonceResponse {
  nonce: string;      // 随机数
  domain: string;     // 签名域
  expiresIn: number;  // 过期时间
  message: string;    // 待签名消息
  type: string;       // 签名类型
}
```

### 3. 验证签名并获取 Token

```typescript
// src/http/auth/index.ts Line 73-79
POST /auth/v2/verify

interface VerifyAuthSignatureParams {
  address: string;
  message: string;
  signature: string;
  type: AuthSignType;
  autoSign: boolean;  // 是否自动签名（私钥签名时为 true）
}

interface VerifyAuthSignatureResponse {
  accessToken: string;
  expiresIn: number;
}
```

---

## Token 存储

### 存储位置

```typescript
// src/utils/storage/local.ts Line 216-220
localStorage key: "__auth_token_map__"
格式: Record<string, string>  // { [address.toLowerCase()]: token }
```

### 关键函数

```typescript
// src/utils/storage/local.ts Line 225-251

// 获取 token
getAuthToken(address?: string): string | undefined

// 设置 token
setAuthToken(token: string, address?: string): void

// 移除 token
removeAuthToken(address?: string): void

// 移除所有 token
removeAllAuthTokens(): void
```

### 兼容性说明

`getReferralAuthToken` 和 `getAuthToken` 共用相同的 storage key（`__auth_token_map__`），实际读取同一个值。

---

## 全局鉴权流程 (useAuthTokenValidation)

### 入口文件

```
src/hooks/useAuthTokenValidation.ts
```

### 全局启用

在 `src/components/baseInfoRequester/index.tsx` 中全局调用：

```typescript
// src/components/baseInfoRequester/index.tsx Line 32-33
useReferralCodeBinding();
useAuthTokenValidation();
```

### 触发时机

1. **组件挂载时**（页面刷新）
2. **页面从隐藏变为可见时**（visibilitychange 事件）
3. **私钥变化时**（privateKeyChanged 事件）

### 核心逻辑

```
┌─────────────────────────────────────────────────────────────────┐
│                      页面加载 / 页面可见                          │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                    检查本地是否有 token                           │
│  (useAuthTokenValidation.ts Line 150-151)                       │
└─────────────────────────────────────────────────────────────────┘
                                │
                    ┌───────────┴───────────┐
                    │                       │
                    ▼                       ▼
              有 token                  无 token
                    │                       │
                    ▼                       │
┌─────────────────────────────┐             │
│  调用 /auth/check 验证有效性  │             │
│  (Line 22-30)               │             │
└─────────────────────────────┘             │
                    │                       │
          ┌────────┴────────┐               │
          │                 │               │
          ▼                 ▼               │
      token 有效        token 无效           │
          │                 │               │
          ▼                 ▼               ▼
        完成         ┌──────────────────────────┐
                    │     清除本地 token         │
                    │  (Line 154-155)           │
                    └──────────────────────────┘
                                │
                                ▼
                    ┌──────────────────────────┐
                    │    检查本地私钥是否有效     │
                    │  (Line 43-82)             │
                    └──────────────────────────┘
                                │
                    ┌───────────┴───────────┐
                    │                       │
                    ▼                       ▼
               私钥有效                  私钥无效
                    │                       │
                    ▼                       ▼
┌─────────────────────────────┐   ┌──────────────────────────┐
│   使用私钥自动签名刷新 token   │   │  触发 authTokenRemoved    │
│   (Line 85-141)             │   │  事件，等待用户重新签名    │
│   1. getAuthNonce           │   └──────────────────────────┘
│   2. account.signMessage    │
│   3. verifyAuthSignature    │
│   4. setAuthToken           │
│   5. 触发 authTokenRefreshed │
└─────────────────────────────┘
```

### 私钥有效性检查

```typescript
// src/hooks/useAuthTokenValidation.ts Line 43-82
checkPrivateKeyValid = async () => {
  // 1. 获取本地私钥
  const localPrivateKey = getUserPrivateKey()[address];
  if (!localPrivateKey) return false;
  
  // 2. 获取服务端私钥信息
  const serverKeyInfo = await getPrivateKey({ accountId, name });
  
  // 3. 校验公钥是否匹配
  if (serverKeyInfo.publicKey !== localAccount.address) return false;
  
  // 4. 校验是否过期
  if (now >= serverKeyInfo.expiresAt) return false;
  
  return true;
}
```

---

## 页面级鉴权 (usePageAuth)

### 入口文件

```
src/hooks/usePageAuth.ts
```

### 状态机

```typescript
// src/hooks/usePageAuth.ts Line 64-69
type AuthState =
  | "idle"           // 初始状态（未连接钱包）
  | "checking"       // 检查 token 中
  | "obtaining"      // 获取 token 中（签名流程）
  | "authenticated"  // 已鉴权
  | "unauthenticated"; // 未鉴权（已连接但无有效 token）
```

### 状态流转

```
idle → (连接钱包) → checking → authenticated / unauthenticated
unauthenticated → (用户点击鉴权) → obtaining → authenticated / unauthenticated
```

### 两种鉴权路径

```typescript
// src/hooks/usePageAuth.ts Line 268-330
obtainToken = async () => {
  // 显式查询 userid
  const userId = await user.getUserIdByAddress(addr);

  if (userId) {
    // 有 userid：走 enableTrading 流程（签名 -> Stay signed in）
    await doEnableTrading();
  } else {
    // 没有 userid：走完整的 auth token 签名流程
    const success = await obtainAuthToken();
  }
}
```

### 使用示例

```typescript
// src/pages/referrals/index.tsx Line 149-159
const {
  hasToken: hasReferralToken,
  isInitializing,
  obtainToken,
  onTokenObtained,
  onTokenFailed,
} = usePageAuth({
  authType: "referral",
  openAuthModal,
});
```

### 派生状态

```typescript
// src/hooks/usePageAuth.ts Line 134-137
const hasToken = authState === "authenticated";
const isInitializing = authState === "checking" || authState === "idle";
const isObtainingToken = authState === "obtaining";
```

---

## Terms of Use 签署流程

### 入口文件

```
src/contexts/login/index.tsx
```

### 触发时机

用户首次连接钱包时，检查是否签署过用户协议。

### 流程

```typescript
// src/contexts/login/index.tsx Line 800-919
checkUserAgreement = async () => {
  // 1. 检查用户是否已签署协议
  const { data: hasSigned } = await checkUserAgreementService({
    walletAddress: address,
    termsCode: "faucet",
  });
  
  if (!hasSigned) {
    // 2. 弹出协议弹窗，用户同意后
    // 3. 获取 nonce
    const { message } = await getAuthNonce({ address, type: "terms_of_use" });
    
    // 4. 用户钱包签名
    const signature = await signMessageByWalletType(message);
    
    // 5. 保存协议签署记录
    await saveUserAgreementService({ walletAddress, termsCode, signature, message });
    
    // 6. 获取 auth token
    const { accessToken } = await verifyAuthSignature({
      address, message, signature,
      type: "terms_of_use",
      autoSign: false,
    });
    
    // 7. 保存 token
    local.setAuthToken(accessToken, address);
  }
}
```

---

## 事件机制

### 自定义事件

| 事件名 | 触发时机 | 数据 | 监听方 |
|--------|----------|------|--------|
| `privateKeyChanged` | 私钥更新/删除 | - | useAuthTokenValidation |
| `authTokenRefreshed` | Token 自动刷新成功 | `{ address }` | usePageAuth, referrals 页面 |
| `authTokenRemoved` | Token 被移除 | `{ address }` | usePageAuth |

### 浏览器事件

| 事件名 | 触发时机 | 监听方 |
|--------|----------|--------|
| `visibilitychange` | 页面可见性变化 | useAuthTokenValidation |
| `storage` | localStorage 跨 tab 变化 | usePageAuth |

---

## 文件结构

```
src/
├── http/
│   └── auth/
│       └── index.ts           # Auth API 定义
├── hooks/
│   ├── useAuthTokenValidation.ts  # 全局鉴权 Hook
│   └── usePageAuth.ts         # 页面级鉴权 Hook
├── utils/
│   └── storage/
│       └── local.ts           # Token 存储方法
├── contexts/
│   └── login/
│       └── index.tsx          # Terms of Use 签署逻辑
└── components/
    └── baseInfoRequester/
        └── index.tsx          # 全局组件（启用鉴权）
```

---

## 关键设计决策

### 1. 分层架构

- **全局层** 负责自动维护 Token 有效性
- **页面层** 提供状态机 API，页面按需触发鉴权
- 两层解耦，互不干扰

### 2. 两种鉴权路径

- **有 userid**：复用 enableTrading 流程，保持一致体验
- **无 userid**：直接签名获取 Token，简化首次用户流程

### 3. 事件驱动

- 使用自定义事件解耦组件间通信
- `authTokenRefreshed` 允许页面响应 Token 刷新
- `authTokenRemoved` 允许页面响应 Token 失效

---

## 术语表

| 术语 | 说明 |
|------|------|
| Auth Token | JWT 格式的用户身份凭证 |
| AuthSignType | 签名类型，区分不同业务场景 |
| Private Key | 本地存储的私钥，用于自动签名 |
| webkey | 浏览器环境的私钥 |
| mobilekey | 手机扫码登录的私钥 |
| enableTrading | 启用交易流程（生成/刷新私钥） |
| nonce | 一次性随机数，防重放攻击 |

---

## 更新记录

### 2026-03-04: 初始版本

基于代码分析生成，通过 /k/context learn 创建
