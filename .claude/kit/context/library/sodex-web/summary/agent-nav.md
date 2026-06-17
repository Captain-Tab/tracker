# Agent 导航索引

> 本文件为 AI Agent 提供导航，将 overview.md 中的概念映射到具体的 reference 文档。
> 执行任务前：先读 overview.md 建立全局认知，再按需加载下方链接的详细文档。

---

## 账户模型

| 概念 | 深入文档 | 何时加载 |
|------|---------|---------|
| Funding↔Spot↔Perps 划转规则 | reference/trade/trade-transfer-guide.md | 修改 Transfer 弹窗、账户间资金移动 |
| Funding 链上余额管理 | reference/core/usefundingtoken-guide.md | 修改币种列表、余额显示、充值币种过滤 |
| 地区限制对账户操作的影响 | reference/global/global-restrict-guide.md | 涉及入金/交易限制 |

## Token 模型

| 概念 | 深入文档 | 何时加载 |
|------|---------|---------|
| SOSO/WSOSO 币种数据源与注入逻辑 | reference/core/usefundingtoken-guide.md | 修改币种列表、SOSO 特殊处理 |
| MAG7/sMAG7/SLP 的 Vault 内转换 | reference/vault/vault-deposit-guide.md | 修改 Vault 充值、stake/unstake |
| 币种黑白名单过滤 | reference/trade/trade-blacklist-guide.md | 修改币种可见性规则 |

## Deposit（充值）

| 概念 | 深入文档 | 何时加载 |
|------|---------|---------|
| Regular/Flash 双路径实现 | reference/trade/trade-deposit-guide.md | 修改充值流程、添加新充值方式 |
| 币种列表与余额注入 | reference/core/usefundingtoken-guide.md | 修改可充值币种、余额显示 |
| Vault Deposit 多步状态机 | reference/vault/vault-deposit-guide.md | 修改 Vault 充值流程 |

## Withdraw（提现）

| 概念 | 深入文档 | 何时加载 |
|------|---------|---------|
| 提现 5 步流程与 EIP-712 签名 | reference/trade/trade-withdraw-guide.md | 修改提现逻辑 |
| Vault Withdraw 与冷却期 | reference/vault/vault-withdraw-guide.md | 修改 Vault 赎回流程 |
| Vault Claim 领取 | reference/vault/vault-claim-guide.md | 修改冷却期后的领取逻辑 |

## Transfer（划转）

| 概念 | 深入文档 | 何时加载 |
|------|---------|---------|
| 三账户间划转规则与邮箱用户限制 | reference/trade/trade-transfer-guide.md | 修改划转弹窗、账户/币种选择逻辑 |
| Vault Unstake 智能转账（自动补差额） | reference/vault/vault-unstake-guide.md | 修改 unstake 流程、余额不足处理 |

## Vault 生命周期

| 概念 | 深入文档 | 何时加载 |
|------|---------|---------|
| Deposit：Base 跨链 → Value Chain 操作 | reference/vault/vault-deposit-guide.md | 修改充值状态机 |
| Unstake：sMAG7 → MAG7 + 智能转账 | reference/vault/vault-unstake-guide.md | 修改 unstake 逻辑 |
| Claim：冷却期后领取 | reference/vault/vault-claim-guide.md | 修改领取流程 |
| Withdraw：赎回到外部钱包 | reference/vault/vault-withdraw-guide.md | 修改 Vault 提现 |
| Vault SLP 页面（指标面板+4Tab+图表+分享） | reference/vault/vault-page-guide.md | 修改 Vault 页面布局、Tab、图表、Activity |

## 鉴权模型

| 概念 | 深入文档 | 何时加载 |
|------|---------|---------|
| 钱包连接与用户初始化 | reference/user/user-auth-core-guide.md | 修改登录流程、钱包连接 |
| Enable Trading 签名授权 | reference/user/user-auth-enable-guide.md | 修改签名流程、Stay Signed In |
| 私钥存储与检查机制 | reference/user/user-auth-private-key-guide.md | 修改私钥管理、存储策略 |
| WalletConnect 签名交互文案 | reference/shared/wallet-mobileApprove-guide.md | 修改签名提示 UI |

## 交易相关

| 概念 | 深入文档 | 何时加载 |
|------|---------|---------|
| 费率展示与 Tier 系统 | reference/trade/trade-feerate-guide.md | 修改费率显示 |
| 持仓管理 | reference/trade/trade-position-guide.md | 修改持仓相关逻辑 |
| 币对切换与市场面板 | reference/trade/trade-market-switch-guide.md | 修改币对搜索、市场分类、Ticker 指标 |
| 盘口深度展示（现货+合约） | reference/trade/trade-orderbook-guide.md | 修改 OrderBook 组件、深度合并、Tooltip |
| 现货下单表单 | reference/trade/trade-spot-orderform-guide.md | 修改现货下单逻辑 |
| PC 端合约下单表单 | reference/trade/trade-futures-orderform-guide.md | 修改 PC 合约下单、U/币本位 |
| 移动端合约下单表单 | reference/trade/trade-futures-orderform-mobile-guide.md | 修改移动端合约下单、TP/SL |
| WebSocket 数据管道 | reference/trade/trade-ws-data-guide.md | 修改 WS 消息处理、聚合器、实时数据流 |
| 手续费阶梯等级页面 | reference/trade/trade-steprate-guide.md | 修改费率等级页面、申请专业费率、等级展示 |

## 积分系统

| 概念 | 深入文档 | 何时加载 |
|------|---------|---------|
| SoPoints 积分页面（Guest/User 视图、Tier 等级、Weekly 表格） | reference/points/points-page-guide.md | 修改积分页面、等级样式、周表现数据 |

## API Key 管理

| 概念 | 深入文档 | 何时加载 |
|------|---------|---------|
| API Key 全生命周期（资格验证/创建/调整/删除） | reference/apikey/apikey-page-guide.md | 修改 API Key 页面、资格条件、密钥操作 |

## 区块浏览器

| 概念 | 深入文档 | 何时加载 |
|------|---------|---------|
| Explorer 区块浏览器（WS实时+HTTP历史、双链切换、交易详情） | reference/explorer/explorer-page-guide.md | 修改区块/交易展示、WS连接、搜索逻辑 |

## 排行榜

| 概念 | 深入文档 | 何时加载 |
|------|---------|---------|
| 交易排行榜与分享功能 | reference/leaderboard/leaderboard-ranking-guide.md | 修改排行榜页面、排名展示、分享 |

## 交易页底部面板

| 概念 | 深入文档 | 何时加载 |
|------|---------|---------|
| 多功能 Tab 面板（资产/持仓/订单/历史） | reference/trade/trade-position-guide.md | 修改交易页底部面板、Tab 切换、数据刷新 |

## 质押相关

| 概念 | 深入文档 | 何时加载 |
|------|---------|---------|
| SOSO 质押流程 | reference/stake/stake-soso-guide.md | 修改 SOSO 质押 |
| 质押页面展示 | reference/stake/stake-page-guide.md | 修改质押页 UI |

## Pitfalls

| 场景 | 深入文档 | 何时加载 |
|------|---------|---------|
| Trade 费率 MobX 响应性问题 | pitfalls/trade-feerate-mobx.md | 修改 MobX store 相关的响应式数据 |
| MobX Store isMobileScreen 时序问题 | pitfalls/mobx-store-timing-isMobileScreen.md | 使用 isMobileScreen 或 Store 初始化时序相关 |

---

## 加载策略

按需加载，不要无脑全读。根据任务类型判断需要哪些上下文：

| 场景 | 加载内容 |
|------|---------|
| 单模块改动（如改 Transfer 弹窗） | 直接加载对应 reference 文档，不需要 overview |
| 跨模块改动（如涉及 Vault + Transfer） | 读 overview 中相关章节 + 涉及模块的 reference |
| 遇到陌生概念（如不确定 WSOSO 是什么） | 读 overview 中对应章节 |
| 遇到 bug | 先查 pitfalls/ 目录 |

**原则：能用 reference 解决的不加载 overview，能加载一个章节的不读全文。**
