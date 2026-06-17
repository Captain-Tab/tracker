---
name: gh-pr-assistant
description: Summarize local git changes, create a commit, and open a GitHub pull request with gh CLI. Use when the user asks to summarize modifications, write commit messages, submit PRs, or run gh pr create.
license: MIT
metadata:
  author: custom
  version: "1.0.0"
---

# GitHub PR 助手（gh）

用于自动完成：改动总结、提交 commit、创建 PR。

## 触发场景

当用户出现以下意图时自动使用：

- “总结这次修改并提 PR”
- “帮我提交 pr”
- “用 gh 创建 pr”
- “生成 commit message 并发起 pr”

## AI 执行流程（必须按顺序）

1. **检查环境**
   - 运行 `which gh`，确认已安装。
   - 运行 `gh auth status`，确认已登录 GitHub。
   - 若未登录，提示用户先执行 `gh auth login`，停止后续步骤。

2. **收集改动信息（并行）**
   - 运行 `git status --short`
   - 运行 `git diff`（包含已暂存和未暂存）
   - 运行 `git log --oneline -10`
   - 基于改动生成 1-2 句 commit message，强调“为什么改”。

3. **提交代码**
   - 只添加与本次任务相关文件，避免误提交敏感文件（如 `.env`）。
   - 运行 `git add <files>`
   - 使用 heredoc 方式提交：
     ```bash
     git commit -m "$(cat <<'EOF'
     <commit title>
     
     <commit body>
     EOF
     )"
     ```
   - 运行 `git status` 确认提交成功。

4. **推送分支**
   - 检查当前分支是否已关联远端：
     - 未关联：`git push -u origin HEAD`
     - 已关联：`git push`

5. **创建 PR**
   - 生成 PR 标题与正文，正文使用以下模板：
     ```markdown
     ## Summary
     - <关键改动 1>
     - <关键改动 2>
     
     ## Test plan
     - [ ] 本地构建通过
     - [ ] 关键路径手测通过
     ```
   - 使用 heredoc 创建 PR：
     ```bash
     gh pr create --title "<pr title>" --body "$(cat <<'EOF'
     ## Summary
     - <关键改动 1>
     - <关键改动 2>
     
     ## Test plan
     - [ ] 本地构建通过
     - [ ] 关键路径手测通过
     EOF
     )"
     ```
   - 将 PR URL 返回给用户。

## 安全约束

- 不要修改 `git config`。
- 不要执行破坏性命令（如 `git reset --hard`）。
- 不要 `push --force` 到 `main/master`。
- 未经用户要求，不要提交与当前需求无关的改动。

## 输出格式

执行完成后按以下格式回复：

```markdown
已完成改动总结并创建 PR。

- Commit: <commit-hash> <commit-title>
- PR: <pr-url>
- 说明: <一句话说明本次变更价值>
```

## 常见失败处理

- `gh: not logged in`：提示用户执行 `gh auth login`。
- `no changes added to commit`：提示用户确认是否有实际改动。
- `current branch has no upstream`：执行 `git push -u origin HEAD` 后重试。
