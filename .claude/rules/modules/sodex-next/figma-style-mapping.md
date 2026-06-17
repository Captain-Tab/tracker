---
description: Figma MCP 样式映射规则（单一数据源）。当使用 Figma MCP 获取设计稿、进行 UI 还原、或将 Figma 变量名转换为 Tailwind 类时使用。
globs:
---

# Figma 样式映射规则

当使用 **官方 Figma MCP**（`user-Figma-*`）获取设计稿并生成代码时，必须按以下规则替换样式。

> **注意**：Framelink MCP（`user-Framelink_Figma_MCP-*`）返回原始颜色值，通常不需要此转换。

## Figma 变量名 → Tailwind 类

> `*` 表示任意后缀（如 `-500`, `-(500-->-300)` 等），匹配时忽略后缀

| Figma 变量名模式 | 替换为 |
|-----------------|--------|
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

## 颜色值 → Tailwind 类

| Figma 颜色 | 语义 | Tailwind 类 |
|-----------|------|------------|
| #18B36B | 上涨/成功 | `text-status-up` / `bg-status-up` |
| #F24237 | 下跌/错误 | `text-status-down` / `bg-status-down` |
| #F19D38 | 警告 | `text-warning-primary` / `bg-warning-primary` |
| #121212 | 页面背景 | `bg-[#121212]` |
| #1A1A1A | 卡片背景 | `bg-[#1A1A1A]` |
| #262626 | 输入框背景 | `bg-[#262626]` |
| #A3A3A3 | 次要文字 | `text-[#A3A3A3]` |
| #FFFFFF | 主要文字 | `text-white` |

## 字体 → Tailwind 类

| Figma 字体 | Tailwind 类 |
|-----------|------------|
| Inter | `font-inter` |

## 断点配置

| 断点名 | 范围 | 前缀 |
|-------|------|------|
| mobile | max-width: 759.99px | `mobile:` |
| pc | min-width: 759.99px | `pc:` |

> 项目仅使用 `mobile:` 和 `pc:` 两个响应式断点
