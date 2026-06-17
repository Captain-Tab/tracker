# 埋点系统（神策 SDK + saTrack 直连 + GA gtag）

## 架构概览

三条上报通道写入两个数据归属，**业务事件单一通道（saTrack 直连）**避免数据契约分裂。

```
用户操作
│
├── 神策 SDK autoTrack         →  POST datasink.sosovalue.com/sa
│   ($pageview 由 is_track_single_page 自动产生；heatmap 已关闭，不再上报 $WebClick / $WebStay)
│   (sensors.identify 钱包绑定后续 autoTrack 事件带 userId)
│
├── 业务事件 saTrack 直连      →  POST datasink.sosovalue.com/sa  ← 同一神策实例
│   (saTrackService.track，Batch B 起接入)
│
└── GA gtag                     →  Google
    (仅 user_id 跨产品共享，无业务事件)
```

**关键事实**：神策 SDK 与 saTrack 直连写入**同一个神策私有化实例**（`datasink.sosovalue.com`），是「两种发送方式」不是「两套系统」。

### 老项目对齐

| 维度 | sodex-web 历史（已删） | sodex-next 当前 |
|------|------|------|
| 神策 SDK init | 曾启用 2025-06~10 后删除 | ✅ 重新启用 |
| heatmap.clickmap | `注释`（关） | ✅ `"not_collect"`（关，2026-05-13 关闭） |
| heatmap.scroll_notice_map | `"not_collect"`（关） | ✅ `"not_collect"`（关） |
| is_track_single_page | `true` | ✅ `true` |
| send_type | `beacon` | ✅ `beacon` |
| server_url | `datasink.sosovalue.com/sa?project=...` | ✅ **全环境统一** `https://datasink.sosovalue.com/sa?project=production`（2026-05-13） |
| AES 密钥 / IV | 同 5 环境分支 | ✅ 完全对齐（2 个去重值） |
| localStorage `__device_id__` | createStorage 包装 `{type,value}` | ✅ 同包装格式（跨版本继承） |
| 业务事件通道 | 神策 SDK + saTrack 双写 | ✅ 仅 saTrack 单通道（架构简化） |

## 核心逻辑

### useTrackInit（App 顶层一次性挂载）

```typescript
// src/shared/track/containers/useTrackInit.ts
export function useTrackInit(): void {
  const initializedRef = useRef(false);
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    getDeviceId();             // 兜底 deviceId 持久化
    getAnonymousId();          // 兜底 anonymousId 持久化
    void initSensors();        // SDK ready 后注册 propertyPlugin + autoTrack
    initGtag();                // gtag 占位（实际由 index.html 内联 init）
  }, []);
}
```

`useRef` 防 StrictMode 双跑。`getDeviceId()` 内部读 `localStorage.__device_id__`（createStorage 包装格式），首次访问写入。

### sensorsSink propertyPlugin（autoTrack 公共参数注入）

神策 SDK 每次自动事件（PV / Click / Stay）经过 `propertyPlugin.properties()` 回调，注入：
- 顶层 11 字段 `sensorsData`（platform / isMobile / theme / lang / channelArea / site / channelType / channelName / subchannelName / pageId / maChannel）
- 嵌套 `sosovalue` JSON 17 字段（walletAddress / walletType / serialNo / deviceId / os / screenWidth/Height / viewportWidth/Height / userId / anonymousId / eventCategory / platform / isMobile / theme / lang / eventName / timestamp）
- `channelParams` / `platformParams.web` JSON

字段构造逻辑由 `domain/publicParams.ts buildSosovalueParams` 统一，**与 saTrack 直连共用同一份函数**，避免 autoTrack 与业务事件公共参数分裂。

### identityService（钱包身份关联）

```typescript
// src/shared/track/services/identityService.ts
trackConnectWallet(address, walletType?):
  setWalletAddress(address)              // 写 localStorage __wallet_address__
  setWalletType(walletType)              // 写 localStorage __wallet_type__
  encrypted = AES-128-CBC(address)
  setUserId(encrypted)                   // 写 localStorage user_id（与下面 sensors.identify 同值）
  sensors.identify(encrypted)            // 神策 SDK 内部 distinct_id

trackWalletLogin(address):
  gtag('set', { user_id }) + gtag('event', 'log_in') + 跨产品 user_id 共享

clearWalletLoginIdentity():
  clearUserId()                          // GA gtag('set', { user_id: undefined })
  clearWalletIdentityStorage()           // 清 __wallet_address__ / __wallet_type__ / user_id
  sensors.logout()                       // 神策 SDK 内部 distinct_id 回归 anonymous

clearWalletLoginIdentityIfDirty():       // 刷新兜底：storage 有残留才清，无残留零开销
  if (hasWalletIdentityStorage()) → 同上三件套
```

- **AES 加密**：固定 IV `aR9xL8VzM2qK7TbD`，密钥从 `VITE_AES_USER_ID_SECRET` 取。**定位 obfuscation（脱敏），不是 encryption**——密钥进 bundle 公开，禁止挪用作通信加密
- **trackWalletLogin 不依赖 JWT**：钱包地址可用即触发，与 `useTrackConnectWallet` 同时机。GA log_in 只需 user_id，JWT 是业务签名能力的鉴权门槛，不是埋点上报前置
- **GA log_in 防重**：`gtagSink.emitLoginIfNotTracked` 内部 sessionStorage key `gtm_wallet_login_tracked_<addr>`，同钱包不重复
- **autoTrack 与 saTrack distinct_id 统一**：`setUserId(encrypted)` 写 localStorage `user_id`，让 datasinkSink 的 `distinct_id = userId || anonymousId` 取到与 `sensors.identify` 一致的 encrypted 值。两路（神策 SDK / saTrack 直连）在神策后台看到同一个 distinct_id。登出时 `sensors.logout()` + localStorage 清，两路同步回归 anonymous

### auth feature 内 2 个 hook 注册到 useAuthAppRoot

```typescript
// src/features/auth/containers/useAuthAppRoot.ts
useTrackConnectWallet();  // 监听 session.address 变化 → identityService.trackConnectWallet
useTrackWalletLogin();    // 监听 address 可用 → identityService.trackWalletLogin
```

两个 hook 都守门 `isWatching` 跳过（watch 模式 address 是被观察用户，不属本机身份）。`useTrackConnectWallet` 用 `lastIdentifiedRef` 防重（同 address 单次会话内不重复 identify）；address 从有值变 null 或刷新后首次进入未连接态时，调 `identityService.clearWalletLoginIdentityIfDirty()` —— 不依赖 useRef in-memory state（刷新即丢），改为读 localStorage 判 dirty 兜底。

### publicParams.ts 安全 localStorage 包装

`safeGetItem` / `safeSetItem` / `safeRemoveItem` + 模块级 `inMemoryStore: Record<string, string>` fallback。Safari 隐私模式 / 配额耗尽（QuotaExceededError）/ iframe sandbox 等 storage 抛错场景下，埋点降级到进程内 Map，避免 `useTrackInit` cold-start 崩 App。Read-after-write 一致：safeSetItem 先写内存再写 localStorage，storage 抛错时内存仍有值。`hasWalletIdentityStorage()` 读三个 key 任一非空判 dirty，供 `clearWalletLoginIdentityIfDirty` 使用。

### saTrackService（业务事件唯一入口）

```typescript
saTrackService.track(eventName, payload?)  // 走 datasinkSink → POST datasink endpoint
```

Public API 不暴露 `sensors.track()` 给业务（防止业务无意中产生两套数据契约）。Batch B 起接入 sodex-web 历史 55+ 业务事件，全部经此入口。

### 神策 SDK 加载与就绪轮询

`index.html` 内联 init IIFE 占壳 → `<script src="/static/sensorsdata.min.js" integrity="sha384-..." crossorigin>` 加载实际 SDK。`sensorsSink.whenReady()` 轮询 `window.sensors.track` 是否就绪，上限 1000 次 × 500ms（≈500 秒），超时静默 reject 不抛错。SDK 加载失败（CSP / SRI 校验失败 / 广告拦截）→ 业务正常，autoTrack 全部丢失，saTrack 与 GA 仍工作。

## 关键实现

### SRI 文件完整性校验

```html
<script
  src="/static/sensorsdata.min.js"
  integrity="sha384-Q+V71KDG/EHebV+NsvzmQiJLGc0ohM28rfFeUpzyArd1PiDTRaKwhlgh0N5XFVIP"
  crossorigin="anonymous"
></script>
```

SDK 文件被替换 → 浏览器拒绝执行 → autoTrack 失效但业务不崩。MD5: `521b85ebf68802c36b41cc24588d48b4`。SDK 升级时需重新生成 hash 走独立 PR。

### heatmap 关闭与 URL 脱敏

2026-05-13 起 heatmap 全部关闭，仅保留 `$pageview` autoTrack 事件 + URL token 脱敏：

```js
heatmap: {
  clickmap: 'not_collect',
  scroll_notice_map: 'not_collect',
},
not_collect_url_params: ['token','api_key','apikey','signature','sig','access_token','jwt'],
```

`collect_element` 过滤函数随 heatmap 关闭一并移除（无消费方）。后续如需重新启用 heatmap，须同步恢复敏感元素过滤函数（参考 git 历史）。

### Vite HTML 占位替换 + GA user_id bootstrap

`vite.config.ts` 两个插件：
- `htmlEnvReplacePlugin`：构建期把 `%VITE_TRACK_URL%` 替换为对应 env 值（dev → datasink1 default / prod → datasink production）
- `gtagUserIdPlugin`：搬自 sodex-web，在 `gtag('js', new Date())` 后注入 user_id bootstrap，从 localStorage `__wallet_address__` 读出地址 → `gtag('set', { user_id })`，让首屏 PV 也带身份

### CLAUDE.md 分层合规

| 副作用类型 | 落点 |
|---|---|
| 网络请求（fetch / sensors.track / gtag）| `infra/*Sink.ts` |
| storage 读写（sessionStorage / localStorage）| `infra/*Sink.ts` 与 `domain/publicParams.ts` |
| AES 加密 | `infra/encrypt.ts` |
| 调度 / 编排 | services 层（不直接读写 storage / 不直接发 HTTP） |
| React effect | `containers/` + `features/auth/containers/` |

`services/saTrackService.ts` 顶部注释明确 telemetry 边界：埋点 service 是 telemetry 实现层，不在「Service 禁 telemetry」禁令范围。

## 关键设计决策

- **D-1 三路并行**：神策 SDK（autoTrack + identify）+ saTrack 直连（业务事件）+ GA gtag（user_id 共享）。前两路写同一神策私有化实例，是「两种发送方式」非「两套系统」
- **D-2 业务事件单通道**：所有业务事件走 `saTrackService.track`，不走神策 SDK。**不存在 `trackService.ts`**。理由：单数据契约 + 命名 / payload 不分裂
- **D-3 heatmap 关闭**（2026-05-13 反转）：原方案 heatmap 全开（PV + WebClick + WebStay），实测后业务侧决定关闭，避免大量 $WebClick / $WebStay 流量。当前仅 `$pageview` 自动上报，业务事件全部由 saTrack 显式触发。`collect_element` 过滤函数随之删除
- **D-4 trackWalletLogin 不依赖 JWT**：钱包地址可用即触发，与 trackConnectWallet 同时机。JWT 是业务鉴权门槛，不是埋点前置
- **D-5 deviceId localStorage 同 sodex-web key**：`__device_id__` 用 createStorage 包装格式 `{type:"string", value:"<uuid>"}`，同域跨版本继承，神策侧老用户数据曲线无断点
- **D-6 AES 密钥定位 obfuscation**：固定 IV + 密钥进 bundle，**禁止挪用作通信加密**。Batch C1 评估升级到 HMAC-SHA256（需配套用户身份迁移方案）
- **D-7 watch 模式跳过**：两个 identity hook 守门 `isWatching` return，watched address 不属本机身份
- **D-8 Public API 收敛**：`shared/track/index.ts` 仅导出 `saTrackService` / `identityService` / `useTrackInit`，不导 `sensorsSink` / `datasinkSink` / `encrypt`
- **D-9 SDK 自托管**：复制 `public/static/sensorsdata.min.js` 到本仓库 + SRI 锁定；不依赖神策官方 CDN（`static.sensorsdata.cn`）
- **D-10 CSP 移除待独立任务**：原 CSP 漏配 Privy / WalletConnect / Reown / RPC 等多个第三方域名，导致邮箱登录禁用、wagmi session 无法推进。CSP 加固需先抓真实流量清单，改为独立任务
- **D-11 钱包身份双向链路完整性**：sodex-web LoginProvider 时代由业务侧写 `__wallet_address__` / `__wallet_type__` / `user_id` localStorage，埋点搭便车读。sodex-next auth feature 改为 zustand session 后业务侧不再写 localStorage，埋点链路断。本批由 `identityService.trackConnectWallet` 显式写入三个 localStorage key（覆盖 sodex-web 历史残留），登出时 `clearWalletLoginIdentity` 清三套 + 调 `sensors.logout()` 让神策 SDK 内部 distinct_id 同步回 anonymous。**autoTrack 与 saTrack 在登录态下使用同一 encrypted distinct_id；在匿名态下同步回退到 anonymous**
- **D-12 localStorage 全包装为 safe wrapper**：Safari 隐私模式 / 配额耗尽 / iframe sandbox 等场景 `localStorage.setItem` 会抛 `QuotaExceededError` / `SecurityError`，原裸调用导致 `useTrackInit` cold-start 崩整个 App。`publicParams.ts` 新增 `safeGetItem` / `safeSetItem` / `safeRemoveItem` + 模块级 `inMemoryStore` fallback，全部 storage 调用走包装。Read-after-write 在本会话内一致
- **D-13 刷新后残留兜底清理**：原 `useTrackConnectWallet` address null 分支依赖 in-memory `lastIdentifiedRef` 判断是否需要清 storage——刷新后 ref 丢失，残留 `__wallet_address__` / `user_id` 永久污染匿名事件。改为新增 `identityService.clearWalletLoginIdentityIfDirty()`：内部读 storage 判 dirty，有残留才清，clean 状态零开销

## 文件结构

```
src/shared/track/                                 ← 横切基础设施
├── domain/
│   ├── publicParams.ts                            身份持久化 + 平台/UA/语言/渠道/pageMapping + 公共参数构造
│   └── types.ts                                   TrackEventPayload / Platform / ThridBrowser
├── infra/
│   ├── encrypt.ts                                 AES-128-CBC + 强制风险注释（obfuscation）
│   ├── sensorsSink.ts                             window.sensors 封装：init / identify / isReady / whenReady（不暴露 track）
│   ├── datasinkSink.ts                            saTrack 直连 fetch POST + CRC
│   └── gtagSink.ts                                gtag 封装 + updateSharedUserId + sessionStorage 防重
├── services/
│   ├── saTrackService.ts                          业务事件唯一入口
│   └── identityService.ts                         trackConnectWallet / trackWalletLogin
├── containers/
│   └── useTrackInit.ts                            App 顶层挂一次
└── index.ts                                       Public API：saTrackService / identityService / useTrackInit

src/features/auth/containers/                     ← 身份关联挂载点
├── useTrackConnectWallet.ts                      监听 address → identityService.trackConnectWallet
├── useTrackWalletLogin.ts                        监听 address → identityService.trackWalletLogin
└── useAuthAppRoot.ts (修改)                       注册两个 identity hook

src/App.tsx (修改)                                 顶层挂 useTrackInit
src/index.html (修改)                              神策 init + SDK + GA
src/vite-env.d.ts (修改)                           VITE_AES_USER_ID_SECRET / VITE_TRACK_URL / window.sensors
vite.config.ts (修改)                              htmlEnvReplace + gtagUserIdPlugin
public/static/sensorsdata.min.js                   SDK 文件（SHA-384 锁定）
.env.{development,preview,production}              VITE_AES_USER_ID_SECRET + VITE_TRACK_URL
```

## 开发修改指南

### Batch B：新增业务事件（最常见，~80% 场景）

零上下文事件：

```typescript
// features/<name>/track/<name>Events.ts
import { saTrackService } from "@/shared/track";

export const trackSodexTradeConnectClick = () => {
  saTrackService.track("SodexTradeConnectClick");
};
```

带 container 上下文（需要 store/state）的事件：包装为 `use<Name>Track` hook，feature 内部 import store/container hook 注入 payload，业务 component 调 hook 返回的函数。

**命名规范**：保留 sodex-web 历史命名（驼峰 / 蛇形混用），不强行统一，避免破坏 SosoValue 数仓 schema。

### 修改 heatmap 范围

`index.html` 神策 init 配置（当前默认全关）：
- `clickmap`: `'default'` 全开 / `'not_collect'` 关闭 / `false` 关闭
- `scroll_notice_map`: 同上
- 如重新开启，必须同步恢复 `collect_element` 过滤回调（跳过 password / wallet input / `[data-track-skip]` 容器），并增加 SosoValue 数仓侧 $WebClick / $WebStay 看板对齐通知

### 修改 server_url / AES 密钥

只改 `.env.{development,preview,production}`：
- `VITE_TRACK_URL`：神策 SDK server_url + saTrack 直连共用。**2026-05-13 起全环境统一为 `https://datasink.sosovalue.com/sa?project=production`**，不再走 `datasink1` 测试池。dev / preview 流量会与生产用户事件混在同一 project，看板需用 channelArea / pageId / userAgent 过滤
- `VITE_AES_USER_ID_SECRET`：AES 加密密钥（仍按环境分支，dev 独立 / preview·prod 共用）

无需改代码。

### 跨域名 fetch 加白

部署后若发现某些域被浏览器拦截（CSP / CORS），看是否需要：
1. 加 `connect-src` 白名单（CSP 加固独立任务时统一处理）
2. 业务 API 加 `Access-Control-Allow-Origin`

### CSP 加固独立任务（待办）

需要先抓真实生产流量域名清单，至少包括：神策 datasink、业务 API、GA、Privy（`auth.privy.io` / `*.privy.io`）、WalletConnect（`*.walletconnect.com` / `relay.walletconnect.org`）、Reown（`*.reown.com` / `api.web3modal.org`）、各链 RPC（Alchemy / Infura / 公共节点）。由 Vite 插件按 mode 注入 CSP，dev 宽松、prod 严格白名单。

## 术语表

| 术语 | 说明 |
|---|---|
| autoTrack | 神策 SDK 自动埋点（PV / Click / Stay），通过 `quick("autoTrack")` 启动 |
| propertyPlugin | 神策 SDK 公共参数注入插件，所有 autoTrack 事件经此回调 |
| saTrack | 业务事件直连 datasink endpoint 的 fetch POST，与神策 SDK 写同一接收端 |
| datasink | SosoValue 自部署的神策 Sensors Analytics 私有化实例（`datasink.sosovalue.com`） |
| sensors.identify | 神策 SDK 用户身份关联 API，传 AES 加密钱包地址作 distinct_id |
| SRI | Subresource Integrity，`<script integrity="sha384-...">` 锁定第三方 JS 文件指纹 |
| `__device_id__` | localStorage key，神策侧用户去重的设备 ID，createStorage 包装格式 `{type,value}` |
| createStorage 包装 | sodex-web 自有 localStorage 工具，写入时包装 `{type:"string", value:"..."}` 格式 |
| thridBrowser | 第三方浏览器识别字段（Telegram/Twitter/Discord/YouTube/SosoValue WebView），命名拼写错误沿用 sodex-web 不修正 |
| obfuscation vs encryption | obfuscation = 混淆（密钥可逆但脱敏防明文进日志）；encryption = 加密（密钥保密）。本批 AES 是前者 |

## 更新记录

### 2026-05-13（第二次）: VITE_TRACK_URL 全环境统一指向 datasink production

`.env.development` / `.env.preview` 中的 `VITE_TRACK_URL` 从 `https://datasink1.sosovalue.com/sa?project=default` 改为与 prod 一致的 `https://datasink.sosovalue.com/sa?project=production`。神策 SDK `server_url` 与 saTrack 直连 fetch URL 同步切换（共用同一变量）。`datasinkSink.ts` 顶部注释同步更新。

副作用：dev / preview 流量进入生产数据池，需通知数据团队按 channelArea / pageId / userAgent 过滤；AES 密钥保留原 dev / prod 分支不变；deviceId/anonymousId localStorage 不变。

### 2026-05-13: heatmap 关闭 + localStorage 安全包装 + 刷新残留清理

1. **需求变更：heatmap 关闭**。`index.html` 神策 init 中 `clickmap` / `scroll_notice_map` 改为 `'not_collect'`，删除 `collect_element` 过滤函数。不再上报 `$WebClick` / `$WebStay`，仅保留 `$pageview`。D-3 关键决策反转。
2. **Reviewer Issue 2 修复（刷新后残留挂匿名事件）**：`identityService` 新增 `clearWalletLoginIdentityIfDirty()`；`useTrackConnectWallet` address null 分支去掉对 `lastIdentifiedRef` in-memory state 的依赖，改为读 localStorage 判 dirty。新增 D-13 关键决策。
3. **Reviewer Issue 3 修复（localStorage 抛错未捕获）**：`publicParams.ts` 新增 `safeGetItem` / `safeSetItem` / `safeRemoveItem` + 模块级 `inMemoryStore` fallback；所有原 `localStorage.*` 调用走包装。新增 export `hasWalletIdentityStorage`。新增 D-12 关键决策。

涉及文件：
- `index.html`：heatmap config 改为 not_collect，删除 collect_element
- `src/shared/track/domain/publicParams.ts`：+ safe wrappers + inMemoryStore + hasWalletIdentityStorage
- `src/shared/track/services/identityService.ts`：+ clearWalletLoginIdentityIfDirty
- `src/features/auth/containers/useTrackConnectWallet.ts`：address null 分支改调 IfDirty 版本

### 2026-05-12（第二次）：钱包身份双向链路完整性修复

修复 Batch A 实测发现的两个身份链路断点：

1. **walletAddress / walletType localStorage 写入源缺失**：sodex-next auth feature 重构为 zustand session 后不再写 `__wallet_address__`，导致 propertyPlugin 注入 `sosovalue.walletAddress` 长期为空字符串 / 残留 sodex-web 历史值。修复：`identityService.trackConnectWallet` 显式写 localStorage。
2. **autoTrack 与 saTrack distinct_id 不一致**：神策 SDK `sensors.identify(encrypted)` 让 autoTrack 事件 distinct_id = encrypted；但 saTrack 直连 `datasinkSink` 的 `distinct_id = userId || anonymousId`，其中 `userId` 从 localStorage `user_id` 读取 ——sodex-web 历史也未写入此 key，导致 saTrack 业务事件 distinct_id = anonymousId（随机 UUID），同一用户在神策后台被识别为两个 distinct_id。修复：`identityService.trackConnectWallet` 显式写 `user_id = encrypted` localStorage；`clearWalletLoginIdentity` 登出时同步调 `sensors.logout()` 与 localStorage 清空，让两路 distinct_id 同步回归 anonymous。
3. **新增 D-11 关键设计决策**：钱包身份双向链路完整性。
4. **新增 pitfall**：`track-payload-field-verification-required`（gate=true，未来 plan 自动预检）— 强制要求埋点 / 数据契约项目通过解码实际 POST payload 验证字段值。

涉及文件：
- `src/shared/track/domain/publicParams.ts`：+ `setUserId` / `setWalletAddress` / `setWalletType` / `clearWalletIdentityStorage`
- `src/shared/track/infra/sensorsSink.ts`：+ `logout()`
- `src/shared/track/services/identityService.ts`：trackConnectWallet 顺手写三组 localStorage；clearWalletLoginIdentity 三套清理
- `src/features/auth/containers/useTrackConnectWallet.ts`：接 wagmi `connector?.id`；address null 时清

### 2026-05-12: 初始版本（Batch A 基础设施）

实现 D-full 方案：神策 SDK autoTrack + identify + saTrack 直连业务事件基础设施 + GA 跨产品 user_id。10 个文件 / 7 个修改文件 / 17 个新建文件（含 SDK + 2 个 auth hook）。完整安全加固：SRI 强制 + AES 风险注释 + autoTrack 敏感过滤 + URL token 脱敏。CSP 移除待独立任务（漏配 Privy/WalletConnect/RPC 多域名）。Debug 实测 H2/H3/H4 三个核心假设全部 confirmed：$pageview ×7 + $WebClick ×6 + $WebStay ×2 + 3 钱包 sensors.identify + GA log_in 防重生效。

Spec 文档：
- `.claude/kit/spec/2026-05-12-track-batch-a-implementation.md`（实施方案）
- `.claude/kit/spec/2026-05-12-track-future-batches-and-extensions.md`（Batch B/C/D 扩展指南）

Sodex-web 历史事实清单：
- `.claude/kit/context/library/sodex-web/reference/global/global-track-guide.md`
