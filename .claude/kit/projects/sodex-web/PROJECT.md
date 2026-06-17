# sodex-web 项目规范

> L0 入口文件 — `/k:ui` 和 `/k:figma` 命令启动时读取

## 基础身份

- **框架**: React + Tailwind + MobX
- **Token 体系**: basic(部分语义 token:`status-up` / `status-down` / `warning-primary`;其余多为 hex 硬编码)
- **断点**: mobile(<760) / pc(≥760)
- **theme.css**: 不使用(直接用 Tailwind 类 + 方括号 hex)
- **主要用途**: trading / staking / vault 业务

## 硬约束

@constraints.md

## 按需加载路由

| 任务场景 | 读取文件 |
|---------|---------|
| 从 Figma 生成代码 | figma-mapping.md + tokens.md |
| 写新组件 | components.md(基础清单,按需补充) |
| UI 还原自检 | style-checklist.md |
| 响应式结构决策 | patterns.md §responsive |
| 新增颜色/样式 | tokens.md §颜色映射 |

## 扩展区

新增维度规范步骤:

1. 在本项目目录新建 `<topic>.md`
2. 在"按需加载路由"表格追加一行
3. 通用化时同步到 `kit/projects/_template/<topic>.md`

## 说明

sodex-web 的 token 体系较 sodex-next 基础,多数背景/文字色为 hex 方括号写法。新增语义 token 时倾向沿用 `status-up` / `status-down` / `warning-primary` 模式,不建立完整 `@theme inline` 体系(成本不匹配)。
