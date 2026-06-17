# 弹窗组件样式红线(v1.11.0 瘦身版)

> always-on 注入的硬约束。**完整 API 示例 / 判断细节 / 调用示范**见 `kit/projects/<当前项目>/patterns.md §modal`。

## 判断条件

当组件满足以下任一条件,视为「弹窗内容组件」,适用本规则:

1. 自身被 `openModal` / `openDrawer` / `openResponsive` / `enqueueModal` / `enqueueDrawer` / `enqueueResponsive` 调用
2. 上层组件(直接或间接父组件)被上述方法调用
3. props 包含 `ModalInjectedProps`(`resolve` / `reject` / `close` / `modalId`)

这些方法来自 `src/shared/infra/modalManager/api.ts`。

## 壳层禁止项(Shell 层统一提供)

组件内部**禁止添加**以下外壳样式:

| 外壳样式 | 说明 |
|---------|------|
| 标题(`title`) | 由 `options.title` 传入,Shell 渲染 |
| 关闭按钮 | Shell 统一渲染 |
| 外层 padding | Modal/Drawer Shell 自带 |
| 外层 border / border-radius | Shell 负责 |
| 外层背景色(`bg-bg-black-primary-alt` 等) | Shell 负责 |
| 响应式容器差异(PC rounded vs Mobile rounded-t) | Shell 根据 containerType 自动处理 |

## 核心规则

- **`openResponsive` / `openModal` / `openDrawer` 只能出现在弹窗组件文件内部**,禁止业务调用方直接使用
- **标题(`title`)和描述(`description`)禁止写在组件 JSX 中**,必须通过 `open*` 方法的 `options` 传入
- 外部调用方只 import `open*` 方法,不直接引用弹窗内容组件
- 命名规则:`open` + 组件名(如 `FundWalletDialog` → `openFundWalletDialog`)

## 标准模式

每个弹窗组件文件必须导出两样:

1. **弹窗内容组件** — 只负责内容区渲染;需要 `close` / `resolve` 时才接收 `ModalInjectedProps`,用不到则不导入
2. **`open*` 方法** — 封装 `openResponsive` / `openModal` / `openDrawer` 调用,将 `title` / `description` / `classes` 等 Shell 配置收敛在此

## 实操要点

- 对照 Figma 时,忽略最外层弹窗壳(标题栏 / 关闭按钮 / 容器 padding/border/rounded/bg),只关注壳内内容区
- 组件根元素用 `w-full`,不加 `p-*` / `border` / `rounded-*` / `bg-bg-black-*` 壳层样式
- 设计稿中内容区域内部的 padding/border(如卡片、输入框)属于内容样式,正常添加

---

## 详情查阅

完整示例(无 props / 带 props / openDrawer / Promise 弹窗)与调用范式:
- **`kit/projects/<CURRENT_PROJECT>/patterns.md §modal`**
