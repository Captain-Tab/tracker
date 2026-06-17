# Claude Skills 深度理解报告

**日期**: 2026年1月16日  
**目的**: 理解 Claude Skills 的概念、结构和使用方法

---

## 一、什么是 Claude Skills?

### 1.1 核心定义

**Claude Skills** 是一种模块化的指令包,用于扩展 AI 编码助手(如 Claude Code、Cursor、Copilot)的能力。它们是结构化的目录,包含:

- **指令文档** (SKILL.md)
- **可执行脚本** (scripts/)
- **参考资料** (references/ 或其他支持文件)

### 1.2 Skills 的工作原理

\`\`\`
┌─────────────────────────────────────────────────────────┐
│ 1. Skill 安装后,只有 name 和 description 被加载       │
│    (最小化启动时的上下文消耗)                          │
├─────────────────────────────────────────────────────────┤
│ 2. Claude 分析用户请求,检查 description 匹配度         │
│    - description 是关键:告诉 Claude 何时调用此 Skill  │
│    - 包含触发短语如 "Deploy my app", "Check logs"     │
├─────────────────────────────────────────────────────────┤
│ 3. 当 Skill 相关时,完整的 SKILL.md 才被加载到上下文   │
│    (按需加载,优化上下文使用)                           │
├─────────────────────────────────────────────────────────┤
│ 4. Claude 根据 SKILL.md 的指令执行操作                 │
│    - 运行脚本                                          │
│    - 读取参考文档                                      │
│    - 按照工作流程处理                                  │
└─────────────────────────────────────────────────────────┘
\`\`\`

### 1.3 Skills vs 相关概念

| 特性 | Skills | Projects | MCP |
|------|--------|----------|-----|
| **性质** | 程序化模块 | 静态背景知识 | 外部数据/工具访问 |
| **加载方式** | 按需动态加载 | 预加载到对话 | 运行时调用 |
| **用途** | 教 Claude 如何做事 | 提供上下文信息 | 连接外部系统 |
| **适用场景** | 可重复的工作流 | 项目文档、代码库 | 数据库、API、文件系统 |
| **关系** | 互补 | 互补 | Skills 可以教 Claude 如何使用 MCP |

---

## 二、Skill 的标准结构

### 2.1 目录结构

\`\`\`
skills/
  {skill-name}/              # kebab-case 命名
    SKILL.md                 # 必需:Skill 定义(大写!)
    scripts/                 # 可选:可执行脚本
      {script-name}.sh       # Bash 脚本(推荐)
    references/              # 可选:支持文档
    rules/                   # 可选:规则文件(如 react-best-practices)
    metadata.json            # 可选:元数据
  {skill-name}.zip           # 必需:打包分发版本
\`\`\`

### 2.2 SKILL.md 格式示例

每个 Skill 的核心是 SKILL.md 文件,包含 YAML frontmatter 和 Markdown 内容。

**关键字段**:
- \`name\`: Skill 的唯一标识符 (kebab-case)
- \`description\`: 一句话描述,包含触发短语,告诉 Claude 何时使用此 Skill
- \`metadata\`: 可选的作者、版本等信息

### 2.3 关键设计原则

#### 上下文效率优化

| 原则 | 说明 | 示例 |
|------|------|------|
| **保持 SKILL.md < 500 行** | 详细参考资料放在单独文件 | react-best-practices 的规则文件 |
| **写具体的 description** | 帮助 Claude 准确判断何时激活 | "Deploy applications to Vercel when user says..." |
| **渐进式披露** | 引用支持文件,仅在需要时读取 | SKILL.md → rules/*.md |
| **优先使用脚本** | 脚本执行不消耗上下文(仅输出消耗) | deploy.sh 而非内联代码 |
| **文件引用一层深** | 从 SKILL.md 直接链接支持文件 | 避免多层嵌套引用 |

---

## 三、实际案例分析

### 3.1 案例 1: vercel-deploy-claimable

**目的**: 直接从对话中部署应用到 Vercel

**关键特性**:
- ✅ 无需认证
- ✅ 自动检测 40+ 框架
- ✅ 返回预览 URL + 认领 URL
- ✅ 处理静态 HTML 项目
- ✅ 排除 node_modules 和 .git

**工作流程**:
1. 打包项目为 tarball
2. 从 package.json 检测框架
3. 上传到部署服务
4. 返回预览 URL 和认领 URL

### 3.2 案例 2: react-best-practices

**目的**: React 和 Next.js 性能优化指南

**规则分类 (按优先级)**:

| 优先级 | 类别 | 影响 | 前缀 | 规则数 |
|--------|------|------|------|--------|
| 1 | 消除瀑布流 | CRITICAL | \`async-\` | 5 |
| 2 | 打包大小优化 | CRITICAL | \`bundle-\` | 5 |
| 3 | 服务端性能 | HIGH | \`server-\` | 5 |
| 4 | 客户端数据获取 | MEDIUM-HIGH | \`client-\` | 2 |
| 5 | 重渲染优化 | MEDIUM | \`rerender-\` | 7 |
| 6 | 渲染性能 | MEDIUM | \`rendering-\` | 7 |
| 7 | JavaScript 性能 | LOW-MEDIUM | \`js-\` | 12 |
| 8 | 高级模式 | LOW | \`advanced-\` | 2 |

**构建流程**:
\`\`\`bash
pnpm build          # 从 rules/ 编译生成 AGENTS.md
pnpm validate       # 验证所有规则文件
pnpm extract-tests  # 提取测试用例
\`\`\`

### 3.3 案例 3: web-design-guidelines

**目的**: 审查 UI 代码是否符合 Web 界面最佳实践

**覆盖范围**:
- ✅ 无障碍性 (aria-labels, 语义化 HTML, 键盘处理)
- ✅ 焦点状态 (可见焦点, focus-visible 模式)
- ✅ 表单 (autocomplete, 验证, 错误处理)
- ✅ 动画 (prefers-reduced-motion, 合成器友好的变换)
- ✅ 排版 (弯引号, 省略号, tabular-nums)
- ✅ 图片 (尺寸, 懒加载, alt 文本)
- ✅ 性能 (虚拟化, 布局抖动, preconnect)
- ✅ 导航与状态 (URL 反映状态, 深链接)
- ✅ 暗色模式与主题
- ✅ 触摸与交互
- ✅ 本地化与国际化

---

## 四、如何使用 Skills

### 4.1 安装方式

#### 方式 1: Claude Code (本地)
\`\`\`bash
cp -r skills/{skill-name} ~/.claude/skills/
\`\`\`

#### 方式 2: claude.ai (在线)
- 将 Skill 添加到项目知识库
- 或将 SKILL.md 内容粘贴到对话中

#### 方式 3: 使用 npx (推荐)
\`\`\`bash
npx add-skill vercel-labs/agent-skills
\`\`\`

### 4.2 触发 Skills

Skills 在安装后自动可用。Claude 会在检测到相关任务时使用它们。

**示例触发短语**:
- "Deploy my app" → 触发 vercel-deploy-claimable
- "Review this React component for performance issues" → 触发 react-best-practices
- "Check accessibility" → 触发 web-design-guidelines

### 4.3 网络访问配置

如果 Skill 需要网络访问,在 \`claude.ai/admin-settings/capabilities\` 添加所需域名。

---

## 五、创建自定义 Skill

### 5.1 命名规范

| 元素 | 格式 | 示例 |
|------|------|------|
| Skill 目录 | kebab-case | \`vercel-deploy\`, \`log-monitor\` |
| SKILL.md | 大写,固定名称 | \`SKILL.md\` |
| 脚本 | kebab-case.sh | \`deploy.sh\`, \`fetch-logs.sh\` |
| Zip 文件 | 与目录名完全匹配 | \`{skill-name}.zip\` |

### 5.2 脚本要求

\`\`\`bash
#!/bin/bash
set -e  # 快速失败

# 状态消息写入 stderr
echo "Processing..." >&2

# 机器可读输出(JSON)写入 stdout
echo '{"status": "success"}'

# 清理临时文件
trap 'rm -f /tmp/tempfile' EXIT
\`\`\`

### 5.3 最佳实践

#### ✅ 应该做的

1. **写清晰的 description** - 包含具体的触发短语
2. **保持 SKILL.md 简洁** - < 500 行
3. **使用渐进式披露** - 主要指令在 SKILL.md,详细参考在 references/
4. **优先使用脚本** - 脚本执行不消耗上下文
5. **提供清晰的示例** - 2-3 个常见使用场景

#### ❌ 应该避免的

1. **不要嵌套引用** - 文件引用只能一层深
2. **不要在 SKILL.md 中内联大量代码** - 使用脚本文件
3. **不要写模糊的 description** - 要具体明确

---

## 六、Skills 与 API 集成

### 6.1 Claude API 支持

Claude API 支持预构建和自定义 Skills:

\`\`\`typescript
// 需要启用 beta headers
headers: {
  'anthropic-beta': 'code-execution-2025-08-25,skills-2025-10-02'
}

// 使用预构建 Skill
{
  skill_id: 'pptx'  // xlsx, docx, pdf 等
}
\`\`\`

### 6.2 预构建 Skills

Anthropic 官方提供的 Skills:
- \`xlsx\` - Excel 文件处理
- \`pptx\` - PowerPoint 文件处理
- \`docx\` - Word 文件处理
- \`pdf\` - PDF 文件处理

---

## 七、Agent Skills 开放标准

### 7.1 标准化

Agent Skills 现在是一个**开放标准** (agentskills.io):
- ✅ 跨 AI 平台可移植
- ✅ 不仅限于 Claude
- ✅ 公开的 Python SDK
- ✅ GitHub 参考实现 (anthropics/skills)

### 7.2 生态系统

\`\`\`
agentskills.io
├── 标准规范
├── Python SDK
├── 参考实现
└── 社区 Skills
\`\`\`

---

## 八、安全考虑

### 8.1 风险

⚠️ **Skills 可以包含可执行代码或文件访问**

- 恶意或编写不当的 Skill 可能有害
- 审查代码和资源
- 外部依赖有风险

### 8.2 最佳实践

1. **审查 Skill 代码** - 检查所有脚本,验证外部依赖
2. **限制网络访问** - 仅允许必要的域名
3. **使用可信来源** - 官方 Anthropic Skills 或验证过的社区 Skills

---

## 九、Skills 的优势

### 9.1 对开发者的好处

| 优势 | 说明 |
|------|------|
| **加速工作流** | 不需要每次重复指令 |
| **一致性** | 确保生成的内容遵循风格指南、模板或领域规则 |
| **可重用性** | 构建一次,跨项目或组织共享 |
| **模块化** | 封装专业知识为可重用模块 |
| **标准化** | 团队/企业可以部署统一的工作流 |

### 9.2 对 AI 助手的好处

| 优势 | 说明 |
|------|------|
| **专业化能力** | 在特定领域表现更好 |
| **上下文效率** | 按需加载,不浪费上下文 |
| **可扩展性** | 轻松添加新能力 |
| **一致性** | 遵循既定的最佳实践 |

---

## 十、实际应用场景

### 10.1 企业场景
公司风格指南 Skill - 代码规范、文档模板、沟通准则、内部工作流

### 10.2 开发场景
性能优化 Skill - 识别性能问题、建议优化方案、自动重构、生成优化代码

### 10.3 部署场景
部署 Skill - 打包项目、检测框架、上传部署、返回 URL

### 10.4 审查场景
代码审查 Skill - 检查无障碍性、验证性能、审查 UX、生成报告

---

## 十一、总结

### 11.1 核心要点

1. **Skills 是什么** - 模块化的指令包,扩展 AI 助手的能力,封装可重复的工作流
2. **Skills 如何工作** - 按需动态加载,description 驱动匹配,上下文效率优化
3. **Skills 的价值** - 加速开发工作流,确保一致性,可重用和共享

### 11.2 关键设计原则

| 原则 | 说明 |
|------|------|
| **简洁性** | SKILL.md < 500 行 |
| **清晰性** | 具体的 description 和触发短语 |
| **效率性** | 渐进式披露,按需加载 |
| **可维护性** | 模块化结构,单一职责 |
| **安全性** | 审查代码,限制访问 |

### 11.3 开放标准的意义

Agent Skills 作为开放标准:
- ✅ 跨平台可移植
- ✅ 社区驱动发展
- ✅ 标准化工作流
- ✅ 生态系统增长

---

## 十二、参考资源

### 12.1 官方文档
- agentskills.io - 官方标准
- Claude Skills 文档
- Claude API Skills
- Anthropic Skills 博客

### 12.2 开源项目
- anthropics/skills - 官方参考实现
- vercel-labs/agent-skills - Vercel Skills 集合

### 12.3 相关技术
- MCP (Model Context Protocol) - 外部数据/工具访问
- React Compiler - 自动优化
- better-all - 依赖并行化

---
