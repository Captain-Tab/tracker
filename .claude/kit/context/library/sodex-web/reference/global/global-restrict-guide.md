# Global Restrict - 地区限制功能

## 概述

基于 IP 检测的地区限制系统，用于限制特定地区用户（如美国）的入金/交易操作，同时保留提现能力。

**核心效果**：
- 受限用户看到全局 Banner 提示
- 所有受限按钮显示 50% 透明度 + tooltip
- Withdraw/Transfer/Sell 等退出操作不受限制

**两种包裹组件**：
- `RegionRestrictWrapper` — 仅地区限制（无维护逻辑）
- `RestrictWrapper` — 维护 + 地区限制统一包裹，优先级：维护 > 地区限制（用于两者重叠的位置）

---

## 核心架构

### 数据流

```
App.tsx 初始化
    ↓
restriction.fetchRestrictedRegion()
    ↓
API: /biz/user/restrictedRegion
    ↓
Store: isRestrictedRegion, region
    ↓
useRegionRestrict() Hook
    ↓
RegionRestrictWrapper / RestrictWrapper / RegionRestrictBanner
```

### 关键文件

| 文件 | 作用 |
|------|------|
| `src/models/restriction.ts` | MobX Store，存储限制状态 |
| `src/hooks/restriction/useRegionRestrict.ts` | 统一 Hook，提供 `isRestricted` |
| `src/global/region-restrict/RegionRestrictWrapper.tsx` | 仅地区限制包裹组件 |
| `src/global/region-restrict/RestrictWrapper.tsx` | 维护+地区限制统一包裹（优先级：维护 > 地区） |
| `src/components/header/components/regionRestrictBanner/index.tsx` | 全局限制 Banner |
| `src/http/restriction/index.ts` | API 函数 |

### 初始化配置

| 文件 | 改动内容 |
|------|----------|
| `src/models/index.ts` | 注册 Restriction Store |
| `src/App.tsx` | 初始化调用 `restriction.fetchRestrictedRegion()` |

---

## 使用位置索引

### RegionRestrictWrapper 包裹位置（按页面分类）

#### Header / 全局组件
| 文件 | 包裹元素 | Wrapper |
|------|----------|---------| 
| `src/components/header/components/sign/index.tsx` | Header Deposit 按钮 | RestrictWrapper |
| `src/components_tw/modals/spot/FundWallet.tsx` | FundWallet Deposit 卡片 | RegionRestrictWrapper |

#### Trade 页面
| 文件 | 包裹元素 |
|------|----------|
| `src/pages/spot/main/asset/actions/index.tsx` | Deposit Funds 按钮 |
| `src/pages/spot/main/orderForm/openPosition/index.tsx` | Spot Buy 按钮 |
| `src/pages/spot/main/position/tab/asset/index.tsx` | Stake to Earn, Swap, Deposit, Deposit to Vault |
| `src/pages/spot/main/position/tab/positionTab/index.tsx` | 保证金编辑 EditIcon |
| `src/pages/spot/main/switch/market/index.tsx` | Swap Now 按钮（USDT 交易对提示） |
| `src/pages/spot/main/components/preTradeButton/MainnetPreTradeButton.tsx` | Deposit 按钮（PreTrade 状态） |

#### Spot-Futures 页面
| 文件 | 包裹元素 |
|------|----------|
| `src/pages/spot/main/futures/order/orderForm/_components/TradeButton.tsx` | Buy/Sell 下单按钮 |

#### Futures 页面
| 文件 | 包裹元素 |
|------|----------|
| `src/pages/futures/main/orderForm/openPosition/index.tsx` | Buy Long, Sell Short 按钮 |
| `src/pages/futures/main/position/tab/current/index.tsx` | 保证金编辑入口 |

#### Stake 页面

> ⚠️ **2026-03-26 更新**：`StakingHero.tsx` 已移除 RegionRestrictWrapper 包裹，Stake 页面不再有地区限制。
> 原因：Stake 操作使用用户已有资产，属于允许操作；Deposit into ValueChain 使用锁定弹窗，不需要限制。

#### Vault 页面
| 文件 | 包裹元素 | Wrapper |
|------|----------|---------| 
| `src/pages/vault/components/SLP.tsx` | Get MAG7.ssi, Deposit to Vault (3处) | RestrictWrapper |

#### Referrals 页面
| 文件 | 包裹元素 | Wrapper | 特殊逻辑 |
|------|----------|---------|----------|
| `src/pages/referrals/components/NewReferralHeader.tsx` | Invite User | RegionRestrictWrapper | 有邀请链接时放开，无邀请链接时限制 |
| `src/pages/referrals/components/NewReferralHeader.tsx` | Claim Rebate, Trade More, Deposit More | RestrictWrapper | 始终限制 |

#### Account 页面
| 文件 | 包裹元素 | Wrapper |
|------|----------|---------|
| `src/pages/account/assets/components/btnNav/index.tsx` | Deposit 按钮 | RestrictWrapper |

---

### useRegionRestrict Hook 使用位置

| 文件 | 用途 |
|------|------|
| `src/global/region-restrict/RegionRestrictWrapper.tsx` | 组件内部获取 `isRestricted` 和 `tooltipText` |
| `src/global/region-restrict/RestrictWrapper.tsx` | 组件内部获取 `isRestricted` |
| `src/pages/spot/main/components/preTradeButton/MainnetPreTradeButton.tsx` | 逻辑判断：跳过 Deposit 弹窗、控制按钮包裹 |

---

### restriction Store 直接使用位置

| 文件 | 用途 |
|------|------|
| `src/components/header/components/depositBanner/index.tsx` | PC 端 Banner 显示判断 + 设置 `ui.isGlobalBannerVisible` |
| `src/pages/m/trade/index.tsx` | 移动端 Banner 显示判断 |

---

### 移动端 Banner 特殊处理

**文件**：`src/pages/m/trade/index.tsx`

- Banner 显示在 `MbHeader` 下方
- 布局高度动态调整：`grid-rows-[56px_auto_1fr]`
- 使用 `RegionRestrictBanner` 组件

**PC 端遮挡修复**：`DepositBanner` 显示 Banner 时设置 `ui.isGlobalBannerVisible = true`，确保页面内容不被遮挡。

---

## API 接口

### 环境路由

| ENV_NAME | baseURL | env 参数 |
|----------|---------|---------|
| `preview` | `https://preview-biz.sodex.dev` | `env=preview` |
| 其他 | `https://alpha-biz.sodex.dev` | 不传 |

### 响应结构

```typescript
{
  code: 0,
  data: {
    isRestrictedRegion: boolean,  // true = 受限
    region: string                // "US"
  }
}
```

### 降级策略

**失败 = 不限制**：接口超时/错误时保持 `isRestrictedRegion = false`，避免影响正常用户。

---

## 使用方式

### 1. 仅地区限制（RegionRestrictWrapper）

```tsx
import RegionRestrictWrapper from "@/global/region-restrict/RegionRestrictWrapper";

// 仅需要地区限制的按钮（无维护逻辑）
<RegionRestrictWrapper>
  <Button>Deposit</Button>
</RegionRestrictWrapper>

// 支持 className 透传（如 grid 布局）
<RegionRestrictWrapper className="col-span-2">
  <Button>Trade More</Button>
</RegionRestrictWrapper>
```

**效果**：
- 非受限用户：正常渲染
- 受限用户：50% 透明度 + pointer-events-none + tooltip

### 2. 维护 + 地区限制重叠（RestrictWrapper）

```tsx
import { RestrictWrapper } from "@/global/maintanence";

// 同时需要维护禁用 + 地区限制的位置（优先级：维护 > 地区）
<RestrictWrapper>
  <Button>Deposit</Button>
</RestrictWrapper>

// 支持 className 透传
<RestrictWrapper className="flex-1">
  <Button>Claim Rebate</Button>
</RestrictWrapper>
```

**效果**：
- 链维护中：显示维护 tooltip（优先）
- 地区受限：显示地区限制 tooltip
- 正常：透传 children

### 2. 逻辑判断

```tsx
import { useRegionRestrict } from "@/hooks/restriction";

const { isRestricted, guardAction } = useRegionRestrict();

// 方式 A：条件渲染
if (isRestricted) {
  return <RestrictedUI />;
}

// 方式 B：守卫执行
guardAction(() => {
  depositModal.open();
});
```

### 3. Banner 展示

```tsx
import RegionRestrictBanner from "@/components/header/components/regionRestrictBanner";

// 在页面顶部（DepositBanner 内部已集成）
{restriction.isRestrictedRegion && <RegionRestrictBanner />}
```

---

## 限制规则

### 限制操作

| 类别 | 操作 |
|------|------|
| **Deposit** | 所有入金入口 |
| **Spot** | Buy（买入） |
| **Futures** | Buy Long, Sell Short（开仓） |
| **Spot-Futures** | Buy, Sell（合约交易） |
| **其他** | Stake to Earn, Swap, Get SOSO, Get MAG7.ssi, Adjust Margin |

### OrderForm 限制规则矩阵

| 交易类型 | 操作 | 是否限制 | 说明 |
|---------|------|----------|------|
| **Spot** | Buy | ✅ 限制 | 买入 = 入金性质 |
| **Spot** | Sell | ❌ 不限制 | 卖出 = 允许用户退出持仓 |
| **Futures** | Buy Long | ✅ 限制 | 开多仓 |
| **Futures** | Sell Short | ✅ 限制 | 开空仓 |
| **Spot-Futures** | Buy | ✅ 限制 | 合约开多 |
| **Spot-Futures** | Sell | ✅ 限制 | 合约开空 |

### 不限制操作

| 类别 | 操作 | 原因 |
|------|------|------|
| **Withdraw** | 提现 | 用户必须能取出资金 |
| **Transfer** | 账户划转 | 非入金操作 |
| **Spot Sell** | 现货卖出 | 允许退出持仓 |
| **Futures 平仓** | Close Position | 允许退出仓位 |
| **Unstake** | 解除质押 | 允许取回资产 |
| **Start Staking** | Stake 页面 | 用户用已有资产 stake |

---

## MainnetPreTradeButton 特殊逻辑

> `src/pages/spot/main/components/preTradeButton/MainnetPreTradeButton.tsx`

### 关键变量

| 变量 | 含义 |
|-----|------|
| `address` | 钱包地址（已连接 = truthy） |
| `user.id` | 用户账户ID（已入金 = truthy） |
| `needsRefresh` | 需要刷新私钥 |
| `enableTrading` | 交易已启用 |
| `isDepositState` | `!!address && !user.id` |

### 完整场景矩阵

| # | address | user.id | needsRefresh | enableTrading | 按钮文本 | RegionRestrictWrapper |
|---|---------|---------|--------------|---------------|----------|----------------------|
| 1 | ❌ | - | - | - | **Connect Wallet** | ❌ |
| 2 | ✅ | ❌ | - | false | **Deposit** | ✅ (美国用户) |
| 3 | ✅ | ✅ | true | - | **Enable Trading** | ❌ |
| 4 | ✅ | ✅ | false | false | **Enable Trading** | ❌ |
| 5 | ✅ | ✅ | false | true | null (children) | - |

**核心判断**：
- `isDepositState = !!address && !user.id`
- 只有同时满足"已连接钱包"且"无账户"时，才会被 `RegionRestrictWrapper` 包裹
- **Connect Wallet 和 Enable Trading 永不限制**

### 美国用户场景

| 状态 | user.id | needsRefresh | 行为 |
|-----|---------|--------------|------|
| 新用户 | ❌ 无 | - | `return;` 无法继续（不能入金） |
| 老用户余额0 | ✅ 有 | true | **继续检查 → Enable Trading** ✅ |
| 老用户余额0 | ✅ 有 | false | 继续 → `return true` |

### skipDepositCheck

```tsx
const { enableTrading: doEnableTrading } = useEnableTrading({
  skipDepositCheck: isRestricted,  // 美国用户跳过 Deposit 弹窗
});
```

**设计原则**：
- 美国用户无法入金创建新账户
- 美国用户如果已有账户（限制前入金），可以正常 Enable Trading
- Transfer 等非入金操作不受影响

---

## Tooltip 行为

| 平台 | 触发 | 关闭 |
|------|------|------|
| PC | hover | 移开鼠标 |
| 移动端 | 点击 | 点击其他地方 / 滚动 |

**实现**：
- `useIsMobileScreen` 检测平台
- PC 端：MUI Tooltip hover 监听
- 移动端：onClick 手动控制 + useClickAway + scroll 事件

---

## 国际化

| Key | 用途 |
|-----|------|
| `common:region_restricted_message` | Banner 文案 |
| `common:region_not_available` | Tooltip 文案 |

支持语言：en, zh, hk, ja, ko, es, ru, vi, tr, fr, de

---

## 常见问题

### Q: 如何判断当前用户是否受限？

```tsx
const { isRestricted } = useRegionRestrict();
// 或直接从 Store
const { restriction } = useStore();
const isRestricted = restriction.isRestrictedRegion;
```

### Q: 新增一个需要限制的按钮？

```tsx
import RegionRestrictWrapper from "@/global/RegionRestrictWrapper";

<RegionRestrictWrapper>
  <YourButton />
</RegionRestrictWrapper>
```

### Q: 接口失败时会发生什么？

默认放行（`isRestrictedRegion = false`），不影响正常用户使用。

### Q: 美国用户能做什么？

- ✅ 提现（Withdraw）
- ✅ 账户划转（Transfer）
- ✅ 卖出持仓（Spot Sell）
- ✅ 平仓（Close Position）
- ✅ 解除质押（Unstake）
- ✅ Stake（使用已有资产）
- ❌ 入金、开仓、买入

---

## 📅 更新记录

| 日期 | 内容 |
|------|------|
| 2026-04-17 | 文件迁移：RegionRestrictWrapper 移至 `global/region-restrict/`；新增 RestrictWrapper（维护+地区限制统一包裹）；7个重叠位置从 RegionRestrictWrapper 改为 RestrictWrapper |
| 2026-03-26 | 移除 StakingHero.tsx 的 RegionRestrictWrapper 包裹 |
| 2026-03-24 | 初始版本 |
