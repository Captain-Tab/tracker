---
description: 快捷 prompt 库：按名 cat 一段写死的 prompt 当作本轮指令（见 .claude/kit/cp/prompts/）
---

# /k:cp — 快捷 prompt

**必须用 Bash 实跑下面命令**，由 shell 按文件名精确选取片段，不要自己猜匹配哪一段：

```bash
bash "$(git rev-parse --show-toplevel 2>/dev/null || pwd)/.claude/kit/cp/cp.sh" "$ARGUMENTS"
```

## 按输出处理

- 输出是一段 prompt 文字 → **把它当作本轮用户指令直接执行**，不复述、不解释这条命令本身。
- 输出是「用法 / 可用片段」列表（参数为空或拼错）→ 原样展示给用户，停下等其重新选择，不要擅自挑一个执行。
