# SoDEX 项目核心领域知识

> 本文档描述项目的核心概念、流程和规则，帮助快速建立全局认知。
> 只包含「是什么」和「为什么」，不涉及具体代码实现。

---

## 一、账户模型

SoDEX 采用**三层账户体系**，资金在不同层级间流转：

```
┌─────────────────────────────────────────────┐
│  Funding（EVM 钱包层）                        │
│  链上真实资产，用户自持私钥                      │
│  持有：SOSO(native)、vMAG7.ssi、vsMAG7.ssi 等  │
└──────────────┬──────────────────┬────────────┘
               ↕                  ↕
┌──────────────┴───────┐  ┌──────┴────────────┐
│  Spot（现货账户）      │  │  Perps（合约账户）  │
│  链下 CLOB 系统托管    │  │  链下 CLOB 系统托管 │
│  持有：WSOSO、vUSDC 等 │←→│  仅持有：vUSDC     │
└──────────────────────┘  └───────────────────┘
```

### 三层账户的职责

- **Funding**：链上 EVM 钱包，用户完全控制。充值/提现的入口和出口，Vault 操作的执行层。
- **Spot**：现货交易账户，由 CLOB（中央限价订单簿）系统管理。支持现货交易和多币种持有。
- **Perps**：永续合约账户，同样由 CLOB 管理。仅支持 vUSDC 作为保证金。

### 账户间划转规则

```
Funding ↔ Spot    ✅  涉及链上交互（ERC-20 deposit/withdraw）
Spot    ↔ Perps   ✅  纯链下操作，毫秒级完成
Funding ↔ Perps   ❌  不支持直接互转，必须经过 Spot 中转
```

关键约束：
- Funding → Spot 需要链上签名（approve + depositERC20），耗时取决于区块确认
- Spot ↔ Perps 是链下操作，通常 < 1 秒
- 测试网环境下没有 Funding 层，所有操作在 Spot 和 Perps 之间完成

---

## 二、Token 模型

### SOSO 与 WSOSO

SOSO 是 ValueChain 的原生代币（类似 ETH 之于 Ethereum）。由于原生代币没有 ERC-20 接口，无法直接与智能合约交互，因此需要 WSOSO（Wrapped SOSO）。

```
EVM 钱包层：SOSO（原生币，用于 gas 和直接转账）
     ↓ 进入 CLOB 系统时自动 wrap
Spot 账户层：WSOSO（ERC-20，可用于交易和合约交互）
     ↓ 提现到钱包时自动 unwrap
EVM 钱包层：SOSO（原生币）
```

**用户无感**：UI 中统一显示为 "SOSO"，wrap/unwrap 在底层自动完成。用户在 Spot 账户看到的 "SOSO" 实际上是 WSOSO。

### MAG7 生态 Token

MAG7 是 Vault 体系的核心资产，存在多种衍生形态：

| Token | 全称 | 含义 | 精度 |
|-------|------|------|------|
| vMAG7.ssi | Vault MAG7 | Vault 基础资产，可充值到 Vault | 8 位 |
| vsMAG7.ssi | Vault Staked MAG7 | MAG7 质押后获得的收益凭证 | 8 位 |
| vsMAG7.SLP | Vault Staked MAG7 SLP | Vault 流动性池份额代币 | 18 位 |

转换关系：
```
vMAG7.ssi  →（stake）→  vsMAG7.ssi  →（deposit to vault）→  vsMAG7.SLP
vsMAG7.SLP →（withdraw）→ vsMAG7.ssi →（unstake）→ vMAG7.ssi
```

### 精度体系

项目中的数值精度分为两层，**绝不可混用**：

- **UI 精度**（4 位小数）：用于页面显示，向下取整，确保显示值不超过实际值
- **链上精度**（8 或 18 位小数）：用于合约交互和链上计算，保留完整精度

典型错误：用 UI 精度（4 位）截断后发给合约 → 0.00005 被截断为 0 → 操作静默失败。

### 跨链映射

项目支持 Base Chain 和 Value Chain 两条链。同一资产在不同链上有不同名称：

| Base Chain | Value Chain | 说明 |
|-----------|-----------|------|
| MAG7.ssi | vMAG7.ssi | v 前缀表示 Value Chain 版本 |
| sMAG7.ssi | vsMAG7.ssi | v 前缀 + s 前缀表示质押版本 |

---

## 三、核心资金流

### Deposit（充值）

将外部资产充入 SoDEX 系统。提供两条路径：

**Regular（常规充值）**
- 系统生成充值地址 → 用户从外部钱包扫码转账 → 自动入账
- 适用于所有 ERC-20 代币
- 需要轮询等待地址生成（最多 150 秒）

**Flash（快速充值）**
- 用户直接在 SoDEX 内签名 → approve → bridge 跨链 → 即时到账
- 适用于链上有余额的场景
- SOSO 充值走专用合约（bridgeNativeToken），其他代币走通用 bridge

币种约束：
- MAG7.ssi / sMAG7.ssi 仅支持 Flash，不支持 Regular
- XRP / XLM 有 memo 字段，地址格式为 `address:memo`

### Withdraw（提现）

将资产从 SoDEX 系统提出到外部钱包。

```
① 地址验证（高风险检测）
② Spot 资金转出（如果资金在 Spot → 先转到 Funding）
③ EIP-712 签名（callForPermit）
④ 后端执行提现
⑤ 链上确认
```

SOSO 提现是特殊路径：不走 callForPermit，而是直接发送原生转账交易，并扣除 0.0001 SOSO 作为手续费。

### Transfer（账户间划转）

在 Funding / Spot / Perps 三个账户之间移动资金。

核心规则：
- 支持方向：Funding↔Spot、Spot↔Perps
- 不支持：Funding↔Perps（需经 Spot 中转）
- Funding↔Spot 涉及链上交互，需要 approve + 等待区块确认
- Spot↔Perps 是纯链下操作

邮箱用户限制：
- EVM 类 Token（SOSO/WSOSO/MAG7/sMAG7）只能在 Funding↔Spot 之间
- Futures 类 Token（vUSDC）只能在 Spot↔Perps 之间

### Vault 全生命周期

Vault 是项目的收益产品，完整生命周期：

```
[充值 Deposit]
Base Chain MAG7 → bridge 跨链 → Value Chain Spot → Transfer 到 Funding
  → Stake（MAG7 → sMAG7）→ Vault Deposit（sMAG7 → SLP）

[赎回 Withdraw]  
SLP → Vault Withdraw（SLP → sMAG7，有冷却期）
  → Claim 领取 → Unstake（sMAG7 → MAG7）→ 提现到外部钱包
```

关键约束：
- Vault Deposit 是多步状态机：Base 跨链 → Enable Trading（新用户）→ Value Chain 操作
- Unstake 有智能转账：如果 EVM 余额不足，自动从 Spot 转差额到 Funding 再执行
- Vault Withdraw 后有冷却期，需要等待后才能 Claim
- 滑点容差：差值 ≤ 0.0001 时跳过转账，直接用当前余额操作

### Vault SLP 页面

独立页面（`/vault`），展示 SLP Vault 的数据面板和操作入口：

- **头部面板（SLP）**：TVL、1Y Return、NAV、MAG7.ssi 价格，以及 Get/Withdraw/Deposit 操作按钮
- **4 个 Tab**：My Position（个人存款/PNL/ROI+图表）、Overview（全局 TVL/NAV 图表）、Activity（操作记录双表格）、Depositors（存款人列表）
- **智能默认 Tab**：有 SLP 余额 → My Position，无余额 → Overview
- **事件驱动刷新**：Deposit/Withdraw/Claim 完成后通过 eventBus 通知页面刷新指标和余额
- **URL 参数触发**：`?popupid=deposit` 或 `?from=trade` 自动打开 Deposit 弹窗

---

## 四、鉴权模型

### 鉴权链路

用户从连接钱包到可以交易，需要经过完整的鉴权流程：

```
钱包连接（选择钱包/扫码/邮箱登录）
    ↓
用户协议签署（首次使用）
    ↓
Enable Trading（授权交易）
  ├─ 获取 nonce → 钱包签名 → 验证签名 → 获取 accessToken
  ├─ 注册 API Key → 获取私钥
  └─ Stay Signed In 弹窗 → 选择存储方式
    ↓
可以交易
```

### Enable Trading

Enable Trading 是将钱包签名转化为交易能力的核心步骤。签名后系统生成 API Key 和私钥，用于后续的交易操作（无需每次都签名）。

触发时机：
- 首次连接钱包后的第一次操作（充值、提现、Vault 等）
- 私钥过期或失效时
- 邮箱用户自动触发（连接后 600ms 自动执行，最多重试 5 次）

### 私钥存储

签名完成后，用户可以选择是否「记住登录」：

- **记住**（Yes）：私钥存入 localStorage，关闭浏览器后仍有效
- **不记住**（No）：私钥存入 sessionStorage，关闭标签页即清除

两种存储互斥——选择一种时自动清除另一种，避免状态冲突。

### 签名失败处理

三种失败状态需要区分对待：
- **cancel**：用户主动拒绝签名 → 静默关闭，不显示错误提示
- **failed**：签名过程失败 → 显示错误提示
- **error**：异常错误 → 显示错误提示

---

## 五、交易系统

### 现货交易（Spot）

现货交易在 Spot 账户中进行，支持限价单和市价单。

```
下单流程：
  用户输入 → 表单校验（价格范围/最小金额）
    → signNewOrderRequest（useSparkSigner 链上签名）
    → spotUniversalApi 提交 → 成功后刷新订单/余额
```

关键规则：
- 数量以 baseCoin/quoteCoin 双币种输入，实时换算
- 价格范围限制：买入价 ≤ (1 + multiplierUp) × latestPrice，卖出价 ≥ (1 - multiplierDown) × latestPrice
- 最小下单额：普通币对 5 USDC，WSOSO 交易对 1 USDC
- 余额不足时不禁用按钮，而是引导用户充值/划转
- 每笔订单都需要链上签名（useSparkSigner）

### 合约交易（Futures）

合约交易在 Perps 账户中进行，支持限价/市价/计划委托（Stop/Take）三种委托类型。

**四方向交易**（区别于现货的买/卖）：
```
开仓：买入开多(BUY+LONG)  / 卖出开空(SELL+SHORT)
平仓：买入平空(BUY+SHORT) / 卖出平多(SELL+LONG)
```

**双模式**（仅 PC 端）：
- **U 本位**：以 USDT 结算，面值 = 张数 × contractSize
- **币本位**：以 baseCoin 结算，面值 = 张数 × contractSize / price

**数量单位**：
- PC 端：张(sheet) / USDT(USD) / COIN，通过 `useUnit` hook 转换
- 移动端：baseCoin / USDC，无张数概念

**保证金模式**：Cross（全仓）/ Isolated（逐仓），通过签名 + API 切换

**签名差异**：
- PC 端合约：无签名，直接 `fetchCreateOrder` API 调用（旧版 API）
- 移动端合约：每笔签名，`useBoltSigner.signNewOrderRequest`（Bolt 协议）

**止盈止损（TP/SL）**：
- PC 端：内嵌在表单组件中（winPrice/lossPrice 字段）
- 移动端：独立 TakeProfitStopLoss 组件，支持价格↔收益率双向计算，BRACKET 订单模式（主单 + 附加 TP/SL 单原子提交）

### 盘口（OrderBook）

盘口展示买卖双方的深度数据，现货和合约各有独立实现。

```
数据流：
  WS 深度推送 → depthData（原始 ask/bid）
    → buildMergedDepthData（按精度合并档位）
    → depthDisplayDataForFull（按 UI 高度截取 + 百分比计算）
    → OrderBook 组件渲染
```

关键特性：
- **三种布局**：askBid（双侧）/ ask（仅卖盘）/ bid（仅买盘）
- **深度合并**：BUY 向下取整、SELL 向上取整，同价格档数量累加
- **行点击联动**：现货通过 EventBus `ORDER_GET_ORDER_BOOK_DATUM` 填充下单表单（价格+数量），合约仅填充价格
- **悬停汇总**：显示均价、总量、总额。合约版区分 U 本位（price×amount×contractSize）和币本位（amount×contractSize）
- **动态行数**：现货通过 useResizeObserver 监听容器高度，每行 21px 计算可显示行数
- **币种切换**：现货支持 baseCoin/USDC 显示单位切换（合约不支持）
- **移动端复用**：移动端 import 现货 OrderBook，通过 `isMobileTradePage` prop 控制差异

### 币对切换与市场面板

交易页顶部的币对选择器和行情栏，新版统一支持 Spot+Futures。

```
数据流：
  spotTicker.fetchTickerList() + futures.tickerList.fetchTickerList()
    → enchanceAllTickers() 合并 → fullMarketTickers (每5秒轮询)
    → Market 面板搜索/Tab 过滤 → 表格展示
```

关键特性：
- **市场面板**：搜索 + Tab 分类（收藏/全部/现货/合约/commodities/stocks/indexes），子分类基于 symbolConfig 的 `tags` 字段
- **币对切换**：`setTradeRouteParams` + `push(pathname)` 路由跳转，通过 `SWITCH_SYMBOL_BY_MARKET` 事件通知 orderForm 重置
- **行情 Ticker**：现货显示涨跌/高低/成交量；合约额外显示标记价、指数价、OI、资金费率+倒计时
- **移动端适配**：Market 用 Drawer 全屏展示，Ticker 用 Collapse 折叠/展开
- **全局键盘搜索**：`GLOBAL_COIN_SEARCH_KEYBOARD` 事件打开市场面板
- **USDT 引导**：搜索 "USDT" 时显示 USDT→USDC Swap 入口（SoDEX 以 USDC 为报价币种）

### WebSocket 数据管道

交易页实时数据层，管理 5 条 WS 连接，通过 500ms 聚合器批量刷新 Store。

```
数据流：
  5 条 WS 连接（symbolSocket/marketSocket/futuresMarketSocket/userSocket/futuresUserSocket）
    → Handler 解析消息（现货 resType / 合约 channel）
    → DataAggregator 500ms 缓冲（depth/deal/ticker）
    → Store 批量更新（setDepthDataByWS 增量合并 / setDealDataByWS / setSymbolTickerByWS）
    → UI 渲染
```

关键特性：
- **消息类型**：现货 7 种 resType（qDeal/qDepth/qAllDepth/uTrade/uOrder/uBalance/qStats），合约 8 种 channel（push.deep/deep.full/agg.ticker/funding.rate/index.price/mark.price/deal/user.*）
- **聚合防抖**：高频 WS 数据缓冲在 ref 中，每 500ms 批量刷一次 store，避免高频渲染
- **深度增量合并**：聚合器保留最后一帧 → Store 层按价格去重合并、过滤 qty=0、买盘降序/卖盘升序
- **序列号校验**：`canInsertDepth` 只接受序列号 > 当前值的深度数据，防止乱序覆盖
- **合约用户事件总线**：TypedEventEmitter（5 种 user.* 事件）解耦合约用户推送，触发 balance/position/order 等 API 刷新
- **用户 WS 鉴权**：通过 listenKey（现货/合约各一个）订阅用户私有频道

### 手续费阶梯等级

独立页面（`/futures/step-rate`），展示用户交易手续费等级体系：

- **等级划分**：按 30 日累计交易量（U本位+币本位）自动分级（level 0-10），每级对应不同 Maker/Taker 费率
- **等级保持**：每个等级有保持天数（`levelReturnDay`），到期后可能降级
- **特殊账户**：`specialType=true` 的账户走独立费率，不参与阶梯体系
- **申请专业费率**：用户可上传其他平台费率截图申请更高等级（人工审核）
- **交易页入口**：下单表单内嵌 `StepRateGate` 组件，Popover 显示当前等级和费率

> 注意区分：trade-feerate 是交易页内嵌的费率展示弹窗，trade-steprate 是独立的费率等级管理页面。

---

## 六、积分系统

### SoPoints

SoPoints 是平台的积分奖励系统，根据用户交易活动计算并发放积分。

**双视图模式**：
- **Guest 视图**：未登录用户看到引导连接钱包的展示页
- **User 视图**：登录后展示积分详情、等级、历史

**Tier 等级体系**：
- 用户按累计积分划分等级（如 Bronze / Silver / Gold）
- 等级卡片展示当前等级、进度、权益

**Weekly Performance**：
- 每周交易表现表格，展示交易量、积分获取、排名变化
- 分享弹窗：可将积分成绩生成图片分享

---

## 七、API Key 管理

独立页面管理 API 密钥的全生命周期：

```
资格验证（是否满足条件）
  → 创建密钥（生成 API Key + Secret）
  → 调整有效期
  → 删除密钥（两步签名确认）
```

关键规则：
- 创建前需要资格验证（交易量/账户状态等条件）
- 删除操作需要两步签名确认，防止误删
- PC/Mobile 响应式布局

---

## 八、排行榜

交易排行榜展示用户交易表现排名，支持分享功能。

---

## 九、交易页底部面板

交易页面底部的多功能 Tab 面板，集成多个数据视图：

- **资产余额**：当前账户持有的各币种余额
- **持仓**：当前开仓的合约持仓信息
- **订单管理**：当前挂单、历史订单
- **交易历史**：已成交记录

关键特性：
- 搜索过滤：按币种或订单类型筛选
- 数据刷新：WS 实时推送 + 手动刷新
- 小余额隐藏：可切换是否显示极小金额的持仓

---

## 十、区块浏览器（Explorer）

独立 SPA（路由 `/explorer`），展示 Value Chain 的区块和交易数据。

**双通道数据架构**：
- **实时数据**（Dashboard）：通过 Explorer WS 订阅，pako gzip 解压，30s 心跳保活，缓冲 300 条
- **历史数据**（详情页）：通过 HTTP API 查询区块详情、交易详情、用户交易列表

**双链支持**：通过 `?blocktype=futures|spot` URL 参数全局切换，API 层将 `futures` 转为 `perps`

**6 条路由**：首页面板（区块表+交易表）、区块列表、区块详情、交易列表、交易详情、地址交易页

**搜索启发式**：输入长度 ≤9 → 区块号，≤42 → 用户地址，>42 → 交易哈希

---

## 十一、关键约束速查

| 约束 | 说明 |
|------|------|
| 自动 wrap/unwrap | SOSO 进入 Spot 时自动 wrap 为 WSOSO，提现时自动 unwrap |
| 合约无币本位移动端 | 移动端合约仅支持 U 本位，PC 端同时支持 U 本位和币本位 |
| 签名差异 | 现货用 useSparkSigner，移动端合约用 useBoltSigner，PC 端合约无签名 |
| 自动划转 | Vault unstake 时，EVM 余额不足会自动从 Spot 补差额 |
| 滑点容差 | 差值 ≤ 0.0001 时跳过转账，避免小额无意义操作 |
| 精度隔离 | UI 用 4 位截断显示，链上用 8/18 位完整精度，不可混用 |
| 测试网降级 | 测试网无 Funding 层，Funding 操作自动映射到 Spot/Perps |
| 邮箱用户限制 | EVM Token 仅限 Funding↔Spot，Futures Token 仅限 Spot↔Perps |
| MAG7 仅 Flash | MAG7/sMAG7 充值不支持 Regular 路径 |
| SOSO 提现特殊 | 不走 callForPermit，直接原生转账，扣 0.0001 手续费 |
