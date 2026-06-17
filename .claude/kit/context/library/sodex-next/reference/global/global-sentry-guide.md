# Sentry 钱包错误监控 — QA 测试指南

## 核心需求

把 sodex-web 已经在生产稳定运行 7 个月的 Sentry 错误监控基础设施迁移到 sodex-next，**只**接入"钱包交换"写操作链路（Withdraw / Deposit / Transfer / Vault / Stake / Airdrop claim + 钱包连接），用于：
- **个案排查**：oncall 在线上用户反馈 / 客诉时，按 walletAction tag 过滤、按 connectorName 分桶，定位是钱包问题 / 链问题 / 后端问题
- **趋势监控**：Sentry dashboard 看各 walletAction 周失败率、SIGNATURE_TIMEOUT 兜底比例（兜底比例飙升 = Infra mapWalletError 漏识别新钱包错误）
- **抓后端边缘场景**：`TX_PENDING` / `API_KEY_EXPIRED` 等本应稳定路径的真实发生频次
> **v1 不接入纯交易所 API 操作**（spot/perps 下单 / 撤单 / 调仓 / TPSL / 杠杆 / 保证金等）—— 它们不弹钱包不上链，错误以业务规则为主；留 v2 全站 HTTP 拦截器覆盖。
---

---

## TL;DR — 一图看清上报覆盖

### 接入的钱包写操作（12 个 Container + 1 个连接弹窗）

| 模块 | Container hook | walletAction tag | 用户场景 |
|---|---|---|---|
| Trade | `useSubmitWithdraw` | `Withdraw.submit` | Withdraw 弹窗（`ConnectedWithdraw.tsx`） |
| Trade | `useSubmitTransfer` | `Transfer.submit` | Transfer 弹窗（含 EVM→Spot deposit）（`ConnectedTransfer.tsx`） |
| Trade | `useSubmitFlashDeposit` | `Deposit.flash` | Flash deposit 弹窗（`ConnectedDeposit/`） |
| Vault | `useSubmitVaultClaim` | `Vault.claim` | Vault claim 弹窗 |
| Vault | `useSubmitVaultWithdraw` | `Vault.withdraw` | Vault withdraw 弹窗 |
| Vault | `useSubmitVaultUnstake` | `Vault.unstake` | Vault unstake 弹窗 |
| Vault | `useSubmitVaultDeposit` | `Vault.deposit` | Vault deposit 状态机 |
| Staking | `useSubmitStake` | `Stake.submit` | ValueChain stake |
| Staking | `useSubmitUnstake` | `Stake.unstake` | ValueChain unstake |
| Staking | `useSubmitClaim` | `Stake.claim` | Staking reward claim |
| Airdrop | `useSubmitAirdropClaim` | `Airdrop.claim` | Airdrop claim |
| Auth | `useConnectWalletDialog` | `Wallet.connect` | wagmi useConnect 错误监听 |

**v1 明确不接入**：spot/perps 下单 / 撤单 / 调仓 / TP-SL / 杠杆 / 保证金 / 纯交易所 API 操作（不弹钱包、不上链；留 v2 走全站 HTTP 拦截器）；`useSubmitSwap` / `useCustodyRefund` 同样排除。

### 错误类型 → 是否捕获

| 错误源 | 是否捕获 | 备注 |
|---|---|---|
| 业务 HTTP fetch 失败（biz API / RPC HTTP）| ✅ | walletAction tag 让 beforeSend 保留 Network Error |
| 钱包 RPC 超时（viem 抛 TransactionExecutionError 等）| ✅ | mapWalletError 归一化 SIGNATURE_TIMEOUT/UNKNOWN |
| WalletConnect relay 断 | ✅ | 签名超时 / useConnect.error 两个入口都监听 |
| 链上交易卡 mempool | ✅ | TX_PENDING / TX_TIMEOUT discriminator |
| 切链 / 添加链失败 | ✅ | CHAIN_MISMATCH / addChainAddBreadcrumb 留痕 |
| 后端业务 5xx / API_KEY_EXPIRED | ✅ | warning level，单独 dashboard 过滤 |
| 用户主动拒签 / 关闭 modal | ❌ **故意不上报** | isUserCancel 白名单 + 关键词兜底 |
| 用户完全离线 + 立刻关闭页面 | ❌ | 边界，SDK 入队后页面卸载导致丢失 |
| ISP 拦截 Sentry 域名（地区性）| ❌ | 结构性盲区，需 `tunnel` option 经自家域名转发 |

### 关键 tag / extra（Sentry dashboard 可见）

| 字段 | 来源 | 用途 |
|---|---|---|
| `exception.type` | discriminator(`type`/`kind`)：`SIGNATURE_REJECTED` / `CHAIN_MISMATCH` / `CLAIM_API_FAILED` 等 | dashboard 分桶主键 |
| `tags.walletAction` | container 显式传入 | 业务流程定位 |
| `tags.connector.id/name/type` | wagmi useAccount 自动 | MetaMask / OKX / WalletConnect 区分 |
| `tags.wallet.chainId` / `wallet.signerAddress` | container 显式传入 | 链 + 用户地址 |
| `tags.layout` / `tags.device` / `tags.network_env` | initSentry 启动时全局打 | mobile/pc + mainnet/preview 分桶 |
| `contexts.os.*` / `contexts.browser.*` | SDK 自动解析 UA | 平台 + 浏览器 |
| `extras` | container 显式传入（amount / coin / from / to 等） | 业务上下文 |
| `extras.wallet.rawError` | 非 Error throw 时保留原始 ServiceError | 完整 discriminated union 兜底 |
| `breadcrumbs` | console.warn + wallet_addEthereumChain 等 | 时间线还原现场 |
| `fingerprint` | `[{{default}}, walletAction, exception.type]` | 同业务错误稳定分组，不受 build hash 影响 |

### 文件结构（`src/shared/observability/sentry/`）

| 文件 | 作用 |
|---|---|
| `initSentry.ts` | SDK 启动入口；env/DSN/HMR guard；beforeSend(sanitize + fingerprint + [object Object] 兜底)；全局 tag |
| `reportWalletError.ts` | 钱包错误专用上报，自动过滤用户取消、附 wallet.*/connector.* tag |
| `useWalletErrorReporter.ts` | Container 默认 hook，包装 wagmi useAccount 一行接入 |
| `ensureChainWithBreadcrumb.ts` | 包装 `capability.ensureChain` 自动打 wallet_addEthereumChain breadcrumb；`addChainAddBreadcrumb` 用于 service 内部 ensureChain 场景 |
| `isUserCancel.ts` | 双 discriminator(type+kind) 白名单 + 关键词兜底 |
| `sanitize.ts` | 38 SENSITIVE_KEYS + 私钥/JWT regex + URL query + Prompt Injection |
| `reportError.ts` | 通用 reportError / reportMessage（内部 / 烟测用） |
| `env.ts` | `IS_SENTRY_ENABLED` 单点常量（仅 mainnet/preview 真发） |
| `index.ts` | 公开 barrel |

完整 API 签名 / 接入示例 / 决策记录 / 验收场景见下方分章。

# Part A · QA 测试指南

> 给测试同学的功能验证文档。覆盖钱包交换模块的错误上报范围、上报字段、触发场景、不上报场景。

---

## 1. 功能概览

线上钱包写操作（提现 / 充值 / 转账 / Vault / Stake / 领取空投 / 钱包连接）失败时，前端会把错误结构化上报到 Sentry 后台，供 oncall 排查。**仅在 mainnet / preview 环境上报**；dev/test 环境改走 `console.error` 本地打印。

---

## 2. 哪些操作会上报

| # | 用户操作 | 上报 tag (walletAction) |
|---|---|---|
| 1 | 提现到外部地址（Withdraw） | `Withdraw.submit` |
| 2 | 账户间转账（Spot ↔ Funding / EVM ↔ Spot） | `Transfer.submit` |
| 3 | 闪电充值（外链 → 平台） | `Deposit.flash` |
| 4 | Vault 领取收益 | `Vault.claim` |
| 5 | Vault 解除质押 | `Vault.unstake` |
| 6 | Vault 提取 | `Vault.withdraw` |
| 7 | Vault 存入 | `Vault.deposit` |
| 8 | Stake 质押 SOSO | `Stake.submit` |
| 9 | Stake 解锁（unstake） | `Stake.unstake` |
| 10 | Stake 领取（cooldown 结束） | `Stake.claim` |
| 11 | 领取 Airdrop | `Airdrop.claim` |
| 12 | 钱包连接（MetaMask / WalletConnect 等） | `Wallet.connect` |

---

## 3. 哪些操作**不**上报

| 操作 | 原因 |
|---|---|
| Spot 下单 / 撤单 / 全撤（Order / CancelOrder / CancelAllOrders） | 纯交易所 API，不弹钱包不上链 |
| Perps 下单 / TPSL / 平仓 / 全平 / 调杠杆 / 切保证金模式 / 增减保证金 | 同上 |
| Swap（USDT → USDC 兑换） | Spot 限价单本质，本地 API Key 签 + 后端 POST |
| Custody Refund（退款申请） | 纯后端 HTTP POST，无钱包 |
| Deposit Accept Status（首次充值确认勾选） | 纯后端配置标记 |

这些操作的失败由后端 API 错误监控覆盖（v2 规划），**本次范围不涉及**。

---

## 4. 上报字段清单（QA 在 Sentry 后台能看到什么）

### 4.1 业务自定义 Tag（可在 dashboard 按这些 tag 过滤 / group by）

| Tag 名 | 取值示例 | 说明 |
|---|---|---|
| `walletAction` | `Withdraw.submit` / `Vault.claim` / `Wallet.connect` | **主分类键**，定位是哪个业务 |
| `connector.id` | `metaMask` / `walletConnect` / `injected` / `privy` | **钱包类型识别**（WalletConnect / MetaMask / OKX 等） |
| `connector.name` | `MetaMask` / `WalletConnect` / `OKX Wallet` | 钱包人类可读名 |
| `connector.type` | `injected` / `walletConnect` / `embedded` | 连接方式分类 |
| `wallet.signerAddress` | `0xABC123...` | 当前操作的钱包地址（按用户排查） |
| `wallet.chainId` | `88`（ValueChain）/ `8453`（Base） | 当前签名所在链 |
| `layout` | `mobile` / `pc` | UI 布局（视口 760px 为分界） |
| `device` | `mobile` / `desktop` | 物理设备类型（UA 判断） |
| `network_env` | `mainnet` / `preview` | 环境 |

### 4.2 Sentry SDK 自动注入字段（无需代码，浏览器自动识别）

| 字段 | 取值示例 |
|---|---|
| `contexts.os.name` | `Mac OS X` / `Windows` / `Android` / `iOS` / `Linux` |
| `contexts.os.version` | `14.5` / `11` / `13` |
| `contexts.device.family` | `iPhone` / `iPad` / `Pixel` / `Desktop` |
| `contexts.device.brand` / `.model` | 移动端品牌型号（如 `Apple iPhone 15 Pro`） |
| `contexts.browser.name` / `.version` | `Chrome 130.0` / `Safari 17.0` |
| `event.environment` | `sodex-next-mainnet` / `sodex-next-preview`（与 sodex-web 区分） |
| `event.release` | `0.0.1`（来自 package.json 版本号） |
| `event.timestamp` | 自动 |

### 4.3 业务 Extra 字段（按操作不同附加）

| 操作 | extra 字段 |
|---|---|
| `Withdraw.submit` | coinSymbol, mode, accountType |
| `Transfer.submit` | from, to, coin |
| `Deposit.flash` | coinSymbol |
| `Vault.claim` | amount |
| `Vault.unstake` | amount |
| `Vault.withdraw` | token, amount |
| `Vault.deposit` | phase, chain, from, amount |
| `Stake.submit` | amount |
| `Stake.unstake` | amount |
| `Stake.claim` | （无附加，仅基础 tag） |
| `Airdrop.claim` | （无附加） |
| `Wallet.connect` | （无附加） |

### 4.4 Breadcrumb（错误发生前的用户行为留痕）

| category | message | data | 触发时机 |
|---|---|---|---|
| `wallet` | `wallet_addEthereumChain triggered` | `{ chainId, walletAction }` | 用户钱包尚未添加目标链、应用调起 `wallet_addEthereumChain` 时记录 |

在 Sentry event 详情页的 "Breadcrumbs" 部分可见——便于判断"错误前是否发生过添加链动作"。

### 4.5 错误等级（level）

| level | 触发条件 |
|---|---|
| `error`（默认） | 大多数错误 |
| `warning` | type/kind 为 `API_KEY_EXPIRED` 或 `TX_PENDING` 时（属预期边缘场景，非真异常） |

---

## 5. 哪些错误**不**上报（已自动过滤，不算 bug）

这些场景属于"用户主动行为"或"系统已处理"，**Sentry 0 事件**：

| 场景 | 识别方式 |
|---|---|
| 用户在钱包弹窗点 Reject（MetaMask 等弹出后用户拒绝签名） | 错误码 4001 / `SIGNATURE_REJECTED` |
| 用户拒绝 Privy 邮箱 MFA 签名 | 同上 |
| Vault 操作用户拒签 | `kind: USER_REJECTED` |
| 用户点 X 关闭 AuthStepsModal（enable trading 弹窗） | `EXCHANGE_CAPABILITY_MISSING` |
| QR 扫码登录模式下尝试钱包签名（系统已拦截 + toast） | `QR_MODE_BLOCK` |
| 钱包未连接情况下尝试操作（系统已 toast 引导） | `NOT_CONNECTED` / `WALLET_NOT_CONNECTED` |
| Watch 只读模式下尝试写操作（系统已拦截） | `WATCH_MODE_BLOCK` |
| 任意错误 message 含 `user rejected` / `user denied` / `cancelled` 等关键词 | 兜底关键词匹配 |

---

## 6. 安全过滤（不会出现在上报中的内容）

| 类型 | 处理方式 |
|---|---|
| 私钥（任何 64 位 hex 字符串） | 替换为 `[REDACTED_KEY]` |
| JWT token（`eyJ...` 格式） | 替换为 `[REDACTED_JWT]` |
| 字段名含 password / signature / message / authorization 等 38 个敏感词 | 字段值替换为 `[REDACTED]` |
| URL query 中 token / api_key / secret 等参数 | 参数值替换为 `[REDACTED]` |
| Cookie / IP 地址 | 完全不上报（Sentry SDK `sendDefaultPii: false`） |
| fetch / xhr 请求的 breadcrumb | 完全不留痕（防 URL token 泄漏） |
| Prompt Injection 关键词（"ignore previous instruction" 等中英文 36 条） | 替换为 `[SUSPICIOUS_CONTENT_FILTERED]` |
| 单字段超 50KB | 截断 + `[TRUNCATED]` |
| 对象嵌套超 10 层 | 替换为 `[MAX_DEPTH_EXCEEDED]` |

---

## 7. 测试用例

### 7.1 准备

1. 环境：mainnet 或 preview（dev 不上报，仅 console 打印）
2. 钱包：建议同时准备 **MetaMask（浏览器扩展）** 和 **WalletConnect（手机扫码）** 两种 connector
3. Sentry 后台访问权限
4. 测试地址：建议在 testnet 实操（避免真实资产损耗），事件中的 `wallet.chainId` 仍能正确识别

### 7.2 必跑用例（高优先级）

#### CASE-1: 上报字段完整性
- **操作**：触发任意一个会上报的失败场景（推荐 Withdraw 故意切错链）
- **预期**：Sentry 后台 1 条 event，含以下字段：
  - tags：`walletAction`, `connector.id`, `connector.name`, `connector.type`, `wallet.signerAddress`, `wallet.chainId`, `layout`, `device`, `network_env`
  - contexts.os：`name` 和 `version` 自动识别（如 `Mac OS X 14.5`）
  - contexts.browser：`name` 和 `version` 自动识别
  - `environment` = `sodex-next-mainnet` 或 `sodex-next-preview`
  - `release` 不为空（应是 `0.0.1` 或更新版本号）

#### CASE-2: 用户主动取消零上报
- **操作**：发起任意一个钱包签名操作（例如 Withdraw），在钱包弹窗点击 **Reject**
- **预期**：
  - Sentry 后台 **0 事件**（不应出现该次拒签的 event）
  - UI 应正常 toast "Transaction has been canceled" 或类似文案

#### CASE-3: 用户关闭 enable trading 弹窗零上报
- **操作**：未启用 trading 状态下发起 Spot Withdraw，AuthStepsModal 弹出后点 X 关闭
- **预期**：Sentry **0 事件**；UI 无错误 toast

#### CASE-4: 钱包类型识别（MetaMask 对比 WalletConnect）
- **操作**：分别用 MetaMask 和 WalletConnect 触发同一类失败（如 Vault.claim 切错链）
- **预期**：Sentry 两条 event，tag `connector.id` 分别为：
  - MetaMask：`metaMask`
  - WalletConnect：`walletConnect`
- 在 dashboard 按 `connector.id` group by 应能看到两个独立分组

#### CASE-5: 移动端 / PC 端识别
- **操作**：用手机浏览器跑一个失败场景（如 Vault.claim）
- **预期**：event tag：
  - `layout=mobile`（视口宽度 < 760px）
  - `device=mobile`（UA 识别移动设备）
  - `contexts.os.name` = `Android` 或 `iOS`
  - `contexts.device.family` 有值（如 `iPhone` / `Pixel`）

#### CASE-6: 切链 breadcrumb 留痕
- **操作**：触发 `Withdraw / Stake / Unstake / Claim` 中任一操作，钱包不支持目标链时拒绝添加链
- **预期**：Sentry event 详情 → **Breadcrumbs** 区域应含一条：
  - category: `wallet`
  - message: `wallet_addEthereumChain triggered`
  - data: `{chainId: 88, walletAction: "Stake.submit"}` 类似

#### CASE-7: 钱包连接错误
- **操作**：在钱包连接弹窗选择 MetaMask，模拟连接失败（如拔网线 / 锁定钱包后点击）
- **预期**：
  - 真实连接错误 → Sentry 1 条 event，`walletAction = Wallet.connect`
  - 用户在 popup 点 Reject → Sentry 0 事件（被过滤）

#### CASE-8: API_KEY_EXPIRED warning 级别
- **操作**：清除 localStorage 后立刻发起一个需要 API Key 签名的操作（如 Withdraw from Spot）
- **预期**：Sentry event 的 `level=warning`（非 error），dashboard 可按 level 区分

### 7.3 dev 环境本地验证（不需要 Sentry 后台）

#### CASE-9: dev 环境 console.error 打印
- **操作**：本地 dev 启动（默认环境）→ 触发任意失败场景
- **预期**：浏览器 devtools Console 看到 `[wallet:Withdraw.submit]` 开头的 `console.error` 结构化输出，含 walletAction / connector / chainId / extra 等所有字段；**Sentry 后台无 event**

#### CASE-10: dev 环境 console 不打用户取消
- **操作**：dev 环境下钱包拒签
- **预期**：Console **无** `[wallet:*]` 输出（用户主动取消统一过滤）

### 7.4 同事件 group 一致性（Sentry dashboard）

#### CASE-11: 同 walletAction + 同 exception type 合并到一个 issue
- **操作**：连续触发 3 次相同失败（如 3 次 Withdraw 在同一种错误下挂）
- **预期**：Sentry Issues 列表 → 同一个 issue 下 3 个事件（不应被拆成 3 个独立 issue）
- 原因：fingerprint 已按 `walletAction + exception.type` 强制 group

---

## 8. 验收 checklist

| # | 检查项 | 通过 |
|---|---|---|
| 1 | 12 个钱包操作触发失败时 Sentry 收到事件 | ☐ |
| 2 | 用户拒签场景 0 事件 | ☐ |
| 3 | `walletAction` / `connector.*` / `wallet.*` tag 全部出现 | ☐ |
| 4 | `contexts.os.name` / `browser.name` 自动识别 | ☐ |
| 5 | `layout` / `device` 区分手机和电脑 | ☐ |
| 6 | 切链场景 breadcrumb 留痕 | ☐ |
| 7 | `environment` = `sodex-next-<env>` 区分于 sodex-web | ☐ |
| 8 | 私钥 / JWT / token 不出现在任何字段 | ☐ |
| 9 | `API_KEY_EXPIRED` 错误 level = warning | ☐ |
| 10 | 同业务错误 group 为一个 Sentry issue | ☐ |
| 11 | dev 环境 console.error 结构化打印 | ☐ |
| 12 | dev 环境用户拒签无 console 噪音 | ☐ |

---

## 9. 已知限制（QA 不必报为 bug）

- **stack trace 是压缩态**：因当前未上传 source map，event 中 stack 显示压缩后函数名（如 `a.b.c`）。排查靠 `walletAction` tag + `extra` 业务字段反推位置。
- **Sentry 配额与 sodex-web 共享同一 project**：环境字段已区分；如果某段时间 sodex-web 流量大，可能影响 sodex-next 事件采集（v2 视情况拆 project）。
- **Spot / Perps Order 等 10 个操作不在本次范围**：见 §3 不上报清单，这是设计决策不是漏改。

---

## 10. 出 bug 怎么报

发现 QA 标准与实际不符时，提 bug 请附：
1. 操作步骤 + 用户钱包类型
2. 期望行为（参考本文档对应章节）
3. 实际行为（Sentry event 截图 / 浏览器 console 截图）
4. 浏览器 User-Agent / 设备类型

---

# Part B · 集成方案（开发者参考）

> 来源：`.claude/kit/spec/add-sentry.md`
> 范围：仅针对钱包交互 / 交易所写操作模块的错误上报，不覆盖全站
> 参考：sodex-web `src/utils/sentry.ts` + `src/utils/walletLogger.ts` + `src/utils/userActionCheck/`
> 上下文文档：sodex-web `/k:context global-sentry`（已读 `library/sodex-web/reference/global/global-sentry-guide.md`）
> 澄清日期：2026-05-22（经 `/k:clarify` 流程结构化拍板）

---

## 决策记录（本次 clarify 拍板项）

| 决策点 | 选项 | 理由 |
|---|---|---|
| 核心用户场景 | 个案排查 + 趋势监控（双场景） | oncall 排个案 + dashboard 看错误率走势，都要支持 |
| 验收标准（PR 合并拦截） | 5 关键链路 × 3 错误场景在 Sentry 后台可见 | Withdraw/Transfer/FlashDeposit/VaultClaim/VaultWithdraw 各跑通用户拒签 / 断网错链 / 后端 5xx |
| Sentry project 归属 | 复用 sodex-web 现有 project | sodex-web 未部署，无历史包袱；省后台建项目 / 申请新 DSN / 配 Allowed Domains 三步运维 |
| 项目区分方式 | Sentry `environment` 字段 | sodex-web 用 `sodex-web-<env>`、sodex-next 用 `sodex-next-<env>`，dashboard 用 environment 过滤分桶 |
| Source map 上传 | **v1 不上传**，与 sodex-web 当前状态对齐 | 改 vite + 加 plugin + CI secret 改动小但引入"为什么 sodex-next 有 sodex-web 没有"的不一致；待 sodex-web 准备上线时双项目同步加（v2） |
| 用户主动取消 | 不上报、不操作 | 4001 / "user rejected" / EXCHANGE_CAPABILITY_MISSING / QR_MODE_BLOCK 等已被 Infra/Service/ensure 闸归一化的"用户主动行为" |
| OS / 设备 / 浏览器识别 | 依赖 Sentry SDK 自动采集 + 4 个自定义 tag | `os.name/version` / `device.family` / `browser.name/version` 由 SDK 解析 UA 自动写入 event；额外打 `layout` / `device` / `connector.id` / `connector.type` 4 个自定义 tag 用于 dashboard 分桶 |
| 切链 / 添加链失败 | 隐式覆盖，无需新增上报点 | `ensureChain` 失败在 mutationFn 内 throw，被既有 mutation `onError` → `reportWalletError` 兜底；`chainId` 已在 ctx |
| 添加链用户行为 | breadcrumb 记录（非 error） | `onAddingChain` 回调触发时调 `Sentry.addBreadcrumb`，便于"add 链 + 紧接失败"的关联排查 |
| 钱包连接失败 | 新增上报点 | `useConnect.error` 不在任何 mutation 路径中，需在 `useConnectWalletDialog` 内通过 `useEffect` 监听 wagmiError，调 `reportWalletError({ walletAction: "Wallet.connect" })` |
| `API_KEY_EXPIRED` ServiceError | 上报（level=warning） | 后端明确拒绝信号；上报用于评估 API Key 过期机制是否合理（频次高 = 配置不当 / staySignedIn 设计有问题） |
| Container 重复样板代码 | 抽象 `useWalletErrorReporter(walletAction)` hook | Container 内 1 行替代 6 行 connector 解构 + 上报，统一管理 connector tag 字段；约省 100+ 行重复 |
| `ensureChain` breadcrumb 重复 | 抽象 `ensureChainWithBreadcrumb` helper | 替代 8 处重复 `Sentry.addBreadcrumb` 模板 |
| 事件 grouping 不准 | `beforeSend` 内置 fingerprint hint | 无 source map 时压缩 stack frame 跨 build 变化会让同业务错误被 group 成多个 issue；按 `walletAction` + `exception.type` 强制 group |
| 默认 integrations 体积 | 关闭 `BrowserTracing` / `Replay` | v1 不用 trace/replay；关闭后 bundle -20KB |
| `release` 字段 | v1 一并加（与 source map 解耦） | 注入 `import.meta.env.VITE_APP_VERSION`，Sentry dashboard 按 release 过滤 / release health |
| Wallet address PII | 上报但需在隐私政策披露 | `signerAddress` 是 pseudo-PII，故意上报用于个案排查；合规层面应在隐私政策列入"上报范围" |
| HMR 防重复 init | `initSentry` 内 `inited` guard | dev 临时启用 + hot reload 会重跑模块顶层；guard 后重复调用幂等 |
| ServiceError discriminator 字段命名不统一 | `isUserCancel` 同时检测 `error.type` 和 `error.kind` | trade/auth 用 `type:`，vault 用 `kind:`；只查一个会导致 vault 用户拒签漏过滤上报。PR 2 阶段实测发现并修复 |
| ExchangeAction 链路是否纳入 v1 | **不纳入**（PR 3 阶段评估后回退） | spot/perps 下单 / 撤单 / 调仓等不弹钱包、不上链、纯交易所 API 操作，错误 99% 来自后端业务规则；按 mutation 逐个接入信噪比低（85% 噪音）且偏离"钱包交换"字面 scope；留 v2 全站 HTTP 拦截器一次性覆盖 |
| dev 环境本地可见性 | **dev 不发 Sentry，但 `console.error` 打印结构化错误** | 共享常量 `IS_SENTRY_ENABLED` 单点判断（只有 mainnet/preview 真发）；`reportWalletError` / `reportError` / `reportMessage` 在 dev 走 console.error 分支，输出 walletAction / connector / chainId / extra 等所有 tag 字段，devtools 直接可见，便于本地调试不依赖 Sentry 后台 |

---

## 背景与目的

把 sodex-web 已经在生产稳定运行 7 个月的 Sentry 错误监控基础设施迁移到 sodex-next，**只**接入"钱包交换"写操作链路（Withdraw / Deposit / Transfer / Vault / Stake / Airdrop claim + 钱包连接），用于：

- **个案排查**：oncall 在线上用户反馈 / 客诉时，按 walletAction tag 过滤、按 connectorName 分桶，定位是钱包问题 / 链问题 / 后端问题
- **趋势监控**：Sentry dashboard 看各 walletAction 周失败率、SIGNATURE_TIMEOUT 兜底比例（兜底比例飙升 = Infra mapWalletError 漏识别新钱包错误）
- **抓后端边缘场景**：`TX_PENDING` / `API_KEY_EXPIRED` 等本应稳定路径的真实发生频次

> **v1 不接入纯交易所 API 操作**（spot/perps 下单 / 撤单 / 调仓 / TPSL / 杠杆 / 保证金等）—— 它们不弹钱包不上链，错误以业务规则为主；留 v2 全站 HTTP 拦截器覆盖。

---

## 选定方案

**复用 sodex-web 已验证的 sentry.ts 实现，按 sodex-next 分层规范适配**。核心改动：

1. 仅 1 个钱包专用上报 API（reportWalletError + useWalletErrorReporter）
2. 钱包元信息由 Container 显式传入（而非读 store），符合 `auth.md` 红线"capability 必须形参传入"
3. 用户取消判断升级为 "discriminator 白名单（同时识别 type / kind）+ 关键词兜底"——利用 sodex-next 已存在的 Infra/Service 错误归一化层；vault feature 用 `kind:` 而 trade/auth 用 `type:`，必须双检
4. 复用 sodex-web Sentry project（DSN 同值），用 `environment: sodex-next-<env>` 标签区分

**为什么不重新写**：sodex-web sanitize 管线（敏感字段 / 私钥正则 / JWT / Prompt Injection / 性能限制 / try-catch 兜底）已在生产经过 7 个月数据淬炼，重写徒增风险。

---

## 设计概要

### 3.1 架构分层（错误从产生到上报）

```
钱包错误产生
    ↓
[Infra 层] 已存在：mapWalletError → InfraError({SIGNATURE_REJECTED|CHAIN_MISMATCH|SIGNATURE_TIMEOUT})
    ↓
[Service 层] 已存在：mapInfraError → ServiceError（per-feature union）
    ↓
[Container 层 onError] 已存在：handleServiceError → notify toast
    ↓
[新增] reportWalletError(error, ctx) → Sentry beforeSend 管线 → 上报
```

**核心原则**：上报点**只**在 Container Mutation `onError` 内调用，与 `handleServiceError` 并列。
- ✅ 不在 Infra 上报（CLAUDE.md §2 禁止 Infra 有副作用）
- ✅ 不在 Service 上报（CLAUDE.md §9 Service 禁止 `import React` 和副作用）
- ✅ 上报与 toast 解耦——`handleServiceError` 决定 UI 提示，`reportWalletError` 决定监控数据

### 3.2 模块文件结构

详见文档开头 TL;DR §文件结构。目录：`src/shared/observability/sentry/`。

放在 `shared/observability/` 而非 `shared/infra/`：observability 是横切关注点，不是外部系统适配器。

> **v1 范围明确不包含** ExchangeAction 链路（spot/perps 下单 / 撤单 / 调仓 / TP-SL / 杠杆 / 保证金等纯交易所 API + 本地 API Key 签名操作）—— 它们不涉及钱包 / 区块链，错误 99% 来自后端业务规则（拒单 / 余额不足 / 网络），更适合走未来 v2 全站 HTTP 错误拦截器一次性覆盖。本 spec 早期版本曾包含 `reportExchangeError.ts` / `useExchangeErrorReporter.ts`，PR 3 阶段评估后回退——scope 收窄至"钱包交换"字面意图（涉及钱包 / 链上 / 跨边界资金流转）。

### 3.3 公开 API

#### `initSentry(): void`

入口接入点：`src/main.tsx:12-16`（`installRecorder()` → `initSentry()` → `createRoot.render`）。

实现要点：
- 读 `import.meta.env.VITE_NETWORK_ENV`，仅 `mainnet` / `preview` 启用
- **HMR 防重复**：模块顶层 `let inited = false` guard，`Sentry.init` 仅调一次
- **environment 字段拼接**：`` `sodex-next-${VITE_NETWORK_ENV}` ``（用于在共享 project 中区分 sodex-web 事件）
- **release 字段**：`import.meta.env.VITE_APP_VERSION`（vite define / build 脚本注入，缺失时降级为 `"unknown"`）
- `tracesSampleRate: 0`（错误监控不需要 trace）
- `sendDefaultPii: false`
- **integrations 收口**：filter 掉 `BrowserTracing` / `Replay` 等默认 lazy load 项（v1 不用，约省 20KB bundle）
- `beforeSend`：走 `sanitize.ts` 全套过滤管线 + try/catch 兜底 + **fingerprint hint**（按 `walletAction` + `exception.type` group）
- `beforeBreadcrumb`：提前丢弃 `fetch` / `xhr` breadcrumb（钱包错误不依赖 HTTP breadcrumb，且 URL 可能含 token；console / navigation / dom 保留）
- `ignoreErrors`：`ResizeObserver loop ...` / `Non-Error promise rejection ...` / `Loading chunk N failed`
- DSN 读 `import.meta.env.VITE_SENTRY_DSN`（与 sodex-web 同值）；缺失时 `console.warn` 后返回不抛异常

实现：`src/shared/observability/sentry/initSentry.ts:13-202`。核心结构：

- `inited` 模块顶层 guard（防 HMR 重复 init）
- `IS_SENTRY_ENABLED` 早返（仅 mainnet/preview）；DSN 缺失 → `console.warn` 后返
- `Sentry.init`：`environment=sodex-next-<env>` / `release=VITE_APP_VERSION` / `sendDefaultPii:false` / `tracesSampleRate:0`
- `integrations` 过滤：关 `BrowserTracing` / `Replay` / `ReplayCanvas`
- `beforeBreadcrumb`：丢 `fetch` / `xhr`（URL 可能含 token）
- `beforeSend`：（a）`[object Object]` 兜底重写 →（b）`sanitize.ts` 全面过滤 →（c）fingerprint hint = `[{{default}}, walletAction|module, exception.type]` →（d）try/catch 失败时清空敏感载体保留核心错误
- `ignoreErrors`：ResizeObserver / Loading chunk N failed 等噪音
- 全局 tag：`layout` / `device` / `network_env`

#### `reportWalletError(error, ctx): void`

类型：`src/shared/observability/sentry/reportWalletError.ts:26-41` 定义 `WalletErrorContext`（`walletAction` / `signerAddress` / `connector.id|name|type` / `chainId` / `extra`）。

> `layout` / `device` 等 viewport / 设备维度由 `initSentry` 启动时一次性全局 setTag（见 §3.6），不在 ctx 内重复传。
> OS / browser / device.family 由 `@sentry/react` SDK 自动解析 User-Agent 写入 `event.contexts`，无需任何代码。

**用户取消过滤白名单**（命中则 return，不上报、不操作）：

白名单 + 双字段判断：`src/shared/observability/sentry/isUserCancel.ts:8-16`（`USER_CANCEL_DISCRIMINATORS`）+ `isUserCancel.ts:41-76`（`type` / `kind` 任一命中即过滤）。

兜底关键词（防御 Service 漏归一化直接 `throw new Error()` 的情况）：`4001` / `user rejected` / `user denied` / `rejected the request` / `ACTION_REJECTED`。

> ⚠️ **重要**：sodex-next 的 ServiceError union 在不同 feature 用了不同 discriminator 字段命名——trade/auth 用 `type:`，vault 用 `kind:`。`isUserCancel` **必须同时检查两者**，否则 vault 用户拒签会漏过滤上报到 Sentry。本 bug 在 PR 2 阶段被实测发现并修复（见 PR 2 实施记录 §修复）。

#### `reportError(error, options?) / reportMessage(msg, level?)`

直接搬迁 sodex-web 实现。v1 仅在 sentry 模块内部使用。

#### `useWalletErrorReporter(walletAction): (error, ctx?) => void` Hook

封装 connector 解构 + reportWalletError 调用，**Container 默认入口**。每个钱包写 Container 1 行 hook 调用替代 6 行重复样板。

实现：`src/shared/observability/sentry/useWalletErrorReporter.ts:18-32`。封装 `wagmi.useAccount().connector` + `reportWalletError`，Container 内一行调用替代 6 行 connector 解构样板。

#### `ensureChainWithBreadcrumb(capability, chainId, walletAction, options?)`

包装 `OnChainCapability.ensureChain`，在 `onAddingChain` 触发时调 `Sentry.addBreadcrumb` 记录用户行为，便于错误事件 group 看到"前面发生了添加链"上下文。

实现：`src/shared/observability/sentry/ensureChainWithBreadcrumb.ts:16-26`（`addChainAddBreadcrumb` 独立函数）+ `:28-41`（`ensureChainWithBreadcrumb` wrapper）。两条入口：Container 自己调 `ensureChain` 用 wrapper；Service 内部调 `ensureChain` 但 callback 透传到 Container 时用 `addChainAddBreadcrumb`（如 `useSubmitTransfer.ts:117`）。

### 3.4 安全过滤管线（继承 sodex-web 实现零修改）

| 过滤项 | 实现位置 | 说明 |
|---|---|---|
| SENSITIVE_KEYS 字段名黑名单 | `sanitize.ts` | 38 个 key |
| `(?:0x)?[a-fA-F0-9]{64}` | `sanitize.ts` | `[REDACTED_KEY]` |
| JWT (`eyJ...eyJ....*`) | `sanitize.ts` | `[REDACTED_JWT]` |
| URL query 敏感参数 | `sanitize.ts` | token/api_key/signature/listenKey 等 → `[REDACTED]` |
| Prompt Injection 中英文 36 条 | `sanitize.ts` | `[SUSPICIOUS_CONTENT_FILTERED]` |
| MAX_STRING_LENGTH 50KB / MAX_DEPTH 10 | `sanitize.ts` | 截断 + 占位符 |
| beforeSend try/catch 兜底 | `initSentry.ts` | 失败时清空 extras / contexts / breadcrumbs |

### 3.5 Sentry 自动采集字段（无需代码）

`@sentry/react` SDK 默认从浏览器 navigator + User-Agent 解析以下字段写入 event。`sendDefaultPii: false` 不影响这些（PII 关的是 IP / cookies / 用户身份标识，不关运行环境元数据）。

| event 字段 | 示例值 | 用途 |
|---|---|---|
| `contexts.os.name` | `"Mac OS X"` / `"Windows"` / `"Android"` / `"iOS"` / `"Linux"` | 后台直接 group by OS 看分布 |
| `contexts.os.version` | `"14.5"` / `"11"` / `"13"` | 排查特定 OS 版本 bug |
| `contexts.device.family` | `"iPhone"` / `"iPad"` / `"Pixel"` / `"Desktop"` | 移动端较精确；桌面端通常仅 `"Desktop"` |
| `contexts.device.brand` / `.model` | 移动端有值，桌面端常 null | 同上 |
| `contexts.browser.name` / `.version` | `"Chrome"` / `"130.0"` / `"Safari"` / `"Firefox"` | 排查浏览器特定 bug |
| `contexts.runtime` | `"Chrome 130.0"` 等 | 同 browser 字段聚合 |
| `event.user.ip_address` | （被 `sendDefaultPii: false` 关掉，不上报） | — |
| `event.request.cookies` | （被 `sendDefaultPii: false` 关掉） | — |

### 3.6 自定义全局 Tag（initSentry 启动时一次性 setTag）

| Tag key | 取值 | 来源 | 用途 |
|---|---|---|---|
| `layout` | `"mobile"` / `"pc"` | `isMobileScreen()`（760px 视口断点） | 区分用户当前看到的布局 |
| `device` | `"mobile"` / `"desktop"` | `isMobileDevice()`（UA + userAgentData.mobile） | 区分物理设备类型（识别"iPad 横屏 = pc 布局但 mobile 设备"等错配） |
| `network_env` | `"mainnet"` / `"preview"` | `import.meta.env.VITE_NETWORK_ENV` | 与 `environment` 字段冗余但更便于 query 语法 |

initSentry 内调用：
实现位置：`src/shared/observability/sentry/initSentry.ts:199-201`。

> `layout` 在窗口缩放跨断点时不更新——Sentry tag 是 event 级粘性值，重新打 tag 需要在 resize handler 调用。考虑到错误监控不关心"用户改变窗口大小"，启动时一次性打 tag 即可。

### 3.7 环境策略

| `VITE_NETWORK_ENV` | enabled | Sentry environment 字段 |
|---|---|---|
| `mainnet` | true | `sodex-next-mainnet` |
| `preview` | true | `sodex-next-preview` |
| `testnet` / `bugfix` / `test` / undefined | **false** | — |

dev 默认禁用，本地验证需临时改 `.env.development` 加 `VITE_NETWORK_ENV=preview` + 真 DSN + 重启 dev server。

---

## 边界与约束

### 4.1 明确不做（v1 范围外）

- ❌ 全站 HTTP 错误上报（不接 ky `beforeError` 拦截器）
- ❌ React Error Boundary 接入
- ❌ Performance / Replay / Profiling
- ❌ Source map 上传（v1 与 sodex-web 当前状态对齐）
- ❌ 替换 `handleServiceError` 的 toast 行为（上报是叠加，不是替代）
- ❌ 改动 sodex-web 任何文件

### 4.2 分层约束

| 层 | 是否允许 import `shared/observability/sentry` |
|---|---|
| Infra | ❌（Infra 禁止副作用） |
| Domain | ❌（Domain 是纯函数） |
| Service | ❌（CLAUDE.md §9 禁止 import React / 做副作用） |
| Container | ✅（仅在 mutation `onError` 调用） |
| Page / Component | ❌（错误处理应经 Container hook 暴露） |
| App / main.tsx | ✅（initSentry 入口） |

### 4.3 已知限制 / 合规备注

- DSN 是公开值（设计可暴露在客户端），依赖 Sentry 后台 Allowed Domains 白名单防滥用——**已由 sodex-web 配过**（复用 project 直接继承）
- v1 stack trace 是压缩后函数名 + bundle 行号，排查靠 walletAction tag + extra 字段反推；`fingerprint` hint 已保证同业务错误正确 group
- Sentry 配额与 sodex-web 共享，sodex-web 流量上来后可能挤占 sodex-next 配额（v2 视情况拆 project）
- Bundle 体积：`@sentry/react` 含默认 integrations 约 +80KB gzip；关闭 BrowserTracing / Replay / ReplayCanvas 后约 +30KB gzip。PR 1 验收时跑 bundle analyzer 确认
- **隐私合规**：`signerAddress`（钱包地址）属于 pseudo-PII（链上公开但可关联用户身份），是**故意上报**用于个案排查。需在项目隐私政策的"错误监控数据"段落显式披露：上报至 Sentry 的字段包括钱包地址、connector 类型、错误信息；不上报 IP / cookies / JWT / 私钥 / 签名内容
- **隐私合规**：`extra.coinSymbol` / `extra.mode` / `extra.amount`（若上报）属于交易行为元数据，属同等披露范围

---

## 集成点

> **明确排除**：`useDepositAcceptState` 虽是 mutation，但 mutationFn 仅做 HTTP POST `/biz/config/deposit/status` 更新服务器接受标记，不涉及钱包签名 / 链上交易，**不接入上报**。

### 5.1 钱包签名 / 链上交易链路（用 `reportWalletError`）

| Container | walletAction tag | Infra 入口 |
|---|---|---|
| `useSubmitWithdraw` | `Withdraw.submit` | `withdrawSignInfra` + `sosoWithdrawInfra` |
| `useSubmitTransfer` | `Transfer.submit` | `transferService` |
| `useSubmitFlashDeposit` | `Deposit.flash` | `flashDepositInfra` |
| `useSubmitSwap` | `Swap.submit` | `swapService` |
| `useSubmitVaultClaim` | `Vault.claim` | `vaultClaimInfra` |
| `useSubmitVaultUnstake` | `Vault.unstake` | `vaultUnstakeInfra` |
| `useSubmitVaultWithdraw` | `Vault.withdraw` | `vaultWithdrawInfra` |
| `useSubmitVaultDeposit` | `Vault.deposit.<state>` | `vaultDepositInfra` |
| `useSubmitStake` | `Stake.submit` | `valueChainStake` |
| `useSubmitUnstake` | `Stake.unstake` | `valueChainUnstake` |
| `useSubmitClaim` (staking) | `Stake.claim` | `valueChainUnstake` |
| `useSubmitAirdropClaim` | `Airdrop.claim` | `airdropReceiptInfra` |

> **明确排除**：`useCustodyRefund`（纯 HTTP POST 后端退款请求）/ `useSubmitSwap`（Spot LIMIT IOC，本地 API Key 签 + POST，不弹钱包不上链）不在 v1 范围。理由同 §3.2 注：纯交易所 API 应走 v2 全站 HTTP 拦截器。

### 5.2 ExchangeAction 链路 — 不在 v1 范围

PR 3 阶段评估后回退。原表列出的 10 个 Container（`useSubmitOrder` / `useCancelOrder` / `useCancelAllOrders` / `useSubmitPerpsOrder` / `useSubmitTpsl` / `useClosePosition` / `useCloseAllPositions` / `useUpdateLeverage` / `useUpdateMarginMode` / `useAdjustMargin`）属于纯交易所 API 操作（本地 API Key 签 EIP-712 + POST），**不弹钱包、不上链、无跨边界资金流转**——错误 99% 来自后端业务规则。

留待 v2 通过全站 HTTP 错误拦截器一次性覆盖（在 `shared/infra/httpClient.ts` `beforeError` 钩子中），不按 mutation 逐个接入。

### 5.3 涉及修改的现有文件

| 文件 | 改动类型 | 说明 |
|---|---|---|
| `src/main.tsx` | 新增 2 行 | import + `initSentry()` 调用 |
| `package.json` | 新增 1 行 dep | `@sentry/react@^10.39.0`（与 sodex-web 锁同版本） |
| `.env.preview` | 新增 1 行 | `VITE_SENTRY_DSN=<与 sodex-web 同值>` |
| `.env.production` | 新增 1 行 | `VITE_SENTRY_DSN=<与 sodex-web 同值>` |
| `vite.config.ts` | 新增 1 行（可选） | `define: { "import.meta.env.VITE_APP_VERSION": JSON.stringify(pkg.version) }`；或在 build script 透传 env |
| §5.1 共 11 个 Container | 各 +3~10 行 | hook 引入 + `useWalletErrorReporter("X")` + `onError` 内单行上报；调 `ensureChain` 处替换为 `ensureChainWithBreadcrumb` 或在 callback 内调 `addChainAddBreadcrumb` |
| `useConnectWalletDialog` | +5 行 | hook + useEffect 监听 `wagmiError` |

### 5.4 集成模式（最小侵入，统一 hook）

**默认入口**：`useWalletErrorReporter(walletAction)` hook。Container 内 1 行调用替代 6 行 connector 解构 + 上报样板。

**典型 Container 接入模式（4 步）**：

1. hook 顶端：`const reportError = useWalletErrorReporter("<Action>");`
2. `onMutate`：用 `getCurrentOnChainCapability()` 快照 `signerAddress` 进 context
3. `mutationFn`：切链处把裸 `capability.ensureChain(...)` 替换为 `ensureChainWithBreadcrumb(capability, chainId, walletAction, options)`
4. `onError`：先调 `reportError(error, { signerAddress, chainId, extra })`，再调 `handleServiceError`（顺序无关，但通常先上报）

参考实现：`src/features/trade/containers/useSubmitWithdraw.ts:82,134,272`（hook / ensureChain / onError 三个锚点）。

**对 ExchangeAction 链路**：见 §5.2，v1 范围不包含，留 v2 全站 HTTP 拦截器覆盖。

### 5.5 钱包连接错误上报（独立路径）

`useConnect` 错误不在任何 mutation 路径里，在 `useConnectWalletDialog` 内通过 `useWalletErrorReporter` hook 监听：

实现：`src/features/auth/containers/useConnectWalletDialog.ts:143-147`。`useEffect` 监听 `useConnect().error`，先过 `isUserRejection` 滤掉用户拒签，剩余真实错误调 `reportConnectError(connectError)`。connect 阶段无 signerAddress / chainId，hook 自动带 connector tag。

用户取消（点 wagmi connector popup 的 reject）会触发 wagmiError，但被 `reportWalletError` 内白名单 / 关键词兜底过滤，不会真正上报。

### 5.6 切链 / 添加链 Breadcrumb — 已被 `ensureChainWithBreadcrumb` 封装

不再需要每个 mutationFn 手写 `Sentry.addBreadcrumb` 模板。统一使用 §3.3 提供的 `ensureChainWithBreadcrumb(capability, chainId, walletAction, options)`——参见 §5.4 示例。

适用范围：所有调用 `capability.ensureChain(...)` 的 Container（约 8 处，PR 2 / PR 3 各覆盖一部分）。

### 5.7 钱包底层 Infra 入口清单（参考，不修改）

> 这些是产生钱包错误的源头。Sentry 上报点**不**在这些文件，而在调用它们的 Container `onError`。此表用于 PR review 时核对：每个 Infra 入口至少被一个 mutation 覆盖。

**Sign 类（off-chain 签名，不上链）**：

| Infra 文件 | 行号 | 方法 | 用途 |
|---|---|---|---|
| `features/auth/infra/rpc/walletSignInfra.ts` | L16 | signMessage | 登录 nonce 签名 |
| 同上 | L35 | signTypedData | addAPIKey EIP-712 |
| 同上 | L86 | signTypedData | revokeAPIKey ExchangeAction |
| `features/trade/infra/rpc/permitSignInfra.ts` | L67, L109 | signTypedData | Permit Deposit / SOSO Deposit CallForPermit |
| `features/trade/infra/rpc/withdrawSignInfra.ts` | L77 | signTypedData | Withdraw CallForPermit |
| `features/vault/infra/chain/vaultClaimInfra.ts` | L74 | signTypedData | Vault Claim CallForPermit |
| `features/vault/infra/chain/vaultDepositInfra.ts` | L625 | signTypedData | Vault Deposit Permit |

**Send / Write 类（on-chain 交易）**：

| Infra 文件 | 行号 | 方法 | 用途 |
|---|---|---|---|
| `features/trade/infra/chain/sosoDepositInfra.ts` | L66 | sendTransaction | SOSO Deposit native transfer |
| `features/trade/infra/rpc/sosoWithdrawInfra.ts` | L47 | sendTransaction | SOSO Withdraw native transfer |
| `features/trade/infra/chain/flashDepositInfra.ts` | L170, L206 | sendTransaction | Flash Deposit |
| `features/vault/infra/chain/vaultDepositInfra.ts` | L263, L324, L333 | writeContract | Vault Deposit approve + 跨链桥 |
| `features/staking/infra/chain/valueChainStake.ts` | L45 | sendTransaction | Stake on ValueChain |
| `features/staking/infra/chain/valueChainUnstake.ts` | L67, L108 | sendTransaction | Unstake on ValueChain |

**切链入口（含 add fallback）**：

| 文件 | 关键函数 | 用途 |
|---|---|---|
| `src/lib/switchOrAddChain.ts` | `switchOrAddChain(provider, chainId, { onAddingChain })` | EIP-3085 4902 兜底，自调 `wallet_addEthereumChain` 后重试 `wallet_switchEthereumChain`；被 `OnChainCapability.ensureChain` 包装 |

每个 Infra 内的 `mapWalletError(error)` 已把钱包原生异常归一为 `InfraError` 钱包子集（`SIGNATURE_REJECTED` / `CHAIN_MISMATCH` / `SIGNATURE_TIMEOUT`），Container 不必再写关键词匹配。

---

## 验收标准

### 6.1 PR 1 — 核心模块 + 初始化

- [ ] `src/shared/observability/sentry/` 9 个文件齐全（含 `useWalletErrorReporter.ts` / `ensureChainWithBreadcrumb.ts`）
- [ ] `@sentry/react@^10.39.0` 进 `dependencies`
- [ ] `src/main.tsx` 含 `installRecorder() → initSentry() → createRoot.render` 三步顺序
- [ ] `initSentry` 包含 `inited` guard（HMR 防重复）+ `release` 字段 + `integrations` filter（关 BrowserTracing / Replay / ReplayCanvas）+ `beforeBreadcrumb`（过滤 fetch / xhr）+ `beforeSend` 内 fingerprint hint
- [ ] dev 启动 console 无 Sentry 输出（enabled=false 不打 warn）
- [ ] 临时改 dev env `VITE_NETWORK_ENV=preview` + 注入真 DSN，控制台调 `reportError("smoke test")`：
  - [ ] Sentry Dashboard 能看到事件
  - [ ] `environment` 字段显示 `sodex-next-preview`
  - [ ] `release` 字段显示版本号（非 `"unknown"`）
  - [ ] event 全局 tag 含 `layout` / `device` / `network_env`
  - [ ] event `contexts.os.name` / `contexts.browser.name` 由 SDK 自动写入
- [ ] 上报事件中所有 extras / breadcrumbs / request 已脱敏（无私钥 / JWT / token / 敏感字段明文）
- [ ] event 不含 fetch / xhr breadcrumb（被 beforeBreadcrumb 过滤）
- [ ] **Bundle 体积验收**：`pnpm build` 后用 bundle analyzer 检查 `@sentry/react` 占比，主 chunk gzip 增量 ≤ 35KB（无 BrowserTracing / Replay）

### 6.2 PR 2 — 5 关键链路接入 + 错误场景验证（合并拦截点）

接入 Container：`useSubmitWithdraw` / `useSubmitTransfer` / `useSubmitFlashDeposit` / `useSubmitVaultClaim` / `useSubmitVaultWithdraw`

**同步接入**（这俩属于"独立路径"非 mutation，必须随 PR 2 一起）：
- `useConnectWalletDialog` 内监听 `useConnect.error` → `reportWalletError({ walletAction: "Wallet.connect" })`（§5.5）
- 5 个 Container 内 `ensureChain.onAddingChain` 回调加 `Sentry.addBreadcrumb`（§5.6）

**每条链路必须跑通 3 种错误场景**（=15 项验证）：

| 链路 ↓ \ 场景 → | 用户钱包点 reject | 断网 / 切错链 | 后端 5xx |
|---|---|---|---|
| Withdraw | **不**上报 | 上报，walletAction=`Withdraw.submit`，fingerprint group | 上报，extra 含 cause |
| Transfer | **不**上报 | 上报，walletAction=`Transfer.submit` | 上报，extra 含 cause |
| FlashDeposit | **不**上报 | 上报，walletAction=`Deposit.flash` | 上报，extra 含 cause |
| VaultClaim | **不**上报 | 上报，walletAction=`Vault.claim` | 上报，extra 含 cause |
| VaultWithdraw | **不**上报 | 上报，walletAction=`Vault.withdraw` | 上报，extra 含 cause |

**fingerprint 验收**：在 Sentry 后台 Issues 列表确认——同一个 walletAction（例如 `Withdraw.submit`）+ 同一个 `exception.type`（例如 `SIGNATURE_TIMEOUT`）下，所有 event 被 group 到**同一个 issue**（不是因 build hash 不同被拆成多个）。

**API_KEY_EXPIRED 验收**：任意一条链路触发 API_KEY_EXPIRED 时，event 上报且 `level=warning`（不是 error），dashboard 能按 level 区分。

### 6.3 PR 3 — 剩余 Container 批量接入

- [ ] §5.1 表格剩余 6 个 Container 全部接入（VaultUnstake / VaultDeposit / Stake / Unstake / Claim staking / AirdropClaim）—— 上报模式与 PR 2 一致
- [ ] 剩余调 `ensureChain` 的 mutationFn 内补 `Sentry.addBreadcrumb`（§5.6 模板）
- [ ] 集成模式与 PR 2 一致（无新增模板）
- [ ] 抽样检查 2 条链路（如 useSubmitOrder + useSubmitStake）event 在 Sentry 后台 walletAction/exchangeAction tag 准确

---

## 验收场景

### 场景 1：Happy Path — 普通用户因切错链导致 Withdraw 失败，oncall 能在 Sentry 定位

- **Given**
  - 用户钱包：MetaMask，当前连接 Base 链（chainId=8453），signerAddress=`0xABC...`
  - 当前 session：wallet-session，已 enable trading
  - 用户操作：在 Withdraw modal 输入 100 USDC 提到 ValueChain，点 Confirm
  - 业务状态：用户未提前切到 ValueChain，且 wallet 不支持 wallet_switchEthereumChain 自动切（需用户手动确认）
  - Sentry 环境：`VITE_NETWORK_ENV=mainnet`，DSN 已配，environment=`sodex-next-mainnet`
- **When**
  - `useSubmitWithdraw` mutationFn 内 `onChain.ensureChain(VALUE_CHAIN_MAINNET.id)` 抛出 `CHAIN_MISMATCH`，被 Service mapInfraError 转译为 `ServiceError({ type: "UNKNOWN", cause })`，进入 mutation `onError`
- **Then**
  - Sentry Dashboard 收到 1 条 event
  - event tag：`walletAction=Withdraw.submit`, `wallet.connectorName=MetaMask`, `wallet.signerAddress=0xABC...`, `wallet.chainId=88` (ValueChain target id)
  - event extra：`{ coinSymbol: "USDC", mode: "regular", accountType: "Funding" }`，不含明文私钥 / JWT
  - event environment：`sodex-next-mainnet`
  - UI 仍按既有逻辑 toast "Request failed, please try again"（行为不变）

### 场景 2：边界 — 用户在钱包弹窗点 Reject，不应上报

- **Given**
  - 用户钱包：MetaMask，已在 ValueChain
  - 用户操作：Withdraw 100 USDC，点 Confirm
  - mutationFn 已走到 `signWithdrawCallForPermit` → 钱包弹出 EIP-712 签名 popup
- **When**
  - 用户在 MetaMask 弹窗点 Reject（code=4001 / message="User rejected the request"）
  - Infra `withdrawSignInfra:mapWalletError` 归一为 `InfraError({ type: "SIGNATURE_REJECTED" })`
  - Service `mapInfraError` 转译为 `ServiceError({ type: "SIGNATURE_REJECTED" })`
  - mutation `onError` 触发
- **Then**
  - **Sentry 收到 0 条 event**（`reportWalletError` 内 USER_CANCEL_DISCRIMINATORS 白名单命中 SIGNATURE_REJECTED 直接 return）
  - UI 仍按既有逻辑 toast "Transaction has been canceled"
  - console 无任何 Sentry 输出

### 场景 3：边界 — Service 漏归一化、Container 拿到裸 Error 也能识别用户取消

- **Given**
  - 假设某 Service（如未来新增）漏掉 `try/catch` + `mapInfraError` 包装，直接把 viem 抛出的 `UserRejectedRequestError` 透传给 Container
  - 错误形如 `Error { name: "UserRejectedRequestError", message: "User rejected the request", code: 4001 }`
- **When**
  - mutation `onError` 拿到该裸 Error
  - 调用 `reportWalletError(error, { walletAction: "Withdraw.submit", ... })`
- **Then**
  - `reportWalletError` 先查 `error.type` 白名单 → 未命中（裸 Error 没有 `.type`）
  - 走兜底关键词匹配：`error.message.toLowerCase()` 包含 `"user rejected"` → 视为用户取消，**不上报**
  - 同样 0 条 event 到 Sentry
  - 这条路径作为防御，不依赖于 Service 是否归一化

### 场景 4：边界 — 用户关闭 AuthStepsModal（EXCHANGE_CAPABILITY_MISSING），不上报

- **Given**
  - 用户操作 Spot withdraw 100 USDC（accountType=Spot 需要 Spot→Funding 过户）
  - `ensureExchangeCapability({ mode: "modal", ... })` 弹出 AuthStepsModal 要求签 enable trading
- **When**
  - 用户点 X 关闭 modal
  - `ensureExchangeCapability` 内部 throw `{ type: "EXCHANGE_CAPABILITY_MISSING" }`
  - mutation `onError` 触发
- **Then**
  - **Sentry 收到 0 条 event**（USER_CANCEL_DISCRIMINATORS 白名单命中）
  - `handleServiceError` 也按既有逻辑静默（早 return）
  - 用户体验：仅 modal 关闭，无 toast、无报错——与现状一致

### 场景 5：Happy Path — 移动端 Android Chrome 用户切链失败，dashboard 能按 OS / device / connector 分桶

- **Given**
  - 用户设备：Android 手机 + Chrome 130，UA 含 `"Android 13; Pixel 7"`
  - 用户钱包：通过 WalletConnect 连接到外部钱包（connector.id=`walletConnect`, name=`WalletConnect`, type=`walletConnect`）
  - 当前在 mobile 布局（视口 < 760px），isMobileScreen() = true、isMobileDevice() = true
  - 用户操作：Vault Claim
- **When**
  - mutationFn 内调 `onChain.ensureChain(VALUE_CHAIN_MAINNET.id)`，外部钱包未添加 ValueChain
  - `onAddingChain` 回调触发 → `Sentry.addBreadcrumb({ category: "wallet", message: "wallet_addEthereumChain triggered", ... })`
  - 用户在钱包中拒绝添加链，`wallet_addEthereumChain` 抛非 4001 错误
  - Infra `mapWalletError` 归类为 `SIGNATURE_TIMEOUT`（兜底）→ Service → ServiceError → onError
  - `reportWalletError` 上报
- **Then**
  - Sentry 收到 1 条 event
  - event tags：`walletAction=Vault.claim`, `connector.id=walletConnect`, `connector.type=walletConnect`, `layout=mobile`, `device=mobile`, `chainId=88`
  - event `contexts.os.name=Android`、`contexts.os.version=13`、`contexts.device.family=Pixel`、`contexts.browser.name=Chrome`（SDK 自动）
  - event breadcrumbs 含一条 `wallet_addEthereumChain triggered` 的 info 记录（在错误前）
  - oncall 在 dashboard 按 `connector.id` group by 能直接看到"WalletConnect 切链失败率 vs MetaMask 切链失败率"对比；按 `os.name` 看 Android vs iOS 差异

### 场景 6：边界 — 钱包连接 popup 用户取消，不上报

- **Given**
  - 用户在 ConnectWalletDialog 选 MetaMask
  - `useConnect.connect({ connector })` 触发 MetaMask popup
- **When**
  - 用户在 popup 点 Reject → `useConnect` 写入 `error = UserRejectedRequestError`
  - `useConnectWalletDialog` 内 `useEffect` 监听到 wagmiError，调 `reportWalletError(wagmiError, { walletAction: "Wallet.connect" })`
- **Then**
  - `reportWalletError` 内白名单未命中（裸 Error 没 `.type`）→ 走兜底关键词匹配 → 命中 `"user rejected"` → 视为用户取消
  - **Sentry 收到 0 条 event**
  - UI 仍按既有 ConnectWalletDialog 逻辑展示（错误已 reset 或 dialog 内提示）

### 场景 7：边界 — sanitize 失败时不丢事件，仅丢敏感载体

- **Given**
  - 钱包抛出一个深度 >10 层的循环引用 Error 对象（罕见但理论可能）
  - `reportWalletError` 调到 `Sentry.captureException`，进入 `beforeSend`
- **When**
  - `sanitize.ts` 在递归到 >MAX_DEPTH=10 时正常返回占位符；但某个 sanitize 步骤本身因边界 case 抛出（例如循环引用未被 WeakSet 兜住）
- **Then**
  - `beforeSend` 的外层 `try/catch` 接住异常
  - event 保留核心：exception type / message / stack（已是 mapInfraError 归一化后值，本身已脱敏）
  - event extra / contexts / breadcrumbs / request body 被清空，只剩 `{ sanitize_error: <错误信息> }`
  - event 仍上报到 Sentry——保证错误监控可用性不被 sanitize bug 反过来打掉
  - 后续可在 Sentry 后台按 `sanitize_error` 字段筛出这类 case 修 sanitize 逻辑

---

## 落地步骤

### 8.1 PR 1 — 核心模块 + 初始化

文件清单：
- 新增 `src/shared/observability/sentry/{index,initSentry,reportError,reportWalletError,useWalletErrorReporter,ensureChainWithBreadcrumb,sanitize,isUserCancel}.ts`
- `src/main.tsx` 加 `initSentry()` 调用
- `package.json` + `pnpm-lock.yaml` 加 `@sentry/react@^10.39.0`
- `.env.preview` / `.env.production` 加 `VITE_SENTRY_DSN=<sodex-web 同值>`

人工准备项（PR 创建前完成）：
- 从 sodex-web 仓库或 Sentry 后台获取 DSN（不要硬编码到代码里）
- 确认 Sentry 后台 Allowed Domains 已包含 `sodex.dev` / `sosovalue.com` 及其子域（sodex-web 应已配过；新增 sodex-next 部署域名时一并检查）

按 §6.1 验收。

### 8.2 PR 2 — 高优先级钱包链路接入

§5.1 前 5 个 Container：Withdraw / Transfer / FlashDeposit / VaultClaim / VaultWithdraw。

按 §6.2 验收（5 链路 × 3 错误场景）。

### 8.3 PR 3 — 剩余钱包 Container 批量接入

§5.1 剩余 6 个 Container（VaultUnstake / VaultDeposit / Stake / Unstake / Claim staking / AirdropClaim）。`useCustodyRefund` / `useSubmitSwap` 不在范围（见 §5.1 排除说明）。`useSubmitVaultDeposit` 经评估涉及 ensureChain 服务内部调用 → 配套 service callback 内调 `addChainAddBreadcrumb`。3 个 staking 含 ensureChain 替换为 `ensureChainWithBreadcrumb`。

按 §6.3 验收。

---

## 可行性 / 稳定性 / 可靠性评估

| 维度 | 评估 | 依据 |
|---|---|---|
| 可行性 | ✅ 高 | sodex-web sentry.ts 几乎纯函数；sodex-next 适配仅替换 `stores.user` → context 参数；不触碰 Infra/Service 层，零分层风险 |
| 稳定性 | ✅ 高 | `@sentry/react` 配额耗尽 / 网络失败时 SDK 静默丢弃；`beforeSend` 已带 try/catch 兜底；初始化失败仅 `console.warn` |
| 可靠性 | ✅ 高 | 错误事件不受 sampleRate 限制 100% 上报；`sendDefaultPii: false`；Prompt Injection 过滤抵御 LLM 时代敏感数据外泄 |
| 复杂度 | ✅ 低 | 总新增 ~400 行（sanitize 200 + initSentry 100 + reportXxx 各 50）；Container 单点集成每个 ≤ 8 行 |
| 回滚成本 | ✅ 极低 | 单 commit revert；目录隔离不影响业务模块 |
| 风险点 | ⚠️ | (a) Sentry 配额与 sodex-web 共享（v2 视流量拆 project） (b) v1 堆栈为压缩态，依赖 walletAction tag + extra 反推位置 (c) connectorName 在 connectorless 状态为 undefined（null check 已覆盖） |

---

## 未决项（v2）

- [ ] sodex-web 准备上线时，双项目同步加 source map 上传（`@sentry/vite-plugin` + CI secret），保持 dashboard 堆栈展示一致
- [ ] 监测 Sentry 配额，sodex-web 流量上来后视情况拆分独立 project
- [ ] 接入 axios / ky `beforeError` 全量 HTTP 错误上报（业务跑稳后评估）
- [ ] 接入 React Error Boundary（视 Sentry 自动捕获的 unhandled 是否足够）
- [ ] 隐私政策更新：将"错误监控"段落补全，列入 Sentry 上报字段清单（钱包地址 / connector / OS / 浏览器 / 错误信息），与项目 legal 协同

> **注**：本文档前期由 `merge-spec-history.sh` 把 4 份 spec 合并生成，曾混入 `add-sentry.md` 的"思考步骤"和 `bugfix-vault-toast.md` 的 vault JSON 示例。这些与本 feature 无关的内容已剥离；vault toast bug 见 `.claude/kit/spec/bugfix-vault-toast.md`。

---

## 更新记录

- 2026-05-26 初始版本
