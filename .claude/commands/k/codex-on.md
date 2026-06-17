---
description: 后台监听当前 PR 的 Codex 审核，完成后自动执行 /k:codex 核验并播报。停止用 /k:codex-off
---

# /k:codex-on: 开启 Codex 审核监听

## 用户输入

```text
$ARGUMENTS
```

---

## 核心目的

后台轮询当前分支对应 PR 的 Codex 审核状态，**等待期间不消耗对话开销**；审核一完成（`codex_review` 离开 pending），自动执行 `/k:codex` 核验并播报结论（无 High 则直接报审核通过，有 High 才跑四步漏斗）。

轮询节奏（实测端到端 4–8min）：0–5min 不查 → 5min 首查 → 之后每 5min → 20min 后每 3min → 30min 超时放弃。

---

## 参数

| 参数 | 含义 | 默认 |
|------|------|------|
| `<PR号>` | 显式指定 PR | 自动探测当前分支 |

---

## 执行步骤

### Step 1: 探测 PR + 防重复启动

```bash
KIT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
WATCH="$KIT_ROOT/.claude/kit/codex/scripts/codex-watch.sh"
PR="${PR_ARG:-$(bash "$KIT_ROOT/.claude/kit/codex/scripts/codex.sh" detect-pr)}"
bash "$WATCH" watch-list
```

- 探测不到 PR → 提示用户显式传 PR 号，停止。
- `watch-list` 已在监听该 PR → 提示「已在监听 PR #<N>」，**不重复启动**，停止。

### Step 2: 后台拉起 watcher（run_in_background）

用 Bash 工具、`run_in_background: true` 执行：

```bash
KIT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
bash "$KIT_ROOT/.claude/kit/codex/scripts/codex-watch.sh" watch <PR>
```

进程脱离会话独立轮询，自己写/清 PID marker（`${TMPDIR}/codex-watch/pr-<N>.pid`）。

**输出（仅此一行）**：
```
👁 已开始监听 PR #<N> 的 Codex 审核（完成后自动核验）。停止：/k:codex-off
```

随后正常结束本回合，等待期 0 token。

### Step 3: 完成时自动核验（后台进程退出 → 本模型被重新唤起）

后台进程结束时 harness 重新唤起本对话，其输出含完成信号：

| 信号 | 含义 | 动作 |
|------|------|------|
| `CODEX_WATCH_DONE PR=<N> codex_review=<bucket>` | 审核完成 | **立即执行 `/k:codex <N>`**（见 `.claude/commands/k/codex.md`）：无 High 则短路为审核通过提示，有 High 才跑四步漏斗，把结论播报给用户 |
| `CODEX_WATCH_TIMEOUT PR=<N> ...` | 30min 仍未完成 | 提示「监听超时，Codex 可能卡住，可手动 `/k:codex <N>` 重试」，不跑漏斗 |

> 见到 `CODEX_WATCH_DONE` 即视为「该跑漏斗了」的显式指令，无论中途是否穿插了其它对话。
