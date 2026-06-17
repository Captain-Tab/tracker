# 错误处理策略（sodex-next 参考）

> 来源：sodex-next/docs/error-handling.md
> 用途：migration execute 阶段，迁移涉及错误处理逻辑时参考

## 错误分类

| # | 类别 | 来源 | 示例 |
|---|---|---|---|
| 1 | 网络/传输层错误 | Infra | HTTP 超时、网络断开、HTTP 4xx/5xx、WS 断连 |
| 2 | 钱包签名错误 | Infra | 用户拒绝签名、签名超时 |
| 3 | 业务逻辑错误 | API 返回，Service 转译 | 余额不足、订单不存在、市场暂停 |
| 4 | 客户端校验错误 | Domain | 价格不符合 tickSize、数量不符合 lotSize |

## 全局错误拦截（httpClient 层）

401（认证）和 503（维护）由 `shared/infra/httpClient.ts` 响应拦截器统一处理，不属于 feature 级错误。

接口注入设计：httpClient 定义 `AuthInterceptor` 接口 + `registerAuthInterceptor()` 注册函数，feature/auth 提供实现，app/providers 初始化时注入。shared 不依赖 feature。

## 每层的错误职责

### Infra：结构化原始错误
- 捕获 HTTP/WS/签名原始异常，转为 `InfraError` 类型

### Service：错误转译 + 重试决策
- `mapInfraError()` 将 InfraError 转为 `ServiceError`

| 错误类型 | 自动重试 | 策略 |
|---|---|---|
| NETWORK_UNAVAILABLE | 是 | 最多 2 次，exponential backoff |
| SERVER_ERROR (5xx) | 是 | 最多 2 次，exponential backoff |
| RATE_LIMITED (429) | 是 | 按 retryAfterMs 等待后重试 1 次 |
| SIGNATURE_REJECTED | 否 | 用户主动拒绝 |
| 所有业务错误 (4xx) | 否 | 参数/状态问题，重试无意义 |

### Container：错误展示 + 用户引导
- `handleServiceError()` 将 ServiceError 映射为 UI toast

## 类型设计原则

使用 **discriminated union**（不用 class 继承）：
- 可序列化（能存 React Query error cache、能 log）
- `switch (error.type)` 有 exhaustive check
- 不依赖 `instanceof`
- 保留 `cause` 字段链接原始错误
