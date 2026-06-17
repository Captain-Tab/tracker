# api-contract

跨迁移的 **API 契约对齐** 类坑。

---

## api-contract:baseURL-naming

- **tags**: api, baseURL, constant-naming
- **severity**: high
- **created**: 2026-04-22
- **source**: sodex-web → sodex-next vault My Records

### 触发场景

迁移 API 客户端，老项目 `config/env.ts` 或类似位置有多个 `*_URL` 常量（`XXX_CHAIN_STATUS_API_SERVER_URL`、`XXX_MIRROR_API_SERVER_URL` 等）。

### 典型症状

- 请求 404 / ECONNREFUSED
- 本地 dev proxy 转发失败
- 后端日志找不到对应 endpoint

### 根因

常量命名与实际值不一致——**名字语义带误导**。典型：

```ts
// 老项目：名字暗示"链状态域"，值其实是 biz 域
export const CHAIN_STATUS_API_SERVER_URL = "https://alpha-biz.sodex.dev";
```

新项目按字面名分发到 `chainClient`（真正的 chain 域） → 路径打错。

### 避坑动作

1. 接入新 httpClient 前，grep 常量的**实际字符串值**：
   ```bash
   grep -A1 "_URL =" src/config/env.ts
   ```
2. 按**实际 domain** 归类 client（biz / chain / gateway），不按常量名字面语义
3. analyze 阶段的 API 清单里，标注每个 endpoint 的 **完整 URL 字面量**，而不是常量名

### 检测建议

verify 阶段开 DevTools Network 面板，核实 request URL 与老项目同域名/同路径。

### 本次来源

sodex-web `CHAIN_STATUS_API_SERVER_URL = "https://alpha-biz.sodex.dev"`（biz 域）；sodex-next `fetchVaultMyActivity` 误按 chainClient 路由到 `sodex.dev/mainnet` → My Records 404。修复：改回 `bizClient`。
