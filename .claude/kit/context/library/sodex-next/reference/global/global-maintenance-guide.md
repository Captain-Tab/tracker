# 全局维护系统（Global Maintenance）

## 概述

从 sodex-web 完整迁移的两级维护系统。覆盖 5 份 spec（a/b/c/d/e）+ 6 个 PR 实施 + Banner 优先级精确对齐 spec（共 7 个 PR）。

- **状态层**：Zustand Realtime Store + React Query 30s 轮询
- **数据流**：bizClient `GET /biz/v1/maintenance/status` → normalize → store → useMaintenance hook 消费
- **失败降级**：fail-open（落 level=0）+ console.warn 未知 status，对齐 region-restrict
- **DEV 期开关**：`localStorage.maintenanceLevel`（生产 tree-shake）
- **文案**：硬编码英文（无 i18n）
- **总落点**：19 RestrictWrapper（Phase 1 升级）+ 19 MaintenanceWrapper（Phase 2 新增）+ 1 PositionOverlay（Portfolio）+ 4 TradeRouteGuard（Trade 路由）

---

## 维护级别定义

| level | status 值 | 名称 | 行为 | 范围 |
|---|---|---|---|---|
| **0** | `NORMAL` / unknown / null | 正常 | 全功能可用 | 全站 |
| **1** | `ALL_MAINTENANCE` | 全量维护 | 跳转 `/maintenance` 整页接管 | **全局** |
| **2** | `CHAIN_MAINTENANCE` | 链维护 | Trade 整页 Overlay + 按钮禁用 + Portfolio Position Overlay | **局部**（仅链上交易暂停，其它功能继续可用） |

---

## 核心架构 - 数据流

```
后端 GET /biz/v1/maintenance/status
        │  (bizClient + retry: 0，每 30s React Query 自然重试)
        ▼
infra/api/maintenanceApi.ts → GlobalStatusResponse DTO
        │
        ▼
domain/normalize.ts → toMaintenanceStatus(dto): MaintenanceStatus
        │  • status="ALL_MAINTENANCE" → level=1
        │  • status="CHAIN_MAINTENANCE" → level=2
        │  • status="NORMAL" / 未知 / null → level=0（fail-open + console.warn）
        │  • toUpperCase 抗大小写漂移
        │  • maintenanceDuration NaN/undefined/<=0 → estimatedTime=null
        ▼
containers/useInitMaintenance（App 顶层挂载）
        │  • React Query 30s 轮询，refetchIntervalInBackground:false
        │  • DEV: localStorage.maintenanceLevel="0|1|2" → enabled:false 完全脱机
        │  • onSuccess → setStatus → store
        ▼
stores/maintenanceStore.ts (Zustand Realtime)
        │  • { status, isLoaded } + setStatus / reset
        │  • 仅 Service / Init 写入；UI 禁止直接 import
        ▼
containers/useMaintenance（原子 selector）
        │  • level / isFullMaintenance / isChainMaintenance / estimatedTime / isLoaded / isInMaintenance
        ▼
6 类消费方
  • <MaintenanceInit>            : level=1 → navigate("/maintenance")（DEV 守卫跳过）
  • <TradeRouteGuard>            : level=2 → 整页替换 MaintenanceContent
  • <RestrictWrapper>            : level=2 || isRestricted → 禁用按钮（维护优先地区）
  • <MaintenanceWrapper>         : level=2 → 禁用按钮
  • <MaintenanceBanner>          : level=1||2 → 顶部 Banner（warning variant）
  • <MaintenancePositionOverlay> : level=2 → Portfolio Position 整块替换
  • useGlobalBanner              : isInMaintenance → visibleBanners=[]
  • httpClient 503 hook          : 兜底 → setStatus({level:1}) 走 SPA 路径
```

---

## 接口契约

**Endpoint**: `GET /biz/v1/maintenance/status`（公开，无需 JWT，与老项目 `src/http/maintenance/index.ts` 一致）

**实测响应（外层包装 `{code, message, data}`）**：

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "id": 1,
    "status": "NORMAL",
    "maintenanceDuration": 0,
    "createTime": 1768482818,
    "updateTime": 1776677547
  }
}
```

**字段说明**：

| 字段 | 类型 | 含义 | 前端处理 |
|---|---|---|---|
| `code` | number | 业务状态码（0 = 成功）| 不检查（fail-open，HTTP 状态决定一切）|
| `message` | string | 业务消息 | 不读取 |
| `data.id` | number | 配置记录主键 | 忽略 |
| `data.status` | `"NORMAL"` / `"ALL_MAINTENANCE"` / `"CHAIN_MAINTENANCE"` / 未知 | 维护状态枚举 | toUpperCase 抗漂移 + 三选一映射 level，未知 console.warn 落 0 |
| `data.maintenanceDuration` | number / null | 预估时长（小时）| `> 0` 才透传，否则 estimatedTime=null |
| `data.createTime` | number (Unix ts 秒) | 配置创建时间 | 忽略 |
| `data.updateTime` | number (Unix ts 秒) | 配置更新时间 | 忽略 |

**特殊情况**：
- `data` 为 null（接口异常返回）→ normalize 全字段读取均为 undefined → fail-open 落 level=0
- `dto` 整体为 null/undefined（HTTP 失败被 React Query catch）→ retry:false，30s 后下一周期再试
- `status` 大小写漂移（如返回 `"all_maintenance"`）→ toUpperCase 兼容
- 未知 `status` 字符串（如后端新增 `"READ_ONLY"`）→ console.warn 监测点 + level=0 fail-open

---

## Feature 目录结构

```
src/features/maintenance/
├── infra/
│   └── api/maintenanceApi.ts          # bizClient.get('biz/v1/maintenance/status', retry:0)
├── domain/
│   ├── types.ts                       # MaintenanceLevel = 0|1|2; MaintenanceStatus
│   └── normalize.ts                   # toMaintenanceStatus 失败降级 + 抗漂移
├── stores/
│   └── maintenanceStore.ts            # Zustand { status, isLoaded } + setStatus / reset
├── containers/
│   ├── useInitMaintenance.ts          # React Query 30s 轮询 + DEV localStorage 覆盖
│   └── useMaintenance.ts              # 原子 selector（避免对象/数组字面量返回）
├── components/
│   ├── MaintenanceInit.tsx            # 顶层挂载 + 9 状态转换矩阵
│   ├── DisabledShell.tsx              # 私有外壳：opacity-50 + Tooltip + inert
│   ├── MaintenanceWrapper.tsx         # 单一维护包裹（仅 level=2）
│   ├── RestrictWrapper.tsx            # 维护 + 地区融合（维护优先）
│   ├── MaintenanceBanner.tsx          # 顶部 Banner（warning variant）
│   ├── MaintenancePositionOverlay.tsx # Portfolio Position 区域 Overlay
│   ├── MaintenanceContent.tsx         # SoDEX logo + 文案 + T-Rex + 按钮
│   ├── TradeRouteGuard.tsx            # 路由层守卫
│   └── TRexGame/                      # T-Rex 游戏 React 包装（runner.js 移植 Chromium）
│       ├── index.tsx                  # DOM scaffold + sprite preload + lifecycle
│       ├── runner.js                  # Chromium offline page 移植 + IIFE 拆除 + ESM 导出
│       ├── runner.d.ts                # 极简类型声明
│       └── index.css                  # body.offline scoped CSS
├── pages/
│   └── MaintenancePage.tsx            # /maintenance 路由顶层 Page
├── integrations/
│   └── maintenanceInterceptor.ts      # installMaintenanceInterceptor 注入 503 兜底
├── __fixtures__/                      # 4 个 normalize fixture JSON
├── __tests__/normalize.test.ts        # 8 case 单测
└── index.ts                           # Public API
```

---

## Public API

```ts
// features/maintenance/index.ts
export type { MaintenanceStatus, MaintenanceLevel } from "./domain/types";
export { DEFAULT_HOME_ROUTE } from "./components/MaintenanceInit";        // "/trade/spot/BTC_USDC"
export { useInitMaintenance } from "./containers/useInitMaintenance";
export { useMaintenance } from "./containers/useMaintenance";
export { MaintenanceInit } from "./components/MaintenanceInit";
export { MaintenanceWrapper, MaintenanceWrapperProps } from "./components/MaintenanceWrapper";
export { RestrictWrapper, RestrictWrapperProps } from "./components/RestrictWrapper";
export { MaintenanceBanner } from "./components/MaintenanceBanner";
export { MaintenancePositionOverlay } from "./components/MaintenancePositionOverlay";
export { MaintenanceContent } from "./components/MaintenanceContent";
export { TradeRouteGuard } from "./components/TradeRouteGuard";
export { installMaintenanceInterceptor } from "./integrations/maintenanceInterceptor";
export { MaintenancePage } from "./pages/MaintenancePage";
```

**绝对禁止导出**：`stores/`、`infra/`、`domain/normalize`、`TRexGame` 内部。

---

## PR 拆分（6 + 1 个）

| PR | spec | 范围 |
|---|---|---|
| **PR 1** | a | feature 本体 + 单测（11 个文件 + 4 fixture + 1 测试 + 8 case 通过 + queryKeys 注册 + httpClient `registerMaintenanceInterceptor` 槽位）|
| **PR 2** | b | App.tsx 接入 + 503 hook 改 SPA 路径 + useGlobalBanner 守卫 + shared/constants/urls.ts |
| **PR 3** | e | MaintenancePage + T-Rex 移植 + sprite 资源 + SoDEX logo + Get Support / Join Community 按钮 |
| **PR 4** | c | App.tsx 4 条 Trade Route 包 `<TradeRouteGuard>` |
| **PR 5** | d Phase 1 | 19 处 `RegionRestrictWrapper` → `RestrictWrapper` 升级 |
| **PR 6** | d Phase 2 | 19 处 `<MaintenanceWrapper>` 新增 + 1 处 `<MaintenancePositionOverlay>` 接入 |
| **PR 7** | banner-guard | TopAlertSlot 添加链维护+Trade 路由守卫，对齐老项目 12 状态象限 |

---

## 9 状态转换矩阵（MaintenanceInit）

`src/features/maintenance/components/MaintenanceInit.tsx`：

```tsx
useEffect(() => {
  if (!isLoaded) return; // 首屏 race 守卫
  const isMaintenancePage = pathname === "/maintenance";

  if (isFullMaintenance && !isMaintenancePage) {
    if (!import.meta.env.DEV) navigate("/maintenance");  // 规则 A
  } else if (!isFullMaintenance && isMaintenancePage) {
    navigate(DEFAULT_HOME_ROUTE);                         // 规则 B
  }
}, [level, isLoaded, pathname]);
```

**两条规则覆盖 4 象限**：

| 条件 | 命中规则 | 动作 |
|------|---------|------|
| `isFullMaintenance && !isMaintenancePage` | A | → /maintenance |
| `!isFullMaintenance && isMaintenancePage` | B | → /trade |
| `isFullMaintenance && isMaintenancePage` | 无 | 无动作（正确停留）|
| `!isFullMaintenance && !isMaintenancePage` | 无 | 无动作（正确停留）|

**全部 9 种状态转换**：

| # | 从 → 到 | 用户所在页 | 命中条件 | 行为 |
|---|---------|-----------|---------|------|
| 1 | 0→0 | 交易页 | level 不变 effect 不重跑 | 保持 |
| 2 | 0→1 | 交易页 | A 规则 | → /maintenance |
| 3 | 0→2 | 交易页 | 两规则都不命中 | 保持 + TradeRouteGuard 接管 + 按钮禁用 |
| 4 | 1→0 | /maintenance | B 规则 | → /trade |
| 5 | 1→1 | /maintenance | level 不变 | 保持 |
| 6 | 1→2 | /maintenance | B 规则 | → /trade（新路由 TradeRouteGuard 检测 level=2 立即 render MaintenanceContent）|
| 7 | 2→0 | 交易页 | 两规则都不命中 | 保持，恢复正常（TradeRouteGuard 透传 children）|
| 8 | 2→1 | 交易页 | A 规则 | → /maintenance |
| 9 | 2→2 | 交易页 | level 不变 | 保持 |

**关键守卫**：
- `isLoaded` 默认 false → store level=0 但接口未返回时不触发跳转，避免误跳（首屏 race）
- DEV 守卫：仅 A 规则受守卫；B 规则 DEV 也执行（QA 需测 1→0/2→0 切换）

---

## Banner 优先级矩阵（TopAlertSlot 守卫）

`src/App.tsx` 的 `TopAlertSlot` 函数 3 条守卫规则**精确对齐老项目 DepositBanner.tsx:104 + globalBanner.tsx:244 双重守卫**：

```tsx
function TopAlertSlot() {
  const { isInMaintenance, isChainMaintenance } = useMaintenance();
  const { pathname } = useLocation();

  // 规则 1：/maintenance 路径整页接管
  if (pathname === "/maintenance") return null;

  // 规则 2：仅链维护(level=2) + Trade 路由 → 隐藏（对齐老项目 globalBanner:244）
  const isTradeRoute =
    pathname.startsWith("/trade/spot/") ||
    pathname.startsWith("/trade/futures/") ||
    pathname.startsWith("/m/trade/spot/") ||
    pathname.startsWith("/m/trade/futures/");
  if (isChainMaintenance && isTradeRoute) return null;

  // 规则 3：维护期 (level 1+2) 优先 MaintenanceBanner，否则 RegionRestrictBanner
  // （对齐老项目 DepositBanner:104 用 isInMaintenance 守卫地区 banner）
  return isInMaintenance ? <MaintenanceBanner /> : <RegionRestrictBanner />;
}
```

**两个变量精确分用（混用 = bug）**：

| 守卫位置 | 变量 | 含义 |
|---|---|---|
| 规则 2 Trade 守卫 | `isChainMaintenance` | **仅 level=2** |
| 规则 3 优先级 | `isInMaintenance` | **level 1+2** |

**12 状态象限完整对齐**（含 mobile Trade 路由）：

| level | isRestricted | 路由 | 渲染结果 |
|---|---|---|---|
| 0 | false | * | useGlobalBanner 渲染 type 1/3/4 + TopAlertSlot null |
| 0 | true | * | RegionRestrictBanner |
| 1 | * | /maintenance | null |
| 1 | * | /trade/spot/X | MaintenanceBanner（瞬时 1-2 帧）→ navigate 跳走 |
| 1 | * | /portfolio | MaintenanceBanner（瞬时）→ navigate 跳走 |
| 2 | * | /trade/spot/X / /trade/futures/X / /m/trade/spot/X / /m/trade/futures/X | null（TradeRouteGuard 替换整页）|
| 2 | false | /portfolio / /vault / /referrals 等 | MaintenanceBanner |
| 2 | true | /portfolio | MaintenanceBanner（**维护优先**压制 Region）|

**level=1 闪烁（1-2 帧）与老项目同样存在，不优化**。

---

## 错误处理机制（4 层）

### 层 1：infra 接口失败
- `bizClient.get(..., retry: 0)` 显式关闭 ky 自带重试（避免指数退避假象）
- React Query `retry: false`，30s 自然重试一次

### 层 2：domain normalize 失败降级（fail-open）
```ts
function toMaintenanceStatus(dto): MaintenanceStatus {
  const upper = typeof raw === "string" ? raw.toUpperCase() : "";
  if (upper === "ALL_MAINTENANCE") level = 1;
  else if (upper === "CHAIN_MAINTENANCE") level = 2;
  else if (upper === "NORMAL" || !raw) level = 0;
  else {
    console.warn("[maintenance] Unknown status:", raw);  // 监测点
    level = 0;  // fail-open：未知状态默认正常
  }
  // maintenanceDuration: NaN/undefined/0/-1 → estimatedTime=null
}
```

**降级合约**：
- dto/data/字段缺失 → level=0（不阻断用户）
- 未知 status 字符串 → level=0 + console.warn（监测后端契约漂移）
- 大小写漂移 → toUpperCase 兜底

### 层 3：503 兜底走 SPA 路径
`src/shared/infra/httpClient.ts` 响应拦截器：
```ts
if (response.status === 503 && !import.meta.env.DEV) {
  _maintenanceInterceptor?.onServerMaintenance();  // 写 store level=1
  throw new Error("MAINTENANCE");                  // 让原请求 reject
}
```
- DEV 守卫保留（开发期不跳转便于调试）
- interceptor 未注册时仅 throw（降级保护，用户可手动刷新）
- `installMaintenanceInterceptor()` 在 App.tsx **模块顶层**调用，保证首次 503 也能命中

### 层 4：UI 层 isLoaded 守卫
- store 默认 `level=0, isLoaded=false`
- MaintenanceInit `if (!isLoaded) return` 防止接口未返回时把"默认 0"当真实 0 触发跳转
- isLoaded 默认 false → 首次接口返回前不显示 banner / wrapper / overlay

---

## 19 处 RestrictWrapper（Phase 1 升级）

19 处旧 `RegionRestrictWrapper` 原地替换为 `RestrictWrapper`，融合"维护 + 地区"双重检测，优先级**维护 > 地区**。

| # | 文件 | 按钮 | className |
|---|---|---|---|
| 1 | `auth/components/HeaderConnectWallet/index.tsx:197` | Header Deposit | 默认 |
| 2 | `trade/components/FundWalletDialog.tsx:82` | Modal Deposit | `block w-full` |
| 3 | `trade/components/OrderForm/Spot/OrderForm.tsx:304` | Spot 提交（active=isRegionBlocked）| `block w-full` |
| 4 | `trade/components/OrderForm/Futures/OrderForm.tsx:543` | Futures 提交（active=isRegionBlocked）| `block w-full` |
| 5 | `trade/components/TickerBar/MarketTable/UsdtSwapPromo.tsx:25` | Swap Now | `block w-fit mt-6` |
| 6 | `trade/components/PositionTabs/PositionTable.tsx:232` | Adjust Margin | 默认 |
| 7-8 | `trade/components/PositionTabs/BalancesTable.tsx:38,59` | 行内 Swap / Deposit | 默认 |
| 9 | `trade/components/BalancePanel/FundingActions.tsx:24` | Deposit Funds | `block w-full col-span-2` |
| 10-11 | `referrals/components/ReferralHero/index.tsx:199,217` | Claim Rebate (active/disabled) | `block w-full` |
| 12-13 | `referrals/components/ReferralHero/index.tsx:248,263` | Trade More / Deposit More | `mobile:flex-1` |
| ~~14~~ | ~~`referrals/components/ReferralHero/index.tsx:148`~~ | ~~Invite User~~ | **已移除（2026-04-28 修订）**：老版 `hasReferralLink=true` 分支无任何 wrapper，仅打开分享弹窗，不应禁用 |
| 15-16 | `referrals/components/ReferralAssetsCard/index.tsx:187,232` | Trade Volume / Vault Deposit 进度卡 | `block flex-1 min-w-0 w-full` |
| 17 | `portfolio/components/FundingActions.tsx:27` | Portfolio Deposit | 默认 |
| 18 | `vault/components/VaultStats/index.tsx:137` | AvailabilityCard Deposit to Vault | 默认 |
| 19-20 | `vault/components/VaultHeader/index.tsx:86,106` | Get MAG7.ssi / Deposit to Vault | `block w-full pc:w-auto pc:shrink-0` |

**双层保护策略**：Trade 路由内的 7 处 wrapper 在链维护场景下因 TradeRouteGuard 整页接管 → 不会渲染。但在地区限制场景（level=0 + isRestricted=true）下仍**必须有效**——这不是冗余，是分层防护。

---

## 19 处 MaintenanceWrapper（Phase 2 新增）

按 sodex-web 老项目精确审计：仅维护需禁用、地区不限制的"链上动作触发器"。

| 子集 | 落点 |
|---|---|
| **d.1 Mobile QR** | `link-mobile-device/components/HeaderLinkDevice/index.tsx:57` |
| **d.2 Vault** | `vault/components/VaultHeader/index.tsx:97` Withdraw / `vault/components/VaultStats/index.tsx:143` Unstake / `:189` Claim |
| **d.3 Portfolio** | `portfolio/components/FundingActions.tsx:11,21` Transfer + Withdraw |
| **d.4 Referrals** | `referrals/components/ReferralAssetsCard/index.tsx:378` Customize Code（**对齐老版仅维护态禁用，地区受限不禁用**）/ `referrals/components/InviteToSoDEXModal/index.tsx:242` Save（**老项目唯一保留的 dialog 内提交按钮**）/ `referrals/components/ReferralHero/index.tsx:284` Enter here 触发器 |
| **d.5 Staking** | `staking/components/YourStakedCard.tsx:72,79,93,123` Get SOSO / Start Staking / Get SOSO / Deposit ValueChain / `staking/components/MobileStakeButton.tsx:23` Mobile Start Staking |
| **d.6 Apikeys** | `apikeys/pages/ApikeysPage.tsx:812,847,978` Mobile Create / PC Create / 空态 Generate / `apikeys/pages/ApikeysPage.tsx:931` PC Menu 触发器 / `apikeys/components/MobileApiKeyCard.tsx:132` Mobile More 触发器 |

**双重保护策略已对齐老项目**：仅包**触发按钮**，不包 Dialog 内提交按钮（老项目 Apikeys 共 0 处 dialog 内层 wrapper）。唯一例外是 InviteToSoDEXModal 的 Save 按钮——老项目实测包了，sodex-next 同步保留。

**ApiKey 列表行操作差异处理**：sodex-next 用 `Menu`（数据驱动 items）替代老项目逐 `<button>`，无法逐 item 包。等价做法是包 Menu 触发器（PC `apikeys-action-menu-trigger-${index}` + Mobile `apikeys-action-menu-trigger-mobile-${index}`），语义等价"维护期阻止用户进入操作菜单"。

---

## Portfolio Position Overlay 集成

`src/features/portfolio/pages/PortfolioPage.tsx`：

```tsx
const { isChainMaintenance } = useMaintenance();
// 链维护时整个 PositionTabs 容器替换为 Overlay；卸载 PositionTabs 让 trade ws position 订阅自动停止
{isChainMaintenance ? (
  <MaintenancePositionOverlay />  // 自带 bg-bg-black-primary-alt + min-h-[300px] + 老项目 SVG 图标
) : (
  <div className="h-120 overflow-hidden rounded-lg">
    <PositionTabs className="bg-bg-black-primary-alt" />
  </div>
)}
```

替换粒度 = 整个 PositionTabs（与 sodex-web `pages/portfolio/index.tsx:43` 替换 `<Position />` 容器一致）。

---

## 4 条 Trade Route TradeRouteGuard

`src/App.tsx`：

```tsx
<Route path="/trade/spot/:symbolId"      element={<TradeRouteGuard><SpotTradePage /></TradeRouteGuard>} />
<Route path="/trade/futures/:symbolId"   element={<TradeRouteGuard><SpotTradePage /></TradeRouteGuard>} />
<Route path="/m/trade/spot/:symbolId"    element={<TradeRouteGuard><MobileTradeExecutionPage /></TradeRouteGuard>} />
<Route path="/m/trade/futures/:symbolId" element={<TradeRouteGuard><MobileTradeExecutionPage /></TradeRouteGuard>} />
```

`TradeRouteGuard` 内部：
```tsx
const { isChainMaintenance } = useMaintenance();
return isChainMaintenance ? <MaintenanceContent /> : <>{children}</>;
```

链维护期 children 不挂载 → SpotTradePage 内 ws 订阅 / 订单簿 / position 订阅自动停止（避免持续重连失败、刷错误日志、占带宽）。

---

## MaintenancePage / T-Rex 游戏

### Page 结构（对齐老项目）
```
SoDEX Logo（mt-104）
↓
"Scheduled Maintenance in Progress"（40px 标题）
↓
"SoDEX is performing Network Upgrades to improve stability and performance."
"Estimated completion time: {hours} hours."（estimatedTime !== null 才显示）
"Thank you for your patience and understanding."
↓
[Join Community]（橙色 bg-brand + Discord 图标）
↓
[Get Support]（文字 + 耳机图标）
↓
T-Rex 游戏（PC + Mobile 同时显示，对齐老项目）
```

### T-Rex 关键决策

| 决策 | 实现 |
|---|---|
| 移植方式 | sodex-web `t-rex-runner/index.js` 整文件复制 + 拆 IIFE 让 Runner 提升到模块作用域 + ESM 导出 startRunner / destroyRunner / jump |
| body class | 挂载时 `document.body.classList.add("offline")`，卸载时移除（runner CSS 全部 scoped 在 body.offline 下）|
| 初始宽度 | CSS `.offline .runner-container { width: 600px }` 覆盖 Chromium 原版 44px 收缩动画（避免视觉"未加载"）|
| 焦点框 | CSS `outline: none` 干净视觉 |
| 键盘事件 | window 全局 keydown listener + 容器 click handler 调用 `jump()` 直调 Runner.onKeyDown（绕过 KeyboardEvent.keyCode 在合成事件中可能为 0 的浏览器差异） |
| `onKeyDown(e)` target | 必须传 `target: document.body`（runner.js 内 `if (e.target != this.detailsButton)`，传 null 时 detailsButton 也是 null → null != null 为 false 跳过整个逻辑）|
| `loadSounds()` 容错 | 整段 try-catch + getElementById null 检查（audio template 是空的，不容错会抛 TypeError 阻断 onKeyDown 流程）|

### URL 常量
- `BUG_REPORT_URL = "https://sodex-support.zendesk.com/hc/en-us/requests/new"`
- `JOIN_COMMUNITY_URL = "https://discord.com/invite/sodex"`（**与老项目 DISCORD_INVITE_URL 一致**）

放在 `src/shared/constants/urls.ts`，Header useHeadMenus + MaintenanceContent 共用。

---

## DEV Mock 与轮询测试

### `localStorage.maintenanceLevel` DEV 覆盖

```ts
function readDevLevelOverride(): MaintenanceLevel | null {
  if (!import.meta.env.DEV) return null;  // 生产 tree-shake
  const v = window.localStorage.getItem("maintenanceLevel");
  if (v === "0" || v === "1" || v === "2") return Number(v) as MaintenanceLevel;
  return null;
}

useQuery({
  ...,
  enabled: devOverride === null,  // DEV override 时完全脱机，不调接口
});
```

- 生产构建中 `devOverride` 静态常量为 `null` → tree-shake 移除
- 改值需手动刷新页面（不监听 storage 事件）

### 老项目 `localStorage.maintenanceMode = "0"` 不保留（旧版有，本次移除）

---

## 关键决策与坑点

### D-001：Banner 角色映射（修订后与老项目完全对齐）
- 老项目维护通知 = GlobalBanner 内 type 2 banner（后端数据驱动，可关闭 24h TTL）
- sodex-next 维护通知 = `<MaintenanceBanner />` 独立组件，**双层逻辑**：
  - 优先级 1：消费后端 type 2 banner（page='all' 或不限），可关闭 + 24h TTL（与 useGlobalBanner 共用同 STORAGE_PREFIX，关闭状态全站一致）
  - 优先级 2：后端无 type 2 时 fallback 硬编码英文（不可关闭，防御性兜底）
- useGlobalBanner 维护期 `!isInMaintenance` 守卫保留 → type 1/3/4 不展示
- React Query useBannerQuery 自动 dedupe → 数据复用无双请求

### D-002：守卫变量精确分用
- TopAlertSlot 规则 2 Trade 守卫 → `isChainMaintenance`（仅 level=2，对齐老项目 globalBanner:244）
- TopAlertSlot 规则 3 优先级 → `isInMaintenance`（level 1+2，对齐老项目 DepositBanner:104）
- **混用是 bug** —— 如果用 isInMaintenance 守卫 Trade 路由，会让 level=1 跳转瞬时也隐藏 banner（与老项目行为不一致）

### D-003：4 条 Trade 路由前缀硬编码
- pathname.startsWith 4 条前缀（含 `/m/trade/`）与 spec c TradeRouteGuard 路由列表一一对应
- 未来若新增 Trade 路由（如 `/trade/options/`），需同步更新 TopAlertSlot 守卫与 spec c

### D-004：MaintenanceWrapper className w-fit
- DisabledShell 默认 `inline-block`，在 VStack（flex-col）内会被拉伸为整行 → tooltip 锚点居中错位
- VaultStats 的 Claim / Unstake 等需传 `className="w-fit"` 强制宽度跟内容

### D-005：Portfolio Overlay 自带 bg
- MaintenancePositionOverlay 自带 `bg-bg-black-primary-alt + border + min-h-[300px]`
- PortfolioPage 仅在 PositionTabs 分支保留 `h-120 overflow-hidden rounded-lg` 包裹；overlay 自带尺寸，无需 overflow 限制

### D-006：useGlobalBanner isInMaintenance 守卫保留
- 维护期 useGlobalBanner 返回空数组（type 1/3/4 不展示）
- 与 TopAlertSlot 渲染 MaintenanceBanner（角色等价 type 2）协作
- 两层守卫互补不冲突

### D-007：installMaintenanceInterceptor 模块顶层
- 必须在 App 函数外、BrowserRouter 外**模块顶层**调用
- 保证首次 503（可能在 React effect 之前）也能命中
- 重复注册幂等

### D-008：T-Rex IIFE 拆除
- 老项目 runner.js 的 IIFE 包裹依赖 line 74 `window["Runner"] = Runner` 桥接到外部 ESM exports
- sodex-next 拆 IIFE 让 Runner 提升到模块作用域更干净——但行号仍保留缩进
- 同时保留 `window["Runner"] = Runner` 暴露用于 debug

### D-009：T-Rex onKeyDown null target
- runner.js 内 `if (e.target != this.detailsButton)` 是个隐性陷阱
- detailsButton 是 `outerContainerEl.querySelector('#details-button')`，sodex-next DOM 没有此元素 → null
- 传 `target: null` 时 `null != null` = false → 跳过整个 jump 逻辑
- 必须传 `target: document.body`

### D-010：Mobile T-Rex 显示
- 与 spec e 反复后定稿：**Mobile 与 PC 均显示 T-Rex**
- 不加 `mobile:hidden`，让维护期视觉一致

### D-011：BUG_REPORT_URL / JOIN_COMMUNITY_URL 单一来源
- `src/shared/constants/urls.ts` 集中常量
- Header useHeadMenus + MaintenanceContent 共用
- 改链接只改一处

### D-012：runner.js loadSounds 容错
- audio template 是空的（React 渲染空 `<template>`），原版 `getElementById(...).src` 会抛 TypeError
- 整段 try-catch 容错 + null 检查
- 否则 onKeyDown 在 `loadSounds()` 抛错跳过 `playing = true` 赋值，游戏永远启动不了

### D-013：fail-open 与 retry:0 互补
- ky retry:0 关闭重试 + React Query retry:false → 失败立即降级 level=0
- 接口失败不显示 banner / wrapper / overlay，用户体验"接口未到一律视为正常"
- 与老项目"接口失败保持当前页面状态"一致

### D-014：ReferralHero Invite User 不包 wrapper（2026-04-28 修订）
- 老版 `NewReferralHeader.tsx:314-322`：`hasReferralLink=true` 分支（已 bound）**完全无任何 wrapper**
- Phase 1 误把 ReferralHero `inviteUserButton` 包入 `RestrictWrapper` —— 已撤销
- 该按钮仅打开 `openInviteToSoDEXModal` 分享弹窗，无签名、无入金，受限地区 + 维护态都允许
- 通用法则：跨分支推断"间接拦截"语义时，必须确认源分支的所有触发条件，不能基于单条件做泛化（详见 global-restrict-guide D-011）

### D-015：ReferralAssetsCard Customize Code 仅 MaintenanceWrapper
- 老版 `ReferralAssetsCard.tsx:244-272`：仅 `MaintenanceWrapper`，无 RegionRestrictWrapper
- Phase 1 误改为 `RestrictWrapper`（理由"老版 Invite User 无 bound 时包 RegionRestrictWrapper 间接拦截 customize"）
- 该推理错误：老版的间接拦截只在"无 bound"状态生效，已 bound 后老版本来就允许 customize
- 已回退为 `MaintenanceWrapper`，地区受限不禁用 customize

---

## 文案速查（硬编码英文，无 i18n）

| 位置 | 文案 |
|---|---|
| MaintenanceWrapper / RestrictWrapper Tooltip | `Feature under maintenance` |
| MaintenanceBanner | `Scheduled maintenance is in progress. Some features may be temporarily unavailable.` |
| MaintenancePositionOverlay | `Scheduled Maintenance in Progress` |
| MaintenanceContent 标题 | `Scheduled Maintenance in Progress` |
| MaintenanceContent 副本 | `SoDEX is performing Network Upgrades to improve stability and performance.` `Estimated completion time: {hours} hours.` `Thank you for your patience and understanding.` |
| Join Community 按钮 | `Join Community` |
| Get Support 按钮 | `Get Support` |
| T-Rex 提示 | `Press Space to start` |
| RegionRestrictWrapper Tooltip | `This feature is not available in your region.`（不变）|

---

## 测试策略

| 层 | 验证手段 |
|---|---|
| Domain normalize | 8 case 单测（dto null / data null / NORMAL / ALL_MAINTENANCE / CHAIN_MAINTENANCE / 小写抗漂移 / UNKNOWN + console.warn / maintenanceDuration NaN/0/-1）|
| Container useInitMaintenance | renderHook + mock React Query（手动验证）|
| Service - | 无（无 Service 层）|
| UI 集成 | DEV Mock：`localStorage.maintenanceLevel="2"` 强制覆盖 + 浏览器手测每页 hover/click |
| 9 状态转换 | 手测 0→1, 0→2, 1→0, 1→2, 2→0, 2→1 全部象限 |

vitest 单测：`vitest run --project=unit src/features/maintenance` → 8 case 通过。

---

## 验收标准

### 功能
- [x] 30s 轮询触发，后台标签页停止（refetchIntervalInBackground:false）
- [x] level=1 → 跳 /maintenance（DEV 守卫保留）
- [x] level=2 → Trade 整页 Overlay + 按钮 opacity-50 + Portfolio Position 替换为 PositionOverlay
- [x] 503 兜底 → store level=1 → SPA 跳转
- [x] DEV `localStorage.maintenanceLevel="2"` 完全脱机
- [x] 生产 build tree-shake `localStorage.maintenanceLevel` 字符串

### 架构
- [x] feature 目录结构与 region-restrict 对称
- [x] Public API 仅导出 type / hook / component；不导出 stores / infra / normalize / TRexGame 内部
- [x] selector 全部原子，无对象/数组字面量返回
- [x] httpClient.ts 不依赖任何 features/*（仅 ky + 类型）
- [x] installMaintenanceInterceptor 模块顶层调用且幂等

### 回归
- [x] region-restrict 既有 19 处 RegionRestrictWrapper 行为不变（Phase 1 升级 RestrictWrapper 完全兼容）
- [x] OrderForm Spot/Futures 提交按钮在 region-restrict 条件激活逻辑下行为不变（active prop 由 ViewModel 控制）

### 测试
- [x] normalize 8 case 全部通过

---

## 老项目对齐细节核对（与 sodex-web global-maintenance 对照）

| 维度 | 老项目 | sodex-next | 一致？ |
|---|---|---|---|
| 接口路径 | `BASE_API_SERVER_URL + /biz/v1/maintenance/status` | `bizClient.get("biz/v1/maintenance/status")` | ✅ |
| 轮询间隔 | 30s | 30s | ✅ |
| status 枚举 | NORMAL / ALL_MAINTENANCE / CHAIN_MAINTENANCE | 同 | ✅ |
| fail-open | 失败保持当前页（level=0）| toMaintenanceStatus 失败降级 level=0 + console.warn | ✅ |
| toUpperCase 抗漂移 | 是 | 是 | ✅ |
| 跳转方式 | `useNavigate`（SPA）| `useNavigate`（SPA）| ✅ |
| isLoaded 守卫 | 是 | 是 | ✅ |
| DEV localStorage maintenanceLevel | 是 | 是（生产 tree-shake）| ✅ |
| DEV localStorage maintenanceMode="0" | 是（旧版）| **未保留**（spec a 决策） | 差异（不需要） |
| Banner 优先级（维护 > 地区） | DepositBanner:104 isInMaintenance 守卫 | TopAlertSlot 规则 3 isInMaintenance 三元 | ✅ |
| Banner 链维护+Trade 隐藏 | globalBanner:244 isChainMaintenance 守卫 | TopAlertSlot 规则 2 isChainMaintenance 守卫 | ✅ |
| Banner 实现 | type 2 后端数据驱动（可关闭 24h TTL）| 独立 MaintenanceBanner 组件（硬编码不可关闭）| 实现差异，行为等价 |
| MaintenancePage 跳转规则 | MaintenanceProvider useEffect | MaintenanceInit useEffect 9 状态矩阵 | ✅ |
| TradeRouteGuard | 老项目用 MaintenanceProvider 驱动 + 内部判断 | 显式 `<TradeRouteGuard>` 包 4 条 Route | 实现差异，效果等价 |
| RestrictWrapper 优先级 | 维护 > 地区 | 维护 > 地区 | ✅ |
| 19 处 Phase 1 升级 | 老项目 RegionRestrictWrapper → 部分升 RestrictWrapper（7 处重叠）| 全部 19 处升级 RestrictWrapper | ✅ 更彻底 |
| Phase 2 包裹策略 | 仅触发按钮（除 InviteToSoDEXModal Save 例外）| 同 | ✅ |
| InviteToSoDEXModal Save | 包 MaintenanceWrapper | 同 | ✅ |
| ApiKey 列表行操作 | 4 处（PC + Mobile drawer）逐 button 包 | sodex-next Menu 数据驱动 → 包 Menu 触发器 2 处 | 等价处理 |
| Portfolio Position Overlay 替换粒度 | 整个 `<Position />` 容器 | 整个 `<PositionTabs />` 容器 | ✅ |
| MaintenancePage Logo + 文案 + Discord 链接 | 同 | 同 | ✅ |
| BUG_REPORT_URL | `https://sodex-support.zendesk.com/hc/en-us/requests/new` | 同 | ✅ |
| DISCORD_INVITE_URL | `https://discord.com/invite/sodex` | JOIN_COMMUNITY_URL = 同值 | ✅ |
| T-Rex 游戏 | 原版 Chromium | 原样移植 + 拆 IIFE + 容错 patch | ✅ |
| Mobile T-Rex | 显示 | 显示（spec e 决策反复后定稿）| ✅ |
| i18n | 多语言 | 硬编码英文（spec 边界）| 差异（明确不做）|
| AICustomer 全局化 | 是 | sodex-next 不存在此组件 | 差异（明确不做）|
| NiceModal.Provider 提升 | 是 | sodex-next 用 modalManager | 差异（架构不同）|
| CoinCollectBanner 模式二隐藏 | 是 | sodex-next 不存在此 Banner | 差异（不需要）|

---

## 总落点统计

- **RestrictWrapper**：20 处（Phase 1 升级 19 + Invite User 补漏 1）
- **MaintenanceWrapper**：19 处（页面入口 15 + InviteToSoDEXModal Save 1 + ApiKey Menu 触发器 2 + ApiKey empty Generate 1）
- **MaintenancePositionOverlay**：1 处（Portfolio）
- **TradeRouteGuard**：4 处（4 条 Trade Route）
- **TopAlertSlot 守卫**：3 条规则（1 路径 + 1 链维护 + 1 优先级）
- **httpClient 503 hook**：1 处（registerMaintenanceInterceptor 模块顶层注入）
- **总计**：48 个生效点 + 8 case 单测通过

---

## 集成点

### 修改文件
- `src/App.tsx`（installMaintenanceInterceptor 模块顶层 + MaintenanceInit + TopAlertSlot + 4 TradeRouteGuard + DEFAULT_HOME_ROUTE Navigate + StickyTopBar 隐藏 /maintenance）
- `src/shared/infra/httpClient.ts`（503 hook 调 _maintenanceInterceptor + registerMaintenanceInterceptor + _getMaintenanceInterceptor）
- `src/shared/queryKeys/index.ts`（maintenance.status() 工厂）
- `src/shared/components/features/Header/_hooks/useHeadMenus.tsx`（bugReport href → BUG_REPORT_URL）
- `src/features/market/containers/useGlobalBanner.ts`（isInMaintenance 守卫）
- `src/features/portfolio/pages/PortfolioPage.tsx`（PositionTabs 条件渲染 Overlay）
- 38 个按钮 wrapper 升级 / 新增（详见 19+19 章节）

### 新增文件
- `src/features/maintenance/**`（feature 完整实现 17 个文件 + 4 fixture + 1 test）
- `src/shared/constants/urls.ts`（BUG_REPORT_URL + JOIN_COMMUNITY_URL）
- `src/assets/img/maintenance/{100,200}-offline-sprite.png`（T-Rex sprite）
- `src/assets/img/maintenance/SoDEX.svg`（Logo）
- `src/assets/img/maintenance/portfolio-maintenance.svg`（Position Overlay 图标）
