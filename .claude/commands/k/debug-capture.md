---
description: API 采集 session（自包含一次性流程），拦截 fetch 请求并与 Context 文档对比。用于 /k/migration analyze
---

# Debug-Capture: 运行时 API 采集

## 核心目的

通过 fetch 全局拦截器采集运行时 API 请求/响应，与 Context 文档的 API 列表做对比，验证 Context 准确性。

**Session 模型**：自包含一次性流程，启动 → 用户操作 → 分析 → 自动清理。**不依赖 /k:debug-off**。

---

## 执行步骤

### Phase C0：环境检查 + 启动服务

```bash
KIT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
bash "$KIT_ROOT/.claude/kit/debug/scripts/start-server.sh" check
bash "$KIT_ROOT/.claude/kit/debug/scripts/start-server.sh" start "$PROJECT_ROOT"
```

记录实际启动端口（`DEBUG_SERVER_PORT=xxxx`），下面注入拦截器时使用。

---

### Phase C1：注入全局 fetch 拦截器

在目标项目入口文件（如 `src/index.tsx` 或 `src/main.tsx`）末尾追加。

**关键约束**：拦截器整段每一行末尾都必须带 `// [CAPTURE]` 标记，Phase C4 清理时按行删除。漏标任一行会导致清理后留下残破代码。

```javascript
const _fetch = window.fetch; // [CAPTURE]
window.fetch = async (url, opts) => { // [CAPTURE]
  const method = opts?.method || 'GET'; // [CAPTURE]
  let requestBody = null; // [CAPTURE]
  if (method !== 'GET' && opts?.body) { // [CAPTURE]
    try { requestBody = JSON.parse(opts.body); } catch {} // [CAPTURE]
  } // [CAPTURE]
  const res = await _fetch(url, opts); // [CAPTURE]
  const clone = res.clone(); // [CAPTURE]
  const body = await clone.text().catch(() => ''); // [CAPTURE]
  fetch('http://localhost:{PORT}/log', { // [CAPTURE]
    method: 'POST', // [CAPTURE]
    headers: {'Content-Type':'application/json'}, // [CAPTURE]
    body: JSON.stringify({ // [CAPTURE]
      tag: '[CAPTURE:API]', // [CAPTURE]
      data: { // [CAPTURE]
        url: typeof url === 'string' ? url : url.url, // [CAPTURE]
        method, // [CAPTURE]
        requestBody, // [CAPTURE]
        status: res.status, // [CAPTURE]
        responsePreview: body.slice(0, 500) // [CAPTURE]
      }, // [CAPTURE]
      timestamp: Date.now() // [CAPTURE]
    }) // [CAPTURE]
  }).catch(() => {}); // [CAPTURE]
  return res; // [CAPTURE]
}; // [CAPTURE]
```

**注入说明**：
- `{PORT}` 替换为 Phase C0 实际启动端口
- **每行必须有 `// [CAPTURE]` 标记**（含 `}` `};` 等独立闭合行），漏一行就清不干净
- 与 debug 模式区别：debug 逐点插桩，capture 一段代码拦截所有请求
- `requestBody` 仅对 POST/PUT/PATCH/DELETE 解析；GET 保持 null
- 请求体为 FormData/binary（JSON.parse 失败）时 requestBody 保持 null，不报错

---

### Phase C2：用户操作

**输出提示**：

```
Debug 采集服务运行中（端口 {PORT}）

请在浏览器中正常走一遍功能流程，完成后告诉我 "done"。

提示：
- 确保页面已刷新（使拦截器生效）
- 尽量覆盖功能的主要路径
```

**等待用户回复 "done"**。

---

### Phase C3：分析 + 与 Context 对比

1. 读取 `$PROJECT_ROOT/debug.log`
2. 过滤 `tag` 含 `[CAPTURE:API]` 的条目
3. 去重（相同 url + method 只保留一条）
4. 与 context load 加载的 API 记录对比
5. 输出差异报告：

```markdown
## 运行时采集报告：<功能名>

### 实际 API 请求（共 N 个）
1. GET  /api/path  → 200
2. POST /api/path  → 200

### 与 Context 对比
✅ N 个 API 与 context 记录一致
⚠️ N 个 API context 遗漏（列出具体 API）
⚠️ N 个 API context 有记录但运行时未调用

### 写操作 Request Body（POST/DELETE）
<!-- 每个写操作列出完整 requestBody，作为新实现的 ground truth -->
**POST /api/xxx**
{ "amount": "10.00000000", "side": "BUY", "coinId": 1 }

字段说明：
- amount: string 精度（非 number）
- side: enum string（非 proto value）

### 响应格式抽样
[对关键 API 输出 responsePreview]
```

---

### Phase C4：自动清理

1. **删除拦截器代码**：grep + Edit 删除入口文件中所有 `// [CAPTURE]` 标记的行：

```bash
grep -rln "// \[CAPTURE\]" "$PROJECT_ROOT" \
  --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" \
  --exclude-dir=node_modules --exclude-dir=.git
```

对每个匹配文件，使用 Edit 工具删除带 `// [CAPTURE]` 的行。

2. **验证无残留**：

```bash
grep -rn "// \[CAPTURE\]" "$PROJECT_ROOT" \
  --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" \
  --exclude-dir=node_modules --exclude-dir=.git \
  || echo "✅ 拦截器清理完成"
```

3. **停止服务 + 删除日志**：

```bash
bash "$KIT_ROOT/.claude/kit/debug/scripts/start-server.sh" stop "$PROJECT_ROOT"
rm -f "$PROJECT_ROOT/debug.log"
```

---

## 完成条件

```
✅ Capture 完成

采集统计：
- 拦截器注入文件：[路径]
- 采集 API 数量：[N] 个
- 写操作（POST/DELETE）：[M] 个
- 与 Context 一致：[X] 个
- Context 遗漏：[Y] 个
- 已自动清理：拦截器 + 日志 + 服务
```
