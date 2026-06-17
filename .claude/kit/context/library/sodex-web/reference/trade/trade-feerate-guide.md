# Fee Schedule 费率展示系统

## 架构概览

Fee Schedule 系统负责展示用户的交易费率信息，支持 Spot 和 Perps 两种交易类型。系统由入口组件、弹窗组件、状态管理和配置四部分组成。

```
┌─────────────────────────────────────────────────────────────────┐
│                      数据流架构                                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐     │
│  │  FeeEntry    │────→│  feeRate     │────→│  API         │     │
│  │  (入口组件)   │     │  (MobX Store) │     │  (HTTP)      │     │
│  └──────────────┘     └──────────────┘     └──────────────┘     │
│         │                    │                                   │
│         │                    ↓                                   │
│         │             ┌──────────────┐                          │
│         └────────────→│ FeeSchedule  │                          │
│           点击打开     │   Modal      │                          │
│                       │  (弹窗组件)   │                          │
│                       └──────────────┘                          │
│                              │                                   │
│                              ↓                                   │
│                       ┌──────────────┐                          │
│                       │  feeTiers    │                          │
│                       │  (配置数据)   │                          │
│                       └──────────────┘                          │
└─────────────────────────────────────────────────────────────────┘
```

### 文件结构

| 文件 | 职责 | 行数 |
|------|------|------|
| `src/components_tw/FeeEntry.tsx` | 费率入口组件，显示当前费率和划线对比 | ~173 |
| `src/components_tw/modals/spot/FeeScheduleModal.tsx` | 费率弹窗，展示三种 Tier 表格 | ~719 |
| `src/models/feeRate.ts` | MobX Store，管理费率数据和请求状态 | ~75 |
| `src/config/feeTiers.ts` | 费率配置，Staking/Fee Tiers 表格数据 | ~174 |
| `src/http/spot/index.ts` | API 接口定义 | ~24 |
| `src/http/spot/api.d.ts` | 类型定义 | ~35 |

---

## 核心逻辑

### 1. 费率数据获取

FeeRate Store 并行获取 Spot 和 Perps 两种费率，使用 `requestId` 处理竞态。

```typescript
// src/models/feeRate.ts L19-56
@action.bound
async fetchFeeRates(address: string) {
  // 相同地址不重复请求
  if (this.lastAddress === address) return;

  const currentRequestId = ++this.requestId;
  this.loading = true;

  const results = await Promise.allSettled([
    fetchFeeRate({ address, type: 'spot' }),
    fetchFeeRate({ address, type: 'perps' }),
  ]);

  // 请求期间地址已变化，丢弃过期结果
  if (currentRequestId !== this.requestId) return;

  // 分别处理 spot 和 perps 结果...
}
```

### 2. 划线显示判断

FeeEntry 组件根据用户实际费率与基准费率的对比，决定是否显示划线。判断条件基于**钱包地址**而非登录状态（user.id），因为费率接口按地址查询。

```typescript
// src/components_tw/FeeEntry.tsx L76-86
const showStrikethrough = useMemo(() => {
  // 无钱包或接口报错或数据未返回不显示划线
  if (!address || currentError || !feeData) return false;

  // 有地址时：用户实际费率与硬编码相同时不显示划线
  const hardcodedFees = STRIKETHROUGH_FEES[type === "perps" ? "perps" : "spot"];
  const takerSame = formatFeeRate(feeData.takerFeeRate) === hardcodedFees.taker;
  const makerSame = formatFeeRate(feeData.makerFeeRate) === hardcodedFees.maker;

  return !(takerSame && makerSame);
}, [address, currentError, feeData, formatFeeRate, type]);
```

划线规则：

| 场景 | 主费率 | 划线费率 |
|------|--------|----------|
| 已连接钱包 + 费率不同 | 用户实际费率 | 硬编码 (Tier 0) |
| 已连接钱包 + 费率相同 | 用户实际费率 | 无 |
| 未连接钱包 | fallback | 无 |
| 接口报错 | "-" | 无 |

### 3. Tier 高亮逻辑

弹窗中根据 API 返回的 tier 字段高亮对应行。

```typescript
// src/components_tw/modals/spot/FeeScheduleModal.tsx L117-142

// Fee Tiers 高亮：优先使用接口返回的 feeTier，未登录时反推
const currentTier = useMemo(() => {
  const isSpotEntry = entryType === "spot";
  if (isLoggedIn) {
    return isSpotEntry ? spotFeeTier : perpsFeeTier;
  }
  const takerFee = isSpotEntry ? spotTakerFee : perpsTakerFee;
  return findTierByTakerFee(takerFee, entryType);
}, [isLoggedIn, entryType, spotFeeTier, perpsFeeTier, spotTakerFee, perpsTakerFee]);

// Maker Rebate 高亮：tier 1-3 对应行索引 0-2，tier 0 不高亮
const makerRebateHighlightRow = useMemo(() => {
  if (makerRebateTier === undefined || makerRebateTier <= 0 || makerRebateTier > 3) {
    return undefined;
  }
  return makerRebateTier - 1;
}, [makerRebateTier]);

// Staking Tiers 高亮：tier 0-6 直接对应行索引
const stakingHighlightRow = useMemo(() => {
  if (stakingTier === undefined || stakingTier < 0 || stakingTier > 6) {
    return undefined;
  }
  return stakingTier;
}, [stakingTier]);
```

---

## 关键实现

### API 接口

```typescript
// src/http/spot/index.ts L14-23
export const fetchFeeRate = (params: API.Spot.FeeRate.Request) => {
  const { address, symbol, type } = params;
  const endpoint = `/api/v1/${type}/accounts/${address}/fee-rate`;

  return request<API.Spot.FeeRate.ResponseData>(endpoint, {
    method: "GET",
    params: symbol ? { symbol } : undefined,
    baseURL: SPOT_API_SERVER_URL,
  });
};
```

API 响应结构：

```typescript
type ResponseData = {
  makerFeeRate: string;    // "0.00012"
  takerFeeRate: string;    // "0.0004"
  feeTier: number;         // 0-6
  stakingTier: number;     // 0-6
  makerRebateTier: number; // 0-3
};
```

### 费率 Tooltip 计算

```typescript
// src/components_tw/modals/spot/FeeScheduleModal.tsx L87-115
const calculateFeeBreakdown = useMemo(() => {
  // 从 Fee Tiers 表格获取基础费率
  const getBaseFee = (tier: number, type: "spot" | "perps", role: "taker" | "maker") => {
    const colIndex = type === "perps" ? (role === "taker" ? 2 : 3) : (role === "taker" ? 4 : 5);
    return feeTiersColumns[colIndex].values[tier] || "0%";
  };

  return {
    spot: {
      baseTaker: getBaseFee(spotFeeTier, "spot", "taker"),
      baseMaker: getBaseFee(spotFeeTier, "spot", "maker"),
      effectiveTaker: spotTakerFee,
      effectiveMaker: spotMakerFee,
      tier: spotFeeTier,
    },
    perps: { /* 同上 */ },
  };
}, [spotFeeTier, perpsFeeTier, spotTakerFee, spotMakerFee, perpsTakerFee, perpsMakerFee]);
```

Tooltip 显示格式：

```
Spot Fee Breakdown
Taker: 0.035% × (1 - 5%) = 0.03325%
Maker: 0.005% × (1 - 5%) = 0.00475%
Base: Tier 3 | Staking Discount: 5%
```

---

## 关键设计决策

### 1. 为什么使用 MobX Store 而非组件内状态？

费率数据在多个页面入口（Spot Order Form、Perps Order Form）共享，使用 Store 避免重复请求。Store 还处理：
- 相同地址去重请求 (`lastAddress`)
- 竞态控制 (`requestId`)
- 错误状态独立管理 (`spotError`, `perpsError`)

### 2. 为什么弹窗接收格式化后的费率而非原始数据？

弹窗需要同时显示 Spot 和 Perps 两种费率，但入口可能只有一种类型的数据。格式化后传入简化了弹窗逻辑，未登录时可根据 fallback 反推另一入口的费率。

### 3. 为什么划线使用硬编码而非 fallback？

硬编码为 Tier 0 基准费率，代表"无优惠"状态。无论从哪个入口进入，划线显示的都是相同的基准费率，保证用户对"节省了多少"的认知一致。

### 4. 为什么用 isLogin + address 双重判断？

费率接口 `/fee-rate` 按**钱包地址**查询。组件使用 `isLogin && address` 作为获取数据的条件：
- `isLogin`：确保用户已登录（`!!user.id`）
- `address`：确保钱包地址可用

这样在未登录时显示 fallback，登录后自动获取真实费率。

### 5. MobX Store 必须调用 makeObservable

MobX 6 要求在使用装饰器语法（`@observable`, `@action`）时，**必须在构造函数中调用 `makeObservable(this)`**，否则装饰器不生效，数据变化不会触发组件重新渲染。

```typescript
// feeRate.ts
constructor() {
  makeObservable(this);
}
```

---

## 开发修改指南

### 新增 Tier 等级

1. 更新 `src/config/feeTiers.ts` 中的 `feeTiersColumns` 和 `STAKING_TIERS`
2. 确保 `findTierByTakerFee` 和 `getFeeByTier` 函数仍能正确工作
3. 检查弹窗高亮逻辑的边界值判断

### 修改划线规则

修改 `src/components_tw/FeeEntry.tsx` 中的 `showStrikethrough` 计算逻辑和 `STRIKETHROUGH_FEES` 配置。

### 调整弹窗布局

弹窗 PC/移动端布局分离：
- PC 端：L676-714
- 移动端：L461-614

使用 `renderColumnTable` (PC) 和 `renderMobileSimpleTable` (移动端) 渲染表格。

---

## 术语表

| 术语 | 说明 |
|------|------|
| Fee Tier | 根据 14 天交易量划分的费率等级 (0-6) |
| Staking Tier | 根据 SOSO 质押量划分的折扣等级 (0-6) |
| Maker Rebate Tier | Maker 返佣等级 (1-3)，独立于 Staking 折扣 |
| Taker/Maker | Taker 吃单、Maker 挂单，弹窗中不翻译 |

---

## 更新记录

### 2026-03-22: 修复 MobX 响应式失效

**问题**：API 成功获取费率数据后，组件不会重新渲染，始终显示 fallback。

**根本原因**：`feeRate.ts` 缺少 `makeObservable(this)` 调用，导致 MobX 6 的装饰器（`@observable`, `@action`）不生效，store 数据变化无法触发组件更新。

**修复**：在 `FeeRate` 类中添加构造函数：

```typescript
constructor() {
  makeObservable(this);
}
```

**调试过程教训**：
- 初始误判为 `isLogin` vs `address` 时序问题
- 真正问题是 MobX 响应式链路断裂
- 应优先验证基础假设（响应式是否工作）再分析业务逻辑

### 2026-03-19: 初始版本

初始文档，通过 /k/context learn 从代码自动生成。

功能涵盖：
- API 集成：Spot/Perps 费率接口
- 入口组件：FeeEntry 划线显示
- 弹窗组件：Fee Tiers / Staking Tiers / Maker Rebate 三表格高亮
- 响应式设计：PC 双栏 + 移动端 Tab 切换
