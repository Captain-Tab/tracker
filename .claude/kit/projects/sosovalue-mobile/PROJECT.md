# {{project}} 项目规范

> L0 入口文件 — `/k:ui` 和 `/k:figma` 命令启动时读取

## 基础身份

- **框架**: {{React + Tailwind vX + MobX}}
- **Token 体系**: {{mature | basic | none}}
- **断点**: {{mobile(<760) / pc(≥760)}}
- **theme.css**: {{自动生成(只读) | 手写 | 不使用}}

## 硬约束

@constraints.md

## 按需加载路由

| 任务场景 | 读取文件 |
|---------|---------|
| 从 Figma 生成代码 | figma-mapping.md + tokens.md |
| 写新组件 | components.md + patterns.md |
| UI 还原自检 | style-checklist.md |
| 响应式结构决策 | patterns.md §responsive |
| 弹窗 / Drawer | patterns.md §modal |
| 新增设计 token | tokens.md §生成流程 |

## 扩展区

新增维度规范步骤:

1. 在本项目目录新建 `<topic>.md`
2. 在"按需加载路由"表格追加一行
3. 通用化时同步到 `kit/projects/_template/<topic>.md`
