---
description: 签名交互自动检测。当文件涉及钱包签名（useWalletApproveText、useEnableTrading、signMessage、showWalletConnectSigningModal）时自动触发。
---

# 签名交互检测规则

## 触发条件

当正在编辑/创建的文件包含以下**任一** import 或调用时，必须遵守本规范：

```
useWalletApproveText
useEnableTrading
signMessage / signMessageMobile / signMessageByWalletType
showWalletConnectSigningModal
walletConnectSigningHintModal
onSignFailed
```

---

## 场景目录（根据匹配场景跳转）

| 场景 | 匹配条件 | 跳转 |
|------|----------|------|
| **一步签名按钮** | `useWalletApproveText` + `loading` 状态 | → [A] |
| **两步签名弹窗** | `useWalletApproveText` + Step/Modal 组件 | → [B] |
| **小按钮签名** | `showWalletConnectSigningModal` | → [C] |
| **auth token 签名** | `signMessageByWalletType`（不经过 useEnableTrading） | → [D] |
| **签名失败处理** | `onSignFailed` 回调 | → [E] |
| **新建签名功能** | 新文件 + 需要 signMessage | → [F] 完整流程 |

---

## [A] 一步签名：按钮 loading 文案

**规则**：按钮 loading 时必须显示 `useWalletApproveText` 文案

```tsx
const walletApproveText = useWalletApproveText();

<Button loading={loading}>
  {loading ? walletApproveText.wallet : "Enable Trading"}
</Button>
```

**禁止**：`isLoading ? "Signing..." : "Enable Trading"`（硬编码）

---

## [B] 两步签名：副标题显示

**规则**：签名提醒放**副标题**，主标题保持步骤语义

```tsx
<span>{t("step:check_referral_code")}</span>
{isSigning && <span className="text-[12px] text-[#A3A3A3]">{walletApproveText.signature}</span>}
```

**禁止**：主标题写 "Please approve..."（丢失步骤语义）

---

## [C] 小按钮签名：弹窗提示

**规则**：空间不足时启用签名弹窗

```tsx
const { enableTrading } = useEnableTrading({
  showWalletConnectSigningModal: true,  // 仅 WalletConnect 用户弹窗
});
```

**适用**：Swap、Transfer、表格内按钮、紧凑按钮组

---

## [D] auth token 签名

**规则**：独立鉴权流程（Points/Referrals）同样需要显示文案

```tsx
// signMessageByWalletType 不经过 useEnableTrading
// 需要手动在 UI 中显示 walletApproveText
const walletApproveText = useWalletApproveText();
{isSigning && walletApproveText.signature}
```

---

## [E] 签名失败处理

**规则**：区分三种失败状态

| reason | 含义 | 处理 |
|--------|------|------|
| `cancel` | 用户拒绝 | 静默关闭，**不显示** error toast |
| `failed` | 签名失败 | 显示 error toast |
| `error` | 异常 | 显示 error toast |

```tsx
useEnableTrading({
  onSignFailed: (reason) => {
    if (reason === "cancel") return;  // 不弹 toast
    // failed/error 已由内部处理
  },
});
```

---

## [F] 完整流程（新建签名功能）

当需要新建签名功能时，读取完整参考文档：

```
.claude/kit/context/library/sodex-web/reference/shared/wallet-mobileApprove-guide.md
```

**章节索引**（按需读取）：

| 章节 | 行号 | 内容 |
|------|------|------|
| 架构概览 | L3-37 | connectorType → 文案映射图 |
| 核心逻辑 | L38-130 | useWalletApproveText + useEnableTrading 详解 |
| 关键实现 | L131-189 | 三种场景代码示例 |
| 设计决策 | L229-255 | 为什么这样设计 |

---

## useWalletApproveText 的 4 个 key

| key | 使用场景 |
|-----|----------|
| `wallet` | 一步签名按钮 loading |
| `signature` | 两步弹窗副标题（字号更小） |
| `spending` | 授权 spending cap（ERC-20 approve） |
| `confirm` | 二次确认操作 |

文案根据 `connectorType` 自动切换：
- `injected`（插件钱包）→ "Please approve in wallet"
- `walletConnect`（扫码钱包）→ "Please approve on mobile" + 手机图标

---

## 代码审查检查清单

- [ ] 文案是否来自 `useWalletApproveText`（非硬编码）
- [ ] 使用了正确的 key（wallet/signature/spending/confirm）
- [ ] 两步流程签名提醒是否在副标题
- [ ] 小按钮是否启用 `showWalletConnectSigningModal`
- [ ] `onSignFailed` 是否区分 cancel（静默）与 failed/error
- [ ] 新增文案是否完成 i18n 同步
