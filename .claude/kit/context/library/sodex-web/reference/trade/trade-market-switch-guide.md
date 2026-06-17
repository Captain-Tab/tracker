# 币对切换与市场行情栏

## 架构概览

交易页顶部区域，包含币对选择器、市场面板和行情 Ticker 栏。存在**新版**（spot/main/switch，统一支持 Spot+Futures）和**旧版**（futures/main/switch，仅合约）两套实现。

```
┌──────────────────────────────────────────────────────────────────┐
│ 数据层                                                            │
│                                                                   │
│  ticker.ts                                                        │
│  ├─ _marketPanelList (每5秒轮询)                                   │
│  │   fetchAllMarketTickerList()                                   │
│  │   = spotTicker.fetchTickerList() + futures.tickerList.fetch()   │
│  │   → enchanceAllTickers() 合并                                   │
│  ├─ fullMarketTickers (computed)                                   │
│  │   过滤有效 symbol + 附加 leverage/tags/pathname/isCollected      │
│  ├─ collectedCoinList (localStorage 持久化)                        │
│  └─ addCollectedSymbol / removeCollectedSymbol                    │
│                                                                   │
│  trade.ts                                                         │
│  ├─ instType: SPOT | FUTURES                                      │
│  ├─ setTradeRouteParams({ instType, symbolId })                   │
│  └─ validSymbolMap (精度配置)                                      │
└────────────────────────┬──────────────────────────────────────────┘
                         ↓
┌──────────────────────────────────────────────────────────────────┐
│ 新版 Switch (spot/main/switch/)                                    │
│ 统一入口，通过 trade.instType 切换 Spot/Futures                      │
│                                                                   │
│ ┌─────────────┐  ┌──────────────────────────────────────────────┐│
│ │ Switch      │  │ Symbol                                       ││
│ │ index.tsx   │  │ - 币对名 + Spot/Futures 标签 + 杠杆倍数       ││
│ │ Symbol +    │  │ - PC: Popover 悬停展开 Market                 ││
│ │ Ticker      │  │ - Mobile: Drawer 全屏 Market                  ││
│ └─────────────┘  │ - 收藏星标 (collectedCoinList)                ││
│                  │ - document.title 同步最新价                    ││
│                  │ - 全局键盘搜索 (GLOBAL_COIN_SEARCH_KEYBOARD)   ││
│                  └──────────┬───────────────────────────────────┘│
│                             ↓                                    │
│ ┌────────────────────────────────────────────────────────────┐   │
│ │ Market 市场面板                                             │   │
│ │ - 搜索框 (实时过滤 fullMarketTickers)                       │   │
│ │ - Tab: 收藏/全部/现货/合约 + 子分类(commodities/stocks/indexes)│  │
│ │ - 排序表格 (useColumns: PC 7列 / Mobile 5列)               │   │
│ │ - USDT 搜索引导 → usdtSwapModal                           │   │
│ │ - 行点击 → setTradeRouteParams + push + emit SWITCH_SYMBOL │   │
│ └────────────────────────────────────────────────────────────┘   │
│                                                                   │
│ ┌────────────────────────────────────────────────────────────┐   │
│ │ Ticker 行情栏                                               │   │
│ │ instType === SPOT                                           │   │
│ │   PC: SpotTicker (24h涨跌/高/低/成交量)                     │   │
│ │   Mobile: FoldSpotTicker (Collapse 折叠)                    │   │
│ │ instType === FUTURES                                        │   │
│ │   PC: FuturesTicker (标记价/指数价/涨跌/成交量/OI/资金费率)  │   │
│ │   Mobile: FoldFuturesTicker (Collapse 折叠)                 │   │
│ └────────────────────────────────────────────────────────────┘   │
│                                                                   │
│ ┌────────────────────────────────────────────────────────────┐   │
│ │ LatestPrice 最新价                                          │   │
│ │ - RedGreenNum 涨跌色 + SpotPriceRate/FuturesPriceRate      │   │
│ │ - Mobile: 折叠按钮 (tradeTickersOpen)                       │   │
│ └────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│ 旧版 Switch (futures/main/switch/)                                 │
│ 仅合约页面使用，依赖 deprecatedFutures store                        │
│ - Symbol: 旧版 Popover(hover) + element-react 组件                 │
│ - Market: Tab 按 U_BASED/COIN_BASED 分类 + element-react Table     │
│ - Ticker: 标记价/指数价/高低/成交量/资金费率倒计时                    │
│ - 切换逻辑: 同 underlying → push(), 跨 underlying → location.href  │
└──────────────────────────────────────────────────────────────────┘

EventBus 事件流:
  GlobalKeyBindsForCoinSearch → GLOBAL_COIN_SEARCH_KEYBOARD → Symbol 打开市场面板
  Market 行点击 → SWITCH_SYMBOL_BY_MARKET → Symbol 关闭 Drawer + orderForm reset
  CoinCollectBanner → SWITCH_SYMBOL_BY_MARKET → 同上
```

## 核心逻辑

### 1. 市场数据聚合（Store 层）

市场面板的数据来自 `ticker.ts` 的 `fullMarketTickers` computed：

```typescript
// ticker.ts L483-496
async fetchAllMarketTickerList() {
  const [spotTickerList, futuresTickerList] = await Promise.all([
    this.rootStore.spotTicker.fetchTickerList(),
    this.rootStore.futures.tickerList.fetchTickerList(),
  ]);
  const marketPanelList = enchanceAllTickers(
    enchanceSpotTickers(spotTickerList),
    enchanceFuturesTickers(futuresTickerList),
  );
  this._setMarketPanelList(marketPanelList);
}

// 每 5 秒轮询
_loopFetchMarketPanelList() {           // ticker.ts L473-480
  await this.fetchAllMarketTickerList();
  this._marketPanelListTimer = setTimeout(() => this._loopFetchMarketPanelList(), 5000);
}
```

`fullMarketTickers` computed（L377-419）在原始数据基础上附加：
- `isCollected`: 是否被用户收藏
- `leverage`: 最大杠杆倍数（从 leverageBracketList 查）
- `pricePrecision`: 价格精度
- `routeSymbol` / `pathname`: 路由路径
- `tags`: 分类标签（commodities/stocks/indexes）
- `displayName`: 显示名称

### 2. 市场面板搜索与过滤

市场面板（`spot/switch/market/index.tsx L56-343`）提供多层过滤：

```
fullMarketTickers
    ↓ searchValue 模糊搜索（symbol 包含匹配）
filteredMarketTickers
    ↓ tabActiveKey 分类过滤
marketViewList
    ↓ 搜索激活时按 spot/futures 分组展示
marketDataSource → Table 渲染
```

**Tab 分类**：
- `collect`: 收藏列表 (`isCollected`)
- `all`: 全部
- `spot`: 现货 (`instType !== "futures"`)
- `futures`: 合约 (`instType === "futures"`)
- `commodities/stocks/indexes`: 子分类，基于 `tags` 字段过滤

**标签分类系统**（`marketCategory.ts`）：

```typescript
export const MARKET_SUBCATEGORY_CONFIG = {
  commodities: { name: () => i18n.t("common:commodities"), tag: "commodities" },
  stocks:      { name: () => i18n.t("common:stocks"),      tag: "stocks" },
  indexes:     { name: () => i18n.t("common:indexes"),     tag: "indexes" },
};

// 过滤器：检查 ticker.tags 是否包含对应 tag
export const getSubCategoryFilter = (key) => {
  const tag = MARKET_SUBCATEGORY_CONFIG[key].tag;
  return (item) => item.tags?.includes(tag) ?? false;
};
```

### 3. USDT 搜索引导

当搜索框输入 "USDT"（大小写不敏感）时，不展示空结果，而是显示 USDT → USDC 转换引导：

```typescript
// market/index.tsx L139
const isUsdtSearch = searchValue.trim().toLowerCase() === "usdt";
// → 渲染 USDT→USDC 图标 + "Swap to USDC to start trading" + Swap Now 按钮
// → 点击打开 usdtSwapModal
```

### 4. 币对切换路由

**新版**（`market/index.tsx L168-189`）：

```typescript
const rowHandleClick = (record) => {
  setTradeRouteParams({
    instType: record.instType as InstTypeEnum,
    symbolId: record.routeSymbol,
  });
  push(record.pathname);  // /trade/spot/xxx 或 /trade/futures/xxx
  if (!record.isCurrent) {
    eventBus.emit(EventNames.SWITCH_SYMBOL_BY_MARKET, {
      symbol: record.s,
      instType: record.instType === "futures" ? InstTypeEnum.FUTURES : InstTypeEnum.SPOT,
    });
  }
};
```

**旧版**（`futures/switch/market/index.tsx L96-108`）：

```typescript
const rowHandleClick = (record) => {
  const { s, underlyingType } = record;
  if (currentUnderlying === underlyingType) {
    push(`/futures/contract/${underlyingType?.toLowerCase()}/${s}`);  // SPA 跳转
  } else {
    window.location.href = `/futures/contract/...`;  // 跨 underlying 硬刷新
  }
};
```

### 5. 全局键盘搜索

`GlobalKeyBindsForCoinSearch` 组件监听键盘事件，emit `GLOBAL_COIN_SEARCH_KEYBOARD`，Symbol 组件接收后打开市场面板：

```typescript
// symbol/index.tsx L138-151
eventBus.on(EventNames.GLOBAL_COIN_SEARCH_KEYBOARD, () => {
  setAnchorEl(searchAnchorRef.current);  // 打开 Popover
});
// 移动端还监听 SWITCH_SYMBOL_BY_MARKET 关闭 Drawer
eventBus.on(EventNames.SWITCH_SYMBOL_BY_MARKET, () => {
  NiceModal.hide("market-drawer");
});
```

### 6. 行情 Ticker 栏

Ticker 按 instType 和设备类型展示不同指标：

**现货 Ticker**（SpotTicker/FoldSpotTicker）：
- 24h 涨跌幅、24h 最高/最低、24h 成交量

**合约 Ticker**（FuturesTicker/FoldFuturesTicker）：
- 标记价（Mark Price，带 Tooltip 解释用途）
- 指数价（Index Price，带 Tooltip 解释来源）
- 24h 涨跌（绝对值+百分比）
- 24h 成交量、持仓量（Open Interest）
- 资金费率+倒计时（FundingCountDown，倒计时结束后自动刷新）

**移动端折叠**：通过 `ui.tradeTickersOpen` 控制 MUI Collapse 展开/收起，LatestPrice 组件中有折叠按钮。

### 7. document.title 同步

Symbol 组件将最新价同步到浏览器标签页标题：

```typescript
// symbol/index.tsx L181-197
document.title = `${latestPrice} | ${tradingLabel} | SoDEX`;
// 同时更新 meta description
descriptionMeta.setAttribute("content", `${pairName} ${tradingType} Trading...`);
```

### 8. 收藏功能

收藏列表存储在 `ticker.collectedCoinList`（localStorage 持久化）：
- 新版：通过 `ticker.addCollectedSymbol/removeCollectedSymbol` 操作
- 旧版：登录用户调用 API（`fetchAddCollection/fetchCancelCollection`），未登录用户本地存储

### 9. 表格列配置

`useColumns` hook 返回 PC/移动端不同列配置：

| 列 | PC | Mobile | 排序 |
|----|-----|--------|------|
| 收藏星标 | ✅ | ✅ | ❌ |
| 币对名 + 标签 | ✅ | ✅ | ❌ |
| 最新价 | ✅ | ✅(合并) | ✅ |
| 24h 涨跌 | ✅ | ✅(合并) | ✅ |
| 8h 资金费率 | ✅(非现货Tab) | ❌ | ✅ |
| 24h 成交量 | ✅ | ✅ | ✅ |
| 持仓量 OI | ✅(非现货Tab) | ✅(非现货Tab) | ✅ |

移动端将"最新价"和"24h 涨跌"合并为一列垂直排列。

## 文件结构

### 新版 spot/main/switch（13 文件）

| 文件 | 行数 | 职责 |
|------|------|------|
| `switch/index.tsx` | 27 | 入口，组合 Symbol + Ticker |
| `switch/symbol/index.tsx` | 324 | 币对选择器，Popover/Drawer/收藏/搜索/title 同步 |
| `switch/symbol/LatestPrice.tsx` | 96 | 最新价展示 + 移动端折叠按钮 |
| `switch/market/index.tsx` | 346 | 市场面板，搜索+Tab+表格+USDT引导 |
| `switch/market/marketCategory.ts` | 45 | 子分类配置(commodities/stocks/indexes) |
| `switch/market/useColumns.tsx` | 358 | PC/移动端表格列定义 |
| `switch/ticker/index.tsx` | 46 | Ticker 容器，按 instType 切换 |
| `switch/ticker/SpotTicker.tsx` | 60 | 现货行情指标 |
| `switch/ticker/FuturesTicker.tsx` | 205 | 合约行情指标（含标记价/OI/资金费率） |
| `switch/ticker/FoldSpotTicker.tsx` | 79 | 移动端折叠版现货 Ticker |
| `switch/ticker/FoldFuturesTicker.tsx` | 195 | 移动端折叠版合约 Ticker |
| `switch/ticker/FundingCountDown.tsx` | 73 | 资金费率 + 倒计时 |
| `switch/maintenance/index.tsx` | 34 | 系统维护中占位页 |

### priceRate（1 文件）

| 文件 | 行数 | 职责 |
|------|------|------|
| `priceRate/index.tsx` | 116 | 涨跌价格显示（SpotPriceRate + FuturesPriceRate） |

### 旧版 futures/main/switch（5 文件）

| 文件 | 行数 | 职责 |
|------|------|------|
| `futures/switch/index.tsx` | 18 | 入口 |
| `futures/switch/symbol/index.tsx` | 95 | 旧版币对选择器（Popover hover） |
| `futures/switch/market/index.tsx` | 218 | 旧版市场面板（U_BASED/COIN_BASED Tab） |
| `futures/switch/ticker/index.tsx` | 167 | 旧版行情指标栏 |
| `futures/switch/maintenance/index.tsx` | 40 | 旧版维护页 |

## 关键设计决策

### 新旧版为什么共存？

新版（`spot/main/switch/`）是重写的统一实现，通过 `trade.instType` 动态切换 Spot/Futures 内容。旧版（`futures/main/switch/`）使用 `deprecatedFutures` store + element-react 组件，是遗留代码。新版的市场面板合并了现货和合约到同一个表格，旧版按 U_BASED/COIN_BASED 分 Tab。

### 为什么搜索 USDT 要特殊处理？

SoDEX 以 USDC 为报价币种，不支持 USDT 交易对。用户搜索 USDT 时直接给出 Swap 入口，避免"无结果"的困惑体验。

### 标签分类系统的设计

使用 symbolConfig 的 `tags` 字段（服务端下发）进行分类，而非前端硬编码映射。新增分类只需在 `MARKET_SUBCATEGORY_CONFIG` 添加条目 + 服务端配置对应 tag，无需修改过滤逻辑。

### 移动端折叠设计

移动端空间有限，Ticker 栏默认折叠，用户点击 LatestPrice 旁的箭头展开/收起（`ui.tradeTickersOpen`），使用 MUI Collapse 动画。

## 开发修改指南

### 添加新的市场子分类
→ `marketCategory.ts` 的 `MARKET_SUBCATEGORY_CONFIG` 添加条目，自动生成 Tab + 过滤逻辑

### 修改表格列
→ `useColumns.tsx`，注意 `desktopColumns` 和 `mobileColumns` 需要分别修改，`hidden` 属性可按 `marketTabKey` 条件隐藏

### 添加新的 Ticker 指标
→ 现货: `SpotTicker.tsx` + `FoldSpotTicker.tsx`（折叠版需同步）
→ 合约: `FuturesTicker.tsx` + `FoldFuturesTicker.tsx`

### 修改币对切换行为
→ 新版: `market/index.tsx` 的 `rowHandleClick`，注意 `SWITCH_SYMBOL_BY_MARKET` 事件的下游消费者（orderForm reset、Drawer 关闭）

### 注意事项
- 旧版 futures/switch 使用 `deprecatedFutures` store，修改前确认是否仍被使用
- `fullMarketTickers` 是 computed 属性，依赖 `_marketPanelList`（5s 轮询），不要在组件中频繁触发重计算
- 收藏列表新旧版存储方式不同：新版 localStorage 直接操作，旧版登录用户走 API

## 术语表

| 术语 | 含义 |
|------|------|
| instType | 交易类型：SPOT（现货）/ FUTURES（合约） |
| fullMarketTickers | 合并现货+合约的完整市场 ticker 列表 |
| MarketTabKey | 市场面板 Tab 标识：collect/all/spot/futures/子分类 |
| MarketSubCategoryKey | 子分类标识：commodities/stocks/indexes |
| SWITCH_SYMBOL_BY_MARKET | 币对切换事件，触发 Drawer 关闭和 orderForm 重置 |
| GLOBAL_COIN_SEARCH_KEYBOARD | 全局键盘搜索事件，触发市场面板打开 |
| tradeTickersOpen | 移动端 Ticker 折叠状态 |
| collectedCoinList | 用户收藏的币对列表（localStorage 持久化） |
| underlying | 合约底层类型：U_BASED（U本位）/ COIN_BASED（币本位） |
| fundingRate | 资金费率，合约独有，定时收取 |

## 更新记录

### 2026-04-09: 初始版本

初始文档，通过 /k/context learn 从代码自动生成
