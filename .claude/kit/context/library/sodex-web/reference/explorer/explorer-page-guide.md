# Explorer 区块浏览器页面

## 架构概览

独立 SPA（路由 `/explorer`），展示 Value Chain 的区块和交易数据，支持现货/合约双链切换。

```
┌─────────────────────────────────────────────────────────┐
│  Explorer (index.tsx)  BrowserRouter 包裹                │
│  └─ ExplorerRoutes  根据 ?blocktype= 强制 futures/spot   │
│                                                          │
│  路由表：                                                 │
│  /explorer              → Dashboard   （首页面板）        │
│  /explorer/blocks       → BlocksPage  （区块列表）        │
│  /explorer/block/:num   → BlockDetailPage （区块详情）    │
│  /explorer/txs          → TxsPage     （交易列表）        │
│  /explorer/tx/:hash     → TransactionDetailsPage         │
│  /explorer/address/:addr → AddressTransactionsPage       │
└─────────────────────────────────────────────────────────┘
```

### 数据来源双通道

```
实时数据（Dashboard 列表）             历史数据（详情页/子页）
┌──────────────────┐                  ┌──────────────────┐
│  Explorer WS     │                  │  HTTP API        │
│  (pako gzip)     │                  │  (http/explorer) │
│                  │                  │                  │
│  SUBSCRIBE:      │                  │  getNewBlockDetail│
│  ValueChain_v1   │                  │  getTransaction   │
│  ValueChain_perp │                  │  getBlockTxs      │
│  _v1             │                  │  getAccountTxs    │
│  ValueChain_     │                  │  getAddressInfo   │
│  transaction_*   │                  │  getBatchAddress  │
└────────┬─────────┘                  └────────┬─────────┘
         │                                      │
         ↓                                      ↓
  BlocksTable (WS 实时推送)            BlockDetailPage (HTTP)
  TransactionsTable (WS 实时推送)      TransactionsTableHttp (HTTP)
                                       TransactionDetailsPage (HTTP)
                                       AddressTransactionsPage (HTTP)
```

### 搜索路由策略（Dashboard L22-34）

根据输入长度自动判断搜索类型：
- `≤9 字符` → 区块号 → `/explorer/block/:num`
- `≤42 字符` → 用户地址 → `/explorer/address/:addr`
- `>42 字符` → 交易哈希 → `/explorer/tx/:hash`

## 核心逻辑

### BlocksTable — WS 实时区块表（components/blocksTable/index.tsx）

通过 WebSocket 连接 `EXPLORE_MAINNET_WEBSOCKET_URL`，订阅 `ValueChain_perp_v1`（合约）或 `ValueChain_v1`（现货）。

关键特性：
- **gzip 解压**：WS 消息使用 pako `inflate` 解压 ArrayBuffer
- **心跳保活**：每 30s 发送 `{ method: "PING" }`，收到 `PONG` 响应
- **数据缓冲**：新数据 `unshift` 到数组头部，保留最多 300 条
- **交易数减 1**：`processTransactionsCount` 将 tx_count 减 1（过滤内部交易）
- **响应式**：PC 用自定义表格 + MUI TablePagination，移动端用卡片列表

```typescript
// blocksTable L72-173 — WS 连接生命周期
socket.onopen → SUBSCRIBE → startHeartbeat(30s)
socket.onmessage → inflate(pako) → parse → setDataSource([newItem, ...prev].slice(0,300))
socket.onclose → stopHeartbeat
useEffect cleanup → stopHeartbeat + socket.close
```

### TransactionsTable — WS 实时交易表（components/transactionsTable/index.tsx）

结构与 BlocksTable 几乎一致，订阅 `ValueChain_transaction_perp_v1` / `ValueChain_transaction_v1`。

区别：
- 展示字段为 hash/action/block/time/user
- `action` 类型通过 `getActionText` 映射：newOrder→新订单, replaceOrder→替换订单, cancelOrder→取消订单

### TransactionsTableHttp — HTTP 交易表（components/transactionsTableHttp/index.tsx）

用于区块详情页和地址页，通过 HTTP 获取历史交易数据（非实时）。

双模式：
- **按区块查**（`blockNumber` prop）：`getBlockTransactionsService` → 过滤 account_id=0 → `getBatchAddressInfo` 批量获取地址
- **按用户查**（`userid` prop）：`getAccountTransactionsService`

### TransactionDetailsPage — 交易详情（TransactionDetailsPage/index.tsx L18-604）

最复杂的页面，展示单笔交易的完整信息：

1. **数据获取**：`getTransactionService(txHash, blockType)` → 解析 `tx_json` 为 TXData → `getAddressInfo(account_id)` 获取用户地址
2. **action 类型映射**（L102-157）：根据 `order_type` 映射显示文本
   - `newOrder` → "New Order"
   - `limit_order`/`market_order`/`order` → "Buy/Sell" + 币种名
   - `deposit` → "usdTransfer"
   - `withdraw` → "Spot Send"
   - `cancel`/`cancel_all`/`order_cancel`/`adjust_leverage` → 对应文本
3. **币对查询**：现货通过 `lookup.query("symbolList")`，合约通过 `futures.config.symbolConfigList`
4. **PayloadDetails 子组件**：通用渲染 payload 所有字段，支持 orders/cancels 数组、枚举值映射

### PayloadDetails — Payload 通用渲染（PayloadDetails.tsx L43-340）

核心职责：将交易 payload 的所有字段渲染为 key-value 列表。

枚举映射：
- `OrderSide`：1=买入(BUY), 2=卖出(SELL)，现货显示 Buy/Sell，合约显示 Long/Short
- `OrderType`：1=限价单(LIMIT), 2=市价单(MARKET)
- `TimeInForce`：GTC/FOK/IOC/GTX
- `PositionSide`：0=未指定, 1=单向, 2=多头, 3=空头

特殊处理：
- `orders` 数组 → 逐个渲染 OrderItem
- `cancels` 数组 → 逐个渲染 CancelItem
- `accountID`/`modifier` 在 `ignoreList` 中不显示

### BlockDetailPage — 区块详情（BlockDetailPage/index.tsx）

通过 `getNewBlockDetailService(blockNumber, type)` 获取区块信息（time/hash），下方内嵌 `TransactionsTableHttp` 展示该区块所有交易。

### AddressTransactionsPage — 地址交易页（AddressTransactionsPage/index.tsx）

通过 `useChainAssetByAddress(address)` 计算该地址的链上资产总值（Value Chain 上的 ERC20 余额 × 价格），下方内嵌 `TransactionsTableHttp` 展示交易。

### BlockTypeTab — 链类型切换（components/blockTypeTab/index.tsx）

全局复用的 Futures/Spot 切换 Tab，修改 URL 的 `?blocktype=` 参数。附带 Tooltip 说明现货和合约使用独立区块链。

## HTTP API 层（http/explorer/index.ts）

| 函数 | 方法 | 端点 | 用途 |
|------|------|------|------|
| `getNewBlockDetailService` | GET | `/{type}/block?height=` | 区块详情 |
| `getTransactionService` | GET | `/{type}/transaction?tx_hash=` | 交易详情 |
| `getBlockTransactionsService` | GET | `/{type}/block/transactions?height=` | 区块内交易列表 |
| `getAccountTransactionsService` | GET | `/{type}/account/transactions?address=` | 用户交易列表 |
| `getAddressInfo` | GET | `/chain/user/{userId}/address` | 单个用户地址 |
| `getBatchAddressInfo` | POST | `/chain/users/addresses` | 批量用户地址 |

`type` 参数：`"spot"` 或 `"perps"`（注意不是 `"futures"`，内部转换）。

服务器变量：
- `EXPLORER_BLOCK_API_SERVER_URL` — 新版区块/交易 API
- `TRADABLE_TOKEN_API_SERVER_URL` — 地址查询 API
- `EXPLORE_MAINNET_WEBSOCKET_URL` — WS 实时推送

## useChainAssetByAddress（hooks/useChainAssetByAddress.ts）

通过 Value Chain RPC 批量读取地址的 ERC20 余额：
1. `getTradableTokensFromChain()` 获取 token 列表
2. `valueChainClient.readContract(BatchQuery.getBalancesOf)` 批量查余额
3. 添加 SOSO/WSOSO token（过滤 WSOSO 余额为 0 的情况）
4. 用 `tickerList` 价格计算总资产值（USD）

## 文件结构

```
src/pages/explorer/
├── index.tsx                           # 路由入口（BrowserRouter + Switch 6条路由）
├── Dashboard/index.tsx                 # 首页面板：搜索 + BlocksTable + TransactionsTable
├── BlocksPage/index.tsx                # 区块列表全页
├── BlockDetailPage/
│   ├── index.tsx                       # 区块详情 + 内嵌交易表
│   └── type.ts                         # BlockDetailResponse/BlockTransactionItem 等类型
├── TxsPage/index.tsx                   # 交易列表全页
├── TransactionDetailsPage/
│   ├── index.tsx                       # 交易详情（605行，最复杂）
│   ├── PayloadDetails.tsx              # Payload 通用渲染 + 枚举映射
│   └── types.ts                        # TXData/OrderSide/OrderType/TimeInForce 等
├── AddressTransactionsPage/
│   ├── index.tsx                       # 地址交易页 + 链上资产值
│   └── type.ts                         # AddressTransactionItem 等类型
└── components/
    ├── SearchNotFound/index.tsx        # 404 回退页
    ├── blockTypeTab/index.tsx          # Futures/Spot 切换 Tab
    ├── blocksTable/index.tsx           # WS 实时区块表（pako 解压 + 心跳）
    ├── transactionsTable/index.tsx     # WS 实时交易表
    └── transactionsTableHttp/index.tsx # HTTP 历史交易表（区块/地址双模式）

src/http/explorer/index.ts             # API 层（6个接口 + 类型定义）
src/hooks/useChainAssetByAddress.ts     # 链上资产查询 Hook
```

## 关键设计决策

1. **WS vs HTTP 双通道**：Dashboard 用 WS 实时推送（低延迟），详情页用 HTTP 查询历史（精确查询）
2. **pako gzip 解压**：WS 消息经 gzip 压缩传输，客户端用 pako 解压，减少带宽
3. **心跳 30s**：防止 WS 连接被代理/网关超时断开
4. **blocktype URL 参数**：全局通过 `?blocktype=futures|spot` 切换链类型，所有子页面继承
5. **搜索长度启发式**：根据输入字符串长度（≤9/≤42/>42）自动判断搜索类型，无需用户选择
6. **address 批量查询**：`getBatchAddressInfo` 一次请求获取区块内所有用户地址，避免 N+1 问题
7. **tx_count -1**：区块的交易数显示时减 1，过滤内部系统交易
8. **独立 BrowserRouter**：Explorer 使用自己的 BrowserRouter 包裹，与主应用路由隔离

## 开发修改指南

| 场景 | 入口 |
|------|------|
| 新增区块/交易字段 | `blocksTable` 或 `transactionsTable` 的 columns + WS 数据映射 |
| 修改交易 action 类型映射 | `TransactionDetailsPage/index.tsx` L102-157 + `transactionsTable` L27-33 |
| 新增 Payload 字段 | `PayloadDetails.tsx` 的 `fieldMappings` + `getFieldValue` |
| 修改 WS 订阅频道 | `blocksTable` L108-111 / `transactionsTable` L97-104 |
| 新增链类型（不只 spot/futures）| `blockTypeTab/index.tsx` + 各页面 blocktype 逻辑 |
| 修改搜索路由策略 | `Dashboard/index.tsx` L22-34 |
| 修改地址资产计算 | `hooks/useChainAssetByAddress.ts` |
| 新增 API 端点 | `http/explorer/index.ts` |

## 术语表

| 术语 | 含义 |
|------|------|
| Value Chain | SoDEX 自建的交易结算链 |
| snapshot_id | 区块号（对应传统区块链的 block number） |
| payload_id | 区块哈希 |
| tx_hash | 交易哈希 |
| tx_json | 交易数据的 JSON 字符串，解析后为 TXData |
| blocktype | 链类型：`futures`（合约链）或 `spot`（现货链），API 层转为 `perps`/`spot` |
| pako | JavaScript 的 zlib 实现库，用于 gzip 解压 WS 消息 |
| BatchQuery | Value Chain 上的合约，支持批量查询多个 ERC20 余额 |

## 更新记录

### 2026-04-10: 初始版本

初始文档，通过 /k/context learn 从代码自动生成
