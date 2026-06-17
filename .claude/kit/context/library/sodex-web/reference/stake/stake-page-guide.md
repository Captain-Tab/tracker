# Stake 页面功能指南

## 🎯 功能概述

Stake 页面展示用户的 SOSO 质押数据，包括 StakingHero、SOSOTier 和 SOSOUtilities 三个主要模块。

### 核心特性

1. **多链数据聚合**: ValueChain + Base 双链质押数据
2. **动态等级高亮**: 根据用户质押金额匹配对应档位
3. **Deposit 联动**: 从 Stake 页面打开 Deposit Modal 时显示特殊标签

---

## 🏗️ 架构概览

### 组件结构

```
src/pages/stake/
├── index.tsx           # 页面入口
├── StakingHero.tsx     # 顶部数据展示组件
│   ├── YourStakedCard  # 用户质押数据卡片
│   ├── TotalStakedCard # 总质押数据卡片
│   └── SSIBoostBadge   # SSI Boost 标签
├── SOSOTier.tsx        # 质押等级表格
│   ├── getTierInfo()   # 档位计算函数
│   └── YouBadge        # "You" 徽章组件
├── SOSOUtilities.tsx   # SOSO 工具列表
├── components/
│   ├── TagStatus.tsx   # 状态标签
│   └── MobileBottomButton.tsx
└── hooks/
    └── useStakeData.ts # 数据获取 Hook
```

### 数据流

```
useStakeData.ts
    ├── fetchTotalStaked()   # 无需登录
    │   ├── Base totalSupply
    │   └── ValueChain totalSupply
    │
    ├── fetchUserStaked()    # 需要登录
    │   ├── Base balanceOf
    │   └── ValueChain balanceOf
    │
    └── availableData        # 可用余额
        ├── spotAsset (Spot Account)
        └── chainAsset (ValueChain)
```

---

## 📊 数据字段说明

### formattedData 输出

| 字段 | 说明 | 示例 |
|------|------|------|
| `availableToStake` | 可用于质押的 SOSO 总额 | "100.00 SOSO" |
| `availableOnValueChain` | ValueChain 上可用的 SOSO | "100.00 SOSO" |
| `yourStaked` | 用户总质押量 | "50.00 SOSO" |
| `yourStakedOnValueChain` | ValueChain 上的质押量 | "30.00 SOSO" |
| `stakedOnBase` | Base 上的质押量 (sSOSO) | "20.00 sSOSO" |
| `totalStaked` | 平台总质押量 | "81,735,444.89 SOSO" |
| `totalStakedOnValueChain` | ValueChain 平台质押量 | "24,403,197.52 SOSO" |
| `totalStakedOnBase` | Base 平台质押量 | "57,332,247.36 SOSO" |

### raw 原始数据

用于逻辑判断（如低余额检测、等级计算）：

| 字段 | 用途 |
|------|------|
| `raw.availableOnValueChain` | 判断是否 `< 0.01`，显示 "Get SOSO to Stake" 按钮 |
| `raw.stakedOnBase` | 判断是否显示 "Deposit into ValueChain" 按钮 |
| `raw.yourStakedOnValueChain` | SOSOTier 等级计算 |

---

## 🎨 StakingHero 组件

### 登录状态差异

| 状态 | Your Staked | 按钮 |
|------|-------------|------|
| 未登录 | 显示 "--" | Connect Wallet |
| 已登录 + 余额 ≥ 0.01 | 显示金额 | Start Staking + Get SOSO |
| 已登录 + 余额 < 0.01 | 显示 "0" 或 "< 0.01" | Get SOSO to Stake（合并按钮） |

### 小额余额显示规则

用户余额相关字段（`yourStakedOnValueChain`、`availableOnValueChain`、`stakedOnBase`）使用 `formatUserBalance` 函数：

| 条件 | 显示 |
|------|------|
| `= 0` | `0 SOSO` |
| `> 0 && < 0.01` | `< 0.01 SOSO` |
| `≥ 0.01` | 正常千分位格式（如 `23.96 SOSO`） |

```typescript
const SMALL_VALUE_THRESHOLD = 0.01;

function formatUserBalance(value: string): string {
  const num = new BigNumber(value);
  if (num.isZero()) return "0";
  if (num.isLessThan(SMALL_VALUE_THRESHOLD)) return "< 0.01";
  return formatWithCommas(value);
}
```

### 低余额按钮触发

```typescript
// 余额 < 0.01 时显示 "Get SOSO to Stake" 单按钮
const isLowBalance = new BigNumber(raw.availableOnValueChain).isLessThan(0.01);
```

### 按钮行为

```typescript
// Start Staking - 打开质押弹窗（传入当前已质押量，用于 Trading Fee Discount 计算）
const handleStartStaking = () => {
  createStakeSosoModal.open({ yourStaked: raw.yourStaked });
};

// Get SOSO - 跳转交易页
const handleGetSoso = () => {
  window.location.href = "/trade/spot/SOSO_USDC";
};

// Deposit into ValueChain - 打开 Deposit Modal
const handleDepositIntoValueChain = () => {
  depositModal.open({ isFromStake: true });
};
```

---

## 📈 SOSOTier 等级计算

### 等级配置

```typescript
const TIER_CONFIG = [
  { discount: "0%", threshold: 0, displayStaked: "0 SOSO" },
  { discount: "5%", threshold: 30, displayStaked: ">30 SOSO" },
  { discount: "10%", threshold: 300, displayStaked: ">300 SOSO" },
  { discount: "15%", threshold: 3000, displayStaked: ">3,000 SOSO" },
  { discount: "20%", threshold: 30000, displayStaked: ">30,000 SOSO" },
  { discount: "30%", threshold: 300000, displayStaked: ">300,000 SOSO" },
  { discount: "40%", threshold: 1500000, displayStaked: ">1,500,000 SOSO" },
];
```

### 高亮逻辑

1. **未登录**: 不显示高亮
2. **已登录**: 根据 `rawYourStaked` 匹配档位
3. **当前档位**: 绿色背景 + "You" 徽章
4. **下一档位**: 显示 "+N SOSO staked to unlock"
5. **最高档位**: 不显示解锁提示

---

## 🔗 Deposit Modal 联动

### 特殊参数

从 Stake 页面打开 Deposit Modal 时：

```typescript
depositModal.open({ isFromStake: true });
```

### 预设行为

1. **自动选择代币**: sSOSO
2. **自动选择链**: Base
3. **显示特殊标签**: "On ValueChain" + "⚡ SSI Boost Active"

---

## 🌐 国际化

### stake namespace 翻译 key

| Key | 说明 |
|-----|------|
| `staking` | 页面标题 |
| `your_staked` | 用户质押标题 |
| `total_staked` | 总质押标题 |
| `staking_tiers` | 等级标题 |
| `trading_fee_discount` | 交易手续费折扣 |
| `soso_staked` | SOSO 质押 |
| `start_staking` | 开始质押按钮 |
| `get_soso` | 获取 SOSO 按钮 |
| `get_soso_to_stake` | 获取 SOSO 进行质押 |
| `deposit_into_valuechain` | 存入 ValueChain |
| `ssi_boost` | SSI 加速 |
| `ssi_boost_active` | SSI 加速已激活 |
| `soso_staked_to_unlock` | 解锁提示 (+N SOSO) |

---

## 📱 响应式设计

### PC 端

- 左右两栏布局
- 表格完整显示

### 移动端

- 垂直堆叠布局
- 表格第二列宽度 37%
- 底部固定按钮

---

## 🔄 更新日志

### 2026-03-14

- Start Staking 按钮传入 `yourStaked` 参数，供 StakeSoso 弹窗计算 Trading Fee Discount

### 2026-03-13

- 新增小额余额显示规则：`=0` 显示 `0`，`<0.01` 显示 `< 0.01`
- 修改按钮触发阈值：余额 `<0.01` 时显示 "Get SOSO to Stake"
- 重命名 `isZeroBalance` → `isLowBalance`

### 2026-03-12

- 新增 StakingHero 数据拆分（ValueChain / Base）
- 新增 SOSOTier 等级高亮和解锁提示
- 新增 Deposit Modal 联动（isFromStake 参数）
- 新增 14 个国际化翻译 key
- 统一 SSI Boost 翻译（SSI加速）
