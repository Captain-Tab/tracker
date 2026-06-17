# useFundingToken 核心逻辑指南

## 📋 概述

`useFundingToken` 是充值/提现功能的币种数据源 Hook，负责：
- 从合约获取所有可充值币种
- 注入 SOSO 原生代币数据
- 注入链上余额
- 应用黑白名单过滤规则
- 获取代币精度

---

## 🔄 数据流

```
┌─────────────────────────────────────────────────────────────────┐
│                      useFundingToken                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. getAllCoins()              2. listRemoteNativeTokens()      │
│     ↓ (Value Chain)               ↓ (Value Chain)               │
│  originalTokenList             remoteNativeTokens (SOSO)        │
│     ↓                             ↓                             │
│  ├─────────────── 合并 ──────────┤                              │
│                 ↓                                               │
│           注入 logo (coinLogosUrlsUpperCaseKey)                 │
│                 ↓                                               │
│           withLogoTokenList                                     │
│                 ↓                                               │
│  3. injectDepositBalance()                                      │
│     ├─ filterTokensByRules() 应用黑白名单                        │
│     ├─ 批量读取链上 decimals                                     │
│     ├─ 批量读取链上 balanceOf                                    │
│     └─ 设置 maxDepositAmount / enableRegular / enableFlash      │
│                 ↓                                               │
│  4. getDecimals() 批量获取代币精度                               │
│                 ↓                                               │
│           tokenList (最终输出)                                   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 📜 合约调用

### 1. getAllCoins - 获取所有币种

```typescript
useReadContract({
  address: SODEX_TOKEN_QUERY_CONTRACT_ADDRESS,
  abi: sodexTokenQueryAbi,
  functionName: "getAllCoins",
  chainId: VALUE_CHAIN_NETWORK.id,
});
```

**返回**: `CoinInfo[]` - 所有可充值币种（不含 SOSO）

### 2. listRemoteNativeTokens - 获取 SOSO 链配置

```typescript
useReadContract({
  address: SOSO_DEPOSIT_CONTRACT_ADDRESS,  // CONTRACTS_BY_FUNCTION.FUNDING.SOSO_DEPOSIT.address
  abi: sosoDepositQueryAbi,
  functionName: "listRemoteNativeTokens",
  chainId: VALUE_CHAIN_NETWORK.id,
});
```

**返回**: `RemoteNativeToken[]` - SOSO 在各链的配置

```typescript
interface RemoteNativeToken {
  chain: string;           // "BASE_ETH" | "ETH"
  coinAddr: string;        // 代币地址
  bridgeAddr: string;      // 桥合约地址
  custodyDisabled: boolean;
  minDepositAmount: bigint;
  custodyAmount: bigint;
  bridgedAmount: bigint;
}
```

### 3. 批量读取余额

```typescript
// 使用 wagmi readContracts 批量读取
const batchResult = await readContracts(wagmiConfig, {
  contracts: [
    // decimals 合约调用
    ...chains.map(chain => ({
      address: chain.coinAddr,
      abi: erc20Abi,
      functionName: "decimals",
      chainId: findChainId(chain.chain),  // BASE_ETH → base.id, 其他 → mainnet.id
    })),
    // balanceOf 合约调用
    ...chains.map(chain => ({
      address: chain.coinAddr,
      abi: erc20Abi,
      functionName: "balanceOf",
      chainId: findChainId(chain.chain),
      args: [owner],
    })),
  ],
});
```

### 4. getDecimals - 批量获取代币精度

```typescript
const tokenInfos = await valueChainClient.readContract({
  address: BATCH_QUERY_ADDRESS,
  abi: batchQueryAbi,
  functionName: "getTokenInfo",
  args: [tokenAddresses],  // 排除 SOSO
});
```

---

## 🎯 关键处理逻辑

### SOSO 特殊注入

SOSO 不在 `getAllCoins` 返回中，需要单独处理：

```typescript
const withLogoRemoteNativeTokenList = {
  chains: remoteNativeTokens || [],
  coinSymbol: 'SOSO',
  logo: coinLogosUrlsUpperCaseKey['SOSO'],
  decimals: 18,
};

// 合并到 tokenList
withLogoTokenList = originalTokenList.concat(withLogoRemoteNativeTokenList);
```

### MAG7 强制禁用 Regular

```typescript
const isMag7Coin = token.coinSymbol === "sMAG7.ssi" || token.coinSymbol === "MAG7.ssi";
if (isMag7Coin) {
  chain.enableRegular = false;
}
```

### enableFlash 默认逻辑

```typescript
if (chain.enableFlash === undefined) {
  chain.enableFlash = Boolean(chain?.bridgeAddr);  // 有桥地址才支持 Flash
}
```

### SOSO 余额精度

```typescript
if (token.coinSymbol === 'SOSO') {
  chain.maxDepositAmount = parseFloat(formattedAmount)?.toFixed(4);  // 4 位小数
} else {
  chain.maxDepositAmount = formattedAmount;
}
```

---

## 🔗 链 ID 映射

```typescript
const findChainId = (chainName?: string) => {
  switch (chainName) {
    case "BASE_ETH":
      return base.id;      // 8453
    default:
      return mainnet.id;   // 1
  }
};
```

| 链标识 | Chain ID | 说明 |
|--------|----------|------|
| `BASE_ETH` | 8453 | Base 链 |
| `ETH` | 1 | 以太坊主网 |
| 其他 | 1 | 默认主网 |

---

## ⏱️ 加载状态判断

```typescript
const isLoading = useMemo(() => {
  // 1. tokenList 为空 → 加载中
  if (!tokenList.length) return true;
  
  // 2. getAllCoins 未完成
  if (!originalTokenList?.length) return true;
  
  // 3. listRemoteNativeTokens 未完成
  if (!remoteNativeTokens?.length) return true;
  
  // 4. tokenList 只有 SOSO，但 originalTokenList 有数据 → 等待 updateDepositBalance
  const onlySOSO = tokenList.length === 1 && tokenList[0]?.coinSymbol === 'SOSO';
  if (onlySOSO && originalTokenList.length > 0) return true;
  
  return false;
}, [tokenList, originalTokenList, remoteNativeTokens]);
```

---

## 🚫 过滤规则应用

在 `injectDepositBalance` 中调用：

```typescript
const filteredTokens = depositRules
  ? filterTokensByRules(tokenList, depositRules)
  : tokenList;
```

过滤规则来源：
```typescript
const depositList = trade?.coinBlacklist?.depositList;
const parsedDepositRules = parseDepositRules(depositList);
```

---

## 📤 返回值

```typescript
return {
  updateDepositBalance,  // 手动刷新余额
  query: {
    getAllCoins: fetchTokenList,           // 重新获取币种列表
    allCoins: tokenList,                   // 最终币种列表（含余额、过滤后）
    allCoinsLoading: !tokenList.length,    // 简单 loading
    dataLoading: isLoading,                // 精确 loading（推荐使用）
    listRemoteNativeTokens: fetchRemoteNativeTokens,
    remoteNativeTokens: withLogoRemoteNativeTokenList,
    remoteNativeTokensLoading: !remoteNativeTokens?.length,
  },
};
```

---

## 🐛 常见问题定位

| 问题 | 检查点 |
|------|--------|
| 币种列表为空 | `getAllCoins` 合约调用是否成功 |
| SOSO 不显示 | `listRemoteNativeTokens` 是否返回数据 |
| 余额显示 0 | `injectDepositBalance` 的 `readContracts` 是否成功 |
| 某币种不显示 | `filterTokensByRules` 是否被过滤、黑名单配置 |
| Flash 不可用 | `chain.bridgeAddr` 是否存在 |
| Regular 不可用 | MAG7 币种强制禁用、或被 regularBlacklist 过滤 |
| 一直 loading | 检查 `isLoading` 的 4 个条件 |

---

## 📁 相关文件

| 文件 | 说明 |
|------|------|
| `src/pages/_components/hooks/useFundingToken.ts` | 主 Hook |
| `src/pages/_components/helper/depositFilter.ts` | 过滤规则处理 |
| `src/pages/_components/type.ts` | CoinInfo/CoinInfoData 类型 |
| `src/abi/ISoDexTokenQuery.json` | getAllCoins ABI |
| `src/abi/ISosoDepositQuery.json` | listRemoteNativeTokens ABI |
| `src/abi/BatchQuery_abi.json` | getTokenInfo ABI |
| `src/config/contracts.ts` | 合约地址配置 |

---

## 📅 创建记录

- **创建日期**: 2026-02-24
- **版本**: 1.0
