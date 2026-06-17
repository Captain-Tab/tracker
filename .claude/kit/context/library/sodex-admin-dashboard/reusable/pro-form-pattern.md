# ProForm / MyForm 使用模式

## ProForm vs MyForm 选择

| 特性 | ProForm | MyForm |
|------|---------|--------|
| 定位 | 轻量表单（增删改页面） | 通用表单（config 驱动） |
| schema | 可选（推荐传） | 必传 |
| 布局 | `gridClassName` 自定义 | `layout: single/double/grid` |
| 字段类型 | input/textarea/select/switch | + date/custom |
| 动态字段 | options/disabled 支持函数 | 不支持 |
| ref 暴露 | 无 | `MyFormRef`（submit/reset/setValue） |

**推荐**：新页面优先使用 ProForm，MyForm 用于需要 ref 操作或 date 字段的场景。

## ProForm 基本用法

```tsx
import { z } from "zod";
import { ProForm } from "@/components/pro";

const schema = z.object({
  openOrderLimit: z.coerce.number().min(0).int().nullable().optional(),
  remark: z.string().optional(),
});

<ProForm<typeof schema>
  schema={schema}
  defaultValues={{ openOrderLimit: 1000, remark: "" }}
  fields={[
    { name: "openOrderLimit", label: "挂单限制", type: "input", placeholder: "默认 1000" },
    { name: "remark", label: "备注", type: "textarea", placeholder: "备注说明" },
  ]}
  onFinish={async (values) => {
    await updateRatelimit(values);
    toast.success("更新成功");
  }}
  submitText="保存"
  showReset={false}
/>
```

## 编辑页：外部 values 回填

传入 `values` prop，数据变化时自动 reset 表单：

```tsx
<ProForm
  schema={schema}
  defaultValues={defaultValues}
  values={detailData}        // 详情接口返回的数据
  loading={detailLoading}    // 详情加载中时禁用表单
  fields={fields}
  onFinish={handleUpdate}
/>
```

## 动态字段依赖

`options` 和 `disabled` 支持传入函数，参数为当前表单所有字段值：

```tsx
{
  name: "subType",
  label: "子类型",
  type: "select",
  options: (values) => values.mainType === "A" ? optionsA : optionsB,
  disabled: (values) => !values.mainType,        // 布尔或函数均可
  // disabled: true                               // 静态禁用
  // disabled: (values) => values.status === 'locked'  // 动态禁用
}
```

## 自定义渲染（render）

完全接管字段渲染，value/setValue 由 RHF 控制：

```tsx
{
  name: "symbols",
  label: "关联币对",
  type: "input",
  render: ({ value, setValue, disabled }) => (
    <PairMultiSelect value={value} onChange={setValue} disabled={disabled} />
  ),
}
```

## 布局控制

通过 `gridClassName` 自定义网格布局：

```tsx
<ProForm gridClassName="grid-cols-2 gap-4" ... />  // 两列布局
<ProForm gridClassName="grid-cols-1 gap-2" ... />   // 单列（默认）
```
