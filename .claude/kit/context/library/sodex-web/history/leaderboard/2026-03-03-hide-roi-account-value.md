# 临时隐藏 ROI 和 Account Value 数据

**日期**: 2026-03-03 | **类型**: feat | **范围**: leaderboard

---

## 变更概述

临时隐藏排行榜中的 ROI 和 Account Value 相关数据，包括表格列、排序选项、分享指标和底部说明。所有改动使用注释方式，便于后续恢复。

---

## 核心变更

### 1. API 类型定义

**文件**: `src/http/leaderboard/api.d.ts`

注释 `ApiSortBy` 中的 `roi`/`account_value`，以及 `LeaderboardApiItem` 中的对应字段：

```typescript
// 临时隐藏 roi, account_value
export type ApiSortBy = /* "roi" | */ "pnl" | "volume" /* | "account_value" */ | "net_deposit";

export interface LeaderboardApiItem {
  // 临时隐藏 account_value
  // account_value_end_usd: string;
  // 临时隐藏 roi
  // roi: string;
}
```

### 2. 前端类型定义

**文件**: `src/pages/leaderboard/types/index.ts`

注释 `SortType`、`LeaderboardItem`、`MetricKey` 中的相关字段：

```typescript
// 临时隐藏 accountValue, roi
export type SortType = /* "accountValue" | */ "pnl" | /* "roi" | */ "volume";

export interface LeaderboardItem {
  // 临时隐藏 accountValue
  // accountValue: number;
  // 临时隐藏 roi
  // roi: number;
}

// 临时隐藏 roi, accountValue
export type MetricKey = "pnl" | /* "roi" | "accountValue" | */ "volume";
```

### 3. 常量与数据转换

**文件**: `src/pages/leaderboard/const/index.tsx`

注释常量映射和 `transformApiItem` 数据转换：

```typescript
// 临时隐藏 accountValue, roi
const map: Record<SortType, ApiSortBy> = {
  // accountValue: "account_value",
  pnl: "pnl",
  // roi: "roi",
  volume: "volume",
};

export const transformApiItem = (item: LeaderboardApiItem): LeaderboardItem => ({
  // 临时隐藏 accountValue
  // accountValue: parseFloat(item.account_value_end_usd) || 0,
  // 临时隐藏 roi
  // roi: (parseFloat(item.roi) || 0) * 100,
});
```

### 4. 搜索栏排序选项

**文件**: `src/pages/leaderboard/components/SearchBar.tsx`

注释排序选项中的 ROI 和 Account Value：

```typescript
// 临时隐藏 roi, accountValue
const sortOptions = useMemo(
  () => [
    { value: "pnl", label: t("sort_by_pnl") },
    // { value: "roi", label: t("sort_by_roi") },
    { value: "volume", label: t("sort_by_volume") },
    // { value: "accountValue", label: t("sort_by_account_value") },
  ],
  [t]
);
```

### 5. PC 端表格

**文件**: `src/pages/leaderboard/components/chart/LeaderboardTablePC.tsx`

- 注释 ROI/Account Value 列
- 调整 `colgroup` 宽度分配（从 6 列改为 4 列）
- 注释表头和数据行中的对应列

### 6. 移动端卡片

**文件**: `src/pages/leaderboard/components/chart/LeaderboardTableMobile.tsx`

- 注释卡片中的 Account Value 和 ROI 数据项
- 调整网格布局从 `grid-cols-3` 改为 `grid-cols-1`（只剩 Volume）

### 7. 分享弹窗指标选择

**文件**: `src/pages/leaderboard/components/modal/ShareLeaderboardContent.tsx`

注释 `METRIC_KEYS` 和 `METRIC_LABEL_MAP` 中的相关项：

```typescript
// 临时隐藏 roi, accountValue
const METRIC_KEYS: MetricKey[] = ["pnl", /* "roi", "accountValue", */ "volume"];

const METRIC_LABEL_MAP: Record<MetricKey, string> = useMemo(
  () => ({
    pnl: t("table_pnl"),
    // roi: "ROI",
    // accountValue: t("table_account_value"),
    volume: t("table_volume"),
  }),
  [t]
);
```

### 8. 海报渲染

**文件**: `src/pages/leaderboard/components/modal/PosterDom.tsx`

注释 `metricsData` 中的 ROI 和 Account Value 逻辑。

### 9. 分享文案

**文件**: `src/pages/leaderboard/hooks/useShareText.ts`

注释 `metricsLines` 中的 ROI 和 Account Value。

### 10. 分享 Context

**文件**: `src/pages/leaderboard/hooks/useShareLeaderboard.tsx`

注释 `visibleMetrics` 默认值中的相关项。

### 11. 数据请求

**文件**: `src/pages/leaderboard/hooks/useLeaderboardData.ts`, `useShareData.ts`

注释未上榜用户数据中的 `accountValue` 和 `roi` 字段。

### 12. 底部说明

**文件**: `src/pages/leaderboard/index.tsx`

注释 `disclaimer_3`（Account Value 说明）和 `disclaimer_4`（ROI 说明）：

```tsx
{/* 临时隐藏 Account Value, ROI 说明 */}
{/* <p>{t("disclaimer_3")}</p> */}
{/* <p>{t("disclaimer_4")}</p> */}
```

### 13. 行点击跳转 clobscan

**文件**: `src/pages/leaderboard/components/chart/LeaderboardTablePC.tsx`, `LeaderboardTableMobile.tsx`

注释行/卡片点击事件，移除 `cursor-pointer` 样式：

```tsx
// 临时隐藏点击跳转 clobscan
// const handleClick = () => {
//   onRowClick(item.walletAddress);
// };

<tr
  className={`... hover:bg-[#262626]/50 transition-colors ${bgClass}`}  // 移除 cursor-pointer
  // onClick={handleClick}  // 注释点击事件
>
```

---

## 设计决策

### 为什么使用注释而非删除

- 临时隐藏，后续可能恢复
- 注释保留完整代码逻辑
- 取消注释即可快速恢复功能

### 恢复方式

1. 全局搜索 `临时隐藏` 注释
2. 取消相关代码注释
3. TypeScript 检查确保类型一致性

---

## 文件变更列表

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `src/http/leaderboard/api.d.ts` | 修改 | 注释 API 类型定义 |
| `src/pages/leaderboard/types/index.ts` | 修改 | 注释前端类型 |
| `src/pages/leaderboard/const/index.tsx` | 修改 | 注释常量和数据转换 |
| `src/pages/leaderboard/components/SearchBar.tsx` | 修改 | 注释排序选项 |
| `src/pages/leaderboard/components/chart/LeaderboardTablePC.tsx` | 修改 | 注释表格列 |
| `src/pages/leaderboard/components/chart/LeaderboardTableMobile.tsx` | 修改 | 注释卡片数据项 |
| `src/pages/leaderboard/components/modal/ShareLeaderboardContent.tsx` | 修改 | 注释指标选项 |
| `src/pages/leaderboard/components/modal/PosterDom.tsx` | 修改 | 注释海报指标 |
| `src/pages/leaderboard/hooks/useShareText.ts` | 修改 | 注释分享文案 |
| `src/pages/leaderboard/hooks/useShareLeaderboard.tsx` | 修改 | 注释默认状态 |
| `src/pages/leaderboard/hooks/useLeaderboardData.ts` | 修改 | 注释数据字段 |
| `src/pages/leaderboard/hooks/useShareData.ts` | 修改 | 注释数据字段 |
| `src/pages/leaderboard/index.tsx` | 修改 | 注释底部说明 |

---

## 关联规范

- **Spec**: `.cursor/kit/spec/hiden-data-leaderboard.md`
