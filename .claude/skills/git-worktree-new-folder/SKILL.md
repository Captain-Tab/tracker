---
name: git-worktree-new-folder
description: Git worktree management and soso-kit config distribution. Use when creating branch directories, managing worktrees, or installing soso-kit config to projects.
license: MIT
metadata:
  author: soso-kit
  version: "4.0.0"
---

# Git Worktree 与配置管理

## When to Apply

- 需要同时在多个分支工作（创建 worktree）
- 新项目或 worktree 需要安装/更新 soso-kit 配置
- 在其他项目修改了配置后，需要推回 soso-kit
- 需要在 .cursor 和 .claude 模式间切换

## 核心命令

### 切换配置模式

```bash
sosokit-switch          # 显示当前模式
sosokit-switch cursor   # 切换到 .cursor 模式（Cursor IDE）
sosokit-switch claude   # 切换到 .claude 模式（Claude Code）
```

### 创建 Worktree

```bash
# 一键初始化：创建 worktree + pnpm install + sosokit-install
.claude/skills/git-worktree-new-folder/scripts/init-worktree.sh feature/my-feature

# 指定目标目录
.claude/skills/git-worktree-new-folder/scripts/init-worktree.sh feature/my-feature ../custom-dir

# 跳过配置安装
.claude/skills/git-worktree-new-folder/scripts/init-worktree.sh feature/my-feature --skip-config
```

### 安装/更新配置

```bash
# 在目标项目目录执行（soso-kit → 当前项目）
# 会根据 sosokit-switch 的模式，安装 .cursor 或 .claude
sosokit-install
```

### 推回 soso-kit（当前项目 → soso-kit）

```bash
# 在修改了配置的项目目录执行
# 会根据 sosokit-switch 的模式，同步 .cursor 或 .claude
sosokit-sync

# 预览模式
sosokit-sync --dry-run
```

### 管理 Worktree

```bash
git worktree list                        # 查看所有 worktree
git worktree remove ../project-branch    # 删除 worktree
git worktree prune                       # 清理无效引用
```

## 典型工作流

```
sosokit-switch claude    # 0. 选择模式（可选，默认 claude）
sosokit-install          # 1. 从 soso-kit 获取最新配置
→ 修改配置内容
→ sosokit-sync           # 2. 推回 soso-kit 作为新基准
→ sosokit-install        # 3. 分发到其他项目
```

## 全局命令安装

```bash
sudo ln -sf /Users/soso/Documents/code/soso-kit/.claude/kit/cli/install.sh /usr/local/bin/sosokit-install
sudo ln -sf /Users/soso/Documents/code/soso-kit/.claude/kit/cli/sync.sh /usr/local/bin/sosokit-sync
sudo ln -sf /Users/soso/Documents/code/soso-kit/.claude/kit/cli/switch.sh /usr/local/bin/sosokit-switch
```
