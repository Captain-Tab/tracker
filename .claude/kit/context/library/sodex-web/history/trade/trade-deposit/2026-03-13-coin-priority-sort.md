# Deposit 币种优先排序 + 预设参数

**日期**: 2026-03-13 | **类型**: feat | **范围**: trade-deposit

---

## 变更概述

1. 优化 Deposit 弹窗的币种显示顺序，让热门币种标签和下拉列表都按统一的优先顺序排序
2. 新增 `coinSymbol` 和 `chainId` 参数，支持预设币种和链

---

## 核心变更

### 1. 提取优先币种常量

**文件**: `src/pages/_components/deposit/DepositStepByStep.tsx`

在组件外部定义常量，避免重复创建：

```typescript
const PRIORITY_COIN_SYMBOLS = ["USDC", "BTC", "ETH", "MAG7.ssi", "sMAG7.ssi", "SOSO", "sSOSO"];
```

### 2. 创建排序函数

**文件**: `src/pages/_components/deposit/DepositStepByStep.tsx`

复用排序逻辑，优先币种在前，其他币种在后：

```typescript
const sortCoinsByPriority = (coins: CoinInfoData[]): CoinInfoData[] => {
  const priority = coins.filter((coin) =>
    PRIORITY_COIN_SYMBOLS.some((symbol) => isEqualIgnoreCase(symbol, coin.coinSymbol))
  );
  const others = coins.filter(
    (coin) => !PRIORITY_COIN_SYMBOLS.some((symbol) => isEqualIgnoreCase(symbol, coin.coinSymbol))
  );
  return [...priority, ...others];
};
```

### 3. 应用到热门标签

**文件**: `src/pages/_components/deposit/DepositStepByStep.tsx`

简化 `popularCoins` 计算逻辑：

```typescript
const popularCoins = useMemo(() => {
  if (!filteredCoins) return [];
  return sortCoinsByPriority(filteredCoins).slice(0, 7);
}, [filteredCoins]);
```

### 4. 应用到下拉列表

**文件**: `src/pages/_components/deposit/DepositStepByStep.tsx`

`searchFilteredCoins` 也使用相同的排序：

```typescript
const searchFilteredCoins = useMemo(() => {
  let coins = filteredCoins;
  if (searchValue.trim()) {
    const lowerSearch = searchValue.toLowerCase();
    coins = filteredCoins.filter((coin) =>
      coin.coinSymbol.toLowerCase().includes(lowerSearch),
    );
  }
  return sortCoinsByPriority(coins);
}, [filteredCoins, searchValue]);
```

---

## 显示效果

| 场景 | 排序规则 |
|------|----------|
| 热门标签 | USDC → BTC → ETH → MAG7.ssi → sMAG7.ssi → SOSO → sSOSO（最多 7 个） |
| 下拉列表 | 同上顺序，然后是其他币种（支持搜索过滤） |

---

## 设计决策

### 为什么在组件外部定义常量和函数

- **性能优化**：避免每次渲染重新创建
- **代码复用**：`popularCoins` 和 `searchFilteredCoins` 使用同一逻辑
- **便于维护**：修改优先顺序只需改一处

### 为什么选择这 7 个币种

- 覆盖主流币种（USDC、BTC、ETH）
- 包含平台特色币种（MAG7.ssi、sMAG7.ssi、SOSO、sSOSO）
- 与业务需求对齐

---

## 新增：预设币种和链参数

### 5. 新增 Props 参数

**文件**: `src/pages/_components/deposit/DepositStepByStep.tsx`

```typescript
interface DepositStepByStepProps extends InjectModalProps {
  coin?: CoinInfoData;
  coinSymbol?: string;  // 新增：预设币种符号
  chainId?: string;     // 新增：预设链标识
}
```

### 6. 参数处理逻辑

**文件**: `src/pages/_components/deposit/DepositStepByStep.tsx`

新增 useEffect 处理 `coinSymbol` 和 `chainId` 参数：

```typescript
useEffect(() => {
  if (!propsCoinSymbol || dataLoading || !allCoins?.length) return;
  if (propsCoin) return; // coin 参数优先

  const targetCoin = allCoins.find(
    (c) => c.coinSymbol.toUpperCase() === propsCoinSymbol.toUpperCase()
  );
  if (!targetCoin) return;

  flowDispatch({ type: "SELECT_COIN", payload: targetCoin });

  if (propsChainId && targetCoin.chains?.length) {
    const targetChain = targetCoin.chains.find((c) => c.chain === propsChainId);
    if (targetChain) {
      flowDispatch({ type: "SELECT_CHAIN", payload: targetChain });
    }
  }
}, [propsCoinSymbol, propsChainId, propsCoin, dataLoading, allCoins]);
```

### 7. 调用示例

**文件**: `src/pages/stake/StakingHero.tsx`

```typescript
const handleDepositIntoValueChain = () => {
  depositModal.open({ coinSymbol: "sSOSO", chainId: "BASE_ETH" });
};
```

---

## 文件变更列表

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `src/pages/_components/deposit/DepositStepByStep.tsx` | 修改 | 新增常量、排序函数、`coinSymbol`/`chainId` 参数 |
| `src/pages/stake/StakingHero.tsx` | 修改 | 调用 depositModal 时传入预设参数 |

---

## 关联文档

- **Reference**: `.cursor/kit/context/library/sodex-web/reference/trade/trade-deposit-guide.md`
