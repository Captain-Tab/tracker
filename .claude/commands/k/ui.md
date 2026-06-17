---
description: UI/样式需求二次确认，确保理解一致后再实现
---

# UI 需求确认: [组件/页面名称]

## 用户输入

```text
$ARGUMENTS
```

---

## 核心目的

**避免 UI/样式需求的理解偏差**，通过结构化提问确保：
- AI 正确理解问题现状
- AI 正确理解期望效果
- AI 正确理解实现约束

---

## 执行步骤

### Step 0.0: 项目识别与规范加载（前置必读,v1.11.1+）

识别当前项目并加载项目级规范(L0 入口 + 硬约束)。

```bash
KIT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
source "$KIT_ROOT/.claude/kit/cli/identify.sh"

# 优先解析显式 --project 参数
EXPLICIT_PROJECT=$(echo "$ARGUMENTS" | grep -oE '\-\-project [a-zA-Z0-9_-]+' | awk '{print $2}')
if [[ -n "$EXPLICIT_PROJECT" ]]; then
    CURRENT_PROJECT="$EXPLICIT_PROJECT"
else
    CURRENT_PROJECT=$(identify_project "$(pwd)" 2>/dev/null || echo "")
fi

# 兜底 1:未识别 → 硬退出(强制先注册或显式 --project)
if [[ -z "$CURRENT_PROJECT" ]]; then
    echo "❌ 错误:无法识别当前项目" >&2
    echo "   请先注册项目(sosokit-add <name>)或显式指定 --project <name>" >&2
    echo "   已注册项目列表见 .claude/kit/projects.conf" >&2
    exit 1
fi

# 兜底 2:已识别但无 project 骨架 → 警告 + 回退到旧路径兜底(不退出)
PROJECT_DIR="$KIT_ROOT/.claude/kit/projects/$CURRENT_PROJECT"
if [[ -d "$PROJECT_DIR" ]]; then
    HAS_PROJECT_KIT=true
else
    echo "⚠️ kit/projects/$CURRENT_PROJECT/ 不存在(老项目未迁移),回退到共享规范旧路径兜底" >&2
    HAS_PROJECT_KIT=false
fi
```

**根据 HAS_PROJECT_KIT 处理**:

- **HAS_PROJECT_KIT=true**(v1.10.0+ 已迁移):
  1. **必读 L0**:`Read .claude/kit/projects/<CURRENT_PROJECT>/PROJECT.md`(PROJECT.md 内用 `@constraints.md` 自动引用约束文件)
  2. **按需加载提示**(后续 Step 根据场景决定读哪些子文件):
     - UI 需求确认 / 样式对比 → `tokens.md` + `components.md` + `patterns.md`
     - Figma 对照 → `figma-mapping.md` + `tokens.md`
     - 生成后自检 → `style-checklist.md`
- **HAS_PROJECT_KIT=false**(老项目未迁移):跳过 L0/L1 加载,走下文"共享规范"优先级 2/3 的旧路径兜底

---

### Step 0: 前置检查（脚本自动执行）

> 脚本 `preflight.sh` 已自动运行，解析参数并检查规范文件。

**根据脚本输出**：
- 读取列出的规范文件
- 如有 Figma URL，记录 fileKey 和 nodeId

---

## 共享规范(加载优先级,v1.11.0+)

> 样式映射按以下优先级查找,**上层命中即使用,下层作兜底**。

| 优先级 | 规范 | 路径 | 适用 |
|-------|------|------|------|
| 1(最高) | **项目级 token / 映射 / 组件 / 模式 / 自检** | `.claude/kit/projects/<CURRENT_PROJECT>/{tokens,figma-mapping,components,patterns,style-checklist}.md` | v1.10.0+ 已迁移项目 |
| 2 | **Figma 样式映射**(兜底) | `.claude/rules/figma-style-mapping.md` | Figma 变量名 → Tailwind 类的跨项目兜底 |
| 3(旧路径,逐步淘汰) | 通用样式规范 / 项目 Token / 组件目录 / 设计模式 | `.claude/kit/figma/references/{specification,specification-project,components,patterns}.md` | 未迁移到 kit/projects/ 的老项目 |

---

### Step 1: 模式分支

```
参数包含 --figma？
├── 是 → 执行 Figma 对照流程（Step 1a）
└── 否 → 执行纯文字描述流程（Step 1b）
```

#### Step 1a: Figma 对照流程

1. **获取设计稿截图 + 详细规格**
   ```
   并行调用：
   - user-Figma-get_screenshot → 视觉参考
   - user-Figma-get_design_context → 详细规格
   ```
   
   > ⚠️ **重要**：截图只能看到布局，必须获取 design_context 才能得到精确样式

2. **提取子元素样式（自底向上）**
   
   > ⚠️ **原则**：忽略容器高度/宽度，只关注子元素样式。子元素样式正确 → 容器尺寸自然正确
   
   从 design_context 提取**子元素**的样式属性：
   
   | 类别 | 属性 | 说明 |
   |------|------|------|
   | **内边距** | padding (p/px/py/pt/pr/pb/pl) | 影响容器撑开 |
   | **外边距** | margin (m/mx/my/mt/mr/mb/ml) | 元素间距 |
   | **间距** | gap/gap-x/gap-y | flex/grid 间距 |
   | **圆角** | border-radius (rounded-*) | 视觉圆角 |
   | **边框** | border-width/border-color | 分隔线/描边 |
   | **背景** | background-color | 填充色 |
   | **渐变** | linear-gradient/radial-gradient | 渐变背景 |
   | **字体** | font-size/font-weight/line-height | 文字样式 |
   | **颜色** | text-color | 文字颜色 |
   
   **忽略项**：容器 width/height（由子元素撑开）

3. **读取当前代码 + 生成差异表**
   
   **使用脚本自动提取当前样式**：
   ```bash
   .claude/kit/ui/scripts/compare-styles.sh <目标文件.tsx>
   ```
   
   脚本输出当前代码的样式表：
   | 类名 | 属性类型 | 实际值 |
   |------|---------|--------|
   | `p-4` | padding | 16px |
   | `rounded-lg` | border-radius | 8px |
   | ... | ... | ... |
   
   **AI 对比 Figma 样式与脚本输出**，生成差异表：
   
   ```markdown
   ## 📊 样式差异（仅显示不同项）
   
   | 属性 | Figma 设计 | 当前代码 | 修改 |
   |------|-----------|----------|------|
   | padding | 8px | 16px (p-4) | `p-4` → `p-2` |
   | gap | 12px | 8px (gap-2) | `gap-2` → `gap-3` |
   
   ### 修改清单
   1. `p-4` → `p-2`
   2. `gap-2` → `gap-3`
   ```
   
   > **✅ 一致的属性不列出**，只聚焦需要修改的部分

4. **读取 patterns.md**
   - 检查是否有匹配的设计模式
   - 命中 → 直接使用模式代码
   - 未命中 → 按修改清单逐项修改

#### Step 1b: 纯文字描述流程

继续 Step 2（解析用户输入）

---

### Step 2: 解析用户输入

从用户输入中提取以下信息（如有）：
- 涉及的文件/组件
- 问题描述
- 期望效果
- 参考截图（如用户粘贴了截图，直接分析图片内容）

### Step 3: 读取相关代码

根据用户输入，读取涉及的组件代码，理解当前实现。

### Step 4: 结构化理解输出

**必须按以下格式输出理解**：

```markdown
## 📋 UI 需求理解

### 1. 问题现状（What's wrong）
[当前的问题是什么，用一句话描述]

### 2. 期望效果（What you want）
[期望达到的效果是什么]

### 3. 实现约束（Constraints）
| 约束类型 | 内容 |
|----------|------|
| 不能改变 | [哪些部分必须保持不变] |
| 需要改变 | [哪些部分需要修改] |
| 动画要求 | [是否需要动画，什么类型] |

### 4. 技术方案（初步）
[简述实现思路，1-2 句话]
```

### Step 5: 识别模糊点并反问

**必须检查以下模糊点**：

| 检查项 | 示例问题 |
|--------|----------|
| **元素指代** | "这个面板"具体指哪个元素？ |
| **方向/位置** | "移上去"是向上滚动还是增加高度？ |
| **触发条件** | 什么时候触发这个变化？ |
| **动画细节** | 需要动画吗？时长多少？ |
| **边界情况** | 内容超出时怎么处理？ |
| **影响范围** | 其他元素是否受影响？ |

**反问格式**：

```markdown
## ❓ 确认问题

### 【必答】
1. [核心模糊点 1]？
2. [核心模糊点 2]？

### 【可选】
3. [细节问题，如有]

请确认后，我将开始实现。
```

---

## 高效描述模板（供用户参考）

如果用户的描述不够清晰，可以引导用户使用以下模板：

```markdown
## 问题
[当前行为是什么]

## 期望
[期望的行为是什么]

## 约束
- 不能改：[xxx]
- 需要改：[xxx]
- 动画：[有/无，描述]

## 参考
[截图/示例链接]
```

---

### Step 6: 自检(v1.11.0+)

需求确认完成(或简单改动直接实现完成)后,读取项目级 checklist 按流程自检:

```
Read .claude/kit/projects/<CURRENT_PROJECT>/style-checklist.md
```

按 checklist 列出的"自检顺序"逐项核对(颜色 token / 边框背景分隔线圆角 / 间距圆角 / 组件用法 / 响应式 / 弹窗壳层 / 命名目录 / 开发范围)。

自检通过后,按 checklist 的"产出说明"段格式在本次回复末尾追加:

- **使用的 token 清单**:{逐条列出}
- **硬编码豁免(如有)**:{位置 + 原因 + 后续替换计划}
- **偏离项(如有)**:{与规范偏离的点 + 理由}

> 若 `kit/projects/<CURRENT_PROJECT>/style-checklist.md` 不存在,跳过此步。

---

## 完成条件

完成上述步骤后，输出：

```
✅ UI 需求确认完成

📋 需求摘要：[一句话描述]
📁 涉及文件：[文件列表]
🎬 动画要求：[有/无]
⚠️ 约束条件：[关键约束]
```

---

## ⏸️ 流转条件

**必须满足以下条件才能进入实现阶段**：

1. ✅ 用户确认理解正确
2. ✅ 所有模糊点已澄清

**如有未澄清的模糊点** → 停止，等待用户回复，不自动流转。

**用户确认后**，可选择：
- 直接实现（简单改动）
- 执行 `/k/task` 进入任务阶段（复杂改动）
