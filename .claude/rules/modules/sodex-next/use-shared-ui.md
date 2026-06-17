# 强制使用 Shared UI 红线(v1.11.0 瘦身版)

> always-on 注入的硬约束。**完整组件清单 / 场景对应表 / 执行流程**见 `kit/projects/<当前项目>/components.md`。

## 规则

在 `features/` / `pages/` / 业务组件中编写 UI 时,**必须优先使用 `@/shared/components/ui` 已有基础组件**,禁止用原生 HTML 元素或自行实现等价功能。

## JSX 扫描检查(必禁裸标签)

生成代码后扫描 JSX,以下原生标签**必须替换**为对应 shared 组件:

`<button>` `<input>` `<select>` `<table>` `<dialog>` `<img>` `<hr>` `<input type="checkbox">` `<input type="range">`

## 例外

- `<div>` `<span>` `<p>` `<h1>`~`<h6>` `<a>` `<form>` `<label>` 等无对应 shared 组件的基础标签不受限
- `shared/components/ui/` 内部实现代码不受限(基础组件本身可使用原生标签)
- 第三方库内部渲染不受控制,不在检查范围

---

## 详情查阅

完整场景 → 组件对应表(Button / Input / Select / Menu / Dialog / Drawer / Popover / Tooltip / Table / Tabs / Checkbox / Switch / Slider / Badge / Spinner / Icons / Image / Collapse / Timeline / Number / LabelValue / Divider / QRCode / Card / 布局族 / 图表族)、执行流程、"组件存在但不完全匹配"处理方式:
- **`kit/projects/<CURRENT_PROJECT>/components.md`**
