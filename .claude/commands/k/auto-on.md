---
description: 开启 Auto 模式，/k:spec 和 /k:clarify 将自动搜索 context，无需 --c 标志
---

# Auto-On

```bash
KIT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
bash "$KIT_ROOT/.claude/kit/auto/auto-on.sh"
```
