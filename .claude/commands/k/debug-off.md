---
description: 终结调试 session，清理 // [DEBUG: 插桩、删除日志、停止服务
---

# Debug-Off: 结束调试会话

## 核心目的

清理 `/k:debug-on` 留下的插桩代码、日志和服务进程。幂等执行（重复运行无副作用）。

---

## 执行步骤

### 1. 清理插桩代码

```bash
KIT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
PROJECT_ROOT="$(pwd)"

# 找出所有含 // [DEBUG: 标记的文件 + 行号
grep -rln "// \[DEBUG:" "$PROJECT_ROOT" \
  --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" \
  --exclude-dir=node_modules --exclude-dir=.git
```

对每个匹配文件，使用 Edit 工具删除带标记的行（保留代码缩进，仅去掉插桩行）。

### 2. 验证清理无残留

```bash
grep -rn "// \[DEBUG:" "$PROJECT_ROOT" \
  --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" \
  --exclude-dir=node_modules --exclude-dir=.git \
  || echo "✅ 插桩清理完成"
```

### 3. 停止服务

```bash
bash "$KIT_ROOT/.claude/kit/debug/scripts/start-server.sh" stop "$PROJECT_ROOT"
```

### 4. 删除日志文件

```bash
rm -f "$PROJECT_ROOT/debug.log"
```

---

## 完成条件

```
✅ Debug session 已结束

清理统计：
- 清理插桩文件：[N] 个
- 删除日志：debug.log
- 停止服务：完成
```
