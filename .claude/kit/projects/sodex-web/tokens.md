# sodex-web 设计 Token 速查

> L1 查阅文件 — 写组件 / Figma 映射 / 自检时读取

## 颜色

### 语义色(必用 token)

| 语义 | Tailwind class | hex |
|-----|---------------|-----|
| 上涨/成功 | `text-status-up` / `bg-status-up` | #18B36B |
| 下跌/错误 | `text-status-down` / `bg-status-down` | #F24237 |
| 警告 | `text-warning-primary` / `bg-warning-primary` | #F19D38 |

### 背景(hex 方括号)

| 语义 | Tailwind class |
|-----|---------------|
| 页面底色 | `bg-[#121212]` |
| 卡片底色 | `bg-[#1A1A1A]` |
| 输入框底色 | `bg-[#262626]` |

### 文字

| 语义 | Tailwind class |
|-----|---------------|
| 主文字 | `text-white` |
| 次要文字 | `text-[#A3A3A3]` |

## 字体

| Figma 字体 | Tailwind class |
|-----------|---------------|
| Inter | `font-inter` |

## 断点

| 名称 | 范围 | 前缀 |
|-----|------|-----|
| mobile | max-width: 759.99px | `mobile:` |
| pc | min-width: 759.99px | `pc:` |

> 项目仅使用 `mobile:` 和 `pc:` 两个响应式断点

## Spacing / Radius

沿用 Tailwind 默认 scale,无项目级特殊规则。遇到非标准值时用方括号写法(如 `h-[283px]`、`rounded-[10px]`)。

## Token 生成流程

sodex-web 不使用自动生成的 theme.css。新增颜色时:

1. 若属于涨跌/警告语义 → 沿用 `status-up` / `status-down` / `warning-primary`
2. 其他场景 → 直接用 hex 方括号
3. 若同一 hex 高频出现 → 考虑在 tailwind.config 加入命名 token,但非强制
