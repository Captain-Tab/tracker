# {{project}} 模式规范

> L1 查阅文件 — `/k:ui` 读取

## §responsive 响应式

{{TODO: 例如
- PC-first(先 PC,再适配 Mobile) | Mobile-first
- 布局调整用 CSS 变体(mobile:/pc:)
- 结构差异才用 useIsMobileScreen() hook
- 表格用 ResponsiveTable,弹窗用 ModalHost/modalManager
}}

## §modal 弹窗 / Drawer

{{TODO: 例如
- 弹窗组件只负责内容区
- 外壳由 modalManager Shell 层提供(title/close/padding/bg)
- 每个弹窗文件导出:内容组件 + open* 方法
- openResponsive / openModal / openDrawer 只在弹窗组件文件内部使用
- 命名:open + 组件名
}}

## §naming 子组件命名

{{TODO: 例如
- PC/Mobile 拆分:Pc{Name}.tsx / Mobile{Name}.tsx
- 私有文件不从 feature index.ts 导出
- 数据 hook 在父组件调用,通过 props 传入 PC/Mobile 子组件
}}

## §directory 目录结构

{{TODO: 例如
- feature 位置: src/features/<feature>/
- domain: src/features/<feature>/domain/
- stories: src/features/<feature>/domain/stories/<name>/
- 禁止跨 feature 共享 domain
}}
