---
description: 版本矩阵查询与 bump：list / show / bump
---

# /k:version

集中管理 `.claude/version/` 下所有模块的版本与变更日志。

## 子命令

| 命令 | 功能 |
|------|------|
| `/k:version` | 等价 `list` |
| `/k:version list` | 列出所有模块当前版本（聚合 frontmatter） |
| `/k:version show <module>` | 显示某模块 frontmatter + 最近 3 条 entry |
| `/k:version bump <module> <level>` | 推算新版本，插入 entry 模板，同步 frontmatter |

## 实现指引（由 Claude 执行）

### list

1. 遍历 `.claude/version/{commands,kit,skills,skillsmp}/*.md`
2. 解析每份顶部 YAML frontmatter
3. 输出表格：`module | type | version | released | versioning | status`
4. 同时核查"frontmatter version" vs "文件首个 `## ` 标题中的版本号"是否一致；不一致标 `⚠ MISMATCH`
5. `--update-readme` 选项：把表格写入 `.claude/version/README.md` 的 `<!-- VERSION_MATRIX_AUTO_GENERATED -->` 标记之下

### show <module>

1. 按 frontmatter `module` 字段定位文件
2. 输出 frontmatter 全部字段
3. 输出最近 3 个 `## ` entry 段落（截断超过 30 行的部分）

### bump <module> <level>

`<level>`：
- 对 `versioning: semver` 模块：`patch` / `minor` / `major`
- 对 `versioning: date` 模块：`today` / `<YYYY-MM-DD>`

步骤：
1. 读取 frontmatter 当前 `version` 和 `versioning`
2. 推算新版本：
   - semver `patch`：`x.y.z` → `x.y.(z+1)`
   - semver `minor`：`x.y.z` → `x.(y+1).0`
   - semver `major`：`x.y.z` → `(x+1).0.0`
   - date `today`：使用今天日期
3. 在 frontmatter 之后、第一个已有 `## ` 之前插入模板：
   ```
   ## [<新版本>] - <YYYY-MM-DD>
   ### Added / Changed / Fixed / Removed
   - <在此填写>
   ```
   （semver 模块用 Keep a Changelog 4 类；date 模块用自由标题）
4. 更新 frontmatter `version` 和 `released`
5. 提示用户填写 entry 内容，完成后建议运行 `/k:version list` 核查

## 约束

- 所有变更日志统一在 `.claude/version/<class>/<module>.md`，原模块目录下不再保留 `CHANGELOG.md`
- frontmatter 与 CHANGELOG 第一行的版本号必须一致；list 命令负责事后核查
- 跨模块的版本号互相独立，bump 一个模块不影响其他

## 相关

- 设计文档：`.claude/version/README.md`
- 各模块 changelog：`.claude/version/<class>/<module>.md`
