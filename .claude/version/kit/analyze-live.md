---
module: analyze-live
type: kit
version: 1.0.0
released: 2026-05-12
versioning: semver
status: active
source: .claude/kit/analyze-live/
---

# Analyze-Live Kit CHANGELOG

> 版本约定：SemVer，第一个 `## [date] v<x.y>` 标题中的版本即当前版本。

## [2026-05-12] v1.0 — 初始版本

### 资产

| 文件 | 用途 |
|---|---|
| `template.md` | 通用输出文档模板（章节顺序/表格列名固定，无项目特定示例）|
| `interceptor.template.js` | XHR + fetch 双拦截器 JS 模板（占位符 `{{PORT}}` / `{{PATTERNS}}`）|
| `scripts/inject.sh` | 渲染模板并追加到入口文件，所有行带 `// [CAPTURE]` 标记 |
| `scripts/cleanup.sh` | 4 步清理：删拦截器行 / 报告 `[CAPTURE-TEMP]` / 停服 / 删日志 |
| `scripts/analyze-log.sh` | 解析 `debug.log` 输出 Markdown 接口清单（去重 + 多形态聚合）|

### 设计动机

3 次连续逆向分析（一次会话内多路由 News 模块采集）暴露的痛点：

| 痛点 | 资产解决 |
|---|---|
| 每次手贴 30 行拦截器 JS，且踩过自循环 bug | `interceptor.template.js` + `inject.sh`（含 self-skip + dedupe）|
| 拦截器只用 fetch，axios 走 XHR 漏抓 | 模板默认 XHR + fetch 双拦截 |
| 手工 4 步清理易漏（特别是 `[CAPTURE-TEMP]` 配置回滚）| `cleanup.sh` 单命令完成 + 退出码校验残留 |
| 每次手写 Python 解析日志 one-liner | `analyze-log.sh` 统一格式输出 |
| 各人写出的文档章节不一致，下游难复用 | `template.md` 固定结构 |
| 命令 prompt 内联大量 bash / JS 占 token | 命令仅引用脚本路径，token -80% |

### 接口约定

#### `inject.sh`
```
inject.sh <entry-file> <port> <pattern1,pattern2,...>
```
- 已有 `// [CAPTURE]` 时跳过（防重复）
- patterns 是逗号分隔的 URL 子串

#### `cleanup.sh`
```
cleanup.sh <project-root> [--keep-log]
```
- 退出码非零表示有残留
- `[CAPTURE-TEMP]` 不自动改，仅报告位置（生产风险）

#### `analyze-log.sh`
```
analyze-log.sh <log-path> [filter-substring]
```
- 输出 Markdown 到 stdout
- 按 `(method, url-no-query)` 去重，列出唯一 Request 形态 + Response 样本

### 与命令的关系

`/k:analyze-live` 是消费者，**命令文件不重复脚本逻辑**。脚本独立可用，也可被未来命令复用（如 `/k:migration` 的运行时验证子流程）。

### 已知约束

- `sed -i ''` BSD 语法（macOS）；GNU sed 需要去掉空字符串参数
- 拦截器模板用 TypeScript 类型断言（`as any`），在 `.ts` / `.tsx` 入口正常；纯 `.js` 入口需要先剥离类型注解（暂未自动处理）
- `cleanup.sh` 假定 debug 服务由 `.claude/kit/debug/scripts/start-server.sh` 启动

### 后续路线（暂不实现）

| 想法 | 优先级 | 说明 |
|---|---|---|
| `switch-gateway.sh` | 低 | 网关切换辅助；当前手工 Edit + `[CAPTURE-TEMP]` 标记已够用，自动化反而引入误操作风险 |
| `diff-routes.py` | 低-中 | 跨多份 spec 文档输出差异矩阵；需 spec 模板更稳定后再做 |
| `scan-route-tabs.sh` | 低 | 启发式扫描入口文件列出 tab，结果不准 |
| GNU/BSD sed 兼容 | 低 | 团队全 macOS，暂无需 |
