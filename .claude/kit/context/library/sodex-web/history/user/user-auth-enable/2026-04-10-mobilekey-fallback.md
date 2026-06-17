# API key name 移动端 fallback 兼容

**日期**: 2026-04-10 | **类型**: fix | **范围**: user

---

## 变更概述

为移动端浏览器用户增加 API key name fallback 兼容，避免从 `webkey` 迁移到 `mobilekey` 后历史用户被迫重签。

---

## 核心变更

### 1. getPrivateKeyWithFallback 增加移动端 fallback

**文件**: `src/hooks/useSignApi/apiKeyName.ts`

原逻辑仅对 QR code 用户做 fallback（qrkey → mobilekey），移动端浏览器用户（mobilekey）查不到时无兼容路径。

新增 `else if (keyName === "mobilekey")` 分支，fallback 到 `webkey`：

```typescript
if (!response?.data || response.data.length === 0) {
  const walletType = local.getWalletType();
  if (walletType === "qr_code") {
    response = await fetcher({ accountId, name: "mobilekey" });
  } else if (keyName === "mobilekey") {
    response = await fetcher({ accountId, name: "webkey" });
  }
}
```

---

## 文件变更列表

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `src/hooks/useSignApi/apiKeyName.ts` | 修改 | getPrivateKeyWithFallback 增加移动端 webkey fallback |

---

## 关联文档

- **Reference**: `.claude/kit/context/library/sodex-web/reference/user/user-auth-enable-guide.md`
