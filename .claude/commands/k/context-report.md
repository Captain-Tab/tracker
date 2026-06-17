---
description: Context 健康报告：过期检测、共享文件风险、最近活动、模块覆盖
---

# Context Report

使用 Bash 工具执行（单次调用）：

```bash
dir=$(pwd); KIT_ROOT=""; for i in 1 2 3 4 5; do [ -d "$dir/.claude/kit/context/library" ] && KIT_ROOT="$dir" && break; dir="$(dirname "$dir")"; done && bash "$KIT_ROOT/.claude/kit/context/action/report/scripts/report.sh"
```

展示完整输出，结束。
