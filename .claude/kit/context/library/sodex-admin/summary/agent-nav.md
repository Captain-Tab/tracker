# Agent 导航指南 — sodex-admin (Go 后端)

> 快速定位 Go 后端项目中的关键文件和模块。

## 新增 API 模块

1. 在 `internal/handler/<module>/` 下创建 handler 文件
2. 在 `internal/logic/<module>/` 下创建 logic 文件
3. 在 `internal/types/` 下定义请求/响应结构体
4. 在 `internal/handler/routes.go` 中注册路由 + 权限码
5. 在 `scripts/` 中添加权限初始化 SQL

## 关键文件索引

| 需要 | 去找 |
|------|------|
| 路由注册 | internal/handler/routes.go |
| JWT 中间件 | internal/middleware/lark_auth_middleware.go |
| RBAC 权限中间件 | internal/middleware/permission/ |
| 依赖注入容器 | internal/svc/service_context.go |
| 配置结构体 | internal/config/config.go |
| 配置文件 | etc/admin.yaml |
| JWT 工具 | pkg/utils/jwt.go |
| Lark Webhook | pkg/utils/lark_webhook.go |
| XSS 防护 | pkg/utils/banner_security.go |
| Admin DB 模型 | gen/admin/model/ |
| Biz DB 模型 | gen/biz/model/ |
| GORM Gen 生成器 | gen/generator.go |
| 权限初始化 SQL | scripts/init_*_permissions.sql |
| 消息模型（公告/站内信共用） | internal/model/biz_message.go |

## 架构约束

- **三层架构**: Handler → Logic → GORM（无 Repository 层）
- **双数据库**: Admin DB（权限角色） + Biz DB（业务数据）
- **统一响应**: `{ "code": 0, "message": "success", "data": {...}, "timestamp": ... }`
- **权限码格式**: 页面 `page:<module>`，API `api:<module>:<action>`
- **消息类型隔离**: Handler 通过 `WithExpectedType()` 注入类型约束，防止跨类型访问

## Announcement 模块注意事项

现有公告模块是简单的站内公告 CRUD（共享 BizMessage 表），前端 spec 需要的跨渠道推送系统（22 端点、4 渠道集成）需要大幅扩展后端。差异详见 `reference/announcement-model.md`。
