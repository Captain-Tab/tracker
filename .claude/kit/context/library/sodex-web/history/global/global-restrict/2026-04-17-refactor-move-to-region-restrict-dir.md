# 地区限制组件迁移 + RestrictWrapper 新增

**日期**: 2026-04-17 | **类型**: refactor | **范围**: global

---

## 变更概述

将 `RegionRestrictWrapper` 迁移到新目录 `src/global/region-restrict/`，并新增 `RestrictWrapper` 统一处理维护+地区限制重叠场景，7个原 RegionRestrictWrapper 位置改为 RestrictWrapper。

---

## 核心变更

### 1. 文件迁移

**旧路径**: `src/global/RegionRestrictWrapper.tsx`
**新路径**: `src/global/region-restrict/RegionRestrictWrapper.tsx`

逻辑不变，仅目录调整。

### 2. 新增 RestrictWrapper

**文件**: `src/global/region-restrict/RestrictWrapper.tsx`

合并维护检测（`useMaintenanceContext`）+ 地区限制（`useRegionRestrict`），优先级：维护 > 地区限制。

```tsx
import { RestrictWrapper } from "@/global/maintanence";

// 同时需要维护禁用 + 地区限制的位置
<RestrictWrapper>
  <Button>Deposit</Button>
</RestrictWrapper>
```

### 3. 使用位置调整（7处）

以下位置从 `RegionRestrictWrapper` 改为 `RestrictWrapper`：

| 文件 | 按钮 |
|------|------|
| `src/components/header/components/sign/index.tsx` | Header Deposit |
| `src/pages/vault/components/SLP.tsx` | Deposit to SLP Vault (×2), Get MAG7 ssi |
| `src/pages/referrals/components/NewReferralHeader.tsx` | Claim Rebate (×2), Deposit More |
| `src/pages/account/assets/components/btnNav/index.tsx` | Deposit |

---

## 文件变更列表

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `src/global/RegionRestrictWrapper.tsx` | 删除 | 迁移到新目录 |
| `src/global/region-restrict/RegionRestrictWrapper.tsx` | 新增 | 迁移后的文件 |
| `src/global/region-restrict/RestrictWrapper.tsx` | 新增 | 维护+地区限制统一包裹 |
| `src/components/header/components/sign/index.tsx` | 修改 | RegionRestrictWrapper → RestrictWrapper |
| `src/pages/vault/components/SLP.tsx` | 修改 | 4处改为 RestrictWrapper |
| `src/pages/referrals/components/NewReferralHeader.tsx` | 修改 | 3处改为 RestrictWrapper |
| `src/pages/account/assets/components/btnNav/index.tsx` | 修改 | Deposit 改为 RestrictWrapper |

---

## 关联文档

- **Reference**: `.claude/kit/context/library/sodex-web/reference/global/global-restrict-guide.md`
- **Maintenance spec**: `.claude/kit/spec/2026-04-13-maintenance-mode-upgrade.md`
