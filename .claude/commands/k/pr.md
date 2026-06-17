---
description: 根据当前分支与目标分支的差异生成结构化 PR 标题与正文
---

# /k:pr: 生成 PR 标题 + 正文

## 用户输入

```text
$ARGUMENTS
```

---

## 核心目的

仅根据当前分支相对目标分支（默认 main / master）的 commit 历史与 diff，**生成可直接复制的 PR 标题 + Markdown 正文**。  
**不审查代码**、**不自动 `gh pr create`**、**不修改任何文件**。

适用场景：分支已开发完毕、已 push（或准备 push），需要标准化的 PR 文案。

如需完整代码审查 → `/k:check`；如需自动开 PR → 用户自行在主对话表达。

---

## 参数

| 参数 | 含义 | 默认 |
|------|------|------|
| `--base <branch>` | 目标分支 | 自动探测（origin/HEAD → main → master） |
| `--title <text>` | 用户指定 PR 标题正文（前缀仍自动生成） | 无 → 由 commit 历史推断 |
| `--prefix <HOTFIX/FEATURE/UPDATE/FIX>` | 用户强制指定前缀 | 自动推断 |
| `--lang <zh/en>` | 正文语言 | zh |

---

## 执行步骤

### Step 1: 解析参数 + 探测分支

#### 1.1 从 `$ARGUMENTS` 解析参数

按字面匹配从用户输入中提取（顺序不限）：

| 参数 | 提取方式 | 未给则 |
|------|---------|--------|
| `--base <branch>` | 取 `--base` 后第一个 token | 走 1.2 自动探测 |
| `--prefix <P>` | 取 `--prefix` 后第一个 token，必须 ∈ {HOTFIX, FIX, FEATURE, UPDATE} | 走 Step 2.1 自动推断 |
| `--title <text>` | 取 `--title` 后到末尾或下一个 `--` 标志之间的内容 | 走 Step 2.2 commit 归纳 |
| `--lang <zh\|en>` | 取 `--lang` 后第一个 token | `zh` |

解析完毕将结果记为变量：`USER_BASE` / `USER_PREFIX` / `USER_TITLE` / `LANG`。

#### 1.2 探测目标分支（仅当 `USER_BASE` 为空）

按以下顺序执行真实 Bash，第一条成功即停：

```bash
git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@'
git rev-parse --verify main 2>/dev/null && echo main
git rev-parse --verify master 2>/dev/null && echo master
```

将最终目标分支记为 `BASE`（若用户给了 `USER_BASE`，则 `BASE=USER_BASE`）。

#### 1.3 收集变更范围

执行真实 Bash（在调用时用实际 `BASE` 值替换 `$BASE`，**不留 `<base>` 占位符**）：

```bash
echo "=== 当前分支 ==="
git rev-parse --abbrev-ref HEAD

echo ""
echo "=== 目标分支 ==="
echo "$BASE"

echo ""
echo "=== 与目标分支差异 commit 列表 ==="
git log "$BASE..HEAD" --pretty=format:'%h %s' --no-merges

echo ""
echo "=== 变更文件统计 ==="
git diff "$BASE...HEAD" --stat

echo ""
echo "=== 完整 diff（用于推断模块、风险点） ==="
git diff "$BASE...HEAD"
```

- 若 commit 列表为空 → 输出 `❌ 当前分支相对 $BASE 无差异 commit`，停止。
- 若分支与远端不同步 → 提示用户先 push，但**仍继续生成文案**（PR 文案与是否 push 无关）。

---

### Step 2: 标题生成

#### 2.1 前缀推断（4 选 1，全大写）

若 Step 1.1 已解析出 `USER_PREFIX` → 直接采用，跳过推断。

否则按以下优先级匹配：

| 前缀 | 触发条件（按优先级匹配） |
|------|--------|
| `HOTFIX` | 分支名含 `hotfix/`；或 commits 全为 `fix(...)` 且分支名暗示紧急（hotfix/urgent/p0 等） |
| `FIX` | 分支名含 `fix/`；或 commits 中 `fix:` 占比 ≥ 70% |
| `FEATURE` | 分支名含 `feat/` / `feature/`；或 commits 中 `feat:` 占比 ≥ 50% |
| `UPDATE` | 其余情况（混合改动 / refactor / chore / docs / perf 为主） |

#### 2.2 标题正文

格式：`<PREFIX>: <一句话概括 PR 主题>`

- 若 Step 1.1 已解析出 `USER_TITLE` → 直接采用，跳过归纳
- 否则一句话从所有 commit 主旨中归纳，**不是**简单复制单个 commit subject
- 语言取 `LANG`（默认中文），简洁、动宾结构
- 总长建议 ≤ 60 字符（含前缀）

示例：

```
FEATURE: ops-broadcast 模块安全 / 并发 / 校验 / 容错集中加固
HOTFIX: 修复模板编辑工作流迁移与定时发送安全约束
FIX: 修复 vault deposit 桥接状态机回滚导致的余额错算
UPDATE: 重构 transfer EVM 余额同步链路并补充单测
```

---

### Step 3: 正文结构（强制模板）

#### 3.0 全局简洁约束（硬规则）

| 维度 | 上限 | 超限做法 |
|------|------|---------|
| 正文总长 | ≤ **30 行 / 1200 字符** | "详情外移"——挪到 spec / QA 文档 |
| 小节数量 | **固定 3 个**：核心变动 / 改动范围 / Commits | 不要别的节 |
| 小节标题形式 | **纯文字（不用 `#` / `##`）** | 用粗体小标题或独立一行文字即可 |
| 改动范围 bullet | **3-5 项** | 每项 ≤ 1 行 / 80 字符 |
| 每条 commit 扩展说明 | ≤ **1 行 / 80 字符** | 关键文件 / 技术点择最重要 1 个 |
| "核心变动"段 | **1 行** | 做了什么、范围限定、最关键的"不做" |

PR body 的读者是 reviewer，他要知道的是「做了什么 / 范围 / 关键决策 / 边界 / 不做什么」，不是"所有字段叫什么名"。

#### 3.1 模板（仅此一种结构）

```markdown
核心变动
<一句话总结：做了什么 + scope + 关键限定>

改动范围
* <改了几个 container / 模块 / 文件，关键体量数字>
* <关键决策 1：如复用 / 隔离 / 环境策略>
* <关键决策 2：如安全 / 兜底 / 默认行为>
* <不做什么 / 留 v2：明确边界，给 reviewer 安全感>

Commits
* <hash> <commit subject> — <扩展说明 ≤ 80 字符>
* <hash> <commit subject> — <扩展说明>
* <hash> <commit subject> — <扩展说明>
* ...
```

**注意**：三个小节标题（`核心变动` / `改动范围` / `Commits`）都是**独立一行的纯文字**，不加 `#` / `##` / `**`——保持视觉简洁、和参考样例对齐。

#### 3.2 禁止节（这些都不要出现）

- ❌ **emoji 项目标识行**（如 `🎨 前端 PR：sodex-next — feat/sentry`）
- ❌ **任何 `##` / `#` markdown 标题**（三个小节名要纯文字）
- ❌ **风险域 / 功能域分组**（外部资源安全 / 权限 / 并发 / 输入校验...）→ 全部 commit 平铺到 `Commits` 段
- ❌ **关联依赖** 节 → 若关键依赖必须说，写进"改动范围"bullet 一项
- ❌ **验证 & 文档** 节 → 若 QA 文档必须说，写进"改动范围"bullet 一项
- ❌ **DB / 部署** 节 → 若必须说，写进"改动范围"bullet 一项
- ❌ **数据维度 / 字段清单 / tag 列表 / QA checklist / 安全过滤实现细节**
- ❌ **"待 QA 验证"罗列**
- ❌ **soso-kit 命令名 / AI 工具链痕迹**：禁出现 `/k:` 命令名、`subagent`、`Claude`、`Cursor`、`AI`、`双闸门` 等内部关键词；验证类描述用"已实测 / 已运行时验证"代替

> 规则的精神：PR body 是一张「reviewer 一眼看完」的摘要，不是文档。任何"罗列 N 项"的内容都不属于这里。

#### 3.3 commit 排列规则

- **按 git log 顺序平铺**（时间从早到晚或从晚到早，跟随 `git log $BASE..HEAD` 默认输出顺序），不重排、不分组
- hash 用 7-8 位短 hash
- subject 保持 commit message 原文
- subject 后 `— ` 跟扩展说明：补充信息（关键文件 / 技术点 / 上下游影响），不复述 subject

---

### Step 4: 自检（输出前必须做）

**格式**：
- [ ] 前缀是 HOTFIX / FEATURE / FIX / UPDATE 之一
- [ ] 标题总长 ≤ 60 字符（含前缀）
- [ ] commit hash 用短 hash（7-8 位）
- [ ] 每个 commit 都有扩展说明（不是空 dash）
- [ ] 不复述 commit subject 本身，扩展说明是补充信息
- [ ] commits 平铺到 `Commits` 段，按 git log 顺序

**简洁度**（违反 = FAIL，必须改）：
- [ ] 正文总长 ≤ 30 行 / 1200 字符
- [ ] 小节数**有且只有 3 个**：核心变动 / 改动范围 / Commits（都是纯文字标题）
- [ ] "改动范围" bullet 3-5 项，每项 ≤ 1 行
- [ ] 每条 commit 扩展说明 ≤ 1 行 / 80 字符

**结构禁令**（出现即 FAIL）：
- [ ] 没有 `🎨 前端 PR：xxx — branch` 之类的 emoji 项目标识行
- [ ] 没有任何 `#` / `##` markdown 标题（包括 `## Commits`）—— 三个小节名必须纯文字
- [ ] 没有按风险域 / 功能域分组的多个 commit 段
- [ ] 没有"关联依赖" / "验证 & 文档" / "DB / 部署"独立小节
- [ ] 没有 "上报数据维度 / tag 清单 / 字段列表 / QA checklist / 安全过滤实现细节" 罗列
- [ ] 没有"待 QA 验证"罗列
- [ ] **没有 soso-kit 命令名 / AI 工具链痕迹**：grep `/k:|subagent|Claude|Cursor|AI[^a-zA-Z]|双闸门` 全文，命中即删 / 改中性表述

**触发"详情外移"信号**：发现自己正在写「N 个字段 / 38 项黑名单 / 10 个 container / 5 个场景」这类**带具体数量的罗列**时，停——挪到 spec / QA 文档；如有必须提的关键依赖 / DB / QA 文档，**只能写进顶部 3-5 项 bullet 中的一项**，不开新节。

---

### Step 5: 输出文案并询问是否执行

#### 5.1 输出文案（严格仅两节）

```markdown
## 📦 PR 文案建议

### 标题
\`\`\`
<PREFIX>: <一句话主题>
\`\`\`

### 正文
\`\`\`markdown
<完整 Markdown 正文，可直接复制到 GitHub PR description>
\`\`\`
```

**只输出"标题 + 正文"两节**——不展示 `gh pr create` 命令内容、不写"目标分支提示"、不写"push 提醒"。

#### 5.2 输出 3 行选项 + 等用户输入数字（默认 3）

文案输出完成后，**必须**输出**恰好 3 行**纯文本选项（不调用 `AskUserQuestion`、不画选项卡）：

```
请选择（输入 1 / 2 / 3，回车直接走默认 3）：
1 帮你执行 gh pr create（必要时先 push）
2 给我命令，我手动执行
3 不需要（默认）
```

格式硬规则：
- **恰好 3 行选项**（不展开 description、不分多行解释）
- 每行格式：`<数字> <一句话动作>`，整行 ≤ 40 字符
- 最上方一行引导句固定为「请选择（输入 1 / 2 / 3，回车直接走默认 3）：」
- **默认是 3**（不需要）——明文写进选项 3 的尾部

输出完这 4 行（1 引导 + 3 选项）后，**等待用户在主对话回复**。根据回复字符判断：
- 含 `1` → 走 5.3 选项 1 流程
- 含 `2` → 走 5.3 选项 2 流程
- 含 `3` / 空回复 / 含「默认」「不需要」「no」「skip」/ 无数字 → 走 5.3 选项 3 流程

#### 5.3 根据用户输入的数字执行

##### 选项 1：帮你执行 gh pr create

预检 → 必要时 push → 执行 → 反馈：

```bash
# 预检：gh 是否登录
gh auth status >/dev/null 2>&1 || echo "❌ gh 未登录，请先 gh auth login"

# 预检：远端是否有该分支
git ls-remote --exit-code --heads origin "$(git rev-parse --abbrev-ref HEAD)" >/dev/null 2>&1
```

- 若 `gh` 未登录 → 输出提示并停止
- 若远端无当前分支 → 输出**单行 plain text** 二次确认：

  ```
  当前分支未推到远端，是否先 push？输入 y 推送、其余任意键取消：
  ```

  - 用户回复含 `y` / `Y` / `yes` → 执行 `git push -u origin <branch>`
  - 其余 → 取消整个流程，输出 `已取消，未创建 PR`

- 通过后执行（先把正文写到临时文件，再用 `--body-file` 调用，避免 heredoc 多行转义问题）：

```bash
cat > /tmp/pr-body.md <<'PRBODY'
<完整正文，原样>
PRBODY

gh pr create --base "$BASE" --title '<PREFIX>: <一句话主题>' --body-file /tmp/pr-body.md
```

把 `gh` 命令的 stdout（含 PR URL）原样回显给用户。

##### 选项 2：给我命令，我手动执行

**仅此时才展示完整命令**给用户复制。用代码块输出两段，告知用户先跑第一段（写 body 到临时文件），再跑第二段：

```bash
cat > /tmp/pr-body.md <<'PRBODY'
<完整正文，原样>
PRBODY
```

```bash
gh pr create --base "<BASE>" --title '<PREFIX>: <一句话主题>' --body-file /tmp/pr-body.md
```

如远端无当前分支，**额外**在最上面补一行提醒：

```bash
# 远端无当前分支，先推：
git push -u origin <current-branch>
```

输出完命令后**立即结束**，不真的执行。

##### 选项 3：不需要（默认）

直接结束，**不重复输出**已展示的文案、**不展示** `gh pr create` 命令、**不输出其他多余说明**。

---

## 硬规则（不可绕过）

- ❌ 禁止**未问就执行** `gh pr create`（必须先走 Step 5.2 的 3 行选项 + 等用户输入 `1`，才允许跑 `gh`）
- ❌ 禁止**未问就 push**（选项 1 下远端缺分支时，必须 plain text 二次问 `y/N`，用户输入 y 才 `git push`）
- ❌ 禁止**用 `AskUserQuestion` 工具**——本命令交互**只能**走 plain text 3 行选项 + 用户输入数字
- ❌ 禁止**默认推荐选项 1 或 2**——空回复 / 无数字回复都必须走选项 3（默认）；选项 3 的 label 尾部明文写「（默认）」
- ❌ 禁止**多行展开选项描述**——3 行选项每行 ≤ 40 字符；不要附加 description / 说明段
- ❌ 禁止在**选项 1 或 选项 3 路径**展示完整 `gh pr create` 命令内容；**仅选项 2** 允许展示完整命令
- ❌ 禁止修改 commit（不 rebase / squash / amend）
- ❌ 禁止伪造未在 git log 中存在的 commit hash
- ❌ 禁止将单个 commit subject 直接当作扩展说明（要补充信息）
- ❌ 禁止使用 `Co-Authored-By` trailer（PR body 不需要）
- ❌ 禁止在 PR 正文里加 emoji（项目标识 / 节标题 / bullet 都不要——保持纯文字简洁）
- ❌ 禁止在 PR 正文 / 标题里出现 **soso-kit 命令名 / AI 工具链痕迹**：`/k:`、`subagent`、`Claude`、`Cursor`、`AI`、`双闸门` 等关键词全部禁出现
- ✅ 允许在文案中引用代码路径，但路径必须是 diff 实际改动到的文件

违反禁令理由"更贴心 / 一步到位 / 用户应该会同意"**一概不接受**——必须先问再做。

---

## 完成条件

按 Step 5 输出文案 → 3 行选项 → 等用户输入数字 → 根据 1 / 2 / 3 执行或结束，整个命令才算完成。

- 用户输入 **1** → 跑完 `gh pr create`（必要时先 plain text 问 push），回显 PR URL
- 用户输入 **2** → 展示两段 bash（`cat > /tmp/pr-body.md` + `gh pr create --body-file`），结束
- 用户输入 **3 / 空 / 其他** → 直接结束，不重复文案、不展示命令

> 设计原则：pr.md 在最后**用 3 行 plain text 问一次**，决策权交给用户。默认推荐 3 是为了 conservative —— 不让用户在没看清文案前误触发 PR 创建。
