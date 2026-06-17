# 全局公告 Banner（Global Banner）

## 架构概览

公告 banner 由**一个主消费者 + 一个兜底组件**协作渲染，对齐老项目 sodex-web 的 `DepositBanner` + `GlobalBanner` 双层结构：

```
 ┌──────────────────────── biz/config/banner ────────────────────────┐
 │                                                                    │
 │  React Query: queryKeys.market.banner(env)  staleTime=5min        │
 │  ───────────────────  useBannerQuery (select: data.map(toBanner)) │
 │       │                                                            │
 │       ├──► useGlobalBanner（主消费者）                              │
 │       │      消费 type 2/3/4（type 1 暂未接入）                      │
 │       │      守卫：!(isChainMaintenance && isTradeRoute) + !isRestricted │
 │       │      24h TTL + URL 校验 + Collapse/Motion 动画              │
 │       │      → <GlobalBanner /> 在 sticky 顶部渲染                  │
 │       │                                                            │
 │       └──► MaintenanceBanner（fallback 兜底）                       │
 │             条件：isInMaintenance && !hasType2Banner                │
 │             硬编码英文，不可关闭                                     │
 │             → <TopAlertSlot> 内渲染（与 RegionRestrictBanner 互斥） │
 │                                                                    │
 └────────────────────────────────────────────────────────────────────┘

 关闭状态共享 localStorage："sodex:banner:visibility:${id}"  TTL=24h
 仅 useGlobalBanner 写入此存储；MaintenanceBanner 是纯 fallback 不写入
```

App.tsx 顶部 sticky 堆叠：

```
 sticky top-0 z-30
 ┌──────────────────────────────────────────┐
 │ <Header />                                │
 │ <GlobalBanner />     主公告（type 2/3/4）  │
 │ <TopAlertSlot />     fallback / region 互斥 │
 └──────────────────────────────────────────┘
```

## 老项目对齐

### sodex-web 双层结构

| 老项目 | 文件 | 对应新项目 |
|--------|------|------------|
| 容器层 `DepositBanner` | `components/header/components/depositBanner/index.tsx` | App.tsx `TopAlertSlot` + `useGlobalBanner` 守卫拆分 |
| 内层 `GlobalBanner`（消费 banner） | `components/header/components/globalBanner/index.tsx` | `useGlobalBanner` + `<GlobalBanner />` |
| 唯一守卫 `isActuallyVisible = !(isChainMaintenance && isTradePage)` | globalBanner.tsx:244 | `useGlobalBanner` 内 `isChainMaintenanceOnTrade` |
| 容器互斥 `isRestricted && !isInMaintenance ? Region : GlobalBanner` | depositBanner.tsx:97-114 | `useGlobalBanner !isRestricted` 守卫 + TopAlertSlot 互斥 |
| Type 2/4 page='all' / Type 3 isTradePage+symbol | globalBanner.tsx:82-124 | `selectVisibleBanners` filter |
| 优先级 2>3>1>4 | globalBanner.tsx:129-135 | `selectVisibleBanners` 按 bannerType 升序（type 1 暂未接入） |
| 24h TTL + `sodex:banner:visibility:` 命名空间 | globalBanner.tsx:12-14 | `useGlobalBanner` 内常量一致 |

### 老项目无 / 新项目新增

| 项 | 说明 |
|----|------|
| MaintenanceBanner fallback | **新增**。老项目维护期若后端没下发 type 2 则顶部空白；新项目按 spec a 防御性策略硬编码英文兜底 |
| TopAlertSlot 规则 1 `/maintenance → null` | **新增**。新项目有独立 `/maintenance` 整页（spec e），路径接管时不重复顶部 banner |

## 核心逻辑

### 1) `useGlobalBanner()` — 主公告 ViewModel

```ts
// src/features/market/containers/useGlobalBanner.ts:83
export function useGlobalBanner(): GlobalBannerViewModel {
  const { data: banners } = useBannerQuery();
  const isTradeRoute = useRouteStore((s) => s.isTradeRoute);
  const routeSymbol = useRouteStore((s) => s.routeSymbol);
  const locale = useIntlStore((s) => s.locale);
  const isMobileScreen = useIsMobileScreen();
  const { isChainMaintenance } = useMaintenance();   // 仅链维护参与守卫
  const { isRestricted } = useRegionRestrict();
  const isChainMaintenanceOnTrade = isChainMaintenance && isTradeRoute;

  const visibleBanners = useMemo(
    () => !isChainMaintenanceOnTrade && !isRestricted && banners?.length
      ? selectVisibleBanners(banners, isTradeRoute, routeSymbol, closeTimeMap)
      : [],
    [...],
  );
  const currentBanner = visibleBanners[0] ?? null;
}
```

`selectVisibleBanners` 各 type 过滤规则（与老项目逐项对齐）：

| bannerType | Trade 页 | 非 Trade 页 | 24h TTL | 排序 |
|------------|---------|------------|---------|------|
| 2（系统维护） | 显示 | `page='all'` 时显示 | ✓ | 优先级 1 |
| 3（指定币对） | `symbols.length===0 OR symbols 包含 routeSymbol` 时显示 | 不显示 | ✓ | 优先级 2 |
| 4（全站） | 显示 | `page='all'` 时显示 | ✓ | 优先级 4 |
| 1（新手） | 当前未接入展示流程（filter 默认 false） | — | — | — |

排序：`bannerType` 升序；首条作为当前展示，关闭后下一条自动顶上。

### 2) `MaintenanceBanner` — 纯 fallback

```tsx
// src/features/maintenance/components/MaintenanceBanner.tsx
export function MaintenanceBanner() {
  const { isInMaintenance } = useMaintenance();
  const { data: banners } = useBannerQuery();      // React Query dedupe，复用同一份请求

  if (!isInMaintenance) return null;

  const hasType2Banner = banners?.some(
    (b) => b.bannerType === 2 && (b.page === "all" || !b.page),
  );
  if (hasType2Banner) return null;                 // 让位 GlobalBanner

  return (
    <Alert variant="warning" ...>
      Scheduled maintenance is in progress. Some features may be temporarily unavailable.
    </Alert>
  );
}
```

仅有两个职责：
1. 维护期判断（`isInMaintenance`）
2. 让位判断（`hasType2Banner` 时返回 null，让 GlobalBanner 渲染后端 type 2）

不写 localStorage、不消费 type 2 内容、不可关闭——保持极简兜底。

### 3) URL 安全校验

```ts
function isValidUrl(url: string | undefined): url is string {
  if (!url || !url.trim()) return false;
  const lower = url.trim().toLowerCase();
  return !lower.startsWith("javascript:")
      && !lower.startsWith("data:")
      && !lower.startsWith("vbscript:");
}
```

`handleClick` 仅在校验通过时 `window.open(url, "_blank", "noopener,noreferrer")`。

### 4) `TopAlertSlot` 三条守卫

```tsx
// src/App.tsx
function TopAlertSlot() {
  const { isInMaintenance, isChainMaintenance } = useMaintenance();
  const { pathname } = useLocation();
  if (pathname === "/maintenance") return null;                          // 规则 1
  const isTradeRoute = pathname.startsWith("/trade/spot/") || ...;
  if (isChainMaintenance && isTradeRoute) return null;                   // 规则 2
  return isInMaintenance ? <MaintenanceBanner /> : <RegionRestrictBanner />; // 规则 3
}
```

| 规则 | 触发 | 行为 | 老项目对齐 |
|------|------|------|------------|
| 1 | `pathname === "/maintenance"` | 整页接管，不重复 | 新增（老项目无独立维护页） |
| 2 | `isChainMaintenance && isTradeRoute` | 让位 chain banner | globalBanner.tsx:244（老项目守的是 GlobalBanner，新项目对 TopAlertSlot 同样适用） |
| 3 | 维护期 → MaintenanceBanner；否则 → RegionRestrictBanner | 维护优先于地区 | depositBanner.tsx:97/104 |

## 场景决策矩阵（不同情况下的渲染逻辑）

下表枚举所有相关维度组合，给出最终顶部渲染结果。

**维度定义**：
- `M` = Maintenance level：`0 / 1 / 2`（0=正常，1=full，2=chain）
- `R` = Region restricted：`0 / 1`
- `Route` = `/maintenance / Trade / NonTrade`
- `B2` = 后端是否下发 type 2 banner（page='all' 或不限）：`Y / N`
- `Closed2` = type 2 是否被用户在 24h 内关闭：`Y / N`（仅 B2=Y 时有意义）

**输出**：sticky 顶部从上到下的渲染（Header 已固定省略）。

| # | M | Route | R | B2 | Closed2 | GlobalBanner | TopAlertSlot | 顶部最终显示 |
|---|---|-------|---|----|---------|--------------|--------------|-------------|
| 1 | 0 | NonTrade | 0 | N | — | type 4（若有 page='all'）/ null | RegionRestrictBanner（R=0 故走规则 3b → null） | Header + 可能 type 4 |
| 2 | 0 | Trade | 0 | N | — | type 3/4 优先 | null（R=0 → 规则 3b→null） | Header + 运营公告 |
| 3 | 0 | Trade | 1 | N | — | null（`!isRestricted` 守卫） | RegionRestrictBanner | Header + Region |
| 4 | 0 | NonTrade | 1 | N | — | null（`!isRestricted` 守卫） | RegionRestrictBanner | Header + Region |
| 5 | 1 | NonTrade | 0 | Y | N | type 2（24h TTL 可关闭） | null（hasType2=Y → fallback 让位） | Header + type 2 |
| 6 | 1 | NonTrade | 0 | Y | Y | null（TTL 命中） | null（hasType2=Y → fallback 仍让位） | Header（顶部空白，对齐老项目） |
| 7 | 1 | NonTrade | 0 | N | — | null（无 type 2） | MaintenanceBanner（fallback） | Header + fallback |
| 8 | 1 | NonTrade | 1 | N | — | null（`!isRestricted`） | MaintenanceBanner（规则 3a，维护优先于地区） | Header + fallback |
| 9 | 1 | NonTrade | 1 | Y | N | type 2 | null（hasType2=Y） | Header + type 2 |
| 10 | 1 | Trade | 0 | Y | N | type 2 | null | Header + type 2（瞬时，MaintenanceInit 即将 navigate） |
| 11 | 1 | Trade | 0 | N | — | null | MaintenanceBanner | Header + fallback（瞬时） |
| 12 | 1 | `/maintenance` | * | * | * | null（StickyTopBar 整体 null） | null（规则 1） | 整页接管，无 sticky |
| 13 | 2 | NonTrade | 0 | Y | N | type 2 | null | Header + type 2 |
| 14 | 2 | NonTrade | 0 | N | — | null | MaintenanceBanner | Header + fallback |
| 15 | 2 | NonTrade | 1 | * | * | null（`!isRestricted`） | MaintenanceBanner（维护优先） | Header + fallback |
| 16 | 2 | Trade | 0 | Y | N | null（`isChainMaintenanceOnTrade` 守卫） | null（规则 2） | Header（顶部完全让位 chain banner） |
| 17 | 2 | Trade | 0 | N | — | null | null（规则 2） | Header（同上） |
| 18 | 2 | Trade | 1 | * | * | null | null（规则 2 优先于规则 3） | Header（同上） |

**关键观察**：
- 维护期 type 2 永远由 `GlobalBanner` 渲染（除非 Trade + chain 维护被规则 2 / 守卫整体让位）
- `MaintenanceBanner` 仅在「维护期 + 后端无 type 2」时实际渲染（行 7/8/14/15）
- 用户关闭 type 2 后顶部空白（行 6），与老项目"关闭后维护期顶部空白"完全一致
- `level=1 + Trade` 是瞬时态（行 10/11），MaintenanceInit 几帧后 navigate('/maintenance')
- `level=2 + Trade` 顶部完全让位（行 16-18），不显示任何 banner，由 chain banner 在页面其他位置承担提示

## 关键实现

### 24h TTL + 自动恢复（仅 useGlobalBanner）

```ts
const STORAGE_PREFIX = "sodex:banner:visibility:";
const BANNER_TTL = 24 * 60 * 60 * 1000;
const TTL_CHECK_INTERVAL = 5 * 60 * 1000;
```

- 关闭：写入 `Date.now().toString()` 到 `STORAGE_PREFIX + bannerId`，同步到 `closeTimeMap`
- 巡检：5min `setInterval` 扫描所有 `STORAGE_PREFIX` 前缀 key，过期则 remove + setState 触发重渲染
- 命名空间与老项目 `SODEX_BANNER_VISIBILITY_PREFIX` 完全一致 → 用户在新旧项目间迁移时关闭状态保留

### DTO → Domain

```ts
// configApi.ts
type BannerResponse = { code; msg; data: BannerDto[] }

// normalize.ts
const BANNER_STYLE_MAP = { regular: "success", alert: "error" };
export function toBanner(dto): Banner {
  return { ...dto, symbols: dto.symbols ?? [],
           style: BANNER_STYLE_MAP[dto.style ?? ""] ?? "warning",
           mobileContent: dto.mobileContent ?? {} };
}
```

老项目仅 `regular`/`alert` 两种，未传或未知 → 默认 `warning`。

### 内容选择（mobile / pc / locale fallback）

```ts
const content = isMobile
  ? (mobile[locale] || mobile.en || pc[locale] || pc.en || "")
  : (pc[locale] || pc.en || "");
```

mobile 优先取 mobileContent，回退 pcContent；都按当前 locale → en 兜底。

### 动画

`<GlobalBanner>` = `Collapse`（高度展开/收起）+ `AnimatePresence mode="wait"`（id 切换淡入淡出）：
- `hasShownRef` 控制首次跳过 opacity 动画（仅 Collapse 起效）
- `key={bannerId}` 触发 motion 切换；关闭旧 banner → 新一条 fade in
- `isVisible=false` 时不渲染内部，避免 `key=0` → 真实 id 的 phantom 切换

## 关键设计决策

### D-001（已重写）：单消费者架构 + fallback 兜底

**决策**：`useGlobalBanner` 单消费者处理 type 2/3/4；`MaintenanceBanner` 仅作 fallback 兜底，不消费 type 2 内容。

**Why**：
- 老项目（sodex-web）GlobalBanner 没有 `isInMaintenance` 整体守卫——type 2 维护通知在 level=1/2 时都正常渲染
- 早期我误加了 `!isInMaintenance` 守卫（spec b 旧版），导致维护期后端 type 2 整组被屏蔽，不得不在 MaintenanceBanner 内重写一遍 type 2 消费 + 24h TTL 流程，造成双消费者状态分裂
- 修正后：删除 `!isInMaintenance` 守卫；MaintenanceBanner 退回纯 fallback；架构与老项目一致

**How to apply**：
- 后端配置 type 2 banner（page='all'）→ GlobalBanner 自然渲染（24h TTL）
- 后端没配置 type 2 + 维护期 → MaintenanceBanner fallback 渲染
- 任何修改 24h TTL / STORAGE_PREFIX / type 2 渲染逻辑的改动都只在 `useGlobalBanner.ts` 一处

### D-002：localStorage 跨标签共享（保留）

老项目 sodex-web 同样使用 localStorage + 24h TTL。用户在不同标签页/重启浏览器后关闭状态保持；TTL 到期由 5min 巡检兜底重置。

### D-003：bannerType=1 当前不渲染（保留）

`selectVisibleBanners` filter 最后默认 `return false`。type 1（新手用户 deposit banner）老项目要求 `address && isEligibleForType1`（查过 deposit/withdraw 记录 total===0），新项目暂未接入此流程，是已知技术债。

### D-004：TopAlertSlot 守卫顺序（保留）

```
/maintenance → null  (规则 1)
chain-maintenance + Trade → null  (规则 2)
isInMaintenance → MaintenanceBanner(fallback)  (规则 3a)
其他 → RegionRestrictBanner  (规则 3b)
```

`level=1 + Trade` 不命中规则 2（`isChainMaintenance===false`），由规则 3a 渲染 fallback（瞬时），随后 MaintenanceInit 触发 navigate('/maintenance')，规则 1 接管。

### D-005（新增）：useGlobalBanner 不守 `!isInMaintenance`

**禁止重新引入** `if (isInMaintenance) return []` 类守卫。本守卫曾在 spec b 旧版被加入，导致 D-001 描述的双消费者补丁。变更前请回看本节。

## 文件结构

```
src/features/market/
├── containers/
│   ├── useBannerQuery.ts            React Query + select(toBanner) + 5min staleTime
│   └── useGlobalBanner.ts           主消费者 ViewModel（type 2/3/4 + 24h TTL + 守卫）
├── components/
│   └── GlobalBanner/index.tsx       Collapse + AnimatePresence + Alert
├── infra/api/configApi.ts           BannerResponse + fetchBanner('biz/config/banner')
└── domain/
    ├── types.ts                     Banner / BannerStyle
    └── normalize.ts                 toBanner + BANNER_STYLE_MAP

src/features/maintenance/
└── components/MaintenanceBanner.tsx 纯 fallback：isInMaintenance && !hasType2Banner

src/App.tsx
├── StickyTopBar()                   sticky 容器：Header + GlobalBanner + TopAlertSlot
└── TopAlertSlot()                   三条守卫互斥 MaintenanceBanner / RegionRestrictBanner
```

## 开发修改指南

### 新增 banner 类型

1. `Banner.bannerType` 注释更新（types.ts:112）
2. `selectVisibleBanners` filter 分支补充（useGlobalBanner.ts，注意 isTradePage / page='all' 的对齐规则）
3. 调整 sort 比较函数若需特殊优先级
4. 决策矩阵（本文档）补行

### 调整 TTL

`BANNER_TTL` / `TTL_CHECK_INTERVAL` 仅在 `useGlobalBanner.ts` 一处定义。MaintenanceBanner 不持有 TTL，无需同步。如需跨多文件共享，抽到 `domain/constants.ts`。

### 修改 style 映射

`BANNER_STYLE_MAP` 在 normalize.ts:160；新增样式同时检查 `Alert` 组件 variant 是否支持。

### 影响清单（修改本功能时需回归）

完整覆盖决策矩阵 18 行场景：
- M=0 / 1 / 2 三档维护
- R=0 / 1 两档地区
- Route=NonTrade / Trade / `/maintenance` 三档路由
- 后端 B2=Y / N + 用户 Closed2=Y / N

最少需手测：行 5（type 2 维护）、行 7（fallback）、行 8（维护优先地区）、行 16（chain+Trade 让位）。

## 术语表

- **主消费者 / fallback 兜底**：架构两个角色 — useGlobalBanner 渲染所有正常 banner；MaintenanceBanner 仅在维护期且无 type 2 时兜底
- **STORAGE_PREFIX**：`"sodex:banner:visibility:"`，与老项目 `SODEX_BANNER_VISIBILITY_PREFIX` 字面一致
- **TTL 24h**：关闭后 24 小时内不再展示，过期由 5min 巡检自动重置
- **isChainMaintenanceOnTrade**：链维护 + Trade 路由复合条件，对齐老项目 `isActuallyVisible`
- **hasType2Banner**：后端是否下发 type 2 banner（page='all' 或不限），用于 MaintenanceBanner 让位判断

## 更新记录

### 2026-04-30: 初始版本（v1）

通过 /k:context-learn 从代码生成。涵盖双消费者架构（错误版）+ TopAlertSlot 三条守卫。

### 2026-04-30: 架构修正（v2）

对齐老项目 sodex-web 单消费者架构：
- 删除 useGlobalBanner 的 `!isInMaintenance` 守卫（spec b 早期错误添加）
- MaintenanceBanner 退回纯 fallback（不再消费 type 2）
- D-001 重写、新增 D-005 防止回退
- 新增「场景决策矩阵」章节覆盖 18 行场景组合
- 新增「老项目对齐」章节明确每条逻辑的 sodex-web 出处
