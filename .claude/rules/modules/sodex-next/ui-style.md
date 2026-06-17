---
paths:
  - "src/**/*.ts"
  - "src/**/*.tsx"
---

# UI 样式红线(v1.11.0 瘦身版)

> always-on 注入的硬约束。**详细 token 清单 / Figma 变量映射 / 示例**见 `kit/projects/<当前项目>/`。

## 核心原则

拿到设计稿后,逐区域对比视觉细节,不凭直觉套通用样式。

## 颜色与 Token 红线

- **禁止仅按 hex 值匹配 token**(同一 hex 可能对应多个语义不同 token),必须按 Figma 变量名转换
- **禁止硬编码 hex**(如 `bg-[#2f241d]`);豁免条件:用户明确允许 + 一次性临时样式 + 代码旁中文注释说明原因和后续替换计划
- **`src/styles/theme.css` 只读**,由 `scripts/theme/generate-theme-css.mjs` 自动生成,禁止手动修改
- 无对应 token 时:走主题脚本补充(`pnpm merge:figma-tokens` + `pnpm generate:theme-css`),而非硬编码
- 提交结果时说明:本次使用了哪些 token,是否存在临时硬编码

## 样式检查清单(每个 UI 区域逐项核对)

- **边框**:设计稿无边框的区域不加边框;有边框时区分粗细颜色(主/次)
- **背景色**:区分页面底色 / 卡片底色 / 弹窗底色 等层级,不混用
- **分隔线**:竖线用 `w-px bg-bg-black-secondary`,横线用 `border-b border-border-primary`;不用 border 代替 divider,也不遗漏 divider
- **圆角**:对比设计稿确认哪些区域有圆角、哪些没有;直角区域不加 `rounded-*`
- **间距**:对比设计稿元素间距,使用 Tailwind 标准间距(4px 为单位)
- **文字颜色层级**:主文字 / 次要 / 占位禁用 不混用
- **容器 vs 独立卡片**:多卡片共享边框时用父 div 包裹 + divider 分隔;独立边框时才给每个卡片单独加 border

## Tailwind v4 类名规范

### 尺寸属性(走 spacing scale)

| 条件 | 转换 | 示例 |
|------|------|------|
| 能被 4 整除 | `px ÷ 4` → 整数类名 | `h-[280px]` → `h-70` |
| 能被 2 整除(不能被 4 整除) | `px ÷ 4` → `.5` 小数类名 | `h-[282px]` → `h-70.5` |
| 奇数 px 值 | 保留方括号 | `h-[283px]` |

**优先级**:标准类名 > 方括号。适用于 `w-` `h-` `p-` `m-` `gap-` 等所有走 spacing 的属性。

### 圆角(走 border-radius scale,不走 spacing)

`rounded-*` 使用独立 scale,**不能**用 spacing 数值(如 `rounded-1.5`)。无对应标准类时用方括号:`rounded-[10px]`。

---

## 详情查阅

完整 token 速查(背景 / 文字 / 边框 / 图标填充 / 字体 / 断点 / spacing / radius):
- **`kit/projects/<CURRENT_PROJECT>/tokens.md`**

Figma 变量名 → Tailwind class 命名转换规律 / 完整映射表 / 查找流程 / 示例:
- **`kit/projects/<CURRENT_PROJECT>/figma-mapping.md`**

开发范围限制(Header / Footer / 公告栏不开发)、豁免条件细则、代码/命名约定:
- **`kit/projects/<CURRENT_PROJECT>/constraints.md`**
