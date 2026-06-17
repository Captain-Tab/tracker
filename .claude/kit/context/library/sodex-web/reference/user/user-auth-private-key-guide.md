# 私钥管理机制

## 概述

私钥管理是 Enable Trading 的底层机制，负责：
1. **判断**是否需要 Enable Trading（`needsPrivateKeyRefresh`）
2. **校验**本地私钥与服务端公钥是否匹配（`validatePrivateKey`）
3. **注册** API Key 到服务端（`addAPIKey`）
4. **刷新**私钥状态（`refreshPrivateKey`）

### 架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                       私钥管理架构                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              usePrivateKeyRefresh (Hook)                 │   │
│  │   协调层：监听状态变化，触发校验和刷新                      │   │
│  │   src/hooks/usePrivateKeyRefresh.ts                     │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                  │
│              ┌───────────────┴───────────────┐                  │
│              ↓                               ↓                  │
│  ┌─────────────────────────┐   ┌─────────────────────────────┐ │
│  │   user.ts (MobX Store)  │   │   useSignApi (Hook)         │ │
│  │   状态层                 │   │   逻辑层                     │ │
│  │   - needsPrivateKey     │   │   - validatePrivateKey()    │ │
│  │     Refresh             │   │   - addAPIKey()             │ │
│  │   - isRefreshingPrivate │   │   - generatePayload()       │ │
│  │     Key                 │   │                             │ │
│  │   - checkPrivateKey     │   │   src/hooks/useSignApi/     │ │
│  │     Validity()          │   │   useSignApi.ts             │ │
│  │   - refreshPrivateKey() │   │                             │ │
│  └─────────────────────────┘   └─────────────────────────────┘ │
│                              │                                  │
│                              ↓                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    服务端 API                            │   │
│  │   spotUniversalApi / futuresUniversalApi                │   │
│  │   (注册 API Key)                                        │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 核心状态

### MobX Observable (user.ts)

```typescript
// src/models/user.ts Line 88-95

@observable
needsPrivateKeyRefresh: boolean = true;  // 是否需要 Enable Trading

@observable
isRefreshingPrivateKey: boolean = false;  // 是否正在刷新中

@observable
privateKeyCheckTimestamp: number = 0;  // 上次检查时间戳（用于缓存）

private privateKeyCheckPromise: Promise<void> | null = null;  // 防并发
private lastCheckedAddress: string | null = null;  // 检测账号切换
```

### 状态含义

| 状态 | 值 | UI 表现 |
|------|-----|---------|
| `needsPrivateKeyRefresh` | `true` | 显示 "Enable Trading" 按钮 |
| `needsPrivateKeyRefresh` | `false` | 显示正常交易按钮 |
| `isRefreshingPrivateKey` | `true` | 按钮显示 loading |

---

## 判断是否需要 Enable

### checkPrivateKeyValidity 流程

```
页面加载 / 切换账号 / 页面可见 / 私钥变化
    ↓
usePrivateKeyRefresh useEffect 触发
    ↓
user.checkPrivateKeyValidity(validatePrivateKey)
    ↓
[防并发检查] privateKeyCheckPromise !== null ?
    ├─ Yes → 返回现有 Promise（不重复检查）
    └─ No → 继续
        ↓
[地址切换检测] lastCheckedAddress !== currentAddress ?
    ├─ Yes → needsPrivateKeyRefresh = true + 清空缓存
    └─ No → 继续
        ↓
[缓存检查] now - privateKeyCheckTimestamp < 3000ms ?
    ├─ Yes → 返回（使用缓存结果）
    └─ No → 继续
        ↓
[执行校验] validatePrivateKey(realId, address)
    ↓
[更新状态] needsPrivateKeyRefresh = result
           privateKeyCheckTimestamp = now
```

### 代码实现

```typescript
// src/models/user.ts Line 625-700

public async checkPrivateKeyValidity(
  validatePrivateKey: (userId: string, address: string) => Promise<boolean>,
): Promise<void> {
  // 1. 正在刷新时不检查，避免竞态
  if (this.isRefreshingPrivateKey) {
    return Promise.resolve();
  }

  // 2. 检测账号切换
  const addressChanged = this.lastCheckedAddress && 
    this.lastCheckedAddress !== currentAddress;
  if (addressChanged) {
    this.needsPrivateKeyRefresh = true;  // 立即设为需要刷新
    this.privateKeyCheckTimestamp = 0;    // 清空缓存
    this.privateKeyCheckPromise = null;
  }
  this.lastCheckedAddress = currentAddress;

  // 3. 防并发：如果有正在进行的检查，复用
  if (this.privateKeyCheckPromise) {
    return this.privateKeyCheckPromise;
  }

  // 4. 缓存机制：3 秒内不重复检查
  const CACHE_DURATION = 3 * 1000;
  if (this.privateKeyCheckTimestamp && 
      now - this.privateKeyCheckTimestamp < CACHE_DURATION) {
    return Promise.resolve();
  }

  // 5. 执行实际校验
  this.privateKeyCheckPromise = (async () => {
    try {
      const needsRefresh = await validatePrivateKey(realId, address);
      
      // 再次检查是否在刷新中，避免覆盖
      if (!this.isRefreshingPrivateKey) {
        runInAction(() => {
          this.needsPrivateKeyRefresh = needsRefresh;
          this.privateKeyCheckTimestamp = Date.now();
        });
      }
    } catch (error) {
      if (!this.isRefreshingPrivateKey) {
        this.needsPrivateKeyRefresh = true;  // 出错时标记需要刷新
      }
    } finally {
      this.privateKeyCheckPromise = null;
    }
  })();

  return this.privateKeyCheckPromise;
}
```

---

## 校验私钥有效性

### validatePrivateKey 流程

```
validatePrivateKey(accountId, address)
    ↓
[本地私钥检查] getUserPrivateKey()[address] 存在?
    ├─ No → return true（需要 Enable）
    └─ Yes → 继续
        ↓
[服务端查询] getPrivateKey({ accountId, name: "webkey" })
    ↓
[服务端记录检查] response.data 存在?
    ├─ No → return true（服务端无记录，需要重新注册）
    └─ Yes → 继续
        ↓
[公钥匹配检查] serverKeyInfo.publicKey === localAccount.address ?
    ├─ No → 清除本地私钥 + return true（不匹配，需要重新注册）
    └─ Yes → 继续
        ↓
[过期检查] now >= serverKeyInfo.expiresAt ?
    ├─ Yes → return true（已过期）
    └─ No → return false（私钥有效，不需要 Enable）
```

### 代码实现

```typescript
// src/hooks/useSignApi/useSignApi.ts Line 74-123

const validatePrivateKey = async (
  accountId: string,
  address?: Address | string,
): Promise<boolean> => {
  if (!accountId) return true;

  try {
    // 1. 检查本地私钥
    const localPrivateKeys = await getUserPrivateKey();
    const localPrivateKey = localPrivateKeys?.[String(address)];
    if (!localPrivateKey) {
      return true;  // 本地没有私钥
    }

    // 2. 获取服务端私钥信息
    const response = await getPrivateKey({
      accountId,
      name: local.getWalletType() === "qr_code" ? "mobilekey" : "webkey",
    });
    if (!response?.data || response.data.length === 0) {
      return true;  // 服务端没有记录
    }

    // 3. 校验公钥是否匹配
    const serverKeyInfo = response.data[0];
    const localAccount = getPrivateKeyToAccount(accountId, localPrivateKey);
    if (serverKeyInfo.publicKey.toLowerCase() !== localAccount.address.toLowerCase()) {
      // 不匹配：清除本地私钥
      local.removePrivateKeyByAddress?.(String(address));
      session.removePrivateKeyByAddress?.(String(address));
      
      // QR 码登录特殊处理：断开连接
      if (local.getWalletType() === 'qr_code') {
        await disconnectWallet();
        notify.error(i18n.t("spot:qr_code_expired_please_login_again"));
      }
      return true;
    }

    // 4. 检查是否过期
    if (serverKeyInfo.expiresAt && Date.now() >= serverKeyInfo.expiresAt) {
      return true;
    }

    return false;  // 私钥有效
  } catch (error) {
    console.error("validatePrivateKey error:", error);
    return true;  // 出错时为安全起见，标记需要刷新
  }
};
```

---

## 注册 API Key

### addAPIKey 流程

```
用户点击 Enable Trading → signMessage() → refreshPrivateKey()
    ↓
user.refreshPrivateKey(addAPIKey, handleAddNetwork)
    ↓
addAPIKey()
    ↓
[前置检查] isSigning || !address ?
    ├─ Yes → return false
    └─ No → 继续
        ↓
[等待 realId] user.realId 存在?
    ├─ No → await when(() => !!user.realId, { timeout: 8000 })
    └─ Yes → 继续
        ↓
setIsSigning(true)
    ↓
generatePayload(realId, nonce)
    ├─ getOrCreatePrivateKey(accountId)  ← 生成/获取本地私钥
    ├─ getPrivateKeyToAccount(accountId, privateKey)  ← 推导公钥地址
    ├─ signSpotAddAPIKeyRequest(params, nonce)  ← EIP-712 签名
    └─ return { type, params, nonce, signature, privateKey, domain }
        ↓
[并行注册] Promise.all([
    spotUniversalApi(params),
    futuresUniversalApi(params)
])
        ↓
[保存私钥] storage.setPrivateKey({ [addressKey]: privateKey })
    ↓
[双重验证] storage.getPrivateKey()[addressKey] === privateKey ?
    ├─ Yes → return true（成功）
    └─ No → 尝试 fallback 存储 / throw Error
```

### 代码实现

```typescript
// src/hooks/useSignApi/useSignApi.ts Line 124-219

const addAPIKey = async (): Promise<boolean> => {
  if (isSigning || !address) return false;

  // 等待 realId 准备好
  if (!user.realId) {
    try {
      await when(() => !!user.realId, { timeout: 8000 });
    } catch {
      console.warn("[addAPIKey] 等待 realId 超时");
      return false;
    }
  }

  try {
    setIsSigning(true);
    const nonce = Number(getNonce());
    const payload = await generatePayload(user.realId!, nonce);
    if (!payload) throw new Error("generatePayload failed");

    // 注册到服务端
    const params = {
      type: "addAPIKey",
      params: {
        ...payload.params,
        accountID: Number(payload.params.accountID),
        type: Number(payload.params.type),
        expiresAt: Number(payload.params.expiresAt),
      },
      nonce,
      signature: payload.signature,
      signatureChainID: Number(payload.domain.chainId),
    };

    await Promise.all([
      spotUniversalApi(params),
      futuresUniversalApi(params),
    ]);

    // 保存私钥到本地
    const rememberMe = localStorage.getItem(getStayConnectedSessionKey());
    const storage = rememberMe ? local : session;
    const addressKey = String(user.realAddress);

    storage.setPrivateKey({ [addressKey]: payload.privateKey });

    // 双重验证
    const saved = storage.getPrivateKey();
    if (!saved?.[addressKey] || saved[addressKey] !== payload.privateKey) {
      throw new Error("Private key storage verification failed");
    }

    return true;
  } catch (error) {
    console.error("addAPIKey failed:", error);
    return false;
  } finally {
    setIsSigning(false);
  }
};
```

---

## 刷新私钥

### refreshPrivateKey 流程

```
refreshPrivateKey(addAPIKey, handleAddNetwork)
    ↓
[防重入] isRefreshingPrivateKey || !id ?
    ├─ Yes → return false
    └─ No → 继续
        ↓
isRefreshingPrivateKey = true
    ↓
await addAPIKey()
    ↓
[检查结果] success ?
    ├─ No → needsPrivateKeyRefresh = true + return false
    └─ Yes → 继续
        ↓
needsPrivateKeyRefresh = false
privateKeyCheckTimestamp = Date.now()
    ↓
await sleep(50)  ← 等待 privateKeyChanged 事件处理完成
    ↓
[再次确认] needsPrivateKeyRefresh = false（防止被事件覆盖）
    ↓
isRefreshingPrivateKey = false
return true
```

### 代码实现

```typescript
// src/models/user.ts Line 711-767

public async refreshPrivateKey(
  addAPIKey: () => Promise<boolean>,
  handleAddNetwork: () => Promise<void>,
): Promise<boolean> {
  if (this.isRefreshingPrivateKey || !this.id) {
    return false;
  }

  try {
    runInAction(() => {
      this.isRefreshingPrivateKey = true;
    });

    const success = await addAPIKey();
    if (!success) {
      runInAction(() => {
        this.needsPrivateKeyRefresh = true;
      });
      return false;
    }

    // 立即更新状态
    runInAction(() => {
      this.needsPrivateKeyRefresh = false;
      this.privateKeyCheckTimestamp = Date.now();
    });

    // 等待事件处理完成
    await new Promise((resolve) => setTimeout(resolve, 50));

    // 再次确认状态
    runInAction(() => {
      this.needsPrivateKeyRefresh = false;
      this.privateKeyCheckTimestamp = Date.now();
    });

    return true;
  } catch (error) {
    runInAction(() => {
      this.needsPrivateKeyRefresh = true;
    });
    return false;
  } finally {
    runInAction(() => {
      this.isRefreshingPrivateKey = false;
    });
  }
}
```

---

## 触发时机

### usePrivateKeyRefresh 监听

| 触发事件 | 节流时间 | 处理逻辑 |
|----------|----------|----------|
| `realId` / `address` / `rememberMe` 变化 | - | 检测账号切换 + 执行校验 |
| `storage` 事件 | 3s | 清缓存 + 重新校验 |
| `privateKeyChanged` 事件 | 3s | 清缓存 + 重新校验 |
| `visibilitychange` (页面可见) | 1.5s | 清缓存 + 重新校验 |

### 代码实现

```typescript
// src/hooks/usePrivateKeyRefresh.ts Line 37-125

// 1. 状态变化触发
useEffect(() => {
  const addressChanged = lastKnownAddress !== null && 
    currentAddress !== null && 
    lastKnownAddress !== currentAddress;
  
  if (addressChanged) {
    runInAction(() => { user.needsPrivateKeyRefresh = true; });
    user.clearPrivateKeyCache();
    pendingForceCheck = true;
  }
  
  if (user.realId && user.address) {
    user.checkPrivateKeyValidity(validatePrivateKeyRef.current);
  }
}, [user.realId, user.address, rememberMe]);

// 2. Storage 变化监听
useEffect(() => {
  const handleStorageChange = (event?: StorageEvent | Event) => {
    // 过滤无关 key
    // 3s 节流
    if (now - lastStorageHandleTime < STORAGE_THROTTLE_MS) return;
    
    user.clearPrivateKeyCache();
    user.checkPrivateKeyValidity(validatePrivateKeyRef.current);
  };
  
  window.addEventListener('storage', handleStorageChange);
  window.addEventListener('privateKeyChanged', handleStorageChange);
}, []);

// 3. 页面可见性变化
useEffect(() => {
  const handleVisibilityChange = () => {
    if (document.visibilityState !== "visible") return;
    // 1.5s 节流
    if (now - lastVisibilityHandleTime < VISIBILITY_THROTTLE_MS) return;
    
    user.clearPrivateKeyCache();
    user.checkPrivateKeyValidity(validatePrivateKeyRef.current);
  };
  
  document.addEventListener("visibilitychange", handleVisibilityChange);
}, []);
```

---

## 私钥存储

### 存储位置

| 条件 | 存储位置 | 生命周期 |
|------|----------|----------|
| Remember Me = Yes | `localStorage` | 持久化 |
| Remember Me = No | `sessionStorage` | 关闭标签页清除 |

### 存储结构

```typescript
// Storage Key
const PRIVATE_KEY_STORAGE_KEY = "__private_key__";

// 结构
{
  [address.toLowerCase()]: privateKeyHex
}
```

---

## 关键设计决策

### 1. 3 秒缓存防抖

**问题**：多个组件同时调用 `checkPrivateKeyValidity` 会导致重复 API 请求

**方案**：使用 `privateKeyCheckTimestamp` 记录上次检查时间，3 秒内复用结果

### 2. 地址切换检测

**问题**：切换钱包账号时，旧账号的 `needsPrivateKeyRefresh` 状态被复用

**方案**：检测 `lastCheckedAddress !== currentAddress`，切换时立即清空缓存并设置 `needsPrivateKeyRefresh = true`

### 3. 防并发 Promise

**问题**：快速连续触发导致多个校验并行执行

**方案**：使用 `privateKeyCheckPromise` 存储当前校验 Promise，后续调用复用同一个

### 4. 双重验证存储

**问题**：某些浏览器环境下 `setPrivateKey` 可能静默失败

**方案**：保存后立即读取验证，失败时尝试 fallback 存储

---

## 文件结构

```
src/
├── hooks/
│   ├── usePrivateKeyRefresh.ts    # 协调 Hook（触发校验/刷新）
│   └── useSignApi/
│       ├── useSignApi.ts          # 核心逻辑（validate/add）
│       ├── useSparkSigner.ts      # EIP-712 签名
│       ├── helper.ts              # 私钥生成/转换工具
│       └── type.ts                # 类型定义
├── models/
│   └── user.ts                    # MobX Store（状态管理）
└── utils/
    └── storage/
        ├── local.ts               # localStorage 封装
        ├── session.ts             # sessionStorage 封装
        └── privateKey.ts          # 私钥存储 Key 常量
```

---

## 术语表

| 术语 | 说明 |
|------|------|
| `needsPrivateKeyRefresh` | MobX observable，判断是否需要 Enable Trading |
| `validatePrivateKey` | 校验本地私钥与服务端公钥是否匹配 |
| `addAPIKey` | 生成私钥 + EIP-712 签名 + 注册到服务端 |
| `refreshPrivateKey` | 刷新私钥的入口方法 |
| `webkey` | 浏览器环境的私钥名称 |
| `mobilekey` | 手机扫码登录的私钥名称 |
| `spotUniversalApi` | Spot 交易 API Key 注册接口 |
| `futuresUniversalApi` | Futures 交易 API Key 注册接口 |

---

## 更新记录

### 2026-03-05: 初始版本

通过 /k/context learn 从代码自动生成，覆盖私钥管理的完整机制
