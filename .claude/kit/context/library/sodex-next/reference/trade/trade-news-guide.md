# Trade News 模块 — 实现总文档（code vs spec 全量对账）

## 核心需求


> 单一事实源 — 整合 5 维度并行审计（A 接口 / B UI / C 详情+分享 / D URL 重定向 / E 埋点+海报）。
> 历史 spec 已归档至 `old/`，本文档为唯一活跃版本。

---


| 维度 | 主代码 | 整体 |
|---|---|---|
| A 接口层 | `src/features/news/{infra,domain,containers}` | ✅ 高度一致；spec 漏列 3 hook |
| B UI 主体 | `src/features/news/components/` + `features/trade/components/CoinInfoTabs/` + `MobileMarketView` | ✅ 主体一致；9 项实现增量 |
| C 详情 + 分享 | `news/components/PostDetailDialog.tsx` + `shared/components/features/ShareDialog/` + `shared/utils/capturePoster.ts` | ✅ 与 spec 一致；分享文案 + 埋点超额；PC 宽度数学不一致 |
| D 分享 URL | `features/shareURLAction/` + `news/containers/fetchNewsPostById.ts` + `JoinRedirectPage` | ✅ 完全落地；过期 TODO 注释 |
| E 埋点 + 海报 | `shared/track/events/tradeNews.ts` + `ShareActions/index.tsx` + `capturePoster.ts` | ✅ 埋点完全落地；🆕 Mobile 超额；❌ "无图版"功能不存在 |

对账标记：✅ 一致 / ⚠ 偏差但合理 / ❌ 错（哪边对） / 🆕 spec 漏写 / 🗑 spec 写但代码已删

---

---

## 核心流程图

[有 referralCode + spot]
  https://sodex.com/join/ABC123?feeds=12345&spot=BTC_USDC
    → /trade/spot/BTC_USDC?feeds=12345&invitecode=ABC123  (JoinRedirect 转 path)
    → /trade/spot/BTC_USDC                                  (Consumer 派发后 replace 清)

[有 referralCode + futures]
  https://sodex.com/join/ABC123?feeds=12345&futures=BTC-USD
    → /trade/futures/BTC-USD?feeds=12345&invitecode=ABC123

[无 referralCode + spot] 绕过中转
  https://sodex.com/trade/spot/BTC_USDC?feeds=12345

[无 referralCode + 无 market]
  https://sodex.com?feeds=12345

features/trade/SpotTradePage / MobileMarketView
  └─ CoinInfoTabs (7 tab union; data tab 仅 futures)
       └─ NewsPanel (news/components/index.tsx)
            ├─ NewsTable / AnnouncementList
            │    └─ NewsTableRow / NewsCard / EmptyState
            ├─ useNewsList → newsClient.fetchArticleList (H1)
            ├─ useStockAnnouncement → newsClient.fetchStockAnnouncement (H3)
            └─ openPostDetailDialog (news/index.ts:9)
                 └─ PostDetailDialog
                      ├─ MobilePostDetailContent / PcPostDetailContent
                      ├─ useNewsShare
                      │    ├─ useShareCapture (shared)
                      │    │    └─ capturePoster (html2canvas)
                      │    └─ buildNewsShareJoinUrl + buildNewsFullShareText (domain)
                      └─ DetailShareRow + ShareActions → trackFeedsShareClick

features/shareURLAction (App.tsx:51, :210)
  └─ useShareURLActionConsumer
       ├─ shareURLActionLogic (DU + switch + priority)
       └─ case "feeds":
            └─ fetchNewsPostById (news barrel, H2) + openPostDetailDialog

埋点全链路
  ├─ CoinInfoTabs / MobileMarketView → trackAssetDetailClick
  └─ DetailShareRow + ShareActions → trackFeedsShareClick
       └─ shared/track/events/tradeNews.ts → saTrackService

---

## 核心组件

| 组件 | 路径 | 作用 |
|------|------|------|
| | A 接口层 | `src/features/news/{infra,domain,containers}` | ✅ 高度一致；spec 漏列 3 hook | | | |
| | B UI 主体 | `src/features/news/components/` + `features/trade/components/CoinInfoTabs/` + `MobileMarketView` | ✅ 主体一致；9 项实现增量 | | | |
| | C 详情 + 分享 | `news/components/PostDetailDialog.tsx` + `shared/components/features/ShareDialog/` + `shared/utils/capturePoster.ts` | ✅ 与 spec 一致；分享文案 + 埋点超额；PC 宽度数学不一致 | | | |
| | # | Module | Method + Path | Base / Client | Caller | file:line | 触发场景 | | | |
| | # | Module | API | 用途 | file:line | | | |
| | S10 | i18n | `useTranslation("spot"/"common"/"notification")` | 3 namespace | 各组件 | | | |
| | # | 函数 | 用途 | file:line | | | |
| | H2 detail | `id` (path) | string | `newsApi.ts:77` `encodeURIComponent` | | | |
| | Hook | 签名 | 内部 | file:line | | | |
| | `fetchNewsPostById`（非 hook）| `(id, lang, signal?) → Promise<NewsPost \| null>` | `fetchArticleDetail + parseNewsPost` | `fetchNewsPostById.ts:14-22` 🆕 spec 漏列 | | | |

---

## 解决方案

详见下方完整规范

---

## 核心文件

- src/features/auth/pages/JoinRedirectPage.tsx
- src/features/news/components/PostDetailDialog.tsx
- src/features/news/infra/api/newsApi.ts
- src/features/trade/components/CoinInfoTabs/index.tsx
- src/shared/components/features/ShareActions/index.tsx
- src/shared/queryKeys/index.ts
- src/shared/track/events/tradeNews.ts
- src/shared/utils/capturePoster.ts
- src/shared/utils/getAssetCategoryFromSeoName.ts

---

## 完整规范

# Trade News 模块 — 实现总文档（code vs spec 全量对账）

> 单一事实源 — 整合 5 维度并行审计（A 接口 / B UI / C 详情+分享 / D URL 重定向 / E 埋点+海报）。
> 历史 spec 已归档至 `old/`，本文档为唯一活跃版本。

---

## 0. 实现状态一览

| 维度 | 主代码 | 整体 |
|---|---|---|
| A 接口层 | `src/features/news/{infra,domain,containers}` | ✅ 高度一致；spec 漏列 3 hook |
| B UI 主体 | `src/features/news/components/` + `features/trade/components/CoinInfoTabs/` + `MobileMarketView` | ✅ 主体一致；9 项实现增量 |
| C 详情 + 分享 | `news/components/PostDetailDialog.tsx` + `shared/components/features/ShareDialog/` + `shared/utils/capturePoster.ts` | ✅ 与 spec 一致；分享文案 + 埋点超额；PC 宽度数学不一致 |
| D 分享 URL | `features/shareURLAction/` + `news/containers/fetchNewsPostById.ts` + `JoinRedirectPage` | ✅ 完全落地；过期 TODO 注释 |
| E 埋点 + 海报 | `shared/track/events/tradeNews.ts` + `ShareActions/index.tsx` + `capturePoster.ts` | ✅ 埋点完全落地；🆕 Mobile 超额；❌ "无图版"功能不存在 |

对账标记：✅ 一致 / ⚠ 偏差但合理 / ❌ 错（哪边对） / 🆕 spec 漏写 / 🗑 spec 写但代码已删

---

## 0a. 全量接口调用表（**所有网络 / SDK / 浏览器 API**）

> 覆盖 trade-news 业务全链路所触发的全部外部调用，按业务模块归类。

### HTTP API（network）

| # | Module | Method + Path | Base / Client | Caller | file:line | 触发场景 |
|---|---|---|---|---|---|---|
| H1 | News 列表 | `GET biz/v1/asset/intelligence` | `bizClient` (`VITE_BIZ_URL`) | `newsClient.fetchArticleList` | `news/infra/api/newsApi.ts:51` | crypto/stock/index News + Opinion + Research（`infoType` 区分）|
| H2 | News 详情 | `GET biz/v1/asset/intelligence/{id}` | 同上 | `newsClient.fetchArticleDetail` | `newsApi.ts:77` | 分享 URL 落地时（`feeds=` 参数命中）|
| H3 | Stock 公告 | `GET biz/v1/asset/intelligence` (`infoType="announcement"`) | 同上 | `newsClient.fetchStockAnnouncement` | `newsApi.ts:95` | stock Announcement tab |
| H4 | Referral Code | （`useReferralCodeQuery` 内部）| — | `useReferralCodeQuery` | `useNewsShare.ts:49` 间接消费 | 分享视图拼装 `joinUrl` 时 |
| H5 | Perps Max Leverage | （`usePerpsMaxLeverage` 内部）| — | `usePerpsMaxLeverage` | `useNewsShare.ts:5-7` 深 import | 分享文案 leverage 拼接 |

请求包裹形态：`{ code: number, msg: string \| null, data: T \| null }`。`code !== 0` 抛 `Error("news <endpoint> failed: code=... msg=...")`（`newsApi.ts:36-42, :64, :82, :108`）。

参数剔除：`compactSearchParams`（`newsApi.ts:24-33`）自动剔 `undefined` 与 `""`；故 `announcementType=""` 不发送、`currentField` 由 hook 层 `null → undefined` 转换。

### 三方 SDK / 浏览器 API

| # | Module | API | 用途 | file:line |
|---|---|---|---|---|
| S1 | 海报截图 | `html2canvas` | DOM → Canvas（PNG 0.95, scale 2, `useCORS:true`）| `shared/utils/capturePoster.ts:11, 38-48` |
| S2 | 海报输出 | `canvas.toBlob("image/png", 0.95)` | Blob 生成 | `capturePoster.ts:47` |
| S3 | 复制图片 | `navigator.clipboard.write(ClipboardItem)` | Copy Poster 渠道 | `useShareCapture.ts:14-24, 77-101` |
| S4 | 复制文本 | `navigator.clipboard.writeText` | Copy Link 渠道 | `useNewsShare.ts:100` + `useShareCapture.ts:106` |
| S5 | 下载海报 | `URL.createObjectURL(blob)` + `a[download]` | Download Poster 渠道 | `useShareCapture.ts:25-35` |
| S6 | 外跳 X / Telegram | `window.open(url, "_blank", "noopener,noreferrer")` | 直跳 + 预开 tab 跨 await 兼容 | `useNewsShare.ts:107-109` + `useShareCapture.ts:130-142` |
| S7 | URL 路由跳转 | `navigate(path, { replace: true })` | 币种切换 + 清 URL query | `useShareURLActionConsumer.ts:72-83, 105-106` |
| S8 | URL 解析 | `useLocation` + `URLSearchParams` | 分享 URL 接收 | `useShareURLActionConsumer.ts:55` + `shareURLActionLogic.ts:28-44` |
| S9 | 埋点上报 | `saTrackService.track()`（神策 sink + datasink sink） | `asset_detail_click` + `feeds_share_click` | 间接通过 `trackAssetDetailClick` / `trackFeedsShareClick` |
| S10 | i18n | `useTranslation("spot"/"common"/"notification")` | 3 namespace | 各组件 |

### Domain pure 函数（无副作用）

| # | 函数 | 用途 | file:line |
|---|---|---|---|
| F1 | `parseNewsListPage` | DTO → `NewsListPage` | `news/domain/normalize.ts:108-129` |
| F2 | `parseNewsPost` | DTO → `NewsPost` | `news/domain/normalize.ts:45-106` |
| F3 | `parseAnnouncementListPage` | DTO → `AnnouncementListPage` | `news/domain/normalize.ts:131-145` |
| F4 | `buildNewsShareText` | 短分享文案（title 优先）| `news/domain/shareText.ts:29` |
| F5 | `buildNewsShareJoinUrl` | 拼分享 URL（四象限）| `news/domain/shareText.ts:55-85` |
| F6 | `buildNewsFullShareText` | 完整分享文案（含 market + leverage + i18n labels + joinUrl）| `news/domain/shareText.ts:114` |
| F7 | `getAssetCategoryFromSeoName` | seoName → `crypto\|stock\|index\|commodity` | `shared/utils/getAssetCategoryFromSeoName.ts:17-24` |
| F8 | `extractTradePathFromShareQuery` | 提取 spot/futures → trade 路径 | `shareURLActionLogic.ts:46-53` |
| F9 | `mapActionToSignature` | 生成去重 signature | `shareURLActionLogic.ts:56-63` |
| F10 | `buildSearchWithoutShareActions` | 去除 share keys 的 query | `shareURLActionLogic.ts:31-44` |

---

# §1 接口层（A）

## 1.1 请求参数全表

| 端点 | 参数 | 类型 | 拼装点 |
|---|---|---|---|
| H1 list | `seoName` | string 必填 | `useNewsList.ts:47` |
| H1 list | `infoType` | `"news" \| "opinion" \| "research"` | `:48` |
| H1 list | `lang` | string? | `:25, 48` ← `useTranslation().i18n.language ?? "en"` |
| H1 list | `pageSize` | number? | `PAGE_SIZE = 20`（`:21`） |
| H1 list | `lastSortValues` | string?（JSON 数组）| `:50-52` `JSON.stringify(pageParam.lastSortValues)` |
| H1 list | `currentField` | string? | `:53` `pageParam?.currentField ?? undefined` |
| H1 list | `isOfficial` | `0 \| 1`? | `:40, 54` ← 2026-05-18 引入 |
| H2 detail | `id` (path) | string | `newsApi.ts:77` `encodeURIComponent` |
| H2 detail | `lang` (query) | string | `:78` ← `fetchNewsPostById.ts:14` |
| H3 announce | `seoName` | string | `useStockAnnouncement.ts:41` |
| H3 announce | `infoType` | 固定 `"announcement"` | `newsApi.ts:98`（硬编码）|
| H3 announce | `lang` | string? | `useStockAnnouncement.ts:42` |
| H3 announce | `pageNum` | number | `initialPageParam: 1`（`:37`）+ `getNextPageParam`（`:51-55`）|
| H3 announce | `pageSize` | number? | `PAGE_SIZE = 20`（`:19`）|
| H3 announce | `announcementType` | `"" \| "0" \| "1"` | `:45` ← `""` 由 `compactSearchParams` 剔除 |

## 1.2 Domain Types 全字段

`features/news/domain/types.ts`：

| Type | 字段 | line |
|---|---|---|
| `Cursor` | `lastSortValues, currentField` | `:6-9` |
| `MatchedAsset` | `id / name / fullName / seoName / iconUrl / kind` | `:12-18` |
| `NewsPost` | `id / title / content / category / author / authorAvatar / source / sourceLink / sourcePlatId / sector / isOfficial / isAuth / isAiGeneration / isTranslated / pinFlag / weight / releaseTime / originalLanguage / coverPicture / matchedCurrencies / matchedStocks / transferTitle / transferContent / transferOriginalContent / originalContent` | `:20-47` |
| `NewsListPage` | `items / totalCount / pageNum / pageSize / totalPage / cursor` | `:50-57` |
| `StockAnnouncement` | `id / type / publishTime / title / sourceUrl / documentUrl` | `:60-67` |
| `AnnouncementListPage` | `items / totalCount / pageNum / pageSize / totalPage` | `:70-76` |

## 1.3 Normalize 规则

| 字段 | 处理 | line |
|---|---|---|
| `title` | `stripHtmlTags(stripRedHighlight(...))` | `normalize.ts:50-51` |
| 4 个 content 类 | `paragraphizeContent(stripRedHighlight(...))` | `:53-64` |
| `coverPicture` | 空则 `extractCoverFromContent(rawContent)` | `:66-69` |
| `authorAvatar` | `"false"` 或空 → `""` | `:71-72` |
| `sector` | `null / "null" / "others"` → `""` | `:74-78` |
| `isOfficial / isAuth / isAiGeneration / pinFlag` | `=== 1` 转 bool | `:91, :92, :93, :95` |
| `isTranslated` | `(transferStatus ?? 0) >= 1` | `:94` |
| `weight` | `?? 0` raw number | `:96` |
| `releaseTime` | `toNumber(realiseTime)` → ms number | `:97`（`toNumber: :26-30`）|
| `originalLanguage` | `?? 1` | `:98` |
| `matched*` | `safeArray + parseMatchedAsset`（`type===2 → "stock"`，else `"currency"`）| `:100-105, :33-36` |
| `NewsListPage.cursor` | 仅当 `lastSortValues` 非空数组时构造，否则 `null` | `:115-122` |
| `NewsListPage.{total,pageNum,pageSize,totalPage}` | `toNumber(...)` string → number | `:125-128` |
| `StockAnnouncement.publishTime` | `toNumber` ms | `:139` |

无 price/quantity/balance 字段，无 ROUND_DOWN；时间戳统一 ms number。

## 1.4 Container Hooks（5 个）

| Hook | 签名 | 内部 | file:line |
|---|---|---|---|
| `useNewsList` | `({seoName, infoType, isOfficial?}) → InfiniteQueryResult<...>` | `useInfiniteQuery + fetchArticleList + parseNewsListPage` | `useNewsList.ts:23-72` |
| `useStockAnnouncement` | `({seoName, announcementType}) → ...` | `useInfiniteQuery + fetchStockAnnouncement + parseAnnouncementListPage` | `useStockAnnouncement.ts:21-60` |
| `useNewsTimeAgo` | `() → (ts:number) → string` | `useTranslation + formatTimeAgo` | `useNewsTimeAgo.ts:9-30` 🆕 spec 漏列 |
| `useNewsShare` | `(post, posterRef) → {joinUrl, detailRow, shareRail}` | `useReferralCodeQuery + usePerpsMaxLeverage + useShareCapture + domain builders` | `useNewsShare.ts:39-128` 🆕 spec 漏列 |
| `fetchNewsPostById`（非 hook）| `(id, lang, signal?) → Promise<NewsPost \| null>` | `fetchArticleDetail + parseNewsPost` | `fetchNewsPostById.ts:14-22` 🆕 spec 漏列 |

barrel `containers/index.ts:5-12` 仅出前 3 个；后 2 个不走 barrel。

## 1.5 QueryKey

`shared/queryKeys/index.ts:356-370`：

| key | 参数维度 | 使用点 |
|---|---|---|
| `queryKeys.news.all()` | — | `["news"]` |
| `queryKeys.news.list({seoName, infoType, locale, isOfficial?})` | 4 维 | `useNewsList.ts:36-41` ⚠ spec §4.3 漏 `isOfficial` |
| `queryKeys.news.announcement({seoName, announcementType, locale})` | 3 维 | `useStockAnnouncement.ts:32-36` |

## 1.6 缓存 + 翻页

| Hook | staleTime | enabled | nextPageParam |
|---|---|---|---|
| `useNewsList` | 30_000 ms | `!!seoName`（`:27`）| `accumulated.length >= total` 兜底（SSI pageNum 永 1）`:60-68` |
| `useStockAnnouncement` | 30_000 ms | `!!seoName`（`:57`）| `pageNum < totalPage`（`:51-55`）|

## 1.7 错误处理

无 Service 层 / 无 `handleServiceError` / 无 `mapInfraError`（grep 0）。Infra 抛 `Error` → React Query 自动捕获 → UI 用 `isError`。HTTP 401/503 走全局拦截（`shared/infra/httpClient.ts`）。

`fetchArticleDetail` 区分：`code === 0 && data === null` → 合法"未找到"返回 null；`code !== 0` → 抛错（`newsApi.ts:82-87`）。符 CLAUDE.md §8 Query 直调 Infra。

## 1.8 资产分支（接口层零分流）

所有 crypto/stock/index/commodity 共享同一 `seoName` 透传。分流在消费方：

| 派生点 | file:line |
|---|---|
| `getAssetCategoryFromSeoName(seoName)` | F7 |
| Tab 可见性 → 选 hook + infoType | `CoinInfoTabs/index.tsx:85` / `CoinInfoOverviewTabs/index.tsx:67` / `MobileMarketView.tsx:93` |

派生规则：`stocks_` → stock / `indexes_` → index / `commodities_` → commodity / else → crypto。`!seoName` → crypto 兜底。

## 1.9 历史接口残留

| spec 标"删" | grep | 状态 |
|---|---|---|
| `useNewsContext.ts` / `useOpinionAuthor.ts` / `xstockSeoMap.ts` / `buildArticleListRequest` | 0 | ✅ |
| E1 `findPage` / E2 `getCryptoStockAnnouncementData`（news 范围内）| 0 | ✅ |
| `NewsShareDialog` 整目录 / `NewsPosterCard.tsx` / `buildNewsShareText.ts` 独立文件 | 0 | ✅ |
| `SSI_COIN_TO_TICKER` / `isSsiIndex` / `sosovalueMainClient`（news 范围外）| 仍在 `features/trade/infra/api/coinInfoApi.ts:80, :1, :261, :271, :281` + `useCoinInfoQuery.ts:8, :202` | 🗑 spec 限定"News 中删"，合规 |

---

# §2 UI 主体（B，**精简版**）

## 2.1 挂载链 + 入口

| 项 | 实现 | file:line |
|---|---|---|
| PC 挂载 | NewsPanel 复用于 4 个 chartTab | `SpotTradePage.tsx:200-213` |
| Mobile 挂载 | `isNewsFamilyTab(subTab)` 守门 | `MobileMarketView.tsx:255-264` |
| NewsPanel 入口 | 4 props（`symbolInfo, activeNewsTab, marketType, isOfficial`）| `news/components/index.tsx:22-34, 43-48` 🆕 spec 仅 2 props |
| Feature export | `NewsPanel` + `openPostDetailDialog` + types | `news/index.ts:3, :9` |

## 2.2 Tab 结构（一级 7 项 union）

`CoinInfoTabKey` = `chart \| intro \| news \| opinion \| research \| announcement \| data`（`CoinInfoTabs/index.tsx:11-18`）。

| 资产 | Tabs | data tab |
|---|---|---|
| crypto | Chart / Intro / News / Opinion / Research / Data | 🆕 仅 futures 显示 |
| stock | Chart / Intro / News / Announcement / Data | 🆕 仅 futures 显示 |
| commodity / index | Chart / Intro / News / Data | spec ✅（合并）|

资产判定走 `getAssetCategoryFromSeoName(seoName)`（取代 spec 早期 `getAssetType(tags)`）`:36-56, MobileMarketView.tsx`。

Opinion `isOfficial` toggle：父级受控，仅 opinion + 勾选传 1 → searchParams（`news/components/index.tsx:80-87`）。

Announcement 子筛 All / Periodic / Others：内容内 3 button（`AnnouncementSubTabs.tsx:18-44`）。

## 2.3 列表渲染（核心字段链路）

| UI 元素 | Domain 字段 | 渲染位置 |
|---|---|---|
| 相对时间 | `releaseTime` → `useNewsTimeAgo()` | `NewsTableRow.tsx:36` / `NewsCard.tsx:41` |
| 来源 | `source` | `:39` / `:39` |
| 标题（fallback content）| `title` + `stripHtmlTags` | `:14-17` |
| 置顶徽章 | `pinFlag === true` | `:33-35` / `:33-38` |
| matched chips（仅详情弹窗）| `matchedCurrencies / matchedStocks` | `MatchedAssetChips.tsx:26-29`（**已收窄为仅当前 baseCoin 1 chip + 24h%**，🆕 spec §180 偏离）|
| coverPicture | 未单独渲染，由 SafeHtml 渲染内嵌图 | `PostDetailDialog.tsx:166-168` 🆕 偏离 spec |

## 2.4 滚动 + 状态

| 项 | 实现 | file:line |
|---|---|---|
| 无限滚动 | `useScrollLoadMore({threshold:200})` + sentinelRef | `NewsTable.tsx:35-40, :76` / `AnnouncementList.tsx:54-59, :134` |
| 回顶 reset | `useEffect([resetScrollKey]) → scrollTo({top:0})` | `NewsTable.tsx:46-48` |
| loading / error / empty / loadingMore | `<EmptyState mode="...">` + "…" 占位行 | `EmptyState.tsx:14-38` + `NewsTable.tsx:50-53, :77-79` |
| PC vs Mobile 列表分叉 | `useIsMobileScreen()` 切 NewsTableRow vs NewsCard | `NewsTable.tsx:41, :62-73` 🆕 spec 未提 NewsCard 双行卡片版 |

## 2.5 死代码 / 风格违规（汇总到 §8）

详见 §8 偏差总表。重点：
- `parts/SectorChip.tsx` + `parts/SourceAvatar.tsx` 死文件（grep 0 引用）
- 5 处裸 `<button>`（违反 `use-shared-ui.md`）
- 1 处 `lucide-react ExternalLink`（spec 要求统一 phosphor）
- `OpinionOfficialToggle` 用 `Checkbox` 而 spec 写 Switch
- 8 个 i18n 死 key（旧 NewsShareDialog 时代残留）

---

# §3 详情弹窗 + 内嵌分享（C）

## 3.1 结构 + 入口

| 项 | file:line |
|---|---|
| 单文件双内容组件 | `PostDetailDialog.tsx:57` `MobilePostDetailContent` + `:228` `PcPostDetailContent` |
| `openPostDetailDialog` 入口 | `:439` 同文件 |
| 业务调用方 | `news/components/index.tsx:102` + `useShareURLActionConsumer.ts:146` |
| `openModal / openDrawer` 全局直调 | 仅 `:14, :465, :477`（收敛）|
| Feature export | `news/index.ts:9` 仅 `openPostDetailDialog` |

## 3.2 PC/Mobile 分发 + 状态切换

| 项 | file:line |
|---|---|
| 分发 | `:464` `if (isMobileScreen())` → `:465` openDrawer / `:477` openModal |
| Drawer shell | `!p-0 !max-h-none ...`（`:471-473`）|
| Modal shell | `!w-[740px]`（`:482-483`）⚠ 数学不一致：注释 `740 = 80+22+576+22+40 = 720`，与 spec §"684" 都对不上 |
| 共用 options | `showClose: false`, `overlay: backdrop-blur-[2px]`（`:459-462`）|
| `isShareView` state | Mobile `:68` + PC `:239` |
| 进入分享态 | Mobile `:83` `setIsShareView(true)` / PC 入口 同 |
| Mobile 点空白退出 | `:113` 滚动容器 onClick + `:118` 子级 `pointer-events-none` |
| PC 退出 | `:417` Close 按钮 |

## 3.3 海报捕获

| 项 | file:line |
|---|---|
| 库 | `capturePoster.ts:33` 基于 **html2canvas**（spec 误写 `html-to-image`）|
| 参数 | `useCORS:true / allowTaint:false / scale:2 / backgroundColor:null` (`:38-48`) |
| 输出 | PNG 0.95（`:47`）|
| posterRef 挂载 | Mobile `PostDetailDialog.tsx:116` / PC `:270`，`p-5` 在容器上 |
| 调用入口 | `useShareCapture.ts:69` `capturePoster(posterRef.current)` |
| Blob 缓存 | cacheKey = `post.id`（`:54, :65`）|
| Safari 同步栈兼容 | `:14-24, :77-101` |
| 跨 await 保 user activation | `window.open + setTimeout(1500ms) 改 location.href`（`:130-142`）|

## 3.4 分享文案（domain pure）

| 函数 | 签名 / 用途 | file:line |
|---|---|---|
| `buildNewsShareText(post)` | title 优先 → `extractPlainText.slice(0,200)` → `"Check this on SoDEX"` 兜底 | `shareText.ts:29` |
| `buildNewsShareJoinUrl({referralCode, feedId, market, ...})` | 四象限 URL 拼装（见 §4.10）| `:55-85` 🆕 spec 用语 `buildJoinUrl` |
| `buildNewsFullShareText(post, referralCode, labels, {market, maxLeverage, includeJoinUrl})` | 完整文案 + market/leverage 三态拼接 + i18n labels | `:114` 🆕 spec 示例签名简化 |

## 3.5 渠道 click（DetailRow vs ShareRail 差异）

| 渠道 | DetailRow（PC 顶部 3 个）| ShareRail（5 按钮，分享视图）|
|---|---|---|
| X | `useNewsShare.ts:107, :115` `openTwitter()` 直跳 Web Intent，无图 | `:121` → `useShareCapture.ts:143`：预开 tab → 截图 → toast |
| Telegram | `:109, :116` `openTelegram()` 直跳 | `:122` → `:153` 同 X |
| Copy Link | `:98-105, :117` clipboard.writeText(fullShareText) + toast `news_share_copied` | 同左 `:125` |
| Copy Poster | n/a（DetailRow Image 走 `onPosterClick → enterShareView` 切视图）`:182, :334` | `:123` → `useShareCapture.ts:112` ClipboardItem + 降级 download |
| Download Poster | n/a | `:124` → `useShareCapture.ts:118` a[download] |
| Source（DetailRow 独有）| `DetailShareRow.tsx:42-46` window.open(post.sourceLink, ...) | n/a |

## 3.6 i18n 文案（3 namespace）

| Namespace | 关键 key |
|---|---|
| `spot` | `news_share_copied / news_share_failed / news_share_perps_intro / spot_intro / leverage / trading / generic_intro / join / news_poster_explore_more / image_downloaded(_share_x/_share_telegram) / news_tab_news/opinion/research/announcement / news_subtab_all/periodic/others / news_announcement_periodic/others / news_opinion_from_official / news_empty / news_load_failed / news_post_featured / news_ai_summarized_and_translated / source` |
| `common` | `image_copied_to_clipboard{,_share_x,_share_telegram} / copied_link_successfully / failed_to_generate_image` |
| `notification` | `failed_to_copy_link` |

死 key：`news_share_copy_link / copy_poster / download_poster / fallback_title / saved / telegram / text_template / twitter`（旧 NewsShareDialog 残留）。

---

# §4 分享 URL 重定向（D）

## 4.1 四象限 URL 格式

| Key | 类型 | 出现路由 | file:line |
|---|---|---|---|
| `feeds` | string (post.id) | `/join/:code` 或 `/trade/...` | `shareText.ts:62-64` |
| `spot` | `BTC_USDC`（underscore） | `/join/:code` 中转 | `:70-71` |
| `futures` | `BTC-USD`（hyphen） | `/join/:code` 中转 | `:70-71` |
| `invitecode` | string | `/trade/...`（JoinRedirect 写入）| `JoinRedirectPage.tsx:28` |

## 4.2 完整 URL 示例（4 象限）

```
[有 referralCode + spot]
  https://sodex.com/join/ABC123?feeds=12345&spot=BTC_USDC
    → /trade/spot/BTC_USDC?feeds=12345&invitecode=ABC123  (JoinRedirect 转 path)
    → /trade/spot/BTC_USDC                                  (Consumer 派发后 replace 清)

[有 referralCode + futures]
  https://sodex.com/join/ABC123?feeds=12345&futures=BTC-USD
    → /trade/futures/BTC-USD?feeds=12345&invitecode=ABC123

[无 referralCode + spot] 绕过中转
  https://sodex.com/trade/spot/BTC_USDC?feeds=12345

[无 referralCode + 无 market]
  https://sodex.com?feeds=12345
```

## 4.3 接收侧消费链

| 阶段 | 实现 | file:line |
|---|---|---|
| 顶层挂载 | `useShareURLActionConsumer()` | `App.tsx:51, :210`（spec §108 写 :209，⚠ 偏 1）|
| `/join/:code` 路由 | lazy Route 配置 | `App.tsx:79-80, :325`（spec 写 :322，⚠ 偏 3）|
| URL 读取 | `useLocation()` | `useShareURLActionConsumer.ts:55` |
| Action 类型 (DU) | `ShareURLAsyncAction` | `shareURLActionLogic.ts:4-7` |
| 受管 keys 全集 | `SHARE_ACTION_KEYS = ["invitecode","feeds","spot","futures"]` | `shareURLActionLogic.ts:10` |
| 提取 trade path（spot/futures） | `extractTradePathFromShareQuery` | `:46-53`（futures > spot）|
| navigate 切币种 + replace | `:72-83`：移除 spot/futures query + `replace:true` | |
| Pipeline 串行 await | `for...of + await handleShareAction` | `useShareURLActionConsumer.ts:130-136` |
| 优先级数组 | `SHARE_ACTION_PRIORITY = ["feeds","invitecode"]` | `shareURLActionLogic.ts:67-70` |
| feeds 分支 | `case "feeds":` → `fetchNewsPostById + openPostDetailDialog` | `useShareURLActionConsumer.ts:142-147` |
| 时序 | path 切换 early-return → effect 重跑接管 | `:79-82` |
| 延迟触发 | `SHARE_URL_ACTION_DELAY_MS = 100` | `:16, :95-107` |

## 4.4 去重（三道防线）

| 机制 | 实现 | file:line |
|---|---|---|
| handledSignatureRef（effect 周期内）| `mapActionToSignature` join `\|` | `:89-90` + `shareURLActionLogic.ts:56-63` |
| navigate replace 清 URL（跨刷新）| `buildSearchWithoutShareActions + replace` | `:105-106` |
| Timer 重叠保护 | timerRef cleanup + effect 先清旧 | `:62-66, :110-118` |
| JoinRedirect handledRef（once-only redirect）| `:53-57` | `JoinRedirectPage.tsx` |

## 4.5 失败兜底

| 场景 | 实现 | file:line |
|---|---|---|
| post 不存在 | `if (!post) return`（静默）| `:145` |
| 单 action 异常 | try/catch 吞错继续 | `:131-135` |
| Copy Link 失败 | `notify.error("news_share_failed")` | `useNewsShare.ts:102-104` |
| Testnet referral 不可用 | toast warn + 不写 invitecode（feeds 仍透传）| `JoinRedirectPage.tsx:59-65` |
| 空值 query 清理 | `if (!v) params.delete(k)` | `JoinRedirectPage.tsx:30-32` + `shareURLActionLogic.ts:31-33` |

## 4.6 注册机制（DU + switch 而非 plugin map）

`shareURLActionLogic.ts:4-7` DU + `useShareURLActionConsumer.ts:141-154` switch。**新增 action 类型需同步改 4 处**：union / switch / `SHARE_ACTION_PRIORITY` / `SHARE_ACTION_KEYS`。spec 未明确，建议补"新增方式"小节。

---

# §5 埋点（E-1）

## 5.1 事件 schema

| 事件 | schema | file:line |
|---|---|---|
| `asset_detail_click` | `{ $tab_title, ticker, $type }` | `shared/track/events/tradeNews.ts:26-32` |
| `feeds_share_click` | `{ ticker, $news_id, $type, channel }` | `:35-42` |
| `ChannelType` union | `"X" \| "Telegram" \| "Copy Link" \| "Copy Poster" \| "Download Poster"` | `events/types.ts:9-14` |
| `AssetCategory` re-export | crypto / stock / index / commodity | `events/types.ts:6` |
| barrel | `events/index.ts:5-6` | |

## 5.2 触发点全表

| 事件 | 触发位置 | channel/tab 值 | 状态 |
|---|---|---|---|
| `asset_detail_click` PC | `CoinInfoTabs/index.tsx:100-104` | 7 tab keys | ✅ |
| `asset_detail_click` Mobile | `MobileMarketView.tsx:106-110` | overview→intro 归一化；orderBook/trades 不上报 | 🆕 spec 仅 PC |
| `feeds_share_click` X | `DetailShareRow.tsx:60` | "X" | ✅ |
| `feeds_share_click` Telegram | `:64` | "Telegram" | ✅ |
| `feeds_share_click` Copy Link | `:68` | "Copy Link" | ✅ |
| `feeds_share_click` 5 channel（分享视图）| `ShareActions/index.tsx:74-89` wrap + `KEY_TO_CHANNEL` `:54-60` | 5 种全覆盖 | ✅ |
| onPosterClick（切换视图）| `DetailShareRow.tsx:105` | — 不上报 | ✅ 符 spec §115 |

## 5.3 参数来源

| 字段 | 来源 | file:line |
|---|---|---|
| `$tab_title` | CoinInfoTabs 入参 `key` | `:95-101` |
| `ticker`（asset_detail/share）| `symbolInfo.name`（避免 `v` 前缀）| `:102` + `news/components/index.tsx:107` |
| `$type` | `getAssetCategoryFromSeoName(symbolInfo.seoName)` | `:85` + `MobileMarketView.tsx:93` |
| `$news_id` | `post.id` | `DetailShareRow.tsx:52` / `ShareActions/index.tsx:82` |

## 5.4 防脏数据短路

- `DetailShareRow.tsx:50` `if (!ticker \|\| !type) return`
- `ShareActions/index.tsx:78` `if (!trackContext) return onClick`
- `PostDetailDialog.tsx:214, :262` trackContext 短路 `ticker && type ? {...} : undefined`
- → `useShareURLActionConsumer` 等无上下文场景静默不上报

---

# §6 海报下载（E-2）

## 6.1 实现

| 项 | 实现 | file:line |
|---|---|---|
| Click handler | `useShareCapture.ts:118-126` `handleDownload` → `getBlob() → downloadBlob` |
| 接入按钮 | `ShareActions/index.tsx:111-115`（key=`download`）|
| 上层调用 | `useNewsShare.ts:91` 传 posterRef |
| 生成机制 | `html2canvas` → `canvas.toBlob("image/png", 0.95)` |
| 文件名 | `SoDEX_YYYY-MM-DD HH_mm_ss.png`（`useShareCapture.ts:8-10`，prefix `"SoDEX"` 硬编码）|
| Blob 缓存 | cacheKey = `post.id`，cacheKey 变更清缓存（`:54, :63-72`）|

## 6.2 ❌ "无图版"功能不存在

`spec/old/download-post-without-img/README.md` 实际是 **Safari html-to-image → html2canvas 兼容性 debug 复盘**，非"无图版"功能 spec。
- 当前海报 DOM 含 `SourceAvatar` / `DetailMobileQrCard`（QR）/ 正文 / `MatchedAssetChips` / 可能内嵌 `<img>` cover
- 无任何"剥除图片"代码分支
- 如需真正"无图版" → 新需求 + 改 `PostDetailDialog` posterRef 容器结构

---

# §7 跨模块依赖图

```
features/trade/SpotTradePage / MobileMarketView
  └─ CoinInfoTabs (7 tab union; data tab 仅 futures)
       └─ NewsPanel (news/components/index.tsx)
            ├─ NewsTable / AnnouncementList
            │    └─ NewsTableRow / NewsCard / EmptyState
            ├─ useNewsList → newsClient.fetchArticleList (H1)
            ├─ useStockAnnouncement → newsClient.fetchStockAnnouncement (H3)
            └─ openPostDetailDialog (news/index.ts:9)
                 └─ PostDetailDialog
                      ├─ MobilePostDetailContent / PcPostDetailContent
                      ├─ useNewsShare
                      │    ├─ useShareCapture (shared)
                      │    │    └─ capturePoster (html2canvas)
                      │    └─ buildNewsShareJoinUrl + buildNewsFullShareText (domain)
                      └─ DetailShareRow + ShareActions → trackFeedsShareClick

features/shareURLAction (App.tsx:51, :210)
  └─ useShareURLActionConsumer
       ├─ shareURLActionLogic (DU + switch + priority)
       └─ case "feeds":
            └─ fetchNewsPostById (news barrel, H2) + openPostDetailDialog

埋点全链路
  ├─ CoinInfoTabs / MobileMarketView → trackAssetDetailClick
  └─ DetailShareRow + ShareActions → trackFeedsShareClick
       └─ shared/track/events/tradeNews.ts → saTrackService
```

---

# §8 偏差 / 死代码 / 待清理（**全量 22 项**）

## 真 bug / 数学不一致（1）

| # | 位置 | 问题 |
|---|---|---|
| B1 | `PostDetailDialog.tsx:481` PC 宽度 | 注释 `740=80+22+576+22+40` 数学=720，与 spec §"684=80+22+520+22+40" 都对不上。视觉确认 |

## 死代码 / 未挂载（3）

| # | 文件 | 状态 |
|---|---|---|
| D1 | `news/components/parts/SectorChip.tsx` | grep 0 引用 |
| D2 | `news/components/parts/SourceAvatar.tsx` | grep 0 引用 |
| D3 | i18n keys `spot.json` `news_share_{copy_link,copy_poster,download_poster,fallback_title,saved,telegram,text_template,twitter}` | 8 个旧时代残留 |

## spec 错 / 过期文档（4）

| # | 位置 | 说明 |
|---|---|---|
| S1 | `news-api-integration-new.md` §4.1 | 漏列 `useNewsTimeAgo` / `useNewsShare` / `fetchNewsPostById` 3 hook |
| S2 | `news-api-integration-new.md` §4.3 queryKey 表 | 漏 `isOfficial` 维度（§6.4 文字提了）|
| S3 | `[D]2026-05-19...md` §108 行号 | App.tsx 实测 `:210/325`，spec 写 `:209/322`（偏 1/3）|
| S4 | `useShareURLActionConsumer.ts:50` 注释 | "TODO 调 news API 待实现" 与 `:142-147` 已实现矛盾 |

## spec 用语不精确（3）

| # | 位置 | 偏差 |
|---|---|---|
| W1 | spec C 多处 `html-to-image` | 实测 `html2canvas` |
| W2 | spec C `buildJoinUrl` | 实现 `buildNewsShareJoinUrl`（功能更丰富）|
| W3 | spec B `OpinionOfficialToggle` Switch | 实现 `Checkbox`（`:5`）|

## 红线违反（2）

| # | 位置 | 红线 |
|---|---|---|
| R1 | 裸 `<button>`：`AnnouncementSubTabs.tsx:29` / `EmptyState.tsx:24` / `NewsTableRow.tsx`（role=button div）/ `PostDetailDialog.tsx:90, 99, 366, 374, 415` | `use-shared-ui.md` 要求用 shared Button |
| R2 | `lucide-react ExternalLink`（`AnnouncementList.tsx:5, 101`）| spec 要求统一 phosphor |

## spec 未提的实现增量（9）

| # | 增量 | 位置 |
|---|---|---|
| I1 | NewsPanel 4 props（spec 2 props）| `news/components/index.tsx:22-34` |
| I2 | data tab 仅 futures 显示 | `CoinInfoTabs/index.tsx` |
| I3 | NewsCard 移动端双行卡片 + Featured 徽章 | `NewsCard.tsx` |
| I4 | MatchedAssetChips 单 chip 化 + 24h% | `MatchedAssetChips.tsx:23-58` |
| I5 | Cover 图不单列（内嵌 SafeHtml）| `PostDetailDialog.tsx:166-168` |
| I6 | `getAssetCategoryFromSeoName` 统一替代 `getAssetType(tags)` | F7 |
| I7 | Mobile asset_detail_click 上报 | `MobileMarketView.tsx:106-110` |
| I8 | `buildNewsFullShareText` 支持 market + leverage + i18n labels | `shareText.ts:114` |
| I9 | `DetailMobileQrCard` PC 共用 isShareView | `PostDetailDialog.tsx:329-330` |

---

# §9 修订建议（签字前 5 项）

1. 🔴 **B1**：`PostDetailDialog.tsx:481` PC 宽度数学不一致 — 视觉测一次
2. 🟡 **S4**：`useShareURLActionConsumer.ts:50` 删过期 TODO 注释（1 行）
3. 🟡 **D1+D2+D3**：12 个死文件/死 i18n key 一次 PR 清
4. 🟡 **S1-S4 + W1-W3**：原 spec 文档已归档至 old/，无需修 — 仅本文档为真相
5. 🟡 **下载海报无图版**：`old/download-post-without-img/` 文档名误导 — 改名为 `safari-capture-debug.md` 或顶部加声明

---

# 附 — 文件位置速查表

| 关注点 | 文件 |
|---|---|
| 接口层 | `src/features/news/infra/api/newsApi.ts` |
| Domain | `src/features/news/domain/{types,normalize,shareText}.ts` |
| Hooks | `src/features/news/containers/{useNewsList,useStockAnnouncement,useNewsTimeAgo,useNewsShare,fetchNewsPostById}.ts` |
| 列表 UI | `src/features/news/components/{index,NewsTable,NewsTableRow,NewsCard,AnnouncementList,AnnouncementSubTabs,EmptyState,MatchedAssetChips,OpinionOfficialToggle}.tsx` |
| 详情弹窗 | `src/features/news/components/PostDetailDialog.tsx` |
| 详情子组件 | `src/features/news/components/parts/{DetailShareRow,DetailMobileQrCard,PinIcon,SectorChip(死),SourceAvatar(死)}.tsx` |
| Share 通用 | `src/shared/components/features/ShareActions/index.tsx` + `ShareDialog/useShareCapture.ts` |
| 海报截图 | `src/shared/utils/capturePoster.ts` |
| URL 重定向 | `src/features/shareURLAction/{containers/useShareURLActionConsumer.ts,domain/shareURLActionLogic.ts}` |
| Join 中转页 | `src/features/auth/pages/JoinRedirectPage.tsx` |
| 埋点 | `src/shared/track/events/tradeNews.ts` + `events/types.ts` |
| Tab 入口 | `src/features/trade/components/CoinInfoTabs/index.tsx` + `MobileMarketView.tsx` |
| Asset 派生 | `src/shared/utils/getAssetCategoryFromSeoName.ts` |
| queryKeys | `src/shared/queryKeys/index.ts:356-370` |

---

## 更新记录

- 2026-05-28 初始版本
