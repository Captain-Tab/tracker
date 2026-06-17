# Enable Trading 完整流程指南

## 概述

Enable Trading 是用户授权交易的核心流程，通过钱包签名生成私钥并注册 API Key。

### 架构图

```
用户点击 Enable Trading / Enable Deposit / Enable Claim 等按钮
    ↓
useEnableTrading Hook 或直接调用签名方法
    ↓
[平台检查] ui.isMobileScreen
    ├─ PC: signMessage()
    └─ Mobile: signMessageMobile()
        ↓
╔═══════════════════════════════════════════════════════════╗
║  Step 1: 钱包签名                                          ║
║  PC: 弹出钱包扩展签名                                       ║
║  Mobile: 跳转钱包 App 签名                                  ║
╚═══════════════════════════════════════════════════════════╝
        ↓
[签名结果检查] signResult
    ├─ success → 继续
    ├─ cancel → 返回（不提示错误）+ onSignFailed("cancel")
    └─ failed → notify.error + onSignFailed("failed")
        ↓
╔═══════════════════════════════════════════════════════════╗
║  Step 2: Stay signed in 弹窗                               ║
║  PC: createStaySignedInModal.open()                       ║
║  Mobile: staySignedInDrawer.open()                        ║
╚═══════════════════════════════════════════════════════════╝
        ↓
[用户选择 + 私钥存储迁移]
    ├─ Yes → localStorage + 私钥 session→local + 清理 session
    └─ No  → 移除 localStorage + 私钥 local→session + 清理 local
        ↓
触发 privateKeyChanged 事件 → resolve() → 关闭弹窗
        ↓
[后续处理]
    ├─ 检查充值需求（非 skipDepositCheck）
    ├─ 触发新手引导（非 skipGuide）
    └─ 调用回调 onFinish / onEnableTradingSuccess
        ↓
    ✅ 完成
```

---

## 核心组件

| 文件 | 作用 |
|------|------|
| `src/hooks/useEnableTrading.ts` | 新版 Enable Trading Hook |
| `src/contexts/login/index.tsx` | 签名方法 (signMessage / signMessageMobile) |
| `src/components_tw/modals/tradingProcess/StaySignedIn.tsx` | Stay signed in 弹窗组件 |
| `src/components_tw/modals/spot/index.tsx` | PC 端弹窗注册 (`createStaySignedInModal`) |
| `src/components_tw/drawers/index.tsx` | 移动端 Drawer 注册 (`staySignedInDrawer`) |

---

## useEnableTrading Hook

### 接口定义

```typescript
interface UseEnableTradingOptions {
  // 跳过余额检查
  skipBalanceCheck?: boolean;
  // 跳过新手引导
  skipGuide?: boolean;
  // 跳过充值检查（用于邀请码场景）
  skipDepositCheck?: boolean;
  // 签名成功回调（在 "Stay signed in" 弹窗弹出之前调用）
  onSignSuccess?: () => void | Promise<void>;
  // 签名失败/取消回调
  onSignFailed?: (reason: "cancel" | "failed" | "error") => void;
  // Enable 成功回调
  onEnableTradingSuccess?: () => void;
  // WalletConnect 签名中提示弹窗（仅签名阶段展示）
  showWalletConnectSigningModal?: boolean;
  // 完成回调
  onFinish?: () => void;
}
```

### 返回值

```typescript
{
  enableTrading: () => Promise<void>;  // 执行 Enable Trading
  loading: boolean;                     // 加载状态
  setIsMobileClicked: (v: boolean) => void;  // 移动端点击状态
}
```

### 使用示例

```typescript
const { enableTrading, loading } = useEnableTrading({
  skipDepositCheck: true,
  // WalletConnect 用户签名时弹出提示弹窗（适用于按钮空间不足的场景）
  showWalletConnectSigningModal: true,
  onSignSuccess: async () => {
    // 签名成功后、弹窗前的处理
  },
  onSignFailed: (reason) => {
    if (reason === "cancel") {
      // 用户取消
    } else {
      // 签名失败或错误
    }
  },
  onFinish: () => {
    // 整个流程完成
  },
});
```

---

## signMessage / signMessageMobile

### 返回值类型

```typescript
type SignResult = "success" | "cancel" | "failed" | undefined;
```

### 实现逻辑

```typescript
// PC 端签名
const signMessage = async () => {
  if (!address || isSigning) return "failed";
  try {
    setIsSigning(true);
    const success = await refreshPrivateKey();
    if (!success) {
      console.error("refreshPrivateKey returned false");
      return "failed";
    }
    return "success";
  } catch (error) {
    const isRejected = userCancelCheck(error);
    return isRejected ? "cancel" : "failed";
  } finally {
    setIsSigning(false);
  }
};

// 移动端签名（与 PC 端保持一致的返回值检查）
const signMessageMobile = async () => {
  if (!address || isSigning) return "failed";
  try {
    const success = await refreshPrivateKey();
    if (!success) {
      return "failed";
    }
    return "success";
  } catch (error) {
    const isRejected = userCancelCheck(error);
    return isRejected ? "cancel" : "failed";
  } finally {
    setIsSigning(false);
  }
};
```

---

## StaySignedIn 私钥存储迁移

### syncPrivateKeyStorage 函数

```typescript
const syncPrivateKeyStorage = (shouldRemember: boolean) => {
  const source = shouldRemember ? session : local;
  const target = shouldRemember ? local : session;
  const sourceKeys = source.getPrivateKey() || {};
  
  if (Object.keys(sourceKeys).length > 0) {
    target.setPrivateKey(sourceKeys);
  }
  
  // 切换记住状态后，清理另一侧存储
  if (shouldRemember) {
    session.removePrivateKey();
  } else {
    local.removePrivateKey();
  }
  
  window.dispatchEvent(new CustomEvent("privateKeyChanged"));
};
```

### 存储逻辑

| 用户选择 | localStorage | 私钥位置 | 清理 |
|----------|--------------|----------|------|
| Yes (记住) | `storageKey = "true"` | local | session |
| No (不记住) | 移除 storageKey | session | local |
| 关闭弹窗 | 等价于 No | session | local |

---

## 邮箱登录自动 Enable

### 触发条件

```typescript
emailLogin === true
&& privyReady
&& address
&& typeof user.id === "string"
&& user.needsPrivateKeyRefresh
&& !isSigning
&& !autoEmailEnableRunningRef.current
```

### 流程特点

- 600ms 延迟启动（等待 setActiveWallet / store reaction）
- 最多重试 5 次
- 私钥被删除后允许重新触发（校验不匹配自动清除场景）
- 自动执行不触发新手引导

---

## 移动端 Loading 状态优化

```typescript
// 移动端：监听页面可见性变化，在跳转钱包 app 后显示 loading
useEffect(() => {
  if (!ui.isMobileScreen) return;
  
  const handleVisibilityChange = () => {
    if (document.visibilityState === "hidden" && isMobileClicked) {
      setLoading(true);
    }
  };
  
  document.addEventListener("visibilitychange", handleVisibilityChange);
  return () => {
    document.removeEventListener("visibilitychange", handleVisibilityChange);
  };
}, [ui.isMobileScreen, isMobileClicked]);
```

**设计目的**：避免点击后立即显示 loading，只在确认跳转钱包 app 后才显示。

---

## PC 端额外校验

```typescript
// PC 端额外检查：等待异步操作完成并验证私钥状态
if (!ui.isMobileScreen) {
  await new Promise((resolve) => setTimeout(resolve, 100));
  
  if (user.needsPrivateKeyRefresh) {
    console.error("Private key refresh state not updated correctly");
    notify.error(t("common:private_key_refresh_failed"));
    user.clearPrivateKeyCache();
    return;
  }
}
```

**设计目的**：确保签名后私钥状态正确更新，避免异步竞态问题。

---

## 影响范围

### 使用 useEnableTrading 的文件 (14个)

| 文件 | 场景 |
|------|------|
| `VaultClaimButton.tsx` | Vault Claim |
| `VaultUnstakeButton.tsx` | Vault Unstake |
| `VaultPreTradeButton.tsx` | Vault Pre-Trade |
| `MainnetPreTradeButton.tsx` | 主网 Pre-Trade |
| `TestnetPreTradeButton.tsx` | 测试网 Pre-Trade |
| `ClaimRewardsModal.tsx` | 领取奖励 |
| `PCTransferModal.tsx` | PC 划转 |
| `MobileTransferDrawer.tsx` | 移动端划转 |
| `SecondStep.tsx` | 新手引导第二步 |
| `StakeSoso.tsx` | Stake SOSO |
| `AuthStepsModal.tsx` | 鉴权步骤弹窗 |
| `usePageAuth.ts` | 页面级鉴权 |
| `asset/index.tsx` | 资产页 |
| `useEnableTrading.ts` | Hook 本身 |

### 保留的旧组件

- `EnableGasfreeTrading.tsx` - 组件本身保留
- `createEnableGasfreeTradingModal` - 导出保留
- `EnableGasfreeTradingDrawer` - 导出保留

---

## 注意事项

1. **移动端必须使用 `.open()` 方法**：`staySignedInDrawer.open()` 而非 `NiceModal.show()`，否则 resolve 函数不会正确注入
2. **signMessage/signMessageMobile 必须检查返回值**：与 PC 端保持一致，否则取消签名后仍会弹出 StaySignedIn
3. **privateKeyChanged 事件**：StaySignedIn 弹窗关闭时会触发，其他组件可监听此事件响应私钥变化
4. **邮箱登录自动 enable**：无需用户点击，自动完成签名流程
5. **API key name fallback 兼容**：移动端从 `webkey` 迁移到 `mobilekey`，`getPrivateKeyWithFallback`（`apiKeyName.ts`）在查不到 `mobilekey` 时自动 fallback 到 `webkey`，避免历史用户被迫重签。QR code 用户同理：`qrkey` → `mobilekey`。所有读取服务端私钥的路径（`useSignApi.validatePrivateKey`、`useAuthTokenValidation.checkPrivateKeyValid`）统一走此兼容函数

---

## 更新记录

- 2026-01-20 初始版本：完成 Enable Trading 流程优化
- 2026-01-27 修复：signMessageMobile 添加 refreshPrivateKey 返回值检查
- 2026-03-05 更新：补充 syncPrivateKeyStorage、onSignFailed、邮箱自动 enable 等未文档化逻辑
- 2026-03-30 更新：补充 showWalletConnectSigningModal 参数（SOD-21 移动端签名交互统一优化）
- 2026-04-10 更新：补充 API key name fallback 兼容说明（SOD-97 移动端 mobilekey 迁移）
