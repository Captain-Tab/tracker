---
description: 执行任务清单，按步骤实现需求
---

# 任务清单: [功能名称]

## 用户输入

```text
$ARGUMENTS
```

---

## 核心目的

按需求实现代码更新，分步骤执行。

---

## 执行规范

确保代码修改符合项目规范，保持代码质量一致性。

---

## 执行步骤

### 0. 规范检查（必须）

规范清单已由 `scripts:` 自动运行（`load-rules.sh`）并注入上下文。

**按输出的文件列表，依次读取规范文件内容：**
- `regular.mdc` 必读
- 其他匹配规范按检测结果加载

---

### 1. 智能代理分析（可选）

> 添加 `--ag` 参数开启：`/k/task --ag [任务描述]`

```bash
KIT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

if echo "$ARGUMENTS" | grep -q "\-\-ag"; then
    bash "$KIT_ROOT/.claude/kit/mastery/scripts/analyze-standards.sh" "$ARGUMENTS"
    # 解析 ##SKILL_LIST，加载匹配的 SKILL.md 并执行指导
fi
```

独立规范分析：`/k/mastery`

---

### 2. 获取任务列表

**从计划文件获取步骤**（不依赖对话记忆）：

```bash
KIT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
PLAN_TEMP="$KIT_ROOT/.claude/kit/plan/plan-temp.md"
```

- 如果 `$PLAN_TEMP` 存在 → 使用 `extract-batch.sh` 读取当前批次的步骤
  - 分批任务：`bash "$KIT_ROOT/.claude/kit/plan/extract-batch.sh" "$PLAN_TEMP" <批次号>`
  - 非分批任务：`bash "$KIT_ROOT/.claude/kit/plan/extract-batch.sh" "$PLAN_TEMP"`
- 如果不存在 → 从对话上下文中获取步骤规划（兼容旧流程）

按获取到的步骤顺序执行。

### 2.5 复杂度档位读取（自动执行）

> 由 `/k:spec` Step 8.5 产出 `VERDICT=simple|medium|complex`，本步骤读取该值
> 决定后续 CHECKPOINT 节奏 / EVIDENCE 强度。
>
> ⚠️ **VERDICT 不影响 task 面板**：无论档位，task 列表**始终存在**（medium/complex 由 plan 阶段建、simple 由 Step 3.0 建）+ 每步 TaskUpdate（进度更新）**始终执行**——这是进度可视 + 防早停的核心，见 Step 3。

```bash
KIT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
SPEC_DIR="$KIT_ROOT/.claude/kit/spec"
VERDICT=$(grep -hoE 'VERDICT=(simple|medium|complex)' "$SPEC_DIR"/*.md 2>/dev/null | tail -1 | cut -d= -f2)
VERDICT="${VERDICT:-complex}"   # spec 未跑评分 / 直接进 task → 保守取 complex
echo "VERDICT=$VERDICT"
```

**档位驱动的工序密度**（仅影响验证频率与 evidence，**不影响进度面板**）：

| VERDICT | tsc 节奏 | TOOL EVIDENCE 强度 |
|---------|---------|-------------------|
| `simple`  | 仅末尾 1 次 | 红线场景必有 evidence；其他批量「用户自测」 |
| `medium`  | CHECKPOINT 末 + 中点（>5 步时） | 全场景 evidence，可批量 Bash 多场景一次跑 |
| `complex` | 当前规则（见 Step 3 验证节奏分档） | 全场景 evidence，每场景单独 |

> 红线场景（鉴权 / 资金 / 链上签 / Schema 迁移）**无论档位** evidence 必须有，由 spec.md 红线条款定义。

---

### 3. 逐步执行

> 「⚡ 并行提示」由 plan-temp.md 的阶段标题承载，task 阶段**不重复输出**对话提示。单人执行按顺序即可；多人协作时人类自行从 plan-temp.md 识别 ⚡ 标记。

**3.0 建立进度面板（条件触发，最终必须存在）**：

> ⛔ **HARD-GATE**：进入逐步执行前，task 列表**必须已存在**。这是进度可视化 + 防早停的载体，不可缺失。

| 进入路径 | task 列表状态 | 本步骤动作 |
|---------|--------------|-----------|
| 经过 `/k:plan`（medium / complex）| plan.md Step 3 已 TaskCreate（plan-temp.md 存在）| **复用现有列表，不重复创建** |
| 跳过 plan 直接从 spec 进入（simple 档）| 无列表 | **此处 TaskCreate 建全部步骤** |
| 无 plan-temp.md 且无现有列表（兼容旧流程）| 无列表 | **此处 TaskCreate 建全部步骤** |

- 来源：Step 2 从 plan-temp.md / 对话上下文获取的步骤清单
- 格式：每步 `○ N.M [步骤描述]`，CHECKPOINT 为 `📍 CHECKPOINT-N: [验收描述]`
- **判定要点**：simple 档跳过了 plan，绝不能因「步骤少」就省略 task list——这正是早停 + 无进度的根因

**3.1 执行模式（旁白静默，进度可见）**：

- **旁白静默**：不输出「🔄 状态：进行中 / 操作内容 / ✅ 完成」三段对话 prose。代码修改通过 Edit / Write 工具调用本身完成。
- **进度可见**：每完成一步**立即 TaskUpdate**（status=`completed` + subject 前缀 ○ → ✓）。这是 live 进度面板，成本低（~200 token/次）价值高，**不合批、不延迟、不省略**。

> 澄清：省 token 的真正来源是「删除 plan-temp 复选框双写」（见下），**不是**批 TaskUpdate。TaskUpdate 本身是进度面板的驱动，每步保留。

**3.2 防早停（HARD-GATE）**：

> 长 task 多轮 tool call 中，PostToolUse hook / 系统会注入各类 reminder（「改完自检」「consider TaskCreate」等）。这些**不是 stop signal**。

- ❌ 禁止把 reminder / hook 注入 / 「该收敛了」的心理信号误读为「本批结束应等用户」
- ✅ 唯一合法停止条件：
  1. **全部 task 列表项 status=completed** + 末尾 CHECKPOINT 通过 → 进入完成节
  2. **ERROR 状态**（tsc/lint 报错且无法自动修复）→ 停止求助用户
- ✅ task 列表中只要还有 `pending` 项 → **必须继续执行下一步**，不暂停、不等确认
- 与既有规则一致：CHECKPOINT「全自动，不暂停等用户」

**3.3 plan-temp.md 写入（仅决策追加，不再写复选框）**：

| 写入项 | 时机 |
|--------|------|
| 步骤复选框 `- [ ]` → `- [x]` | **不再写入**——TaskUpdate status 是单一进度源，跨 session 续接靠它 |
| CONSTRAINTS 决策追加 | 选定依赖库 / 确认接口设计 / 调整实现路径等影响后续步骤的决策时写入 |

决策追加格式：

```
- 决策[步骤号]: [选择了什么] — [原因]
```

示例：`- 决策[2.1]: 使用 dghubble/oauth1 — go.mod 已有此依赖，无需新增`

**遇到 `[CHECKPOINT-N]` 时**：

对本批次进行自检（**全自动，不暂停等用户**）。

> ⛔ **HARD-GATE：CHECKPOINT 自检必须基于真实 Bash 工具调用结果**
>
> - ❌ 禁止自由文字叙述「已通过 / 完成度 OK / 质量良好」
> - ❌ 禁止编造 tsc / test / curl 等命令输出
> - ❌ 禁止「我读了一遍代码觉得没问题」等主观自审
> - ✅ 每条 verification 命令必须实际 **Bash 工具调用**，真实 stdout 粘贴到自检报告
>
> **原理**：AI 能编造 markdown 字符串，但**没法伪造 Bash 工具的返回结果**。把"自审"外包给工具调用 = 断 AI 编造可能。
> 参考 `/k:check --fast 自作主张` 教训：缺少工具调用记录的"自审"是不可信的。

1. **逐项执行 CHECKPOINT 中列出的 verification 命令**（plan.md Step 3.5 要求 CHECKPOINT 必须含可执行命令）
   - 每条命令必须用 **Bash 工具**实际调用（不是粘贴命令字符串说"已跑"）
   - 必须粘贴**真实 stdout**（不是 AI 改写 / 摘要）
   - expected 不匹配 → 本批次 FAIL，输出诊断
2. **此处**跑项目类型检查 / lint（如 `tsc --noEmit` / `pnpm lint` / `cargo check` / `go vet` / `mypy` 等）（**批次内单步不跑**,省 60% token）—— 同样必须 Bash 工具调用 + 真实 stdout
3. **根据检查结果决定下一步**：
   - 全部通过 → 本批 step 已在每步即时置 `completed`（Step 3.1），此处**仅将 `📍` checkpoint 节点置 `completed`，进入下一批次**（不询问用户）
   - 发现明确的 bug 或不符合 spec 目标 → **直接修复**，修复后继续下一批次
   - tsc/lint 报错且 AI 无法自动修复 → **ERROR 状态**：停止执行，输出错误详情向用户求助

> **重要**：中间 checkpoint 一律不暂停等用户测试。原因：UI / 钱包 / 集成等场景在功能未完整时无法真正测试，中间暂停是无效摩擦。真正的人工测试只在末尾发生（见"确认流转"段）。

**验证节奏硬规则**（按批次大小 × VERDICT 分档；放宽频率，靠例外 2 兜底）：

| 批次类型 | simple | medium | complex |
|---------|--------|--------|---------|
| ≤ 3 步 | 末尾 1 次 | CHECKPOINT 末 1 次 | CHECKPOINT 末 1 次 |
| 4-7 步 | 末尾 1 次 | CHECKPOINT 末 1 次 | CHECKPOINT 末 1 次 |
| 8+ 步 | 末尾 1 次 | 每 5 步 + CHECKPOINT 末 | 每 5 步 + CHECKPOINT 末 |
| 无 checkpoint 的单批（plan ≤ 10 步） | 末尾 1 次 | 末尾 + 中点（仅 > 5 步时）| 末尾 + 中点（仅 > 5 步时） |

**例外（无论档位 / 批次大小，立即触发）**：
- **例外 1**：改了共享基础组件（`shared/components/ui`）→ 立即跑 `pnpm test-storybook`（红线，单独触发）
- **例外 2**：发现任何编译错 / 类型错 / 运行时异常 → 立即修，不能推迟到 CHECKPOINT。这是错误堆积的兜底闸门，**保证错误不会跨越 5 步以上**。

> 设计变化：原「中批次中点 + checkpoint 各跑一次」+「大批次每 3 步」改为「主要靠 CHECKPOINT 末 + 例外 2 兜底」。例外 2「编译错立即修」已经覆盖错误堆积的真实威胁，中点 tsc 是冗余防御。

**tsc / 编译去重硬规则（防冗余轮次，质量不减）**：

- ✅ tsc 在批次末（CHECKPOINT）跑 1 次；批次内逐步改动**不跑**（已有规则，此处重申）
- ⛔ tsc 一旦通过，**其后若无新增 Edit / Write → 禁止重复跑确认**。实测一次 task 9 次 tsc 中约 5 次是「绿后反复确认」的纯轮次浪费
- ⛔ 例外 2「编译错立即修」触发后，修完只跑 **1 次**验证；通过即停，不连环复跑同一命令
- 原则：tsc 该跑的一次不少（每批末 + 编译错立即修），但**绝不为「确认心安」重复跑已绿的检查**——这砍的是冗余轮次，不是验证强度

3. **输出批次自检报告**：
   ```
   📍 CHECKPOINT-N 自检完成
   - 完成度：[通过 / 未通过 + 说明]
   - 质量：[通过 / 发现 N 个问题 + 已修复 / 待确认]
   - 结论：[继续下一批 / 等待确认]
   ```

**参考实现重读规则**：

当步骤描述含「参照 XXX 组件」或「复用 XXX 模式」时：
1. 编码前重新 Read 参考组件（不依赖早期上下文记忆）
2. 提取关键特征清单
3. 编码完成后逐项比对

---

### 4. 执行进度追踪

进度通过 TaskCreate 任务列表实时展示，无需额外输出进度表。

**任务列表状态管理规范**：
- 列表来源（Step 3.0）：medium/complex 复用 plan 阶段已建列表；simple 由 Step 3.0 现建。条目 `status=pending` + subject 前缀 `○`——**所有档位最终都有列表**
- 每完成一步**立即** TaskUpdate：`status=completed` + subject 前缀 `○` → `✓`（同一次 TaskUpdate 完成两项）
- `📍` Checkpoint 验收点：批次进行中保持 `pending`；三项自检通过后再置 `completed`
- **不合批、不延迟**：每步进度即时反映到面板，是进度可视 + 防早停的核心（见 Step 3.1 / 3.2）

---

## 完成条件

所有步骤执行完成后：

**1. 输出工具调用证据段（强制）**：

> ⛔ **HARD-GATE：报告必须包含 `== TOOL EVIDENCE ==` 段**
>
> 让"未真实执行"无法藏匿——参考 `/k:check Step 0.6` 强制段落机制。

任务报告中必须列出本次执行的所有验收证据。**evidence 强度按 VERDICT 分档**：

| VERDICT | evidence 要求 |
|---------|--------------|
| `simple`  | **红线场景**（鉴权 / 资金 / 链上签 / Schema 迁移 / API 破坏性）必有 evidence；其他场景允许批量「⚠️ 用户自测」（一行打包）|
| `medium`  | 所有验收场景必有 evidence，但允许批量 Bash 一次跑多场景（如 `pnpm test xxx` 涵盖 5 个测试场景）|
| `complex` | 所有验收场景**每场景单独**有 evidence ≥ 1 个 |

**evidence 形式**：
- 浏览器实测 → 项目可用的浏览器自动化工具（如 `mcp__claude-in-chrome__*` / Playwright / Puppeteer）+ screenshot / gif / network log 路径
- 命令实测 → Bash 工具调用 + 真实 stdout 片段
- 测试运行 → Bash 工具调用项目测试命令（如 `pnpm test` / `npm test` / `cargo test` / `go test` / `pytest` 等）+ pass/fail

**缺失 evidence 的验收场景 = 未真实验证**，必须降级为 ⚠️ 待用户人工确认（不能默认 PASS）。

格式：

```
== TOOL EVIDENCE ==
- 验收场景 1：<场景名>（spec <file>:<line>）
  - 证据：$ <command>
    → <真实 stdout 片段>

- 验收场景 2：<场景名>
  - 证据：screenshot @ <path>（mcp__claude-in-chrome__gif_creator 输出）

- 验收场景 3：<场景名>
  - 证据：$ pnpm test xxx
    → 5/5 passed

- 验收场景 N：<场景名>
  - ⚠️ 无 evidence，降级为人工确认（原因：<例如「需 production-like 环境」>）
```

**原则**：报告里有 evidence 段不代表代码 100% 对，但**缺 evidence 段 = 流程不完整**。

---

**2. 删除计划临时文件**（如存在）：

```bash
KIT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
rm -f "$KIT_ROOT/.claude/kit/plan/plan-temp.md"
```

**3. 输出执行统计**：

```
✅ 任务执行完成

📊 执行统计：
- 完成步骤：[N]/[Total]
- 修改文件：[文件列表]
- 新增文件：[如有]
- 删除文件：[如有]
- 工具调用证据：[N 个验收场景，N 含证据 / N 人工确认]
```

---

## 🔄 确认流转（强制）

**⚠️ 强制要求：任务完成后，必须询问用户确认，禁止自动进入 check 阶段。**

### 必须执行的操作：

**1. 输出任务完成摘要**（见上方完成条件）

**2. 输出确认提示**（必须包含以下内容）：

```
🔄 是否进入 [检查阶段] 进行代码检查？

回复 Y 继续，或提出需要修改的地方
```

**3. 停止并等待用户回复**（禁止自动继续）

> 注：task 阶段如有偏离 plan 的实施 / 新发现的风险，应在「任务完成摘要」内主动披露；
> 反 agreeable 强制披露段已下沉到 `/k:plan` 阶段，task 阶段不重复。

### 用户回复后的处理：

- 用户回复 `Y` 或 `是` → 执行 `.claude/commands/k/check.md`
- 用户有其他意见 → 根据反馈继续修改代码

---

**🚫 禁止行为**：
- 禁止在输出确认提示后自动执行 check
- 禁止跳过确认步骤
