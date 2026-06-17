<!-- tailwind-config-hash: de1f83cdd9bb1c0cb1045c195079088f4420e52e -->
# 项目专属 Design Token 映射

> 自动从 tailwind.config 提取，优先级高于 specification.md
>
> **断点、颜色、字体映射**见单一数据源：`.claude/rules/figma-style-mapping.md`

## 默认字体

| 场景 | Tailwind 类 | 说明 |
|------|------------|------|
| 页面根容器 | `font-inter` | 所有页面默认使用 Inter 字体 |

> 页面主容器应使用 `font-inter`，子元素自动继承，无需重复声明

## 渐变映射

| 名称 | Tailwind 类 |
|------|------------|
| 金色渐变 | `bg-gradient-gold` |
| 金色渐变(浅) | `bg-gradient-gold-light` |
| 灰色渐变 | `bg-gradient-grey` |

## 阴影映射

| 名称 | Tailwind 类 |
|------|------------|
| 区域阴影 | `shadow-area` |

## 常用间距

| Figma 数值 | Tailwind 类 |
|-----------|------------|
| 4px | `gap-1` / `p-1` / `m-1` |
| 8px | `gap-2` / `p-2` / `m-2` |
| 12px | `gap-3` / `p-3` / `m-3` |
| 16px | `gap-4` / `p-4` / `m-4` |
| 20px | `gap-5` / `p-5` / `m-5` |
| 24px | `gap-6` / `p-6` / `m-6` |
| 32px | `gap-8` / `p-8` / `m-8` |

