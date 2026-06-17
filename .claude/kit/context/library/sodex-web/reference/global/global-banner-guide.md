# Global Banner 优先级展示系统

## 架构概览

全站 Banner 系统采用两层组件架构：

```
┌─────────────────────────────────────────────────────────────────┐
│  DepositBanner (容器层)                                          │
│  src/components/header/components/depositBanner/index.tsx       │
│  职责：数据获取 + 资格判断 + 点击处理                              │
├─────────────────────────────────────────────────────────────────┤
│  1. 获取 Banner 配置列表 (getBannerConfigList)                   │
│  2. 检查用户是否符合 Type 1 条件（充提记录为0）                    │
│  3. 处理 Type 1 点击（打开充值弹窗 / 白名单校验）                  │
└───────────────────────────┬─────────────────────────────────────┘
                            │ props: allBannerConfigList, isEligibleForType1, onType1Click
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│  GlobalBanner (展示层)                                           │
│  src/components/header/components/globalBanner/index.tsx        │
│  职责：优先级选择 + TTL 管理 + UI 渲染                            │
├─────────────────────────────────────────────────────────────────┤
│  1. 按优先级筛选 Banner：2 > 3 > 1 > 4                           │
│  2. 24小时 TTL 关闭管理（localStorage）                          │
│  3. 多语言内容适配 + URL 安全校验                                 │
│  4. Banner Action 执行（stake / deposit / url）                  │
└─────────────────────────────────────────────────────────────────┘
```

## 核心逻辑

### Banner 类型与优先级

| Type | 名称 | 优先级 | 显示条件 | 可关闭 |
|------|------|--------|----------|--------|
| 2 | 系统维护通知 | 最高 | 交易页全显/其他页 page=all | ✅ |
| 3 | 币对运营活动 | 高 | 仅交易页 + symbols 匹配当前币对 | ✅ |
| 1 | 新手用户 | 中 | 已连接钱包 + 充提记录为0 | ❌ |
| 4 | 全站通知 | 低 | 交易页全显/其他页 page=all | ✅ |

### 链维护时 GlobalBanner 的显示规则

**规则**：链维护（mode 2）+ Trade 页面时，GlobalBanner 整体隐藏。原因：Trade 页面此时已替换为 MaintenanceContent，Banner 叠加显示会造成布局混乱。

```typescript
// globalBanner/index.tsx
const isActuallyVisible = isBannerVisible && !(isChainMaintenance && isTradePage);
ui.setIsGlobalBannerVisible(isActuallyVisible);  // 同步更新移动端 spacer 高度
```

其他页面（Portfolio/Vault/Referrals 等）的 GlobalBanner 不受影响。

### DepositBanner 内 Banner 优先级（维护 vs 地区限制）

`DepositBanner` 是 GlobalBanner 的外层容器，同时也是 `RegionRestrictBanner` 的条件渲染入口。当维护状态激活时，维护优先于地区限制：

```typescript
// depositBanner/index.tsx
const isInMaintenance = isFullMaintenance || isChainMaintenance;

// loading 阶段
if (restriction.isRestrictedRegion && !isInMaintenance) {
  return <RegionRestrictBanner />;  // 维护时跳过，展示 GlobalBanner（type 2）
}

// 正常渲染阶段（同样逻辑）
if (restriction.isRestrictedRegion && !isInMaintenance) {
  return <RegionRestrictBanner />;
}
```

**优先级矩阵**：

| isInMaintenance | isRestrictedRegion | 渲染结果 |
|----------------|-------------------|---------|
| false | false | GlobalBanner |
| false | true | RegionRestrictBanner |
| true | false | GlobalBanner |
| true | true | GlobalBanner（维护优先） |

**优先级选择逻辑**：

```typescript
// globalBanner/index.tsx L122-128
const finalBannerData = useMemo(() => {
  if (type2BannerData) return type2BannerData;  // 系统维护 - 最高
  if (type3BannerData) return type3BannerData;  // 币对活动
  if (address && type1BannerData) return type1BannerData;  // 新手（需连接钱包）
  if (type4BannerData) return type4BannerData;  // 全站通知 - 最低
  return null;
}, [...]);
```

### Type 1 资格判断

```
┌─────────────────────────────────────────────────────────────┐
│  DepositBanner                                               │
│  depositBanner/index.tsx L29-58                              │
├─────────────────────────────────────────────────────────────┤
│  useEffect(() => {                                           │
│    if (!address) {                                           │
│      setIsEligibleForType1(false);  // 未连接 → 不符合       │
│      return;                                                 │
│    }                                                         │
│    const record = await fetchDepositWithdrawRecord(...);     │
│    setIsEligibleForType1(record.total === 0);  // 无记录才符合│
│  }, [address]);                                              │
└─────────────────────────────────────────────────────────────┘
```

### 24小时 TTL 关闭机制

```
┌─────────────────────────────────────────────────────────────┐
│  关闭流程                                                    │
│  globalBanner/index.tsx L190-202                             │
├─────────────────────────────────────────────────────────────┤
│  handleCloseBanner() {                                       │
│    localStorage.setItem(                                     │
│      `sodex:banner:visibility:${id}`,                        │
│      Date.now().toString()                                   │
│    );                                                        │
│    setBannerLastCloseTimeMap(prev => ({...}));               │
│  }                                                           │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  TTL 检查                                                    │
│  globalBanner/index.tsx L70-73                               │
├─────────────────────────────────────────────────────────────┤
│  const isBannerClosedWithinTTL = (bannerId) => {             │
│    const lastCloseTime = localStorage.getItem(key);          │
│    return Date.now() - Number(lastCloseTime) < 24h;          │
│  }                                                           │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  定时重置（每5分钟）                                          │
│  globalBanner/index.tsx L205-226                             │
├─────────────────────────────────────────────────────────────┤
│  useInterval(() => {                                         │
│    if (Date.now() - lastCloseTime > 24h) {                   │
│      localStorage.removeItem(key);                           │
│      setBannerLastCloseTimeMap(prev => ({...}));             │
│    }                                                         │
│  }, 5 * 60 * 1000);                                          │
└─────────────────────────────────────────────────────────────┘
```

### URL 安全校验

```typescript
// globalBanner/index.tsx L17-32
const isValidUrl = (url: string | undefined): url is string => {
  if (!url) return false;
  const lower = url.trim().toLowerCase();
  // 拒绝危险协议
  if (lower.startsWith("javascript:") || 
      lower.startsWith("data:") || 
      lower.startsWith("vbscript:")) {
    return false;
  }
  return true;
};
```

### Banner Action 系统

```
┌─────────────────────────────────────────────────────────────┐
│  点击处理                                                    │
│  globalBanner/index.tsx L178-193                             │
├─────────────────────────────────────────────────────────────┤
│  handleBannerClick() {                                       │
│    if (isType1Banner && onType1Click) {                      │
│      onType1Click();  // Type 1: 调用父组件的充值弹窗         │
│    } else if (hasAction && hasBannerAction(finalBannerData)) │
│      executeBannerAction(finalBannerData);  // stake 等      │
│    } else if (hasUrl) {                                      │
│      window.open(actionUrl, "_blank", "noopener,noreferrer");│
│    }                                                         │
│  }                                                           │
└─────────────────────────────────────────────────────────────┘
```

### Banner 样式系统

通过 `style` 字段控制 Banner 背景色，支持两种模式：

| style 值 | 背景色 | 用途 |
|----------|--------|------|
| `regular` | `rgba(59,136,111,1)` (绿色) | 常规通知 |
| `alert` | `#AA1111` (红色) | 紧急/警告通知 |

```typescript
// globalBanner/index.tsx L15-18
const BANNER_MAP = {
  regular: "bg-[rgba(59,136,111,1)]",
  alert: "bg-[#AA1111]",
}

// L243 - 根据 style 字段选择背景色
const bgColor = BANNER_MAP[finalBannerData?.style || "regular"];
```

## 文件结构

```
src/components/header/
├── index.tsx                          # Header 入口，引用 DepositBanner
└── components/
    ├── depositBanner/
    │   └── index.tsx                  # 容器层：数据获取 + 资格判断
    └── globalBanner/
        └── index.tsx                  # 展示层：优先级选择 + UI 渲染

src/http/banner/
├── index.ts                           # API: getBannerConfigList
└── api.d.ts                           # 类型定义: BannerConfigItem

src/hooks/
└── banner-action.ts                   # useBannerAction Hook
```

## 关键设计决策

### 为什么采用两层组件架构？

**问题**：Type 1 Banner 需要检查用户充提记录，这个逻辑不适合放在纯展示组件中。

**方案**：
- `DepositBanner`：负责业务逻辑（数据获取、资格判断、点击处理）
- `GlobalBanner`：负责展示逻辑（优先级选择、TTL、UI 渲染）

### 为什么 Type 1 不可关闭？

**业务需求**：新手用户 Banner 是引导充值的关键入口，不允许用户手动关闭。只有当用户产生首笔充提记录后，才会自动消失。

### 为什么使用 5 分钟轮询检查 TTL？

**问题**：localStorage 是静态的，用户长时间停留页面时，Banner 不会在 24 小时后自动恢复。

**方案**：使用 `useInterval` 每 5 分钟检查一次，超过 TTL 则清除 localStorage 并更新状态。

### 为什么链维护时 Trade 页面隐藏 GlobalBanner？

**问题**：链维护（mode 2）时，Trade 页面内容区被 `MaintenanceContent` 全量替换，GlobalBanner 叠加会造成 header 区域双层提示、布局错位。

**方案**：`globalBanner/index.tsx` 中检测 `isChainMaintenance && isTradePage`，将 `isActuallyVisible` 设为 false，同步通知 `ui.setIsGlobalBannerVisible` 确保移动端间距正确。

### 为什么维护状态优先于地区限制 Banner？

**问题**：地区受限用户处于维护状态时，`DepositBanner` 原先会优先展示 `RegionRestrictBanner`，导致维护通知（type 2 GlobalBanner）被遮盖。

**方案**：在 `depositBanner/index.tsx` 中增加 `!isInMaintenance` 条件守卫，维护期间跳过地区限制分支，直接渲染 GlobalBanner。

## 开发修改指南

### 新增 Banner 类型

1. 在 `api.d.ts` 中扩展 `bannerType` 的注释说明
2. 在 `globalBanner/index.tsx` 中新增 `typeXBannerData` 的 useMemo 筛选
3. 在 `finalBannerData` 的优先级判断中插入新类型
4. 如需特殊点击处理，在 `handleBannerClick` 中添加分支

### 修改优先级顺序

编辑 `globalBanner/index.tsx` L122-128 的 `finalBannerData` useMemo 中的判断顺序。

### 修改 TTL 时长

修改 `globalBanner/index.tsx` L13 的 `BANNER_TTL` 常量：
```typescript
const BANNER_TTL = 24 * 60 * 60 * 1000;  // 24小时
```

### 新增 Banner Action

1. 在 `src/hooks/banner-action.ts` 中扩展 `hasBannerAction` 判断
2. 在 `executeBannerAction` 中添加对应的执行逻辑

### 修改背景色样式

1. 在 `globalBanner/index.tsx` L15-18 的 `BANNER_MAP` 中添加新样式：
```typescript
const BANNER_MAP = {
  regular: "bg-[rgba(59,136,111,1)]",
  alert: "bg-[#AA1111]",
  // 新增样式
  warning: "bg-[#F5A623]",
}
```
2. 在 `api.d.ts` 中扩展 `style` 类型联合

### 控制链维护时特定页面的 Banner 显示

修改 `globalBanner/index.tsx` 中的 `isActuallyVisible` 判断：
```typescript
// 当前：链维护 + Trade 页面时隐藏
const isActuallyVisible = isBannerVisible && !(isChainMaintenance && isTradePage);
// 如需在其他页面也隐藏，在此扩展条件
```

### 修改维护与地区限制 Banner 的优先级

修改 `depositBanner/index.tsx` 中的守卫条件：
```typescript
// 当前：维护时跳过地区限制 Banner
if (restriction.isRestrictedRegion && !isInMaintenance) {
  return <RegionRestrictBanner />;
}
// 两处均需修改：loading 阶段 + 正常渲染阶段
```

## 术语表

| 术语 | 说明 |
|------|------|
| TTL | Time To Live，Banner 关闭后的隐藏时长（24小时） |
| Type 1 | 新手用户 Banner，引导首次充值 |
| Type 2 | 系统维护通知，最高优先级 |
| Type 3 | 币对运营活动，仅在匹配币对时显示 |
| Type 4 | 全站通知，最低优先级 |
| Banner Action | 点击 Banner 触发的行为（stake/deposit/url） |
| style | Banner 样式字段，控制背景色（regular/alert） |
| regular | 常规样式，绿色背景 rgba(59,136,111,1) |
| alert | 警告样式，红色背景 #AA1111 |

## 更新记录

### 2026-04-17: 维护模式 Banner 控制

- 链维护（mode 2）+ Trade 页面时隐藏 GlobalBanner（`isActuallyVisible = isBannerVisible && !(isChainMaintenance && isTradePage)`）
- 维护状态下 DepositBanner 跳过 RegionRestrictBanner，优先展示 GlobalBanner（type 2 维护通知）
- 新增维护优先级矩阵和两条设计决策说明

### 2026-03-18: 新增 style 样式字段

- 新增 `style` 字段支持 `regular`（绿色）和 `alert`（红色）两种背景色
- 新增 `hasUrl` 字段（后端返回）
- 新增 `BANNER_MAP` 常量用于样式映射

### 2026-03-18: 初始版本

初始文档，通过 /k/context learn 从代码自动生成
