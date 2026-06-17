# ProTable 使用模式

## 核心概念

ProTable 封装了异步请求 + 分页 + 筛选 + 竞态防护，位于 `@/components/pro`。
内部使用 MyTable 渲染，自动处理 loading、空状态、分页器。

## 基本用法

```tsx
import { ProTable, type ProColumn } from "@/components/pro";

const columns: ProColumn<API.Spot.Symbols.Datum>[] = [
  { title: "币对", dataIndex: "name", align: "left" },
  {
    title: "状态",
    key: "status",
    render: (_, record) => <StatusBadge text={record.status} />,
  },
];

<ProTable<typeof getSpotList>
  request={getSpotList}
  columns={columns}
  rowKey="id"
  pagination={{ defaultPageSize: 10 }}
/>
```

## ProColumn 定义

| 属性 | 说明 |
|------|------|
| `title` | 列标题，支持 ReactNode |
| `dataIndex` | 数据字段名（自动取值） |
| `key` | 唯一标识（不传默认用 dataIndex） |
| `render` | `(value, record, index) => ReactNode` 自定义渲染 |
| `align` | `left / center / right` |

## ProFilter 配合使用

通过 `filter` prop 内置筛选区，筛选值自动合并到 request params：

```tsx
<ProTable
  request={spotRequest}
  columns={columns}
  filter={{
    fields: [
      { name: "name", label: "币对", type: "input", placeholder: "按名称搜索" },
      { name: "status", label: "状态", type: "select", options: statusOptions },
    ],
    initialValues: {},
  }}
  pagination={{ defaultPageSize: 10 }}
/>
```

筛选字段支持 `requestName`（接口字段名与 UI 字段名不同时）和 `transform`（值转换）。

## 分页配置

- 不传 `pagination`：不分页，不渲染分页器
- `pagination={{ defaultPageSize: 10 }}`：启用分页，自动带 page/size 参数

## 常用配置

| prop | 默认值 | 说明 |
|------|--------|------|
| `params` | - | 额外请求参数（除 page/size/filter） |
| `paramsDeps` | - | 自定义依赖数组（复杂对象时使用） |
| `paramsTransformer` | - | 发请求前参数清洗/转换 |
| `formatter` | 取 `resp.data.list/total` | 自定义响应数据提取 |
| `debounceWait` | 500 | 参数变化防抖（ms） |
| `omitEmptyParams` | true | 自动去除 undefined/null/"" 参数 |
| `actionRef` | - | 暴露 `refetch()` 供业务手动刷新 |
| `onRequestSuccess` | - | 请求成功回调（竞态安全） |
| `toolbar.create` | - | 创建按钮，支持 href 或 onClick |
| `loading` | - | 外部 loading 覆盖内部状态 |
| `autoRefreshOnParamsChange` | true | 参数变化时自动刷新 |

## ProFilter 额外 props

| prop | 说明 |
|------|------|
| `defaultOpen` | 筛选区默认展开状态 |
