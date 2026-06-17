# vault-deposit Style Diff & Layout Consistency

> Phase 0 产出。基于 Base PC 主弹窗(node 430:35403)的完整拉取 + 老项目 sodex-web 的 `dark:` + `components_tw/` 风格 + 新项目已有 claim/unstake/withdraw 的 token 命名。
>
> **其余 6 个 Figma 节点**(mobile / 进行中步骤 / value chain)由 Phase 1 `/k:ui-migration` 各自 `get_design_context` 拉取,参考本表补齐或覆盖。

---

## 1. 颜色 / 背景 token 映射表

### 已有 token(新项目复用,不要硬编码)

| Figma hex | 语义 | 新项目 token class |
|---|---|---|
| `#141419` | 弹窗 bg | `bg-bg-black-primary-alt` (Shell 层自动提供, 组件内部不用) |
| `#000000` | 输入/选项 bg / 内部卡 | `bg-bg-black-secondary` |
| `#232326` | 次要 border / 分隔线 | `bg-bg-black-secondary` (作 divider) 或 `border-border-primary` |
| `#FFFFFF` | 主文字 / 图标 | `text-white` 或 `text-text-primary` |
| `#B4B4B6` | 次要文字 / label | `text-text-secondary` |
| `#F19D38` | warning 主色(Alert/链接) | `text-warning-primary` / `text-text-warning` |
| `#2F241D` | warning bg(deep orange,Alert 背景) | ⚠ **检查新项目 token**:若无 `bg-warning-secondary`,临时用 `bg-[#2F241D]` 加注释 |
| `#F1C21B` | **失败 WarningIcon 黄色**(⚠ 与 `#F19D38` 区分) | ⚠ 新项目待补 token,临时 `text-[#F1C21B]` |
| `#FF7637` | 步骤 spinner 边色(老项目自定义橙) | ⚠ 新项目待 map,临时 `border-[#FF7637]` |
| `#A3A3A3` | 失败面板标题灰 | `text-text-secondary` |
| `#262626` | Try Again 按钮 bg / 深灰卡片 | `bg-bg-black-tertiary` 或 `bg-[#262626]` |
| `#3E3E43` | 禁用按钮 bg | shared `<Button>` disabled 态自动处理 |

### 老项目 → 新项目 class 清理规则

| 老项目写法 | 新项目替换 |
|---|---|
| `dark:bg-xxx` | 去 `dark:` 前缀(新项目走 CSS var + data-theme) |
| `text-text-primary-900-white` | `text-text-primary` 或 `text-white` |
| `text-text-secondary-500-300` | `text-text-secondary` |
| `bg-bg-black-primary-alt` | **删除**(Shell 提供) |
| `rounded-1.5` | Tailwind v4 不支持 → `rounded-[6px]` |
| `components_tw/HStack` | `@/shared/components/ui` HStack |
| `components_tw/icons/XxxIcon` | `@/shared/components/ui` 对应 icon 或 lucide-react |
| `mobx-react-lite` observer | 整段移除,Container hook 提供数据 |

---

## 2. 字体映射

| Figma | Tailwind class |
|---|---|
| 24/36 Semi Bold | `text-2xl leading-9 font-semibold` |
| 14/20 Regular | `text-sm leading-5` |
| 14/24 Medium | `text-sm leading-6 font-medium` |
| 12/16 Regular | `text-xs leading-4` |
| 12/16 Regular (text-right) | `text-xs leading-4 text-right` |

字体全为 Inter,走全局配置,不单独声明 `font-inter`。

---

## 3. 圆角 / 间距 / 尺寸

| Figma | Tailwind class |
|---|---|
| radius 6px | `rounded-md` (v4 标准 = 6px) 或 `rounded-[6px]` |
| radius 4px | `rounded` (v4 = 4px) |
| radius 1000px(圆形) | `rounded-full` |
| padding 32px | `p-8` |
| padding 10px 16px | `py-2.5 px-4` |
| padding 8px 16px | `py-2 px-4` |
| padding 8px 12px | `py-2 px-3` |
| gap 24px | `gap-6` |
| gap 16px | `gap-4` |
| gap 10px | `gap-2.5` |
| gap 8px | `gap-2` |
| gap 4px | `gap-1` |
| width 520px (Frame) | **不硬编码**(Shell 提供), 组件根用 `w-full` |
| width 456px (Button) | `w-full` (填满父容器) |
| height 36 / 40 / 12 | `h-9 / h-10 / h-3` |

---

## 4. 组件映射(shared UI 强制使用,对齐 `.claude/rules/use-shared-ui.md`)

| Figma 元素 | shared 组件 |
|---|---|
| Close 按钮(x-close) | Shell 提供,**不写** |
| Network / Coin 选择器(下拉三元组) | `<Select>` 或 `<Menu>` — 按 token 切换语义选 |
| Amount 输入 | `<Input>` + 右侧 "Max" `<Button variant="text">` |
| 主按钮 "Deposit" | `<Button variant="primary" size="lg" />`(disabled 态自动) |
| 次按钮 "Get MAG7.ssi" | `<Button variant="outline" size="lg" />` |
| Alert "Must to know" | `<InfoAlert variant="warning" />` (前序模块已建) |
| chevron-down / link-external / SoDEX logo | `<Icon name="..." />` 或 lucide-react |
| 竖线 divider | `<div className="w-px h-3 bg-bg-black-secondary" />` |

---

## 5. 布局一致性验证(关键,前提"只变样式"检验)

基于已拉 Base PC 主弹窗 + 老项目 `deposit/index.tsx`:

| 维度 | Figma 新稿 | 老项目 | 是否一致 | 备注 |
|---|---|---|---|---|
| 弹窗容器宽 PC | 520px (fixed) | ~480-520px | ⚠ **稍宽** | 按 Figma 走,shell 配置 |
| 弹窗 padding | 32px | 24px? | ⚠ 可能变 | 按 Figma 走 |
| Network/Coin 两列并排 | ✅ 并列 gap-2 | ✅ 一致 | ✅ | 布局未变 |
| Amount 行结构 | label + Max | label + Max | ✅ | 未变 |
| Fees/Receive/Rate 行数 | 3 行(垂直 stack) | 3 行 | ✅ | 未变 |
| 主按钮 + 次按钮垂直排列 | 上下,gap-4 | 上下 | ✅ | 未变 |
| 底部 "Get Stack?" 链接 | ✅ 存在 | 老项目有 "Help" / 类似 | ⚠ 文案对照 | 按 Figma |
| **Alert (Must to know)** | ✅ 新增/保留,deep orange 背景 | 老项目有 WarningText 组件 | ⚠ 样式变化 | Figma 为准 |

### 其余节点的布局验证(Phase 1 拉取后补)

- Mobile 断点:老项目用 `max-md:` / `md:`,新项目只有 `mobile:` / `pc:`
- 进行中步骤(Trading / CollapsiblePanel):需看 Figma 3 个进行中节点才能确认 step icon 样式/文案位置
- Value Chain 主弹窗差异:`Network` 下拉不可选 Base,`From` 换成 Spot/EVM-Funding 选择器

### 发现的布局差异汇总(滚动更新)

- ⚠ **Alert 位置**:Figma 把 "Must to know" Alert 放在标题下面,老项目可能是错误态才显示 → Phase 1 ui-migration 按 Figma 固定显示
- ⚠ **Button 宽度**:Figma 固定 456px,新项目约定用 `w-full` — Phase 1 以 `w-full` 为准
- ⚠ **Alert bg token 待补**:`#2F241D` 在新项目无对应 token,暂用 bracket 类 + 注释,后续迁移到 figma token merge

---

## 6. 迁移约束(Phase 1 ui-migration 必须遵守)

- **组件外层 `w-full`**,禁 `w-[520px]` / `p-8 bg-bg-black-primary-alt` 等壳层样式(`modal-component-style.md` 硬约束)
- **所有 hex 值必须映射为 token 或 bracket 类 + 中文注释**(`ui-style.md` 硬约束)
- **禁 `dark:` 前缀**(v1.11.0 规则)
- **禁原生 `<button> <input> <select> <dialog>`** (`use-shared-ui.md` 红线,4 grep 自检)
- **标题 / 描述 / 关闭按钮**由 `openVaultDepositDialog` 的 options 传入,不写在组件 JSX

---

## 7. 移动端适配点(Figma Mobile 节点 + 代码分支)

### 7.1 Figma Mobile 节点(需 Phase 1 各 ui-migration 拉)

| 场景 | Figma nodeId | 状态 |
|---|---|---|
| Base Chain Mobile idle | `434:46140` | 未拉取,Phase 1 VaultDepositDialog 时一并拉 |
| Value Chain Mobile idle | `434:50448` | 未拉取,Phase 1 同上 |
| Mobile 进行中 / 失败态 | **设计稿未提供** | Phase 1 参考 PC 进行中稿 + 响应式规则自适配,记录到 handoff.md 悬挂问题 |

### 7.2 代码级移动端分岔(见 interaction-spec §17)

| 点 | PC | Mobile | 迁移处理 |
|---|---|---|---|
| 主弹窗容器 | Dialog | Drawer(底抽屉) | `openResponsive` 自动 |
| 签名入口 | `signMessage` | `signMessageMobile` | `ui.isMobileScreen` 分岔 |
| Stake step label | `<StakeProcess isActive />` | `+ inMobile MobileIcon` | ProcessStep props 扩展 |
| Confirm i18n | `common:confirming_in_wallet` | `vault:confirming_in_wallet_on_mobile` | 独立 key |
| Enable Trading 步骤 | 普通文案 | `<MobileIcon />` + 特定 label | ProcessStep mobile 变体 |
| WalletConnect 扫码 | 不显示 | `isFromMobileScan` 额外提示 | ProcessIndicator prop |

### 7.3 响应式断点

- 老项目: `max-md:` / `md:` / `lg:`
- 新项目: **只有 `mobile:` / `pc:` 两套**(CLAUDE.md §Figma Mapping)
- 迁移时 `max-md` → `mobile:`,`md:` → `pc:`;其余断点集中到 `pc:` 下

### 7.4 失败态完整视觉规格(对齐 interaction-spec §16)

| 元素 | 颜色/样式 | 注 |
|---|---|---|
| WarningIcon (失败步骤右侧) | `text-[#F1C21B]` 16px | **黄色,不是 Alert 橙色** |
| Failed 面板标题 | `text-[#A3A3A3]` | 灰,对应 `text-text-secondary` |
| Failed 面板 canToggle | `false` | 不可展开折叠 |
| Value Chain 失败 | WarningIcon + spinner 同时显示 | 老项目 history 20251205 要求 |
| Try Again 按钮 | `bg-[#262626]` + `text-white` + 3s auto-hide | 点击后 `retrying` 禁用态 |
| 失败步骤之前 | `✓ completed` 绿 | `getStepStatus` 按 stepIndex 判定 |

---

## 8. 交给 Phase 1 ui-migration 的 token 预算参考

每个 `/k:ui-migration` 调用:
- `/k:figma` 拉对应节点 ≈ 4-10k
- Step 0.5 legacy grep + slice ≈ 1-2k
- 2.0.6 冲突裁决(若有) ≈ 500
- props 化 + 落地 + 4 grep 自检 ≈ 2k
- **小计** ≈ 7-15k/次

9 个组件 × 中位数 10k = ~90k,Sonnet 4.6 session 可承受。
