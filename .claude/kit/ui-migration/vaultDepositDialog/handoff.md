# UI 迁移交接: VaultDepositDialog

- 组件路径: src/features/vault/components/dialogs/VaultDepositDialog/index.tsx
- Props interface: VaultDepositDialogProps
- 弹窗场景: true
- Figma 来源: https://www.figma.com/design/Nd6fZEIJS8bjCvJxBZVQGi/SoDEX?node-id=430-35403 (PC) + 434-46140 (Mobile node 实为 trading 态)
- 时间: 2026-04-23

## 理解度自检

| 维度 | Legacy | 新实现 | 对齐 |
|---|---|---|---|
| 顶层视图路由 | idle/preview/trading 三态 | 只渲染 idle form | ✅ 符合 Phase 1 要求 |
| Must to Know 位置 | 嵌在 TokenSelector Controller | 独立 Alert 区域(按 Figma) | ✅ |
| 选择器布局 | 垂直堆叠 | 垂直堆叠 | ✅ |
| 输入区切换 | BASE_ETH→BaseAccountInput / VALUE_CHAIN→AccountSelector | ReactNode slot `inputArea` | ✅ |
| Fees/You receive/Rate | 3 LabelValue 行 | 3 LabelValue 行 | ✅ |
| 按钮组 | Deposit + Get MAG7.ssi | Deposit + Get MAG7.ssi | ✅ |
| HelpLink 条件渲染 | !isCorrectNetwork | showHelpLink prop | ✅ |
| Skeleton 覆盖 | VaultDepositSkeleton overlay | 内联占位 Skeleton | ⚠️ Phase 2 替换为真实骨架 |
| i18n | react-i18next | 硬编码英文占位 | ⚠️ Phase 2 接入 i18n |
| Mobile Figma | 434:46140 为 trading 态非 idle | 响应式由 Shell 处理 | ⚠️ Mobile idle 无 Figma 参考 |

## 已知未抽取的 slot(Phase 1 留白)

1. **inputArea**: 需要 Phase 2 Container 根据 `selectedChainType` 注入 `<BaseAccountInput>` 或 `<AccountSelector>`
2. **Must to Know 内容文案**: 硬编码英文占位,Phase 2 替换为 i18n keys(vault:vault_depositing_will_auto_stake_mag7 等)
3. **Help link 文案**: "Get Stack? Click to help" → i18n key
4. **Skeleton**: 内联占位版本,Phase 2 替换为真实的 VaultDepositSkeleton 组件
5. **feesOriginalDisplay**: 旧代码计算 `+amount * 0.00005`,Phase 2 Container 传入

## 悬挂问题(交给 Phase 2)

- Mobile Figma node (434:46140) 实为 trading 进行态,不是 idle。Mobile idle 样式靠 Shell 响应式自动适配,如有特殊差异需补 Figma 截图核对
- Skeleton 版本需要 `isBaseChain` prop 区分骨架结构,当前内联占位不区分
- `openVaultDepositDialog` 的参数签名待 Phase 2 补充(Container 需要 defaultToken/defaultChain 支持)

## 迁移型 TODO 清单(Step 3.6 grep 产物,2026-04-23 更新)

> 来源:grep `占位|placeholder|暂用|待接入|后续补|TODO: 接入|0x0000...`。
> 下列占位均属"缺业务接线",非技术债。

| 字段 / 位置 | 当前占位 | 影响(用户视角) | 待接入 |
|---|---|---|---|
| `VaultDepositDialog/index.tsx:486` `feesDisplay / youReceiveDisplay / rateDisplay` | 硬编码 `"$0.00" / "-" / "-"` | 用户看不到真实 fee、预期收到数、汇率 | `useVaultNavQuery` + 费率派生 + decimal.js 计算 |
| `VaultDepositDialog/index.tsx:549` `submission.submit({ account: "0x0000..." })` | hardcoded zero address | deposit 签名会送错 account,链上必失败 | `useAccount().address` 获取真实钱包地址传入 |
| `buttonText` | `tradingStatus === "trading" ? "Processing..." : "Deposit"` | 新用户应显示 "Enable Trading";未连接钱包应显示 "Connect Wallet";chain mismatch 应显示 "Switch Network" | 接 `deriveDepositButtonState`(已在 depositFlowLogic,未在 Container 装配) |
| `buttonText` 派生遗漏 | 同上 | 同上 | Container 层调用 `deriveDepositButtonState(formVm, isConnected, currentChainId, ...)` |
| Mobile 样式细节 | 默认 Shell 响应式 | Mobile 进行态可能不对齐 | 补 Figma mobile trading node 后精修 |

## 已解决(2026-04-23)

- ~~Base 链 Max 余额占位 0~~ → 已接 `useReadContract(erc20.balanceOf)` on Base chain
- ~~默认 Chain / Token / Auto-fill 缺失~~ → 已在 `useVaultDepositForm` 补全(isNewUser 派生 + DEFAULT_TOKEN_MAG7 + auto-fill useEffect)
- ~~Must to know 点击~~ → Container 接 useState toggle
- ~~Network/Coin selector~~ → 复用 `shared/Dropdown` + chevron 旋转
