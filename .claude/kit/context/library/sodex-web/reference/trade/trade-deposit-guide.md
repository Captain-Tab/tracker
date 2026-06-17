# Trade Deposit 功能指南

## 📋 概述

Trade Deposit 是主站充值功能，支持用户将外部钱包资产充值到交易所。包含两种充值方式：
- **Regular**: 生成充值地址二维码，用户从外部钱包转账
- **Flash**: 连接钱包直接签名转账，即时到账

---

## 🪙 币种与链数据结构

### 币种数据 (CoinInfoData)

```typescript
interface CoinInfoData {
  coinSymbol: string;      // 币种符号，如 "USDC", "SOSO"
  token: Address;          // 代币合约地址
  chains: ChainInfo[];     // 支持的链列表
  logo: string;            // 币种 logo URL
  decimals?: number;       // 代币精度（默认 18）
}
```

### 链数据 (ChainInfo)

```typescript
interface ChainInfo {
  chain: string;           // 链标识，如 "BASE_ETH", "ETH"
  coinAddr: string;        // 代币在该链上的合约地址
  bridgeAddr: string;      // 跨链桥合约地址
  maxDepositAmount: string;// 可充值金额（格式化后）
  maxDepositRaw: bigint;   // 可充值金额（原始值）
  logo: string;            // 链 logo URL
  formattedChain: string;  // 格式化链名，如 "Base", "Ethereum"
  enableRegular: boolean;  // 是否支持 Regular 充值
  enableFlash: boolean;    // 是否支持 Flash 充值
}
```

### 链 ID 映射

| 链标识 | Chain ID | 显示名称 |
|--------|----------|----------|
| `BASE_ETH` | `8453` (Base) | Base |
| `ETH` | `1` (Mainnet) | Ethereum |
| `ARBITRUM_ETH` | `42161` (Arbitrum) | Arbitrum |
| `VALUECHAIN` | `286623` (ValueChain mainnet) / `138565` (testnet) | ValueChain |

---

## 🔗 API 接口汇总

### 充值地址相关

| 接口 | 方法 | 路径 | 说明 |
|------|------|------|------|
| `createDepositAddress` | POST | `/biz/mirror/create_deposit_address` | 生成充值地址 |
| `fetchDepositAddress` | POST | `/biz/mirror/deposit_address` | 查询地址状态 |
| `replaceDepositAddress` | POST | `/biz/mirror/replace_deposit_address` | 替换可疑地址 |
| `createDepositAddresses` | POST | `/biz/mirror/create_deposit_addresses` | 批量生成地址 |

### 充值接受状态

| 接口 | 方法 | 路径 | 说明 |
|------|------|------|------|
| `getDepositAcceptStatus` | GET | `/biz/config/deposit/status` | 获取已接受的币种-链列表 |
| `updateDepositAcceptStatus` | POST | `/biz/config/deposit/status` | 更新接受状态 |

### 充值记录

| 接口 | 方法 | 说明 |
|------|------|------|
| `fetchDepositWithdrawRecord` | POST | 获取充提记录（用于首次充值检测） |

---

## 📜 合约交互

### 充值地址获取

| 合约 | 方法 | 用途 |
|------|------|------|
| `portalContract` | `getDepositWallets` | 获取普通代币充值地址 |
| `sosoDepositContract` | `getDepositWallet` | 获取 SOSO 专用充值地址 |

### Flash 充值

| 合约 | 方法 | 用途 |
|------|------|------|
| `erc20` | `approve` | 授权代币转账额度 |
| `bridgeContract` | `bridge` | 普通代币 Flash 充值 |
| `bridgeContract` | `bridgeNativeToken` | SOSO 代币 Flash 充值 |
| `bridgeContract` | `bridgeNativeStakeToken` | sSOSO 代币 Flash 充值 |

### SOSO + ValueChain 配置

集中配置文件 `_config/sosoValueChainConfig.ts`：

| 导出 | 用途 |
|------|------|
| `VALUE_CHAIN_INFO` | 硬编码的 ValueChain ChainInfo（enableFlash: false，仅 Regular） |
| `VALUE_CHAIN_DEPOSIT_TIME` | 固定充值时间 2 分钟 |
| `VALUE_CHAIN_HINT_I18N_KEY` | 橙色提示框 i18n key（提示存入 EVM Funding） |
| `isSosoValueChain(coinSymbol, chainName)` | 判断是否为 SOSO + ValueChain 组合 |
| `shouldAppendValueChain(coinSymbol)` | 判断是否需要追加 ValueChain 到链列表 |

网络配置 `src/config/networks.ts`：

| 配置 | 值 |
|------|-----|
| `VALUE_CHAIN_MAINNET` | chainId: 286623, RPC: `https://mainnet.valuechain.xyz/` |
| `VALUE_CHAIN_TESTNET` | chainId: 138565, RPC: `https://testnet-v2.valuechain.xyz/` |
| `VALUE_CHAIN_NETWORK` | 根据 `__IS_TESTNET__` 运行时选择 |

---

## 🔢 币种排序规则

### 优先币种列表

```typescript
// 组件外部定义的常量
const PRIORITY_COIN_SYMBOLS = ["USDC", "BTC", "ETH", "MAG7.ssi", "sMAG7.ssi", "SOSO", "sSOSO"];
```

### 排序函数

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

### 应用场景

| 场景 | 变量 | 说明 |
|------|------|------|
| 热门币种标签 | `popularCoins` | 优先显示 + 截取前 7 个 |
| 下拉列表 | `searchFilteredCoins` | 按优先顺序排序（支持搜索过滤） |

---

## 🎯 预设币种和链参数

### Props 定义

```typescript
interface DepositStepByStepProps extends InjectModalProps {
  coin?: CoinInfoData;      // 完整币种对象（优先级最高）
  coinSymbol?: string;      // 币种符号（如 "sSOSO"）
  chainId?: string;         // 链标识（如 "BASE_ETH"）
  lockedCoin?: boolean;     // 锁定币种选择，禁止切换
  lockedChain?: boolean;    // 锁定链选择，禁止切换
}
```

### 使用方式

```typescript
// 方式1：传入完整币种对象（现有方式）
depositModal.open({ coin: targetCoin });

// 方式2：传入币种符号和链标识
depositModal.open({ coinSymbol: "sSOSO", chainId: "BASE_ETH" });

// 方式3：锁定币种和链（用户不可切换）
depositModal.open({ 
  coinSymbol: "sSOSO", 
  chainId: "ValueChain",
  lockedCoin: true,
  lockedChain: true 
});
```

### 处理逻辑

1. **优先级**：`coin` 参数优先于 `coinSymbol`
2. **查找机制**：从 `allCoins` 中按 `coinSymbol` 查找币种（不区分大小写）
3. **链选择**：如果同时传入 `chainId`，自动选择对应的链
4. **依赖等待**：等待 `allCoins` 加载完成后再执行查找
5. **锁定模式**：`lockedCoin`/`lockedChain` 为 true 且有预设值时，禁用对应下拉框点击和箭头图标

---

## 🎯 特殊币种处理规则

| 币种 | 特殊逻辑 |
|------|---------|
| **SOSO** | 固定最小充值 1，使用专用合约 `sosoDepositContract`，精度保留 4 位小数 |
| **SOSO + ValueChain** | 见下方详细说明 |
| **XRP** | 地址格式 `address:memo`，需拆分处理，显示 Memo 输入 |
| **XLM** | 首次充值提示检测，显示特殊警告 |
| **MAG7.ssi / sMAG7.ssi** | 强制 `enableRegular = false`，只支持 Flash |

### SOSO + ValueChain 硬编码逻辑

当 `isSosoValueChain(coinSymbol, chainName)` 为 true 时，以下行为被硬编码覆盖：

| 行为 | 标准流程 | ValueChain 覆盖 |
|------|---------|----------------|
| 充值方式 | Regular + Flash | 仅 Regular（`enableFlash: false`） |
| 充值地址 | API 返回的 depositWallet | 用户自己的钱包地址（`address`） |
| 地址状态检查 | fetchDepositAddress → Suspicious 检测 | 跳过（ValueChain 无中间地址） |
| 确认蒙层 | AddressChangedTip / ConfirmationOverlay | 跳过，直接显示二维码 |
| 充值时间 | `getDepositTime(chain)` 动态获取 | 固定 2 分钟（`VALUE_CHAIN_DEPOSIT_TIME`） |
| 最小充值提示 | 显示 `minDepositAmount` | 隐藏（传 `undefined`） |
| 充值状态追踪 | API 轮询充值记录 | 事件驱动：监听 `NATIVE_TRANSFER_ARRIVED` |
| UI 提示 | 无 | 橙色提示框："SOSO deposited via Valuechain will default to your EVM Funding" |

**链注入逻辑**（`useFundingToken.ts`）：
- `shouldAppendValueChain("SOSO")` 返回 true 时，自动将 `VALUE_CHAIN_INFO` 追加到 SOSO 的链列表
- 防重复：先检查 `sosoChains` 中是否已存在 ValueChain

**充值状态检测**（`WaitingTransferStatus.tsx`）：
- SOSO + ValueChain 跳过标准 `DEPOSIT_RECORD_REFRESH` 事件轮询
- 改为监听 `NATIVE_TRANSFER_ARRIVED` 事件
- 过滤条件：`payload.receiver === address` 且 `actionType` 为 `deposit` 或 `transfer`
- 匹配时设置 `status = "completed"`

---

## 🏗️ 组件架构

### 状态管理（3 个 Reducer）

| Reducer | 职责 |
|---------|------|
| `depositFlowReducer` | 流程控制（步骤、币种/链选择、下拉框） |
| `addressStatusReducer` | 地址状态（Suspicious 检测、蒙层、确认） |
| `depositFormReducer` | 表单状态（金额、错误、loading） |

### 核心 Hooks

| Hook | 职责 |
|------|------|
| `useFundingToken` | 获取币种列表、注入余额、应用过滤规则 |
| `useDeposit` | 充值地址获取、Flash 充值执行 |
| `useDepositAcceptState` | 币种-链组合的接受状态管理 |
| `useTokenConfig` | 获取最小充值金额、链配置 |

---

## 🔄 充值流程

### 三步流程

```
Step 1: Select Coin  →  Step 2: Select Chain  →  Step 3: Deposit
      (选择币种)            (选择链)              (充值)
```

### 充值方式判断

```typescript
// 只支持 Flash
const isFlashOnly = !selectedChain.enableRegular && selectedChain.enableFlash;

// 支持两种方式
const supportsBothModes = selectedChain.enableRegular && selectedChain.enableFlash;

// 只支持 Regular
const isRegularOnly = selectedChain.enableRegular && !selectedChain.enableFlash;
```

### Flash 充值流程

```
1. switchToTargetNetwork(targetChainId)  // 切换网络
2. setFlashDepositStatus("approving")    // 开始授权
3. 检查 allowance，不足则执行 approve
4. setFlashDepositStatus("confirming")   // 等待确认
5. 调用 bridgeAddr 的 bridge/bridgeNativeToken
6. setFlashDepositStatus("proceeding")   // 等待上链
7. waitForTransactionReceipt            // 等待交易确认
8. 成功 → 切换到 transferHistory tab
```

### SOSO 代币特殊处理

SOSO 代币在获取地址和 Flash 充值时有独立逻辑：

**获取充值地址**：
```typescript
// 普通代币
depositDatum = await portalContract.getDepositWallets({ account, coinSymbol });

// SOSO 代币 - 使用专用合约
[depositDatumSOSO_BASE, depositDatumSOSO_ETH] = await Promise.all([
  sosoDepositContract.getDepositWallet({ account, chain: "BASE_ETH" }),
  sosoDepositContract.getDepositWallet({ account, chain: "ETH" }),
]);
```

**Flash 充值合约调用**：
```typescript
const isSoso = data.coin.coinSymbol === "SOSO";

// 函数名不同
const functionName = isSoso ? "bridgeNativeToken" : "bridge";

// 参数不同：SOSO 不传 coinSymbol
const args = isSoso
  ? [address, amountRaw, toClob]                    // 3 个参数
  : [coinSymbol, address, amountRaw, toClob];       // 4 个参数
```

**其他差异**：
- 精度：SOSO 使用 `data.coin.decimals`，其他代币调用 `erc20Decimals(coinAddr)`
- 最小充值：SOSO 固定为 1

### Regular 充值流程

```
1. 检查地址状态 (fetchDepositAddress)
2. 如果 Suspicious → 显示 AddressChangedTip → 用户确认
3. 确认后 → replaceDepositAddress → 轮询等待 Enabled
4. 获取充值地址 (getDepositWallets)
5. 显示二维码 (DepositAddressQR)
6. 用户从外部钱包转账
```

### 地址轮询机制

`generateDepositAddress` 使用轮询获取充值地址：

**配置参数**：
```typescript
const maxAttempts = requestOnMount ? 1 : 30;  // 首次挂载只请求1次，后续最多30次
const pollInterval = 5000;                     // 每次间隔 5 秒
// 总超时 = 30 × 5s = 150秒（2.5分钟）
```

**终止条件**（满足任一即停止）：
1. **获取到地址** - `depositDatum[chain].depositWallet` 存在
2. **组件卸载** - `pollingRef.current = false`
3. **达到最大次数** - `attempt >= maxAttempts`
4. **发生错误** - catch 块中 `pollingRef.current = false`

**缓存机制**：
```typescript
// 使用 ref 缓存，防止重复请求
const depositAddressesRef = useRef<Record<string, DepositDatum>>({});

// 请求前检查缓存
if (depositAddressesRef.current[depositChain] && !forceRefresh) {
  return depositAddressesRef.current[depositChain];
}
```

**轮询流程**：
```
尝试获取地址 (合约调用)
    ↓
有地址？ → 是 → 缓存 + 返回
    ↓ 否
状态非 Enabled？ → 调用 createDepositAddress API
    ↓
sleep(5000) → 继续下一次
```

---

## 🛡️ 地址状态检查

### 状态类型

| 状态 | 说明 |
|------|------|
| `Enabled` | 正常状态，可直接使用 |
| `Suspicious` | 可疑地址，需要用户确认更换 |

### 检查流程

```typescript
// 1. 检查地址状态
const result = await fetchDepositAddress({ account, chain });

if (result.data?.status === "Suspicious") {
  // 2. 显示地址变更提示
  addressDispatch({ type: "SET_ADDRESS_CHANGED", payload: true });
}

// 3. 用户确认后调用
await replaceDepositAddress({ account, chain });

// 4. 轮询等待 Enabled（每 2 秒）
while (status !== "Enabled") {
  await sleep(2000);
  result = await fetchDepositAddress({ account, chain });
}
```

---

## 🚫 充值过滤规则

### 黑名单格式

| 格式 | 说明 |
|------|------|
| `["LINK"]` | LINK 整体不显示 |
| `["BASE_ETH/USDC"]` | USDC 的 Base 链隐藏 |
| `["BASE_ETH/USDC-regular"]` | USDC Base 链的 Regular 方式隐藏 |
| `["BASE_ETH/USDC-flash"]` | USDC Base 链的 Flash 方式隐藏 |

### 过滤流程

1. 白名单过滤（非空时只保留白名单币种）
2. 整币种黑名单过滤
3. 链级黑名单过滤
4. Regular/Flash 方式过滤

### 警告配置

| 配置项 | 格式 | 说明 |
|--------|------|------|
| `contractWarningList` | `["BASE_ETH/ETH"]` | 合约钱包警告 |
| `memoWarningList` | `["XRP", "XLM"]` | Memo 警告 |

---

## 📁 文件结构

```
src/pages/_components/deposit/
├── DepositStepByStep.tsx              # 主组件（1962行）
├── DepositStepByStepSkeleton.tsx      # 骨架屏
├── DepositConfirmationOverlay.tsx     # 确认蒙层
├── _reducers/
│   ├── depositFlowReducer.ts          # 流程状态
│   ├── addressStatusReducer.ts        # 地址状态
│   └── depositFormReducer.ts          # 表单状态
├── _config/
│   └── sosoValueChainConfig.ts        # SOSO + ValueChain 硬编码配置
├── _hooks/
│   ├── useDeposit.ts                  # 充值核心逻辑
│   ├── useDepositAcceptState.ts       # 接受状态管理
│   └── useDropdownPosition.ts         # 下拉框定位
├── WaitingTransferStatus.tsx          # 充值状态追踪（含 ValueChain 事件监听）
└── _components/
    ├── CoinDropdown.tsx               # 币种下拉
    ├── ChainDropdown.tsx              # 链下拉
    ├── DepositModeSelector.tsx        # 方式选择
    ├── DepositModeToggle.tsx          # 方式切换
    ├── FlashDepositInput.tsx          # Flash 输入
    ├── FlashDepositButton.tsx         # Flash 按钮
    ├── DepositAddressQR.tsx           # 二维码
    ├── AddressChangedTip.tsx          # 地址变更提示
    └── OngoingDeposits.tsx            # 进行中记录
```

---

## 🎨 UI 显示逻辑

### 主组件条件渲染

```
dataLoading?
├─ true  → <DepositStepByStepSkeleton />
└─ false ↓

showAllRecords?
├─ true  → <OngoingDeposits forceShowAllRecords />
└─ false ↓

isProcessing (flashDepositStatus)?
├─ true  → <TransactionProcess />
└─ false → 主界面
```

### Step 3 Deposit 显示逻辑

```
selectedChain && selectedCoin?
├─ isFlashOnly
│   └─ FlashDepositInput + FlashDepositButton
│
├─ supportsBothModes && depositMode === null
│   └─ DepositModeSelector
│
├─ supportsBothModes && depositMode === "flash"
│   └─ DepositModeToggle + FlashDepositInput + FlashDepositButton
│
└─ Regular 模式
    └─ MaskBox
        ├─ maskContent: AddressChangedTip 或 DepositConfirmationOverlay
        └─ children: DepositHeader + DepositAddressQR
```

---

## 📝 术语表

| 术语 | 说明 |
|------|------|
| **Regular** | 常规充值，生成二维码地址，用户外部转账 |
| **Flash** | 快速充值，连接钱包签名，链上直接转账 |
| **Suspicious** | 可疑地址状态，需要用户确认更换 |
| **Accept Status** | 用户对币种-链组合的"已接受"记录 |
| **formattedChain** | 格式化链名（BASE_ETH → Base） |
| **enableRegular/enableFlash** | 链是否支持对应充值方式 |
| **minDepositAmount** | 最小充值金额（从 API 获取） |
| **maxDepositAmount** | 最大可充值金额（链上余额） |

---

## 📍 代码位置索引

| 功能 | 文件路径 |
|------|----------|
| 主组件 | `src/pages/_components/deposit/DepositStepByStep.tsx` |
| 流程 Reducer | `src/pages/_components/deposit/_reducers/depositFlowReducer.ts` |
| 地址 Reducer | `src/pages/_components/deposit/_reducers/addressStatusReducer.ts` |
| 表单 Reducer | `src/pages/_components/deposit/_reducers/depositFormReducer.ts` |
| 充值 Hook | `src/pages/_components/deposit/_hooks/useDeposit.ts` |
| 接受状态 Hook | `src/pages/_components/deposit/_hooks/useDepositAcceptState.ts` |
| 币种列表 Hook | `src/pages/_components/hooks/useFundingToken.ts` |
| 过滤规则 | `src/pages/_components/helper/depositFilter.ts` |
| 类型定义 | `src/pages/_components/type.ts` |
| 弹窗导出 | `src/components_tw/modals/spot/index.tsx` |
| 充值 API | `src/http/futures/index.ts` (L1369-1410) |
| 接受状态 API | `src/http/deposit/index.ts` |
| ValueChain 配置 | `src/pages/_components/deposit/_config/sosoValueChainConfig.ts` |
| ValueChain 网络 | `src/config/networks.ts` |
| ValueChain 合约 | `src/config/contracts.ts` |
| 充值状态追踪 | `src/pages/_components/deposit/WaitingTransferStatus.tsx` |
| AppKit 配置 | `src/config/appkit.ts` |

---

## 📅 创建记录

- **创建日期**: 2026-02-24
- **最后更新**: 2026-04-08
- **版本**: 1.4

### 更新记录

| 日期 | 版本 | 内容 |
|------|------|------|
| 2026-04-08 | 1.4 | 完善 SOSO + ValueChain 硬编码逻辑文档（配置、链注入、状态检测、UI 覆盖） |
| 2026-03-25 | 1.3 | 添加 lockedCoin/lockedChain Props 支持锁定选择 |
| 2026-03-25 | 1.2 | 添加 SOSO + ValueChain 硬编码充值支持 |
| 2026-03-13 | 1.1 | 添加币种排序规则（PRIORITY_COIN_SYMBOLS） |
| 2026-02-24 | 1.0 | 初始版本 |
