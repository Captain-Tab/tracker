# TG 推送 retry 共享模块

> 新建 `service/lib/notify.mjs`，统一 4 个服务的 TG 推送重试逻辑，消除静默丢消息 + DRY。
> retry 策略：15s 超时 + 2 次重试（backoff 3s/6s），4xx 不重试。不去重（Telegram API 不支持查询已发消息，且重复概率极低 < 7 月/次）。

## 验收场景

### G1: 网络错误自动重试
GIVEN TG API 因代理故障返回 fetch failed
WHEN sendWithRetry(token, chatId, text)
THEN 自动重试 2 次（backoff 3s/6s），任一次成功即返回 {ok:true}

### G2: 超时自动重试
GIVEN TG API 请求超时（15s AbortError）
WHEN sendWithRetry
THEN 自动重试

### G3: 4xx 不重试
GIVEN TG API 返回 400/403/404
WHEN sendWithRetry
THEN 立即返回 {ok:false, error:"...（N）"}, 不重试

### G4: 5xx 重试
GIVEN TG API 返回 500/502/503
WHEN sendWithRetry
THEN 自动重试

### G5: 全部失败
GIVEN 网络持续不可用（3 次尝试全失败）
WHEN sendWithRetry 退出
THEN 返回 {ok:false, error:"retries exhausted"}

### G6: 调用方接口兼容
GIVEN 4 个服务的 sendTelegram(token, chatId, text) 调用方
WHEN 底层替换为 sendWithRetry
THEN 函数签名不变，内部根据返回结果 log 成功/失败

### G7: sendDocument 同样支持 retry
GIVEN discovery 需要推送 .md 文件
WHEN sendDocumentWithRetry(token, chatId, filePath, caption)
THEN 同 sendWithRetry 的 retry 逻辑和超时配置

## 涉及文件
- service/lib/notify.mjs（新建）
- service/sodex-discovery/process/output.mjs
- service/HYPE-discovery/process/output.mjs
- service/sodex-watch/api/index.mjs
- service/HYPE-watch/api/index.mjs
- docs/update-log.md

## 契约

```js
const RETRIES = 2;
const BACKOFF = [3000, 6000];
const TIMEOUT_MS = 15_000;

// 返回 {ok, messageId?, error?}
// ok=true → 发送成功，messageId 有值
// ok=false → 发送失败，error 说明原因（4xx/no retries/was exhausted）
export async function sendWithRetry(token, chatId, text, opts = {}) { ... }

// 同上，body 为 multipart/form-data（文件上传）
export async function sendDocumentWithRetry(token, chatId, filePath, caption, opts = {}) { ... }
```

## 排除
- 不增加去重逻辑（TG API 无查询端点，重复概率低不值得）
- 不改变 TG 推送的调用时机（watcher/snapshot/discovery 逻辑不变）
- 不增加持久化队列（失败不落盘，网络恢复后下次实时推送自然覆盖）
- 不修改 config 结构
