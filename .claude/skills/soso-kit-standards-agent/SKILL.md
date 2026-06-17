---
name: soso-kit-standards-agent
description: 仅在用户明确要求"分析规范"、调用 /k/mastery 或使用 /k/task --ag 时使用。不要自动触发。
license: MIT
metadata:
  author: soso-kit
  version: "2.0.0"
---

# Standards Agent

分析任务并推荐适用的规范和 Skills。

## 触发条件

- 用户调用 `/k/mastery`
- 用户使用 `/k/task --ag`
- 用户明确要求分析规范

## 执行流程

### 1. 动态读取资源

**读取规范**:
```bash
ls .claude/rules/*.md
```

**读取 Skills**:
```bash
ls .claude/skills/*/SKILL.md
```

### 2. 分析任务

- 提取关键词（React, 组件, 性能, Git 等）
- 识别任务类型（创建, 修改, 重构, 优化）
- 识别文件类型（.tsx, .ts, .css, .md 等）

### 3. 动态匹配

| 匹配维度 | 匹配方式 |
|----------|----------|
| 文件扩展名 | `.tsx/.jsx` → 匹配含 react 的规范 |
| 关键词 | 任务描述 → 匹配 Skill 的 description |
| 路径模式 | `components/` → 匹配组件相关规范 |

### 4. 输出结果

```
📋 规范分析结果

任务类型: [类型]
涉及文件: [文件]

适用规范: [从 .claude/rules/ 动态匹配]
适用 Skills: [从 .claude/skills/ 动态匹配]

检查清单:
- [ ] [根据规范内容生成]
```

## 匹配原则

- 实时读取目录，不使用写死列表
- 根据 Skill 的 description 进行语义匹配
- 根据规范文件名和**内容**进行匹配

## 匹配规则示例

| 任务描述 | 文件类型 | 匹配规范 | 匹配 Skill |
|----------|----------|----------|------------|
| "创建 React 组件" | .tsx | react.mdc, clean-code.mdc | 含 react 的 skill |
| "优化性能" | .ts | clean-code.mdc | 含 performance 的 skill |
| "创建分支目录" | - | - | 含 worktree/git 的 skill |
| "修改样式" | .css/.scss | - | 含 style/design 的 skill |

**匹配逻辑优先级**：
1. 规范文件内容中的关键词 > 文件名
2. Skill 的 description > Skill 名称
3. 文件扩展名 → 相关规范

## 输出格式示例

```
📋 规范分析结果

任务类型: 创建
涉及文件: src/components/Button.tsx

适用规范:
- react.mdc ✅
- clean-code.mdc ✅
- regular.mdc ✅

适用 Skills:
- git-worktree-new-folder (如匹配)

检查清单:
- [ ] 组件命名使用 PascalCase
- [ ] Props 类型完整定义
- [ ] 注释使用中文
```
