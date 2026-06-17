# OrderBook 盘口深度展示

## 架构概览

OrderBook 分为**现货（Spot）**和**合约（Futures）**两套独立实现，移动端复用现货版本。

```
┌─────────────────────────────────────────────────────────┐
│ 数据层 (MobX Store)                                      │
│                                                          │
│  spot.ts                    __deprecated_futures.ts       │
│  ├─ depthData (WS 推送原始数据)   ├─ depthData            │
│  ├─ buildMergedDepthData()       ├─ fetchDepthData()     │
│  │   深度合并 + 用户订单标记        │                       │
│  ├─ depthDisplayDataForFull      ├─ depthDisplayDataForFull│
│  │   按 UI 高度截取 + 百分比计算    │                       │
│  ├─ midPrice / bestPrice         ├─ displayHeight         │
│  └─ isOrderBookUsdc              └─ priceUnit             │
└────────────┬──────────────────────────────┬───────────────┘
             ↓                              ↓
┌────────────────────────────┐  ┌──────────────────────────┐
│ 现货 OrderBook (spot/)      │  │ 合约 OrderBook (futures/) │
│ src/pages/spot/main/        │  │ src/pages/futures/main/   │
│   orderBook/                │  │   orderBook/              │
│                             │  │                           │
│ ┌─────────────────────────┐│  │ ┌───────────────────────┐ │
│ │ index.tsx (主容器)        ││  │ │ index.tsx (主容器)      │ │
│ │ - useResizeObserver      ││  │ │ - sheet2CurrentUnit    │ │
│ │   动态行数计算             ││  │ │   张→当前单位转换       │ │
│ │ - 3种布局: askBid/ask/bid ││  │ │ - 固定高度分配          │ │
│ │ - NewTooltip 状态管理     ││  │ │ - 旧版 element-react   │ │
│ └──────────┬──────────────┘│  │ └──────────┬────────────┘ │
│            ↓               │  │            ↓               │
│ ┌──────────────────┐       │  │ ┌──────────────────┐      │
│ │ OrderRow          │       │  │ │ OrderRow (共享)    │      │
│ │ - 点击 → EventBus │       │  │ │ - 点击 → setLimit │      │
│ │ - 闪烁动画(isNew) │       │  │ │ - 无 EventBus     │      │
│ │ - FormatNumericText│      │  │ │ - kmbSeparator    │      │
│ └──────────────────┘       │  │ └──────────────────┘      │
│            ↓               │  │            ↓               │
│ ┌──────────────────┐       │  │ ┌──────────────────┐      │
│ │ NewTooltip        │       │  │ │ Tooltip (AntdTooltip)│   │
│ │ fixed 定位         │       │  │ │ - U本位/币本位公式  │   │
│ │ 均价/总量/总额     │       │  │ │ - contractSize 参与 │   │
│ └──────────────────┘       │  │ └──────────────────┘      │
│                             │  │                           │
│ ┌──────────────────┐       │  │ 布局切换: 按钮组           │
│ │ LayoutSelector    │       │  │ 深度合并: element-react    │
│ │ DepthSelector     │       │  │   Select                  │
│ │ CoinSelector      │       │  │                           │
│ └──────────────────┘       │  │                           │
└────────────────────────────┘  └──────────────────────────┘

移动端入口:
  m/trade/index.tsx → import OrderBook from "@/pages/spot/main/orderBook"
  （复用现货版本，isMobileTradePage=true）

EventBus 联动:
  OrderRow 点击 → ORDER_GET_ORDER_BOOK_DATUM → orderForm 填充价格/数量
  TradeRow 点击 → ORDER_GET_ORDER_BOOK_DATUM → orderForm 填充价格
```

## 核心逻辑

### 1. 深度数据处理流水线（Store 层）

数据从 WS 推送到 UI 展示经过 4 步处理：

```
WS 原始数据 (depthData)
    ↓
buildMergedDepthData()                    spot.ts:L677-763
  按 depthMerge 精度合并相邻价格档位
  BUY: ROUND_FLOOR（向下取整，归入更低价格档）
  SELL: ROUND_CEIL（向上取整，归入更高价格档）
  同价格档数量累加，标记用户订单位置
    ↓
formatMergedDepthData()                   spot.ts:L787-809
  计算背景条百分比: total / maxSum × 100
  输出: [price, amount, total, rate, isOrder, isNew]
    ↓
depthDisplayDataForFull (computed)        spot.ts:L852-902
  按 displayAmountConfig 截取行数
  ask/bid 共享 maxSum 保证背景条比例一致
    ↓
UI 组件渲染
```

**深度合并算法核心**（`buildMergedDepthData` L692-711）：

```typescript
// BUY 侧: 向下取整归入更低价格档
price.div(base).integerValue(ROUND_FLOOR).times(base).toFixed(precision)

// SELL 侧: 向上取整归入更高价格档
price.div(base).integerValue(ROUND_CEIL).times(base).toFixed(precision)
```

`depthMerge` 对应 `depthPrecisionMergeList` 中的条目，每个条目有 `{ value, label, base, precision }`。`base` 是合并步长（如 0.01, 0.1, 1），`precision` 是显示小数位数。

### 2. 动态行数计算（现货）

现货版使用 `useResizeObserver` 监听容器高度变化，动态决定能展示多少行：

```typescript
// spot/orderBook/index.tsx L119-163
useResizeObserver([oderBookContentRef, priceBarRef], ([content, priceBar]) => {
  let height = content.clientHeight - priceBar.clientHeight;
  if (!isMobile || layout === "column") height = Math.floor(height / 2);
  setOrderbookViewHeight(height);
});

// 每行 21px，计算 maxRow
let maxRow = Math.floor(orderbookViewHeight / 21);
// askBid 模式: ask 和 bid 各 maxRow 行
// ask/bid 单侧模式: 该侧 maxRow*2 行
setDisplayAmountConfig({ ask: ..., bid: ... });
```

合约版使用固定高度 `displayHeight`，由 store 管理。

### 3. 行点击联动下单表单

**现货 OrderRow**（`orderRow/index.tsx L125-140`）：

```typescript
const rowHandleClick = () => {
  setLimitPrice(content[0]);  // 直接设置限价
  eventBus.emit(EventNames.ORDER_GET_ORDER_BOOK_DATUM, {
    price: content[0],
    qty,          // 当前行数量
    total,        // 累加总量
    usdQty,       // USDC 计价数量
    usdTotal,     // USDC 计价总额
    scale: content[3],
    isUserOrder: content[4],
  });
};
```

orderForm 的 `formSection/index.tsx L637-653` 监听此事件，自动填充价格和数量。

**合约 OrderRow**（`components/orderRow/index.tsx L39-41`）：
仅 `setLimitPrice(content[0])`，不通过 EventBus，不传递数量信息。

**TradeRow**（最新成交列表行，`components/tradeRow/index.tsx L56-61`）：
也通过 `ORDER_GET_ORDER_BOOK_DATUM` 传递价格，但只传 `price` 和 `total`，不含 `qty` 等字段。

### 4. 悬停 Tooltip 汇总

**现货 NewTooltip**（`NewTooltip/index.tsx L14-85`）：

采用 fixed 定位方案，由父组件管理状态。悬停行通过 `onTooltipEnter` 回调报告位置，父组件计算数据后传入：

```typescript
// 汇总计算
const totalAmount = content.reduce((acc, [_, amount]) => acc.plus(amount), BN(0));
const totalCost = content.reduce((acc, [price, amount]) => acc.plus(BN(price).times(amount)), BN(0));
const avgPrice = totalCost.div(totalAmount);  // 加权平均价
```

显示三项：均价（Avg Price）、总量（Sum baseCoin）、总额（Sum USDC）。

**合约 Tooltip**（`futures/orderBook/tooltip/index.tsx L16-93`）：

使用 Antd Tooltip 包裹，通过 `sheet2CurrentUnit` 进行单位转换，区分 U 本位和币本位：

```typescript
// 成交额计算
const toVolume = (price, amount) =>
  isUBased
    ? BN(price).times(amount).times(contractSize)   // U本位: 价格×数量×合约面值
    : BN(amount).times(contractSize);                // 币本位: 数量×合约面值

// 均价计算
const avgPrice = isUBased
  ? totalVolume.div(contractSize).div(totalSheet)    // U本位
  : totalVolume.div(totalSheet);                     // 币本位
```

### 5. 币种切换（现货独有）

现货支持在 baseCoin 和 USDC 之间切换显示单位（`CoinSelector.tsx`）：

```typescript
// store: spot.isOrderBookUsdc (boolean)
// OrderRow 根据此标志决定显示原始数量还是 USDC 计价
isOrderBookUsdc ? <FormatNumericText value={amountUSDT} format=",.2f" />
               : <FormatNumericText value={content[1]} format={`,.${quantityPrecision}f`} />
```

### 6. 新增行闪烁动画（现货独有）

当深度数据中有新增行（`isNew = content[5]`）时，触发闪烁动画：

```typescript
// orderRow/index.tsx L78-93
if (isNew) el.classList.add("animate-orderBookFlash");
el.addEventListener("animationend", handleEnd, { once: true });
// 买入闪绿，卖出闪红
"bg-[#18B36B]": type === DirectionEnum.BUY && isNew
"bg-[#F24237]": type === DirectionEnum.SELL && isNew
```

### 7. 悬停高亮范围

两个实现都支持悬停时高亮从当前行到最优价的所有行：

```typescript
// 买侧: index <= 当前行 → 从第一行到当前行
hoverBg: isBuyType ? buyOrderRowIndex >= index : sellOrderRowIndex <= index
// 卖侧: index >= 当前行 → 从当前行到最后一行
hoverBorder: 当前行加边框标识
```

### 8. PriceBar（盘口中间价格栏）

**现货 PriceBar**（`spot/components/priceBar/index.tsx`）：
显示买一卖一价差（spread）和价差百分比（spreadPct = spread / midPrice × 100）。使用 `AutoShrink` 组件自适应字号。

**合约 PriceBar**（`futures/components/priceBar/index.tsx`）：
显示最新成交价（带涨跌箭头）和标记价格（Mark Price，带 Pin 图标）。点击可将价格填入下单表单。支持涨跌色主题切换。

### 9. 涨跌色主题

两个实现都支持 `upDownTheme` 切换：
- `greenUpRedDown`：买涨绿跌红（默认）
- 反转模式：买红卖绿

通过 `ui.upDownTheme` 和 `UpDownThemeEnum` 控制颜色映射。

## 文件结构

### 现货 OrderBook（9 文件）

| 文件 | 行数 | 职责 |
|------|------|------|
| `spot/main/orderBook/index.tsx` | 413 | 主容器，动态行数、布局切换、tooltip 状态 |
| `spot/main/orderBook/orderRow/index.tsx` | 278 | 行组件，点击 EventBus、闪烁动画、hover 高亮 |
| `spot/main/orderBook/LayoutSelector.tsx` | 116 | 布局选择器 askBid/ask/bid |
| `spot/main/orderBook/DepthSelector.tsx` | 51 | 深度合并精度选择器 |
| `spot/main/orderBook/CoinSelector.tsx` | 44 | baseCoin/USDC 切换 |
| `spot/main/orderBook/NewTooltip/index.tsx` | 88 | 悬停汇总 fixed tooltip |
| `spot/main/orderBook/tooltip/index.tsx` | 96 | 旧版 Antd tooltip（仍被 spot 引用） |
| `spot/main/orderBook/tooltip/Content.tsx` | 34 | tooltip 内容布局 |
| `spot/main/orderBook/tooltip/ContentItem.tsx` | 17 | tooltip 行项 |

### 合约 OrderBook（4+1 文件）

| 文件 | 行数 | 职责 |
|------|------|------|
| `futures/main/orderBook/index.tsx` | 231 | 主容器，sheet 单位转换 |
| `futures/main/orderBook/tooltip/index.tsx` | 96 | 悬停汇总，U/币本位计算 |
| `futures/main/orderBook/tooltip/Content.tsx` | 34 | tooltip 内容布局 |
| `futures/main/orderBook/tooltip/ContentItem.tsx` | 17 | tooltip 行项 |
| `futures/main/components/orderRow/index.tsx` | 75 | 合约行组件，仅 setLimitPrice |

### 共享组件

| 文件 | 行数 | 职责 |
|------|------|------|
| `spot/main/components/priceBar/index.tsx` | 61 | 现货价差栏 spread + spreadPct |
| `futures/main/components/priceBar/index.tsx` | 64 | 合约最新价 + 标记价 |
| `spot/main/components/tradeRow/index.tsx` | 81 | 最新成交行，点击联动下单 |

## 关键设计决策

### 为什么现货和合约分开实现？

1. **数据模型差异**：现货直接用价格和数量，合约需要 `sheet2CurrentUnit` 做张/USDT/COIN 单位转换，且区分 U 本位和币本位两种计算公式
2. **Store 分离**：现货用 `spot` store，合约用 `deprecatedFutures` store，字段名和 API 不同
3. **UI 差异**：现货支持币种切换和新增行闪烁动画，合约不需要；合约 PriceBar 显示标记价，现货不需要

### 为什么现货用 NewTooltip 替代 Antd Tooltip？

旧版 `tooltip/index.tsx` 使用 Antd Tooltip 包裹整个 ask/bid 区域，存在性能问题（每次鼠标移动都触发 Antd 内部重渲染）。NewTooltip 使用 fixed 定位 + 父组件状态管理，只在数据变化时更新，减少不必要的 DOM 操作。

### 为什么现货 OrderRow 通过 EventBus 联动？

现货 OrderRow 点击后需要同时填充价格和数量到下单表单，且数量需要累加计算。EventBus 解耦了 orderBook 和 orderForm 的直接依赖，且 payload 携带完整的 `{ price, qty, total, usdQty, usdTotal }` 供表单灵活消费。合约 OrderRow 仅填充价格，直接调用 store action 即可。

### 背景条百分比为什么 ask/bid 共享 maxSum？

`depthDisplayDataForFull`（L885-889）计算时取 ask 侧和 bid 侧累加总量的最大值作为 `maxSum`，确保两侧背景条在同一比例尺下对比，视觉上反映真实的买卖力量对比。

## 开发修改指南

### 修改深度合并逻辑
→ `spot.ts` 的 `buildMergedDepthData()` L677-763，注意 BUY 向下取整、SELL 向上取整的对称性

### 添加新的 Tooltip 展示字段
→ 现货: `NewTooltip/index.tsx` 的 totals 计算和 JSX
→ 合约: `futures/orderBook/tooltip/index.tsx` 的 toVolume/avgPrice 公式，注意 U/币本位分支

### 修改行点击行为
→ 现货: `orderRow/index.tsx` L125-140 的 `rowHandleClick`，payload 字段影响 orderForm
→ 合约: `components/orderRow/index.tsx` L39-41，仅填价格

### 修改行数动态计算
→ `spot/orderBook/index.tsx` L119-163，行高固定 21px，修改后注意 askBid/ask/bid 三种模式的行数分配

### 添加新的布局模式
→ `LayoutSelector.tsx` 的 options 数组 + `index.tsx` 的 `_displayConfigMap`

### 注意事项
- 合约用的是 `deprecatedFutures` store，这是旧版 store，修改前确认是否有新版替代
- `spot/orderBook/tooltip/index.tsx` 仍存在但现货主流程已切换到 NewTooltip
- 移动端通过 `isMobileTradePage` prop 控制差异行为（如隐藏中间列、反转进度条方向）

## 术语表

| 术语 | 含义 |
|------|------|
| depthMerge | 深度合并精度等级，对应 depthPrecisionMergeList 中的 value |
| base | 合并步长，如 0.01 表示按 1 分合并 |
| askBid/ask/bid | 三种布局模式：双侧/仅卖/仅买 |
| isOrderBookUsdc | 是否以 USDC 计价显示数量和总额 |
| sheet2CurrentUnit | 合约张数转当前显示单位（张/USDT/COIN） |
| contractSize | 合约面值，张数 → 金额的转换系数 |
| isNew | 深度数据新增行标记，触发闪烁动画 |
| ORDER_GET_ORDER_BOOK_DATUM | EventBus 事件名，盘口行点击 → 下单表单填充 |
| maxSum | ask/bid 累加总量最大值，用于计算背景条百分比 |

## 更新记录

### 2026-04-09: 初始版本

初始文档，通过 /k/context learn 从代码自动生成
