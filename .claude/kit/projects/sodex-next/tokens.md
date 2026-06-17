# sodex-next 设计 Token 速查

> L1 查阅文件 — 写组件 / Figma 映射 / 自检时读取

## 颜色 Token

### 背景

| 语义 | Tailwind class |
|-----|---------------|
| 页面底色 | `bg-bg-black-primary` |
| 卡片/区块底色 | `bg-bg-black-secondary` |
| 弹窗/下拉底色 | `bg-bg-black-primary-alt` |
| hover 状态 | `bg-bg-black-optionally` |
| 成功背景 | `bg-bg-success-primary` |
| 错误背景 | `bg-bg-error-primary` |
| 警告背景 | `bg-bg-warning-primary` |
| 白色/亮色背景 | `bg-bg-light-primary` |

### 文字

| 语义 | Tailwind class |
|-----|---------------|
| 主文字 | `text-text-primary` |
| 次要文字 | `text-text-secondary` |
| 占位/禁用文字 | `text-text-placeholder` |
| 反色文字 | `text-text-primary-alt` |
| 成功文字 | `text-text-success` |
| 错误文字 | `text-text-error` |
| 警告文字 | `text-text-warning` |

### 边框

| 语义 | Tailwind class |
|-----|---------------|
| 默认边框 | `border-border-primary` |
| 次要边框 | `border-border-secondary` |
| 亮色边框 | `border-border-light-primary` |
| 错误边框 | `border-border-error` |
| 成功边框 | `border-border-success` |
| 警告边框 | `border-border-warning` |

### 图标/SVG 填充

| 语义 | Tailwind class |
|-----|---------------|
| 主图标 | `fill-fg-primary` |
| 次要图标 | `fill-fg-secondary` |

## 字体

| Figma 字体 | Tailwind class |
|-----------|---------------|
| Inter | `font-inter` |

## 断点

| 名称 | 范围 | 前缀 |
|-----|------|-----|
| mobile | max-width: 759.99px | `mobile:` |
| pc | min-width: 759.99px | `pc:` |

## Spacing Scale(Tailwind v4)

遇到设计稿中的固定 px 值,优先使用标准类名,避免方括号硬编码:

| 条件 | 转换方式 | 示例 |
|-----|---------|------|
| 能被 4 整除 | `px ÷ 4` → 整数类名 | `h-[280px]` → `h-70` |
| 能被 2 整除(不能被 4 整除) | `px ÷ 4` → `.5` 小数类名 | `h-[282px]` → `h-70.5` |
| 奇数 px 值(不能被 2 整除) | 保留方括号写法 | `h-[283px]` → `h-[283px]` |

**优先级**:标准类名 > 方括号。只有值无法被 2 整除时才使用方括号。

适用于所有走 spacing scale 的属性:`w-`、`h-`、`min-w-`、`min-h-`、`max-w-`、`max-h-`、`p-`、`m-`、`gap-`、`top-`、`left-` 等。

常见映射:`max-w-7xl`=1280px、`max-w-6xl`=1152px、`max-w-5xl`=1024px

## Radius Scale(独立 scale,不走 spacing)

`rounded-*` 使用独立的圆角 scale,**不能**用 spacing 数值(如 `rounded-1.5`)。

| 标准类名 | 值 |
|---------|-----|
| `rounded-sm` | 2px |
| `rounded` | 4px |
| `rounded-md` | 6px |
| `rounded-lg` | 8px |
| `rounded-xl` | 12px |
| `rounded-2xl` | 16px |
| `rounded-3xl` | 24px |
| `rounded-full` | 9999px |

无标准类对应时用方括号:`rounded-[10px]`。

## Token 生成流程

- `src/styles/theme.css` 由 `scripts/theme/generate-theme-css.mjs` **自动生成,禁止手动修改**
- 新增 token 流程:
  1. 在 Figma Variables 面板定义新变量
  2. 运行 `pnpm merge:figma-tokens` 合并到源数据
  3. 运行 `pnpm generate:theme-css` 重新生成 theme.css
  4. 使用新 token 的 Tailwind class
- 禁止跳过流程直接硬编码 hex(除一次性临时样式且用户明确允许)
