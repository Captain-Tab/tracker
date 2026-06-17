# 维护模式 Banner 优先级控制

**日期**: 2026-04-17 | **类型**: feat | **范围**: global

---

## 变更概述

链维护（mode 2）时在 Trade 页面隐藏 GlobalBanner；维护状态下 DepositBanner 跳过 RegionRestrictBanner，优先展示 type 2 维护通知 GlobalBanner。

---

## 核心变更

### 1. 链维护 + Trade 页面隐藏 GlobalBanner

**文件**: `src/components/header/components/globalBanner/index.tsx`

Trade 页面链维护时已替换为 MaintenanceContent，GlobalBanner 叠加会造成布局混乱。

```typescript
const isActuallyVisible = isBannerVisible && !(isChainMaintenance && isTradePage);
ui.setIsGlobalBannerVisible(isActuallyVisible);  // 同步移动端 spacer 高度
```

### 2. 维护状态优先于地区限制 Banner

**文件**: `src/components/header/components/depositBanner/index.tsx`

维护期间地区受限用户也应看到维护通知，而非地区限制 Banner。

```typescript
const isInMaintenance = isFullMaintenance || isChainMaintenance;

// loading 阶段 + 正常渲染阶段（两处均修改）
if (restriction.isRestrictedRegion && !isInMaintenance) {
  return <RegionRestrictBanner />;
}
```

**优先级矩阵**：

| isInMaintenance | isRestrictedRegion | 渲染结果 |
|----------------|-------------------|---------|
| false | false | GlobalBanner |
| false | true | RegionRestrictBanner |
| true | false | GlobalBanner |
| true | true | GlobalBanner（维护优先） |

---

## 文件变更列表

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `src/components/header/components/globalBanner/index.tsx` | 修改 | 链维护+Trade页面时设 isActuallyVisible=false |
| `src/components/header/components/depositBanner/index.tsx` | 修改 | 两处添加 !isInMaintenance 守卫 |

---

## 关联文档

- **Reference**: `.claude/kit/context/library/sodex-web/reference/global/global-banner-guide.md`
- **Maintenance spec**: `.claude/kit/spec/2026-04-13-maintenance-mode-upgrade.md`
