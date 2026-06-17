# Mastery 系统文档

## 概述

Mastery 是 soso-kit 的 Skills 执行系统，提供两大核心功能：

1. **直接执行 Skills**：分析任务 → 匹配 skill → **加载 SKILL.md 直接执行**
2. **生成 Skills**（`learn`）：从文档生成标准的 Claude Skills

---

## 目录结构

```
.cursor/kit/mastery/
├── skills/                    # skill 源文档
│   └── example-skill.md       # 示例文档
├── scripts/                   # 核心脚本
│   ├── analyze-standards.sh   # 规范分析脚本
│   └── generate-skill.sh      # Skill 生成脚本
└── README.md                  # 本文档
```

---

## 使用方式

### 方式 1：直接执行 Skills（默认）

分析任务，匹配 skill，**直接加载并执行**：

```bash
/k/mastery 创建弹窗组件        → 加载 soso-responsive-modal-creation 并执行
/k/mastery 翻译 i18n 文件      → 加载 soso-translation-auto 并执行
/k/mastery 还原 Figma 设计图   → 建议用户直接使用 /k:figma 命令
/k/mastery 创建 worktree 分支  → 加载 git-worktree-new-folder 并执行
```

**工作流程**：
1. 运行 `analyze-standards.sh` 分析任务关键词
2. 匹配 `.cursor/skills/*/SKILL.md` 中最相关的 Skills
3. 脚本输出 `##SKILL_LIST: skill1|skill2`（机器可读）
4. AI 读取每个匹配 skill 的 SKILL.md
5. **按照 skill 指导直接执行任务**（不只是推荐）

**输出示例**：
```
📋 规范分析结果

任务类型: 创建

适用规范:
- react-component.mdc ✅
- typescript-strict.mdc ✅

适用 Skills:
- soso-responsive-modal-creation - 创建响应式弹窗

检查清单:
- [ ] 组件使用 TypeScript
- [ ] 组件支持响应式
- [ ] 组件符合项目规范
```

---

### 方式 2：生成 Skills（learn 参数）

从 `mastery/skills/` 目录生成标准的 Claude Skills：

```bash
/k/mastery learn
```

**工作流程**：
1. 将文档放入 `.cursor/kit/mastery/skills/`
2. 执行 `/k/mastery learn`
3. 脚本自动生成 `.cursor/skills/` 下的标准 Skill
4. 包含 SKILL.md 和 references/original.md

**自动处理**：
- ✅ 文件名转换为 kebab-case
- ✅ 提取标题和摘要
- ✅ 生成标准目录结构
- ✅ 创建符合规范的 SKILL.md
- ✅ 复制原始文档到 references/

**命名示例**：
| 源文件名 | Skill 目录名 |
|----------|-------------|
| `React Best Practices.md` | `react-best-practices/` |
| `TypeScript_Guidelines.md` | `typescript-guidelines/` |
| `API Design.md` | `api-design/` |

---

## Scripts 说明

### analyze-standards.sh

**功能**：分析任务，匹配并输出 Skills 列表

**参数**：`[任务描述]`

**关键词组**（覆盖的场景）：

| 关键词组 | 触发词 | 匹配 Skill |
|---------|--------|-----------|
| REACT | react, 组件, modal, drawer, hook, useEffect | soso-responsive-modal-creation |
| GIT | git, branch, worktree, commit | git-worktree-new-folder |
| I18N | i18n, 翻译, locale, translate | soso-translation-auto |
| STYLE | figma, 设计图, css, restore | （使用 /k:figma 命令，已不再是 skill） |
| PRD | prd, 需求, document, spec, notion | document-to-spec |

**机器可读输出**（末尾两行）：
```
##SKILL_LIST: skill1|skill2
##SKILLS_DIR: /path/to/.cursor/skills
```
mastery.md 的 Step 2 解析这两行来加载并执行 skill。

**调用方式**：
```bash
bash .cursor/kit/mastery/scripts/analyze-standards.sh "创建弹窗组件"
# 输出: ##SKILL_LIST: soso-responsive-modal-creation
```

---

### generate-skill.sh

**功能**：Skill 生成脚本

**参数**：无（自动扫描 mastery/skills/）

**工作原理**：
1. 扫描 `.cursor/kit/mastery/skills/*.md`
2. 读取模板 `.cursor/kit/templates/skill-template.md`
3. 为每个文档生成标准 Skill 目录
4. 创建 SKILL.md 和 references/original.md
5. 跳过已存在的 Skill（避免覆盖）

**调用方式**：
```bash
bash .cursor/kit/mastery/scripts/generate-skill.sh
```

**输出示例**：
```
📚 Skill 生成器

📂 扫描 mastery/skills 目录...
Source 目录: /path/to/.cursor/kit/mastery/skills

📄 处理: example-skill.md
   ✅ 生成成功: /path/to/.cursor/skills/example-skill

📊 生成统计
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
总文件数: 1
成功生成: 1
跳过: 0

✨ 完成!
```

---

## Skills 标准格式

### 目录结构

```
.cursor/skills/{skill-name}/
├── SKILL.md               # Skill 定义（必需）
├── scripts/               # 可执行脚本（可选）
├── references/            # 参考文档（可选）
│   └── original.md        # 原始文档
└── metadata.json          # 元数据（可选）

# 变更日志统一存放于 .claude/version/skills/{skill-name}.md（由 /k:version 管理）
```

### SKILL.md 格式

```markdown
---
name: skill-name               # kebab-case
description: 一句话描述,包含触发短语
license: MIT
metadata:
  author: author-name
  version: "1.0.0"
---

# Skill 标题

简要描述 Skill 的功能和用途。

## When to Apply

列出何时应该使用此 Skill:
- 场景 1
- 场景 2

## How It Works

1. 步骤 1
2. 步骤 2
3. 步骤 3

## Usage

\`\`\`bash
# 使用示例或说明
\`\`\`

## Output

描述 Skill 的输出格式

## References

- 参考资料链接
```

---

## Token 优化策略

### v2.6 优化成果

通过合并命令和脚本化，显著减少 token 消耗：

| 指标 | 优化前 | 优化后 | 节省 |
|------|--------|--------|------|
| **命令文件** | 2 个（488 行） | 1 个（~100 行） | 388 行 |
| **Token 消耗** | ~24,400 | ~5,000 | **19,400 (79.5%)** |

**优化原理**：
1. **命令合并**：mastery + practice → mastery（learn 参数）
2. **脚本外部化**：详细逻辑移到 scripts/，命令只保留入口
3. **目录统一**：coach/ → mastery/skills/，集中管理

---

## 最佳实践

### 1. Skill 源文档质量

**好的源文档**：
```markdown
# React Performance Optimization

## Core Principles

1. Minimize re-renders
2. Optimize bundle size
3. Use proper memoization

## Guidelines

### Avoid Inline Objects
...
```

**不好的源文档**：
```markdown
一些零散的笔记
没有清晰的结构
...
```

---

### 2. Description 优化

**好的 description**：
```yaml
description: React performance optimization guidelines. Use when optimizing React components, reducing re-renders, or improving bundle size.
```

**不好的 description**：
```yaml
description: React stuff
```

---

### 3. 渐进式优化

```
第一次生成 → 基础 Skill
     ↓
手动优化 → 完善 description 和场景
     ↓
添加脚本 → 实现自动化
     ↓
持续迭代 → 根据使用反馈优化
```

---

## 与其他命令的关系

| 命令 | 功能 | 调用 Mastery |
|------|------|-------------|
| `/k/mastery` | 规范分析 | - |
| `/k/mastery learn` | 生成 Skills | - |
| `/k/task --ag` | 任务执行 + 规范分析 | ✅ 调用 analyze-standards.sh |

---

## 相关文件

| 类型 | 路径 | 说明 |
|------|------|------|
| **命令** | `.cursor/commands/k/mastery.md` | 统一入口命令 |
| **源文档** | `.cursor/kit/mastery/skills/` | Skill 源文档 |
| **分析脚本** | `.cursor/kit/mastery/scripts/analyze-standards.sh` | 规范分析 |
| **生成脚本** | `.cursor/kit/mastery/scripts/generate-skill.sh` | Skill 生成 |
| **模板** | `.cursor/kit/templates/skill-template.md` | Skill 模板 |
| **生成的 Skills** | `.cursor/skills/` | 标准 Skills |
| **规范文件** | `.cursor/rules/` | 项目规范 |

---

## 常见问题

### Q: 为什么要合并 mastery 和 practice？

**A**: Token 优化 + 简化命令

- **优化前**：2 个命令（488 行，24,400 tokens）
- **优化后**：1 个命令（100 行，5,000 tokens）
- **节省**：79.5% token

### Q: learn 参数是什么意思？

**A**: Practice（实践）模式

- 默认：分析规范（analyze）
- `learn`：生成 Skills（practice/generate）

### Q: 为什么移除 coach 目录？

**A**: 统一管理

- **之前**：coach/ 独立存在，与 mastery 分离
- **现在**：mastery/skills/ 集中管理
- **优势**：结构清晰，减少目录层级

### Q: startup 目录去哪了？

**A**: 保留了

- startup 被 document-to-spec skill 使用
- 不影响 mastery 系统
- 位置：`.cursor/kit/startup/`

---

## 参考资料

- [agentskills.io](https://agentskills.io/) - Skills 官方标准
- `.cursor/kit/docs/what-is-claude-skills.md` - Skills 深度理解
- [anthropics/skills](https://github.com/anthropics/skills) - 官方示例
- `.cursor/kit/context/EVALUATION.md` - Context 系统评估（类似架构）

---

## 版本历史

### v2.6 - 2026-02-17

**核心改进**：
1. ✅ 合并 mastery 和 practice 命令
2. ✅ 创建 mastery/ 目录，统一管理
3. ✅ coach/ → mastery/skills/
4. ✅ 脚本外部化，减少 79.5% token
5. ✅ 移除 practice.md 和 coach/

**设计优势**：
- ✅ 命令统一（一个入口）
- ✅ 结构清晰（mastery/ 自包含）
- ✅ Token 优化（脚本化）
- ✅ 易于维护（模块化）

---

**评估日期**: 2026-02-17
**版本**: v2.6
