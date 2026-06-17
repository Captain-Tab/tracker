# sodex-next Shared UI 组件清单

> L1 查阅文件 — `/k:ui` 读取

在 `features/`、`pages/` 或业务组件中编写 UI 时,**必须优先使用 `@/shared/components/ui` 中已有的基础组件**,禁止用原生 HTML 元素或自行实现等价功能。

## 必用组件

| 场景 | 使用组件 | 禁止替代 |
|-----|---------|---------|
| 按钮 | `Button` | `<button>` 裸标签 |
| 输入框 | `Input`、`NumberInput`、`LabeledNumberInput` | `<input>` 裸标签 |
| 下拉选择 | `Select` | `<select>` 裸标签、自建下拉 |
| 菜单/右键菜单 | `Menu` | 自建 dropdown |
| 弹窗/对话框 | `Dialog` | `<dialog>` 裸标签、自建 modal |
| 抽屉 | `Drawer` | 自建侧边抽屉 |
| 气泡提示 | `Popover` | 自建 popover |
| 工具提示 | `Tooltip` | `title` 属性、自建 tooltip |
| 表格 | `Table`、`MTable` | `<table>` 裸标签 |
| 标签页 | `Tabs`、`OverflowMenuTabs` | 自建 tab 切换 |
| 复选框 | `Checkbox` | `<input type="checkbox">` |
| 开关 | `Switch` | 自建 toggle |
| 滑块 | `Slider`、`SliderInput` | `<input type="range">` |
| 徽标 | `Badge` | 自建 badge span |
| 加载 | `Spinner` | 自建 loading |
| 图标 | `Icons.*` | 内联 SVG、自行引入图标库 |
| 图片 | `Image` | `<img>` 裸标签 |
| 折叠 | `Collapse`、`CollapseGroup` | 自建手风琴 |
| 时间线 | `Timeline` | 自建 timeline |
| 数值展示 | `CompactNumber`、`Percent`、`Price`、`Qty` | 手写格式化 + span |
| 标签值对 | `LabelValue` | 手写 label-value 布局 |
| 分割线 | `Divider` | `<hr>` 裸标签 |
| 二维码 | `QRCodeDisplay` | 自行引入二维码库 |
| 卡片 | `Card` | 自建卡片容器 |
| 布局 | `HStack`、`VStack`、`Grid`、`Box`、`Container`、`Spacer`、`Stack`、`Section`、`Inline` | — |
| 图表 | `LineChart`、`BarChart`、`PieChart` | 直接使用图表库 |

## 执行流程

1. **写 UI 代码前**:扫描上表,确认是否有可复用组件
2. **若组件存在但不完全匹配**:优先通过 props/组合方式适配,而非自建新组件
3. **若确实无匹配**:可使用原生标签,但需在代码旁添加注释说明为何 shared 组件不适用
4. **若多处需要同一个缺失组件**:在 `shared/components/ui/` 中新建(遵循 `docs/create-shared-ui-component.md`)

## 检查方式

生成代码后,扫描 JSX 中的原生 HTML 标签。若出现以下标签且上表有对应组件,**必须替换**:

`<button>`、`<input>`、`<select>`、`<table>`、`<dialog>`、`<img>`、`<hr>`、`<input type="checkbox">`、`<input type="range">`

## 原生标签例外

- `<div>`、`<span>`、`<p>`、`<h1>`~`<h6>`、`<a>`、`<form>`、`<label>` 等无对应 shared 组件的基础标签不受此规则限制
- `shared/components/ui/` 内部实现代码不受此规则限制(基础组件本身可使用原生标签)
- 第三方库内部渲染不受控制,不在检查范围

## 组件源路径

`src/shared/components/ui/`
