---
description: 停止 /k:codex-on 开启的 Codex 审核监听进程并清理记录。幂等执行
---

# /k:codex-off: 停止 Codex 审核监听

## 用户输入

```text
$ARGUMENTS
```

---

## 核心目的

停掉 `/k:codex-on` 启动的后台轮询进程并清理 PID marker。幂等（重复运行无副作用）。

---

## 参数

| 参数 | 含义 | 默认 |
|------|------|------|
| `<PR号>` | 停止指定 PR 的监听 | 不传则停全部 |

---

## 执行步骤

```bash
KIT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
bash "$KIT_ROOT/.claude/kit/codex/scripts/codex-watch.sh" watch-stop $PR_ARG
```

`$PR_ARG`：用户显式传了 PR 号就带上（停该 PR），否则留空（停全部）。

脚本会 kill 进程、删 marker，输出停止结果。直接把脚本输出转述给用户即可。
