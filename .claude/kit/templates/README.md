# K 工作流模板

轻量级规范驱动开发模板，与 `.cursor/commands/k/` 目录结构对应。

---

## 目录结构

```
.cursor/kit/templates/
├── spec-template.md      # 需求规范 → 对应 /k/spec
├── plan-template.md      # 实现计划 → 对应 /k/plan
├── task-template.md      # 任务清单 → 对应 /k/task
├── check-template.md     # 检查清单 → 对应 /k/check
├── rules-template.md     # 项目规则
└── flow-template.md      # 需求流程图 (history)
```

---

## 工作流程

```
spec → plan → task → 开发 → check → history
(做什么) (怎么做) (执行)      (验收)   (归档)
```

---

## 快速开始

```bash
# 创建功能目录
mkdir -p specs/001-功能名

# 复制模板
cp .cursor/template/spec-template.md specs/001-功能名/spec.md
cp .cursor/template/plan-template.md specs/001-功能名/plan.md
cp .cursor/template/task-template.md specs/001-功能名/task.md
cp .cursor/template/check-template.md specs/001-功能名/check.md
```

---

## 模板说明

| 模板 | 用途 | 行数 |
|------|------|------|
| spec | 用户故事、验收标准、功能需求 | ~70 |
| plan | 技术方案、数据模型、API | ~70 |
| task | 按故事分阶段的任务清单 | ~70 |
| check | 验收检查清单 | ~50 |
| rules | 项目规则约束 | ~65 |
| flow | 需求流程图(Mermaid) | ~50 |
| practice | 生成skills文档 ｜ ~100 |

---

## 与 K 工作流的关系

| 模板文件 | 对应命令 | 说明 |
|----------|----------|------|
| `spec-template.md` | `/k/spec` | 需求规范定义 |
| `plan-template.md` | `/k/plan` | 实现计划制定 |
| `task-template.md` | `/k/task` | 任务执行跟踪 |
| `check-template.md` | `/k/check` | 代码检查验收 |

---

## 特点

- ✅ **精简**: 每个模板 < 100 行
- ✅ **实用**: 只保留必要内容
- ✅ **中文**: 全中文模板
- ✅ **扁平化**: 与 k 目录结构一致
