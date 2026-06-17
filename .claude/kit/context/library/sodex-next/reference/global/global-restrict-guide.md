# Global Restrict — 地区限制功能（sodex-next）

> 从 sodex-web 迁移到 sodex-next-feature 的完整实现。基于 IP 检测限制特定地区用户（如美国）的 deposit / buy / open position 等入金性质操作，保留 withdraw / transfer / sell / unstake / Stake 等退出与已有资产操作。
>
> **本次迁移涵盖 5 份 spec（a/b/c/d/e）共 18 个生效使用点 + 1 个跨组件能力扩展（ConnectedDeposit lockedToken/lockedChain）**。

## 概述

- 接口：`GET /biz/user/restrictedRegion`（无需 JWT，bizClient + VITE_BIZ_URL 环境变量自动切环境）
- 失败降级：接口失败 / 字段缺失 → 不限制（`isRestricted=false`）。**无 retry**（防伪轮询）
- UI：受限用户全局红色 Banner（含 Terms of Use 链接）+ 18 处按钮 / link 包裹，opacity-50 + tooltip + inert
- 文案：硬编码英文，未做 i18n
- 状态层：Zustand Realtime Store + React Query 一次性拉取，会话内永不重拉

---

## 核心架构

### 数据流

```
App.tsx <RegionRestrictInit /> 顶层挂载
  ↓
useInitRegionRestrict()
  ↓ React Query (staleTime=Infinity, gcTime=Infinity, retry=false, 全部 refetchOn*=false)
GET /biz/user/restrictedRegion (bizClient → vite proxy /proxy/biz)
  ↓
toRegionStatus(dto) [domain/normalize]
  ↓ status: { isRestricted, region } | null
useRegionStore.setStatus()
  ↓
useRegionRestrict() → { isRestricted, region, isLoaded, tooltipText }
  ↓
RegionRestrictBanner（受限态显示）
RegionRestrictWrapper（active=true && isRestricted=true 时禁用子节点）
```

### Feature 目录结构

```
src/features/region-restrict/
├── infra/
│   └── api/regionApi.ts                   # bizClient.get("biz/user/restrictedRegion")
├── domain/
│   ├── types.ts                           # RegionStatus
│   └── normalize.ts                       # toRegionStatus(dto) 失败降级合约
├── stores/
│   └── regionStore.ts                     # Zustand: { status, isLoaded } + setStatus / reset
├── containers/
│   ├── useInitRegionRestrict.ts           # App 顶层 init hook（一次性拉取）
│   └── useRegionRestrict.ts               # 业务消费 hook
├── components/
│   ├── RegionRestrictWrapper.tsx          # active prop 条件激活 + className 透传
│   └── RegionRestrictBanner.tsx           # 红色 Banner + Terms of Use 链接
├── __tests__/
│   └── normalize.test.ts                  # 6 case 失败降级合约
└── index.ts                               # Public API（仅导出 type/hook/wrapper/banner）
```

### Public API（`index.ts`）

```ts
export type { RegionStatus } from "./domain/types";
export { useInitRegionRestrict } from "./containers/useInitRegionRestrict";
export { useRegionRestrict } from "./containers/useRegionRestrict";
export { RegionRestrictWrapper } from "./components/RegionRestrictWrapper";
export type { RegionRestrictWrapperProps } from "./components/RegionRestrictWrapper";
export { RegionRestrictBanner } from "./components/RegionRestrictBanner";
```

绝对禁止导出：`stores/`、`infra/`、`domain/normalize`。

---

## 完整修改点（22 个生效使用点 + 1 项跨组件扩展）

> **后续修订记录**：spec d 完成后，maintenance feature 实施时把所有 `RegionRestrictWrapper` 升级为 `RestrictWrapper`（联合维护+地区）。当前项目内**0 处**单独使用 `RegionRestrictWrapper`，全部走 `RestrictWrapper`（来自 `@/features/maintenance`）。
>
> 业务调整后实际使用点：18 + 4 修订 = **22**（Invite User -1、Customize -1（已含在原 18 内）、Apikeys Deposit More PC/Mobile +2、ApiKeys EligibilityCard restrictableAction prop +2 = 22）

### Spec a — Feature 本体（11 个新建文件 + 1 个修改）

| 文件 | 改动 |
|---|---|
| `src/features/region-restrict/domain/types.ts` | 新建 — `RegionStatus = { isRestricted: boolean; region: string | null }` |
| `src/features/region-restrict/domain/normalize.ts` | 新建 — `toRegionStatus(dto)` 失败降级（dto/data null/字段缺失全部回落 false） |
| `src/features/region-restrict/__tests__/normalize.test.ts` | 新建 — 6 case 单测（dto=null / data=null / true / false 空字符串 / `=== true` 严格判断防 truthy） |
| `src/features/region-restrict/infra/api/regionApi.ts` | 新建 — `regionApi.fetchRestrictedRegion(signal)` 调 `bizClient.get("biz/user/restrictedRegion")` |
| `src/features/region-restrict/stores/regionStore.ts` | 新建 — Zustand `{ status, isLoaded } + setStatus/reset`；selector 必须原子，不暴露 |
| `src/features/region-restrict/containers/useInitRegionRestrict.ts` | 新建 — React Query `staleTime/gcTime: Infinity`，`retry: false`，全部 `refetchOn*: false` |
| `src/features/region-restrict/containers/useRegionRestrict.ts` | 新建 — 原子 selector + 派生 `isRestricted` |
| `src/features/region-restrict/components/RegionRestrictWrapper.tsx` | 新建 — Tooltip(asChild) + `inert={blocked}` + `cn("inline-block", className)` 透传 |
| `src/features/region-restrict/components/RegionRestrictBanner.tsx` | 新建 — `Alert variant="error"` + Terms of Use 内联 `<a>` |
| `src/features/region-restrict/index.ts` | 新建 — Public API |
| `src/shared/queryKeys/index.ts` | 修改 — 注册 `regionRestrict.status()` 工厂 |

### Spec b — App 接入（1 个修改）

| 文件 | 改动 |
|---|---|
| `src/App.tsx` | (1) import `useInitRegionRestrict`/`RegionRestrictBanner`；(2) 新建内部组件 `RegionRestrictInit`；(3) 在 `<MarketConfigPrefetch />` 后挂 `<RegionRestrictInit />`；(4) sticky 容器内 `<GlobalBanner />` 后追加 `<RegionRestrictBanner />` |

### Spec c — OrderForm 条件包裹（6 个修改）

| 文件 | 改动 |
|---|---|
| `src/features/trade/containers/spotOrderFormLogic.ts` | 新增 `deriveSpotRegionBlocked(buttonState, side): boolean` 纯函数（限制矩阵：deposit \|\| (submit && BUY)） |
| `src/features/trade/containers/perpsOrderFormLogic.ts` | 新增 `derivePerpsRegionBlocked(buttonState): boolean`（限制矩阵：deposit \|\| submit；不接收 side，因 Buy Long/Sell Short 都开仓） |
| `src/features/trade/__tests__/spotOrderFormLogic.test.ts` | 追加 14 case |
| `src/features/trade/__tests__/perpsOrderFormLogic.test.ts` | 追加 7 case |
| `src/features/trade/containers/useSpotOrderFormViewModel.ts` | 引入 `useRegionRestrict`；`isRegionBlocked = isRestricted && deriveSpotRegionBlocked(buttonState, side)`；`handleSubmit` 顶部增加守卫；返回字段新增 `isRegionBlocked` |
| `src/features/trade/containers/usePerpsOrderFormViewModel.ts` | 同 Spot ViewModel |
| `src/features/trade/components/OrderForm/Spot/OrderForm.tsx` | line 303 提交按钮包 `<RegionRestrictWrapper active={vm.isRegionBlocked} className="block w-full">` |
| `src/features/trade/components/OrderForm/Futures/OrderForm.tsx` | line 551 提交按钮同上 |

### Spec d — 14 处无条件按钮包裹（11 个文件 / 18 个生效使用点）

| # | 语义 | 文件:行 | className 透传 |
|---|---|---|---|
| 1 | Header Deposit | `auth/components/HeaderConnectWallet/index.tsx` line 197 | 默认 `inline-block` |
| 2 | Trade BalancePanel Deposit Funds | `trade/components/BalancePanel/FundingActions.tsx` line 23 | `block w-full col-span-2`（grid 跨列） |
| 3 | Portfolio Deposit | `portfolio/components/FundingActions.tsx` line 26 | 默认 |
| 4 | Adjust Margin cell（isolated 模式） | `trade/components/PositionTabs/PositionTable.tsx` line 230 | 默认（行内）；CROSS 分支不包 |
| 5 | BalancesTable 行内 Swap | `trade/components/PositionTabs/BalancesTable.tsx` line 37 | 默认 |
| 6 | BalancesTable 行内 Deposit | 同上 line 56 | 默认 |
| 7 | UsdtSwapPromo Swap Now | `trade/components/TickerBar/MarketTable/UsdtSwapPromo.tsx` line 24 | `block w-fit mt-6`（保持居中） |
| 8 | FundWalletDialog Deposit SelectCard | `trade/components/FundWalletDialog.tsx` Deposit 卡片 | `block w-full`；Transfer 卡片不包 |
| 9 | Vault Get MAG7.ssi | `vault/components/VaultHeader/index.tsx` line 85 | `block w-full pc:w-auto pc:shrink-0` |
| 10 | Vault Deposit to Vault (Header) | 同上 line 103 | `block col-span-2 w-full pc:col-span-1 pc:w-auto pc:shrink-0` |
| 11-12 | Vault VaultStats Deposit to Vault（覆盖 ValueChain + Base 两处） | `vault/components/VaultStats/index.tsx` AvailabilityCard 内部 line 134 | 默认；Unstake 不包 |
| 13 | Referrals Hero Claim Rebate（disabled 分支 cooldown） | `referrals/components/ReferralHero/index.tsx` line 200 | `block w-full` |
| 14 | Referrals Hero Claim Rebate（active 分支 可领取） | 同上 line 214 | `block w-full` |
| 15 | Referrals Hero Trade More | 同上 line 243 | `mobile:flex-1` |
| 16 | Referrals Hero Deposit More | 同上 line 254 | `mobile:flex-1` |
| 17 | Referrals AssetsCard Trade Volume 进度卡 | `referrals/components/ReferralAssetsCard/index.tsx` line 188 | `block flex-1 min-w-0 w-full` |
| 18 | Referrals AssetsCard Vault Deposit 进度卡 | 同上 line 231 | `block flex-1 min-w-0 w-full` |

### 后续业务修订（2026-04-28）

| # | 语义 | 文件:行 | 改动类型 |
|---|---|---|---|
| **19** | ApiKeys EligibilityCard PC **Deposit More** | `apikeys/pages/ApikeysPage.tsx:1031` `restrictableAction` prop | 新增（业务覆盖老版无 wrapper） |
| **20** | ApiKeys EligibilityCard Mobile **Deposit More** | `apikeys/pages/ApikeysPage.tsx:1096` `restrictableAction: true` | 新增 |
| ~~14~~ | ~~Referrals Hero Invite User (eligible=true)~~ | `ReferralHero/index.tsx:152` | **已移除**：老版 `hasReferralLink=true` 分支无 wrapper |
| ~~Customize~~ | ~~ReferralAssetsCard Customize Code (RestrictWrapper)~~ | `ReferralAssetsCard/index.tsx:378` | **回退**为 `MaintenanceWrapper`：老版仅维护态禁用 |

> 实施细节：`EligibilityCard` 增加 `restrictableAction?: boolean` prop，PC + Mobile 渲染分支分别按 prop 条件包 `RestrictWrapper`。仅 Account Value 卡片（Deposit More）传 true，Trade More / Earn More Points 不传。Mobile 数据数组 `restrictableAction: true` 通过 spread 透传到 `<EligibilityCard>`。

### Spec e — ConnectedDeposit lockedToken/lockedChain 能力（6 个修改）

业务漏洞封堵：受限地区用户从 Stake 进入 Deposit into ValueChain 弹窗后可切换到 USDC + Base 触发普通入金，绕过 region。

| 文件 | 改动 |
|---|---|
| `src/shared/components/features/Deposit/type.ts` | `DepositProps` 增加 `lockedToken? / lockedChain?` 可选 boolean |
| `src/shared/components/features/Deposit/index.tsx` | 解构默认 `false` 透传到 `<TokenSelector disabled>` / `<ChainSelector disabled>` |
| `src/shared/components/features/Deposit/_components/TokenSelector.tsx` | `disabled=true` 时返回纯静态 `<div>`（label + logo + symbol，**无下拉框 / 无 ChevronDown**） |
| `src/shared/components/features/Deposit/_components/ChainSelector.tsx` | 同上 |
| `src/features/trade/components/ConnectedDeposit/index.tsx` | `OpenDepositProps` Pick 扩展 `lockedToken / lockedChain`；组件解构 + 透传 |
| `src/features/staking/components/YourStakedCard.tsx` | 调用 `openConnectedDeposit` 时按 `useRegionRestrict().isRestricted` 条件传 `lockedToken / lockedChain` |

> 关键设计：ConnectedDeposit/Deposit/TokenSelector 不感知 region；调用方（YourStakedCard）显式传 props 决定锁定行为。**默认 false → 其他所有调用点（Header/Portfolio/BalancePanel/BalancesTable/Vault/FundWalletDialog/OrderForm/Apikeys）行为完全不变**。

### 显式不在范围

| 类别 | 原因 |
|---|---|
| Spot Sell / Futures Close / Transfer / Withdraw | 退出 / 划转，旧 guide 一致允许 |
| Vault Withdraw / Unstake to MAG7.ssi | 退出操作 |
| Staking 全部 3 按钮（Get SOSO to Stake / Get SOSO / Deposit into ValueChain）的 RegionRestrictWrapper | 旧版 2026-03-26 显式移除（用已有资产、锁定弹窗豁免）；锁定弹窗能力由 Spec e 补 |
| ApiKeys 全部按钮 | 旧版 grep 验证从未包；归 maintenance Spec 2。**例外**：2026-04-28 业务决策追加 `EligibilityCard` 的 **Deposit More** 按钮（PC + Mobile）受限禁用，老版未包但新业务要求拦截。`Trade More` / `Earn More Points` 不限制 |
| Referrals Invite User（eligible=true 已 bound）| 老版 `hasReferralLink=true` 分支无任何 wrapper；仅打开分享弹窗，无签名 / 无入金 |
| Referrals Customize Your Own Referral Code | 老版仅 `MaintenanceWrapper`，地区受限不禁用 |
| Referrals Enter Code | 仅 MaintenanceWrapper（签名操作） |
| OrderForm enable / connect / transfer / watching / insufficient | 非入金性质或已被原 disabled 状态拦截 |
| FundWalletDialog Transfer 卡片 | 保留划转可用性（Spec d #17 仅包 Deposit 卡片，覆盖 OrderForm BUY insufficient → fundWallet 漏洞） |
| Banner 优先级（Region vs GlobalBanner 共存） | 留给 maintenance Spec 2 编排 |
| i18n | 硬编码英文 |
| `localStorage.regionMode` 开发者绕过 | 已上线后移除；只走真实接口 |

---

## 关键决策与坑点

### D-001 接口路径必须带 `biz/` 前缀

```ts
// ❌ 错误（404）
bizClient.get("user/restrictedRegion")
// vite proxy /proxy/biz rewrite 后 → /user/restrictedRegion → alpha-biz.sodex.dev/user/restrictedRegion → 404

// ✅ 正确（200）
bizClient.get("biz/user/restrictedRegion")
// vite proxy rewrite 后 → /biz/user/restrictedRegion → alpha-biz.sodex.dev/biz/user/restrictedRegion → 200
```

`VITE_BIZ_URL=/proxy/biz` 仅作 host 转发；后端实际路径 `/biz/...` 必须保留前缀。其他 bizClient 调用（depositApi / referralApi / authApi）也都带 `biz/` 前缀。

### D-002 retry: false（防伪轮询）

合规规则是"接口失败 = 不限制"，重试无业务意义。**ky httpClient 自带 `retry: { limit: 2, methods: ["get"] }` + React Query 默认 `retry: 3`** = 1 次 queryFn 调用 → 最多 9 次 HTTP；React Query 还有 1s/2s/4s 指数退避，看起来像"轮询"。

修复：`retry: false`（覆盖 React Query default）。ky 内部 retry 由 query 仅 1 次的语义自然抑制（成功就停）。

### D-003 staleTime/gcTime: Infinity + 全部 refetchOn*: false

地区在会话内不会变（IP 不会突然换国家）。整个会话只发 1 次请求，永不刷新缓存：

```ts
useQuery({
  staleTime: Infinity,
  gcTime: Infinity,
  retry: false,
  refetchOnMount: false,
  refetchOnReconnect: false,
  refetchOnWindowFocus: false,
  refetchInterval: false,
});
```

### D-004 失败降级 normalize 用 `=== true` 严格判断

```ts
isRestricted: dto.data.isRestrictedRegion === true,
```

防止后端如果返回字符串 `"true"` 被 truthy 误判为受限 → 误伤正常用户。6 case 单测锁住此不变量。

### D-005 RegionRestrictWrapper inert 防键盘 Tab + Enter

React 19 原生 `inert={blocked}` 屏蔽焦点 / 键盘 / 屏幕阅读器。Spot/Perps OrderForm `handleSubmit` 顶部还有 `if (isRegionBlocked) return` 守卫做最后兜底防键盘 Enter。

### D-006 className 透传可覆盖默认 inline-block

`<RegionRestrictWrapper className="block col-span-2 w-full">` 用 `cn("inline-block", className)` 让外部值后置覆盖。grid / flex 场景必须把布局类（col-span-2 / flex-1 / w-full）从按钮上提到 wrapper，否则布局破裂。

### D-007 Vault VaultStats 内部包裹一处覆盖 2 个使用点

`AvailabilityCard` 在 VaultStats 内被渲染 2 次（ValueChain + Base）。在 `AvailabilityCard` 内部 ActionLink 外层包 wrapper 一次，自动覆盖外层两个调用点。Unstake 不包。

> 隐含约束：未来若 AvailabilityCard 被 lift 到 shared 组件复用，需重新评估 wrapper 副作用。

### D-008 FundWalletDialog Deposit 卡片漏洞

OrderForm `buttonState='insufficient' && side='BUY'` 时 `decideSpotModalIntent` 返回 `kind:"fundWallet"` → 打开 `FundWalletDialog`。Spec c 不限制 insufficient 状态（保留 Transfer 选项可用），但弹窗内 Deposit 卡片是真实入金入口 → 必须在 Spec d 单独包 `<RegionRestrictWrapper>`，Transfer 卡片不包。

### D-009 ConnectedDeposit 锁定模式无下拉框

旧版 sodex-web `lockedCoin/lockedChain` 在弹窗内灰显但保留下拉箭头。**新版调整为不渲染 ComboBox**：disabled=true 时 TokenSelector / ChainSelector 直接渲染纯静态 `<div>` 显示当前选中值（label + logo + name），**无下拉箭头、无 popover trigger**。仅 Stake 入口（且仅当 region 受限）时启用。

### D-010 项目 README 与 spec 文档保留位置

5 份 spec 文件在 `.claude/kit/spec/migration-globa-region-restrict/`，README 含执行流程 + 决策记录 + 文件矩阵。本 reference 是简化的合并版（用户消费视角）。

### D-011 Referrals "间接拦截"语义不可外推

**误判教训**：曾把 ReferralAssetsCard 的 `Customize Your Own Referral Code` 按钮从 `MaintenanceWrapper` 改为 `RestrictWrapper`，理由是"老版 NewReferralHeader Invite User (无 bound) 用 RegionRestrictWrapper 间接拦截美国用户进入 customize 流程"。

老版的间接拦截**仅在"无 bound"状态生效**——一旦用户已 bound（`hasReferralLink=true` ≈ 新版 `eligible=true`），老版 Invite User 就**完全不包 wrapper**，customize 流程也是仅 `MaintenanceWrapper`。

正确语义：
- Invite User（已 bound 分支）→ 无任何 wrapper（仅打开分享弹窗）
- Customize Your Own Referral Code → 仅 `MaintenanceWrapper`
- Customize 是签名操作（generate referral code），归维护管，不归地区管

**通用法则**：跨分支推断"间接拦截"语义时，必须确认源分支的所有触发条件，不能基于单条件做泛化。

### D-012 Tailwind v4 单处使用 `hidden pc:*` 漏编译

`hidden pc:block` / `hidden pc:flex` 在项目内**单处使用 + dev HMR 缓存**情况下，Tailwind v4 偶发漏生成 `.pc\:block` / `.pc\:flex` 规则。表现：元素仍 `display: none`（base 类生效），`pc:` 修饰类不覆盖。

确诊方法：
```js
const allRules = Array.from(document.styleSheets).flatMap(s => Array.from(s.cssRules || []));
allRules.find(r => r.cssText?.includes('pc\\:block'))   // 应找到，找不到 = 漏编译
```

修复方案：把 `hidden pc:block` 改为 `block mobile:hidden`（反向写法，`mobile:hidden` 项目多处使用确保编译）。

已修复位置：WeeklyPerformance / StakingHeader / YourStakedCard 三处（PriceDataTab 同模式但用户未确认，未改）。

### D-013 ApiKeys EligibilityCard restrictableAction prop

**老版语义**：ApiKeys 页面所有按钮都不包 RegionRestrictWrapper（老版 `pages/apiKey/index.tsx:680-720` 数据数组直接传 `onClick`）。

**新版业务覆盖**：受限地区用户不能从 ApiKeys 页面入金升级账户价值。Account Value 卡片的 **Deposit More** 按钮（PC + Mobile 共 2 处）需禁用。

**实现选择**：给 `EligibilityCard` 加 `restrictableAction?: boolean` prop（默认 false），组件内部按 prop 条件包 `RestrictWrapper`，仅 Account Value 卡片传 true。**未外层包 wrapper** —— 否则整卡（图标 / 标题 / 进度条）一起 opacity-50，影响信息可读。

### D-014 useGlobalBanner isRestricted 守卫

`useGlobalBanner` 已有 `isInMaintenance` 守卫（维护态返回空 banners）。**追加 `isRestricted` 守卫**，受限态也返回空 banners。

**问题**：受限态 + 有运营公告时，GlobalBanner（公告）+ RegionRestrictBanner（合规）**双 banner 同屏**。

**修复**：`useGlobalBanner` 内 `visibleBanners = useMemo(...,!isInMaintenance && !isRestricted && banners?.length ? ... : [])`。语义"受限态优先 RegionBanner，运营公告让位"。市场 feature 多一个 `region-restrict` 依赖（与 `maintenance` 一致，可接受）。

---

### D-099 历史误判清单（防止重复犯错）

| 时间 | 误判 | 表现 | 修复 |
|---|---|---|---|
| 2026-04-28 | ApiKeys 全部按钮按老版完全不包 wrapper | 业务实际希望 Deposit More 受限禁用 | 加 `restrictableAction` prop（D-013） |
| 2026-04-28 | Customize Code 按"老版 region wrapper 间接拦截"逻辑改成 RestrictWrapper | 已 bound 用户被错误禁用 customize | 回退到 MaintenanceWrapper（D-011） |
| 2026-04-28 | Invite User 已 bound 分支错误添加 RestrictWrapper | 已有邀请码用户无法分享 | 移除 wrapper（D-011） |
| 2026-04-28 | retry: 3 + ky internal retry: 2 → "伪轮询" | failed 后 1s/2s/4s 退避重试 | retry: false（D-002） |
| 2026-04-28 | bizClient 路径漏写 `biz/` 前缀 | 接口 404 | 加 `biz/` 前缀（D-001） |
| 2026-04-28 | 受限态 GlobalBanner 与 RegionBanner 双显 | useGlobalBanner 没 region 守卫 | 追加 `isRestricted` 守卫（D-014） |
| 2026-04-28 | `hidden pc:block` 编译漏类 | WeeklyPerformance 表格不显示 | 改为 `block mobile:hidden`（D-012） |

---

## 限制规则矩阵

### Spot OrderForm

| buttonState | side | 限制 | 说明 |
|---|---|---|---|
| `watching` | - | ❌ | 已禁用 |
| `connect` | - | ❌ | 未涉及资金 |
| `enable` | - | ❌ | 签名鉴权非入金 |
| `deposit` | - | ✅ | 入金创建账户 |
| `transfer` | - | ❌ | 账户间划转 |
| `insufficient` | BUY | ❌ | 由 Spec d FundWalletDialog Deposit 卡片单独限制 |
| `insufficient` | SELL | ❌ | 已禁用 |
| `submit` | BUY | ✅ | 买入 = 入金性质 |
| `submit` | SELL | ❌ | 卖出 = 退出持仓 |

### Perps OrderForm

| buttonState | 限制 | 说明 |
|---|---|---|
| `watching` / `connect` / `enable` / `insufficient` / `reduceOnlyTooLarge` | ❌ | 非入金或已禁用 |
| `deposit` | ✅ | 入金创建账户 |
| `submit`（Buy Long / Sell Short 任一） | ✅ | 都是开仓属入金性质 |

---

## 测试策略

| 测试 | 文件 | 锁住的不变量 |
|---|---|---|
| `toRegionStatus` 6 case | `region-restrict/__tests__/normalize.test.ts` | 失败降级合约：dto / data / 字段缺失 = 不限制；`=== true` 严格判断防字符串 truthy |
| `deriveSpotRegionBlocked` 14 case | `trade/__tests__/spotOrderFormLogic.test.ts` | Spot 限制矩阵：deposit \|\| (submit && BUY) |
| `derivePerpsRegionBlocked` 7 case | `trade/__tests__/perpsOrderFormLogic.test.ts` | Perps 限制矩阵：deposit \|\| submit |

`npx vitest run --project=unit src/features/region-restrict src/features/trade/__tests__/spotOrderFormLogic.test.ts src/features/trade/__tests__/perpsOrderFormLogic.test.ts` → 383/383 通过。

---

## API 参考

### `useRegionRestrict()`

```ts
function useRegionRestrict(): {
  isRestricted: boolean;
  region: string | null;
  isLoaded: boolean;
  tooltipText: "This feature is not available in your region.";
};
```

业务消费唯一入口。selector 原子读取 store；接口未返回时返回 `{ isRestricted: false, isLoaded: false }`（不限制）。

### `<RegionRestrictWrapper>`

```ts
type RegionRestrictWrapperProps = {
  children: ReactNode;
  active?: boolean;     // 默认 true。OrderForm 按 buttonState 条件传 false
  className?: string;   // 透传到 wrapper 根 div，外部值后置可覆盖默认 inline-block
};
```

`active && isRestricted` 同时为 true 时激活：外层 div + Tooltip(asChild)，内层 div `opacity-50 pointer-events-none inert`。否则透传 children 不渲染额外 DOM。

### `<RegionRestrictBanner>`

无 props。`isRestricted=true` 时显示 `Alert variant="error"`：

> You're accessing SoDEX from a restricted jurisdiction. Only withdrawals are available. For more details, see our **[Terms of Use](https://sodex.com/documentation/resources/terms-of-use)**.

`<a>` 用 inline `style={{textDecoration:"underline"}}` 强制下划线（global.css `a { text-decoration: none }` 高于 Tailwind `underline` 类）。

### `OpenDepositProps`（Spec e 扩展）

```ts
export type OpenDepositProps = Pick<
  DepositProps,
  "token" | "chain" | "lockedToken" | "lockedChain"
>;
```

`lockedToken / lockedChain` 默认 false，调用方显式传 true 时弹窗内的 selector 渲染为静态 div（无下拉）。

---

## 受限用户行为速览

| 操作 | 允许 |
|---|---|
| 浏览所有页面 | ✅ |
| Withdraw（提现） | ✅ |
| Transfer（账户间划转） | ✅ |
| Spot Sell（现货卖出） | ✅ |
| Futures Close Position（平仓） | ✅ |
| Unstake to MAG7.ssi（解除质押） | ✅ |
| Stake / Get SOSO to Stake / Get SOSO（用已有资产 / 跳转 trade 受 OrderForm 限制） | ✅ |
| Deposit into ValueChain（仅 sSOSO + 锁定 ValueChain，质押专用） | ✅ |
| FundWalletDialog 内 Transfer 卡片 | ✅ |
| Header / Portfolio / BalancePanel / Vault / Apikeys 等 Deposit 入口 | ❌ |
| Spot Buy / Futures Buy Long / Futures Sell Short | ❌ |
| Vault Get MAG7.ssi / Deposit to Vault | ❌ |
| BalancesTable 行内 Swap / Deposit | ❌ |
| UsdtSwapPromo Swap Now | ❌ |
| FundWalletDialog 内 Deposit 卡片 | ❌ |
| Adjust Margin（isolated 模式调保证金） | ❌ |
| Referrals Claim Rebate / Trade More / Deposit More / AssetsCard 进度卡 | ❌ |

---

## 📅 更新记录

| 日期 | 内容 |
|---|---|
| 2026-04-28 | 从 sodex-web 完整迁移：Spec a/b/c/d/e 全部完成；接口路径修正为 `biz/user/restrictedRegion`；retry: false 防伪轮询；移除 localStorage 开发者绕过开关 |
| 2026-04-28 | 后续业务修订：(1) ReferralHero Invite User (eligible=true) 移除 wrapper；(2) ReferralAssetsCard Customize Code 回退为 MaintenanceWrapper；(3) ApiKeys EligibilityCard 新增 `restrictableAction` prop，PC + Mobile Deposit More 受限禁用；(4) `useGlobalBanner` 增加 `isRestricted` 守卫避免与 RegionBanner 同屏 |
| 2026-04-28 | Tailwind v4 漏编译修复：`hidden pc:block` → `block mobile:hidden`（WeeklyPerformance / StakingHeader / YourStakedCard 三处） |
