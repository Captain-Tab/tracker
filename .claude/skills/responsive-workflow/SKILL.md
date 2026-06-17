---
name: responsive-workflow
description: |
  PC-first 响应式开发工作流，适用于双端 Figma 设计稿页面开发。
  ACTIVATE when: 开发新页面有 PC + Mobile 两份 Figma 设计稿，
  用户要求对已有 PC 页面做响应式/移动端适配，
  用户提到"响应式"、"双端适配"、"mobile adaptation"，
  或适配已有 PC 页面到移动端。
---

# Responsive Workflow

PC-first 开发，先实现 PC 完整功能，再对照 Mobile 设计稿适配。

## When to Use This Skill

- 开发新页面/feature，有 PC + Mobile 两份 Figma 设计稿
- 用户提供两个 Figma URL（PC 端 + Mobile 端）
- 适配已有 PC-only 页面到移动端
- 用户提到"响应式"、"双端适配"、"mobile adaptation"

## Prerequisites

- 先读 `tailwind-design-system` skill 了解 token/色彩/断点规范
- 向用户确认两份 Figma URL（PC 设计稿 + Mobile 设计稿）

## Workflow

### Phase 1: PC 实现

1. **读取 PC Figma** — 调用 `get_design_context`，传入 PC Figma URL 的 fileKey 和 nodeId
2. **分析结构** — 识别布局网格、间距、组件层级
3. **实现 PC 版本** — 使用标准 Tailwind 类名构建完整页面（此阶段不加 `mobile:` / `pc:` 变体）
4. **验证** — 确认 PC 布局在 >= 760px 视口下匹配设计稿

### Phase 2: Mobile 适配

5. **读取 Mobile Figma** — 调用 `get_design_context`，传入 Mobile Figma URL 的 fileKey 和 nodeId
6. **Diff 分析** — 对比 Mobile 与 PC 设计稿，按下表分类每处差异：

| 差异类型                        | 分类     | 使用模式      |
| ------------------------------- | -------- | ------------- |
| Grid 列数变化（如 4列 → 1列）   | 布局调整 | CSS 变体      |
| 间距/内边距变化                 | 布局调整 | CSS 变体      |
| 元素在移动端隐藏                | 显隐控制 | CSS 变体      |
| 元素仅移动端显示                | 显隐控制 | CSS 变体      |
| 字号变化                        | 布局调整 | CSS 变体      |
| Flex 方向变化                   | 布局调整 | CSS 变体      |
| 完全不同的组件树                | 结构差异 | Hook 条件渲染 |
| 不同组件类型（Table → MTable）  | 组件替换 | Hook 条件渲染 |
| 不同交互范式（Dialog → Drawer） | 组件替换 | Hook 条件渲染 |

7. **实施适配** — 按决策树（见下方）选择正确的模式
8. **验证** — 同时检查 PC（>= 760px）和 Mobile（< 760px）视口

### Phase 3: 自检

9. 逐项检查响应式自检清单（见下方）

## 模式决策树

对 PC 与 Mobile 设计稿之间的每处视觉差异，按以下顺序判断：

```
组件树结构相同？
├── YES → Pattern A: CSS 变体 (mobile:xxx / pc:xxx)
│   grid 列数、间距、显隐、字号、flex 方向等
│
└── NO → 已有 shared 响应式组件？
    ├── YES → 直接使用
    │   - 表格 → ResponsiveTable（自动切换 MTable/Table）
    │   - 弹窗 → ModalHost / modalManager（自动切换 Dialog/Drawer）
    │
    └── NO → Pattern B: useIsMobileScreen() hook
        - < 30 行 JSX → 同文件 early return
        - >= 30 行 JSX → 拆分 PcXxx.tsx / MobileXxx.tsx
```

### Pattern A: CSS 变体（优先使用）

用 `mobile:` 和 `pc:` Tailwind 变体处理同一 DOM 结构的布局调整。

```tsx
// Grid 折叠：PC 4列，Mobile 1列
<div className="grid grid-cols-4 mobile:grid-cols-1 gap-2">

// Mobile 隐藏
<span className="text-xs text-secondary-500-300 mobile:hidden">

// 仅 Mobile 显示
<div className="hidden mobile:block">

// 方向变化
<div className="flex items-center justify-between mobile:flex-col mobile:items-start mobile:gap-y-4">

// PC-only hover 效果
<div className="hidden pc:group-hover:flex">
```

### Pattern B: Hook 条件渲染

仅在组件树结构本质不同时使用 `useIsMobileScreen()`。

```tsx
import { useIsMobileScreen } from "@/shared/hooks/useIsMobileScreen";

function MySection() {
  const isMobileScreen = useIsMobileScreen();

  if (isMobileScreen) {
    return <MobileMySection />;
  }
  return <PcMySection />;
}
```

### Pattern B+: 已有的响应式组件

优先使用现有封装：

```tsx
// 表格 — 使用 ResponsiveTable，不要手动切换
<ResponsiveTable
  universalProps={{ data, columns: sharedColumns }}
  mobileProps={{ columns: mobileColumns }}
  desktopProps={{ columns: desktopColumns }}
/>

// 弹窗 — 使用 modalManager，ModalHost 自动切换 Dialog(PC) ↔ Drawer(Mobile)
```

## 组件拆分约定

### 同文件（内联）

Mobile 分支较小（< 30 行 JSX）时，保留在同一组件内用 early return：

```tsx
function OrderPanel() {
  const isMobileScreen = useIsMobileScreen();
  if (isMobileScreen) {
    return <div>...</div>; // 小型 mobile 变体
  }
  return <div>...</div>; // PC 布局
}
```

### 拆分子组件

Mobile 分支较大（>= 30 行）时，提取为独立文件：

```
components/
  OrderPanel/
    index.tsx              ← 公开组件，包含 isMobileScreen 切换
    PcOrderPanel.tsx       ← PC 专属组件（私有）
    MobileOrderPanel.tsx   ← Mobile 专属组件（私有）
```

- 命名：`Pc{Name}.tsx` / `Mobile{Name}.tsx`
- 私有文件，不从 feature `index.ts` 导出
- 共享数据逻辑提取到 container hook，通过 props 传入两个子组件

## 响应式自检清单

实现完成后逐项检查：

- [ ] **断点一致性** — 响应式类名使用 `mobile:`（max: 759.99px）或 `pc:`（min: 759.99px），非 `sm:` / `md:` / `lg:`（除非确需特定范围）
- [ ] **无孤立内容** — `hidden` 的元素在另一端有对应的可见版本（或确认为故意隐藏）
- [ ] **触摸区域** — Mobile 按钮/链接触摸区域 >= 32px（`h-8`）
- [ ] **无水平溢出** — Mobile 无水平滚动条
- [ ] **文本截断** — PC 上能放下的长文本在 Mobile 正确截断或换行
- [ ] **模式正确性** — CSS 变体用于布局调整；Hook 仅用于结构差异
- [ ] **数据获取不重复** — Pattern B 拆分组件时，数据 hook 在父组件调用，不在两个分支中重复
- [ ] **使用现有组件** — 表格用 `ResponsiveTable`，弹窗用 `ModalHost`/`modalManager`
- [ ] **Token 合规** — 无硬编码颜色，符合 `tailwind-design-system` skill 规范
- [ ] **子组件规范** — Mobile 子组件遵循 `Mobile{Name}.tsx` / `Pc{Name}.tsx` 命名，不从 feature `index.ts` 导出

## 与其他 Skill 的集成

| Skill/Rule                      | 集成点                                                       |
| ------------------------------- | ------------------------------------------------------------ |
| `tailwind-design-system`        | 先读取，了解 token/色彩/断点。所有响应式类名须使用项目 token |
| `react-component-decomposition` | 拆分 PC/Mobile 子组件时，遵循其单一职责和 ~100 行指导        |
| `no-use-effect`                 | 禁止用 useEffect 检测屏幕尺寸，使用 `useIsMobileScreen()`    |
| `use-shared-ui` (rule)          | PC 和 Mobile 分支都必须使用 shared UI 组件                   |

## 边界情况

### PC 和 Mobile 布局完全不同

如 PC 是多栏 Dashboard，Mobile 是卡片堆叠：

1. Page 组件作为切换点
2. 提取 `Pc{Page}Content.tsx` 和 `Mobile{Page}Content.tsx`
3. 共享数据通过父级 container hook 获取，props 传入

### Mobile 专属交互（滑动手势、底部弹出等）

- 能用 CSS 变体的优先用 CSS 变体
- 需要 JS 交互的（如 touch 事件），用 `useIsMobileScreen()` 守卫，避免 PC 端挂载不必要的监听器

### 中间断点（平板）

项目主要使用 `mobile:` / `pc:`（760px 分割）。如设计需要平板特定布局，使用 `md:`（600px-960px）或 `pc_sm:`（760px-1260px），并在代码注释中说明原因。
