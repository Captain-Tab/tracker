# SoDEX Admin 后端项目概览

> SoDEX 去中心化交易所管理后台的 Go 后端服务，提供 REST API、JWT 鉴权和 RBAC 权限管理。

## 技术栈

- **框架**: go-zero v1.8.3（HTTP/RPC 框架）
- **ORM**: GORM v1.30.0 + GORM Gen 0.3.24（代码生成）
- **数据库**: MySQL（双库：Admin DB + Biz DB）
- **缓存**: Redis v9.8.0
- **认证**: JWT v4.5.2（HS256）+ Lark OAuth
- **可观测性**: OpenTelemetry + Prometheus
- **其他**: go-ethereum v1.16.0、OTP v1.5.0（MFA）

## 项目结构

```
sodex-admin/
├── main.go                      # 入口，加载配置注册路由
├── etc/admin.yaml               # YAML 配置（MySQL×2、Redis、JWT、Lark、S3）
├── internal/
│   ├── handler/routes.go        # 所有路由统一注册
│   ├── handler/<module>/        # 各模块 Handler（15+ 子模块）
│   ├── logic/<module>/          # 业务逻辑层（直接操作 GORM）
│   ├── middleware/              # JWT + RBAC 中间件
│   ├── svc/service_context.go   # 依赖注入容器
│   ├── config/config.go         # 配置结构体
│   ├── types/                   # 请求/响应类型定义
│   └── service/                 # 跨模块服务（通知、日志）
├── gen/
│   ├── admin/model/             # Admin DB 模型（User、Role、Permission）
│   ├── biz/model/               # Biz DB 模型（Message 等业务数据）
│   └── generator.go             # GORM Gen 代码生成配置
├── pkg/utils/                   # 公共工具（JWT、Lark Webhook、安全校验）
├── scripts/                     # SQL 初始化脚本（权限、角色）
└── go.mod
```

## 架构模式

### 三层架构（无 Repository 层）

```
Handler（解析请求/响应） → Logic（业务逻辑） → GORM DB
                                             ↘ Service（跨模块服务）
```

- Handler 层：HTTP 路由与请求解析，使用 `httpx.Parse()` + `httpx.OkJsonCtx()`
- Logic 层：业务逻辑，通过 ServiceContext 注入获取 DB 连接，直接操作 GORM
- Service 层：跨模块服务（LarkService、UserService、NotificationService、OperationLogService）

### 双数据库架构

- **Admin DB**: 管理权限、角色、用户、操作日志
- **Biz DB**: 业务数据（消息、Banner 等）
- 连接池：MaxOpen=50, MaxIdle=10, MaxLifetime=1h

### 依赖注入（ServiceContext）

```go
type ServiceContext struct {
    Config                 *config.Config
    AdminDB                *gorm.DB
    BizDB                  *gorm.DB
    Redis                  *redis.Redis
    Query                  *adminQuery.Query   // Admin DB 类型安全查询
    BizQuery               *bizQuery.Query     // Biz DB 类型安全查询
    LarkAuthMiddleware     rest.Middleware
    PermissionMiddleware   *permission.PermissionMiddleware
    InternalAuthMiddleware rest.Middleware
    LarkClient             *lark.Client
    JWTManager             *utils.JWTManager
    S3Client               *s3.Client
    LarkConfig             *types.LarkConfig
}
```

## 鉴权体系

### 中间件链

```
请求 → LarkAuthMiddleware(JWT 验证) → PermissionMiddleware(RBAC) → Handler
```

1. **LarkAuthMiddleware**: 从 `Authorization: Bearer <token>` 提取 JWT，验证签名+过期+用户存在+未禁用，注入 user_id/username/email 到 context
2. **PermissionMiddleware**: `RequirePermission(code)` 装饰器，三层联查 Permission ← RolePermission ← UserRole

### RBAC 模型

- 用户 → 角色（多环境 manyToMany）→ 权限（manyToMany）
- 角色级别：super_admin(1) > admin/admin_plus(2) > ops_admin(3) > viewer(4)
- 权限类型：Type=1 页面权限（`page:announcements`）、Type=2 API 权限（`api:announcement:list`，支持路径通配符）
- 环境隔离：用户在 mainnet/preview 可拥有不同角色

## 统一响应格式

```json
{ "code": 0, "message": "success", "data": {...}, "timestamp": 1234567890 }
```

错误码：0(成功) / 400(参数) / 401(未认证) / 403(无权限) / 404(不存在) / 500(服务器)

## 核心功能模块

| 模块 | 页面权限码 | API 权限码前缀 | 说明 |
|------|-----------|---------------|------|
| 公告管理 | `page:announcements` | `api:announcement:*` | CRUD + 发布/撤回（7 端点） |
| 站内信 | `page:notifications` | `api:notification:*` | CRUD + 发布/撤回 + CSV 上传 |
| Banner | `system:banner` | `api:banner:*` | CRUD + URL 白名单 |
| 风控管理 | `page:risk-control` | `api:risk-control:*` | 代币/用户风控等级 |
| 币对配置 | `page:symbol-config` | `api:symbol-config:*` | 交易对配置 |
| 用户管理 | `page:systemManager:users` | `api:user:*` | 管理员 CRUD |
| 角色管理 | `page:systemManager:roles` | `api:role:*` | 角色 CRUD |
| 权限管理 | `page:systemManager:permission` | `api:permission:*` | 权限定义 |
| 操作日志 | `page:systemManager:operation-log` | — | 审计日志查看 |

## 外部集成

- **Lark（飞书）**: OAuth 登录 + Webhook 通知（风控变更、全局维护）
- **S3**: 文件上传（Banner 图片、CSV 等）
- **无**: Telegram / Discord / Twitter / Zendesk（前端 spec 需要，后端尚未实现）

## 配置管理

YAML 配置文件（`etc/admin.yaml`）+ Go 结构体绑定，支持 Nacos。关键配置段：

```yaml
Mysql:
  AdminDatasource: "..."   # Admin DB
  BizDatasource: "..."     # Biz DB
Auth:
  AccessSecret: "..."      # JWT 密钥
  AccessExpire: 7200        # 秒
Lark:
  AppId / AppSecret / WebhookURL / RiskControlWebhookURL
S3:
  Region / Bucket / AccessKey / SecretKey / BaseURL
```
