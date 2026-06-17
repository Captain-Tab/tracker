---
module: rules-essential
type: rules
version: 1.0.0
released: 2026-05-22
versioning: semver
status: active
source: .claude/rules/essential/
---

# Rules / essential 变更日志

> 版本约定：SemVer，第一个 `## v<x.y.z>` 即当前版本。
>
> 本模块管理跨项目共享的 always-on 规则集。所有 sosokit-install 过的项目都会装入 essential 全部文件，与项目专属 `modules/<family>/` 并行注入。

## v1.0.0 - 2026-05-22

### ✨ 初次抽取 —— 跨项目共享 rules 分层落地

**背景**：5 个 sodex-* 模块（sodex-web / sodex-next / sodex-lens / sodex-biz / sodex-admin-dashboard）下存在大量内容重复的 always-on rules：

| 文件 | 模块覆盖 | hash 一致性 |
|---|---|---|
| `constitution.md` | 5/5 | 仅占位注释里项目名不同，主体 100% 相同 |
| `git-commit.md` | 5/5 | hash 完全相同 |
| `clean-code.md` | 3/3（web/next/admin-dashboard）| hash 完全相同 |
| `regular.md` | 5/5 共享 base（13 行）| web/biz = 13 行（仅 base）；next/lens/admin = 23 行（base + 10 行扩展）|

DRY 反模式：每改一处共享规则要改 5 处。

### 设计决策

借鉴 mattpocock/skills 的 essential 分层 + lazy creation 思想（参见 `study/output/mattpocock-skills.md`），采用**方案 A（两层结构）**：

```
essential/                ← 4 个跨项目共享，所有项目装载
modules/<project>/        ← 项目专属，按 family 分发
```

**未采纳方案 B（三层 frontend-essential）** 的理由：仅为去重 react / figma-style-mapping / malicious-npm-package 三个文件（共 7 份冗余）多引入一层概念，deletion test 判定为 pass-through 层（边界争议高 / 改动频率低）。

### 变更

| 文件 | 改动 |
|---|---|
| `rules/essential/constitution.md` | **新增**（44 → 28 行，删除原 5 个模块占位注释段，加 hint：项目专属请新建 `modules/<project>/constitution-extra.md`）|
| `rules/essential/git-commit.md` | **新增**（87 行，从 sodex-web 抽，与其他 4 模块 hash 一致）|
| `rules/essential/clean-code.md` | **新增**（74 行，从 sodex-web 抽，与 next/admin 一致）|
| `rules/essential/regular.md` | **新增**（13 行 base，从 sodex-web/biz 抽，去掉空 frontmatter）|
| `rules/modules/sodex-*/constitution.md` | **删除** × 5 |
| `rules/modules/sodex-*/git-commit.md` | **删除** × 5 |
| `rules/modules/sodex-{web,next,admin-dashboard}/clean-code.md` | **删除** × 3 |
| `rules/modules/sodex-*/regular.md` | **删除** × 5 |
| `rules/modules/sodex-{next,lens,admin-dashboard}/regular-extra.md` | **新增** × 3（10 行扩展：Zustand selector 稳定性 + Shared 基础组件测试门禁）|

合计：19 个文件删除，7 个文件新增（4 essential + 3 regular-extra），净 -12 个文件、-911 行（含 install.sh / sync.sh）。

### regular base + extension 设计

```
所有项目都注入 essential/regular.md（13 行 base：代码修改规范 + 注释规范）
next/lens/admin-dashboard 额外注入 modules/<self>/regular-extra.md（10 行扩展）
web/biz 仅有 base
```

注入合并在下游扁平 `.claude/rules/` 目录完成（install.sh 将 essential 和 module 文件复制到同一目录）。

### 配套 cli 改动

参见 `version/kit/cli.md` v1.17.0：
- `install.sh::apply_family_rules` 先装 essential 再装 module
- `sync.sh` 反向同步按文件名分流回 essential / modules

### 测试矩阵（端到端）

| 场景 | 结果 |
|---|---|
| install sodex-web | 装入 10 个文件（4 essential + 6 module）✓ |
| install sodex-next | 装入 14 个文件（4 essential + 10 module 含 regular-extra）✓ |
| install sodex-biz | 装入 4 个文件（仅 essential）✓ |
| sync dry-run：下游改 constitution.md | 显示 `→ essential/`，分流正确 ✓ |
| sync dry-run：下游改 module 专属文件 | 显示 `→ modules/<family>/` ✓ |
| sync dry-run：下游加陌生 .md | 归入 modules/<family>/（默认）✓ |
| /k:check 双闸门（main + Explore subagent） | PASS（subagent 发现 SPLIT_TMP 泄露已修复）✓ |

### 维护成本变化

| 操作 | v0.x（重组前）| v1.0.0（重组后）|
|---|---|---|
| 改 git-commit 规范 | 改 5 处 | 改 1 处（essential/）|
| 改 clean-code 规则 | 改 3 处 | 改 1 处 |
| 改 constitution 元原则 | 改 5 处 | 改 1 处 |
| 改 regular base | 改 5 处 | 改 1 处 |
| 改 next/lens/admin 扩展规则（Zustand 等）| 改 3 处 | 改 3 处（regular-extra.md，不变）|

### 已知非目标 / 留作后续

- react.md / figma-style-mapping.md / malicious-npm-package.md 仍在前端模块下重复（3/2/2 份）—— 改频率低，方案 A 接受这部分冗余
- 后续若引入 model-invoked skill 化（soft dependency 改造），会进一步压缩 always-on 注入 token；本轮先做结构纯化
