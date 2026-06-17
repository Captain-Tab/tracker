# 路由配置

## 架构

React Router v7 + `menuConfig` 驱动。`menuConfig`（`src/router/menuConfig.ts`）是路由和侧边栏菜单的单一数据源。

布局嵌套：`<MainLayout>` 包含顶部栏 + 侧边栏 + `<Outlet />`，所有业务路由均渲染在 `<Outlet />` 内。

## 路由表

| 路径 | 权限码 | 组件 | 说明 |
|------|--------|------|------|
| `/login` | - | Login | 登录页（Lark OAuth） |
| `/` | - | Navigate → /banners | 默认重定向 |
| `/banners` | `page:banners` | BannersList | 通知栏列表 |
| `/banners/create` | - | CreateBanner | 创建通知栏 |
| `/banners/:id` | - | EditBanner | 编辑通知栏 |
| `/risk-control` | `page:risk-control` | RiskControlPage | 风控面板 |
| `/risk-control/symbol/create` | - | RiskControlSymbolCreate | 创建币对风控 |
| `/risk-control/symbol/:id` | - | SymbolDetail | 币对风控详情 |
| `/risk-control/user/create` | - | RiskControlUserCreate | 创建用户风控 |
| `/risk-control/user/:id` | - | UserDetail | 用户风控详情 |
| `/risk-control/ip-ratelimit/:id` | - | IpRatelimitDetail | IP限速详情 |
| `/risk-control/user-ratelimit/:id` | - | UserRatelimitDetail | 用户限速详情 |
| `/symbols` | `page:symbol-config` | SymbolsPage | 币对管理 |
| `/users` | `page:systemManager:users` | UsersList | 用户管理 |
| `/users/create` | - | CreateUser | 创建用户 |
| `/users/:id` | - | EditUser | 编辑用户 |
| `/roles` | `page:systemManager:roles` | RolesList | 角色管理 |
| `/roles/create` | - | CreateRole | 创建角色 |
| `/roles/:id` | - | EditRole | 编辑角色 |
| `/roles/:id/permissions` | - | RolePermissions | 角色权限 |
| `/permissions` | `page:systemManager:permission` | PermissionsList | 权限管理 |
| `/permissions/create` | - | CreatePermission | 创建权限 |
| `/permissions/:id` | - | EditPermission | 编辑权限 |
| `/operation-logs` | `page:systemManager:operation-log` | OperationLogsList | 操作日志 |
| `/operation-logs/:id` | - | OperationLogDetail | 日志详情 |

## 路由守卫

`PermissionRoute.tsx` 是路由级权限守卫，接收 `permissionCode` prop：
- 调用 `useUserContext().hasPermission(code)` 检查当前用户的 `permissions.page` 数组
- 有权限 → 渲染 `<Outlet />`；无权限 → 渲染"访问被拒绝"页面
- 仅顶层路由（menuConfig 中有 `code` 的路由）受守卫保护，子路由不单独校验

## 如何新增路由

1. 在 `src/pages/` 下创建页面组件
2. 在 `menuConfig`（`src/router/menuConfig.ts`）中添加 `MenuItem`：
   - 设置 `route.path`、`route.code`（权限码）、`IndexElement`、`children`
   - 需要侧边栏显示则设置 `icon` 和 `title`
3. 在后端权限系统中注册对应的 `page:xxx` 权限码
4. 路由渲染和侧边栏菜单会自动从 `menuConfig` 生成，无需额外配置
