# sodex-next Figma → Tailwind 映射

> L1 查阅文件 — `/k:figma` 读取

## 核心规则

按 **Figma 变量名**直接转换,禁止仅按 hex 值匹配(同一 hex 可能对应多个语义不同的 token)。

## 变量名转换规律

```
Figma 变量名(Variables 面板)      →  CSS 变量(:root)                →  @theme inline KEY       →  Tailwind class
background/bg-black-primary        →  --background-bg-black-primary  →  --color-bg-black-primary  →  bg-bg-black-primary
text/text-primary                  →  --text-text-primary            →  --color-text-primary      →  text-text-primary
border/border-primary              →  --border-border-primary        →  --color-border-primary    →  border-border-primary
foreground/fg-primary              →  --foreground-fg-primary        →  --color-fg-primary        →  fill-fg-primary
```

1. Figma 变量名 `/` → `-`,加 `--` 前缀得 CSS 变量名
2. CSS 变量名去掉第一段类别前缀(`background-`、`text-`、`border-`、`foreground-`)得到 KEY
3. Tailwind class = 使用场景前缀 + KEY

## 变量组速查表

| Figma 变量组 | Tailwind 前缀 | 示例类名 | 用途 |
|-------------|--------------|---------|------|
| `background/bg-*` | `bg-bg-*` | `bg-bg-black-primary`, `bg-bg-error-primary` | 背景色 |
| `text/text-*` | `text-text-*` | `text-text-primary`, `text-text-error` | 文字色 |
| `border/border-*` | `border-border-*` | `border-border-primary`, `border-border-error` | 边框色 |
| `foreground/fg-*` | `fill-fg-*` | `fill-fg-primary`, `fill-fg-secondary` | 图标/SVG 填充色 |

## 常用颜色映射

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

### 图标填充

| 语义 | Tailwind class |
|-----|---------------|
| 主图标 | `fill-fg-primary` |
| 次要图标 | `fill-fg-secondary` |

## 字体映射

| Figma 字体 | Tailwind class |
|-----------|---------------|
| Inter | `font-inter` |

## 断点配置

| 名称 | 范围 | 前缀 |
|-----|------|-----|
| mobile | max-width: 759.99px | `mobile:` |
| pc | min-width: 759.99px | `pc:` |

## 查找流程

1. **获取 Figma 变量名**:从设计稿 Variables 面板读取变量名(如 `text/text-primary`)
2. **直接转换**:`/` → `-`,加上对应 Tailwind 前缀即为类名(如 `text-text-primary`)
3. **验证**:在 `src/styles/theme.css` 的 `@theme inline` 中确认 `--color-text-primary` 存在
4. **若无对应 token**:走主题脚本补充(`pnpm merge:figma-tokens` + `pnpm generate:theme-css`),禁止直接硬编码 hex

## 示例

```
Figma: background/bg-black-primary (Dark Mode: #000000, Light Mode: #ffffff)
  → CSS 变量: --background-bg-black-primary
  → @theme inline: --color-bg-black-primary
  → Tailwind class: bg-bg-black-primary

Figma: text/text-error
  → CSS 变量: --text-text-error
  → @theme inline: --color-text-error
  → Tailwind class: text-text-error
```
