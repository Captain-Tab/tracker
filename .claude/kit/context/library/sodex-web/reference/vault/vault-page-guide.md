# Vault SLP 页面

## 架构概览

独立页面（路由 `/vault`），展示 SoDEX Liquidity Provider (SLP) Vault 的数据面板和操作入口。

```
┌───────────────────────────────────────────────────────┐
│  Vault (index.tsx)  页面入口                            │
│                                                        │
│  ┌─ SLP ──────────────────────────────────────────┐   │
│  │  标题 + Vault 地址 + 操作按钮                      │   │
│  │  (Get MAG7.ssi / Withdraw / Deposit to SLP)    │   │
│  │                                                 │   │
│  │  DataViewGroup: TVL / 1Y Return / NAV / Price   │   │
│  │                                                 │   │
│  │  StatusBar 区域:                                 │   │
│  │  - Deposit 交易状态 (processing/completed)       │   │
│  │  - CoolDown 倒计时状态                           │   │
│  │  - ValueChain sMAG7 余额提示                     │   │
│  │  - Base Chain sMAG7 余额提示                     │   │
│  └─────────────────────────────────────────────────┘   │
│                                                        │
│  ┌─ Tabs ─────────────────────────────────────────┐   │
│  │  [My Position] [Overview] [Activity] [Depositors]│   │
│  │                                                 │   │
│  │  My Position: 我的存款 + PNL + ROI + 图表        │   │
│  │  Overview: 全局 TVL/NAV 图表                     │   │
│  │  Activity: 全部/我的操作记录表格                   │   │
│  │  Depositors: 存款人列表 + 排序                   │   │
│  └─────────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────────┘
```

### 数据流

```
页面初始化
  SLP:
    lookup.query("priceList") → tickerData (MAG7.ssi 价格)
    getVaultInvestInfo({address:""}) → vaultTvl (全局TVL)
    getVaultRoiApy({totalReturnRange}) → oneYearReturn
    getVaultNavCurve() → netAssetValue (最新 NAV)
    useMag7Balance() → valueChain/base 各链余额
    useProxyAndCooldown() → cooldown 状态
    
  Tabs:
    getVaultInvestInfo({address}) → investInfo (个人 TVL/PNL)
    getVaultRoiApy({roiRange}) → ROI
    getVaultData({address, timeParams}) → chartData
    refreshSlpBalance() → 判断默认 tab (有余额→My Position，无余额→Overview)
```

### 事件驱动刷新

| 事件 | 触发源 | SLP 响应 | Tabs 响应 |
|------|--------|---------|-----------|
| `VAULT_CALL_FOR_SUCCESS` | Withdraw/Claim 完成 | `refreshAll()` cooldown+余额 | — |
| `VAULT_DEPOSIT_SUCCESS` | Deposit 完成 | `refreshAll()` | fetchInvestInfo + fetchRoiData + fetchChart + refreshSlpBalance |

## 核心逻辑

### SLP 头部组件（components/SLP.tsx L140-569）

页面核心区域，职责：
1. **全局指标展示**：TVL（sMAG7.ssi + USD）、1Y Return（百分比）、NAV、MAG7.ssi/USDC 价格
2. **操作按钮**：Get MAG7.ssi（跳转交易页）、Withdraw（打开 withdrawModal）、Deposit（打开 depositModal）
3. **状态提示**：
   - Deposit 进度状态（`vault.depositTransaction`）
   - CoolDown 倒计时（`useProxyAndCooldown`）
   - Value Chain 上可用 sMAG7 余额 → 提示存入 SLP 或 Unstake
   - Base Chain 上可用 sMAG7 余额 → 提示存入 SLP

URL 参数触发：`?popupid=deposit` 或 `?from=trade` 自动打开 Deposit 弹窗（800ms 延迟）。

### Tabs 容器（components/tabs/index.tsx L83-465）

4 个 Tab：My Position / Overview / Activity / Depositors。

智能默认 Tab：mount 时检查 SLP 余额，有余额 → My Position，无余额 → Overview。

数据获取（仅 My Position 和 Overview 共享）：
- `fetchInvestInfo` → 个人 TVL/PNL/holdingSeconds
- `fetchRoiData` → 个人全时 ROI
- `fetchVaultChartData(timeRange)` → 图表数据点 `[timestamp, tvl, pnl]`

分享功能：My Position Tab 右上角 Share 按钮 → PC 用 `createSharePnlModal`，移动端用 `MobileSharePnlDrawer`。

### My Position Tab（tabs/MyPosition.tsx L105-291）

展示个人投资数据：
- **My Deposit**：SLP 余额（sMAG7.ssi）+ USD 估值
- **All-time PNL**：盈亏（`RedGreenNum` 红绿色）+ USD 估值
- **All-time ROI**：收益率百分比
- **图表**：Account Value / PNL 双 Tab 切换，`TimeSelection` 选择时间范围

### Overview Tab（tabs/Overview.tsx L38-197）

全局视角（`address=""` 请求）：
- **Account Value 图表**：`getVaultData` → TVL 时间序列
- **NAV 图表**：`getVaultNavCurve` → NAV 时间序列
- `TimeSelection` 切换时间范围（24h/7d/30d/All）

### Activity Tab（tabs/Activity.tsx）

双子 Tab：All Records / My Records。

| 类型 | 数据源 | Action 类型 |
|------|--------|-------------|
| All Records | `getVaultActionList` | deposit/redeem/transfer |
| My Records | `getMyVaultActivityList` | deposit/redeem/unstake/claim/transfer |

着色规则：deposit/claim → 绿色（+），redeem/unstake → 红色（-），transfer → 按 `toAddress` 是否为当前用户判断。

coin 显示：claim → MAG7.ssi，其余 → sMAG7.ssi。

每条记录附带 `TxLinkIcon` 跳转 Value Chain Explorer。

### Depositors Tab（tabs/Depositors.tsx）

`getVaultInvestList` 分页列表，展示所有存款人地址 + TVL + PNL + 占比。支持排序。

### Chart 组件（tabs/Chart.tsx）

基于 ECharts 的折线图，支持 3 种模式：`tvl`/`pnl`/`nav`。

关键特性：
- Y 轴标签用 `formatCompact`（K/M/B 缩写，BigNumber ROUND_DOWN 截断）
- Tooltip 根据 chartType 切换格式（NAV 显示 4 位小数，TVL/PNL 显示 sMAG7 + USD）
- 动态刻度 `getYAxisInterval` 计算美观的 Y 轴间距

### 弹窗注册（components/modals/index.tsx）

6 个弹窗通过 `createModal` 注册（已有独立 feature 文档的 4 个 + interruption）：

| 弹窗 | 对应 Feature |
|------|-------------|
| `depositModal` | vault-deposit |
| `withdrawModal` | vault-withdraw |
| `claimModal` | vault-claim |
| `unStakeModal` | vault-unstake |
| `withdrawConfirmModal` | vault-withdraw |
| `interruptionModal` | （流程中断恢复） |

### 常量（constant.ts）

| 常量 | 值/来源 | 用途 |
|------|---------|------|
| `IN_COIN_SYMBOL` | `"vMAG7.ssi"` | Deposit 输入 token |
| `OUT_COIN_SYMBOL` | `"vsMAG7.ssi"` | Deposit 输出 token (sMAG7) |
| `SLP_MAG7_SYMBOL` | `"vsMAG7.SLP"` | SLP Vault token |
| `DEFAULT_DECIMAL` | `4` | UI 显示精度 |
| `TOKEN_DECIMAL` | `8` | 链上 token 精度 |
| `DEFAULT_MINIMUM_DECIMAL` | `2` | 最小显示精度 |
| 合约地址 | `LEGACY_CONTRACT_ADDRESSES.*` | Vault/CallForPermit/Token 地址 |

## 文件结构

```
src/pages/vault/
├── index.tsx                    # 页面入口：SLP + Tabs
├── constant.ts                  # 常量：token symbol、精度、合约地址
├── components/
│   ├── SLP.tsx                  # 头部面板：指标+按钮+状态栏（572行）
│   ├── DataView.tsx             # 数据展示卡片组件（title/value/secondary）
│   ├── modals/
│   │   ├── index.tsx            # 6个弹窗注册（createModal）
│   │   └── type.ts              # 弹窗类型定义
│   ├── tabs/
│   │   ├── index.tsx            # Tab 容器：数据获取+分享+智能默认Tab（468行）
│   │   ├── MyPosition.tsx       # 我的持仓：存款/PNL/ROI+图表
│   │   ├── Overview.tsx         # 全局概览：TVL/NAV 图表
│   │   ├── Activity.tsx         # 操作记录：All/My 双表格（492行）
│   │   ├── Depositors.tsx       # 存款人列表+排序
│   │   ├── Chart.tsx            # ECharts 折线图（tvl/pnl/nav）
│   │   ├── TimeSelection.tsx    # 时间范围选择器（24h/7d/30d/All）
│   │   └── useTable.tsx         # 通用表格分页 Hook
│   └── helper/
│       └── numbers.ts           # formatCompact（K/M/B 缩写）
```

## 关键设计决策

1. **智能默认 Tab**：根据 SLP 余额判断，有持仓 → My Position，无持仓 → Overview，降低新用户困惑
2. **事件驱动刷新**：Deposit/Withdraw/Claim 完成后通过 eventBus 通知 SLP 和 Tabs 刷新，解耦弹窗和页面
3. **URL 参数触发弹窗**：`?popupid=deposit` 支持从外部（交易页/引导弹窗）直接跳转并打开 Deposit
4. **双链余额提示**：Value Chain 和 Base Chain 的 sMAG7 余额分别检测，引导用户存入 SLP 或 Unstake
5. **图表三模式复用**：同一个 Chart 组件支持 tvl/pnl/nav 三种展示模式，通过 `chartType` 切换 tooltip 和 Y 轴格式

## 开发修改指南

| 场景 | 入口 |
|------|------|
| 修改头部指标 | `SLP.tsx` 的 DataViewGroup 区域 |
| 新增操作按钮 | `SLP.tsx` L391-432 按钮区域 |
| 修改图表样式 | `tabs/Chart.tsx` ECharts option |
| 修改时间范围选项 | `tabs/TimeSelection.tsx` + `tabs/index.tsx` getTimeParams |
| 新增 Tab | `tabs/index.tsx` tabOptions + 对应组件 |
| 修改 Activity 操作类型 | `tabs/Activity.tsx` allRecordsActionMap/myRecordActionMap |
| 修改精度常量 | `constant.ts` |

## 术语表

| 术语 | 含义 |
|------|------|
| SLP | SoDEX Liquidity Provider，流动性提供者 Vault |
| MAG7.ssi | Vault 的基础 token（可交易） |
| sMAG7.ssi | Vault 的质押 token（stake 后获得） |
| vsMAG7.SLP | Vault SLP share token |
| NAV | Net Asset Value，每份额净值 |
| TVL | Total Value Locked，总锁仓量 |
| CoolDown | 提款冷却期，Withdraw 后需等待一段时间才能 Claim |
| DataViewGroup | 复用的数据展示卡片组（title + value + secondary） |

## 更新记录

### 2026-04-10: 初始版本

初始文档，通过 /k/context learn 从代码自动生成
