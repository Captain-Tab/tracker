---
description: 确认执行方案并拆分实现步骤
---

# 实现计划: [功能名称]

## 用户输入

```text
$ARGUMENTS
```

---

## 核心目的

确认执行方案，将需求转化为可执行的步骤。

---

## 🤝 AI 协作模式

> 💡 **借鉴 Sora 团队经验**：将 AI 视为"高级工程师"，人类专注于"指导和审查"

### 角色定位

```
┌─────────────────────────────────────────────────────────┐
│  👤 人类（你）          │  🤖 AI（我）                   │
├─────────────────────────┼───────────────────────────────┤
│  ✅ 决策者              │  ✅ 执行者                     │
│  ✅ 方案审核            │  ✅ 代码生成                   │
│  ✅ 质量把关            │  ✅ 细节实现                   │
│  ✅ 业务判断            │  ✅ 技术建议                   │
└─────────────────────────┴───────────────────────────────┘
```

### 协作原则

1. **明确指令**：给出清晰的目标和约束，AI 会输出更高质量的结果
2. **分步确认**：复杂任务拆分执行，每步确认后再继续
3. **审查优先**：重点审查 AI 输出的代码逻辑和架构决策
4. **及时纠偏**：发现偏差立即指出，避免错误累积

---

## 输出原则（全局强制）

> 借鉴 `/k:check` 设计：工序层（严格）与输出层（简洁）分离。

**所有内部步骤默认静默**：不输出过程信息到对话，过程内容（PREMISE 三问 / draft / 5 信号扫描 / 自审表 / 覆盖度对照表）一律写入 `plan-temp.md`。

**用户可见输出**仅在以下两种情形产生：
1. **任一工序失败**（PREMISE 决策需升级 / pitfall 触发 / 复用候选待确认 / 覆盖度未达标 / 信息缺口未关闭 / 自审 ⚠️）→ 暴露具体问题，等待用户处理
2. **全部工序通过** → 按最终输出模版（Step 6 后）展示

**禁止**：把任何内部表格（PREMISE 三问 / 5 信号 / B-C 自审表 / 覆盖度对照表）输出到对话，无论 PASS 还是 FAIL（FAIL 时只输出违规条目，不整表贴出）。

---

## 执行步骤

> 以下每个 Step 默认静默执行（不向对话输出），失败才暴露。最终对话输出统一在「完成条件」节定义。

### 0.pre 清理残留计划文件（自动执行）

```bash
KIT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
PLAN_TEMP="$KIT_ROOT/.claude/kit/plan/plan-temp.md"

if [ -f "$PLAN_TEMP" ]; then
  rm "$PLAN_TEMP"
  echo "🗑️ 已清理上次残留的计划文件"
else
  echo "✅ 无残留文件"
fi
```

---

### 0.0 质疑前提（必须，强制 spec 证据）

> 防止「积极论证错误方向」——4A 风险审计要求 file:line 证据，反而把 AI 推向「为
> spec 已写的方案找论据」，错过「为什么不是另一条路径」这类决策。本步骤强制 plan
> 前停下三问，关闭三类常见前提盲点。

**三问（必须逐项作答）**：

```
Q1 是否有更短路径？
   - spec 提出方案：<X 一句话描述>
   - 备选 <Y>：<证据 file:line 或「已检索无备选」>
   - 决策：<继续 X / 切换 Y / 升级回 /k:clarify>

Q2 是否已有可复用资源？
   - 复用候选：<context-lib id / 已有组件 file:line / 「已检索无候选」>
   - 决策：<复用 / 自研 / 升级回 /k:clarify>

Q3 是否被复杂化了？
   - spec 估计步骤数：<N>
   - 缩到 80% 场景的步骤数：<M>
   - 决策：<不变 / 砍范围至 80%>
```

**HARD-GATE**：
- 三问必答，每问决策行不可缺
- 答案标 `[推理]` / `[未验证]` / 「应该」/ 「可能」→ **当场用 Read / grep 关闭**，关闭成本 > 5 分钟 → 升级回 `/k:clarify`，不进 plan
- 答案完整写入 plan-temp.md 的 `<!-- PREMISE-START -->` ~ `<!-- PREMISE-END -->` 段
- 对话不输出三问表格——失败（升级 / 切换路径）才暴露具体动作

> 设计依据：本步骤补的是「质疑前提」型决策——经验上 AI 在 4A 风险审计阶段会
> 「积极论证 spec 方向」，错过 SDK 直扩 vs 临时 fetcher、依赖是否已存在、是否已有
> 等价复用资源等决策。Q1-Q3 三问触发反向自检。

---

### 0. Pitfall 门检查（自动执行）

> 从已知踩坑记录中匹配当前任务相关的 gate 检查项，在计划前预警。

**执行方式**：

1. **推断当前任务 tags**：从 `$ARGUMENTS`（任务描述）+ 当前 git 改动文件类型，提取关键词作为 tags
   - 描述推断：如"MobX store" → `mobx,store`，"转账金额" → `calculate,精度`
   - 文件推断：`.tsx` → `react`，含 `store` → `mobx`，含 `calculate` → `精度`
   - 合并去重，逗号分隔

2. **执行查询脚本**：
   ```bash
   KIT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
   source "$KIT_ROOT/.claude/kit/context/context-lib.sh" && init_context_config
   bash "$KIT_ROOT/.claude/kit/context/query/query-pitfall-gates.sh" "<推断的tags>"
   ```

3. **根据输出处理**：
   - 有匹配 → 输出门检查项，**在后续计划步骤中必须标注如何避免**
   - 无匹配 → 静默跳过，不输出任何内容

---

### 0.5 读取 spec 章节大纲（必须，信息源锚点）

> ⚠️ **强制步骤**：在拆步骤前必须执行。本步骤的输出是 Step 1-5 的**唯一信息源锚点**——禁止依赖对话上下文里 spec 阶段输出的摘要作为拆步骤依据。

**执行操作**：

1. **扫描 spec 目录并提取章节标题**：

   ```bash
   KIT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
   SPEC_DIR="$KIT_ROOT/.claude/kit/spec"

   # 用 find 兼容 bash/zsh 空目录（zsh 默认 nomatch 会报错）
   SPEC_FILES=$(find "$SPEC_DIR" -maxdepth 1 -name '*.md' -type f 2>/dev/null)
   if [ -n "$SPEC_FILES" ]; then
     echo "$SPEC_FILES" | xargs grep -n '^##\+ '
   else
     echo "__EMPTY__"
   fi
   ```

2. **根据输出处理**：

   | 输出情况 | 处理 |
   |---------|------|
   | 输出 `__EMPTY__` | spec 目录为空（用户可能用 prompt 文字提需求）→ **prompt-only fallback**：以 `$ARGUMENTS` + spec 阶段对话上下文作为信息源；**显式输出告警** `⚠️ spec 目录为空，使用 prompt+对话上下文，覆盖度对照粒度受限`；Step 5 仍须强制输出对照表（条目来自 prompt 拆解的需求点） |
   | 有章节标题（H2/H3 ≥ 3 条） | 走章节大纲驱动模式 |
   | 章节标题 < 3 条（spec 写成一坨无标题文本） | **fallback 模式**：完整读取 spec 原文，跳过章节切片，但 Step 5 仍需强制输出条目对照 |

3. **输出章节大纲**（章节驱动模式下）：

   ```
   📑 spec 章节大纲（信息源锚点）：
   - <file>:<line> §<H2 标题>
     - <file>:<line> §<H3 标题>
     - ...
   ```

4. **关键原则**：
   - Step 1-3 拆步骤时，按本大纲逐章 Read 原文（用 Read 工具的 offset/limit 定位章节区间），**不依赖对话里的摘要**
   - 一次只把一个章节读进 working memory，长 spec 自然控量
   - 跨章节步骤允许在 Step 5 对照表里出现"§A + §B → 步骤 X.Y"

---

### 0.7 复杂度档位读取（自动执行）

> 由 `/k:spec` Step 8.5 产出 `VERDICT=simple|medium|complex`，本步骤读取该值
> 决定后续工序密度。simple 档不应进入 plan（spec 已直接路由到 task），如出现 = 异常。

```bash
KIT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
SPEC_DIR="$KIT_ROOT/.claude/kit/spec"
VERDICT=$(grep -hoE 'VERDICT=(simple|medium|complex)' "$SPEC_DIR"/*.md 2>/dev/null | tail -1 | cut -d= -f2)
VERDICT="${VERDICT:-complex}"   # spec 未跑评分 / 用户直接进 plan → 保守取 complex
echo "VERDICT=$VERDICT"
```

**档位驱动的工序密度**：

| VERDICT | DRAFT + 5 信号扫描 (Step 3 Phase 1/2) | 备注 |
|---------|---------------------------------------|------|
| `medium`  | 跳过——直接列步骤，无需 draft 拆原子 + 合并理由 | 标准 plan |
| `complex` | 仅在「总步骤数 > 10」时触发 | 全工序（高复杂度才有反直觉合并价值） |
| `simple`  | 异常（应在 spec 阶段路由到 task） → 输出告警，按 medium 处理 | — |

> 注：4D 抽象粒度审仍依「新增 interface/store/hook ≥ 1」自动触发，与档位无关。

---

### 1. 确认方案

> ℹ️ **信息源约束**：以下分析必须基于 Step 0.5 输出的章节大纲 + 按章节 Read 的 spec 原文。**禁止**仅依赖对话上下文里 spec 阶段输出的「需求摘要 / 需求理解」段落。

a. 如果已经确认了方案，直接进入步骤拆分
b. 如果有多个方案，分析对比后选择最优方案

### 2. 定位代码位置

a. 根据需求描述（文字/图片）定位相关代码
b. 确认需要修改的文件和位置
c. 分析代码依赖关系

### 2.5 复用检查（自动执行）

> 复用 Step 0 提取的 tags，匹配可复用资源，避免重复造轮子。

**执行方式**：

```bash
KIT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
source "$KIT_ROOT/.claude/kit/context/context-lib.sh" && init_context_config
bash "$KIT_ROOT/.claude/kit/plan/reusable-match.sh" "$CONTEXT_PROJECT_DIR/reusable/index.md" "<Step 0 提取的 tags>"
```

**处理规则**：
- 有输出 → 在后续步骤中标注 `📏 复用提示`，确保使用推荐的函数/组件
- 无输出 → 静默跳过
- 不确定是否适用 → 列出候选，标注 `❓ 待确认`，等待用户确认

---

### 3. 拆分执行步骤（必须）

**⚠️ 强制要求：必须使用 `TaskCreate` 工具创建任务清单**

> ℹ️ **信息源约束**：拆步骤必须按 Step 0.5 章节大纲**逐章处理**——每章按需用 Read 工具读取该章节原文（offset/limit 定位），从原文中拆出对应步骤。**禁止**凭对话里残留的 spec 摘要拆步骤。

根据分析结果，按逻辑阶段分组拆分步骤，**识别阶段间依赖关系并在标题后标注**，并**立即调用 TaskCreate 工具**：

```markdown
## 步骤规划

## 第一阶段：[阶段名称]
- [ ] 1.1 [步骤描述] — `[文件路径]`
- [ ] 1.2 [步骤描述] — `[文件路径]`

## 第二阶段：[阶段名称]（与第三阶段无依赖）
- [ ] 2.1 [步骤描述] — `[文件路径]`
- [ ] 2.2 [步骤描述] — `[文件路径]`

## 第三阶段：[阶段名称]（与第二阶段无依赖）
- [ ] 3.1 [步骤描述] — `[文件路径]`

## 第四阶段：[阶段名称]（依赖第二、三阶段）
- [ ] 4.1 [步骤描述] — `[文件路径]`
```

**依赖标注规则**：
- 阶段间无依赖、修改文件不重叠 → 标注 `（与第X阶段无依赖）`
- 阶段依赖前一阶段输出 → 标注 `（依赖第X阶段）`

**粒度判定（条件触发的两阶段流程）**：

> ⛔ **触发条件**：当且仅当满足 **`VERDICT=complex` 且 总步骤数 > 10** 时，启用「阶段 1 Draft + 阶段 2 5 信号扫描」两阶段流程；其余情况（medium 档 / ≤ 10 步）**直接列出最终步骤**，跳过 draft 拆原子和 5 信号合并理由。
>
> 设计依据：5 信号扫描的价值是「凭直觉会合并但信号说独立」的反直觉收益；实测在 ≤ 10 步任务上未出现过此类反直觉收益，常规合并直觉即可。复杂 + 高步骤数任务才需要机械合并理由。

### 阶段 1：Draft（自由枚举原子工作）— 仅触发条件成立时执行

AI 不带粒度负担列出所有原子工作（一个文件 / 一个动作 = 一行）。允许过细，**此阶段不做合并/拆分决策**。Draft 写进 plan-temp.md 顶部 `<!-- DRAFT-START -->` ~ `<!-- DRAFT-END -->` 注释区，作为审计中间产物保留。

### 阶段 2：Compact（用 5 信号机械合并）— 仅触发条件成立时执行

对 draft 中相邻工作两两评估：

| 信号 | 触发条件 |
|---|---|
| **S1 独立验证** | 子工作需不同验证手段（如 tsc / unit test / 浏览器实测 / 真实数据校验 / DB 迁移检查 …）|
| **S2 独立交付** | 子工作单独完成已有价值（单独可 review / 单独可上线 / 单独可回滚） |
| **S3 跨主题** | 涉及不同 feature / 不同分层 / 不同抽象主题（如同时改 domain 类型 + container 调用 = 两个主题）|
| **S4 顺序依赖** | 步骤 B 必须等步骤 A 的产物 |
| **S5 外部 gate** | 完成需外部 actor 确认（用户审查 / 数据团队 / 安全审核）。**AI 自己不能成为 gate** |

**合并规则**：
- **零信号** → 必须合并（draft 内多个原子工作打包为 1 步）
- **任一信号触发** → 必须保持独立步

**强制执行**：每个最终步骤必须贴出信号扫描结果，例如：

```
○ 步骤 1：写 domain 8 文件（types/identity/platform/userAgent/channel/pageMapping/language/publicParams）
   合并自 draft 8 行
   信号扫描：S1❌ S2❌ S3❌ S4❌ S5❌ → 零信号 → 合并

○ 步骤 2：写 infra 4 文件（encrypt/sensorsSink/datasinkSink/gtagSink）
   合并自 draft 4 行；与步骤 1 之间 S4✅（依赖 domain）→ 独立步
   内部 4 文件之间 S1❌ S2❌ S3❌ S4❌ S5❌ → 合并

○ 步骤 N：验收场景 1（PV/Click/Stay 端到端）
   draft 1 行；S1✅（Network 实测）S2✅（独立可验证）S5✅（用户手测）→ 独立步
```

**HARD-GATE（仅触发条件成立时生效）**：
- 阶段 1 draft 必须写入 plan-temp.md 的 `<!-- DRAFT-START -->` ~ `<!-- DRAFT-END -->` 段（不能只在 AI 脑内）
- 阶段 2 每个最终步骤的 5 信号扫描结果必须写入 plan-temp.md 的 `<!-- SIGNAL-SCAN-START -->` ~ `<!-- SIGNAL-SCAN-END -->` 段
- 零信号但未合并 / 信号触发但合并掉 → 不通过
- **对话不输出 draft / 5 信号扫描内容**——全部写文件即可

> 未触发条件下（medium 档 / ≤ 10 步），DRAFT 与 SIGNAL-SCAN 两段在 plan-temp.md 中写入「SKIPPED: <原因>」单行即可，Step 7 仍能识别为合法。

**验收场景必拆**：spec 中的每个验收场景（Given/When/Then）**必须独立成 1 个 task 步**，步骤内必须含：
- 验证方法（可执行命令 / 浏览器自动化 / 明确用户手测引导）
- 证据形式（screenshot / Network log / 输出片段）

禁止把多场景塞 1 个"端到端验收"步骤。

**必须执行**：调用 `TaskCreate` 工具逐条创建任务，格式规范：

- 普通步骤：`○ 1.1 [步骤描述] — [文件路径]`
- Checkpoint：`📍 CHECKPOINT-N: [验收描述]`

**图标规范**（status + subject 前缀双维度标记）：
- 创建时 status=`pending`，subject 以 `○` 前缀开头（未完成步骤）
- 完成时 status=`completed`，subject 前缀改为 `✓`（task.md Step 3 执行）
- `📍` — Checkpoint 验收点；本批验收通过前保持 `pending`，通过后改 `completed`

### 3.5 批次编组（条件触发）

> 统计 Step 3 产出的所有步骤（含子步骤如 1.1, 1.2），当总步骤数 **> 10** 时自动触发。

**触发条件**：总步骤数 > 10

**≤ 10 步**：跳过此步，维持 Step 3 的完整步骤清单，一次性执行。

**> 10 步**：执行批次编组——

1. **按编译自洽单元分组为批次**，每批次 3-5 步。批次边界**优先对齐「编译自洽单元」，阶段边界让位**：
   - **编译自洽 = 批次结束时 tsc / 编译能通过**。先识别「接口契约改动」（改函数返回类型 / 接口字段 / 导出签名 / store 字段 / DTO 结构 / ViewModel 透出字段）= **生产者**；用 grep 找出所有引用该契约的文件 = **消费者**。
   - ⛔ **生产者与其全部消费者必须落在同一批次**——禁止「批次 N 删字段、批次 N+1 才改用到该字段的消费端」。否则批次 N 末尾 tsc 必报错 → task 阶段陷入返工（实测：一次 portfolio task 因此 ViewModel 改 5 次 / 消费组件改 7 次 / tsc 报错 3 轮 / 多出约 18 次 tool 轮次）。
   - 概念阶段（infra → container → ui）与编译自洽冲突时，**以编译自洽为准**：跨层但同属一个接口契约的改动捆进同一批次，宁可批次跨层也不留「编译报错的中间态」。
2. **每批次末尾插入 `[CHECKPOINT-N]`**，包含三项检查：

   ```markdown
   🔒 [CHECKPOINT-N] 批次 N 验收

   **验证命令（AI 必须真跑并贴出实测输出）**：
   - $ <command-1>   expects: <pattern>
   - $ <command-2>   expects: <pattern>
   - ...

   HARD-GATE：任何一条命令 expects 未匹配 → 本批次不通过，禁止进入下一批。
   禁止用"完成度/质量/结论"三句主观叙述代替可执行命令。
   ```

   示例（plan-temp.md 文件格式）：
   ```markdown
   ## 批次 1：核心逻辑层（步骤 1.1 - 1.3）
   - [ ] 1.1 创建 hook — useMaintenanceStatus.ts
   - [ ] 1.2 创建 store — maintenanceStore.ts
   - [ ] 1.3 添加 API 请求 — api/maintenance.ts
   🔒 [CHECKPOINT-1] 批次 1 验收
   - [ ] 完成度：hook、store、API 是否按 plan 实现
   - [ ] 质量：是否存在 bug、遗漏、副作用
   - [ ] 结论：是否可以验收，继续批次 2

   ## 批次 2：页面对接（步骤 2.1 - 2.4）
   - [ ] 2.1 Trade 页面接入 — pages/trade.tsx
   - [ ] 2.2 Swap 页面接入 — pages/swap.tsx
   - [ ] 2.3 Vault 页面接入 — pages/vault.tsx
   - [ ] 2.4 Stake 页面接入 — pages/stake.tsx
   🔒 [CHECKPOINT-2] 批次 2 验收
   - [ ] 完成度：所有页面是否接入 guard
   - [ ] 质量：是否存在 bug、遗漏、副作用
   - [ ] 结论：是否可以验收，继续批次 3
   ```

   对应的 TaskCreate 条目（UI 展示层）：
   ```
   ○ 1.1 创建 hook — useMaintenanceStatus.ts
   ○ 1.2 创建 store — maintenanceStore.ts
   ○ 1.3 添加 API 请求 — api/maintenance.ts
   📍 CHECKPOINT-1: 核心逻辑层验收
   ○ 2.1 Trade 页面接入 — pages/trade.tsx
   ○ 2.2 Swap 页面接入 — pages/swap.tsx
   ○ 2.3 Vault 页面接入 — pages/vault.tsx
   ○ 2.4 Stake 页面接入 — pages/stake.tsx
   📍 CHECKPOINT-2: 页面对接验收
   ```

3. **提取跨批次约束**：共享类型、接口契约、命名规范等，写在步骤清单最前面
4. **标注批次间依赖**：明确哪些批次依赖前序批次的产出

**CHECKPOINT 生成规则**：
- 完成度的检查描述根据本批次的步骤内容动态生成，概括本批的目标
- 质量和结论使用固定文案
- task 阶段遇到 `[CHECKPOINT-N]` 时暂停，逐项检查后输出结论，等待用户确认

**输出变化**：
- 完成条件中增加批次信息：`📦 批次数：[N] 批（分段执行）`
- task 阶段逐批执行，每批遇到 `[CHECKPOINT]` 暂停验收

---

### 4. 风险与计划自审（必须，审查者视角）

> 视角切换：以"接手这份计划开始编码的工程师"视角审，不是"刚写完计划的作者"视角。

**A. 技术风险点**

- 识别潜在风险点
- 准备回滚方案（如需要）
- **每条风险必须配证据**：引用 `file:line` 范围（首选）；找不到对应代码行的，标 `[推理] 依据：<推理来源>`，不接受"听起来"/"通常"/"可能"等无证据用语
  - ✅ `<风险描述>（基于 <path/to/file>:<起>-<止> 的 <代码语义>）`
  - ✅ `<风险描述>（基于 git grep <symbol> 的 N 处调用 + 已读 <path>:<起>-<止>）`
  - ✅ `[推理] <风险描述>，依据：<引用 A/B 形式的某条证据>`
  - ❌ `<风险> 听起来 <抽象后果>`
  - ❌ `<风险> 通常需要 <模糊措施>`
  - ❌ `<风险>（无任何引用）`

**B. 结构与抽象审**（合并自原 B 计划结构 + 原 D 抽象粒度；强制逐项输出结论）

| 自审项 | 触发条件 | 结论 |
|--------|---------|------|
| 步骤顺序：是否存在步骤 X 引用步骤 Y 的产物但 Y 排在 X 之后 | always | ✅ 无 / ⚠️ <具体步骤号> |
| 依赖标注：阶段间「依赖第X阶段 / 与第X阶段无依赖」是否准确无遗漏 | always | ✅ 无 / ⚠️ <具体阶段号> |
| CHECKPOINT 完整性：批次编号是否连续 | 仅 >10 步 | ✅ 无 / N/A / ⚠️ <具体> |
| **批次编译自洽**：每批次内「接口契约生产者」（删字段 / 改签名 / 改返回类型 / 改 ViewModel 透出）的全部消费者是否都在同批次 | 仅 >10 步且有接口契约改动 | ✅ 自洽 / ⚠️ <批次号> 生产者与消费者跨批，已合并 |
| **无工具链痕迹**：grep `/k:\|subagent\|Claude\|Cursor\|AI[^a-zA-Z]\|双闸门` 全文（plan 给团队评审用，不是工具记录） | always | ✅ 无 / ⚠️ <具体位置> 已删 / 改中性表述 |
| 文件/功能比 > 2：某功能涉及 ≥ 3 个新文件 | 该功能新文件 ≥ 3 | ✅ 无 / ⚠️ 列出可合并候选 |
| 新增 interface / enum / trait / protocol / 跨文件协议：必须能在 spec 中找到 ≥ 2 个**具体**使用场景 | 新增抽象 ≥ 1 | ✅ 满足 / ⚠️ <具体抽象名> 仅 1 处使用 |
| 标 [推理] 的抽象（"未来可能用到"）：必须降级为 TODO 注释，不进 plan | 任何 prospective 抽象 | ✅ 无 / ⚠️ <具体> 已降级 |

> 设计依据：原 4B 结构审 + 4D 抽象粒度审都在审「plan 结构是否合理」，分两段重复 HARD-GATE 表达；合并后单表行数不变但展示成本降低。

**C. 信息缺口必须 plan 阶段就地关闭**（强制）

任何标 `[推理]` / `[未验证]` / `[基于摘要推断]` 的内容，**plan 输出前必须执行验证命令（Read / grep / curl / tsc 等）并贴出真实结果**，把推理转为证据。

| 自审项 | 处理 |
|--------|------|
| **信息缺口归零**：plan 文档中是否还有未关闭的 `[推理]` / `[未验证]` / "信息缺口" 标注？ | ✅ 全部关闭 / ⚠️ 第 N 项需当场执行命令并贴结果 |

**强制规则**：
- 关闭成本 ≤ 5 分钟 → AI 必须当场执行（不可推迟到 task）
- 关闭成本 > 5 分钟 → 升级为反问用户（回到 /k:clarify 或 /k:spec）
- 不允许把信息缺口写成「task 阶段执行前再处理」这种推迟语句

> **原则依据**：见 `.claude/kit/principles/strict-vs-cumbersome.md` §3 决策表（信息缺口必须显式命名 + 当场关闭）。
>
> 注：absence-of-evidence / 跨阶段一致性 的核查由 `/k:check` 阶段 CHK-04c 统一处理，避免与本节重复。

<!-- 原 D 抽象粒度审查已并入 B 结构与抽象审单表（见上） -->

**处理**：B / C 任一 ⚠️ → 修正计划，同步更新 plan-temp.md / todolist，重审至全 ✅。

**段落写入要求**：A 风险点 + B 结构与抽象审 + C 信息缺口，**三张表完整写入 plan-temp.md 的 `<!-- SELF-AUDIT-START -->` ~ `<!-- SELF-AUDIT-END -->` 段**。对话不输出表格内容。

> ⛔ HARD-GATE：B + C 两组自审表未写入 SELF-AUDIT 段 / C 中存在未关闭的信息缺口 / B 中存在未确认的抽象嫌疑 → 禁止进入 Step 5。

### 5. Spec 覆盖度自检（必须，强制留痕）

> 防止 plan 遗漏 spec 中的需求。本步骤是 plan → task 流转前**最后一道闸门**。

**信息源**：直接复用 Step 0.5 已生成的章节大纲 + 拆步骤过程中按章节 Read 的原文。无新增 token 成本。

**对照范围（覆盖全文，不再切片）**：
- ✅ H2/H3 所有章节（包括用户故事、业务规则、边界条件、异常处理、验收标准、注意事项等）
- ❌ 不再仅限"验收 / Acceptance"章节

**对照表格式（强制输出）**：

```
🔍 spec 覆盖度对照表（信息源：.claude/kit/spec/*.md）

| spec 章节 | 关键需求条目 | 对应步骤 | 状态 |
|----------|-------------|---------|------|
| §<H2 标题> | <一句话需求> | 步骤 X.Y | ✅ 已覆盖 |
| §<H3 标题> | <一句话需求> | 步骤 X.Y, X.Z | ✅ 已覆盖 |
| §<H2 标题> | <一句话需求> | — | ⚠️ 未覆盖 |
| §<H2 标题> | <跨章节需求> | 步骤 X.Y（合并 §A + §B） | ✅ 已覆盖 |
```

**fallback 模式**：

| Step 0.5 状态 | 对照单位 | 表格首列 |
|--------------|---------|---------|
| 章节标题 < 3 条（无标题文本） | 段落 / 编号项 / Given-When-Then 子句 | `行号` |
| `__EMPTY__`（prompt-only） | 从 `$ARGUMENTS` + spec 阶段对话拆解的需求点 | `prompt 需求点` |

无论哪种 fallback，**对照表强制输出**，HARD-GATE 仍生效。

**段落写入要求**：覆盖度对照表**完整写入 plan-temp.md 的 `<!-- COVERAGE-START -->` ~ `<!-- COVERAGE-END -->` 段**。对话不输出表格。

**处理规则**：
- 全部覆盖 → 写入 COVERAGE 段，进入 Step 6
- 有 ⚠️ 未覆盖 → **不得流转**，立即补充步骤到计划中，更新 plan-temp.md 与 todolist，重新生成对照表直至全绿

> ⛔ **HARD-GATE**：覆盖度对照表未输出 / 存在 ⚠️ 未覆盖 → 禁止进入 Step 6，禁止执行 task.md。

<!-- 原 5.B 独立 Subagent 核对 + 5.C 双报告裁决已删除 -->
<!-- 删除理由：同模型 review 实测 4/4 PASS / 0 命中；切不断真正的偏差源（同训练 / 同 spec / 同代码） -->
<!-- 专业 review 由 /k:review 与 /k:check 承担，plan 阶段单一职责生成步骤 -->

---

## 完成条件

完成上述所有步骤后：

**1. 确认 todolist 已创建**（如未创建，立即调用 todo_write）

**2. 输出最终摘要**（统一模版，方案 A 极简清单）：

```
📋 Plan: <功能名称>

方案：<一句话方案，含 spec 章节锚点 file:line>

## 步骤清单（<N> 步 / <M> 批）

【批次 1：<批次名>】
  1.1 <步骤短描述>
  1.2 <步骤短描述>
  📍 CHECKPOINT-1

【批次 2：<批次名>】（依赖批次 1）
  2.1 <步骤短描述>
  ...
  📍 CHECKPOINT-2

【批次 3：<批次名>】（依赖批次 2）
  3.1 <步骤短描述>
  ...
  📍 CHECKPOINT-3

📁 详情（质疑前提 / draft / 5 信号 / 自审 / 覆盖度）：`.claude/kit/plan/plan-temp.md`
⚙️ 工序检查（Step 7 机械核查）：
  - 质疑前提 ✅ / pitfall ✅ / 复用 ✅
  - draft + 5 信号 ✅（或 SKIPPED）/ 自审 ✅ / 覆盖度 ✅
```

**输出规则**：

| 场景 | 处理 |
|------|------|
| ≤ 10 步 | 不分批；用"【步骤清单（N 步）】"代替"【批次】"，省略 CHECKPOINT 段；剩余结构不变 |
| > 10 步 | 分批，按上模板输出 |
| 步骤短描述 | 一句话或一短语，**不带文件路径**（路径在 plan-temp.md） |
| 工序行内容来源 | 必须来自 Step 7.2 的工序检查结果，AI **不可自评**——✅ 表示 plan-temp.md 对应段落实际存在 |
| 工序行有 ❌ | 不可输出"完成条件"段；Step 7 HARD-GATE 已强制阻断 |

> ⚠️ 注：执行顺序为 Step 0-5 → Step 6 写文件 → Step 7 机械核查 → 本节输出最终摘要 → 🔄 确认流转。本节定义的是"流程末尾的输出格式"，而非执行入口。

---

### 6. 写入计划文件（必须）

> 将计划持久化到临时文件，确保 task 阶段不依赖对话记忆。

```bash
KIT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
PLAN_TEMP="$KIT_ROOT/.claude/kit/plan/plan-temp.md"
```

使用 Write 工具将完整计划写入 `$PLAN_TEMP`，文件必须包含以下 5 段（PREMISE / DRAFT / SIGNAL-SCAN / SELF-AUDIT / COVERAGE）+ 步骤段：

新增：**PREMISE 段在最顶部**（承载 Step 0.0 三问回答）。删除：原 SUBAGENT-REPORT 段（5.B 工序已撤销）。

模板：

```markdown
# Plan: [功能名称]

<!-- PREMISE-START -->
## Step 0.0 质疑前提
Q1 是否有更短路径？
   - spec 方案：[X]
   - 备选：[Y / 已检索无备选]
   - 决策：[继续 X / 切换 Y / 升级回 /k:clarify]
Q2 是否已有可复用资源？
   - 候选：[context-lib id / file:line / 已检索无候选]
   - 决策：[复用 / 自研 / 升级回 /k:clarify]
Q3 是否被复杂化了？
   - spec 估计步骤数：[N]
   - 缩到 80% 场景的步骤数：[M]
   - 决策：[不变 / 砍范围至 80%]
<!-- PREMISE-END -->

<!-- DRAFT-START -->
## Draft（Step 3 阶段 1 原子工作清单）
[未触发条件 → 填: SKIPPED: VERDICT=medium 或 步骤数 ≤ 10]
[触发条件 → 列出全部原子工作]
- [原子工作 1]
- [原子工作 2]
<!-- DRAFT-END -->

<!-- SIGNAL-SCAN-START -->
## Compact 5 信号扫描（Step 3 阶段 2）
○ 步骤 1：[描述]
   合并自 draft N 行；信号扫描：S1❌ S2❌ S3❌ S4❌ S5❌ → 零信号 → 合并
○ 步骤 2：[描述]
   合并自 draft N 行；信号扫描：S1✅（...）→ 独立步
...
<!-- SIGNAL-SCAN-END -->

<!-- SELF-AUDIT-START -->
## Step 4 自审（A 风险 / B 结构与抽象 / C 信息缺口）
### A. 技术风险点
- [风险 1]（基于 file:line）
### B. 结构与抽象审（合并自原 B 结构 + 原 D 抽象粒度）
| 自审项 | 触发条件 | 结论 |
| ... | ... | ... |
### C. 信息缺口
| 自审项 | 处理 |
| ... | ... |
<!-- SELF-AUDIT-END -->

<!-- COVERAGE-START -->
## Step 5 Spec 覆盖度对照表
| spec 章节 | 关键需求条目 | 对应步骤 | 状态 |
| ... | ... | ... | ✅ |
<!-- COVERAGE-END -->

<!-- CONSTRAINTS-START -->
## 跨批次约束
[共享类型、接口契约、命名规范等（无则填 "无"）]
<!-- CONSTRAINTS-END -->

<!-- BATCH-1-START -->
## 批次 1：[名称]（步骤 X.X - X.X）
- [ ] 1.1 [步骤描述] — `[文件路径]`
- [ ] 1.2 [步骤描述] — `[文件路径]`
🔒 [CHECKPOINT-1] 批次 1 验收
- [ ] 完成度：[本批目标概括]
- [ ] 质量：是否存在 bug、遗漏、副作用
- [ ] 结论：是否可以验收，继续下一批
<!-- BATCH-1-END -->

<!-- BATCH-2-START -->
## 批次 2：...
<!-- BATCH-2-END -->
```

**5 段必填**（PREMISE / DRAFT / SIGNAL-SCAN / SELF-AUDIT / COVERAGE）：
- `PREMISE` ← Step 0.0 三问回答（始终写实质内容）
- `DRAFT` + `SIGNAL-SCAN` ← Step 3 触发条件成立时写实质内容；否则写单行 `SKIPPED: <原因>`（Step 7 仍能识别为合法）
- `SELF-AUDIT` ← Step 4 三表（A 风险 / B 结构与抽象 / C 信息缺口）
- `COVERAGE` ← Step 5 覆盖度对照表

> 原 SUBAGENT-REPORT 段已删除（5.B 工序撤销）。

**≤ 10 步时**：整个计划作为单个批次写入（BATCH-1），无 CHECKPOINT。

**修改同步规则**：用户在确认流转中提出修改意见时，必须同时更新 `$PLAN_TEMP` 文件，保持文件与实际计划一致。

---

### 7. 执行严格度自检（HARD-GATE，机械验证）

> 用 Bash 命令外部核查 plan-temp.md 段落标记完整性。不依赖 AI 自评。
> 检测结果会在最终摘要的 ⚙️ 工序行中暴露，作为用户判断执行严格度的依据。

> ⚠️ **强制要求**：AI 必须**使用 Bash 工具实际执行** 7.1 的脚本，**不可凭印象填写 7.2 结果**。Bash 工具调用记录是 ground truth；未调用 Bash 即填写 ⚙️ 工序行 = 流程违规。

**7.1 段落标记核查**

```bash
KIT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
PLAN_TEMP="$KIT_ROOT/.claude/kit/plan/plan-temp.md"

declare -A SECTIONS=(
  [PREMISE]="Step 0.0 质疑前提"
  [DRAFT]="Step 3 阶段 1（条件触发，未触发时段内填 SKIPPED）"
  [SIGNAL-SCAN]="Step 3 阶段 2（条件触发，未触发时段内填 SKIPPED）"
  [SELF-AUDIT]="Step 4"
  [COVERAGE]="Step 5"
)

MISSING=()
for SECTION in "${!SECTIONS[@]}"; do
  if ! grep -q "^<!-- ${SECTION}-START -->$" "$PLAN_TEMP" || ! grep -q "^<!-- ${SECTION}-END -->$" "$PLAN_TEMP"; then
    MISSING+=("$SECTION（${SECTIONS[$SECTION]}）")
  fi
done

if [ ${#MISSING[@]} -gt 0 ]; then
  echo "❌ plan-temp.md 缺以下段落："
  printf '  - %s\n' "${MISSING[@]}"
  exit 1
else
  echo "✅ 5 段落标记齐全（PREMISE / DRAFT / SIGNAL-SCAN / SELF-AUDIT / COVERAGE）"
fi
```

**7.2 工序检查结果汇总**（用于最终摘要 ⚙️ 行）

将 7.1 的执行结果整理为：

| 工序 | 对应段落 | 状态 |
|------|---------|------|
| 质疑前提 | PREMISE | ✅ / ❌ |
| pitfall | （仅工具调用，无段落） | ✅（Step 0 已执行）/ — |
| 复用 | （仅工具调用，无段落） | ✅（Step 2.5 已执行）/ — |
| draft + 5 信号 | DRAFT + SIGNAL-SCAN | ✅ / ❌（SKIPPED 算 ✅）|
| 自审 | SELF-AUDIT | ✅ / ❌ |
| 覆盖度 | COVERAGE | ✅ / ❌ |

> ⛔ **HARD-GATE**：7.1 任一段落缺失 → 禁止进入「完成条件」段，回到对应 Step 补写。

---

## 🔄 确认流转

**Step 6 完成后，在「最终摘要」末尾追加「未关闭项」一行**（反 agreeable bias 工序）：

| 情况 | 输出 |
|------|------|
| 无 [推理] 决策、无信息缺口 | `⚠️ 未关闭项：无` |
| 有 1-N 项 | `⚠️ 未关闭项：<N> 项` 然后另起一行逐条列出（一行一条，含一句话依据） |

> 用户「同意」不会自动消除这些点；如需绕过，请明示。
> **原则依据**：见 `.claude/kit/principles/strict-vs-cumbersome.md` §3 决策表「用户同意 ≠ 免除披露责任」

紧接一行确认提示：

```
🔄 确认进入执行阶段？回复 Y 继续，或提修改意见
```

> ⛔ **HARD-GATE**：用户明确输入 Y 之前，禁止调用 task.md，禁止任何代码修改。
> ⛔ **HARD-GATE**：未输出「未关闭项」一行（即使为「无」）→ 禁止输出确认提示。

等待用户回复：
- `Y` / `是` → 自动执行 `.claude/commands/k/task.md`
- 其他意见 → 根据反馈调整方案，同步更新 plan-temp.md