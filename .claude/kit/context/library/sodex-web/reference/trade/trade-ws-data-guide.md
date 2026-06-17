# 交易页 WebSocket 数据管道

## 架构概览

交易页实时数据层，管理 5 条 WebSocket 连接，处理深度/成交/行情/用户事件推送，500ms 聚合刷新。

```
                        useTradeDataHandler（总编排）
                        ┌─────────────────────────────────┐
                        │                                 │
   ┌────────────────────┼──────────────────┐              │
   ↓                    ↓                  ↓              │
useSpotWS           useFuturesWS       useUserWS          │
Handler              Handler           (listenKey)        │
   │                    │                  │              │
   │  解析 resType      │  解析 channel    │              │
   │  qDeal/qDepth/     │  push.deep/      │              │
   │  qAllDepth/uTrade/ │  push.deal/      │              │
   │  uOrder/uBalance/  │  agg.ticker/     │              │
   │  qStats            │  funding.rate/   │              │
   │                    │  index/mark.price│              │
   │                    │  user.*          │              │
   └────────┬───────────┘                  │              │
            ↓                              │              │
   useDataAggregator                       │              │
   ┌──────────────────┐                    │              │
   │ 500ms setInterval │                    │              │
   │ depthRef → batch  │                    │              │
   │ dealRef  → batch  │                    │              │
   │ tickerRef→ batch  │                    │              │
   └────────┬─────────┘                    │              │
            ↓                              │              │
   Store 批量更新                           │              │
   ┌──────────────────────────────────────┐│              │
   │ spot.setDepthDataByWS()  增量合并深度 ││              │
   │ spot.setDealDataByWS()   追加成交     ││              │
   │ spotTicker.setSymbolTickerByWS()     ││              │
   └──────────────────────────────────────┘│              │
                                           │              │
   useFuturesUserWsEvent ←─── user.* ─────┘              │
   ┌──────────────────────────────────────┐               │
   │ TypedEventEmitter: 5 种 user 事件    │               │
   │ → fetchBalance / fetchPosition /     │               │
   │   fetchOrder / fetchPositionConfs    │               │
   └──────────────────────────────────────┘               │
                                                          │
   useSpotDataInitializer ←───────────────────────────────┘
   ┌──────────────────────────────────────┐
   │ HTTP 初始化: symbolConfigList        │
   │ WS 订阅: emitAboutSymbol/Market     │
   │ 合约初始化: getFuturesSymbolList     │
   └──────────────────────────────────────┘

   useDepthMerge ←────────────────────────────────────────┘
   ┌──────────────────────────────────────┐
   │ localStorage → depthMerge 精度恢复   │
   └──────────────────────────────────────┘
```

### 5 条 WebSocket 连接

| 连接 | Store 属性 | 协议 | 用途 |
|------|-----------|------|------|
| symbolSocket | spot.symbolSocket | Spot WS | 当前币对 depth(qDepth/qAllDepth) |
| marketSocket | spot.marketSocket | Spot WS | 当前币对 deal(qDeal) + stats(qStats) |
| futuresMarketSocket | spot.futuresMarketSocket | Futures WS | 合约 depth/deal/ticker/funding/index/mark |
| userSocket | spot.userSocket | Spot WS | 现货用户事件(uTrade/uOrder/uBalance) |
| futuresUserSocket | spot.futuresUserSocket | Futures WS | 合约用户事件(user.*) |

### 消费入口

| 组件 | 路径 | 说明 |
|------|------|------|
| spot/main/index.tsx | src/pages/spot/main/index.tsx:101 | 新版交易页（Spot+Futures 统一） |
| TradeDataLoader | src/components/tradeDataLoader/index.tsx | 移动端，阻塞渲染直到 symbolConfigList 就绪 |

## 核心逻辑

### 1. 消息解析

#### 现货 resType（useSpotWebSocketHandler L21-92）

```typescript
// src/pages/spot/main/hooks/useTradeData/useSpotWebSocketHandler.ts
const handleSpotMessage = useCallback((wsResponse: any) => {
  const { resType, data } = wsResponse;

  switch (resType) {
    case "qDeal":    return { type: 'deal', data };       // → 聚合器
    case "qDepth":   return { type: 'depth', data };      // → 聚合器（经 canInsertDepth 校验）
    case "qAllDepth": setDepthData({ ...data });           // → 直接写 store（50 档全量快照）
    case "qStats":   return { type: 'stats', data };      // → 聚合器
    case "uTrade":   fetchBalanceList(); ORDER_REFRESH;    // → 副作用
    case "uOrder":   fetchOrderList();                     // → 副作用
    case "uBalance": fetchBalanceList();                   // → 副作用
  }
}, [...]);
```

| resType | 数据流向 | 说明 |
|---------|---------|------|
| qDeal | → aggregator.addDealData | 逐笔成交 |
| qDepth | → canInsertDepth 校验 → aggregator.addDepthData | 单档增量深度，m=1买/m=2卖 |
| qAllDepth | → spot.setDepthData（跳过聚合器） | 50 档全量快照，直接覆盖 |
| qStats | → aggregator.addTickerData | 行情统计 |
| uTrade | → fetchBalanceList + ORDER_REFRESH 事件 | 用户成交通知 |
| uOrder | → fetchOrderList（延迟 10s） | 用户订单变更 |
| uBalance | → fetchBalanceList | 用户余额变更 |

#### 合约 channel（useFuturesWebSocketHandler L20-119）

```typescript
// src/pages/spot/main/hooks/useTradeData/useFuturesWebSocketHandler.ts
const handleFuturesMessage = useCallback((wsResponse: any) => {
  const { channel, data } = wsResponse;

  switch (channel) {
    case "push.deep":       return { type: "depth", data };     // → 聚合器
    case "push.deep.full":  return { type: "depthFull", data }; // → spot.setDepthData
    case "push.agg.ticker": setFuturesTickerByWS(data);         // → 直接写 store
    case "push.funding.rate": config.setFundingRate(...);        // → 直接写 store
    case "push.index.price":  ticker.setIndexPrice(data.p);     // → 直接写 store
    case "push.mark.price":   ticker.setMarkPrice(data.p);      // → 直接写 store
    case "push.deal":       return { type: "deal", data };      // → 聚合器
    case "user.order":      ORDER_REFRESH 事件;                 // → 副作用
  }
  // 所有 user.* 开头的 channel → futuresUserWsDataEvent.emit
  if (channel.startsWith("user.")) {
    futuresUserWsDataEvent.emit(channel, data);
  }
}, [...]);
```

| channel | 数据流向 | 说明 |
|---------|---------|------|
| push.deep | → aggregator（经 canInsertDepth） | 单档增量，ba=1买/ba=2卖 |
| push.deep.full | → spot.setDepthData | 全量快照 |
| push.agg.ticker | → futures.ticker + tickerList | 行情聚合 |
| push.funding.rate | → futures.config.setFundingRate | 资金费率+下次收取时间 |
| push.index.price | → futures.ticker.setIndexPrice | 指数价格 |
| push.mark.price | → futures.ticker.setMarkPrice | 标记价格 |
| push.deal | → aggregator.addDealData | 逐笔成交 |
| user.* | → futuresUserWsDataEvent | 分发到合约用户事件总线 |

### 2. 数据聚合器（useDataAggregator L5-74）

```typescript
// src/pages/spot/main/hooks/useTradeData/useDataAggregator.ts
const startAggregation = useCallback((
  setDepthDataByWS, setDealDataByWS, setSymbolTickerByWS,
  interval = 500  // 500ms 批量刷新
) => {
  mapTimerRef.current = mySetInterval(() => {
    setDepthDataByWS({ ...depthDataRef.current });
    setDealDataByWS([...dealDataRef.current]);
    if (setSymbolTickerByWS) setSymbolTickerByWS({ ...tickerMapRef.current });
    // 重置 buffer
    depthDataRef.current = { u: "-1", s: "", b: [], a: [] };
    dealDataRef.current = [];
    tickerMapRef.current = {};
  }, interval);
}, []);
```

聚合器设计要点：
- **addDepthData** 直接覆盖 ref（最新一帧即可，不累积）
- **addDealData** unshift 到数组头部（保留时序）
- **addTickerData** 按 symbol 存 map（同 symbol 覆盖）
- 每 500ms 将 buffer 批量刷到 store，然后清空

### 3. canInsertDepth 序列号校验（spot.ts L397）

```typescript
// src/models/spot.ts
canInsertDepth(u: string) {
  return new BigNumber(u).gt(this.depthData.u);
}
```

防止乱序深度数据覆盖新数据。只有序列号 > 当前值时才接收。

### 4. setDepthDataByWS 增量合并（spot.ts L524-569）

```typescript
// src/models/spot.ts
setDepthDataByWS(data: DepthData) {
  // 校验 symbol 匹配
  if (currentSymbolIdentity !== newS) return;
  // 新旧档位按价格合并（同价覆盖）
  [...a, ...newA].forEach(item => tempAObj[item[0]] = item[1]);
  [...b, ...newB].forEach(item => tempBObj[item[0]] = item[1]);
  // 过滤 qty=0 + 排序（卖盘升序/买盘降序）
  this.setDepthData({
    a: Object.entries(tempAObj).filter(qty > 0).sort(升序),
    b: Object.entries(tempBObj).filter(qty > 0).sort(降序),
  });
}
```

深度数据经过两层处理：
1. **聚合器层**：500ms 内只保留最后一帧增量
2. **Store 层**：新旧档位按价格合并，qty=0 的档位被移除

### 5. 合约用户事件总线（futuresUserEvent.ts）

```typescript
// src/pages/spot/main/hooks/useTradeData/futuresUserEvent.ts
enum FutureUserEventNames {
  USER_BALANCE_UPDATED  = "user.balance",      // → fetchUserFuturesAccountDetails
  USER_POSITION_UPDATED = "user.position",      // → fetchPositionList
  USER_POSITION_CONF_UPDATED = "user.position.conf", // → fetchFuturesPositionConfs
  USER_TRADE_UPDATED    = "user.trade",         // → console.log（暂无处理）
  USER_ORDER_UPDATED    = "user.order",         // → fetchFuturesOrderList + fetchAccountDetails
}
```

使用 TypedEventEmitter（基于 eventemitter3），WS channel 名直接映射为事件名。
useFuturesUserWsEvent (L11-73) 订阅这 5 个事件，触发对应 API 刷新。

### 6. 用户 WS 连接管理（useUserWebSocket L4-62）

```typescript
// src/pages/spot/main/hooks/useTradeData/useUserWebSocket.ts
// 1. userId 存在 → 创建 socket + 获取 listenKey
if (userId) {
  createUserSocket();
  fetchAlwaysSportListenKey();    // 现货 listenKey
  fetchFuturesListenKey(userId);  // 合约 listenKey
}
// 2. listenKey 就绪 → 订阅用户频道
if (alwaysSportListenKey && userSocket) {
  userSocket.emitAboutUser(alwaysSportListenKey);
}
if (futuresListenKey && futuresUserSocket) {
  futuresUserSocket.emitAboutUser(futuresListenKey);
}
// 3. 未登录 → 从 localStorage 恢复收藏列表
```

### 7. WS 订阅生命周期（useSpotDataInitializer L72-150）

```typescript
// src/pages/spot/main/hooks/useTradeData/useSpotDataInitializer.ts
// 现货
if (spotSymbol && instType === SPOT) {
  symbolSocket.emitAboutSymbol(spotSymbol);  // 订阅 depth
  marketSocket.emitAboutMarket(spotSymbol);  // 订阅 deal+stats
}
// 合约
if (futuresSymbol && instType === FUTURES) {
  futuresMarketSocket.emitAboutSymbol(futuresSymbol);
  futuresMarketSocket.emitAboutMarket(futuresSymbol);
}
// cleanup: unEmitAboutSymbol / unEmitAboutMarket
```

币对切换时自动取消旧订阅、建立新订阅。依赖 `trade.currentValidSymbolMap` 变化触发。

### 8. WS 监听绑定（useTradeDataHandler L118-181）

总编排在 `useTradeDataHandler` 中完成：

```
现货路径: symbolSocket.onClient("message", spotMessageCallback)
         marketSocket.onClient("message", spotMessageCallback)
合约路径: futuresMarketSocket.onClient("message", futuresMessageCallback)
用户路径: userSocket.onClient("message", spotMessageCallback)
         futuresUserSocket.onClient("message", futuresMessageCallback)
```

注意：现货 deal 数据的获取有顺序要求 — `fetchDealData` 完成后才绑定 marketSocket 监听，确保初始 HTTP 数据先于 WS 增量数据。

### 9. 深度精度恢复（useDepthMerge L4-22）

```typescript
// src/pages/spot/main/hooks/useTradeData/useDepthMerge.ts
const depthMerge = localStorage.getItem("depthMerge")[symbolId]
  || currentSymbolDepthPrecisionMergeList[0].value;
setDepthMerge(depthMerge || 1);
```

从 localStorage 恢复用户上次选择的深度合并精度，若无记录则使用第一档默认值。

## 文件结构

```
src/pages/spot/main/hooks/useTradeData/
├── index.ts                          # 导出入口
├── useTradeDataHandler.ts    (191行)  # 总编排：组合子Hook + WS监听绑定
├── useDataAggregator.ts      (75行)   # 500ms聚合器：缓冲→批量刷store
├── useDepthMerge.ts          (23行)   # 深度合并精度恢复（localStorage）
├── useSpotDataInitializer.ts (173行)  # HTTP初始化 + WS订阅管理
├── useSpotWebSocketHandler.ts(96行)   # 现货WS消息解析（7种resType）
├── useFuturesWebSocketHandler.ts(123行) # 合约WS消息解析（8种channel）
├── useFuturesUserWsEvent.ts  (76行)   # 合约用户事件监听→API刷新
├── futuresUserEvent.ts       (92行)   # TypedEventEmitter定义（5种事件）
└── useUserWebSocket.ts       (63行)   # 用户WS连接：listenKey获取+订阅

src/components/tradeDataLoader/
└── index.tsx                 (48行)   # 数据加载器，阻塞渲染直到配置就绪
```

## 关键设计决策

1. **500ms 聚合器而非直接刷 Store**：WS 推送频率极高（深度可达每秒数十次），若每条消息都触发 MobX reaction + React re-render，会导致严重卡顿。聚合器将高频数据缓冲在 ref 中，每 500ms 批量刷一次 store。

2. **深度数据只保留最后一帧**：`addDepthData` 直接覆盖 ref 而非追加。因为深度是状态型数据（最新一帧即完整），不是事件型数据。

3. **现货/合约统一管道**：新版交易页（spot/main）同时处理 Spot 和 Futures 的 WS 数据。合约页（futures/main）已废弃独立的 WS 处理，复用此管道。

4. **合约 user.* 走独立事件总线**：合约用户推送种类多（balance/position/position.conf/trade/order），用 TypedEventEmitter 解耦，避免在主消息处理中嵌套大量 if。

5. **fetchDealData 先于 WS 绑定**：确保 HTTP 获取的初始成交数据先于 WS 增量数据到达，避免空窗期。

6. **TradeDataLoader 阻塞渲染**：移动端使用，等 symbolConfigList 加载完才渲染子组件，避免子组件读到空配置。

## 开发修改指南

| 场景 | 修改入口 |
|------|---------|
| 新增现货 WS 消息类型 | useSpotWebSocketHandler.ts switch 新增 case |
| 新增合约 WS 频道 | useFuturesWebSocketHandler.ts switch 新增 case |
| 新增合约用户事件 | futuresUserEvent.ts 加枚举 + useFuturesUserWsEvent.ts 加监听 |
| 修改聚合间隔 | useDataAggregator.ts `interval` 参数（默认 500ms） |
| 新增聚合数据类型 | useDataAggregator.ts 加新 ref + add/flush 逻辑 |
| 修改深度序列号校验 | spot.ts canInsertDepth |
| 修改深度合并逻辑 | spot.ts setDepthDataByWS |
| 新增 WS 连接 | spot model 中创建 socket 实例 + useTradeDataHandler 中绑定监听 |

## 术语表

| 术语 | 含义 |
|------|------|
| resType | 现货 WS 消息类型标识（qDeal/qDepth/qAllDepth/uTrade/uOrder/uBalance/qStats） |
| channel | 合约 WS 频道标识（push.deep/push.deal/push.agg.ticker 等） |
| listenKey | 用户 WS 鉴权 token，分现货(alwaysSportListenKey)和合约(futuresListenKey) |
| emitAboutSymbol | 订阅指定币对的深度数据 |
| emitAboutMarket | 订阅指定币对的成交+行情数据 |
| emitAboutUser | 使用 listenKey 订阅用户私有频道 |
| canInsertDepth | 序列号递增校验，防止乱序深度覆盖 |
| setDepthDataByWS | Store 层增量合并：新旧档位按价格去重 + qty=0 过滤 + 排序 |
| futuresUserWsDataEvent | 合约用户事件总线实例（TypedEventEmitter） |
| contractSize | 合约面值，合约 WS 处理的前置条件 |

## 更新记录

### 2026-04-09: 初始版本

初始文档，通过 /k/context learn 从代码自动生成
