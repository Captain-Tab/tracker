# Leaderboard 排行榜完整功能

交易排行榜页面，支持多维度排序（PnL/ROI/Volume/AccountValue）、多时间范围筛选（24h/7d/30d/All）、地址搜索、后端分页，以及可定制化分享海报生成。

---

## 架构概览

```
┌─────────────────────────────────────────────────────────────┐
│                    Leaderboard 页面                          │
├─────────────────────────────────────────────────────────────┤
│  入口组件 (index.tsx)                                        │
│    ├── 状态管理: searchValue, sortBy, sortDirection,        │
│    │             timeRange, page, pageSize                  │
│    ├── useLeaderboardData() ─→ API 请求 + 数据转换          │
│    ├── SearchBar          ─→ 搜索 + 排序选择 + 时间筛选     │
│    └── LeaderboardChart   ─→ PC/Mobile 响应式表格 + 分页    │
├─────────────────────────────────────────────────────────────┤
│  分享弹窗 (ShareLeaderboardModal)                            │
│    ├── ShareLeaderboardProvider ─→ Context 状态管理         │
│    ├── useShareData()     ─→ 时间范围切换时的数据缓存       │
│    ├── useShareText()     ─→ 分享文案生成（Twitter/Other）  │
│    ├── PosterDom          ─→ html-to-image 海报渲染         │
│    └── ShareLeaderboardPC/Mobile ─→ 响应式布局              │
└─────────────────────────────────────────────────────────────┘
```

### 数据流

```
API Layer:
  getLeaderboardListService  ─→ 分页列表（后端分页）
  getLeaderboardRankService  ─→ 搜索用户 / 当前用户数据

Hooks Layer:
  useLeaderboardData ─→ 列表 + 当前用户（并行请求）
  useShareData       ─→ 分享弹窗内时间切换的数据缓存
  useShareText       ─→ 根据显示模式生成分享文案
  useShareLeaderboard ─→ 分享弹窗 Context（状态集中管理）

UI Layer:
  LeaderboardTablePC/Mobile ─→ 响应式表格/卡片列表
  Pagination                ─→ 后端分页控制（含 500ms 节流）
  ShareLeaderboardPC/Mobile ─→ 响应式分享弹窗
  PosterDom                 ─→ 海报 DOM（用于截图）
```

---

## 核心逻辑

### 入口组件状态管理

`src/pages/leaderboard/index.tsx` 作为入口，管理所有 UI 状态：

```tsx
// UI 状态
const [searchValue, setSearchValue] = useState("");
const [sortBy, setSortBy] = useState<SortType | null>("pnl");
const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
const [timeRange, setTimeRange] = useState<TimeRange>("24h");

// 分页状态
const [page, setPage] = useState(1);
const [pageSize, setPageSize] = useState<PageSize>(10);

// 数据请求
const { data, currentUser, total, isLoading } = useLeaderboardData({
  timeRange, sortBy, sortDirection, page, pageSize,
  searchQuery: searchValue,
  currentUserWallet: currentUserWallet || undefined,
});
```

### useLeaderboardData Hook

核心数据请求 Hook，负责：
1. **列表数据**：调用 `getLeaderboardListService` 获取分页列表
2. **当前用户**：调用 `getLeaderboardRankService` 获取登录用户数据
3. **搜索模式**：输入地址/邮箱时切换为搜索逻辑
4. **错误处理**：HTTP 429 限流错误和业务错误的统一处理

```tsx
// 主请求函数
const fetchData = useCallback(async () => {
  setIsLoading(true);
  const isSearching = searchQuery.trim().length > 0;

  if (isSearching) {
    // 搜索模式：只请求 rank 接口
    await searchUser();
  } else {
    // 正常加载：列表接口 + 当前用户接口（仅登录时）
    const requests: Promise<void>[] = [fetchList()];
    if (currentUserWallet) {
      requests.push(fetchCurrentUser());
    }
    await Promise.all(requests);
  }
  setIsLoading(false);
}, [searchQuery, fetchList, fetchCurrentUser, searchUser, currentUserWallet]);
```

### HTTP 错误处理

API 请求使用 `skipErrorHandler: true` 配置，手动处理错误响应：

```tsx
// skipErrorHandler 返回的响应类型
interface HttpErrorResponse {
  data: false;
  status?: number;
}

// 判断是否为 HTTP 错误响应
const isHttpError = (res: unknown): res is HttpErrorResponse => {
  return res !== null && typeof res === "object" && (res as HttpErrorResponse).data === false;
};

// 判断是否为 429 限流错误
const is429Error = (res: unknown): boolean => {
  return isHttpError(res) && (res as HttpErrorResponse).status === 429;
};

// 在 fetchList / searchUser / fetchCurrentUser 中处理
if (is429Error(res)) {
  notify.error(t("error_rate_limit"));  // "请求过于频繁，请稍后再试"
  return;
}
if (isHttpError(res)) {
  notify.error(t("error_fetch_failed")); // "加载数据失败"
  return;
}
```

### 搜索关键词类型判断

```tsx
const getSearchParams = (query: string) => {
  const trimmed = query.trim();
  if (!trimmed) return null;
  // 包含 @ 识别为邮箱，否则为钱包地址
  return trimmed.includes("@")
    ? { email: trimmed }
    : { wallet_address: trimmed };
};
```

### 搜索防抖 + 地址验证

`SearchBar.tsx` 中使用 500ms 防抖 + 地址格式验证：

```tsx
const debouncedValidate = useMemo(
  () => debounce((value: string) => {
    if (!value.trim()) {
      setShowWarning(false);
      onSearchChange(value);  // 清空搜索
      return;
    }
    if (!isValidAddress(value)) {
      setShowWarning(true);   // 显示警告，不触发搜索
      return;
    }
    setShowWarning(false);
    onSearchChange(value);    // 有效地址，触发搜索
  }, 500),
  [onSearchChange]
);
```

### 排序逻辑

```tsx
// 点击表头排序：同字段切换方向，新字段默认 desc
const handleSort = (field: SortType) => {
  if (sortBy === field) {
    setSortDirection(sortDirection === "desc" ? "asc" : "desc");
  } else {
    setSortBy(field);
    setSortDirection("desc");
  }
  setPage(1);  // 排序变化时重置到第一页
};
```

### 分页节流

防止用户快速连续点击分页按钮导致 429 限流错误：

```tsx
// Pagination.tsx
const THROTTLE_MS = 500;

const throttledPageChange = useMemo(
  () =>
    throttle(
      (newPage: number) => {
        onPageChangeRef.current(newPage);
        setIsThrottled(true);
        // 节流期间按钮显示 disabled 状态
        throttleTimerRef.current = setTimeout(() => {
          setIsThrottled(false);
        }, THROTTLE_MS);
      },
      THROTTLE_MS,
      { leading: true, trailing: false }
    ),
  []
);

// 按钮禁用逻辑
<button
  disabled={currentPage === 1 || isThrottled}
  className="... disabled:opacity-50 disabled:cursor-not-allowed"
>
```

| 配置 | 值 | 说明 |
|------|-----|------|
| 节流间隔 | 500ms | 防止快速连续点击 |
| leading | true | 首次点击立即执行 |
| trailing | false | 不执行尾调用 |
| 视觉反馈 | `opacity-50` + `cursor-not-allowed` | 禁用状态样式 |

---

## 当前用户栏特殊处理

当前登录用户在排行榜中有特殊展示逻辑：

### 数据获取与置顶

```tsx
// LeaderboardChart.tsx - 当前用户置顶显示
const displayItems: LeaderboardDisplayItem[] = useMemo(() => {
  if (isSearching) return data;
  // 未登录时不显示 currentUser
  if (connected && currentUser) {
    return [currentUser, ...data];  // 置顶
  }
  return data;
}, [data, currentUser, isSearching, connected]);
```

### 特殊标记与样式

| 处理点 | 实现 |
|--------|------|
| `isCurrentUser` 标记 | `setCurrentUser({ ...item, isCurrentUser: true })` |
| "YOU" 标签 | `{item.isCurrentUser && <span className="bg-[#18B36B]">YOU</span>}` |
| 特殊背景色 | `getRowBgClass()` 返回 `bg-[#262626]` |
| 分享按钮 | 仅当前用户行显示 |

### 排名显示规则

```tsx
// RankIcon 组件中的当前用户处理
if (isCurrentUser) {
  if (rank === null) return <span>Unranked</span>;  // 未上榜
  if (rank > 100) return <span>100+</span>;          // 超过100
  // top3 显示徽章（不论排序方向）
  const iconData = RANK_ICON_MAP[rank];
  if (iconData) return <span><img src={iconData.src} />{rank}</span>;
  return <span>{rank}</span>;
}
```

### 邮箱登录用户地址显示

```tsx
// 当前用户 + 邮箱登录时显示邮箱地址
const showEmail = item.isCurrentUser && emailLogin && emailAddress;
const displayAddress = showEmail ? emailAddress : item.walletAddress;

// 邮箱登录时 hover 显示钱包地址
{showEmail ? (
  <Tooltip title={truncateAddress(item.walletAddress)}>
    <span>{truncateAddress(displayAddress)}</span>
  </Tooltip>
) : (
  <span>{truncateAddress(displayAddress)}</span>
)}
```

---

## 金额格式化函数

排行榜使用多种格式化函数处理不同场景的金额显示：

### formatCurrency / formatPercent

基础格式化函数，用于表格数据显示：

```tsx
// const/index.tsx
export const formatCurrency = (value: number | null | undefined): string => {
  return formatFloorDecimal(value, { decimal: 2, prefix: "$" });
};

export const formatPercent = (value: number | null | undefined): string => {
  return formatFloorDecimal(value, { decimal: 2, suffix: "%" });
};

// 使用场景
<td>{formatCurrency(item.accountValue)}</td>  // $1,234.56
<td>{formatCurrency(item.pnl)}</td>           // $-500.00
<td>{formatPercent(item.roi)}</td>            // 12.34%
```

### formatLargeAmount / FormatLargeNumText

大金额缩写显示（M/B 后缀），hover 显示完整数字：

```tsx
// FormatLargeNumText.tsx
const FormatLargeNumText: React.FC<Props> = ({ value, prefix = "", showTooltip = true }) => {
  const displayText = formatLargeAmount(value, { decimal: 2, prefix });   // $1.23M
  const fullText = formatLargeAmountFull(value, { decimal: 2, prefix });  // $1,234,567.89
  
  const needTooltip = showTooltip && displayText !== fullText;
  
  if (needTooltip) {
    return (
      <Tooltip title={fullText}>
        <span>{displayText}</span>
      </Tooltip>
    );
  }
  return <span>{displayText}</span>;
};

// 使用场景：Volume 列
<FormatLargeNumText value={item.volume} prefix="$" />
```

### formatFloorDecimal（带正号）

分享文案和海报中使用，支持 `showPositiveSign`：

```tsx
// 分享文案生成
formatFloorDecimal(row.pnl, { decimal: 2, prefix: "$", showPositiveSign: true })
// 结果：+$1,234.56 或 -$500.00

formatFloorDecimal(row.roi, { decimal: 2, suffix: "%", showPositiveSign: true })
// 结果：+12.34% 或 -5.67%
```

### truncateAddress / truncateEmail

地址截断显示：

```tsx
// 钱包地址：前6位...后6位
export const truncateAddress = (address: string): string => {
  if (isEmail(address)) return truncateEmail(address);
  return `${address.slice(0, 6)}...${address.slice(-6)}`;
  // 结果：0x1234...5678
};

// 邮箱：最大15位，保留域名
const truncateEmail = (email: string, maxLength = 15): string => {
  // 规则：前缀 + *** + 后缀(可选) + @ + 域名
  // 结果：jo***n@gmail.com
};
```

---

## 分享弹窗

### Context 状态管理

`useShareLeaderboard` 提供分享弹窗的全局状态：

```tsx
interface ShareLeaderboardState {
  activeTimeRange: TimeRange;      // 当前选择的时间范围
  displayMode: ShareDisplayMode;   // "rank" | "beatPercent"
  memeIconKey: MemeIconKey;        // Meme 图标 key
  visibleMetrics: VisibleMetrics;  // 可见指标配置
}

// Provider 包裹分享弹窗内容
<ShareLeaderboardProvider initialTimeRange={props.timeRange}>
  <ShareLeaderboardContent {...props} />
</ShareLeaderboardProvider>
```

### useShareData - 时间切换数据缓存

分享弹窗内切换时间范围时，缓存不同时间的数据：

```tsx
const useShareData = ({ initialData, initialTimeRange, sortBy, sortDirection }) => {
  // 缓存不同时间范围的数据
  const [dataCache, setDataCache] = useState<Record<TimeRange, LeaderboardItem | null>>({
    "24h": initialTimeRange === "24h" ? initialData : null,
    "7d": initialTimeRange === "7d" ? initialData : null,
    // ...
  });

  // 请求指定时间范围的数据（如果未缓存）
  const fetchDataForTimeRange = async (targetTimeRange: TimeRange) => {
    if (dataCache[targetTimeRange]) return; // 已有缓存则跳过
    const res = await getLeaderboardRankService({ ... });
    setDataCache(prev => ({ ...prev, [targetTimeRange]: newData }));
  };

  return { getData, fetchDataForTimeRange, isCached };
};
```

### useShareText - 分享文案生成

根据显示模式和平台生成分享文案：

```tsx
const useShareText = ({ row, sortBy, timeRange, total, displayMode, visibleMetrics }) => {
  const getShareText = (platform: SharePlatform): string => {
    const brandName = platform === "twitter" ? "@sodex_official" : "SoDEX";
    
    let headline: string;
    if (displayMode === "rank") {
      const rankDisplay = row.rank === null ? "Unranked" : (row.rank > 100 ? "100+" : `${row.rank}`);
      headline = t("share_text_ranking", { rank: rankDisplay, brand: brandName });
    } else {
      const beat = beatPercent(row.rank, total);
      headline = t("share_text_beats", { percent: beat.toFixed(2), brand: brandName });
    }
    // ...构建指标行
    return lines.join("\n");
  };
  
  return { getShareText, twitterShareText, otherShareText, getFullShareText };
};
```

### PosterDom - 海报渲染

使用 `html-to-image` 生成可分享的海报图片：

```tsx
const PosterDom = ({ shareRef, row, sortBy, timeRange, displayMode, visibleMetrics, MemeIcon }) => {
  return (
    <div ref={shareRef} className="w-[456px] aspect-square rounded-xl">
      {/* 背景图片 */}
      <img src={ShareBackground} className="absolute inset-0" />
      
      {/* 内容 */}
      <div className="relative z-10">
        <img src={SoDEXLogo} />           {/* Logo */}
        <div>{rankingTitle}</div>         {/* 排名标题 */}
        <div>{headlineValue}</div>        {/* 排名/击败百分比 */}
        {MemeIcon && <MemeIcon />}        {/* Meme 图标 */}
        <div>{metricsData.map(...)}</div> {/* 指标数据 */}
        <QRCodeWithLogo value={shareUrl} /> {/* 二维码 */}
      </div>
    </div>
  );
};

// 生成图片并复制/下载
toBlob(shareRef.current, { quality: 0.95, pixelRatio: 2 })
  .then(blob => { ... });
```

---

## 响应式设计

### PC/Mobile 表格切换

```tsx
// LeaderboardChart.tsx
return (
  <div>
    <LeaderboardTablePC {...tableProps} />      {/* hidden pc:block */}
    <LeaderboardTableMobile {...tableProps} />  {/* pc:hidden */}
    <Pagination ... />
  </div>
);
```

### 时间筛选 PC/Mobile 差异

- **PC 端**：Tab 按钮组
- **Mobile 端**：Select 下拉

```tsx
// SearchBar.tsx
{/* PC 端 Tab */}
<div className="hidden pc:flex">
  {timeRangeOptions.map(option => (
    <button onClick={() => onTimeRangeChange(option.value)}>
      {option.label}
    </button>
  ))}
</div>

{/* 移动端 Select */}
<div className="flex-1 pc:hidden">
  <Select value={timeRange} options={timeRangeOptions} onChange={onTimeRangeChange} />
</div>
```

### 分享弹窗响应式

使用 `createResponsiveModal` 统一处理：

```tsx
export const shareLeaderboardModal = createResponsiveModal({
  Component: ShareLeaderboardWithProvider,
  options: {
    classes: { root: "max-w-[900px]" },
    anchor: "bottom",  // 移动端从底部滑入
    HeaderComponent: null,
  },
});
```

---

## 文件结构

```
src/pages/leaderboard/
├── index.tsx                    # 入口组件，状态管理
├── types/index.ts               # 类型定义
├── const/index.tsx              # 常量、工具函数、RankIcon 组件
├── hooks/
│   ├── useLeaderboardData.ts    # 列表数据请求
│   ├── useShareData.ts          # 分享弹窗数据缓存
│   ├── useShareText.ts          # 分享文案生成
│   └── useShareLeaderboard.tsx  # 分享弹窗 Context
├── components/
│   ├── SearchBar.tsx            # 搜索 + 排序 + 时间筛选
│   ├── Pagination.tsx           # 分页组件
│   ├── FormatLargeNumText.tsx   # 大金额显示组件
│   ├── EmptyState.tsx           # 空状态
│   ├── chart/
│   │   ├── LeaderboardChart.tsx     # 表格容器
│   │   ├── LeaderboardTablePC.tsx   # PC 端表格
│   │   └── LeaderboardTableMobile.tsx # 移动端卡片
│   ├── modal/
│   │   ├── index.tsx                # 弹窗入口 + createResponsiveModal
│   │   ├── ShareLeaderboardContent.tsx # 内容组件
│   │   ├── ShareLeaderboardPC.tsx   # PC 端布局
│   │   ├── ShareLeaderboardMobile.tsx # 移动端布局
│   │   ├── PosterDom.tsx            # 海报 DOM
│   │   └── types.ts                 # 布局 Props 类型
│   └── loading/
│       ├── index.ts
│       ├── LeaderboardSkeletonPC.tsx
│       └── LeaderboardSkeletonMobile.tsx

src/http/leaderboard/
├── api.d.ts                     # API 类型定义
└── index.tsx                    # API 请求函数
```

---

## 底部说明文案

入口组件 `index.tsx` 底部有说明文案，使用 i18n key：

```tsx
// src/pages/leaderboard/index.tsx
<div className="flex flex-col gap-1 text-xs text-[#A3A3A3] mt-2">
  <p>{t("disclaimer_1")}</p>  {/* 1. All rankings are refreshed hourly */}
  <p>{t("disclaimer_2")}</p>  {/* 2. Leaderboard includes accounts with at least one trade */}
  <p>{t("disclaimer_3")}</p>  {/* 3. Account Value = Spot + Perps + Vault */}
  <p>{t("disclaimer_4")}</p>  {/* 4. ROI = PnL / max(100, starting account value + maximum net deposits) */}
</div>
```

| i18n Key | 说明 | 关联字段 |
|----------|------|----------|
| `disclaimer_1` | 排名每小时刷新 | - |
| `disclaimer_2` | 至少一笔交易才上榜 | - |
| `disclaimer_3` | Account Value 计算公式 | `accountValue` |
| `disclaimer_4` | ROI 计算公式 | `roi` |

---

## 字段影响范围

修改/隐藏某个数据字段时，需要同步修改的文件列表：

### 类型定义层

| 字段 | 文件 | 修改内容 |
|------|------|----------|
| **全部字段** | `src/http/leaderboard/api.d.ts` | `LeaderboardApiItem` 接口、`ApiSortBy` 类型 |
| **全部字段** | `src/pages/leaderboard/types/index.ts` | `LeaderboardItem` 接口、`SortType` 类型、`MetricKey` 类型 |

### 数据转换层

| 字段 | 文件 | 修改内容 |
|------|------|----------|
| **全部字段** | `src/pages/leaderboard/const/index.tsx` | `transformApiItem` 函数、`SORT_LABEL`、`SORT_LABEL_I18N_KEY`、`sortTypeToApiSortBy` |
| `roi` | `src/pages/leaderboard/const/index.tsx` | `formatPercent` 函数（可能被引用） |
| `accountValue` | `src/pages/leaderboard/const/index.tsx` | `formatCurrency` 函数（可能被引用） |

### UI 层 - 排序选项

| 字段 | 文件 | 修改内容 |
|------|------|----------|
| **排序相关字段** | `src/pages/leaderboard/components/SearchBar.tsx` | `sortOptions` 数组 |

### UI 层 - 表格显示

| 字段 | 文件 | 修改内容 |
|------|------|----------|
| **表格列字段** | `src/pages/leaderboard/components/chart/LeaderboardTablePC.tsx` | 表头 `SortableHeader`、数据行 `<td>`、`colgroup` 宽度 |
| **表格列字段** | `src/pages/leaderboard/components/chart/LeaderboardTableMobile.tsx` | 卡片数据项、`grid-cols-N` 布局 |

### UI 层 - 分享弹窗

| 字段 | 文件 | 修改内容 |
|------|------|----------|
| **指标字段** | `src/pages/leaderboard/components/modal/ShareLeaderboardContent.tsx` | `METRIC_KEYS` 数组、`METRIC_LABEL_MAP` |
| **指标字段** | `src/pages/leaderboard/components/modal/PosterDom.tsx` | `metricsData` 生成逻辑、颜色条件判断 |
| **指标字段** | `src/pages/leaderboard/hooks/useShareText.ts` | `metricsLines` 生成逻辑 |
| **指标字段** | `src/pages/leaderboard/hooks/useShareLeaderboard.tsx` | `visibleMetrics` 默认值 |

### Hooks 层 - 数据请求

| 字段 | 文件 | 修改内容 |
|------|------|----------|
| **全部字段** | `src/pages/leaderboard/hooks/useLeaderboardData.ts` | 未上榜用户默认数据对象 |
| **全部字段** | `src/pages/leaderboard/hooks/useShareData.ts` | 未上榜数据对象 |

### 其他

| 字段 | 文件 | 修改内容 |
|------|------|----------|
| `accountValue` | `src/pages/leaderboard/index.tsx` | `disclaimer_3` 底部说明 |
| `roi` | `src/pages/leaderboard/index.tsx` | `disclaimer_4` 底部说明 |

### 快速检索表

```
修改 roi 字段:
  api.d.ts → types/index.ts → const/index.tsx → SearchBar.tsx
  → LeaderboardTablePC.tsx → LeaderboardTableMobile.tsx
  → ShareLeaderboardContent.tsx → PosterDom.tsx → useShareText.ts
  → useShareLeaderboard.tsx → useLeaderboardData.ts → useShareData.ts
  → index.tsx (disclaimer_4)

修改 accountValue 字段:
  api.d.ts → types/index.ts → const/index.tsx → SearchBar.tsx
  → LeaderboardTablePC.tsx → LeaderboardTableMobile.tsx
  → ShareLeaderboardContent.tsx → PosterDom.tsx → useShareText.ts
  → useShareLeaderboard.tsx → useLeaderboardData.ts → useShareData.ts
  → index.tsx (disclaimer_3)

修改 pnl/volume 字段:
  api.d.ts → types/index.ts → const/index.tsx → SearchBar.tsx
  → LeaderboardTablePC.tsx → LeaderboardTableMobile.tsx
  → ShareLeaderboardContent.tsx → PosterDom.tsx → useShareText.ts
  → useShareLeaderboard.tsx → useLeaderboardData.ts → useShareData.ts
```

---

## 关键设计决策

### 后端分页 vs 前端分页

选择**后端分页**，原因：
- 数据量大（可能数万用户）
- 减少首屏加载时间
- 支持多维度排序由后端处理

### 当前用户数据单独请求

选择**并行请求**当前用户数据，原因：
- 当前用户可能不在当前页
- 即使未上榜也需要显示
- 分离关注点，便于维护

### 分享弹窗使用 Context

选择 **Context + hooks** 管理状态，原因：
- 避免 props drilling（深层组件树）
- 状态变化时可局部更新
- 便于复用（PC/Mobile 共享逻辑）

### 时间切换数据缓存

选择**本地缓存**不同时间范围的数据，原因：
- 用户可能频繁切换时间范围
- 减少重复请求
- 提升用户体验

---

## API 接口

### 接口列表

| 接口 | 方法 | 用途 |
|------|------|------|
| `/api/v1/leaderboard` | GET | 分页列表 |
| `/api/v1/leaderboard/rank` | GET | 搜索用户 / 当前用户数据 |

### 请求参数

```typescript
// 列表接口
interface LeaderboardListParams {
  window_type?: "24H" | "7D" | "30D" | "ALL_TIME";
  page?: number;
  page_size?: 10 | 20 | 50;
  sort_by?: "roi" | "pnl" | "volume" | "account_value";
  sort_order?: "asc" | "desc";
}

// 排名接口（搜索/当前用户）
interface LeaderboardRankParams {
  window_type?: WindowType;
  email?: string;           // 邮箱搜索
  wallet_address?: string;  // 钱包地址搜索
  sort_by?: ApiSortBy;
  sort_order?: ApiSortOrder;
}
```

### 响应数据

```typescript
// API 返回的单条数据
interface LeaderboardApiItem {
  rank: number;
  wallet_address: string;
  account_value_end_usd: string;  // 字符串，需 parseFloat
  pnl_usd: string;
  roi: string;                     // 小数，需 * 100 转百分比
  volume_usd: string;
}

// 前端转换后的数据
interface LeaderboardItem {
  rank: number | null;       // null 表示未上榜
  walletAddress: string;
  accountValue: number;
  pnl: number;
  roi: number;               // 已 * 100
  volume: number;
  isCurrentUser?: boolean;
}
```

### 数据转换

```tsx
// const/index.tsx - API → 前端数据转换
export const transformApiItem = (item: LeaderboardApiItem): LeaderboardItem => ({
  rank: item.rank,
  walletAddress: item.wallet_address,
  accountValue: parseFloat(item.account_value_end_usd) || 0,
  pnl: parseFloat(item.pnl_usd) || 0,
  roi: (parseFloat(item.roi) || 0) * 100,  // API 小数 → 百分比
  volume: parseFloat(item.volume_usd) || 0,
});
```

---

## 排名样式规则

### Top 3 徽章与背景色

仅在 `sortDirection === "desc"` 时显示：

| 排名 | 徽章 | PC 背景色 | Mobile 渐变 |
|------|------|-----------|-------------|
| 1 | `no1.svg` | `bg-[#3D2A1A]` | `from-[rgba(255,179,5,0.4)]` |
| 2 | `no2.svg` | `bg-[#2A2A2A]` | `from-[rgba(205,225,231,0.4)]` |
| 3 | `no3.svg` | `bg-[#2D2520]` | `from-[rgba(255,131,44,0.3)]` |

```tsx
// 获取行背景色（PC）
export const getRowBgClass = (rank, isCurrentUser, sortDirection) => {
  if (isCurrentUser) return "bg-[#262626]";
  if (sortDirection === "desc" && rank >= 1 && rank <= 3) {
    return RANK_BG_MAP[rank];
  }
  return "";
};
```

---

## 术语表

| 术语 | 说明 |
|------|------|
| `TimeRange` | 时间范围：24h / 7d / 30d / all |
| `SortType` | 排序字段：pnl / roi / volume / accountValue |
| `SortDirection` | 排序方向：asc / desc |
| `WindowType` | API 时间窗口：24H / 7D / 30D / ALL_TIME |
| `ApiSortBy` | API 排序字段（snake_case） |
| `ShareDisplayMode` | 分享显示模式：rank（排名）/ beatPercent（击败百分比）|
| `MemeIconKey` | Meme 图标标识符 |
| `VisibleMetrics` | 分享海报可见指标配置 |

---

## 更新记录

### 2026-03-03: 新增字段影响范围

- **底部说明文案**：新增 `disclaimer_1-4` i18n key 说明及关联字段
- **字段影响范围矩阵**：新增完整的字段→文件修改清单，支持快速定位修改点
- **快速检索表**：每个字段的完整修改链路一目了然

### 2026-03-02: 新增限流与错误处理

- **HTTP 429 错误处理**：API 请求启用 `skipErrorHandler` 模式，手动处理 429 限流错误，显示国际化 toast 提示
- **分页节流**：`Pagination.tsx` 添加 500ms 节流，防止快速连续点击导致 429 错误
- **i18n 新增 keys**：`error_rate_limit`（请求过于频繁）、`error_fetch_failed`（加载数据失败）

### 2026-03-02: 初始版本

初始文档，通过 /k/context learn 从代码自动生成
