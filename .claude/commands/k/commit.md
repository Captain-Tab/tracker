---
description: 根据当前 git diff 生成符合规范的 commit message
---

# /k:commit: 生成 Commit 建议

## 用户输入

```text
$ARGUMENTS
```

---

## 核心目的

仅根据当前未提交的改动生成 commit message，**不审查代码**。  
适用场景：已自行审查完毕，仅需要标准化的 commit 文案。

如需完整代码审查 + commit 建议，使用 `/k:check`。

---

## 执行步骤

### Step 1: 获取变更范围（信号密度优先，控制 token）

> 设计原则：commit message 是**摘要任务**。优化思路是**先压每行的信息密度，再谈采样**——默认 `-U3` 的 2/3 token 是上下文行，对 message 价值低；改 `-U0`（零上下文）只保留改动行 + hunk header，密度提升 ~3x。
>
> 四个信号合作分工：
> - **`status --short`**：哪些文件改了 + 状态（M / A / D / R）
> - **`--stat`**：权威文件全集（含锁文件/生成物，定 scope，识别 `chore(deps)` 类）
> - **`--numstat`**：每文件 `+/-` 数字——**type 的零成本初判信号**：纯 `+` → 多半 `feat` / `docs` / `test`；`+/-` 接近 → `refactor` / `fix`；大量 `-` → `chore` 清理
> - **`-U0` 内容**：只输出改动行（无上下文），全局封顶 400 行（已是 ~400 实际改动行，等价老方案 ~1200 行 -U3 输出）
>
> ⛔ **HARD-GATE：必须用 Bash 工具实际运行下面整个脚本，不可凭 session 记忆/印象跳过。**
> git diff 是 ground truth——formatter hook 可能在 Edit 后改了文件，AI 记忆不可靠。即便「我刚编辑过、改动很小」也必须实跑：四路信号在**同一个 bash 块**内一次产出，无合法跳过路径。

```bash
echo "=== Status ==="
git status --short

echo ""
echo "=== Stat（权威文件全集，含锁文件/生成物，定 scope）==="
git diff --stat HEAD

echo ""
echo "=== Numstat（+/- 数字，零成本初判 type）==="
git diff --numstat HEAD

echo ""
echo "=== 改动内容（-U0 零上下文，排除噪音，总封顶 400 行）==="
git diff HEAD -U0 -- . \
  ':(exclude)*.lock' ':(exclude)*.lockb' ':(exclude)*-lock.json' \
  ':(exclude)pnpm-lock.yaml' ':(exclude)yarn.lock' ':(exclude)go.sum' \
  ':(exclude)Cargo.lock' ':(exclude)composer.lock' ':(exclude)Gemfile.lock' ':(exclude)poetry.lock' \
  ':(exclude)dist/**' ':(exclude)build/**' ':(exclude)*.min.*' \
  ':(exclude)*.snap' ':(exclude)*.map' ':(exclude)*_generated.*' ':(exclude)*.pb.go' \
| head -n 400
```

如果 `git status --short` 输出为空 → 输出 `❌ 无未提交变更`，停止。

> - **信号优先级**：路径清晰（如 `*.test.ts` 单独改）→ filename + numstat 已能定 type/scope，内容仅作确认；路径模糊（如 `src/feature/x.ts` 改 +20/-15）→ 重点读内容判 type
> - **超过 400 行 -U0 改动**（罕见，对应原始改动可能 1000+ 行）→ 内容截断；在「改动概要」标注「（巨型改动，建议拆为多次原子 commit）」，**优先建议 split 而非强行总结**
> - **噪音文件**（锁文件/生成物/sourcemap）不出现在内容里，但 stat + numstat 已列出 → message 仍能反映（如 `chore(deps): bump x`）
> - **排除清单是 best-effort**；项目有 `.gitattributes` 标 `linguist-generated` 时以项目配置为准

### Step 2: 分析变更内容

基于 diff 内容判断：

| 维度 | 判断 |
|------|------|
| **type** | 看主要改动性质：feat / fix / docs / style / refactor / perf / test / chore |
| **scope** | 看改动文件路径，提取最显著的模块名 |
| **核心目的** | 一句话描述"为什么改"，不是"改了什么" |

---

### Step 2.5: 拆分判定（是否建议多 commit）

> **设计原则**：拆分是**建议**不是强制；numstat + 路径触发候选，`-U0` 内容做最终决策；doc/test 与配套源码改动**不拆**。
> **判定永不阻塞**：即便建议拆分，用户仍可选择单 commit；输出层始终给出可执行命令。

#### 候选触发条件（任一满足 → 进入精细判定）

| 信号 | 阈值 |
|------|------|
| **改动跨 ≥ 2 个独立模块** | 模块 = 第一级有功能含义的目录（如 `src/auth/` 与 `src/api/`、`commands/k/` 与 `kit/study/`）；同 monorepo 下 `.claude/` 等单一外壳层不计 |
| **`feat/fix` + `chore(deps)` 显式混合** | 即源码改动 + `package.json` + 锁文件同时存在 |
| **大量纯 `-` 删除（dead code 清理）与 `feat/fix` 共存** | numstat 中某文件 `+ < 5` 且 `- > 30`，同时其它文件 `+/-` 混合 |
| **`-U0` 总改动 > 400 行**（已是封顶值） | 默认建议拆分 |

> 「2 个模块」与「3 个顶层目录」的差异：toolkit / library 项目常见「2 个独立功能模块」场景（如本仓库的 `commands/` + `kit/study/`），阈值改为 ≥ 2 后能正确触发。误拆风险靠下面的**保守阈值** + **import 共享依赖检查**兜底。

#### 不触发拆分（保守阈值，避免过度拆分）

- **doc/test 与对应 feat/fix 一起改** → 配套关系，**不拆**（`docs/x.md` + `src/x.ts` 是单 commit）
- **多文件但单一主题**（如 feat 涉及 `store` + `view` + `service`） → **不拆**
- **改动 < 100 行 -U0** → 默认单 commit
- **首次 commit / 项目初始化** → 不拆

#### 精细判定（候选触发后基于 `-U0` 内容裁决）

1. **按以下顺序聚类候选分组**：
   - `package.json` + `*lock*` / `*.lock` → `chore(deps)` 独立组
   - 纯 `*.md` 文档（且**无**配套 src 改动） → `docs` 独立组
   - 整文件纯 `-` 删除（dead code） → `chore` / `refactor` 独立组
   - 其余源码 → 主功能组（继续按下一步判共享依赖）

2. **共享依赖检查**：源码组内文件之间是否有 import / require 引用（`-U0` 内容里的 import 行可见）→ 互相 import = 同一逻辑组，**合并不拆**

3. **最终判定**：
   - 聚类后 ≥ 2 组且组间无共享 import → **建议拆分**（进入 Step 3 多 commit 输出）
   - 否则 → **单 commit**（走原 Step 3 输出）

#### 判定输出（内部记录，Step 3 使用）

```json
{
  "split_suggested": true | false,
  "reason": "三目录无共享依赖 / feat+deps 混合 / dead code 清理 + feat / 巨型改动",
  "groups": [
    { "type": "feat", "scope": "auth", "files": ["src/auth/login.ts"], "summary": "新增登录" },
    { "type": "chore", "scope": "deps", "files": ["package.json", "pnpm-lock.yaml"], "summary": "升级 wagmi" }
  ]
}
```

> 若 `split_suggested: false` → `groups` 仅含 1 项，等价于单 commit。

---

### Step 3: 输出 commit 建议（严格 schema）

```json
{
  "type": "feat | fix | docs | style | refactor | perf | test | chore",
  "scope": "模块名（kebab-case）",
  "subject": "English imperative, lowercase verb-first, ≤ 50 chars, ASCII only (no CJK characters)",
  "breaking": false,
  "body": "Optional. English only, multi-line why explanation. ASCII only (no CJK characters).",
  "files_summary": [
    { "file": "path/to/file.ts", "change": "一句话说明改动" }
  ]
}
```

**生成完整 commit message**：

```
<type>(<scope>): <subject>

[body 如果有]
```

---

## 规范要求（强制）

遵循项目 `rules/modules/<project>/git-commit.md`：

1. **格式**：`<type>(<scope>): <description>` 单行完成
2. **description（强制英文）**：
   - 必须全英文，**禁止任何 CJK 字符**（中文 / 日文 / 韩文）
   - 祈使句，小写动词开头（add / fix / update / remove / refactor 等）
   - ≤ 50 字符
   - 项目规则 `rules/modules/<project>/git-commit.md` 中的中文示例**仅供格式参考**，本命令强制以英文输出，覆盖任何"中文版"示例
3. **type**：必须从枚举中选
4. **scope**：从主要改动目录推断，kebab-case
5. **破坏性变更**：type 后加 `!`，如 `feat(api)!:`

### 自检（输出前必须做）

生成 subject 后，扫描字符串：
- 若包含任何非 ASCII 字符（如中文标点、汉字、全角符号）→ 立即重写为纯英文
- 若包含中英混排（如 `dev 下关闭 important`）→ 完全重写，不允许保留中文连接词

---

## 完成条件

**输出禁令（硬规则，不可绕过）**：

- ❌ 禁止输出 `cd <path>`（多余的目录切换，user 已在项目根目录）
- ❌ 禁止输出 `git add file1 file2 ...`（代 user 决定加哪些文件 = 越界；user 自己 `git add` / `git add -A` / `git commit -am` 由其决定）
- ❌ 禁止输出 `git commit -m "$(cat <<'EOF' ... EOF)"` heredoc 多行形式（不必要的复杂）
- ❌ 禁止输出多行 body 长文（subject 一行足矣，除非用户明确要求 body）
- ❌ 禁止输出 `Co-Authored-By` trailer（trailer 由 AI 实际执行 `git commit` 时 Bash 规范自动加，不属"建议给用户看"的内容）
- ✅ **允许**：用单行 `git commit -m '<subject>'` 包装 subject，方便 user 复制直接跑
- ✅ **允许**：subject 一行 + 改动概要（file → 一句话）

违反禁令理由"多写点更贴心 / 加 trailer 更规范"**一概不接受**——参考 `/k:check --fast 自作主张` 教训。

**输出格式（按 Step 2.5 `split_suggested` 分支）**：

#### 分支 A：单 commit（`split_suggested: false`）

```markdown
## 📝 Commit 建议

\`\`\`bash
git commit -m '<type>(<scope>): <subject>'
\`\`\`

**改动概要**：
- `path/file1.ts` — [改了什么]
- `path/file2.ts` — [改了什么]
```

#### 分支 B：多 commit 建议（`split_suggested: true`）

```markdown
## 📝 Commit 建议（检测到 N 组独立主题，建议拆分）

> 拆分理由：<Step 2.5 的 reason>
> 拆分仅为建议——如不想拆，直接 `git add -A && git commit -m '<合并 subject>'` 单 commit 提交即可

### Commit 1/N
\`\`\`bash
git add <file1> <file2>
git commit -m '<type>(<scope>): <subject>'
\`\`\`
**改动概要**：
- `<file1>` — [改了什么]
- `<file2>` — [改了什么]

### Commit 2/N
\`\`\`bash
git add <file3>
git commit -m '<type>(<scope>): <subject>'
\`\`\`
**改动概要**：
- `<file3>` — [改了什么]

（依此类推到 N/N）

### 单 commit 备选（如不拆）
\`\`\`bash
git commit -m '<type>(<scope>): <合并后的 subject>'
\`\`\`
```

> **subject 含单引号时**：用双引号包 `git commit -m "<subject>"`；
> 同时含双引号时：转义为 `git commit -m "He said \"hi\""`。
> 单引号场景罕见（subject 通常是 imperative 英文短句），常规用单引号即可。

> **多 commit 时的 `git add`**：必须显式列文件路径（不能 `-A`），否则会把其它组的文件也带上；这是分支 B 比分支 A 多出 `git add` 行的原因。

**输出完毕立即返回**——本命令是**纯函数**：输入 git diff，输出建议，返回。是否执行 `git commit` 由用户在主对话主动表达（"帮我 commit"等），属用户层决策，不在本命令职责内。

> 设计原则：commit.md 不主动等待用户决定 / 不主动执行 git commit。
> 这样任何上层命令（如 `/k:check`）复用 `/k:commit` 都不会被阻塞。
