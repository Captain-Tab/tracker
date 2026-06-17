# UI Migration Summary — VaultDepositDialog

> Phase 1 (05b) 完成于 2026-04-23
> 工具: /k:ui-migration (Sonnet 4.6), Figma via Framelink MCP

---

## 组件产出

| # | 组件 | 落地路径 | Props interface | 4条红线 | handoff |
|---|---|---|---|---|---|
| 1 | VaultDepositDialog | `.../VaultDepositDialog/index.tsx` | `VaultDepositDialogProps` | ✅ | ✅ |
| 2 | Preview | `.../VaultDepositDialog/Preview.tsx` | `PreviewProps` | ✅ | (内联) |
| 3 | Trading | `.../VaultDepositDialog/Trading.tsx` | `TradingProps` | ✅ | (内联) |
| 4 | DepositToSodexStep | `.../VaultDepositDialog/DepositToSodexStep.tsx` | `DepositToSodexStepProps` | ✅ | (内联) |
| 5 | CollapsiblePanel | `.../VaultDepositDialog/CollapsiblePanel.tsx` | `CollapsiblePanelProps` | ✅ | (内联) |
| 6 | WarningText | `.../VaultDepositDialog/WarningText.tsx` | `WarningTextProps` | ✅ | (内联) |
| 7 | BaseAccountInput | `.../VaultDepositDialog/BaseAccountInput.tsx` | `BaseAccountInputProps` | ✅ | (内联) |
| 8 | VaultPreTradeButton | `.../VaultDepositDialog/VaultPreTradeButton.tsx` | `VaultPreTradeButtonProps` | ✅ | (内联) |
| 9 | AccountSelector | `.../VaultDepositDialog/AccountSelector.tsx` | `AccountSelectorProps` | ✅ | (内联) |

---

## 跨组件 Props 对齐

### 共享字段命名一致性
| 字段 | 类型 | 出现在 |
|---|---|---|
| `amount` | `string` | BaseAccountInput, AccountSelector, Preview, Trading |
| `onAmountChange` | `(value: string) => void` | BaseAccountInput, AccountSelector |
| `onMaxClick` | `() => void` | BaseAccountInput, AccountSelector |
| `maxLabel` | `string` | BaseAccountInput, AccountSelector |
| `amountLabel` | `string` | BaseAccountInput, AccountSelector |
| `precision` | `number` | BaseAccountInput, AccountSelector |
| `error` | `string?` | BaseAccountInput, AccountSelector |
| `isExpanded / isActive / isCompleted / isFailed` | `boolean` | CollapsiblePanel, TradingPanelSlot |
| `warningText` | `string?` | CollapsiblePanel, WarningText |

### 事件命名统一 (`onXxx`)
- `onNetworkClick / onTokenClick / onToggleMustKnow / onSubmit / onGetMag7 / onHelpClick`(VaultDepositDialog)
- `onConfirm / onBack`(Preview)
- `onRetry`(Trading)
- `onConnectWallet / onEnableDeposit`(VaultPreTradeButton)
- `onAccountSelect`(AccountSelector)

---

## Figma 覆盖情况

| 节点 | 状态 | 说明 |
|---|---|---|
| 430:35403 (Base PC idle) | ✅ 已拉取 | Framelink, 用于 idle form 结构和样式 |
| 434:46140 (Base Mobile) | ⚠️ 已拉取但为 trading 态 | figma-nodes.json 注释有误,实为进行中视图 |
| 430:34942 (进行中 step1) | ⚠️ 未拉取 | Framelink 断开,Trading/CollapsiblePanel 依据旧代码 + mobile 数据推导 |
| 430:38354 (Value Chain PC) | ⚠️ 未拉取 | AccountSelector 依据旧代码推导 |

---

## 悬挂问题(≤5 条,交给 Phase 2)

1. **VaultDepositDialog.inputArea**: ReactNode slot,Phase 2 Container 根据 `selectedChainType` 注入 `<BaseAccountInput>` 或 `<AccountSelector>`
2. **Mobile idle Figma 缺失**: 434:46140 为 trading 态。Mobile idle 样式靠 Shell 响应式自动处理;若有特殊差异需补拉 Figma 截图
3. **VaultDepositDialog.Skeleton**: 内联占位版本,Phase 2 替换为真实 `VaultDepositSkeleton`(区分 isBaseChain 骨架结构)
4. **DepositToSodexStep SVG 图标**: 当前用内联 SVG 占位,Phase 2 替换为 CostIcon / WhitePaperIcon / SosoIcon(老项目自定义图标)
5. **所有 i18n 文案**: Phase 1 全部硬编码英文占位,Phase 2 对接 `useTranslation` + 57 个 i18n key

---

## 验收清单

- [x] 9 个组件全部落地到 `src/features/vault/components/dialogs/VaultDepositDialog/`
- [x] 每个组件自带 `XxxProps` interface(内嵌)
- [x] 4 条红线全过(原生标签 / dark: / hook / store import)
- [x] 主弹窗 `openVaultDepositDialog` 骨架已生成
- [x] handoff.md 存在(VaultDepositDialog)
- [x] ui-migration-summary.md 存在
- [x] 悬挂问题 5 条(等于上限)
