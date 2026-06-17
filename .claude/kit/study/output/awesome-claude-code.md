# Study: awesome-claude-code

| 项 | 值 |
|----|-----|
| 仓库 | https://github.com/hesreallyhim/awesome-claude-code |
| 分析日期 | 2026-05-28 |
| Commit | 614f102 |
| 类型 | Curated awesome-list（社区资源目录） |
| 体量 | 23 个示例 slash-commands + 2 个 workflow guide + CLAUDE.md 样板 |

---

## 核心思想与原则

1. **它不是工具，是清单**：定位为 Claude Code 生态资源的 curated index，给用户「翻字典找轮子」。
2. **重运营、轻执行**：仓库自身的工程能力集中在「提交—验证—审批—入库」治理流水线（GitHub Issue Form + Python validation + label state machine + auto-generated README）。
3. **示例驱动**：社区贡献的 slash-commands、CLAUDE.md、workflow 直接落到 `resources/` 目录，作为可复制样例而非可执行的工具集。

## 核心流程

```
用户提交 Issue（结构化表单）
   ↓ GitHub Actions validation（URL/许可证/去重）
   ↓ label
maintainer 用 /approve | /reject | /request-changes 命令
   ↓ 脚本生成 PR → 合入 CSV → 自动重生 README
```

仓库自身的「工作流」是治理工作流，不是开发者工作流。

## 优势与劣势

### 优势
- 资源覆盖广：23 个 slash-commands 覆盖 commit / PR / hook / worktree / changelog / todo 等场景
- 治理自动化好：Issue→PR 全自动化流程对纯开源项目有参考价值
- 单一来源真相：所有命令以单 `.md` 文件呈现，易复制、易传播

### 劣势
- **单命令质量参差**：多数为「prompt + 一段 instructions」，无 Phase 编排、无 token 控制、无脚本辅助
- **无可复用框架**：没有可作为 dependency 引入的层，纯静态资源集合
- **命名/分类碎片化**：`act` `clean` `optimize` `todo` `initref` 等命令意图模糊，缺使用场景边界
- **质量两极**：`optimize.md` 仅 1 行日文 prompt，`create-hook.md` 却长达 214 行结构完整

## 与 soso-kit 对比

| 维度 | awesome-claude-code | soso-kit | 启发 |
|------|---------------------|----------|------|
| 形态 | 资源目录（清单） | 工具集（含运行时） | — |
| 命令数 | 23 个样例 | 30+ 生产命令 | — |
| Command 结构 | 单文件 prompt | Phase + shell→JSON + AI 分析 | soso-kit 完胜 |
| Token 控制 | 无 | 每 Phase 计量、渐进披露 | soso-kit 完胜 |
| Context 系统 | 仅 1 行 `context-prime` | 四层 index→router→sections→full | soso-kit 完胜 |
| 工作流深度 | 单点 | `/k:clarify`→`/k:spec`→`/k:plan`→`/k:task`→`/k:check`→`/k:commit` 全链 | soso-kit 完胜 |
| 项目治理 | 强（Issue→PR 自动化） | 无 | 不适用（soso-kit 非 awesome-list） |
| 多项目支持 | 无 | `projects/<name>/` 隔离 | soso-kit 完胜 |
| **Hook 生成能力** | **有 `/create-hook` 214 行结构化** | **无对应命令** | ⭐ 真正补短板 |
| 多角色 PR 审查 | 有 `/pr-review` 6 角色 prompt 模板 | `/k:review` 单视角 | ⭐ 可参考 |
| Commit 自动拆分 | 检测多 logical change 建议拆分 | 单 commit | ⭐ 可参考 |
| 加载 llms.txt | 有 `/load-llms-txt` 小命令 | 无 | ~ 按需 |

## 深度命令清单（23 个示例命令逐项判定）

| # | 命令 | 行数 | soso-kit 对应 | 价值 |
|---|------|------|---------------|------|
| 1 | act | 6 | 无 | ✗ TDD 提示词太薄 |
| 2 | add-to-changelog | 50 | 无 | ✗ 边缘场景 |
| 3 | clean | 1 | `/k:check` 覆盖 | ✗ |
| 4 | commit | 164 | `/k:commit` | ~ **多 commit 拆分逻辑值得借鉴** |
| 5 | context-prime | 1 | Context Library 自动 inject | ✗ |
| 6 | **create-hook** | **214** | **无** | ⭐ **真正补短板** |
| 7 | create-jtbd | 18 | `/k:spec`+`/k:clarify` | ✗ 已覆盖 |
| 8 | create-pr | 18 | `/k:pr` | ✗ |
| 9 | create-prd | 18 | `/k:spec` | ✗ |
| 10 | create-prp | 76 | `/k:spec` 更结构化 | ✗ |
| 11 | create-pull-request | 123 | `/k:pr` | ✗ |
| 12 | create-worktrees | 173 | git-worktree-new-folder skill | ~ 批量为所有 PR 建 worktree 思路可参考 |
| 13 | fix-github-issue | 13 | 无 | ~ 小工具，按需 |
| 14 | husky | 91 | `/k:check` | ✗ |
| 15 | initref | 3 | `/k:context-init` | ✗ |
| 16 | load-llms-txt | 1 | 无 | ~ 按需小命令 |
| 17 | optimize | 1 | `/k:check` | ✗ |
| 18 | **pr-review** | **75** | `/k:review` | ⭐ **多角色视角值得参考** |
| 19 | release | 3 | 无 | ~ 简单 |
| 20 | testing_plan_integration | 10 | `/k:check`+`/k:debug-on` | ✗ |
| 21 | todo | 60 | 无 | ✗ 与 TaskCreate 重复 |
| 22 | update-branch-name | 9 | 无 | ✗ 边缘 |
| 23 | update-docs | 87 | `/k:context-update` | ✗ |

---

## 借鉴建议

### 1. 对 soso-kit 帮助大吗？

**小到中**。23 个命令绝大多数已被 soso-kit 用更结构化方式覆盖且更优。但有 3 个点真正补短板：

| 真正新增的能力 | 来源命令 |
|---|---|
| **结构化 hook 生成**（探测 tooling → 决策树 → 模板 → happy/sad 测试） | `/create-hook` |
| **多角色 PR 审查视角**（PM/Dev/QA/Security/DevOps/UI 六维 prompt 框架） | `/pr-review` |
| **commit 多 logical change 自动拆分** | `/commit` |

剩余 20 个命令为冗余、过简、或低优先级。

### 2. 有必要吗？

**部分必要**：

- 三个补短板能力中，`create-hook` **必要**（hook 是 Claude Code 关键能力，soso-kit 缺失）
- `pr-review` 多角色 **非必要但推荐**（可作为 `/k:review` 的 prompt 扩展，不需新命令）
- `commit` 拆分能力 **非必要但推荐**（可作为 `/k:commit` 内嵌增强）
- 其余 **不必要**

### 3. 更新后能提升哪些？

- ✅ **新增 `/k:hook-create`**（或并入 `/k:check` 的子能力）：
  - 探测 `tsconfig.json` / `.prettierrc` / `.eslintrc` / `package.json scripts` / git 状态 → 推荐对应 hook
  - PreToolUse/PostToolUse/UserPromptSubmit 决策树
  - 标准化 JSON I/O（stdin 读、`additionalContext`/`suppressOutput`/`exit 2` 输出）
  - 自动生成测试场景（happy + sad path）
- ✅ **`/k:review` 增强**：在现有审查基础上，增加可选 `--role security|qa|devops|ui|pm` 切角度（或自动多角度并行 subagent）
- ✅ **`/k:commit` 增强**：在 diff 分析阶段检测多 logical change → 提示用户是否拆分为多个 commit
- ⚠️ **不提升**：
  - Context Library、Phase 编排、token 控制、多项目支持（soso-kit 本就领先）
  - 治理流水线（不适用，soso-kit 是工具集不是 awesome-list）

### 4. 结论

**部分做**：吸收 3 个补短板点，整体架构跳过。

落地方式：
- 新增 `kit/hook/` 模块 + `/k:hook-create` 命令（成本最高、收益最大）
- `kit/check/` 内现有 `/k:review` 增加多角色 prompt 模板（成本低、改 prompt）
- `kit/check/` 内现有 `/k:commit` 增加 diff 多组检测逻辑（成本低、改 prompt + 一段脚本）

成本评估：
- 常驻 ~0 tokens（不全量引入文档）
- `/k:hook-create` 调用时 ~3-5k tokens（探测 + 模板生成）
- `/k:review` 多角色模式 ~2k tokens/角色
- `/k:commit` 拆分检测 ~500 tokens 额外

收益：
- 补齐 hook 创建能力（当前用户需手写 settings.json + 脚本）
- PR 审查质量提升（多角度覆盖盲区）
- commit 原子性提升

**一句话**：awesome-claude-code 是社区「黄页」，对 soso-kit 整体架构无可借鉴；但 `/create-hook` 的结构化 hook 生成、`/pr-review` 的多角色框架、`/commit` 的拆分检测三点值得吸收为现有命令的增强。

### 额外 token 消耗评估

| 落地项 | 常驻 token | 调用 token | 优先级 | 状态 |
|---|---|---|---|---|
| `/k:hook-create` 新命令 | 0 | ~3-5k | P1 高 | ⏸ 待落地 |
| `/k:review --role` 扩展 | 0 | ~2k/角色 | P2 中 | ⏸ 待落地 |
| `/k:commit` 拆分检测 | 0 | ~500 | P2 中 | ✅ **已落地 2026-05-28** |
| 其余 20 个命令 | — | — | ✗ 跳过 | — |

---

## 落地实记

### ✅ /k:commit 拆分检测（2026-05-28）

**实施范围**：仅 `/k:commit`，不动 `/k:review` 与 `/k:check`（保单一职责）。

**改动文件（2 个，纯 markdown）**：

| 文件 | 改动 |
|---|---|
| `.claude/commands/k/commit.md` | +90/-1：新增 Step 2.5 拆分判定 + Step 3 双分支输出 |
| `.claude/version/commands/k.md` | bump 至 `2026-05-28`，记录 5 条 Added + 4 条设计要点 + 3 条已知限制 |

**核心机制**：

1. **候选触发**（4 条任一）：跨 ≥ 3 顶层目录无共享 / `feat+chore(deps)` 混合 / dead code + feat 共存 / `-U0` > 400 行
2. **保守阈值**（3 条）：doc/test 与 feat 配套不拆 / 多文件单主题不拆 / < 100 行不拆
3. **精细聚类**：`package.json+lock` → deps 组、纯 `*.md` → docs 组、整文件纯 `-` → cleanup 组、其余 → 源码主组 + import 共享依赖兜底
4. **双分支输出**：`split_suggested: false` 走单 commit；`split_suggested: true` 走 `Commit 1/N ... N/N` + 末尾给单 commit 备选命令
5. **`git add` 硬规则**：多 commit 时必须列具体文件路径（禁 `-A`）

**与 awesome 原版的差异**：

| 维度 | awesome `/commit` | soso-kit `/k:commit` |
|---|---|---|
| 拆分判定依据 | AI 凭语感（5 条 prompt guideline） | numstat 硬规则候选 + `-U0` 内容兜底（双层判定） |
| 误拆防御 | 无 | 保守阈值 + 共享依赖检查 + 末尾备选命令（三重） |
| 输出 schema | 自由格式 | JSON schema + 双分支 markdown 格式 |
| 触发条件可见性 | 用户看不到为什么拆 | 显式输出 `reason` 字段 |

### 🔬 首发实测发现（已写入 changelog 已知限制）

1. **欠拆中等粒度场景**：「2 个独立模块 + 各自单主题」未覆盖（4 个候选触发的最低门槛是「≥ 3 顶层目录」，本次实际改动只跨 2 模块就漏触发）
2. **`-U0` 行数不含 untracked 文件**：新增文件不出现在 `git diff`（仅 status 中），改动量评估偏小
3. **不支持 hunk 级拆分**：同文件混合多主题仍判单 commit，需用户自行 `git add -p`

### 📊 调用 token 实测

| 场景 | 实测 token |
|---|---|
| 非拆分场景（不触发候选） | 0 额外 |
| 触发 + 输出多 commit 建议（本次实测） | ~400-500 额外 |

**结论**：在预算内（≤ 500 额外 token）。

### 🔮 后续可选改进

- **降低候选阈值**：「≥ 3 顶层目录」→「≥ 2 模块无共享依赖」可覆盖本次实测的欠拆场景（待用户决定保守 vs 灵敏）
- **集成 `/k:check`**：审查完成后把语义分组传递给 `/k:commit`，进一步提升拆分精度（成本低、收益中等）

### ⏸ 其他两项待落地

| 项 | 优先级 | 备注 |
|---|---|---|
| `/k:hook-create` 新命令 | P1 高 | 真正补 soso-kit 短板，预计 ~3-5k 调用 token |
| `/k:review --role` 多角色扩展 | P2 中 | prompt 模板扩展，每个角色独立 ~2k token |

## Token 消耗统计

| 步骤 | Token |
|------|-------|
| 扫描阶段 | ~1.1k tokens |
| 分析阶段（深读 5 个命令） | ~6k tokens |
| 文档阶段（首次） | ~3.5k tokens |
| 落地阶段（commit.md + version 更新 + 实测） | ~2k tokens |
| 文档更新（本次） | ~1k tokens |
| **总计** | **~13.6k tokens** |

## 变更记录

- 2026-05-28: 首次分析（含 23 个命令逐项判定）
- 2026-05-28: 落地 `/k:commit` 拆分检测，记录首发实测发现 3 条已知限制 + 后续改进方向
