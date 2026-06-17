# Legacy Notes: VaultDepositDialog

> 按 Step 0.5.4 新模板(含交互语义 + 初始化规则)归档,2026-04-23。
> 作为首个样例,未来其他迁移 feature 参照本文档结构。

## 来源
- 主文件: `sodex-web/src/pages/vault/components/modals/funding/deposit/index.tsx`(861 行)
- 关联文件:
  - `./transaction/Preview.tsx`
  - `./transaction/Trading.tsx`
  - `./AccountSelector.tsx`
  - `./BaseAccountInput.tsx`
  - `./VaultPreTradeButton.tsx`

## 结构

### 顶层视图路由(idle / preview / trading)
- `tradingStatus === "preview"` → `<Preview>`
- `tradingStatus === "trading"` → `<Trading>`
- else → idle form
- **VaultDepositDialog 仅负责 idle form**;Preview / Trading 独立组件

### Idle Form 区域(从上到下)
| 区域 | 说明 |
|---|---|
| ChainSelector | 链选择(Base / ValueChain)— 下拉 |
| Must to Know(Alert) | 独立 warning Alert + chevron(不嵌套在 TokenSelector) |
| TokenSelector | MAG7 / sMAG7 下拉(带 logo) |
| Amount Input | BASE_ETH → BaseAccountInput;VALUE_CHAIN → AccountSelector |
| Fees / You receive / Rate | 3 行 label-value |
| VaultPreTradeButton | 主 CTA(Deposit / Enable Trading / Connect Wallet / Switch Network) |
| Get MAG7.ssi | 外框按钮,跳 `/trade/spot` |
| Get Stuck? Click to help | 外链橙色文字 + external icon(`!isCorrectNetwork` 时显示) |

## 响应式切换
- 方式:`openResponsive` Shell 自动切 PC(Dialog) / Mobile(Drawer)
- Mobile 内容区无特殊 layout 差异(Figma mobile node 434:46140 实为 trading 态,非 idle)

## 样式钩子(位置 + 理由)
- `opacity-0 transition-opacity duration-200` on form 根:`isLoading=true` 时淡出,Skeleton 覆盖
- `bg-bg-warning-tertiary-alt + border-border-warning + text-text-warning`(Alert Must to know 一体的 warning 色板)
- `rounded-md`(Network/Coin/Amount/主次按钮,6px);Alert `rounded`(4px)
- `h-3 w-px bg-border-primary`(Amount 内 divider,不用 border)

---

## 交互语义(弹窗/下拉/折叠/输入类,本模块关键)

| 元素 | Figma 外观 | 老代码行为(文件:行) | 新项目采用 |
|---|---|---|---|
| **Chain 选择器**(Network row) | black bg row + Base + chevron-down | L593 `<ChainSelector.../>` + `setSelectedChain(value)` 下拉 | `shared/Dropdown` 受控 open + chevron rotate-180 |
| **Coin 选择器** | black bg row + logo + MAG7.ssi + chevron | 老项目 FundsSelector Controller 模式 | `shared/Dropdown` + `TokenLogo` + chevron rotate |
| **Must to Know** | warning Alert + chevron-down | L621 `setIsMustKnowExpanded(!v)` + `<Collapse in>` 包 3 行;Figma 无 Show/Hide 文字 | `shared/Alert` + `shared/Collapse` + 受控 state,**去掉 Show/Hide 文字**(对齐 Figma) |
| **Max 按钮** | 橙色文字 + 左侧 `| divider` | L245 `autoFillAmount(maxBalance)` | `<button onClick={onMax}>` 橙色 + `w-px h-3 bg-border-primary` divider |
| **Get Stuck? link** | 橙色文字 + external icon | 仅 `!isCorrectNetwork` 显示 | `<a target=_blank>` + `ArrowSquareOut` |
| **Close(x-close)** | 圆形按钮 | Shell 提供 | 由 `openResponsive` 注入,**不写在内容** |
| **Deposit 主按钮** | 白底黑字 h-10 | submit form | `<Button>` + `bg-bg-light-primary text-text-primary-alt` |
| **Get MAG7.ssi 次按钮** | 白边 white text h-10 | `window.open("/trade/spot")` | `<Button variant=outlined>` |

---

## 初始化规则(mount / 默认值 / auto-fill / skeleton)

### 默认值

| 字段 | 默认值来源(老代码:行) | 依赖 | 备注 |
|---|---|---|---|
| `selectedChain` | L407-413 `defaultChain ?? (isNewUser ? "BASE_ETH" : "VALUE_CHAIN")` | `props.defaultChain` / `isNewUser` | mount useEffect 触发 |
| `token` | L63,121-127 `defaultToken = IN_COIN_SYMBOL`(vMAG7.ssi → MAG7)| `props.defaultToken` + `tokenList` | mount 时立即设 |
| `selectedAccount` | L320-338 新用户→EVM-Funding;老用户→余额最大的账户 | `mag7Data.valueChain.accounts / userId` | 链/token 切换时重算 |
| `amount` | 空,由 auto-fill 填 Max | — | — |
| `from`(Value 链)| SPOT(默认,用户可切 EVM-Funding) | — | — |

### Auto-fill Max

| 触发条件 | 行 | 依赖 |
|---|---|---|
| chain 变化 | L226-233 `selectedChain?.chain === "BASE_ETH"` → autoFillAmount(baseBalance) | selectedChain |
| token 变化(ValueChain) | L265 `autoFillAmount(valueChainBalance)` | token + mag7Data |
| token 切换到 MAG7/sMAG7 | L281-287 | token |
| account 切换 | L299-302 | selectedAccount |
| handleTokenSwitchForValueChain | L349 | token + bestAccount |

**防覆盖守卫**(history 20260306):
- `tradingStatus !== "idle"` → 全部 return
- `userHasEditedRef.current === true` → return(用户手动输入过,不覆盖)
- `isNewUserRef` 快照锁(防 isNewUser 在 Enable Trading 完成后变化触发二次 auto-fill)

### Skeleton isLoading 触发

| 触发条件 | 行 | 备注 |
|---|---|---|
| mag7Data.isLoading | (container) | 余额链上 + Spot/Funding 合成未完成 |
| tokenList 未加载 | (container) | useTokenConfig 未 resolve |
| isNavLoading | L491 | NAV 合约读取 |
| balance query isLoading | L712/828 | 透传给 BaseAccountInput/AccountSelector |

Skeleton 结构:Must to know / Network / Coin / Amount(Base 或 + 账户列表)/ Fees 3 行 / 按钮 2 个 / Help 文字,全屏覆盖 + `z-10 absolute inset-0`。

---

## 边界 / 状态
- **空 amount**:`You receive = "--"`;`Rate` 保留;`Fees = "$0.00"` 常显
- **fees 原始价**:传 `feesOriginalDisplay` 展示 strikethrough(SoDEX 覆盖场景)
- **isNewUser**:Spot 账户禁用(`AccountSelector.accounts[].disabled = true`);按钮文案 "Enable Trading"
- **Chain mismatch**:`!isCorrectNetwork` 时按钮变 "Switch Network";`Get Stuck?` 链接出现
- **Amount 超精度**:ROUND_DOWN 到 4 位(`VAULT_DEFAULT_DECIMAL`)
- **Amount 0 或小于 min**:按钮 disabled;helperText 提示

---

## Figma ↔ Legacy 冲突

| 位置 | Figma | Legacy | 裁决 |
|---|---|---|---|
| Must to Know 位置 | 独立 Alert(TokenSelector 之前) | 嵌在 TokenSelector Controller 内 | **按 Figma**:独立区域 |
| Must to Know 文案 | 只 chevron,无 Show/Hide 文字 | "Show" / "Hide" + chevron | **按 Figma**:去掉文字 |
| Network/Coin 垂直堆叠 | column gap-4 | column | 一致 ✅ |
| Fees 区域外层容器 | 独立 section + radius 6px | 无外层容器 | **按 Figma**:带容器 |
| 按钮主色 | `bg-bg-light-primary` + 反色文字 | 老项目 `#3E3E43` 暗底 | **按 Figma** |

---

## i18n(Phase 1 硬编码占位,Phase 2 需对接)
- title: `vault:deposit_to_slp_vault` → "Deposit to SLP Vault"
- description: `vault:deposit_funds_to_sodex_liquidity_provider`
- Must to Know 标签: `common:must_to_know`
- Must to Know 三行正文:
  - `vault:vault_depositing_will_auto_stake_mag7` → "Vault depositing will auto-stake MAG7.ssi to sMAG7.ssi."
  - `vault:withdrawals_require_unstaking_14_days_lock` → "Withdrawals require unstaking (14-days lock period) to revert to MAG7.ssi."
  - `vault:holding_smag7_ssi_participates_ssi_airdrops` + embed `https://ssi.sosovalue.com` 可点击
- Help link: `common:get_stuck_click_to_help`
- 57 个完整 i18n key 详见 `interaction-spec.md §14.2`

---

## 补充:本次新归档的意义

本文档是 Step 0.5.4 新模板(含 **交互语义 + 初始化规则** 两张必填表)的**首个实际样例**。

- 对比原版(仅有 结构 / 响应式 / 样式钩子 / 边界 / Figma 冲突)多出 2 个关键章节
- 对应 deposit 迁移过程中踩到的两类盲区(onClick/Dropdown 语义错判 + default value/auto-fill 全漏)
- 其他 feature 迁移(claim/unstake/withdraw 已完成的可补档,后续 trade/swap/perps 必填)请按本文档的层级归档
