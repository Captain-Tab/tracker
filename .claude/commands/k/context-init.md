---
description: 初始化新项目 Context Library 骨架（支持补全）
---

# Context Init: 初始化项目骨架

## 用户输入

```text
$ARGUMENTS
```

---

## 执行步骤

### Step 1: 解析参数

- `PARAMS` = `$ARGUMENTS`（项目路径或名称，可为空）

### Step 2: --dry-run 预览

```bash
dir=$(pwd); KIT_ROOT=""; for i in 1 2 3 4 5; do [ -d "$dir/.claude/kit/context/library" ] && KIT_ROOT="$dir" && break; dir="$(dirname "$dir")"; done && cd "$KIT_ROOT" && source .claude/kit/context/context-lib.sh && context_init "--dry-run $PARAMS"
```

展示预览输出，询问用户确认：
> 以上为 init 预览，确认执行？(Y/N)

### Step 3: 用户确认后正式执行

```bash
dir=$(pwd); KIT_ROOT=""; for i in 1 2 3 4 5; do [ -d "$dir/.claude/kit/context/library" ] && KIT_ROOT="$dir" && break; dir="$(dirname "$dir")"; done && cd "$KIT_ROOT" && source .claude/kit/context/context-lib.sh && context_init "$PARAMS"
```

展示执行结果，结束。
