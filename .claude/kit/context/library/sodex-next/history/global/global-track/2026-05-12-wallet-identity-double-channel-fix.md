# 钱包身份双向链路完整性修复

**日期**: 2026-05-12 | **类型**: fix | **范围**: global

---

## 变更概述

修复 Batch A 实测发现的钱包身份链路两处断点：(1) `sosovalue.walletAddress` 明文字段长期为空 / 残留旧值；(2) 神策 SDK autoTrack 与 saTrack 直连业务事件的 `distinct_id` 不一致（同用户在神策后台分裂为两个 ID）。补完 sodex-web 历史 LoginProvider 时代由业务侧写入但 sodex-next auth 重构后断掉的 3 个 localStorage key。

---

## 核心变更

### 1. localStorage 钱包身份 key 写入由埋点 service 接管

**文件**: `src/shared/track/services/identityService.ts`

sodex-web 历史是业务侧 LoginProvider 写 `__wallet_address__` / `__wallet_type__` / `user_id`，埋点 propertyPlugin / datasinkSink 搭便车读。sodex-next auth feature 改为 zustand session 后这条链路断开。

修复：`identityService.trackConnectWallet(address, walletType?)` 内部显式三写：

```ts
async trackConnectWallet(address: string, walletType?: string): Promise<void> {
  if (!address) return;
  setWalletAddress(address);     // → __wallet_address__
  if (walletType) setWalletType(walletType);  // → __wallet_type__
  const encrypted = await encryptAES128(address, getAesSecret());
  if (!encrypted) return;
  setUserId(encrypted);          // → user_id（与下面 identify 同值，统一 distinct_id）
  await sensorsIdentify(encrypted);
}
```

### 2. 登出三套同步清理 + sensors.logout

**文件**: `src/shared/track/services/identityService.ts` + `src/shared/track/infra/sensorsSink.ts`

```ts
// sensorsSink.ts 新增
export function logout(): void {
  window.sensors?.logout?.();  // 神策 SDK 内部 distinct_id 回归 anonymous
}

// identityService.ts 修改
clearWalletLoginIdentity(): void {
  clearUserId();                  // GA gtag 清 user_id
  clearWalletIdentityStorage();   // localStorage 清三 key
  sensorsLogout();                // 神策 SDK 同步重置
}
```

修复前 bug：clearWalletIdentityStorage 清了 localStorage user_id 让 saTrack distinct_id 回归 anonymous，但神策 SDK 内部仍是 encrypted → 登出后两路又分裂。

### 3. 新增 publicParams setter

**文件**: `src/shared/track/domain/publicParams.ts`

```ts
export function setWalletAddress(address): void  // createStorage 包装格式
export function setWalletType(walletType): void  // createStorage 包装格式
export function setUserId(userId): void          // 裸字符串（与 sodex-web 历史读取格式一致）
export function clearWalletIdentityStorage(): void  // 清 3 个 key
```

### 4. useTrackConnectWallet 监听切换 + 登出

**文件**: `src/features/auth/containers/useTrackConnectWallet.ts`

```ts
useEffect(() => {
  if (isAuthInitializing) return;
  if (isWatching) return;
  if (!address) {
    // 登出 / 钱包断开：清掉 localStorage 残留
    if (lastIdentifiedRef.current) {
      identityService.clearWalletLoginIdentity();
      lastIdentifiedRef.current = null;
    }
    return;
  }
  // ... 连接 / 切换钱包逻辑
  void identityService.trackConnectWallet(address, connector?.id);  // walletType from wagmi
}, [address, isWatching, isAuthInitializing, connector?.id]);
```

---

## 文件变更列表

| 文件 | 变更类型 | 说明 |
|---|---|---|
| `src/shared/track/domain/publicParams.ts` | 修改 | +14 行：4 个 setter / clearer 函数 |
| `src/shared/track/infra/sensorsSink.ts` | 修改 | +10 行：`logout()` 方法 |
| `src/shared/track/services/identityService.ts` | 修改 | +12 行：trackConnectWallet 三写、clearWalletLoginIdentity 三清；签名加 walletType 形参 |
| `src/features/auth/containers/useTrackConnectWallet.ts` | 修改 | +8 行：address null 分支清；connector?.id 注入 walletType |

---

## 实测验证

| 场景 | 修复前 | 修复后（待重新部署 preview 验证） |
|---|---|---|
| autoTrack distinct_id | encrypted ✓ | encrypted ✓（不变） |
| saTrack distinct_id（Batch B 接入后）| anonymousId（脏） | encrypted ✓ |
| sosovalue.walletAddress | 空 / 残留 | 当前钱包 ✓ |
| 切换钱包 walletAddress | 不更新（永远旧值） | 跟随更新 ✓ |
| 登出 localStorage | 残留 | 三套清空 ✓ |
| 登出后 autoTrack distinct_id | encrypted（脏） | anonymous（sensors.logout 重置） |

---

## 关联文档

- **Reference**: `.claude/kit/context/library/sodex-next/reference/global/global-track-guide.md`
- **Pitfall**: `.claude/kit/context/library/sodex-next/pitfalls/track-payload-field-verification-required.md`（gate=true，未来 plan 自动触发）
- **关键决策**: 新增 D-11「钱包身份双向链路完整性」到 reference guide §关键设计决策
