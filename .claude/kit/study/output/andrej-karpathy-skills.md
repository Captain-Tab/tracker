# Study: andrej-karpathy-skills

| 项 | 值 |
|----|-----|
| 仓库 | https://github.com/forrestchang/andrej-karpathy-skills |
| 分析日期 | 2026-04-17 |
| Commit | c9a44ae |

---

## 核心思想与原则

将 Andrej Karpathy 对 LLM 编码坏习惯的观察，浓缩为 4 条可直接注入 `CLAUDE.md` 的行为准则，目标是"让 LLM 少犯常识性错误"。

四原则：

1. **Think Before Coding** — 假设显式化、不静默挑选解释、困惑即停、必要时推回
2. **Simplicity First** — 只写解决问题的最少代码，拒绝推测性抽象/配置/错误处理
3. **Surgical Changes** — 只碰必须碰的代码；不顺手"改进"邻居；每行 diff 必须能追溯到用户请求
4. **Goal-Driven Execution** — 把任务转为可验证目标（测试驱动），让 LLM 能自循环

## 核心流程

项目本体极简：

- `CLAUDE.md`：65 行行为指南，直接 merge 到任意项目
- `skills/karpathy-guidelines/SKILL.md`：同内容包装为 Claude Code Skill
- `.claude-plugin/{plugin,marketplace}.json`：支持 plugin 一键安装

无脚本、无工作流、无上下文管理——纯"戒律文档"。

## 优势与劣势

### 优势
- 极简（核心 ≈ 65 行），落地成本趋零
- 每条原则直击 LLM 典型病症，针对性强
- 提供 plugin/skill 安装路径，分发方便

### 劣势
- 与通用 clean code 原则重叠度高（Simplicity First ≈ DRY/SRP/Early Return）
- 无流程支撑，无法处理"怎么执行"层面
- 缺乏 token 感知、Context 管理、多阶段编排等工程化能力

## 与 soso-kit 对比

| 维度 | andrej-karpathy-skills | soso-kit | 启发 |
|------|----------------------|----------|------|
| 形态 | 1 份指南 + 1 Skill | 20+ 命令、脚本 + 工作流 | 互补，非替代 |
| 抽象层级 | 行为戒律 | 流程 + Context + 规范 + 脚本 | 本项目填补"AI 专属戒律"空缺 |
| 关注点 | "别乱写" | "系统化生产" | 可把前者作为后者的行为底线 |
| Simplicity | 4 条 | clean-code.md 完整覆盖 | 已有 |
| Surgical Changes | ✓ 核心卖点 | 散落未成节 | ⭐ 值得吸收 |
| Think Before Coding | ✓ | clarify/spec 覆盖流程，戒律未明文 | ⭐ 值得吸收 |
| Goal-Driven | ✓ 强调可验证判据 | task/check 已有雏形 | 低优先补齐 |

## 借鉴建议

### 1. 对 soso-kit 帮助大吗？
**小**。soso-kit 已有 `clean-code.md` / `regular.md` / 完整工作流，覆盖了 80%+ 的内容。对方仅贡献 65 行行为戒律，其中 Simplicity First、Goal-Driven Execution 两条 soso-kit 已具备。真正新增的只有 **Surgical Changes** 与 **Think Before Coding** 两条 AI 专属戒律。

### 2. 有必要吗？
**非必要**。不做此补丁 soso-kit 亦可正常运转。定位为"低成本高回报的小优化"，非刚需。

### 3. 更新后能提升哪些？
- ✅ **减少 AI 顺手改无关代码/注释**（Surgical Changes）→ 降低 PR diff 噪声、减少返工
- ✅ **减少 AI 静默猜测、多义场景直接挑一个跑**（Think Before Coding）→ 提升 /k:clarify、/k:spec 问答深度
- ⚠️ **不提升**：流程、Context 系统、工具链——soso-kit 本来就强

### 4. 结论
**建议做，但只做补丁，不引入 plugin。**

- ❌ 不装 plugin / 不引入 Skill（与 soso-kit 体系不匹配）
- ✅ 在 `clean-code.md` 追加 ~15 行 **Surgical Changes** 节
- ✅ 在 `regular.md` 追加 ~10 行 **Think Before Coding** 节
- 成本：常驻 ~150 tokens，每次推理 ~50 tokens
- 收益：减少 AI 越权修改、提升澄清质量

**一句话**：不是升级，是打补丁。

---

### 实际借鉴落地（2026-04-17 已执行）

采用**组合方案**：通用戒律进全局 rules，场景化检查进命令。

| 借鉴内容 | 落地位置 | 触发范围 |
|---------|---------|---------|
| **Surgical Changes**（英文） | `.claude/rules/clean-code.md` 新增同名节 | 全局（所有改代码对话） |
| **提问前心态**（简化机会 + 困惑即命名） | `.claude/commands/k/clarify.md` Step 1.5 | 仅 /k:clarify 调用时 |
| **过度复杂反向建议** | `.claude/commands/k/spec.md` Step 7.2 表格新增一行 | 仅 /k:spec 调用时 |
| Simplicity First | **未借鉴**（clean-code.md 已有等价内容） | - |
| Goal-Driven Execution | **未借鉴**（/k:task /k:check 已覆盖） | - |

> **去重说明**：初版曾在 spec.md 新开 Step 9 质量闸、clarify.md 塞完整 4 项原则，复查发现与 soso-kit 既有 Step 7.2 反问表、Step 6 自检高度重合，违反 Surgical Changes 自身原则。已精简为"只保留真实增量"：spec 只加 1 行表格、clarify 只留 2 条独有。

**未借鉴的内容**：
- Plugin/Skill 安装方式（与 soso-kit 工作流体系不匹配）
- `CLAUDE.md` 整体注入（soso-kit 已有更细粒度的 rules 拆分）

**落地后影响的命令**：
- `/k:clarify` `/k:spec` — 提问/出 spec 质量提升
- `/k:task` `/k:review` `/k:debug` `/k:migration` — 通过 Surgical Changes 统一受益
- 日常改代码对话 — Surgical Changes 全局生效

详细变更记录见 `.claude/version/commands/k.md` [2026-04-17] 条目。

---

### 额外 token 消耗评估

| 项 | Token |
|----|-------|
| 规则补丁常驻（两节） | ~150 |
| 每次任务推理参与 | ~50-80 |
| **ROI** | **高**（小成本、防返工） |

## Token 消耗统计

| 步骤 | Token |
|------|-------|
| 扫描阶段 | ~1557 tokens |
| 分析阶段 | ~1200 tokens |
| 文档阶段 | ~900 tokens |
| **总计** | **~3657 tokens** |

## 变更记录

- 2026-04-17: 首次分析
- 2026-04-17: 补充四问结论（帮助/必要性/提升点/最终结论）
- 2026-04-17: 按组合方案实际落地 Surgical Changes + Think Before Coding 补丁
