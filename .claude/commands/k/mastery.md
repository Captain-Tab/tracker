---
description: 规范分析并直接应用 Skills 执行任务
---

# Mastery: Skills 执行器

**目的**:
- 默认：分析任务 → **直接加载并执行匹配的 Skills**
- `learn`：从文档生成新的 Skills

---

## 用户输入

```text
$ARGUMENTS
```

---

## 使用方式

```bash
# 模式 1：分析任务并直接应用 Skill 执行
/k/mastery [任务描述]
/k/mastery 我要创建一个 React 弹窗组件

# 模式 2：从 mastery/skills/ 文档生成新 Skills
/k/mastery learn
```

---

## 执行流程

### Step 0: 环境准备

```bash
if [ -f ".claude/kit/cli/config.sh" ]; then
    KIT_ROOT="$(pwd)"
elif [ -f "../.claude/kit/cli/config.sh" ]; then
    KIT_ROOT="$(cd .. && pwd)"
elif [ -f "../../.claude/kit/cli/config.sh" ]; then
    KIT_ROOT="$(cd ../.. && pwd)"
else
    echo "❌ 未找到 soso-kit 配置"; exit 1
fi
```

### Step 1: 路由 — learn 还是执行

```bash
if echo "$ARGUMENTS" | grep -q "^learn"; then
    # learn 模式：生成 Skills 文档
    bash "$KIT_ROOT/.claude/kit/mastery/scripts/generate-skill.sh"
    # 执行完毕，结束
else
    # 默认模式：分析并执行
    bash "$KIT_ROOT/.claude/kit/mastery/scripts/analyze-standards.sh" "$ARGUMENTS"
    # 继续 Step 2
fi
```

### Step 2: 解析匹配结果 → 加载并执行 Skills

> ⚠️ **仅在默认模式（非 learn）下执行此步骤**

从脚本输出中找到 `##SKILL_LIST:` 行：

```bash
# 示例输出：
# ##SKILL_LIST: soso-responsive-modal-creation
# ##SKILLS_DIR: /path/to/.claude/skills
```

**按照以下逻辑处理**：

#### 有匹配的 Skills

对每个匹配到的 skill（按 `|` 分隔）：

1. 读取该 skill 的 SKILL.md：
   ```
   .claude/skills/{skill-name}/SKILL.md
   ```

2. 理解 skill 的 **When to Apply** 和 **How It Works**

3. **直接按照 skill 的指导执行任务** — 不是推荐，是执行

**重要**：加载多个 skill 时，综合所有 skill 的指导，统一执行任务。

#### 无匹配的 Skills（`##SKILL_LIST: (none)`）

按照已匹配的规范（`##RULE_LIST:`）直接执行任务：
- 遵循 `.claude/rules/regular.mdc` 通用规范
- 遵循任务相关的其他规范

---

## 模式 2：learn - 生成 Skills

**触发方式**：`/k/mastery learn`

### 工作流程

1. 将文档放入 `.claude/kit/mastery/skills/`
2. 执行 `/k/mastery learn`
3. 脚本自动生成 `.claude/skills/` 下的标准 Skill

### 源文档要求

```
.claude/kit/mastery/skills/
├── your-guide.md          # Markdown 格式，第一行为 # 标题
└── another-skill.md
```

### 生成的 Skill 标准格式

```markdown
---
name: skill-name
description: 一句话描述，包含触发短语
license: MIT
metadata:
  author: soso-kit
  version: "1.0.0"
---

# Skill 标题

## When to Apply
- 场景 1
- 场景 2

## How It Works
1. 步骤 1
2. 步骤 2

## References
- 来源文档
```

---

## 相关文件

- **源文档**: `.claude/kit/mastery/skills/`
- **脚本**: `.claude/kit/mastery/scripts/`
- **生成的 Skills**: `.claude/skills/`
- **规范文件**: `.claude/rules/`

---

## 相关命令

- `/k/task --ag` - 执行任务时开启规范分析
- `/k/check` - 代码检查和验收
