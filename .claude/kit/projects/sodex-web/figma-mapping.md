# sodex-web Figma → Tailwind 映射

> L1 查阅文件 — `/k:figma` 读取

当使用 **官方 Figma MCP**(`user-Figma-*`)获取设计稿并生成代码时,按以下规则替换样式。

> **注意**:Framelink MCP(`user-Framelink_Figma_MCP-*`)返回原始颜色值,通常不需要此转换。

## Figma 变量名 → Tailwind 类

> `*` 表示任意后缀(如 `-500`、`-(500-->-300)` 等),匹配时忽略后缀

| Figma 变量名模式 | 替换为 |
|-----------------|-------|
| `text-text-primary-*` | `text-white` |
| `text-text-secondary-*` | `text-[#A3A3A3]` |
| `bg-background-primary-*` | `bg-[#121212]` |
| `bg-background-secondary-*` | `bg-[#1A1A1A]` |
| `bg-background-tertiary-*` | `bg-[#262626]` |
| `text-success-*` / `text-green-*` | `text-status-up` |
| `text-error-*` / `text-red-*` | `text-status-down` |
| `text-warning-*` / `text-orange-*` | `text-warning-primary` |
| `bg-success-*` / `bg-green-*` | `bg-status-up` |
| `bg-error-*` / `bg-red-*` | `bg-status-down` |
| `bg-warning-*` / `bg-orange-*` | `bg-warning-primary` |

## 颜色值直查

| Figma hex | 语义 | Tailwind class |
|----------|------|---------------|
| #18B36B | 上涨/成功 | `text-status-up` / `bg-status-up` |
| #F24237 | 下跌/错误 | `text-status-down` / `bg-status-down` |
| #F19D38 | 警告 | `text-warning-primary` / `bg-warning-primary` |
| #121212 | 页面背景 | `bg-[#121212]` |
| #1A1A1A | 卡片背景 | `bg-[#1A1A1A]` |
| #262626 | 输入框背景 | `bg-[#262626]` |
| #A3A3A3 | 次要文字 | `text-[#A3A3A3]` |
| #FFFFFF | 主要文字 | `text-white` |

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

1. Figma MCP 返回的变量名 / 颜色值 → 按上表直接替换
2. 语义色(涨跌/警告) → 必须用 `status-up` / `status-down` / `warning-primary` token
3. 页面级背景/文字 → 使用 hex 方括号(见表格)
4. 未覆盖的颜色 → 沿用 Figma 原始 hex,加方括号;高频时可考虑新增项目 token
