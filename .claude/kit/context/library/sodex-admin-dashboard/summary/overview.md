# SoDEX Admin Dashboard 项目概览

> SoDEX 去中心化交易所管理后台，用于运营和系统管理。

## 技术栈

- **框架**: React 19 + TypeScript 5.8
- **构建**: Vite 7
- **样式**: Tailwind CSS 4 (OKLCH 色彩空间，明暗主题)
- **组件库**: shadcn/ui (基于 Radix UI)
- **路由**: React Router DOM 7
- **HTTP**: Axios
- **表单**: React Hook Form + Zod 校验
- **图表**: ECharts 5
- **工具**: ahooks, dayjs, lodash, decimal.js-light

## 核心功能模块

| 模块 | 路径 | 权限码 |
|------|------|--------|
| 通知栏(Banner)管理 | /banners | page:banners |
| 风险控制 | /risk-control | page:risk-control |
| 币对管理 | /symbols | page:symbol-config |
| 用户管理 | /users | page:systemManager:users |
| 角色管理 | /roles | page:systemManager:roles |
| 权限管理 | /permissions | page:systemManager:permission |
| 操作日志 | /operation-logs | page:systemManager:operation-log |

## 架构模式

- **SPA 应用**: 纯前端单页应用，无 SSR
- **状态管理**: React Context (UserProvider, MfaProvider, SymbolProvider)
- **认证方式**: JWT Token，通过 Lark (飞书) OAuth 登录
- **MFA**: 支持 TOTP 二次验证
- **HTTP 层**: Axios 实例封装，统一拦截器/错误处理，`BackendResponse<T>` 响应类型
- **环境配置**: dev / test / production，通过 `VITE_ENV_NAME` 切换

## 目录结构

```
src/
  components/   # UI 组件
    ui/         # shadcn/ui 基础组件
    my/         # 业务通用组件 (My*)
    pro/        # 企业级组件 (Pro*)
    customize/  # 定制组件 (Customize*)
    mfa/        # MFA 验证组件
  config/       # 环境配置
  context/      # React Context (User, Mfa, Symbol)
  hooks/        # 自定义 Hooks
  http/         # API 请求层 (按模块组织)
  layouts/      # 布局组件 (MainLayout, Sidebar)
  lib/          # 工具库
  pages/        # 页面组件 (按模块目录)
  router/       # 路由配置和权限守卫
  utils/        # 工具函数
```

## 组件体系层次

Radix UI (原语) -> shadcn/ui (基础) -> My* (业务通用) -> Pro* (企业级) -> Customize* (定制)

## 样式体系

Tailwind CSS 4 + OKLCH 色彩空间，支持明暗主题切换 (next-themes)。

## 部署方式

Docker + Nginx 静态资源部署。
