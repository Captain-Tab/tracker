# HTTP 请求规范

## Axios 实例配置

文件：`src/http/request.ts`

- `baseURL`：从 `getConfig().BASE_URL` 获取，开发环境通过 Vite 代理自动置空
- `timeout`：10000ms
- `Content-Type`：application/json

## 请求拦截器

- 开发环境（`import.meta.env.DEV`）且未设 `shouldNotUseProxyWhenDev` 时，`baseURL` 置空（走 Vite 代理）
- 从 `userCookies.get()` 读取 JWT，设置 `Authorization: Bearer <token>`
- `skipAuthorization: true` 时不附加 token

## 响应拦截器

成功响应（HTTP 2xx）：
- `code === 0 || code === 200` → 返回 `{ success: true, data, msg }`
- 其他 code → `skipErrorHandler` 为 true 时返回结果，否则 `toast.error(msg)` 并 reject

HTTP 错误：
- 401 → 清除 cookie/storage，跳转 `/login`（`skipAuthorization` 时仅返回错误）
- 其他状态码 → 统一包装为 `Error` 对象，附加 `code` 和 `originalError`

## 类型定义

```typescript
// src/http/request.ts
interface BackendResponse<T> {
  code: 0 | 1 | 200;
  success?: boolean;
  error?: boolean;
  data: T;
  msg: string;
}

// src/http/type.d.ts
type API.PaginationResponse<T> = {
  list: T[];
  total: number;
  page: number;
  size: number;
};
```

## 封装方法

`get<T>`, `post<T>`, `put<T>`, `del<T>`, `patch<T>` — 均返回 `Promise<BackendResponse<T>>`。
另有 `download`（文件下载）和 `all`（并发请求）。

## RequestConfig 扩展选项

| 字段 | 类型 | 说明 |
|------|------|------|
| `showError` | boolean | 是否显示错误提示 |
| `skipErrorHandler` | boolean | 跳过错误处理（不弹 toast，不 reject） |
| `shouldNotUseProxyWhenDev` | boolean | 开发环境不使用代理 |
| `skipAuthorization` | boolean | 不附加 Authorization header |
| `retry` | number | 重试次数 |

## RequestOptions 接口

请求方法的第三个参数，控制错误处理行为：

```typescript
interface RequestOptions {
  skipErrorHandler?: boolean;   // 跳过错误处理
  skipReqError?: boolean;       // 跳过请求错误
  [key: string]: unknown;
}
```

## API 模块标准结构

```
src/http/<module>/
  index.ts      — API 函数导出
  type.d.ts     — 请求/响应类型（放在 API namespace 下）
```

## 新增 API 模块示例

```typescript
// src/http/example/type.d.ts
declare namespace API {
  namespace Example {
    type Item = { id: number; name: string };
    type ListParams = { page: number; size: number };
  }
}

// src/http/example/index.ts
import { get, post } from "@/http/request";

export const getExampleList = (params: API.Example.ListParams) =>
  get<API.PaginationResponse<API.Example.Item>>("/api/example/list", params);

export const createExample = (data: Partial<API.Example.Item>) =>
  post<API.Example.Item>("/api/example/create", data);
```
