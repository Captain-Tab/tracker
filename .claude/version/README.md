# `.claude` Version Index

集中管理 `.claude/` 各模块的变更日志（CHANGELOG）与版本元数据。

---

## 设计原则

- **CHANGELOG 是版本真相源**：每份 `.md` 既是变更日志也是版本载体
- **frontmatter 是机器可读索引**：顶部 YAML 冗余记录当前版本，供 `/k:version` 命令快速聚合
- **绑定关系**：frontmatter `version` 必须等于 CHANGELOG 第一个 `##` 标题中的版本号；写入由 `/k:version bump` 命令保证原子化

## 目录结构

```
version/
├── README.md                          # 本文件
├── soso-kit-profile.md                # soso-kit 自画像（命令清单 + 模块结构快照，study 对比基准）
├── commands/                          # /k/* 命令体系
│   └── k.md
├── kit/                               # kit 工具链（同源迭代）
│   ├── cli.md
│   ├── context.md
│   └── study.md
├── rules/                             # always-on 规则集（按 family 拆分）
│   └── sodex-next.md
├── skills/                            # 自有 skills
│   └── soso-translation.md
└── skillsmp/                          # 第三方 skills（marketplace）
    └── figma-mcp-restore.md
```

原 6 处 `CHANGELOG.md` 改为 stub，重定向到这里，保留历史引用兼容。

## Frontmatter 字段

```yaml
---
module: <id>            # 唯一 ID
type: commands|kit|rules|skills|skillsmp
version: <x.y.z|date>   # 当前版本（与 CHANGELOG 第一条 entry 一致）
released: YYYY-MM-DD
versioning: semver|date # 决定版本号格式
status: active|stable|deprecated
source: <path>          # 对应代码路径
---
```

## 两种 versioning 模式

| 模式 | 适用 | 标题格式 |
|------|------|---------|
| `semver` | 持续迭代有版本节奏（context / cli / study / 两个 skill） | `## v<x.y.z> - <date>` 或 `## [<x.y.z>] - <date>` |
| `date` | 按发布日期版本化（commands/k） | `## [<YYYY-MM-DD>] <标题>` |

## 工作流

1. **修改某模块代码后** → 编辑对应 `version/<class>/<module>.md`
2. 在文件顶部新增 `## ...` entry
3. 同步更新 frontmatter 的 `version` 和 `released`
4. 用 `/k:version list` 核查所有模块版本一致性

> 推荐：用 `/k:version bump <module> <patch|minor|major|today>` 一条命令完成 entry 模板插入 + frontmatter 同步。

---

<!-- VERSION_MATRIX_AUTO_GENERATED — 由 /k:version list --update-readme 重写 -->

## 版本矩阵（手工维护，更新于 2026-05-30）

| 模块 | 类型 | versioning | 当前版本 | 发布日期 | 状态 | 源路径 |
|------|------|-----------|---------|---------|------|--------|
| k | commands | date | 2026-05-06 | 2026-05-06 | active | `.claude/commands/k/` |
| context | kit | semver | 2.9.0 | 2026-04-14 | active | `.claude/kit/context/` |
| cli | kit | semver | 1.17.0 | 2026-05-22 | active | `.claude/kit/cli/` |
| study | kit | semver | 1.2.0 | 2026-05-30 | active | `.claude/kit/study/` |
| principles | kit | semver | 1.2.0 | 2026-05-09 | active | `.claude/kit/principles/` |
| rules-essential | rules | semver | 1.0.0 | 2026-05-22 | active | `.claude/rules/essential/` |
| rules-sodex-next | rules | semver | 1.0.0 | 2026-05-09 | active | `.claude/rules/modules/sodex-next/` |
| soso-translation | skills | semver | 1.0.0 | 2026-05-30 | active | `.claude/skills/soso-translation/` |
| figma-mcp-restore | skillsmp | semver | 3.1.0 | 2026-02-15 | active | `.claude/skillsmp/figma-mcp-restore/` |
