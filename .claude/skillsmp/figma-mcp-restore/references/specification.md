# 样式转换规则

> **适用场景**：Framelink MCP（返回原始数值）。官方 Figma MCP 直接输出 Tailwind 代码，不需要此文件的转换规则。
>
> AI 已知标准 Tailwind 映射，此文件只记录**易出错的转换逻辑**和**边界决策规则**。

---

## 颜色转换策略（三层）

```
1. 精确匹配  →  颜色值完全相同，使用 figma-style-mapping.mdc 中的语义类
2. 近似匹配  →  RGB 各通道差值之和 < 30，选最接近的项目色
3. 任意值兜底 →  无匹配时用 bg-[#xxxxxx] / text-[#xxxxxx]
```

**近似匹配计算**：
```
distance = |R1-R2| + |G1-G2| + |B1-B2|
distance < 30 → 视为匹配
```

> 优先使用项目语义类（`text-status-up`），其次任意值，**不使用** Tailwind 通用色（`green-500`）

---

## 行高转换（AI 高频出错）

Figma 返回行高为绝对像素值，需换算为相对比例后映射：

```
ratio = lineHeight(px) / fontSize(px)
```

| ratio 范围 | Tailwind 类 |
|-----------|------------|
| AUTO / 未定义 | `leading-normal` |
| ≤ 1.0 | `leading-none` |
| 1.0 – 1.3 | `leading-tight` |
| 1.3 – 1.4 | `leading-snug` |
| 1.4 – 1.6 | `leading-normal` |
| 1.6 – 1.8 | `leading-relaxed` |
| ≥ 1.8 | `leading-loose` |
| 精确还原需要 | `leading-[Npx]` |

**示例**：fontSize=14px，lineHeight=20px → ratio=1.43 → `leading-normal`

---

## 字间距转换（AI 高频出错）

Figma letterSpacing 单位为 px，需换算为 em：

```
em = letterSpacing(px) / fontSize(px)
```

| em 范围 | Tailwind 类 |
|--------|------------|
| < -0.04 | `tracking-tighter` |
| -0.04 – -0.01 | `tracking-tight` |
| -0.01 – 0.01 | `tracking-normal` |
| 0.01 – 0.04 | `tracking-wide` |
| 0.04 – 0.07 | `tracking-wider` |
| > 0.07 | `tracking-widest` |
| 精确还原需要 | `tracking-[Nem]` |

**示例**：fontSize=16px，letterSpacing=0.5px → em=0.03 → `tracking-wide`

---

## 任意值使用规则

| 场景 | 写法 |
|------|------|
| 非标准颜色 | `bg-[#8B5CF6]` `text-[#8B5CF6]` |
| 非标准间距 | `gap-[13px]` `p-[13px]` |
| 非标准字号 | `text-[13px]` |
| 透明度 | `bg-black/50` `text-white/80` |
| 渐变（非项目 token） | `bg-gradient-to-r from-blue-500 to-purple-500` |

---

## 描边（Stroke）转换规则

Framelink 返回 stroke 数据：

```yaml
strokes:
  - type: SOLID
    color: '#E5E5E5'
    opacity: 1
strokeWeight: 1        # 线宽（px）
strokeAlign: INSIDE    # INSIDE / OUTSIDE / CENTER
```

**转换规则**：

| 场景 | Tailwind 写法 |
|------|--------------|
| 标准宽度（1px）| `border border-[#E5E5E5]` |
| 标准宽度（2px）| `border-2 border-[#E5E5E5]` |
| 非标准宽度 | `border-[3px] border-[#E5E5E5]` |
| 虚线（DASHED）| 额外加 `border-dashed` |
| 点线（DOTTED）| 额外加 `border-dotted` |
| strokeAlign INSIDE | 加 `box-border`（默认，通常不需写）|
| strokeAlign OUTSIDE | 加 `outline outline-[Npx] outline-[#xxx]`（border 在盒模型外）|

> 项目语义颜色优先：`#E5E5E5` 如在 `figma-style-mapping.mdc` 有映射，使用语义类

---

## 透明度（Opacity）转换规则

Figma opacity 范围 0–1，Tailwind 用整数 0–100：

```
Tailwind opacity = Figma opacity × 100
```

| 场景 | 写法 |
|------|------|
| 整个节点透明度 | `opacity-50`（Figma 0.5 → 50）|
| 背景色带透明度 | `bg-black/50`（优先，性能更好）|
| 文字色带透明度 | `text-white/80` |
| 任意值 | `opacity-[0.35]`（非整数步进时）|

**选择策略**：
- 只有背景/文字颜色需要透明 → 用 `/` 语法（`bg-[#121212]/50`）
- 整个元素（含子元素）需要透明 → 用 `opacity-*`

---

## 绝对定位处理规则

Figma 常用绝对定位，转换时：

```
判断父容器是否有 Auto Layout？
├── 有 → 转为 flex/grid，用 gap/padding 还原间距
└── 无 → 保留 relative/absolute，但检查是否可重构
    ├── 元素间不重叠 → 重构为 flex
    └── 元素重叠（覆盖/徽标/浮层）→ 保留 absolute
```

**示例**：
```tsx
{/* 徽标覆盖场景，保留 absolute */}
<div className="relative">
  <img className="w-8 h-8" />
  <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500" />
</div>
```
