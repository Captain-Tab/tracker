# Agent 导航指南

> 快速定位项目中的关键文件和模块。

## 新增页面

1. 在 `src/pages/` 下创建页面目录
2. 在 `src/router/menuConfig.ts` 中添加菜单项和路由
3. 权限代码格式：一级 `page:${module}`，二级 `page:${parent}:${child}`

## 新增 API

1. 在 `src/http/` 下创建模块目录 (index.ts + type.d.ts)
2. 使用 `src/http/request.ts` 导出的 get/post/put/del 方法
3. 响应类型使用 `BackendResponse<T>` 包装

## 关键文件索引

| 需要 | 去找 |
|------|------|
| 添加路由/菜单 | src/router/menuConfig.ts |
| 权限守卫 | src/router/PermissionRoute.tsx |
| HTTP 请求封装 | src/http/request.ts |
| 用户认证上下文 | src/context/UserProvider.tsx |
| MFA 验证包装 | src/context/MfaProvider.tsx |
| 币对数据 | src/context/SymbolProvider.tsx |
| 环境配置 | src/config/index.ts |
| API Base URL | src/config/adminOrigin.ts |
| 主布局 | src/layouts/MainLayout.tsx |
| 侧边栏 | src/layouts/Sidebar.tsx |
| 全局样式/主题 | src/index.css |
| 工具函数 | src/utils/ |
| 基础 UI 组件 | src/components/ui/ |
| 业务组件 | src/components/my/ |
| 企业级组件 | src/components/pro/ |
| 定制组件 | src/components/customize/ |
| MFA 组件 | src/components/mfa/ |

## 新增模块标准流程

1. 页面：`src/pages/{module}/index.tsx`
2. API：`src/http/{module}/index.ts` + `type.d.ts`
3. 路由：`menuConfig.ts` 添加 MenuItem
4. 权限：后端创建权限码，menuConfig 配置 code 字段
