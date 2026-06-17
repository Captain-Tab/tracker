# heatmap 关闭 + localStorage 安全包装 + 刷新残留清理

**日期**: 2026-05-13 | **类型**: fix | **范围**: global

---

## 变更概述

本次合并 3 项变更：(1) 业务需求变更，关闭 heatmap（不再上报 `$WebClick` / `$WebStay`）；(2) 修复 reviewer Issue 2：刷新后 localStorage 残留挂匿名事件；(3) 修复 reviewer Issue 3：`localStorage.*` 抛错未捕获导致埋点初始化崩 App。

---

## 核心变更

### 1. 关闭 heatmap

**文件**: `index.html`

`clickmap` / `scroll_notice_map` 从 `'default'` 改为 `'not_collect'`，删除 `collect_element` 过滤函数（heatmap 关后无消费方）。仅保留 `$pageview` autoTrack 事件 + `not_collect_url_params` URL token 脱敏。

```js
heatmap: {
  clickmap: 'not_collect',
  scroll_notice_map: 'not_collect',
},
not_collect_url_params: ['token','api_key','apikey','signature','sig','access_token','jwt'],
```

`$pageview` 不受影响（由 `is_track_single_page: true` 独立驱动）。`sensors.identify` / saTrack 业务事件 / GA log_in 均不受影响。

### 2. Issue 2 修复：刷新后残留清理

**文件**: `src/shared/track/services/identityService.ts`、`src/features/auth/containers/useTrackConnectWallet.ts`

原 `useTrackConnectWallet` address null 分支依赖 in-memory `lastIdentifiedRef.current` 判断是否需要清 storage —— 页面刷新后 ref 丢失，导致 `__wallet_address__` / `__wallet_type__` / `user_id` 残留挂到后续匿名 autoTrack / saTrack 事件。

```ts
// identityService.ts 新增
clearWalletLoginIdentityIfDirty(): void {
  if (!hasWalletIdentityStorage()) return;  // 零开销快速返回
  clearUserId();
  clearWalletIdentityStorage();
  sensorsLogout();
},

// useTrackConnectWallet.ts: address null 分支
if (!address) {
  identityService.clearWalletLoginIdentityIfDirty();  // 不再依赖 useRef
  lastIdentifiedRef.current = null;
  return;
}
```

### 3. Issue 3 修复：localStorage 安全包装

**文件**: `src/shared/track/domain/publicParams.ts`

新增 `safeGetItem` / `safeSetItem` / `safeRemoveItem` 三个包装函数 + 模块级 `inMemoryStore: Record<string, string>` fallback。所有原 `localStorage.*` 调用替换为 safe wrapper。Safari 隐私模式 / 配额耗尽（`QuotaExceededError`）/ iframe sandbox（`SecurityError`）等场景下，埋点降级到内存态，不再让 `useTrackInit` cold-start 崩 App。

```ts
const inMemoryStore: Record<string, string> = {};

function safeSetItem(key: string, value: string): void {
  if (typeof window === "undefined") return;
  inMemoryStore[key] = value;  // 先写内存（read-after-write 一致）
  try {
    localStorage.setItem(key, value);
  } catch {
    // 配额满 / 隐私模式：仅保留内存值
  }
}
```

新增 export `hasWalletIdentityStorage()`：读 `__wallet_address__` / `__wallet_type__` / `user_id` 任一非空即返回 true，供 `clearWalletLoginIdentityIfDirty` 使用。

---

## 文件变更列表

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `index.html` | 修改 | heatmap → not_collect；删除 collect_element 过滤函数 |
| `src/shared/track/domain/publicParams.ts` | 修改 | +35 行：safe wrappers + inMemoryStore + hasWalletIdentityStorage；替换所有 localStorage.* 调用 |
| `src/shared/track/services/identityService.ts` | 修改 | +12 行：clearWalletLoginIdentityIfDirty 函数 |
| `src/features/auth/containers/useTrackConnectWallet.ts` | 修改 | address null 分支去掉 useRef 依赖，改调 IfDirty |

---

## 风险与限制

- ⚠️ heatmap 关闭后，数仓 / BI 侧若有依赖 `$WebClick` / `$WebStay` 的看板会断数据，需通知数据团队（非代码风险）。
- ⚠️ Issue 3 包装范围仅限 `publicParams.ts`；`gtagSink` / `encrypt.ts` 等其他文件如有 localStorage 裸调用尚未覆盖，建议后续单独 audit。
- ⚠️ Issue 2 仍存在已有 race：`trackConnectWallet` async pending 时 address 突变 null，clear 先跑、setUserId 后跑 → storage 再被污染。非本次引入，留作后续 AbortController 改造。

---

## 关联文档

- **Reference**: `.claude/kit/context/library/sodex-next/reference/global/global-track-guide.md`（D-3 反转 + 新增 D-12 / D-13）
- **Pitfall**: `track-payload-field-verification-required`（gate=true）
