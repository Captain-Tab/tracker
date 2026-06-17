---
name: check-i18n
description: |
  对当前分支 i18n 改动做完整性 / 正确性检查（仅 git diff 范围，不修改源代码）。
  ACTIVATE 当用户输入 /check-i18n、/check-i18n <module>、或 pnpm i18n 替换/同步完成提示运行此命令时。
  内部直接调 `pnpm i18n:auto_check`，与终端入口共享同一份逻辑（parity + Sonnet 4.6 检查）。
---

# Check i18n

`/check-i18n` 是 `pnpm i18n:auto_check` 的轻量包装器，**确保 Claude Code 入口与终端入口行为一致、永不漂移**。

## 入口参数

| 调用                          | 等价命令                               |
| ----------------------------- | -------------------------------------- |
| `/check-i18n`                 | `pnpm i18n:auto_check`                 |
| `/check-i18n <module>`        | `pnpm i18n:auto_check <module>`        |
| `/check-i18n <module> --full` | `pnpm i18n:auto_check <module> --full` |

`<module>` 取值见 `docs/i18n.md` "模块划分"（`auth` / `vault` / `shared` / `app` / `misc` 等）。

## 工作流

### 1. 解析参数

从用户输入提取可选的 `<module>` 和 `--full` flag。

### 2. 运行检查

```bash
pnpm i18n:auto_check [module] [--full]
```

通过 Bash 工具调用，`stdio: inherit` 让用户看到完整进度。等待退出（约 30s–4min，视范围）。

### 3. 展示结果

执行成功后：

1. 读 `.i18n-check/README.md`，把汇总表贴给用户
2. 提示 `_parity.md` 是否有问题
3. 引导下一步：`/fix-i18n [module]` 应用修复

执行失败（非 0 退出）时：

- 打印 stderr 内容
- 提示用户检查 `claude` CLI 是否在 PATH（错误 `ENOENT`）或网络连接

## 硬规则

- 不要复刻 `pnpm i18n:auto_check` 的内部逻辑 — **只调它**
- 不要修改 `.i18n-check/` 之外的任何文件
- 不要 spawn 任何 Agent 子代理（节省 token，避免会话嵌套）

## 与终端入口的关系

| 入口                           | 适用场景                                      |
| ------------------------------ | --------------------------------------------- |
| `pnpm i18n:auto_check`（终端） | CI、IDE 内终端、不想切换到 Claude Code        |
| `/check-i18n`（Claude Code）   | 已经在 Claude Code 中、希望紧接着 `/fix-i18n` |

两者**完全等价**：调同一个脚本，跑同一个 `claude -p`，写同一份报告。
