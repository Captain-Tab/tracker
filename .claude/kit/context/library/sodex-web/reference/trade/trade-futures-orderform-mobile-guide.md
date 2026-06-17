# 移动端合约下单表单

## 架构概览

```
┌──────────────────────────────────────────────────────────────────────┐
│  FuturesOrder (order/index.tsx) 69行                                 │
│  顶层容器：组合所有子组件                                              │
│                                                                      │
│  ┌─────────────────┐  ┌──────────────┐  ┌────────────────────────┐  │
│  │ EntrustTypeTab   │  │ PositionType │  │ Leverage               │  │
│  │ Market/Limit/    │  │ Cross/Isolated│  │ 10x → LeverageModal   │  │
│  │ Advanced(Pro)    │  │→MarginMode   │  └────────────────────────┘  │
│  └────────┬────────┘  └──────────────┘                               │
│           │                                                          │
│  ┌────────▼────────┐  ┌──────────────────────────────────────────┐  │
│  │ DirectionGroup   │  │ AvailableToTrade                        │  │
│  │ Buy Long /       │  │ 持仓量 + 可交易金额 + 充值入口            │  │
│  │ Sell Short       │  └──────────────────────────────────────────┘  │
│  └────────┬────────┘                                                 │
│           │                                                          │
│  ┌────────▼──────────────────────────────────────────────────────┐  │
│  │ OrderForm (orderForm/index.tsx) 55行                           │  │
│  │ 按 entrustType 路由:                                           │  │
│  │   MARKET / STOP_MARKET / TAKE_MARKET → MarketForm             │  │
│  │   LIMIT / STOP_LIMIT / TAKE_LIMIT   → LimitForm              │  │
│  │                                                                │  │
│  │  ┌─────────────────────────────────────────────────────────┐  │  │
│  │  │ LimitForm / MarketForm (react-hook-form + zod)          │  │  │
│  │  │                                                         │  │  │
│  │  │  [TriggerPrice]  (仅Pro模式)                             │  │  │
│  │  │  [PriceInput]    (仅LimitForm)                          │  │  │
│  │  │  [AmountInput + CurrencyOrderSelector]                  │  │  │
│  │  │  [Slider 0-100%]                                        │  │  │
│  │  │  [ReduceAndStops → TakeProfitStopLoss]                  │  │  │
│  │  │  [TradeButton]                                          │  │  │
│  │  │  [OrderValueFees]                                       │  │  │
│  │  └────────────────────┬────────────────────────────────────┘  │  │
│  │                       │                                        │  │
│  │                       ▼                                        │  │
│  │  usePostOrder → createOrders() → signNewOrderRequest()        │  │
│  │                  构造 BoltOrder[]   useBoltSigner 签名          │  │
│  │                                  → createFuturesOrder() API    │  │
│  └────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘

数据依赖：
  futures (MobX)  ← direction, entrustType, reduceOnly, isTakeProfitStopLoss
  futures.order   ← orderSymbolConfig, isProMode, positionSide
  futures.config  ← currentSymbolConfig, futuresLeverageBracket
  futures.position← currentPositionConf, currentPosition
  futures.computed← availableToTrade, availableToTradeMulLeverage
  trade (MobX)    ← baseCoin, quoteCoin, currencyPair
  useBoltSigner   ← signNewOrderRequest（订单签名）
```

## 核心逻辑

### 下单流程

```
用户输入价格/数量
       │
       ▼
handleSubmit (react-hook-form)
  limitForm/index.tsx L177-207 / marketForm/index.tsx L177-212
  │
  ├─ zod schema 校验（价格非空、最小金额、Pro模式触发价）
  ├─ TP/SL 错误检查
  ├─ useIsOverMaxPosition 持仓超限检查（弹窗确认）
  ├─ [市价单] triggerSlippageWarning 滑点警告
  ├─ correctMinimumAmount → 数量对齐最小步长
  └─ postOrder(origQty, price)
       │
       ▼
usePostOrder.postOrder()
  _hooks/usePostOrder.ts L81-123
  │
  ├─ vaildStopTriggerPrice() → Pro模式触发价方向校验
  ├─ notify.loading("订单提交中")
  ├─ createOrders(params) → BoltOrder[] 订单数组
  ├─ signNewOrderRequest(signParams) → { signature, nonce }
  └─ createFuturesOrder({ type:"newOrder", params, nonce, signature })
       │
       ▼
handleSuccess()
  limitForm L168-176 / marketForm L163-171
  │
  ├─ notify.success
  ├─ form.reset()
  ├─ fetchUserFuturesAccountDetails() 刷新余额
  └─ 延迟1s → eventBus.emit(ORDER_REFRESH)
```

### createOrders 订单构造

`helper.ts L23-205` 根据订单类型构造 `BoltOrder[]` 数组，三种分支：

```
createOrders(params)
  │
  ├─ 普通订单（无TP/SL，非Pro）
  │    → [{ NORMAL_ORDER, LIMIT/MARKET }]
  │
  ├─ Pro 模式（Stop/Take 委托）
  │    → [{ NORMAL_ORDER + stopPrice + ORDER_MODIFIER_STOP,
  │         STOP_LIMIT/STOP_MARKET/TAKE_LIMIT/TAKE_MARKET }]
  │
  └─ TP/SL 订单
       ├─ mode="order"（新单）
       │    → [{ BRACKET主单 }, { ATTACHED_STOP TP }, { ATTACHED_STOP SL }]
       │    // TP/SL 方向与主单反向
       └─ mode="position"（仓位单）
            → [{ STOP TP }, { STOP SL }]
            // 无主单，方向与仓位同向

clOrdID 格式: "{userId}-{timestamp}"
TP/SL 附加单前缀: "{mode}_{TP|SL}_"
```

### LimitForm vs MarketForm

| 维度 | LimitForm (488行) | MarketForm (417行) |
|------|-------------------|-------------------|
| Schema 字段 | price + amount + stop_price | amount + stop_price |
| 价格来源 | 用户输入 `inputPrice` | `latestPrice` |
| 下单价格 | 用户输入的 price | `latestPrice × (1 ± 0.01)` 浮动1% |
| 滑点检查 | 无 | `triggerSlippageWarning` 包装 |
| 价格警告 | `usePriceWarning`（买价>最新价提示） | 无 |
| Orderbook 点击 | 填充 price 输入框 | 切换到 LIMIT 模式并重发事件 |
| 按钮 disabled | price 为 0 时禁用 | 无额外禁用条件 |
| midPrice 填充 | 首次自动填入价格框 | 无（没有价格框） |

### TakeProfitStopLoss 双向计算

`_components/TakeProfitStopLoss.tsx L164-754`，核心特性：

```
价格输入 ←→ Gain/Loss 值输入（双向联动）

两种单位模式（UnitMode）:
  "percentage" → 杠杆后收益率 = (priceChange / entryPrice) × leverage × 100
  "amount"     → 盈亏金额 = (priceChange / entryPrice) × positionValue

calculateValueFromPrice()  L211-253  价格 → 值
calculatePriceFromValue()  L288-332  值 → 价格

校验规则 (getPriceValidationMessage L334-378):
  BUY(LONG):  TP价 > entryPrice, SL价 < entryPrice
  SELL(SHORT): TP价 < entryPrice, SL价 > entryPrice

两种使用场景:
  下单面板: 基于 entryPrice + positionValue 计算
  仓位弹窗: 基于 margin 直接互算（金额↔百分比）
```

### 签名流程

移动端合约使用 `useBoltSigner`（非 `useEnableTrading`），每笔订单都需签名：

```
useBoltSigner.signNewOrderRequest(params)
  → { signature, nonce }
  → createFuturesOrder({ type: "newOrder", params, nonce, signature })
```

// 与 PC 端合约不同：PC 端 `fetchCreateOrder` 无签名
// 与现货下单不同：现货用 `useSparkSigner.signNewOrderRequest`

### Hook 协作关系

```
usePostOrder ──→ createOrders() + signNewOrderRequest() + createFuturesOrder()
useValuesBySlider ──→ 滑块 ↔ 金额双向换算
useUpdateSliderByLeverage ──→ 杠杆变化时保持金额，重算滑块
useIsOverMaxPosition ──→ 检查名义价值 > maxNominalValue
useOrderListener ──→ WS推送 USER_ORDER_UPDATED → 成交通知
useListenSymbolSwitch ──→ eventBus SWITCH_SYMBOL_BY_MARKET → 重置表单
usePriceWarning ──→ 限价单价格偏离提示（仅LimitForm）
```

### EventBus 集成

| 事件 | 方向 | 触发位置 | 处理 |
|------|------|---------|------|
| ORDER_GET_ORDER_BOOK_DATUM | 监听 | Orderbook 点击 | LimitForm填价格 / MarketForm切换到LIMIT |
| ORDER_REFRESH | 发送 | 下单成功后1s | 通知其他组件刷新 |
| SWITCH_SYMBOL_BY_MARKET | 监听 | 币对切换 | 重置表单 |
| TRADE_ROUTE_CHANGED | 监听 | 路由切换 | 重置TP/SL表单 |

## 文件结构

```
src/pages/spot/main/futures/
├── index.ts                              # 导出 FuturesOrder + FuturesOverview（3行）
├── _components/
│   └── TakeProfitStopLoss.tsx            # TP/SL双向计算组件（756行）
├── _hook/
│   └── usePriceWarning.ts               # 限价单价格偏离警告（44行）
├── overview/
│   └── index.tsx                         # 合约账户概览面板（116行）
├── order/
│   ├── index.tsx                         # FuturesOrder容器（69行）
│   ├── types.ts                          # 类型定义（1行）
│   ├── _components/
│   │   ├── EntrustTypeTab.tsx            # 委托类型Tab：Market/Limit/Advanced（88行）
│   │   ├── InstTypeTab.tsx              # Spot/Futures切换（80行）
│   │   ├── AvailableToTrade.tsx         # 持仓+可交易金额（105行）
│   │   └── Guide.tsx                    # 交易指南入口（94行）
│   ├── modals/
│   │   ├── index.tsx                    # 弹窗工厂定义（38行）
│   │   ├── LeverageModal.tsx            # 杠杆调整弹窗（187行）
│   │   └── MarginMode.tsx              # Cross/Isolated切换弹窗（235行）
│   └── orderForm/
│       ├── index.tsx                    # OrderForm路由容器（55行）
│       ├── helper.ts                    # createOrders+最小金额计算（261行）
│       ├── constant.ts                  # MINIMUM_USDC_ORDER_AMOUNT=10（3行）
│       └── _components/
│           ├── TradeButton.tsx           # 下单按钮+余额不足引导（159行）
│           ├── OrderValueFees.tsx        # 订单价值+费率展示（124行）
│           ├── CurrencyOrderSelector.tsx # 基础币/USDC切换（81行）
│           ├── PositionType.tsx          # 保证金模式显示（61行）
│           ├── Leverage.tsx             # 杠杆倍数显示（57行）
│           ├── Slider.tsx               # 0-100%滑块封装（46行）
│           ├── ReduceAndStops.tsx       # ReduceOnly+TP/SL开关（100行）
│           └── forms/
│               ├── index.ts             # 导出LimitForm+MarketForm（3行）
│               ├── limitForm/
│               │   ├── index.tsx        # 限价单表单（488行）
│               │   └── schema.ts        # Zod校验schema（59行）
│               ├── marketForm/
│               │   ├── index.tsx        # 市价单表单（417行）
│               │   └── schema.ts        # Zod校验schema（53行）
│               └── _hooks/
│                   ├── usePostOrder.ts          # 签名+提交（128行）
│                   ├── useValuesBySlider.tsx     # 滑块↔金额（86行）
│                   ├── useOrderListener.ts      # WS成交通知（69行）
│                   ├── useIsOverMaxPosition.ts  # 持仓超限检查（34行）
│                   ├── useUpdateSliderByLeverage.ts # 杠杆变化更新滑块（30行）
│                   └── useListenSymbolSwitch.ts # 币对切换监听（21行）
```

## 关键设计决策

### 为什么与 PC 端合约是两套独立实现？

PC 端合约下单（`src/pages/futures/main/orderForm/`）是 1400+ 行的巨型组件，所有逻辑耦合在一起。移动端采用了更现代的架构：react-hook-form + zod 做表单管理和校验、逻辑拆分为独立 hooks、LimitForm/MarketForm 独立组件。两套实现的核心计算逻辑一致但代码不共享。

### 为什么移动端需要签名而 PC 端不需要？

移动端合约通过 `useBoltSigner.signNewOrderRequest` 每笔签名，而 PC 端 `fetchCreateOrder` 直接调用 API。这反映了两个版本接入的后端 API 不同：移动端走新版 Bolt 协议（需签名），PC 端走旧版 API。

### 为什么 Orderbook 点击在市价单中会切换到限价模式？

市价单没有价格输入框。当用户在 Orderbook 点击某个价格时，意图是以该价格下单，这在市价单中无法实现。因此 MarketForm 收到 `ORDER_GET_ORDER_BOOK_DATUM` 事件后，先切换 entrustType 为 LIMIT，再重发事件让 LimitForm 处理。

### BTC 特殊最小下单额

`getMinimumAmount()` 对 BTC 在高价时动态计算最小额（`price × 0.0001`），避免固定 10 USDC 导致最小下单量低于 BTC 的 minQty 步长。其他币种固定 10 USDC。

### 订单数组模式（BoltOrder[]）

`createOrders` 返回数组而非单个订单，因为 TP/SL 场景需要同时提交主单 + 附加止盈止损单（BRACKET + ATTACHED_STOP 模式），由后端原子执行。

## 开发修改指南

### 新增委托类型

1. `EntrustTypeTab.tsx` 添加 Tab 选项
2. `orderForm/index.tsx` 的 entrustType 路由添加映射
3. 创建新的 Form 组件（参考 limitForm/marketForm 结构）
4. 在 `schema.ts` 中定义 Zod 校验规则
5. `helper.ts` 的 `createOrders` 添加对应订单构造分支

### 修改下单参数

核心在 `helper.ts` 的 `createOrders()`。订单字段通过 `baseOrderParams`（来自 MobX store）+ 表单输入组合。签名在 `usePostOrder.ts` 的 `signNewOrderRequest` 中完成。

### 调整 TP/SL 计算

修改 `TakeProfitStopLoss.tsx` 中的 `calculateValueFromPrice`（L211-253）和 `calculatePriceFromValue`（L288-332）。注意两种场景（下单面板 vs 仓位弹窗）的计算路径不同。

### 修改最小下单额

- 固定值：`constant.ts` 的 `MINIMUM_USDC_ORDER_AMOUNT`
- 动态值：`helper.ts` 的 `getMinimumAmount()`
- 对齐步长：`helper.ts` 的 `correctMinimumAmount()`

## 与 PC 端合约下单的对比

| 维度 | 移动端（本模块） | PC端（trade-futures-orderform） |
|------|----------------|-------------------------------|
| 架构 | react-hook-form + zod + hooks 拆分 | 1400+行巨型组件 |
| 表单校验 | Zod schema 声明式 | validateForm() 命令式 |
| 签名 | useBoltSigner.signNewOrderRequest | 无签名，直接 fetchCreateOrder |
| 订单格式 | BoltOrder[]（支持BRACKET模式） | 单个 OrderParams |
| U本位/币本位 | 仅 U 本位 | FormSection + FormSectionCoinBased 双模式 |
| TP/SL | TakeProfitStopLoss 独立组件 | 内嵌在 FormSection 中 |
| Pro 模式 | 支持 Stop/Take 委托 | 支持计划委托（entrust） |
| 数量单位 | baseCoin / USDC | 张 / USDT(USD) / COIN |

## 术语表

| 术语 | 含义 |
|------|------|
| BoltOrder | 新版订单协议格式，含 clOrdID、orderType、modifier 等 |
| BRACKET | 主单+附加止盈止损的组合订单类型 |
| ATTACHED_STOP | 附加在主单上的 TP/SL 订单 modifier |
| ORDER_MODIFIER_STOP | Pro 模式的条件单 modifier |
| useBoltSigner | 新版签名 hook，每笔订单签名 |
| entrustType | 委托类型枚举：MARKET/LIMIT/STOP_LIMIT/STOP_MARKET/TAKE_LIMIT/TAKE_MARKET |
| Pro 模式 | 高级委托模式，支持 Stop/Take 条件单 |
| ReduceOnly | 仅减仓模式，限制只能平仓 |
| UnitMode | TP/SL 输入单位：percentage（百分比）/ amount（金额） |
| correctMinimumAmount | 将数量向上对齐到 minQty 步长的整数倍 |
| triggerSlippageWarning | 市价单滑点超阈值时弹出确认 |

## 更新记录

### 2026-04-07: 初始版本

初始文档，通过 /k/context learn 从代码自动生成
