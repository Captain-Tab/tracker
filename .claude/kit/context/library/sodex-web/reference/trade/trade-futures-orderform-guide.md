# 合约下单表单

## 架构概览

```
┌──────────────────────────────────────────────────────────────────┐
│  OrderForm (index.tsx) 170行                                     │
│  容器：按 isUBased 切换 U本位/币本位表单                            │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ 顶部工具栏                                                  │  │
│  │ [逐仓/全仓] [单向/双向] [杠杆 xxX]  [资金费率] [计算器]       │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌─────────────────┐  ┌──────────────────────────────────────┐  │
│  │ EntrustTypeTab   │  │ TradeTypeGroup                      │  │
│  │ LIMIT / MARKET   │  │ OPEN / CLOSE（Tab已注释，默认OPEN）  │  │
│  └────────┬────────┘  └──────────┬───────────────────────────┘  │
│           │                      │                               │
│  ┌────────▼──────────────────────▼───────────────────────────┐  │
│  │                    isUBased ?                              │  │
│  │         ┌──────────────┐  ┌──────────────────┐            │  │
│  │         │ FormSection  │  │FormSectionCoinBased│           │  │
│  │         │ U本位 1443行  │  │ 币本位 1489行      │           │  │
│  │         └──────┬───────┘  └────────┬──────────┘           │  │
│  │                └────────┬──────────┘                       │  │
│  │                         ▼                                  │  │
│  │  ┌──────────┐  ┌────────────┐  ┌───────────────┐         │  │
│  │  │PriceInput│  │NumberInput │  │ Slider 0-100% │         │  │
│  │  │(限价/计划)│  │+ 单位切换  │  │ 百分比控制     │         │  │
│  │  └────┬─────┘  └─────┬──────┘  └───────┬───────┘         │  │
│  │       │              │                 │                   │  │
│  │       ▼              ▼                 ▼                   │  │
│  │  ┌─────────────────────────────────────────────────────┐  │  │
│  │  │ validateForm() → tradeHandleClick() → createOrder() │  │  │
│  │  │  价格/数量校验     二次确认+参数构建    API提交       │  │  │
│  │  └─────────────────────────────────────────────────────┘  │  │
│  │                                                           │  │
│  │  ┌──────────────┐  ┌──────────────┐                       │  │
│  │  │ OpenPosition │  │ClosePosition │                       │  │
│  │  │ 买入开多      │  │ 买入平空      │                       │  │
│  │  │ 卖出开空      │  │ 卖出平多      │                       │  │
│  │  └──────────────┘  └──────────────┘                       │  │
│  └───────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘

数据依赖：
  ticker (MobX)             ← currentSymbolIdentity, latestPrice, availablePrice
  deprecatedFutures (MobX)  ← userCurrentSymbolConfig, positionConf, leverage
  underlying (MobX)         ← isUBased（U本位/币本位分支）
  order (MobX)              ← fetchCreateOrder, fetchCreatePlan
  position (MobX)           ← 持仓数据
  useUnit hook              ← currentUnit2Sheet / sheet2CurrentUnit（单位转换）
  useOpenPositionCalculator ← 保证金与最大可开量计算
```

## 核心逻辑

### 下单流程

用户操作到订单提交的完整路径（以 U 本位 FormSection 为例，币本位流程同构）：

```
用户输入价格/数量
       │
       ▼
tradeHandleClick({orderSide, positionSide})
  formSection/index.tsx L1058-1153（U本位）
  formSectionCoinBased/index.tsx L1105-1201（币本位）
  │
  ├─ validateForm(orderSide) → 校验失败则 return
  ├─ isConfirmAgain 开启 → 首次点击设 btnStatus=1，return（二次确认）
  ├─ 构建 params:
  │    ├─ LIMIT: orderType='LIMIT', price, timeInForce
  │    ├─ MARKET: orderType='MARKET', timeInForce='IOC'
  │    └─ ENTRUST: stopPrice, triggerPriceType, entrustType
  │         (STOP/STOP_MARKET/TAKE_PROFIT/TAKE_PROFIT_MARKET)
  ├─ 设置 positionSide:
  │    OPEN: BUY→LONG, SELL→SHORT
  │    CLOSE: BUY→SHORT, SELL→LONG
  ├─ 止盈止损: triggerProfitPrice, triggerStopPrice
  ├─ origQty = getSheetAmount(orderSide)  // 转为张数
  ├─ 计划委托触发价接近当前价(<0.3%) → StopPriceTipModal 确认
  └─ createOrder(params) 或 createPlan(params)
       │
       ▼
createOrder(params)
  formSection/index.tsx L957-984（U本位）
  formSectionCoinBased/index.tsx L1004-1031（币本位）
  │
  ├─ getOrdering() 防重复提交
  ├─ setOrdering(true)
  ├─ fetchCreateOrder(params)  // 直接 API 调用，无钱包签名
  ├─ 成功 → 延迟1s刷新 orderList + adlList，resetFormData
  └─ finally → setOrdering(false)
```

// 注意：合约下单不经过钱包签名流程（无 useEnableTrading/useSparkSigner），与现货下单不同

### 四方向下单

合约交易有 4 个方向组合（区别于现货的 BUY/SELL）：

```
开仓 (OPEN):
  买入开多  orderSide=BUY   positionSide=LONG   → OpenPosition 左按钮
  卖出开空  orderSide=SELL  positionSide=SHORT  → OpenPosition 右按钮

平仓 (CLOSE):
  买入平空  orderSide=BUY   positionSide=SHORT  → ClosePosition 左按钮
  卖出平多  orderSide=SELL  positionSide=LONG   → ClosePosition 右按钮
```

### 数量单位转换

合约数量以"张"(sheet)为基础单位，用户可选择以不同单位输入：

```
U本位:  张(sheet) / USDT / COIN
币本位: 张(sheet) / USD / COIN

getSheetAmount()  // 统一转换为张数用于下单
  formSection/index.tsx L1016-1056
  formSectionCoinBased/index.tsx L1063-1103

  有输入值 → currentUnit2Sheet(amount) 转换
  无输入值 → 百分比 × 最大可开/可平
  开仓 → 向下取整 toFixed(0,1)
  平仓 → 向上取整后与最大值取 min
```

### U 本位 vs 币本位核心差异

两套表单（FormSection / FormSectionCoinBased）结构同构但数值计算不同，根本原因在于结算币种不同：

| 维度 | U 本位 | 币本位 |
|------|--------|--------|
| 结算币种 | USDT | baseCoin（如 BTC） |
| 面值计算 | 张 × contractSize = baseCoin | 张 × contractSize / price = baseCoin |
| minNotional 转张数 | minNotional / price / contractSize | minNotional × price / contractSize |
| 单位选项 | 张 / USDT / COIN | 张 / USD / COIN |
| 计算器 hook | useOpenPositionCalculator | useOpenPositionCalculatorCoinBased |
| buyPrice 取值 | 直接取市价/限价 | min(latestPrice, 市价/限价) |
| sellPrice 取值 | max(latestPrice, 市价/限价) | 直接取市价/限价 |
| TimeInForce | GTC/IOC/FOK/GTX | GTC/IOC/GTX（无 FOK） |

### 价格验证

`validateForm()` 对限价单和计划委托进行价格范围检查：

```
formSection/index.tsx L694-915（U本位）
formSectionCoinBased/index.tsx L739-962（币本位）

限价单/计划委托:
  买入价上限 = (1 + multiplierUp) × basePrice
  卖出价下限 = max((1 - multiplierDown) × basePrice, 0)

  basePrice:
    限价单 → availablePrice
    计划委托 → triggerPrice

止盈止损校验（仅 OPEN + 限价/市价）:
  BUY(LONG):  winPrice >= price, lossPrice <= price
  SELL(SHORT): winPrice <= price, lossPrice >= price

数量校验:
  OPEN: 超过最大可开? 低于单笔最小? 超过单笔最大?
  CLOSE: 超过持仓量?
```

### 保证金与可开量计算

开仓所需保证金和最大可开量通过专用 hook 计算：

```
availableOpenData useMemo
  formSection/index.tsx L289-340（U本位）
  formSectionCoinBased/index.tsx L319-369（币本位）

  longMargin / shortMargin    — 多/空方向所需保证金
  maxOpenLong / maxOpenShort  — 多/空方向最大可开张数

  来源: useOpenPositionCalculator / useOpenPositionCalculatorCoinBased
```

### 防重复提交

通过 4 个独立 boolean state 管理四方向的 loading 状态：

```
buyLongOrdering / sellShortOrdering / buyShortOrdering / sellLongOrdering

setOrdering(orderSide, positionSide, value)  L918-954 / L965-984
getOrdering(orderSide, positionSide)          L956-984 / L986-1001

createOrder 入口检查 getOrdering()，为 true 则直接 return
```

## 文件结构

```
src/pages/futures/main/orderForm/
├── index.tsx                         # OrderForm 容器，isUBased 分支（170行）
├── formSection/
│   └── index.tsx                     # U本位核心表单（1443行）
├── formSectionCoinBased/
│   └── index.tsx                     # 币本位核心表单（1489行）
├── openPosition/index.tsx            # 开仓按钮+保证金/可开量（144行）
├── closePosition/index.tsx           # 平仓按钮+可平量/持仓（137行）
├── entrustTypeTab/index.tsx          # 限价/市价 Tab（43行）
├── mode/index.tsx                    # 保证金模式+计算器入口（85行，已被顶部工具栏取代）
├── percentPreview/index.tsx          # 预估买卖值展示（58行）
└── tradeType/index.tsx               # 开仓/平仓切换（86行，Tab已注释）
```

## 关键设计决策

### 为什么 U 本位和币本位是两个独立组件？

FormSection（1443行）和 FormSectionCoinBased（1489行）结构高度同构，但数值计算在面值换算、保证金计算、单位转换上有根本差异（乘以价格 vs 除以价格）。将差异抽取到 hook 或工具函数中可以合并组件，但当前设计选择了复制+独立维护，避免在核心计算逻辑中引入大量条件分支。

### 为什么没有钱包签名流程？

合约下单通过 `fetchCreateOrder` 直接调用 API，不经过 `useEnableTrading` / `useSparkSigner` 签名。这与现货下单（需要 `signNewOrderRequest` 链上签名）不同，因为合约交易走中心化撮合引擎。

### 为什么 openPosition 用 antd 而 closePosition 用 element-react？

历史遗留问题。openPosition 较新，包裹了 `RegionRestrictWrapper`（地区限制）并使用 antd Button；closePosition 是早期代码，使用 element-react Button。

### 为什么开平仓 Tab 被注释？

`tradeType/index.tsx` 中的 OPEN/CLOSE Tab 已被注释掉，UI 入口隐藏。但父组件 `index.tsx` 仍维护 `tradeType` state 并默认为 `'OPEN'`，说明平仓功能保留但当前产品设计中不暴露切换入口。

### 二次确认机制

`isConfirmAgain` 设置开启时，首次点击下单按钮只将 `btnStatus` 设为 1，按钮文案变为"再次确认"，第二次点击才真正提交。通过 `resetBtnStatus` 在各种状态变化时重置。

## 开发修改指南

### 新增委托类型

1. `entrustTypeTab/index.tsx` 添加 Tab 选项
2. `formSection/index.tsx` + `formSectionCoinBased/index.tsx` 的 `validateForm()` 添加校验分支
3. `tradeHandleClick()` 中补充参数构建逻辑
4. 注意两个表单需要同步修改

### 修改数量单位转换

核心在 `useUnit` hook 的 `currentUnit2Sheet` / `sheet2CurrentUnit` 方法。表单内的 `getSheetAmount()` 调用这些方法将用户输入转为张数。修改时注意 U 本位和币本位的换算公式不同。

### 调整价格校验范围

修改 `validateForm()` 中的 multiplierUp/multiplierDown 判断逻辑。注意计划委托的 basePrice 用 triggerPrice 而非 availablePrice。

### 启用平仓功能

1. 取消 `tradeType/index.tsx` 中被注释的 Tab 代码
2. 确认 `index.tsx` 的 `tradeType` state 传递正确
3. `closePosition/index.tsx` 已有完整的平仓按钮逻辑

## 术语表

| 术语 | 含义 |
|------|------|
| sheet / 张 | 合约最小交易单位 |
| contractSize / 面值 | 每张合约代表的标的数量 |
| isUBased | U 本位合约（USDT 结算） |
| coin-based / 币本位 | 以 baseCoin（如 BTC）结算的合约 |
| positionSide | 持仓方向：LONG（多）/ SHORT（空） |
| orderSide | 订单方向：BUY / SELL |
| tradeType | 交易类型：OPEN（开仓）/ CLOSE（平仓） |
| multiplierUp/Down | 价格偏离限制系数 |
| marketTakeBound | 市价单价格保护系数 |
| entrustType | 计划委托类型：STOP / STOP_MARKET / TAKE_PROFIT / TAKE_PROFIT_MARKET |
| triggerPriceType | 计划委托触发价类型：INDEX_PRICE / MARK_PRICE / LATEST_PRICE |
| TimeInForce | GTC（持续有效）/ IOC（立即成交剩余撤销）/ FOK（全部或撤销）/ GTX（只做 Maker） |
| currentUnit2Sheet | 将当前单位数量转换为张数 |
| minNotional | 单笔最小名义价值 |
| ADL | 自动减仓（Auto-Deleveraging） |

## 更新记录

### 2026-04-07: 初始版本

初始文档，通过 /k/context learn 从代码自动生成
