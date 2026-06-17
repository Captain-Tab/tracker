# sodex-admin 路由表

> 所有路由在 `internal/handler/routes.go` 统一注册，中间件链：LarkAuth → Permission → Handler

## Announcement（公告）

| 方法 | 路径 | Handler | 权限码 |
|------|------|---------|--------|
| GET | `/api/v1/announcements` | ListHandler | `api:announcement:list` |
| GET | `/api/v1/announcements/:id` | GetHandler | `api:announcement:detail` |
| POST | `/api/v1/announcements` | CreateHandler | `api:announcement:create` |
| PUT | `/api/v1/announcements/:id` | UpdateHandler | `api:announcement:update` |
| DELETE | `/api/v1/announcements/:id` | DeleteHandler | `api:announcement:delete` |
| PUT | `/api/v1/announcements/:id/publish` | PublishHandler | `api:announcement:publish` |
| PUT | `/api/v1/announcements/:id/revoke` | RevokeHandler | `api:announcement:publish` |

### 实现特点

- 公告与站内信共享消息基础设施（BizMessage + BizMessageTarget）
- Handler 层通过 `announcementCtx()` 注入 `MessageType=announcement`，防止跨类型访问
- Create/Update 时 `ToInternal()` 将 AnnouncementRequest 转换为 CreateMessageRequest
- 状态流：draft(0) → published(1) → revoked(2)
- 多语言：title/content 为 JSON 字符串 `{"en":"...","zh":"..."}`

## Notification（站内信）

| 方法 | 路径 | 权限码 |
|------|------|--------|
| GET | `/api/v1/notifications` | `api:notification:list` |
| GET | `/api/v1/notifications/:id` | `api:notification:detail` |
| POST | `/api/v1/notifications` | `api:notification:create` |
| PUT | `/api/v1/notifications/:id` | `api:notification:update` |
| DELETE | `/api/v1/notifications/:id` | `api:notification:delete` |
| PUT | `/api/v1/notifications/:id/publish` | `api:notification:publish` |
| PUT | `/api/v1/notifications/:id/revoke` | `api:notification:publish` |

## Banner

| 方法 | 路径 | 权限码 |
|------|------|--------|
| GET | `/api/v1/banners` | `api:banner:list` |
| GET | `/api/v1/banners/:id` | `api:banner:detail` |
| POST | `/api/v1/banners` | `api:banner:create` |
| PUT | `/api/v1/banners/:id` | `api:banner:update` |
| DELETE | `/api/v1/banners/:id` | `api:banner:delete` |

## Risk Control（风控）

| 方法 | 路径 | 权限码 |
|------|------|--------|
| GET | `/api/v1/risk-control/*` | `api:risk-control:*` |
| POST | `/api/v1/risk-control/*` | `api:risk-control:*` |
| PUT | `/api/v1/risk-control/*` | `api:risk-control:*` |

## User / Role / Permission（系统管理）

| 模块 | 方法 | 路径前缀 | 权限码前缀 |
|------|------|---------|-----------|
| User | CRUD | `/api/v1/users` | `api:user:*` |
| Role | CRUD | `/api/v1/roles` | `api:role:*` |
| Permission | CRUD | `/api/v1/permissions` | `api:permission:*` |

## Auth（认证）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/v1/auth/lark/callback` | Lark OAuth 回调 |
| POST | `/api/v1/auth/refresh` | Token 刷新 |
| GET | `/api/v1/auth/me` | 当前用户信息 |

## Internal（内部服务接口）

使用 InternalAuthMiddleware（非 JWT），供 biz 模块内部调用。
