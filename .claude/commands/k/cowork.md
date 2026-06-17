---
description: 多会话协同看板：init 建板 / pickup 进会话续接 / handoff 出会话落盘（SSOT 集中管理）
---

# /k:cowork — 多会话协同

**必须用 Bash 实跑下面命令**，由 shell 按子命令名精确选取指令片段，不要自己猜匹配哪一段：

```bash
bash "$(git rev-parse --show-toplevel 2>/dev/null || pwd)/.claude/kit/cowork/cowork.sh" "$ARGUMENTS"
```

## 按输出处理

- 输出是一段指令文字 → **把它当作本轮指令直接执行**，不复述、不解释命令本身。原始 `$ARGUMENTS` 里子命令之后的内容（如块ID）作为该指令的参数。
- 输出是「用法 / 可用子命令」列表（参数为空或拼错）→ 原样展示给用户，停下等其重新选择，不要擅自挑一个执行。
