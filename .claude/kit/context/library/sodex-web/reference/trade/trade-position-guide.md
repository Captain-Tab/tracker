# Trade Position Tab 仓位与订单面板

交易页面底部的多功能 Tab 面板组件，集成资产余额、持仓管理、订单管理、交易历史等核心功能模块。

## 架构概览

```
┌──────────────────────────────────────────────────────────────┐
│                    Position Component                         │
├──────────────────────────────────────────────────────────────┤
│  Tab Bar: [Balances] [Position] [Open Orders] [Trade History]│
│          [Funding History] [Order History] [Position History]│
│          [Deposits & Withdrawals]                            │
├──────────────────────────────────────────────────────────────┤
│                    Tab Content Area                          │
│  ┌─────────────────────────────────────────────────────────┐│
│  │  Asset / PositionTab / Order / OrderBill / OrderHistory ││
│  │  FundingHistory / PositionHistory / TransferHistory     ││
│  └─────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────┘
```

### 核心特性

1. **8 个功能 Tab**：覆盖交易所完整账户管理需求
2. **搜索过滤**：通用 `filterBySearch` 函数支持 coin/token/symbol 字段
3. **数据刷新**：手动刷新 + 事件总线自动刷新
4. **小余额隐藏**：`isHideSmallBalances` 过滤 < 1 USD 资产

## Tab 类型定义

```typescript
export type TabKey =
  | "order"           // Open Orders 当前委托
  | "orderRecord"     // Order History 历史委托
  | "orderBill"       // Trade History 成交记录
  | "asset"           // Balances 资产余额
  | "position"        // Position 当前持仓
  | "transferHistory" // Deposits & Withdrawals 充提记录
  | "fundingHistory"  // Funding History 资金费率
  | "positionHistory";// Position History 历史持仓
```

### Tab 与埋点映射

```typescript
const trackTabKeyMap = {
  order: "Open Orders",
  orderRecord: "Order History",
  orderBill: "Trade History",
  asset: "Balances",
  transferHistory: "Transfer History",
  position: "Position",
  fundingHistory: "Funding History",
  positionHistory: "Position History",
} as const;
```

## 核心数据流

### 数据获取方式

| Tab | 数据源 | 核心 Hook/方法 |
|-----|--------|----------------|
| **Balances** | spotAsset.fetchBalanceList | useMergedAssetsData |
| **Position** | futures.position.fetchPositionList | mergedPositionList |
| **Open Orders** | useAggList | aggListManager.requestAll |
| **Trade History** | history.getTradeHistoryList | tradeHistoryList |
| **Order History** | history.getOrderHistory | orderHistoryList |
| **Funding History** | futures.ticker.fetchFuturesFundingFees | futuresFundingRateList |
| **Transfer History** | spotOrder.fetchMergedTransferHistory | mergedTransferData |

### Transfer History 数据源（三源合并）

```
Source A: POST /biz/mirror/account_flow        — ERC-20 充提（USDC/BTC 等）
Source BC: POST /biz/mirror/combined_transfers  — fund_transfer + native_transfer 合并
```

**BC 接口包含两类数据**（`source` 字段区分）：

| source | 含义 | 包含内容 | 刷新触发方式 |
|--------|------|---------|-------------|
| `fund_transfer` | Spot ↔ Funding 划转 | 所有币种的资金账户与现货账户之间的划转（SOSO/USDC/ETH 等） | 用户操作后主动刷新 + WS 推送，无需轮询 |
| `native_transfer` | VALUE 链原生转账 | 仅 SOSO 的链上原生代币操作（deposit/withdraw/transfer/stake） | 无 WS 推送，依赖 NativeTransferPolling 轮询检测 |

fund_transfer 不需要轮询的原因：用户在平台内部发起（如点 Transfer 按钮），API 返回成功后前端立即刷新；WS `sodex_deposit/withdraw` 事件也会触发刷新。native_transfer 是外部链上转账，平台无法预知，只能轮询检测。

**合并逻辑**（`spotOrder.mergeTransferHistoryData`）：
1. A 记录优先加入 mergedData
2. 收集 A 的 txHash 到 `seenTxHash` Set
3. BC 记录过滤掉与 A 重复的 txHash 后合入
4. 按 timestamp 降序排序

**native_transfer 记录转换**（`convertTransferHistoryToMerged`）：
- `source === "native_transfer"` → token="SOSO", network="ValueChain", status="Completed"
- 零地址（`0x000...000`）和 WSOSO 地址 → 统一识别为 "SOSO"
- `actionType` 映射：deposit/withdraw/transfer/stake，transfer 按 sender/receiver 判断方向
- `resolveNativeActionType` 含空值防护（sender/userAddress 缺失回退 deposit）和白名单校验（未知类型回退 deposit）

### 聚合订单 Hook (useAggList)

```typescript
const {
  data: dataAgg,           // 聚合订单数据
  pageInfo: pageInfoAgg,   // 分页信息 { total, page, size }
  aggListManager,          // 管理器对象
  loading: loadingAgg,     // 加载状态
  setLoading: setLoadingAgg,
} = useAggList({
  state: undefined,
  onGetAllData: (data) => {
    setOpenOrderList(data); // 同步到全局 store
  },
});
```

## 搜索过滤实现

### 通用过滤函数

```typescript
const filterBySearch = useCallback(
  (data: any[], field: string) => {
    if (!searchValue || !data?.length) return data;
    const searchTerm = searchValue.toLowerCase();

    return data.filter((item: any) => {
      if (field === "coin") {
        return item.coin?.toLowerCase().includes(searchTerm);
      } else if (field === "token") {
        return item.token?.toLowerCase().includes(searchTerm);
      } else if (field === "symbol") {
        const coin = item.symbol?.split("_")[0];
        return (
          item.symbol?.toLowerCase().includes(searchTerm) ||
          coin?.toLowerCase().includes(searchTerm)
        );
      } else if (field === "_coin") {
        return (
          item._coin?.toLowerCase().includes(searchTerm) ||
          item.symbol?.toLowerCase().includes(searchTerm)
        );
      }
      return true;
    });
  },
  [searchValue],
);
```

### 各 Tab 过滤字段

| Tab | 过滤字段 | 说明 |
|-----|----------|------|
| Balances | coin | 币种名称 |
| Position | symbol | 交易对（如 BTC_USDC） |
| Open Orders | _coin | 币种或交易对 |
| Funding History | symbol | 交易对 |
| Transfer History | token | 充提币种 |

## 事件总线监听

### 自动刷新事件

```typescript
// WS 重连后刷新所有数据
eventBus.on(EventNames.WS_RECONNECTED_NOTICE, handleReconnect);

// 余额更新事件
eventBus.on(EventNames.BALANCE_UPDATED, () => {
  Promise.all([
    chainAsset.getBalances(true),
    spotAsset.fetchBalanceList(),
    balances.refetchValueChain({ pollUntilChanged: true }),
  ]);
});

// 订单刷新事件
eventBus.on(EventNames.ORDER_REFRESH, async () => {
  await aggListManager.requestAll();
  await getPositionList();
});

// 充值记录刷新（轮询检测到新 native_transfer 时触发）
eventBus.on(EventNames.DEPOSIT_RECORD_REFRESH, () => {
  spotOrder.fetchMergedTransferHistory();
});
```

### Native Transfer 轮询通知

`useNativeTransferPolling.ts` 在 `baseInfoRequester` 中随钱包地址启动/停止：

```typescript
// baseInfoRequester/index.tsx
if (user.address) {
  nativeTransferPolling.start(user.address, {
    onNewRecord: () => chainAsset.getBalances()
  });
} else {
  nativeTransferPolling.stop();
}
```

**detected 轻接口轮询策略**：

| 阶段 | 接口 | 说明 |
|------|------|------|
| 首次加载 | `combined_transfers` | 初始化 knownTxHashes（cachedBlockNumber 由首次 detected 设置） |
| 轮询检测（每3s） | `/chain/transfer/detected` | 仅返回 `{ latestBlockNumber }`，轻量级 |
| 条件拉取 | `combined_transfers` | 仅当 `latestBlockNumber > cachedBlockNumber` 时调用 |

流程：`start()` → 首次 `poll()` 初始化已知记录 → `loop(每3s)` → detected 检测 → `latestBlock > cachedBlockNumber` 时先更新 `cachedBlockNumber = latestBlock`，再调 `poll()`

> `cachedBlockNumber` 只由 detected 接口驱动（不由 fundTransfers blockNumber 驱动），确保比较双方使用同一数据源

**列表刷新与 toast 解耦**：`hasNewNativeRecord` 在 toast 去重检查之前赋值，确保即使 toast 被去重跳过，列表刷新（`DEPOSIT_RECORD_REFRESH`）和余额刷新（`onNewRecord`）仍会触发。

**Withdraw txHash 注入去重**：`WithdrawModal.tsx` SOSO 提现发送交易后立即调用 `addNotifiedTxHash(txHash)`，阻止轮询对同一笔交易弹重复 toast。

**四层 toast 防护**：

| 层 | 机制 | 解决的问题 |
|---|------|-----------|
| 1 | `knownTxHashes`（内存） | 同一轮询周期不重复 |
| 2 | 10 分钟时间窗口 | 历史记录不弹（登录/刷新） |
| 3 | `notifiedTxHashes`（WS/WithdrawModal 注入） | WS、轮询、WithdrawModal 不重复 toast |
| 4 | localStorage 持久化 | logout/re-login 不重复弹 |

### 跨页面通信

```typescript
// 切换到指定 Tab 并设置活跃交易对
eventBus.on(EventNames.SWITCH_TO_SOME_POSITION_TAB, (payload) => {
  tabHandleClick(payload.tabKey);
  setActiveSymbol(payload.symbol);
});

// 打开充提记录面板并滚动定位
eventBus.on(EventNames.OPEN_DEPOSIT_WITHDRAWAL_PANEL, () => {
  tabHandleClick("transferHistory");
  scrollToDepositWithdrawalAnchor();
});
```

## 小余额过滤

```typescript
export const SMALL_USD_VALUE_THRESHOLD = 1;

const visibleBalances = useMemo(() => {
  let filteredData = mergedAssetsData;

  if (ui.isHideSmallBalances) {
    filteredData = filteredData.filter((item) => {
      // SOSO 相关币种不参与过滤
      const isSOSOLike = item.coin.endsWith("SOSO");
      if (isSOSOLike) return true;

      const v = calculate(item.usdValue);
      if (v.lt(0)) return true;
      return v.gte(SMALL_USD_VALUE_THRESHOLD);
    });
  }

  return filteredData;
}, [mergedAssetsData, ui.isHideSmallBalances]);
```

## 合约类型切换处理

```typescript
// 从 Spot 切换到 Futures 时自动切换到 Position Tab
useEffect(() => {
  if (
    prevInstType &&
    prevInstType === InstTypeEnum.SPOT &&
    instType === InstTypeEnum.FUTURES
  ) {
    tabHandleClick("position");
  } else {
    tabHandleClick("asset");
  }
}, [instType, prevInstType]);

// Futures 用户持仓更新事件
useEffect(() => {
  if (instType === InstTypeEnum.FUTURES) {
    futuresUserWsDataEvent.on(
      FutureUserEventNames.USER_POSITION_UPDATED,
      () => {
        getPositionList().then(() => {
          updateActiveKey("position");
        });
      },
    );
  }
}, [instType]);
```

## 文件结构

```
src/pages/spot/main/position/
├── index.tsx                    # 主组件（Position）
├── index.module.scss            # 样式文件
│
└── tab/
    ├── asset/
    │   └── index.tsx            # Balances Tab
    │
    ├── positionTab/
    │   └── index.tsx            # Position Tab
    │
    ├── order/
    │   ├── index.tsx            # Open Orders Tab
    │   └── useAggList.ts        # 聚合订单 Hook
    │
    ├── orderBill/
    │   └── index.tsx            # Trade History Tab
    │
    ├── orderHistory/
    │   └── index.tsx            # Order History Tab
    │
    ├── positionHistory/
    │   └── index.tsx            # Position History Tab
    │
    ├── MyFundingHistory/
    │   └── index.tsx            # Funding History Tab
    │
    └── transferHistory/
        └── index.tsx            # Deposits & Withdrawals Tab
```

## Props 接口

```typescript
interface PositionProps {
  showRightBorder?: boolean;      // 是否显示右边框，默认 true
  from?: "portfolio";             // 来源页面（影响背景色和埋点）
  initialActiveTab?: TabKey;      // 初始激活的 Tab
  showSymbolSearch?: boolean;     // 是否显示搜索框，默认 false
}
```

## 关键设计决策

### 1. 为什么使用聚合订单 Hook？

**问题**：早期 Spot 订单和 Futures 订单分开管理，数据同步复杂。

**方案**：`useAggList` 统一管理所有订单类型，提供统一分页和状态管理。

### 2. 为什么 Transfer History 单独处理？

**原因**：
- Transfer 数据需要合并三个数据源（account_flow + fund_transfer + native_transfer）
- A 与 BC 的 txHash 去重（A 优先，保留 Pending 状态信息）
- 有 Pending 状态需要特殊显示（带数量角标）
- 需要支持滚动定位到充提锚点

### 4. 为什么轮询使用四层防护？

**问题**：native_transfer 无 WS 推送，依赖轮询检测新记录并弹 toast。多种场景导致重复通知：
- 同一轮询周期多次检测（层 1：内存 Set）
- 切账号/刷新页面加载历史记录（层 2：10 分钟窗口）
- WS 已推送的 ERC-20 充提 / WithdrawModal 已弹 toast 与轮询重叠（层 3：WS/WithdrawModal 注入 notifiedTxHashes）
- logout 后 re-login（层 4：localStorage 持久化，24 小时 TTL）

### 5. 为什么轮询使用 detected 轻接口？

**问题**：每次轮询都调 `combined_transfers` 重接口，大部分轮询周期无新记录，API 开销大。
**方案**：统一 3s 轮询 `/chain/transfer/detected` 轻接口（仅返回 `latestBlockNumber`），仅当 blockNumber 变化时才调 `combined_transfers` 拉取完整记录。减少约 93% 的重接口调用。

### 3. 搜索与 Tab 切换的 Key 机制

```typescript
// 每次搜索值变化时更新 searchKey
useEffect(() => {
  setSearchKey((prev) => prev + 1);
}, [searchValue]);

// 子组件通过 key 强制重新挂载
<OrderHistory key={`orderHistory-${searchKey}`} />
```

## 术语表

| 术语 | 说明 |
|------|------|
| **mergedAssetsData** | 合并后的资产数据（Funding + Spot + Perps） |
| **mergedPositionList** | 合并后的持仓列表 |
| **aggListManager** | 聚合订单管理器 |
| **PreTradeButton** | 交易前置检查按钮（钱包连接、开户等） |
| **filterBySearch** | 通用搜索过滤函数 |
| **SMALL_USD_VALUE_THRESHOLD** | 小余额阈值（1 USD） |
| **mergedTransferData** | 三源合并的充提记录（account_flow + fund_transfer + native_transfer） |
| **NativeTransferPolling** | native_transfer 轮询通知单例，detected 轻接口 3s 检测 + 条件触发 combined_transfers，四层 toast 防护 |
| **cachedBlockNumber** | 缓存的最新区块号，用于与 detected 接口返回值比较判断是否有新记录 |
| **getTransferDetected** | 轻量级检测接口（`/chain/transfer/detected`），仅返回 latestBlockNumber |
| **knownTxHashes** | 轮询内存去重集合，防止同周期重复处理 |
| **notifiedTxHashes** | 已通知 txHash 集合（WS 注入 + localStorage 持久化） |
| **resolveNativeActionType** | 统一方向映射工具函数（`src/utils/nativeTransfer.ts`） |

## 代码位置索引

| 功能 | 文件 | 行号 |
|------|------|------|
| TabKey 类型定义 | position/index.tsx | 52-60 |
| 小余额阈值常量 | position/index.tsx | 62 |
| 通用搜索过滤函数 | position/index.tsx | 487-514 |
| Tab 点击处理 | position/index.tsx | 334-415 |
| 数据刷新方法 | position/index.tsx | 419-471 |
| 小余额过滤逻辑 | position/index.tsx | 584-606 |
| 事件总线监听 | position/index.tsx | 633-717 |
| 聚合订单 Hook 使用 | position/index.tsx | 199-210 |
| Pending 转账过滤 | position/index.tsx | 75-77 |
| 滚动定位函数 | position/index.tsx | 79-124 |
| Transfer History Tab | transferHistory/index.tsx | — |
| Transfer 失败弹窗 | transferHistory/modals/Failed.tsx | — |
| native 轮询通知 | src/hooks/useNativeTransferPolling.ts | — |
| native 工具函数 | src/utils/nativeTransfer.ts | — |
| 数据合并逻辑 | src/models/spotOrder.ts | mergeTransferHistoryData |
| BC 合并接口 | src/http/user/index.ts | getCombinedTransferHistory |
| detected 检测接口 | src/http/user/index.ts | getTransferDetected |
| Withdraw txHash 注入 | src/pages/_components/withdraw/WithdrawModal.tsx | ~L1063 |
| Deposit 隐藏 min hint | src/pages/_components/deposit/DepositStepByStep.tsx | ~L2369 |
| 轮询启动集成 | src/components/baseInfoRequester/index.tsx | — |

## 更新记录

### 2026-04-15: 轮询优化 - detected 轻接口替代直接轮询

移除 boost/unboost 动态频率机制，改用 `/chain/transfer/detected` 轻量接口（3s 轮询）检测新区块，仅当 `latestBlockNumber > cachedBlockNumber` 时才调用 `combined_transfers`。新增 `getTransferDetected` HTTP 接口和 `TransferDetected` 类型。移除 DepositStepByStep 中的 boost/unboost useEffect。减少约 93% 的重接口调用。修复 cachedBlockNumber 驱动源：从 poll() 的 fundTransfers maxBlock 改为 loop() 的 detected latestBlock，避免两个接口 blockNumber 不一致导致重复拉取。TransferHistory 组件添加 isInitialMount ref，首次挂载跳过重复请求（由父组件 tabHandleClick 负责），钱包切换时仍正常请求。

### 2026-04-10: 轮询动态频率 + 多项修复

NativeTransferPolling 新增 boost/unboost 动态频率切换（SOSO+VC 弹窗 3s→关闭渐退→15s）。补充 combined_transfers 数据源细节（fund_transfer vs native_transfer 刷新机制）。修复 withdraw 重复 toast（txHash 注入去重）、列表刷新与 toast 解耦、resolveNativeActionType 空值防护、native_transfer 记录补齐 n 字段、Deposit 隐藏 SOSO+VC min deposit 提示、baseURL 环境切换。

### 2026-04-08: native_transfer 整合

Transfer History Tab 新增 native_transfer 数据源（BC 合并接口），支持 SOSO 原生充提记录展示、txHash 去重、轮询 toast 通知（四层防护）、余额自动刷新。

### 2026-02-25: 初始版本

初始文档，通过 /k/context learn 从代码自动生成
