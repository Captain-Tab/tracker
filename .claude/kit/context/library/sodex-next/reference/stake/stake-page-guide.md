# Stake 页面功能指南

> 涵盖 Staking 页面（StakingPage）的入口、布局、Tier 系统、数据聚合。
> 对应代码：`src/features/staking/`（不含 `components/StakeSosoDialog/`）

> 🔗 **Stake SOSO 弹窗的完整数据流（My Total SSI / Boost / Discount / Amount 4 区块）独立记录在 [stake-soso-guide.md](./stake-soso-guide.md)**。本文档仅保留页面如何触发弹窗的关联信息。

---

## 🎯 功能概述

Staking 页面让用户在 ValueChain 上质押 SOSO 代币，解锁 SoDEX 交易手续费折扣 + SSI 收益 Boost。

### 核心特性

1. **多源资产聚合**：ValueChain 原生 SOSO + Spot 账户 WSOSO 合并为可用余额
2. **动态等级高亮**：根据用户质押量匹配对应 tier（7 档：0% / 5% / 10% / 15% / 20% / 30% / 40%）
3. **平台总质押公开数据**：无需登录即可展示 totalStaked
4. **Privy 邮箱用户兼容**：全程用 `useAuthState().address`，不依赖 wagmi `useAccount`

---

## 🏗️ 架构概览

### 组件结构（不含 Dialog）

```
src/features/staking/
├── pages/
│   └── StakingPage.tsx          # 页面入口（监听 ?action=stake 自动开 Stake SOSO 弹窗）
├── components/
│   ├── StakingHeader.tsx        # 标题 + Connect Wallet 按钮（仅 PC）
│   ├── StakingStatsRow.tsx      # YourStakedCard + TotalStakedCard 横排
│   ├── YourStakedCard.tsx       # 你的质押卡片（5 种按钮状态）
│   ├── TotalStakedCard.tsx      # 平台总质押卡片
│   ├── StakingTiersSection.tsx  # 等级表 + ONGOING 标签
│   ├── StakingTiersTable.tsx    # 7 档表格 + You 徽章
│   ├── SosoUtilitiesSection.tsx # SOSO 5 种用途卡片
│   ├── SosoUtilityCard.tsx      # 单个用途卡（复用 TagStatus）
│   ├── TagStatus.tsx            # ONGOING / COMING SOON 徽章（封装 Badge size=md）
│   ├── YouBadge.tsx             # 当前 tier "You" 徽章
│   ├── MobileStakeButton.tsx    # 移动端底部浮动按钮
│   └── StakeSosoDialog/         # 见 stake-soso-guide.md
├── containers/
│   ├── useStakingPageViewModel.ts # 页面 VM（聚合所有数据）
│   ├── useStakingBalancesQuery.ts # rawAvailable / rawYourStaked / baseStaked
│   ├── useTotalStakedQuery.ts     # 平台总质押（无需登录）
│   ├── stakeFlowLogic.ts          # 纯逻辑：isLowBalance / formatUserBalance
│   └── handleServiceError.ts
├── domain/
│   ├── types.ts                   # StakingTier / TotalStaked / SosoUtility
│   ├── constants.ts               # STAKING_TIERS（7档）+ SOSO_UTILITIES
│   └── stakingTierCompute.ts      # getCurrentTierIndex / getAmountToNextTier
├── infra/
│   └── chain/
│       └── stakingChainInfra.ts   # readUserStaked / readNativeVcBalance / readTotalStaked
└── index.ts
```

### 数据流

```
useStakingPageViewModel
    ├── useAuthState().address                  # Privy / 钱包统一来源
    ├── useTotalStakedQuery()                   # 公开数据，无需登录
    │   └── readTotalStaked()                   # totalSupply(Base sSOSO) + totalSupply(VC stake)
    └── useStakingBalancesQuery()               # 需登录
        ├── readUserStaked(address)             # balanceOf(Base sSOSO) + balanceOf(VC stake)
        ├── readNativeVcBalance(address)        # ValueChain native SOSO
        └── useBalancesQuery()                  # Spot WSOSO 余额（@/features/trade）
```

---

## 📊 数据字段说明

### useStakingBalancesQuery 输出

| 字段 | 说明 | 来源 | 精度 |
|---|---|---|---|
| `rawYourStaked` | 用户在 ValueChain 上的质押量 | `formatUnits(VALUECHAIN_STAKE.balanceOf, 18)` | 18 位（raw） |
| `rawAvailable` | 可质押 SOSO 总额 | `vcNative + spotWSOSO` | 18 位（raw） |
| `baseStaked` | Base 链 sSOSO（仅展示用） | `formatUnits(SSOSO_BASE.balanceOf, 18)` | 18 位（raw） |
| `isLoading` | chainQuery + spotQuery 任一加载中 | — | — |

> ⚠️ `rawYourStaked` **只取 ValueChain**，不含 Base sSOSO。Base 部分单独走 `baseStaked` 字段，用于 "SOSO staked on Base" 区域展示。**对齐老项目 `yourStakedOnValueChain`**。

### useStakingPageViewModel 输出

| 字段 | 说明 |
|---|---|
| `isConnected` | `!!address`，Privy + 钱包统一识别 |
| `totalStaked` | `{ total, valueChain, base }`（平台数据） |
| `currentTierIndex` / `amountToNextTier` | 用户 tier 推断 |
| `tiers` / `utilities` | STAKING_TIERS / SOSO_UTILITIES（domain 常量） |
| `rawAvailable` / `rawYourStaked` / `baseStaked` | 透传，用于子组件展示 + 弹窗 props |

---

## 🎨 StakingHero 区域（YourStakedCard）

### 登录状态差异

| 状态 | YourStakedCard 主数值 | 按钮 |
|---|---|---|
| 未登录 | `--` | Connect Wallet（Header 内） |
| 已登录 + 余额 ≥ 0.01 | `formatUserBalance(rawYourStaked) + " SOSO"` | Start Staking + Get SOSO |
| 已登录 + 余额 < 0.01 | `< 0.01 SOSO` | Get SOSO to Stake（合并按钮） |

### 小额余额显示（formatUserBalance）

`stakeFlowLogic.ts`:

| 条件 | 显示 |
|---|---|
| `= 0` | `"0"` |
| `> 0 && < 0.01` | `"< 0.01"` |
| `≥ 0.01` | 千分位格式（ROUND_DOWN，2 位小数；走字符串路径避免 `toNumber()` 精度丢失） |

```ts
function formatUserBalance(raw: string): string {
  const d = new Decimal(raw);
  if (d.isZero()) return "0";
  if (d.lt("0.01")) return "< 0.01";
  const [intPart, decPart] = d.toDecimalPlaces(2, Decimal.ROUND_DOWN).toFixed(2).split(".");
  return `${intPart!.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${decPart}`;
}
```

### 按钮触发

```ts
isLowBalance(rawAvailable)  // < 0.01 时合并按钮
  ↓
goToSosoTrade()                                                   # → /trade/spot/SOSO_USDC
openStakeSosoDialog({ rawAvailable, rawYourStaked })              # 触发 stake-soso 弹窗
openConnectedDeposit({ token: "sSOSO", chain: "base" })           # Base sSOSO Deposit
```

> 弹窗内的所有交互（My Total SSI / Boost / Discount / Amount / Submit）属于 [stake-soso](./stake-soso-guide.md) feature。

---

## 📈 STAKING_TIERS 等级配置

`domain/constants.ts`:

```ts
[
  { discount: 0,  minStaked: "0",       displayStaked: "0 SOSO" },
  { discount: 5,  minStaked: "30",      displayStaked: "≥30 SOSO" },
  { discount: 10, minStaked: "300",     displayStaked: "≥300 SOSO" },
  { discount: 15, minStaked: "3000",    displayStaked: "≥3,000 SOSO" },
  { discount: 20, minStaked: "30000",   displayStaked: "≥30,000 SOSO" },
  { discount: 30, minStaked: "300000",  displayStaked: "≥300,000 SOSO" },
  { discount: 40, minStaked: "1500000", displayStaked: "≥1,500,000 SOSO" },
]
```

### Tier 推断逻辑

`getCurrentTierIndex(stakedAmount, tiers)`：从高到低遍历，返回第一个 `minStaked <= stakedAmount` 的索引。

`getAmountToNextTier`：返回 `nextTier.minStaked - stakedAmount`，已达最高档返回 null。

### 高亮规则（StakingTiersTable）

1. 未登录：不高亮
2. 已登录：当前档绿色背景 + "You" 徽章
3. 下一档：显示 `+N SOSO staked to unlock`
4. 最高档：不显示解锁提示

> ⚠️ 弹窗内的"实时预览 tier 跳档"逻辑（基于 `rawYourStaked + amount`）属于 [stake-soso](./stake-soso-guide.md)。

---

## 🎯 SOSO Utilities（静态展示）

`domain/constants.ts` SOSO_UTILITIES 5 个用途：

| ID | 标题 | 状态 | 备注 |
|---|---|---|---|
| `valuechain-gas` | Native ValueChain Gas | ongoing | mobile 简称 ValueChain Gas |
| `fee-discount` | SoDEX Trading Fee Discounts | ongoing | — |
| `validator` | Validator Staking | coming_soon | — |
| `boost-ssi` | Boost SSI Mining Rewards | ongoing | subtitle: Up to 220× |
| `governance` | Governance | ongoing | — |

ONGOING / COMING SOON 徽章统一用 `TagStatus` 组件，内部包装 `Badge size="md"`（h-4.5 px-1 text-[10px] font-bold）。

---

## 📍 合约地址（页面层）

`src/shared/constants/contracts.ts`：

| 常量 | 地址 | 链 | 用途 |
|---|---|---|---|
| `VALUECHAIN_STAKE_ADDRESS` | `0x368788EFa75Ee0BC3ce8B4D1a920197Af2e30876` | VC | SOSO 质押合约（balanceOf 取 yourStaked） |
| `SSOSO_BASE_ADDRESS` | `0xCE89AC7fD59808106B4E346175bCB8D8b273db90` | Base | sSOSO（baseStaked + totalSupply） |

> 弹窗涉及的额外合约（AssetLock / 4 个 SSI 质押代币 / VMAG7/VSMAG7 / SLP / NAV）见 [stake-soso-guide.md §合约地址](./stake-soso-guide.md)。

---

## 🔐 鉴权统一来源

**全程使用 `useAuthState().address`，不直接用 wagmi 的 `useAccount()`**：

```
useStakingPageViewModel.ts:12   const { address } = useAuthState();
useStakingBalancesQuery.ts:25   const { address } = useAuthState();
```

整个 `staking` 模块下 `grep useAccount` 结果为 0。

> 关键背景：Privy 邮箱登录用户的 embedded wallet 不一定立刻进 wagmi，但 `useAuthState().address` 在 Privy 登陆完成后立即可用（`deriveAddress(s.session)` 派生）。

> 反例：`vault` 模块大量直接用 `useAccount()`（11 处），导致 Privy 邮箱用户在 vault 页面卡在未登录状态。staking 模块从设计之初就规避了这个问题。

---

## 🔗 跨 Feature 依赖（页面层）

| 调用方 | 被依赖 feature |
|---|---|
| `useStakingBalancesQuery` | `@/features/trade` → `useBalancesQuery`（Spot WSOSO 余额） |
| `useStakingPageViewModel` | `@/features/auth` → `useAuthState`（address） |
| `YourStakedCard` | `@/features/trade` → `openConnectedDeposit`（Deposit into ValueChain） |
| `YourStakedCard` / `MobileStakeButton` | `@/features/auth` → `openConnectWalletDialog` |
| `YourStakedCard` / `MobileStakeButton` | **`stake-soso` feature** → `openStakeSosoDialog` |

弹窗自身的依赖（vault/market/auth）见 [stake-soso-guide.md](./stake-soso-guide.md)。

---

## 📦 React Query 缓存策略（页面层）

| Query | queryKey | staleTime |
|---|---|---|
| `useTotalStakedQuery` | `staking.totalStaked()` | 60_000ms |
| `useStakingBalancesQuery` chain part | `staking.balances(address)` | 30_000ms |

弹窗专用 query（`useBoostTotalQuery` / `configApi.fetchSosoPrice`）见 [stake-soso-guide.md](./stake-soso-guide.md)。

---

## 🛣️ 页面行为

### URL 参数驱动自动开弹窗

`StakingPage.tsx` 监听 `?action=stake`：当 `vm.isLoading=false` 时，自动调用 `openStakeSosoDialog()`，并清除 URL 参数（`replace: true`）。`hasAutoOpened` ref 保证仅触发一次。

```ts
useEffect(() => {
  if (hasAutoOpened.current) return;
  if (searchParams.get("action") !== "stake") return;
  if (vm.isLoading) return;
  hasAutoOpened.current = true;
  searchParams.delete("action");
  setSearchParams(searchParams, { replace: true });
  void openStakeSosoDialog({
    rawAvailable: vm.rawAvailable,
    rawYourStaked: vm.rawYourStaked,
  });
}, [searchParams, vm.isLoading, vm.rawAvailable, vm.rawYourStaked]);
```

> 此入口由 `BalancesTable` 的 "Stake to Earn" 按钮触发跳转使用。

### 移动端布局

- 顶部 Header 折叠 Connect Wallet（仅 PC 显示）
- StatsRow 改为竖向堆叠
- 底部固定浮动 `MobileStakeButton`（PC 端隐藏）
- StakingTiersTable 第二列宽度 37%

---

## 🔄 历史变更

### 2026-04-30（migration-stake-bugfix 会话）

**与页面相关的修复**：

1. **Your Staked 数值取值修正**：`rawYourStaked` 从 `Base + ValueChain` 合计改为只取 `ValueChain`，对齐老项目 `yourStakedOnValueChain`。Base 部分通过独立 `baseStaked` 字段展示。
2. **数据格式化精度修正**：`formatUserBalance` 改为字符串路径千分位（之前用 `toNumber()` 可能丢精度）
3. **预发布 405 报错**：`.env.preview` 补 `VITE_SSI_GW_URL=https://ssi-gw.sosovalue.com`（影响 stake-soso 弹窗的 My Total SSI Value）
4. **TagStatus 复用**：重写 `TagStatus` 内部用 `Badge size="md"`，`SosoUtilityCard` 复用之，保证 Stake Tiers 标题旁的 ONGOING 与 utility 卡片样式一致
5. **删除冗余字段**：`StakingOverview.valueChainStaked` / `StakingBalances.valueChainStaked`

**与弹窗相关的修复**（详见 [stake-soso-guide.md §历史变更](./stake-soso-guide.md)）：
- My Total SSI Value 改用 `useBoostTotalQuery`（删除 `useStakingBoostCalc` 的 7 个重复 API）
- `fetchAllCooldownSplit`（4 代币 × 2 账户批量读 cooldownInfos）
- `fetchLpBalances`（lockDatas + balanceOf 替代 oldTotalAmount）
- `boostChange` 零值格式 `"+0%"` → `"0%"`

### 数据迁移源

数据源、字段命名对齐 `sodex-web` 项目 `src/pages/stake/hooks/useStakeData.ts`（formatUserBalance / formatWithCommas）。

### 2026-04-29 之前（初始迁移）

从 `sodex-web/src/pages/stake/` 迁移而来，包含 StakingHero / SOSOTier / SOSOUtilities 三个主模块。
