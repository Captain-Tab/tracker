---
id: theme-stroke-fill-via-cssvar
tags: [tailwind, theme, stroke, fill, svg, warning-color]
related_feature: vault-withdraw
severity: medium
gate: false
trigger: [stroke-, fill-, svg, warning, spinner, animate-spin, @theme]
date: 2026-04-23
---

# Tailwind @theme 只注册了部分颜色语义,`stroke-*` / `fill-*` 需用 CSS var 内联

## 问题描述

sodex-next 的 `src/styles/global.css @theme inline` 只注册了 `--color-brand` 等少数颜色作为 Tailwind utility 生成依据。这意味着:
- `stroke-brand` / `fill-brand` **可用**(已在 @theme)
- `stroke-warning-primary` / `fill-warning-primary` **不可用**(未注册)
- `bg-bg-warning-primary` / `text-text-warning` / `border-border-warning` **可用**(通过 theme.css CSS vars)

## 典型症状

写了 `<circle className="stroke-warning-primary" />` 但 SVG 渲染无色(stroke 没生效)。浏览器检查元素,看不到 computed `stroke` 属性。

## 根因

Tailwind JIT 只会为 `@theme inline` 里注册的颜色生成 `stroke-*` / `fill-*` 实用类。警告 / 成功 / 错误类颜色只在 `bg-*` / `text-*` / `border-*` 上有实用类,没有 stroke/fill 版本。

## 避坑

SVG 内需要非 brand 色时用 **CSS var 内联**:

```tsx
<svg>
  <circle
    stroke="..."  // 或不写 stroke 属性
    style={{ stroke: "var(--text-text-warning)" }}  // ← 关键:内联 CSS var
  />
</svg>
```

可用 CSS vars(定义在 `src/styles/theme.css`):
- `--text-text-warning` = #f19d38
- `--text-text-error` = #e43c5a
- `--border-border-warning` = #f19d38
- `--background-bg-warning-primary` = #f19d38
- 等等

## 关联

- `src/shared/components/ui/StepProcess/index.tsx`:SpinRing warning variant 就是用 `style={{ stroke: "var(--text-text-warning)" }}`
- 若业务场景频繁需要某色的 stroke/fill,长期方案是在 `global.css @theme inline` 里补注册:
  ```css
  --color-warning-primary: var(--text-text-warning);
  ```
  但这属于全局改动,需要评审
