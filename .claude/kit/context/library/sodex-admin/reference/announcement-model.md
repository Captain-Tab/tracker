# Announcement 数据模型与实现

> 现有后端的公告模块基于共享消息基础设施，与前端 spec 的跨渠道推送系统有本质差异。

## 数据模型

### BizMessage（统一消息表）

```go
type BizMessage struct {
    ID          int64    // PK, AUTO_INCREMENT
    ExternalID  *string  // Zendesk 原始 ID（迁移兼容）
    MessageType string   // "announcement" | "notification"
    TargetType  string   // "all"(全用户) | "csv"(指定用户)
    Style       string   // "regular" | "alert"
    Title       string   // 多语言 JSON: {"en":"...","zh":"..."}
    Content     string   // 多语言 HTML JSON: {"en":"<p>...</p>"}
    LabelNames  *string  // 标签，逗号分隔
    PublishedBy *string  // 发布人用户名
    Status      int32    // 0(草稿) | 1(已发布) | 2(已撤回)
    TargetCount int32    // CSV 模式的目标用户数
    StartTime   int64    // 生效开始时间（秒戳，0=立即）
    EndTime     int64    // 生效结束时间（秒戳，0=永久）
    CreateTime  int64
    UpdateTime  int64
}
// 索引: uk_external_id, idx_status_type(status, message_type), idx_start_end
```

### BizMessageTarget（目标用户表，仅 CSV 模式）

```go
type BizMessageTarget struct {
    ID            int64
    MessageID     int64   // FK → BizMessage
    WalletAddress string  // 目标用户钱包地址
    CreateTime    int64
}
// 唯一约束: (message_id, wallet_address)
```

### BizMessageReadState（已读状态，位图设计）

- 用于站内信已读状态持久化
- `read_bitmap`: MEDIUMBLOB 支持 1000 万+ 条消息

## Handler 层实现

```go
// 所有 handler 通过 announcementCtx() 注入类型约束
func announcementCtx(r *http.Request) context.Context {
    return WithExpectedType(r.Context(), MessageTypeAnnouncement)
}

// Create 时通过 ToInternal() 转换请求类型
CreateAnnouncementRequest.ToInternal() → CreateMessageRequest {
    MessageType: "announcement",
    TargetType: "all",  // 公告固定全用户
    ...
}
```

## Logic 层核心逻辑

### CreateMessageLogic

1. 验证 style（regular|alert）
2. 多语言 title/content 必须包含 `en`
3. `SanitizeJSONContent` + `ValidateBannerContent` 防 XSS
4. 序列化多语言字段为 JSON 入库
5. 记录操作者 userID

### PublishMessageLogic

1. 验证状态为草稿(0)
2. 写入 PublishedBy
3. Status 0 → 1

### RevokeMessageLogic

1. 验证状态为已发布(1)
2. Status 1 → 2

## Types 定义

### 常量

```go
MessageTypeAnnouncement = "announcement"
MessageStatusDraft      = 0
MessageStatusPublished  = 1
MessageStatusRevoked    = 2
```

### 请求/响应

```go
type CreateAnnouncementRequest struct {
    Style      string            // regular | alert
    Title      map[string]string // {"en":"...","zh":"..."}
    Content    map[string]string // {"en":"...","zh":"..."}
    LabelNames []string
    StartTime  int64
    EndTime    int64
}

type MessageDetailResponse struct {
    ID          int64
    ExternalID  string
    MessageType string
    Status      int32
    Style       string
    Title       map[string]string
    Content     map[string]string
    LabelNames  []string
    TargetType  string
    TargetCount int32
    PublishedBy string
    StartTime   int64
    EndTime     int64
    CreateTime  int64
    UpdateTime  int64
}
```

## 与前端 spec 的差异

| 维度 | 现有后端 | 前端 spec 期望 |
|------|---------|---------------|
| 数据模型 | 共享 BizMessage 表，message_type 区分 | 独立 6 张表（announcement/delivery/template 等） |
| 渠道 | 无外部渠道，仅站内展示 | TG/Discord/Twitter/Zendesk 4 渠道推送 |
| 端点数 | 7 个（CRUD + 发布/撤回） | 22 个（含模板、目标、渠道管理） |
| 状态流 | draft → published → revoked | sent/failed/partial/scheduled/queued |
| 内容格式 | 多语言 JSON（en/zh） | 单语言 + 独立 twitterBody/zendeskBody |
| 目标模型 | all/csv（钱包地址） | TG chatId+topicId / Discord webhook / Zendesk instance |
