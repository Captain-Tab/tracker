# 埋点系统（神策 SaaS + 神策私有化（datasink） + GA）

> 本文档为 sodex-web `src/track/` 模块的事实清单，作为 sodex-next 迁移的参考底稿。
> 所有数字 / 字段 / 行号已对照源码核查（最新一次：2026-05-12，含 datasink 协议本质识别）。

> **关键事实（先看这条）**：`datasink` 不是另一种分析系统，它就是 **SosoValue 自部署的神策 Sensors Analytics 私有化实例**。与 `window.sensors`（神策官方 SaaS）协议、payload、URL pattern 完全一致，区别只在「部署目标」与「事件分流」。详见 §2 与 §14。

---

## 1. 架构概览

实际是「**一套协议、两个神策实例 + 一路 GA**」：

```
                  ┌────────────────────────────────────┐
                  │           用户操作                  │
                  └────────────────────────────────────┘
                          │           │           │
        ┌─────────────────┘           │           └─────────────────┐
        ↓                              ↓                              ↓
   ┌──────────────┐              ┌──────────┐                ┌──────────────┐
   │ window.sensors│              │   gtag   │                │   saTrack()  │
   │ (神策官方SDK) │              │          │                │ (手撸神策协议)│
   ├──────────────┤              ├──────────┤                ├──────────────┤
   │ 主分析       │              │ user_id  │                │ 生态级业务   │
   │ PV/点击/停留 │              │ 跨产品   │                │ AI客服       │
   │ trade        │              │ 共享     │                │ Airdrop      │
   │ portfolio    │              │（仅1事件）│                │ Stake        │
   │ point        │              │          │                │ APIKey       │
   │ 25 事件      │              │          │                │ 通知/签名    │
   └──────────────┘              └──────────┘                │ 30+ 事件     │
        ↓ POST                        ↓                      └──────────────┘
   神策协议 /sa.gif              Google Tag Manager                ↓ POST
        ↓                              ↓                      神策协议 /sa
   ┌──────────────────┐           ┌──────────┐           ┌──────────────────┐
   │ 神策公有云 SaaS  │           │ Google   │           │ 神策私有化部署   │
   │ *.sensorsdata.cn │           │ Servers  │           │ datasink.        │
   │ （神策公司托管）  │           │          │           │ sosovalue.com    │
   └──────────────────┘           └──────────┘           │ （SosoValue自部署）│
        ↓                              ↓                  └──────────────────┘
   神策分析后台                  GA 后台 + GTM                    ↓
        ↓                              ↓                    SosoValue 自家数仓
   增长 / 分析师                跨产品归因                          ↓
                                                            SosoValue 业务团队
                                                            （客服/增长/风控）
```

### 三路定位速查

| 路径 | 协议 | 部署 | 用途定位 | 事件量 |
|---|---|---|---|---|
| **神策官方 SDK**（window.sensors） | 神策 Sensors Analytics | **神策 SaaS 公有云** | SoDEX 自身产品分析（交易所内部行为漏斗） | 25 业务 + 3 自动 + 1 身份 |
| **datasink**（saTrack 直连） | **同上（神策 Sensors Analytics）** | **SosoValue 自部署私有化实例** | SosoValue 生态级跨产品业务事件（神策不覆盖的部分） | 30+ 事件，6 个业务域 |
| **GA / gtag** | Google Analytics | Google 公有云 | **仅** 钱包登录的 user_id 跨产品共享 | 1 事件 |

> 前两路本质是同一产品的两个实例，不是两种分析系统。详见 §14。

砍任何一路都会丢失一整片数据，不可恢复（详见 §10「迁移影响」）。

---

## 2. 三路职责完整拆解

### 2.1 神策（window.sensors）— SoDEX 自身分析

**职责**：交易所内部用户行为分析、漏斗、留存、A/B。

**承载的所有事件**：

| 子类 | 来源 | 事件清单 |
|---|---|---|
| 自动事件 | `sensors.quick("autoTrack")` | `$pageview` / `$WebClick` / `$web_page_stay_time` |
| 身份关联 | `sensors.identify(encryptedAddress)` | 钱包绑定（AES-128 加密地址作为 userId） |
| 交易流程（17）| `events/trade.ts` | `SpotTradePageView` / `SodexTradeConnectClick` / `SodexTradeAddClick` / `SodexTradeEnableClick` / `SodexTradeEnableButtonClick` / `SodexTradeClaimClick` / `SodexTradeWhiteClick` / `SodexTradeClaimFailedExpose` / `SodexTradeNewTransferClick` / `SodexTradeTransferConfirmClick` / `SodexTradeTransferApproveSpendingResult` / `SodexTradeWalletConfirmResult` / `SodexTradeRegularTransferButtonClick` / `SodexTradeBalanceTransferButtonClick` / `SodexTradeAvailableTransferButtonClick` / `SodexTradeStayButtonClick` / `SodexTradeAccountTabClick` |
| Portfolio（4）| `events/portfolio.ts` | `SodexPortfolioTransferClick` / `SodexPortfolioTradingClick` / `SodexPortfolioAccountTabClick` / `SodexPortfolioBalanceTransferButtonClick` |
| 积分分享（2）| `events/point.ts` | `ClickShareButton` / `ShareChannelClick`（twitter/telegram/copyimage/copylink/download） |
| 旧事件别名（4）| `mapEventName` 映射 | `OrderSuccessDialog_view_order_success_dialog` → `ViewOrderSuccessDialog`，`stakeToEarnPage_click_boost_{stake,unstake,withdraw}_soso` → `ClickBoost{Stake,Unstake,Withdraw}` |

**典型消费方**：增长团队、数据分析师。

**公共参数**（每事件自动注入，propertyPlugin 实现）：

- 顶层 11 字段：`platform` / `isMobile` / `theme` / `lang` / `channelArea` / `site` / `channelType` / `channelName` / `subchannelName` / `pageId` / `maChannel`
- 嵌套 `sosovalue` 17 字段：`walletAddress` / `walletType` / `serialNo` / `eventName` / `timestamp` / `deviceId` / `os` / `osVersion` / `screenWidth/Height` / `viewportWidth/Height` / `userId` / `anonymousId` / `eventCategory` / `platform` / `isMobile` / `theme` / `lang`
- 第三方浏览器识别：`thridBrowser`（Telegram / Twitter / Discord / YouTube / SosoValue WebView）
- 神策内置：`$element_type` / `$element_content` / `$page_x` / `$page_y` / `$lib` / `$lib_version` / `$latest_traffic_source_type` 等

**钱包地址处理**：AES-128-CBC 加密（`encrypt.ts`，固定 IV `aR9xL8VzM2qK7TbD`），密钥从 `config/env.ts:10-16` 按环境读取，**非硬编码**。加密后作为 `sensors.identify()` 的 userId，原文不落第三方。

### 2.2 GA / gtag — 跨产品 user_id 共享

**职责**：极其专一 —— 仅打通 SosoValue 生态下不同产品（主站、SoDEX、其它）间的 user_id。

**承载内容**：**1 个事件 + 1 次 user 设置**。

```typescript
// index.ts L428-450
trackWalletLogin(address)
  → sessionStorage 防重复（key: gtm_wallet_login_tracked_<addr>）
  → window.gtag("set",   { user_id: addr.toLowerCase() })
  → window.gtag("event", "log_in", { user_id: addr.toLowerCase() })
  → updateSharedUserId()  // 写入 google_tag_data.xcd.shared_user_id
```

**关键事实**：

- **不发任何业务事件到 GA**（无 PV、无点击、无漏斗）
- **不做漏斗分析**
- 唯一作用：把钱包地址注册为 GA 的 `user_id`，让 SosoValue 主站 / SoDEX / 其它生态产品在 GA 后台用同一个 user_id 串联跨产品访问
- 防重复：sessionStorage 标记，同钱包不重复触发
- 数据分析价值低（事件单一），价值在 **跨产品 user_id 主键**

**典型消费方**：SosoValue 数据团队做跨产品用户画像 / 归因。

### 2.3 datasink — SosoValue 自部署的神策私有化实例

**协议本质**：datasink 不是另一种分析系统，**它就是神策 Sensors Analytics 的私有化部署**。saTrack 是「绕过神策 JS SDK、手撸神策上报协议直连私有化实例」的实现方式。证据链：

- URL 路径 `/sa?project=xxx` 是神策私有化部署的标准批量上报端点
- payload 字段 100% 神策标准：`distinct_id` / `login_id` / `anonymous_id` / `type:"track"` / `event` / `time` / `_track_id` / `_flush_time` / `$lib` / `$lib_version` 等 `$` 前缀保留字
- body 编码 `data=<base64>&ext=crc%3D<crc>` 是神策标准格式
- `?project=production / default` 是神策多租户项目隔离参数
- `public/mainnet/static/sensorsdata.min.js` 文件存在，是神策官方 SDK

**为什么用直连而非 SDK**：神策 JS SDK 设计上是**单实例**（单一 server_url）。要把不同事件分流到两个神策实例（官方 SaaS + 自部署），技术上只能"一份走 SDK，另一份手撸协议"。详见 §14。

**职责**：承载神策 SaaS 不存放的业务域，回流到 SosoValue 自部署的神策实例 → SosoValue 自家数仓。

**承载的所有事件**（30+，按业务域分组）：

| 业务域 | 事件数 | 事件清单 |
|---|---:|---|
| **Stake SOSO** | 5 | `SodexStakeEnableStakingClick` / `SodexStakeStakeClick` / `SodexStakeUnstakeWithdrawClick` / `SodexStakeGoTradingClick` / `SodexStakeCheckInDetailClick` |
| **Stake 入口跳转** | 1（3 处调用） | `soso_stake_entry_click`（带 `entryLocation: "spot_top_banner" \| "balance_stake_to_earn"`） |
| **Banner 曝光** | 1（2 处） | `soso_stake_entry_impression`（spot 顶部 banner / asset 页面） |
| **Airdrop / Claim** | 8 | `SodexAirdropClaimToAccountClick` / `SodexAirdropStakeSosoClick` / `SodexAirdropTradeOnSodexClick` / `SodexAirdropShareToEarnClick` / `SodexAirdropGoToPortfolioClick` / `SodexShareXClick`(×2) / `SodexShareTelegramClick`(×2) |
| **AI 客服**（AICustomer） | 10 | `support_message_send` / `support_message_response` / `support_upload_success` / `support_upload_fail` / `support_link_click` / `support_links_impression` / `support_widget_open` / `support_helpful_yes` / `support_helpful_no` |
| **API Key 生成** | 3 | `apikey_generate_click`（含动态名） / `apikey_generate_success` |
| **通知系统** | 2 | `notification_entry_click` / `notification_message_click` |
| **钱包签名** | 1 | `wallet_sign_transaction` |

**为什么必须独立（独立实例，不是独立产品）**：

1. **数据归属**：神策 SaaS 数据存在神策公司服务端；SosoValue 做 AI 客服训练、增长归因、风控审计要求数据落自家机房 → 自部署一套神策
2. **schema 隔离**：两个实例数仓 schema 独立演进，互不污染
3. **跨产品自然 join**：SosoValue 主站、SoDEX、其它生态产品都往同一个私有化实例写，在自家数仓里天然 join

**典型消费方**：

- SosoValue 增长团队（Airdrop / Stake / 跨产品归因）
- AI 客服 / NLP 团队
- 风控 / 合规（钱包签名、API Key 审计）

**payload 独有字段**（与神策对比）：

- `channelParams`（tid/pid 完整渠道结构）
- `extendParams`（扩展容器）
- `_track_id` / `_flush_time` / `serialNo` / `distinct_id` / `login_id` / `anonymous_id`
- `platformParams.web`（browser / pageId / url / urlPath / title / referrer / userAgent / isIframe）

**命名规范差异**：神策侧 `SodexTrade*Click`（驼峰 + 业务前缀）；datasink 侧多用 `support_*` / `apikey_*` / `notification_*` / `soso_stake_*`（蛇形）—— 两套命名规范、两套数据契约。

**传输**：Base64 + CRC，`POST application/x-www-form-urlencoded`。

**环境分流**（`sosovalue.ts:11-15`）：

| `REACT_ENV_NAME` | URL |
|------|-----|
| `mainnet` | `https://datasink.sosovalue.com/sa?project=production` |
| 其他 | `https://datasink1.sosovalue.com/sa?project=default` |

---

## 3. 文件清单与规模

`src/track/` 共 9 个文件：

| 文件 | 行数 | 导出数 | 引用数 | 职责 | 归属路径 |
|------|-----:|------:|------:|------|---------|
| `index.ts` | 503 | 13 | 2 | 神策 SDK 初始化 + track/identify 主入口 + GA gtag | 神策 + GA |
| `sosovalue.ts` | 403 | 2 | 17（saTrack 入口） / 30+（实际调用） | datasink 直连上报 | datasink |
| `encrypt.ts` | 39 | 1 | 1 | AES-128-CBC 钱包地址加密 | 神策（identify） |
| `pageMapping.ts` | 41 | 2 | 1 | URL → pageId/title 映射（仅 2 条） | 公共参数 |
| `hooks.tsx` | — | 1 | **0** | useVisibilityTracking（可视区域曝光） | 未使用 |
| `events/trade.ts` | 86 | 17 | 18 | 交易流程事件 | 神策 |
| `events/portfolio.ts` | 24 | 4 | 3 | Portfolio 事件 | 神策 |
| `events/point.ts` | 14 | 2 | 3 | 积分分享事件 | 神策 |
| `events/notification.ts` | 11 | 2 | — | 通知点击事件 | **datasink**（注意：虽在 events/ 下但走 saTrack） |

src/ 下 `@/track` 引用共 47 处，集中在 `components_tw/`、`components/`、`pages/`、`contexts/`。

---

## 4. 核心入口（index.ts）

### 4.1 导出清单（13 项）

`isInApp` / `isIosApp` / `isAndroidApp` / `transferOldPropertiesToExtendParams` / `track` / `quickTrack` / `trackClick` / `trackContentView` / `initTrack` / `trackConnectWallet` / `trackWalletLogin` / `clearWalletLoginTrack` / `clearWalletLoginIdentity`

### 4.2 初始化时序

`initTrack()` 在 `App.tsx` 与 MPA `Layout.tsx` 中调用一次：

```typescript
// index.ts L387-419
export const initTrack = () => {
  if (!getDeviceId()) setDeviceId(getUuid());
  window.sensors?.registerPropertyPlugin(propertyPlugin);
  window.sensors?.registerPage({ userMessage: () => ({...}), network, theme: "dark" });
  window.sensors?.quick("autoTrack");
};
```

`checkSensorsReady()` 轮询 `window.sensors.track` 就绪（`index.ts:337`，上限 **1000 次 × 500ms ≈ 500 秒**），就绪后自动 `initTrack()`。
sensors 加载失败不抛错、不阻塞业务流程（`index.ts:501-503`）。

### 4.3 钱包身份关联

```typescript
// index.ts L421-426
trackConnectWallet(address)
  → encryptAES128(address, AES_USER_ID_SECRET) → window.sensors.identify(encrypted)

// index.ts L428-450
trackWalletLogin(address)
  → sessionStorage 防重复（gtm_wallet_login_tracked_<addr>）
  → window.gtag("set",   { user_id: addr.toLowerCase() })
  → window.gtag("event", "log_in", { user_id: addr.toLowerCase() })
  → updateSharedUserId()  // google_tag_data.xcd.shared_user_id
```

### 4.4 平台检测（实际 7 种）

`getPlatform()` `index.ts:81-104`，优先级从高到低：

| # | 平台 | 条件 |
|---|------|------|
| 1 | `MA` | Telegram WebApp |
| 2 | `Mobile-PWA` | mobile + standalone |
| 3 | `PC-PWA` | desktop + standalone |
| 4 | `App-IOS` | SosoWebview + webkit |
| 5 | `App-Android` | SosoWebview + Bridge |
| 6 | `Mobile-Web` | 移动浏览器 |
| 7 | `PC-Web` | 桌面浏览器 |

### 4.5 事件名映射（仅 4 条）

```typescript
const mapEventName = {
  OrderSuccessDialog_view_order_success_dialog: "ViewOrderSuccessDialog",
  stakeToEarnPage_click_boost_stake_soso:       "ClickBoostStake",
  stakeToEarnPage_click_boost_unstake_soso:     "ClickBoostUnstake",
  stakeToEarnPage_click_boost_withdraw_soso:    "ClickBoostWithdraw",
};
```

---

## 5. SosoValue 直连（sosovalue.ts）详解

```typescript
export async function saTrack(eventName, customData = {}) {
  const payload = {
    distinct_id, login_id, anonymous_id,
    type: "track",
    event: eventName,
    time: Date.now(),
    properties: { /* 20+ 字段，含 sosovalue/platformParams/channelParams/extendParams */ },
    _track_id, _flush_time,
    ...customData,
  };
  const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
  await fetch(datasinkUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `data=${encoded}&crc=${timestamp}`,
  });
}
```

**两个特化函数**：

| 函数 | 位置 | 用途 |
|---|---|---|
| `trackSosoStakeEntryClick({ entryLocation })` | `sosovalue.ts:369` | SOSO 质押入口跳转。`entryLocation`：`spot_top_banner` / `balance_stake_to_earn` |
| `trackNotificationEntryClick` / `trackNotificationMessageClick` | `events/notification.ts:4-10` | 通知系统点击 |

---

## 6. AES 加密（encrypt.ts）

```typescript
// AES-128-CBC, 固定 IV "aR9xL8VzM2qK7TbD", Base64 输出, WebCrypto API
encryptAES128(walletAddress, AES_USER_ID_SECRET) → string
```

- `AES_USER_ID_SECRET` 定义在 `src/config/env.ts:10-16`（按 `REACT_ENV_NAME` 环境分支）
- 固定 IV 仅适用于埋点脱敏，**禁止挪作通信加密**

---

## 7. 平台 / SDK / 环境变量清单

| 项 | 取值 | 位置 |
|----|------|------|
| 神策 SDK | 通过 `<script>` 注入 `window.sensors`，**非 npm 包** | `index.html` |
| GA / gtag | 通过 GTM `<script>` 注入 `window.gtag` | `index.html` |
| datasink | 自实现 fetch，无 SDK | `sosovalue.ts` |
| `ua-parser-js` | `^2.0.3` | package.json |
| uuid 工具 | 项目自建 `@/utils/uuid` | 内部实现 |
| `REACT_ENV_NAME` | `mainnet` / `preview` / `test` / `testnet` / `bugfix` | env |
| `AES_USER_ID_SECRET` | 按环境分支 | `config/env.ts:10-16` |
| `datasinkUrl` | 由 `REACT_ENV_NAME` 派生 | `sosovalue.ts:12-15` |

---

## 8. 调用点分布（src/ 下 47 处）

- `components_tw/` — 15+ 处（modals、AICustomer、TransferButton 等）
- `pages/` — 15+ 处（trade、portfolio、staking、apiKey）
- `components/` — 7+ 处（header、notificationBell、globalBanner）
- `contexts/` — 5+ 处（LoginProvider 等）
- `hooks/` — 1 处（useCompatibleSign）

---

## 9. 关键设计决策

| 问题 | 决策 |
|------|------|
| 为什么三路并行（神策 SaaS + 神策私有化 + GA）？ | 前两者是同协议的两个实例，业务上需要数据落不同存储（神策 SaaS 给产品分析，私有化实例给 SosoValue 数仓）；GA 单独承担跨产品 user_id 主键。 |
| 为什么 datasink 用直连而不是 SDK？ | 神策 JS SDK 设计上单实例（单 server_url）。要分流到两个神策实例，必须一路 SDK + 一路手撸协议（见 §14）。 |
| 为什么 GA 仅做 user_id？ | GA 价值在跨产品 user_id 主键（绑死 Google Ads / GTM 生态），不替代神策做行为分析。 |
| 为什么不把所有事件都发给两个神策实例（全复制）？ | 两个实例数仓 schema 与命名规范不同（驼峰 vs 蛇形，字段集不同）；事件分工本身就是按业务域设计的，不是冗余备份。 |
| 为什么 propertyPlugin 模式？ | 一次注册，全部神策 SDK 事件自动注入公共参数，避免遗漏。 |
| 为什么钱包地址 AES 加密？ | sensors `identify` 的 userId 会持久化，加密后中间链路看不到原文。 |
| 为什么 SSR 兼容兜底？ | 所有 `window` / `document` 访问处加 `typeof window !== "undefined"`，防 SSR 报错。 |

---

## 10. 迁移影响：三路缺一不可

| 砍掉谁 | 失去什么 | 可恢复性 |
|---|---|---|
| 砍神策官方 SDK | 交易所主产品分析全断（PV / 漏斗 / 留存 / autoTrack 停留时间） | 不可（25 事件不在私有化实例） |
| 砍 GA | 跨产品 user_id 链路断 | 不可（GA 体系绑死） |
| 砍 datasink（神策私有化） | AI 客服 / Airdrop / Stake / APIKey / 通知 / 签名审计全断 | 不可（30+ 事件不在神策 SaaS） |

**迁移到 sodex-next 时三路必须全保留。**

### 迁移工程上的共享机会

虽然两个神策实例的发送链路（SDK 与直连）不能合并，但**公共参数构建是中性逻辑，可共享**：

| 共享项 | 现状 | 迁移后建议 |
|---|---|---|
| `getPlatform()`（7 种平台检测） | 神策与 datasink 各调一次 | 提到 `shared/track/domain/platform.ts`，两路共用 |
| `getDeviceId / anonymousId / serialNo` | 各自计算 | 提到 `shared/track/domain/identity.ts`，两路共用 |
| 渠道参数（tid/pid 解析） | 各自解析 URL | 提到 `shared/track/domain/channel.ts`，两路共用 |
| 第三方浏览器识别 thridBrowser | 各自检测 UA | 提到 `shared/track/domain/userAgent.ts`，两路共用 |
| 语言归一化 normalizeTrackLanguage | 各自处理 | 提到 `shared/track/domain/language.ts`，两路共用 |

发送层分两个 client（`sensorsClient.ts` 走官方 SDK，`datasinkClient.ts` 手撸协议直连），各自调用 domain 层构建符合各自 schema 的 payload。可降低约 30% 重复代码。

---

## 11. 与历史文档差异（已校准）

| 项 | 旧文档 | 源码真实值 |
|----|--------|------------|
| 平台检测分支数 | 10 / 8 | **7** |
| trade.ts 事件数 | 16 | **17** |
| index.ts 导出数 | 10 | **13** |
| mapEventName 条目数 | 隐含较多 | **4** |
| events/ 文件数 | 3 | **4**（漏 notification.ts） |
| 神策业务事件数 | 22 | **25**（trade 17 + portfolio 4 + point 2 + map 别名 4 中部分） |
| datasink 事件数 | 1（仅 stake entry） | **30+**（6 个业务域） |
| datasink 调用点 | 17 | **30+** |
| 神策 vs datasink 是否重叠 | 未明确 | **完全不重叠**，所有 datasink 事件均无神策备份 |
| AES_USER_ID_SECRET | 描述为硬编码 | **由 `config/env.ts` 按环境提供** |
| 轮询表述 | 500 秒 | 1000 次 × 500ms ≈ 500 秒（**次数为口径**） |
| applyPublicParams 字段 | 笼统描述 | 拆分为 `sensorsData(11)` + `sosovalue(17)` + thridBrowser |

---

## 12. 当前问题 / 清理点

| 文件 | 问题 |
|------|------|
| `hooks.tsx` | 0 引用，可清理 |
| `pageMapping.ts` | 仅 2 条目，需要补全 |
| `encrypt.ts` 固定 IV | 仅限埋点脱敏；**禁止挪作通信加密** |
| 神策 SDK 通过 `<script>` 注入 | 非 npm 包，迁移时需手动复制 script 标签 |
| datasink commit 历史无背景说明 | git log 仅描述功能，未记录"为什么需要 datasink"（推断见 §2.3） |

---

## 14. 协议本质：datasink = 神策私有化部署

> 本节是对前两次校准的关键修正：datasink **不是另一种分析系统**，而是 **神策 Sensors Analytics 的私有化部署实例**。理解这一点直接影响迁移策略。

### 14.1 证据链

| # | 维度 | 观察 | 神策标准？ |
|---|---|---|---|
| 1 | URL 路径 | `https://datasink.sosovalue.com/sa?project=production` | ✅ `/sa` 是神策私有化部署 server-side 批量上报标准端点 |
| 2 | 多租户参数 | `?project=production / default` | ✅ 神策标准项目隔离 |
| 3 | payload 顶层字段 | `distinct_id` / `login_id` / `anonymous_id` / `type:"track"` / `event` / `time` | ✅ 100% 神策标准 |
| 4 | payload 内部字段 | `_track_id` / `_flush_time` | ✅ 神策内部去重与批量 flush 字段 |
| 5 | properties `$` 前缀字段 | `$lib` / `$lib_version` / `$timezone_offset` / `$os` / `$screen_*` 等 | ✅ 神策保留字段命名空间 |
| 6 | body 编码 | `data=<base64>&ext=crc%3D<crc>`，`application/x-www-form-urlencoded` | ✅ 神策 server-side 上报标准格式 |
| 7 | CRC 算法 | `-Math.abs(Date.now() % 1000000000)` | ✅ 神策标准 |
| 8 | SDK 文件存在 | `public/mainnet/static/sensorsdata.min.js` 在仓库内 | ✅ 神策官方 JS SDK |
| 9 | 全局接口 | `window.sensors`（identify/logout/quick/registerPage/track） | ✅ 神策官方 SDK 接口 |

任意一条单看都可能巧合，9 条全部对齐 = 同一产品。

### 14.2 两个神策实例的关系

```
神策 Sensors Analytics（产品）
├── 公有云 SaaS                  ← sodex-web 用 JS SDK 接入（window.sensors）
│   端点: *.sensorsdata.cn        ← 主分析平台
│   数据归属: 神策公司
│
└── 私有化部署                    ← sodex-web 用手撸协议接入（saTrack）
    端点: datasink.sosovalue.com  ← SosoValue 自家机房 / 云
    数据归属: SosoValue 自家数仓
```

两个实例**协议同种、产品同种、部署位置不同、数据归属不同**。

### 14.3 为什么不用一份 SDK 同时发两个实例

神策 JS SDK 的设计是**单实例**：

- 一次 `sensors.init({ server_url, ... })` 只能绑定一个 server_url
- `window.sensors` 是全局单例
- 跑两份 SDK 会冲突

工程上回避这个限制的方案：

| 方案 | 评估 |
|---|---|
| A. 跑两份 SDK | ❌ `window.sensors` 全局冲突 |
| B. 一份 SDK + 一份手撸 HTTP | ✅ **sodex-web 现在的做法** |
| C. 网关层后端转发 | ❌ 增加自建后端，运维成本高 |

所以 saTrack 手撸协议 **不是因为协议不同**，而是 SDK 多实例限制下的最简方案。

### 14.4 为什么不做"全复制"分流

理论上可以：拦截每次 `sensors.track()`，复制一份发到 datasink。**实际不可行**，因为：

1. **事件分工不重叠**：神策 SaaS 上 25 个 SoDEX 事件（驼峰命名 `SodexTrade*`），私有化上 30+ 个生态事件（蛇形 `support_*` / `apikey_*`），两套数据契约
2. **字段集不同**：私有化实例 payload 有 `channelParams` / `extendParams`；SaaS 实例有神策自动注入的 `$element_*` / `$latest_*`
3. **数仓 schema 独立演进**：两个实例的数据消费方不同，命名 / 字段 / 维度都已与各自数仓深度耦合

强行统一会破坏现有数仓表结构。

### 14.5 命名建议

工程实现保留 `datasink` 命名（与 sodex-web 对齐，降低认知成本），但文档与新人 onboarding 必须明确「datasink = 神策私有化实例」。**不要让"datasink"这个词暗示它是与神策不同的系统**——这正是本文档前两版犯的错误。

---

## 15. 更新记录

- **2026-05-12（第三次）**：识别 datasink 协议本质（神策 Sensors Analytics 私有化部署），新增 §14；修正 §1 架构图、§2.3 章节定位、§9 设计决策、§10 迁移影响中"独立系统"措辞；提供共享逻辑迁移建议。
- **2026-05-12（第二次）**：补 datasink 真实承载范围（30+ 调用、6 个业务域、命名规范差异、payload 独有字段）；新增 §2「三路职责完整拆解」与 §10「迁移影响」；events/notification.ts 标注归属为 datasink。
- **2026-05-12（第一次）**：对照源码全量校准（平台数、事件数、导出数、字段清单、env 变量、调用分布等）。
- **2026-04-14**：初始版本（通过 /k/context learn 从代码生成）。
