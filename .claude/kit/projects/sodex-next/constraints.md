# sodex-next 硬约束

> L0 硬约束 — 被 PROJECT.md `@` 自动引用,任何任务都不能违反

## 颜色约束

- **禁止仅按 hex 值匹配 token**:必须按 Figma 变量名转换
- **禁止硬编码 hex**:颜色相关 class 必须使用 `src/styles/theme.css` 中 `@theme inline` 提供的 token
- **选 token 必须以 Figma 变量名为依据**,不确定时对比 token 的 hex 值和设计稿颜色
- **无对应 token 时**:优先通过主题脚本补充(`pnpm merge:figma-tokens` + `pnpm generate:theme-css`),再使用该 token
- **硬编码豁免**:仅用户明确允许且属于一次性临时样式时,才可硬编码(如 `bg-[#2f241d]`),并在代码旁添加中文注释说明原因和后续替换计划
- **提交结果时**:说明本次使用了哪些 token、是否存在临时硬编码

## 样式约束

- **theme.css 只读**:`src/styles/theme.css` 由脚本自动生成,禁止手动修改
- **divider 规则**:竖线用 `w-px bg-bg-black-secondary`,横线用 `border-b border-border-primary`;不用 border 代替 divider,也不遗漏 divider
- **边框规则**:设计稿无边框的区域不加边框;有边框时区分粗细颜色(`border-border-primary` vs `border-border-secondary`)
- **圆角规则**:对比设计稿确认哪些区域有圆角、哪些没有;不给设计稿中直角的区域加 `rounded-*`
- **文字颜色层级**:主文字 `text-text-primary`、次要 `text-text-secondary`、占位/禁用 `text-text-placeholder`,不混用
- **容器 vs 独立卡片**:多卡片共享边框时用父 div 包裹 + divider 分隔;独立边框时才给每个卡片单独加 border

## 组件约束

- **必须使用 shared/ui**:在 `features/` / `pages/` / 业务组件中编写 UI 时,必须优先使用 `@/shared/components/ui` 已有组件,禁止用原生 HTML 元素或自行实现等价功能(详见 components.md)
- **弹窗壳层禁止**:弹窗内容组件**只负责内部内容区域**,以下外壳样式由 modalManager Shell 层统一提供,组件内部**禁止添加**:
  - 标题(title)/ 关闭按钮 / 外层 padding
  - 外层 border / border-radius
  - 外层背景色(`bg-bg-black-primary-alt` 等)
  - 响应式容器差异(PC rounded vs Mobile rounded-t)
- **`openResponsive` / `openModal` / `openDrawer` 调用位置**:只能出现在弹窗组件文件内部,禁止在业务调用方直接使用
- **标题(title)和描述(description)**:禁止写在组件 JSX 中,必须通过 `open*` 方法的 `options` 传入

## 命名约定

- **PC/Mobile 拆分**:用 `Pc{Name}.tsx` / `Mobile{Name}.tsx`
- **私有文件**:不从 feature `index.ts` 导出
- **弹窗 open 方法命名**:`open` + 组件名(如组件 `FundWalletDialog` → `openFundWalletDialog`)
- **数据不重复**:拆分 PC/Mobile 组件时,数据 hook 在父组件调用,通过 props 传入

## 开发范围

设计稿中以下公共区域**不需要开发**,只开发页面中间的主体内容区:

- 顶部导航栏(Header)
- 底部栏(Footer)
- Header 下方的公告栏(Announcement Bar)

遇到设计稿包含这些区域时直接忽略,聚焦中间内容区。
