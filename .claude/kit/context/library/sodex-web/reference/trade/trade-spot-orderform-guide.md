# 现货下单表单

## 架构概览

```
┌─────────────────────────────────────────────────────────┐
│  OrderForm (index.tsx)                                  │
│  组合容器：委托类型 + 方向选择 + 表单                       │
│                                                         │
│  ┌─────────────────────┐  ┌──────────────────────────┐  │
│  │ EntrustTypeTab      │  │ DirectionGroup           │  │
│  │ MARKET / LIMIT      │  │ BUY / SELL               │  │
│  └────────┬────────────┘  └──────────┬───────────────┘  │
│           │                          │                   │
│  ┌────────▼──────────────────────────▼───────────────┐  │
│  │ FormSection (formSection/index.tsx)  1543行         │  │
│  │                                                    │  │
│  │  ┌──────────┐  ┌────────────┐  ┌───────────────┐  │  │
│  │  │PriceInput│  │NumberInput │  │ Slider 0-100% │  │  │
│  │  │(限价模式) │  │+ 币种切换  │  │ 百分比控制     │  │  │
│  │  └────┬─────┘  └─────┬──────┘  └───────┬───────┘  │  │
│  │       │              │                 │           │  │
│  │       ▼              ▼                 ▼           │  │
│  │  ┌─────────────────────────────────────────────┐   │  │
│  │  │ validateForm() → postOrder() → createOrder()│   │  │
│  │  │   价格范围检查      签名构造      API提交     │   │  │
│  │  └─────────────────────────────────────────────┘   │  │
│  │                                                    │  │
│  │  ┌──────────────┐  ┌──────────────┐                │  │
│  │  │ OpenPosition │  │ClosePosition │                │  │
│  │  │ 买入按钮      │  │ 卖出按钮      │                │  │
│  │  └──────────────┘  └──────────────┘                │  │
│  └────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘

数据依赖：
  spotTicker (MobX) ← direction, entrustTabType, currentSymbolConfig
  spot (MobX)       ← latestPrice, midPrice, displayCoinBalanceData
  trade (MobX)      ← validSymbolMap, currencyPair, timeInForceValue
  useSparkSigner    ← signNewOrderRequest（订单签名）
  spotUniversalApi  ← HTTP 提交订单
```

## 核心逻辑

### 下单流程

用户操作到订单提交的完整路径：

```
用户输入价格/数量
       │
       ▼
tradeHandleClick()  L929-981
  │
  ├─ 余额不足 BUY → openFundsWalletModal("buy")  打开充值引导
  ├─ quoteCurrencyQty < minimumAmountForOrder → notify.error  最小金额检查
  ├─ validateForm() → 价格范围/数量校验
  ├─ isConfirmAgain → 二次确认（btnStatus）
  ├─ limitOrderEnabled/marketOrderEnabled → 直接提交
  └─ orderConfirmModal.open() → 确认弹窗后提交
       │
       ▼
postOrder(orderSide)  L872-912
  │
  ├─ 构造 orderParams: accountID, symbolID, side, type, timeInForce, price, quantity
  ├─ alignQuantity(quantity, minQty)  对齐最小下单量
  ├─ signNewOrderRequest(orderParams)  → { signature, nonce }
  └─ createOrder({ type: "newOrder", params, nonce, signature })
       │
       ▼
createOrder(params)  L826-851
  │
  ├─ notify("order_submitting", "loading")
  ├─ spotUniversalApi(params)
  ├─ 成功 → notify("order_submitted") + fetchOrderList + fetchBalanceList + resetFormData
  └─ 失败 → notify(error.msg, "error")
```

### 数量计算

数量输入支持两种币种（基础币如 BTC / 计价币如 USDC），核心逻辑在 `getAmount()` L852-871：

```typescript
// formSection/index.tsx L852-871
const getAmount = (_amount?: string): number => {
  // 1. 优先使用直接输入值，否则用百分比 × 可用余额
  // 2. 如果选择的是计价币（USDC），需要除以价格换算为基础币
  // 3. SELL 方向取 min(计算值, maxSell) 防止超额
};
```

币种切换时的换算（`handleSelectCoinChange` L1117-1151）：
- 始终从 `originalAmount`（原始输入值）进行换算，避免累积精度误差
- 支持 baseCurrency ↔ quoteCurrency 双向转换

### 价格验证

`validateForm()` L669-751 对限价单进行价格范围检查：

```
买入价上限 = (1 + multiplierUp) × latestPrice
卖出价下限 = max((1 - multiplierDown) × latestPrice, 0)
```

超出范围 → 设置 `formState.price = 1` + 显示 priceTip 提示。

### 按钮禁用逻辑

`btnDisabled` useMemo L756-823 综合 12 个条件判断：
- flag1: 未输入数量
- flag2: 限价模式未输入价格
- flag3/4: 价格超出 multiplier 范围
- flag5/6: 超过最大买入量 / 低于最小下单量
- flag7: 超过最大卖出量
- flag8/9: 订单价值低于 minimumAmountForOrder（普通币 5 USDC，SOSO 1 USDC）
- flag10/11: 余额不足（与 minimumAmountForOrder 比较）
- flag12: 市价模式但无最新价格

// 注意：余额不足（flag9/10/5）不禁用按钮，而是点击后引导充值

### 余额不足引导

当 BUY 方向余额不足时，按优先级显示：
1. `shouldShowTransferButton`：Spot 余额为 0 但 Funding/Perps 有余额 → 按钮变为 "Transfer to Spot"
2. `isInsufficient.BUY`：按钮显示 "Insufficient Balance"，点击后打开 `fundWalletModal`（充值/划转二选一）

### EventBus 集成

- **监听** `ORDER_GET_ORDER_BOOK_DATUM`（L637-662）：从订单簿点击价格 → 填入价格输入框，如果是市价模式自动切换为限价
- **发送** `ORDER_REFRESH`（L838）：下单成功后通知其他组件刷新

### 滑点警告

`triggerSlippageWarning` 来自 trade store，在卖出方向包裹 `tradeHandleClick`，当价格偏差超阈值时弹出确认。

## 文件结构

```
src/pages/spot/main/orderForm/
├── index.tsx                      # OrderForm 容器（103行）
├── formSection/
│   ├── index.tsx                  # 核心表单（1543行）
│   └── useUserAssetsStatus.ts     # 用户资产状态 hook（51行）
├── openPosition/index.tsx         # 买入按钮（51行）
├── closePosition/index.tsx        # 卖出按钮（57行）
├── direction/index.tsx            # 买/卖方向 Tab（53行）
├── entrustTypeTab/index.tsx       # 市价/限价 Tab（79行）
├── mode/index.tsx                 # 全仓/逐仓模式 + 计算器/资金费率入口（85行）
└── percentPreview/index.tsx       # 预估买卖金额展示（56行）
```

## 关键设计决策

### 为什么 FormSection 是 1543 行的巨型组件？

所有下单逻辑（价格输入、数量计算、百分比滑块、币种切换、表单验证、订单提交、余额检测、UI 渲染）集中在一个组件中。这导致了状态耦合严重但避免了跨组件状态传递的复杂性。未来可考虑拆分为 hooks（useOrderForm, useOrderSubmit）。

### 为什么使用 BigNumber 而非 calculate 工具？

formSection 大量使用 `new BigNumber()` 进行数值运算（非项目推荐的 `calculate` 工具），属于历史代码。部分新增逻辑（如 `handleSelectCoinChange`）已开始使用 `calculate()`。

### 币种切换保留原始值

`originalAmount` state 保存用户最初输入的值和币种，币种切换时从原始值重新换算，避免 BTC→USDC→BTC 多次换算导致精度累积损失。

### SOSO 特殊最小下单额

WSOSO 交易对最小下单额为 1 USDC（其他币对为 5 USDC），通过 `isSOSO` 判断。

## 开发修改指南

### 新增委托类型

1. `entrustTypeTab/index.tsx` 添加 tab 选项
2. `formSection/index.tsx` 的 `validateForm()` 添加对应 case
3. `postOrder()` 中补充 `mapOrderType` 映射
4. `TIF_ARRAY` 常量中添加该类型支持的 TimeInForce

### 修改下单参数

核心在 `postOrder()` L872-912：
- `orderParams` 对象通过 `omitNullableValue` 过滤空值
- `alignQuantity(quantity, minQty)` 确保数量对齐最小步长
- `signNewOrderRequest` 签名后包装为 `{ type: "newOrder", params, nonce, signature }`

### 调整按钮禁用条件

修改 `btnDisabled` useMemo（L756-823）中的 flag 条件。注意 flag9/10/5 故意不禁用按钮，而是引导用户充值。

## 术语表

| 术语 | 含义 |
|------|------|
| baseCurrency / sellCoin | 基础币（如 BTC），即交易标的 |
| quoteCurrency / buyCoin | 计价币（如 USDC） |
| multiplierUp/Down | 价格偏离限制系数 |
| minNotional | 单笔最小下单量（基础币） |
| minimumAmountForOrder | 最小下单金额（USDC），普通 5 / SOSO 1 |
| TimeInForce | 委托有效期：GTC（持续有效）、IOC（立即成交剩余撤销）、FOK（全部成交或撤销） |
| alignQuantity | 将数量对齐到 minQty 步长 |
| PreTradeButton | 预交易检查按钮，封装钱包连接/Enable Trading/地区限制检查 |

## 更新记录

### 2026-04-07: 初始版本

初始文档，通过 /k/context learn 从代码自动生成
