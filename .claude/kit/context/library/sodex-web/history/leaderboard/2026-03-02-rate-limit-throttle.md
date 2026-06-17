# Leaderboard 限流与错误处理

**日期**: 2026-03-02 | **类型**: feat | **范围**: leaderboard

---

## 变更概述

为排行榜页面添加 HTTP 429 错误处理和分页节流功能，提升用户体验并防止因频繁请求导致的限流错误。

---

## 核心变更

### 1. HTTP 429 错误处理

**文件**: `src/pages/leaderboard/hooks/useLeaderboardData.ts`

使用 `skipErrorHandler: true` 配置让 API 请求返回原始错误信息，手动处理 429 限流错误：

```tsx
// 判断是否为 HTTP 错误响应
const isHttpError = (res: unknown): res is HttpErrorResponse => {
  return res !== null && typeof res === "object" && (res as HttpErrorResponse).data === false;
};

// 判断是否为 429 限流错误
const is429Error = (res: unknown): boolean => {
  return isHttpError(res) && (res as HttpErrorResponse).status === 429;
};

// 错误处理
if (is429Error(res)) {
  notify.error(t("error_rate_limit"));  // "请求过于频繁，请稍后再试"
  return;
}
if (isHttpError(res)) {
  notify.error(t("error_fetch_failed")); // "加载数据失败"
  return;
}
```

### 2. API 配置变更

**文件**: `src/http/leaderboard/index.tsx`

添加 `skipErrorHandler: true` 配置：

```tsx
export const getLeaderboardListService = (params) => {
  return request<LeaderboardListData>(LEADERBOARD_API_BASE, {
    method: "GET",
    params,
    skipErrorHandler: true,  // 新增：手动处理错误
  });
};
```

### 3. 分页节流

**文件**: `src/pages/leaderboard/components/Pagination.tsx`

使用 `lodash/throttle` 实现 500ms 节流，防止快速连续点击：

```tsx
const THROTTLE_MS = 500;

const throttledPageChange = useMemo(
  () =>
    throttle(
      (newPage: number) => {
        onPageChangeRef.current(newPage);
        setIsThrottled(true);
        throttleTimerRef.current = setTimeout(() => {
          setIsThrottled(false);
        }, THROTTLE_MS);
      },
      THROTTLE_MS,
      { leading: true, trailing: false }
    ),
  []
);

// 按钮禁用状态
<button disabled={currentPage === 1 || isThrottled} />
```

### 4. 国际化

**文件**: `public/locales/*/leaderboard.json` (11 个语言文件)

新增 i18n keys：

| Key | 中文 | 英文 |
|-----|------|------|
| `error_rate_limit` | 请求过于频繁，请稍后再试 | Too many requests, please try again later |
| `error_fetch_failed` | 加载数据失败 | Failed to load data |

---

## 设计决策

### 为什么使用 skipErrorHandler

- 全局错误处理器不包含 HTTP status code 信息
- 需要区分 429 限流错误和其他业务错误
- 保持其他页面的错误处理逻辑不变

### 为什么选择 500ms 节流

- 平衡用户体验和请求频率
- 与搜索防抖时间一致
- 足够防止快速连续点击

### 为什么使用 leading: true, trailing: false

- 首次点击立即响应
- 节流期间不执行累积请求
- 用户能看到即时反馈

---

## 文件变更列表

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `src/http/leaderboard/index.tsx` | 修改 | 添加 skipErrorHandler 配置 |
| `src/pages/leaderboard/hooks/useLeaderboardData.ts` | 修改 | 添加 429 错误检测和 toast 提示 |
| `src/pages/leaderboard/components/Pagination.tsx` | 修改 | 添加 500ms 分页节流 |
| `public/locales/*/leaderboard.json` | 修改 | 新增 error_rate_limit, error_fetch_failed |
| `src/@declares/i18next-resources.d.ts` | 修改 | 类型声明更新 |

---

## 关联规范

- **Spec**: `.cursor/kit/spec/add-data-overload-check.md`
- **参考**: `SearchBar.tsx` 的 lodash/debounce 用法
