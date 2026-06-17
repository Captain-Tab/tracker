---
description: 理解需求背景并生成功能规范
---

# 功能规范: [功能名称]

## 用户输入

```text
$ARGUMENTS
```

> **`--c` 参数说明**：
> - `/k/spec` → 全新功能，无历史参考
> - `/k/spec --c` → 智能匹配（AI 语义选择 + 用户确认）
> - `/k/spec --c <关键词>` → 关键词搜索历史（找到即加载，未找到则反问）

---

## 核心目的

a. 理解需求背景（**优先级：spec 目录文档 > prompt 文字**）
b. 理解项目背景上下文
c. 理解项目实现的预期
d. 单一目的，确保没有多余的改动

---

## 执行步骤

### 0. Spec 文档自动加载（必须先执行）

> ⚠️ **强制步骤**：在执行任何分析前，必须先扫描并读取 spec 目录下的文档。

**执行操作**：

1. **扫描 spec 目录**：使用 Glob 工具扫描 spec 目录下的 markdown 文件
   
   > ⚠️ **重要**：Glob 工具默认忽略隐藏目录（以 `.` 开头），必须使用 `target_directory` 参数指定绝对路径
   
   ```
   Glob 参数（两次，覆盖平铺单文件 + 已展开 spec-set）：
   - glob_pattern: "*.md"             # 根级平铺的单文件 spec
   - glob_pattern: "*/00-overview.md" # 已展开 spec-set 的总纲（SSOT 入口）
   - target_directory: "${WORKSPACE_ROOT}/.claude/kit/spec"
   ```
   
   其中 `${WORKSPACE_ROOT}` 为当前工作区根目录的绝对路径

2. **读取 spec 文档**：
   - 根级 `*.md` → 逐个 Read。
   - 命中 `<feature>/00-overview.md` → 先 Read 总纲（SSOT）；**子件（01..0N / 横切）不全量加载**，按需在落地阶段读，避免 context 膨胀。
3. **输出扫描结果**：
   - 找到单文件 → `📄 已加载 spec 文档：[文件名列表]`
   - 找到 spec-set → `📄 已加载 spec-set 总纲：<feature>/00-overview.md（子件按阶段按需加载）`
   - 未找到文档 → `📝 spec 目录为空，将使用 prompt 输入`

**spec 目录路径**：`.claude/kit/spec/`（绝对路径示例：`/Users/xxx/project/.claude/kit/spec`）

---

### 1. Context 预加载（条件执行）

> 满足以下任一条件时执行，否则直接跳至 Step 2：
> - `$ARGUMENTS` 包含 `--c`
> - Auto 模式已开启（`.claude/kit/spec/AUTO` 文件存在）

**检查 Auto 模式**：

```bash
KIT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
bash "$KIT_ROOT/.claude/kit/auto/check.sh"
```

若输出 `AUTO_MODE=on` 且 `$ARGUMENTS` 不含关键词，自动以智能模式运行（等同于 `--c`）。

**执行脚本**：

```bash
KIT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
bash "$KIT_ROOT/.claude/kit/spec/scripts/context-preflight.sh" "$ARGUMENTS"
```

---

**根据脚本输出处理**：

#### 智能模式（脚本输出含 `[智能匹配模式]`）

1. 从 L1 索引中，根据需求描述做语义匹配，选出最相关的 1-3 个功能
2. 向用户展示候选，**等待确认**：

```
🎯 基于需求语义，匹配到以下历史 Context：

1. [feature-id] - [功能标题]
   相关原因：[一句话说明为何相关]

2. [feature-id] - [功能标题]
   相关原因：[一句话说明为何相关]

是否加载以上历史作为参考？
(Y 全部加载 / 输入序号选择 / N 跳过)
```

3. 用户确认后加载：

```bash
KIT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
source "$KIT_ROOT/.claude/kit/context/context-lib.sh"
init_context_config
context_load "<confirmed-feature-id>"
```

---

#### 关键词模式（脚本输出含 `[关键词模式]`）

- **找到结果** → 直接加载，无需确认：

```bash
KIT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
source "$KIT_ROOT/.claude/kit/context/context-lib.sh"
init_context_config
context_load "<matched-feature-id>"
```

- **未找到结果** → 脚本已输出反问模板，直接展示给用户，**停止等待回复**

---

### 2. 确定需求来源

**优先级判断**（Step 0 已完成扫描）：

```
┌─────────────────────────────────────────────────────────┐
│ 优先级 1: Step 0 已读取的 spec 文档                      │
│          (.claude/kit/spec/*.md)                        │
├─────────────────────────────────────────────────────────┤
│ 有文档 → 📄 使用 spec 文档内容作为需求来源               │
│ 无文档 → 继续检查优先级 2                                │
├─────────────────────────────────────────────────────────┤
│ 优先级 2: 使用 $ARGUMENTS (prompt 文字)                  │
│          解析用户在命令中输入的需求描述                    │
└─────────────────────────────────────────────────────────┘
```

### 3. 获取需求内容（静默）

**情况 A：spec 目录有文档**
- 使用 Step 0 已读取的文档内容
- 提取需求描述、用户故事、验收标准

**情况 B：使用 prompt 文字**
- 解析 `$ARGUMENTS` 中的需求描述

> 不输出"需求来源"行——Step 0 已展示加载状态，无需重复声明。需求来源信息在完成节里以"📄"前缀的加载行隐含传达。

### 4. 理解项目上下文

- 分析当前代码库结构和技术栈
- 识别相关模块和依赖

### 5. 查阅历史记录

- 如果 Step 1 已加载 Context 文档 → **优先使用**，提取可复用的模式和设计决策
- 如果 Step 1 未执行（无 `--c`）→ 跳过历史查阅，基于当前 spec 直接分析

### 6. 明确需求边界

- 确定本次改动的范围
- 排除不必要的修改

### 6.5 Spec Gate 检查（自动执行）

> 从已知踩坑记录中匹配当前需求相关的 gate 检查项，确保验收场景覆盖已知问题。

**执行方式**：

1. **提取需求关键词**：从 spec 文档内容 / `$ARGUMENTS` 中提取关键词
   - 如"MobX store" → `store,mobx`，"deposit 金额" → `deposit,金额`
   - 合并去重，逗号分隔

2. **执行查询脚本**：
   ```bash
   KIT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
   source "$KIT_ROOT/.claude/kit/context/context-lib.sh" && init_context_config
   bash "$KIT_ROOT/.claude/kit/context/query/query-spec-gates.sh" "<提取的关键词>"
   ```

3. **根据输出处理**：
   - 有匹配 → 检查当前验收场景是否已覆盖该问题，**未覆盖的须并入 Step 7 反问**
   - 无匹配 → 静默跳过，不输出任何内容

---

### 7. 理解输出与反问（必须）

> ⚠️ **原则：执行前消除所有模糊逻辑，不允许假设，必须确认**

#### 7.1 输出理解（强制，方案 F 双栏）

> 样式参考：`docs/cli-output/decision-output-template.md` §F 双栏 ┃

```
──── 📋 需求理解 ────

   目标 ┃ [一句话主述]
        ┃ [可选：背景 / 原因 / 约束]
        ┃
   包含 ┃ 1. [项 1] — [简述]
        ┃    参数：[字段 / 类型]
        ┃ 2. [项 2] — [简述]
        ┃    参数：[字段 / 类型]
        ┃
   排除 ┃ [明确不做的事 1]
        ┃ [明确不做的事 2]
        ┃
   预期 ┃ [验收点 1]
        ┃ [验收点 2]
```

**格式规则**：
- 4 个字段必填，缺一不可
- 字段名右对齐（3 字段名前留 1-3 空格使 ┃ 对齐）
- 每字段允许 1-N 行；多行内容沿 ┃ 列对齐
- 字段间用空 `┃` 行分隔（增强视觉节奏）
- 单行场景也合法（不强制多行）

#### 7.2 核心反问（有歧义必问，清晰可跳过）

**先判断是否需要反问**：

若 spec 文档已明确覆盖目标、边界、验收标准，且无下列模糊点 → 可跳过反问，但须显式声明：
> `✅ 需求清晰，无歧义，直接进入计划阶段。`

若存在以下任一模糊点 → 必须反问，不得假设：

| 模糊类型 | 示例 | 处理方式 |
|----------|------|----------|
| **边界不明** | "支持多种格式"具体是哪些？ | 必须确认 |
| **条件缺失** | 异常情况如何处理？ | 必须确认 |
| **隐含假设** | 我假设用户是指 X，对吗？ | 必须确认 |
| **多种理解** | 这句话可以理解为 A 或 B | 必须确认 |
| **过度复杂** | 缩到 80% 场景能否显著降成本？ | 有则主动反向建议 |

若需反问，向用户确认：

| 反问项 | 问题模板 |
|--------|----------|
| **目标确认** | "我理解目标是 X，是否正确？" |
| **边界确认** | "本次改动是否只涉及 Y，不包括 Z？" |
| **模糊点澄清** | "关于 [模糊点]，应该如何处理？" |

#### 7.3 细节反问（按需）

如果存在以下情况，追加提问：
- 多种实现方式可选
- 存在性能/兼容性权衡
- 涉及用户可感知的行为变化

#### 7.4 反问输出格式（编号 + 分组，与需求理解视觉区分）

> 样式参考：`docs/cli-output/decision-output-template.md` §反问场景专属样式

```
──── ❓ 反问澄清 ────

【必答】
  1. [核心问题 1]
     [可选：选项 A / B / C 缩进展开]
       A. [选项 A]
       B. [选项 B]
       C. [选项 C]
  2. [核心问题 2]

【可选】
  3. [细节问题，如有]

⏸ 请确认或补充后继续
```

**格式规则**：
- `【必答】` `【可选】` 强分组标题，独占一行
- 问题编号跨组连续（1./ 2./ 3.）
- 子选项 ABC 缩进 4 格
- **不用 ┃ 双栏**——与需求理解（F 双栏）视觉区分

> 反问输出后**立即停止**，不输出自审、不输出完成节、不输出路由。用户回复后才进入 Step 8 自审。

> ⛔ **HARD-GATE**：反问输出后必须停止。不得自行回答上述问题，不得基于假设继续分析，必须等待用户明确回复后才能流转至 plan 阶段。

---

### 8. Spec 自审（反问澄清后、输出完成条件前执行）

> 用户回复反问后（或无需反问时），在输出完成条件前，逐项自检：

| 检查项 | 检查内容 | 处理 |
|--------|---------|------|
| **内部一致性** | 逐段扫描已输出的 spec 内容，各段之间是否有矛盾（如 A 段说"仅 EVM"，B 段提到"Solana 场景"） | 有矛盾 → 自行修正并标注修正点，不需要再问用户 |
| **范围检查** | 本次需求是否涉及 >2 个独立模块且模块间无依赖？ | 是 → 建议拆分为独立子需求，列出拆分方案，等用户确认后分别执行 /k/spec |
| **无工具链痕迹**（仅 simple/medium 执行） | grep `/k:\|subagent\|Claude\|Cursor\|AI[^a-zA-Z]\|双闸门` 全文，是否命中？（产品向 spec 是给团队 / 产品 / 设计看的） | 命中 → 删除或改中性表述（如「subagent 验证」→「独立复核」）。**complex 档（含 spec-set 总纲/子件）是实现蓝图，跳过本检查**，工具链内容是其载荷不清理 |

**输出（方案 M 状态卡，无论通过/失败都展示，让用户看到 AI 真的做了自审）**：

```
──── 🔍 自审 ────

   内部一致性                                ✅
   范围检查                                  ✅（单模块）
   工具链痕迹                                ✅（complex 蓝图则显示「跳过」）
```

失败示例（每项 ✅ / ❌ / ⚠️ 右对齐 + 必要时下方缩进 2 格说明）：

```
──── 🔍 自审 ────

   内部一致性                          ❌ 发现矛盾
     §3.1 说"仅 EVM"，§5.2 提到"Solana 场景"
     → 已自行修正：删除 §5.2 Solana 内容
   范围检查                          ⚠️ 建议拆分
     涉及 2 个独立模块（vault-cache + staking-cache）
     → 建议拆为 2 个 spec 分别执行
   工具链痕迹                                ✅
```

- 全 ✅ → 继续进入完成节
- 任一 ❌ / ⚠️ → 展示后等待用户处理（拆分建议时**等待用户确认**才继续）

---

### 8.5 复杂度评分（机械执行，强制）

> 在输出完成条件 / 决定下一步路由前，**必须使用 Bash 工具执行评分脚本**。AI 不得凭直觉判定档位。
> 设计目的：把「下一步走 plan 还是 task」的判定从 AI 软判断改为外部锚点——避免 AI 训练偏好保守走 plan。

> ⛔ **评分前置（硬约束）**：评分脚本打的是**结构化标记**（验收场景 G/W/T、文件路径、状态机 / 红线 token）。**禁止对原始 prose 需求直接评分**——必须先把需求起草成含「验收场景(Given/When/Then) + 涉及文件路径 + 状态机/契约」的结构化 spec，再评分。否则单薄草稿会误判 `simple`，导致 8.6 形态分发永不触发、漏掉本应 spec-set 的需求。

```bash
KIT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
bash "$KIT_ROOT/.claude/kit/spec/scripts/complexity-score.sh" "$KIT_ROOT/.claude/kit/spec/"
```

**脚本输出**（标准 KEY=VALUE 行）：

```
FILES=<n>          MODULES=<n>      SCENARIOS=<n>
ABSTRACTIONS=<n>   DEPS=<n>         SCORE=<n>
REDLINE=<labels|none>
VERDICT=simple|medium|complex
```

**展示给用户**（方案 M 状态卡）：

```
──── 📐 复杂度评分 ────

   触达文件     <FILES>     (≥8 +1 / ≥15 +2)
   触达模块     <MODULES>   (≥2 +1 / ≥4 +2)
   验收场景     <SCENARIOS> (≥5 +1 / ≥10 +2)
   新增抽象     <ABSTRACTIONS> (≥1 +1 / ≥3 +2)
   依赖变更     <DEPS>      (≥1 +1)
   ────────────────────────
   总分         <SCORE>
   红线         <REDLINE>
   ────────────────────────
   档位         <VERDICT>
```

**档位定义**：
- `simple` — 0-2 分且无红线 → 直接进入 task（跳过 plan）
- `medium` — 3-5 分且无红线 → plan（轻量模式）
- `complex` — ≥ 6 分 或 触发任一红线 → plan（全工序）

> 红线（跨栈通用，任一命中直接升档 complex，不参与累加分）：
> - **R1 鉴权/资金/计费目录**：`auth|authn|authz|payment|billing|wallet|kyc|identity|session|credentials|tokens`
> - **R2 Schema/迁移**：SQL DDL（CREATE/ALTER/DROP TABLE）/ ORM 迁移（AutoMigrate / prisma migrate / alembic / knex / django migrate）
> - **R3 金额/精度计算**：JS（BigNumber / calculate / toFixed / floorToDecimal / parseUnits）/ Go（shopspring/decimal / big.Float / big.Int）/ Python（decimal.Decimal）/ Java（BigDecimal）/ SQL（DECIMAL 类型）
> - **R4 密码学/签名**：Web3（signMessage / eth_sign / EIP-712 / signTypedData / permit）/ 通用（HMAC / RSA / ed25519 / JWT sign）
> - **R5 Secret/凭据管理**：api_key / private_key / secret_key / .env / secrets / vault
> - **R6 API 契约破坏性变更**：breaking change / 删除字段 / 重命名字段 / response 结构变更
>
> 项目可在 `complexity-score.sh` 中扩展或收紧——红线规则**集中在一处脚本**，便于按项目定制（如 sodex-lens 可加 `StarRocks` 相关红线，sodex-next 可加 `useAuthState/ensureExchangeCapability` 红线）。

> ⛔ HARD-GATE：未实际调用 Bash 执行脚本即填写 VERDICT = 流程违规。

---

### 8.6 形态分发（仅 complex 档执行；simple/medium 跳过）

> 复杂度（难度轴）与文档形态（结构轴）**正交**：8.5 决定难度档，本步只在 complex 档内决定 spec 产出"一份单文件"还是"一组 spec-set"。
> 设计目的：spec-set 存在的唯一理由是支撑「阶段→check→commit→gate」串行流水线——无法切流水线的复杂单体套 spec-set 纯负担。

**`simple` / `medium`** → 不执行本步，按现有路由（simple→task / medium→plan）。

**`complex`** → 判形态。**以人工判断为主**：一眼可判的（≥3 个交付面 / 多 figma 链接 / 跨组件状态机）直接定 spec-set，不必逐条跑判据。下列三判据仅作**辅助核对**，**可被用户 override**：

| # | 判据（辅助） | 问法 |
|---|------|------|
| ① 可切分 | 能否列出"阶段依赖拓扑"（A 完才能 B / A、B 可并行）？ |
| ② 独立可验收 | 每切片能否**单独** `/k:check`+commit 通过，不必全写完才验收？ |
| ③ 共享契约 | 切片是否共享一组类型/工具/mock，需 SSOT 锚定防漂移？ |

> 三项多数命中 → spec-set，否则 → 单文件 complex spec。判据是 sanity check，不是机械门；最终以人工拍板为准。

**展示给用户（方案 M 状态卡）**：

```
──── 🧩 形态分发 ────

   ① 可切分（阶段拓扑）                        ✅
   ② 独立可验收（逐阶段 check+commit）          ✅
   ③ 共享契约（需 SSOT）                       ✅
   ────────────────────────
   形态         spec-set（或：单文件 complex）
```

**产出规则**：

- **单文件 complex spec** → 套 `spec-template.md`，**必填**「实现蓝图」段（状态机 DU / 共享契约 / 复用件清单 / 行号集成点）。
- **spec-set** → 在 `.claude/kit/spec/<feature>/` 下产出（**总纲先于子件**，这是 load-bearing 顺序）：
  - `00-overview.md`（套 `spec-overview-template.md`，**全填且稳定**：状态机 SSOT + 共享契约 + Phase0 + **子件依赖拓扑图**）。**若由 clarify 文档而来**：把 clarify 单文档**结构改写**成总纲模板（按 overview 结构重组，非 `mv`），原单文档不另留残件。
  - `01..0N-<子件>.md`（套 `spec-subspec-template.md`，**写到够开工**：结构 + figma node + 场景 + i18n key；引用总纲）。按**交付面**拆。落地阶段允许精修，但不预先 author 全部细枝末节。
  - `<横切>-i18n.md` / `-track.md` / `-api.md`（i18n / 埋点 / API 对接，与子件平级）。
  - **code-grounded 校验**（load-bearing）：产出后用独立 subagent 对照代码查「遗漏 / 丢失细节 / 模糊」。
  - 落地阶段不逐件再跑 `/k:spec`——子件由 `/k:task` / `/k:figma` 在其阶段消费 + 精修（见下方「落地衔接」）。

> 🔁 **幂等**：物化前先探 `.claude/kit/spec/<feature>/00-overview.md` 是否已存在 → 存在则**增量 refine**（更新总纲 / 补未建子件），**禁止重新展开覆盖**已有子件。

> ⚠️ 评分：已展开 feature 的复杂度评分需把 `complexity-score.sh` 调用路径指向 `.claude/kit/spec/<feature>/`（脚本默认只扫根目录 `-maxdepth 1`，扫不到子目录；脚本不改，改调用路径）。

> 📑 lint 约定：`00-overview.md` 是实现蓝图 SSOT，结构由 `spec-overview-template.md` 定义，**不受 `spec-lint` 的 REQUIRED_SECTIONS 约束**（不走 lint）；`01..0N-<子件>.md` 按 `spec-subspec-template.md`，章节**兼容 `spec-lint`**，如需可按需调用。

> 🧩 **落地衔接（逐阶段）**：按总纲拓扑跑到某子件阶段时，`/k:task`（逻辑）/ `/k:figma`（还原）读总纲 + 该子件 → 必要时精修该子件 → 实现 → `/k:check` → `/k:commit` → gate 停 → 下一阶段。全程"引用总纲、冲突以总纲为准"，总纲是唯一不变 SSOT。

---

## 完成条件（方案 F 双栏收尾）

> 仅在反问回复完成 + 自审完成 + 复杂度评分完成后输出。任一未满足 **不输出此节**。

```
──── ✅ Spec 完成 ────

     摘要 ┃ [一句话描述需求]
          ┃
   影响范围 ┃ [file1 / module1]
          ┃ [file2 / module2]
          ┃
   复杂度 ┃ <VERDICT>（<SCORE> 分 / 红线：<REDLINE>）
          ┃
     形态 ┃ [单文件 / spec-set]（仅 complex 档展示 8.6 结果）
          ┃
    下一步 ┃ → [task / plan / spec-set 阶段1 task]
          ┃ 理由：[复杂度档位 + 形态驱动 + 一句话补充]
```

> "下一步" 由 Step 8.5 的 VERDICT + Step 8.6 形态共同决定，**不再由 AI 内部直觉判定**。理由一行说明档位 + 形态 + 关键触发项。

---

## ⏸️ 流转条件

进入下一阶段前必须满足：

1. ✅ 核心反问已获得用户回复
2. ✅ 自审通过（或范围检查 ⚠️ 已被用户确认拆分方案）
3. ✅ 完成节已输出

**任一未满足** → 停止，等待用户输入，不自动流转。

---

## 🔀 下一步路由（由 Step 8.5 VERDICT 驱动）

> 路由判定**完全由 complexity-score.sh 的 VERDICT 决定**，AI 不再做内部直觉判定。
> 这样防止 AI 训练偏好「保守走 plan」导致 task 分支永远不被命中。

### 路由规则表（VERDICT 驱动，AI 自动按表执行）

| VERDICT | 形态（8.6） | 下一步 | 理由展示 | 工序 |
|---------|------------|--------|----------|------|
| `simple`  | 单文件 | **/k:task** | "简单档（<SCORE> 分，无红线）→ 跳过 plan，直接执行" | 跳过 plan，task 走精简流程 |
| `medium`  | 单文件 | **/k:plan** | "中等档（<SCORE> 分）→ 标准 plan" | plan 标准流程 |
| `complex` | 单文件 complex spec | **/k:plan** | "复杂档（<SCORE> 分 / 红线：<REDLINE>）→ 全工序" | plan 全工序（含 subagent + 5 信号扫描） |
| `complex` | **spec-set** | **/k:task（阶段1）** | "复杂档 + 可切流水线 → 总纲拓扑即 plan，逐阶段 task" | **总纲依赖拓扑替代 plan**；按拓扑逐阶段 task→check→commit→gate |

> 注：medium 与 complex 单文件都走 /k:plan，区别由 plan.md 内部根据 VERDICT 判定是否启用 subagent / 5 信号扫描。
> **spec-set 不走 /k:plan，也不走 /k:clarify**——总纲 §8 依赖拓扑图已是执行脚本；落地时 `00-overview.md` 直接进 `/k:task`（阶段1），按拓扑逐阶段：读总纲+子件 → `/k:task`（逻辑）或 `/k:figma`（还原）→ `/k:check` → `/k:commit` → gate 停 → 确认 → 下一阶段。执行中发现偏差回写对应 spec（活文档）。

### 用户挑战通道

完成条件输出后，紧接一行：

```
🔄 同意复杂度档位？回复 Y 进入 <下一步>，或输入 "升级 plan" / "降级 task" 覆盖判定
```

> 用户覆盖的判定必须**记录在 spec 末尾**（追加一行 `<!-- COMPLEXITY-OVERRIDE: simple→plan, reason: <用户输入> -->`），便于后续 audit AI 评分准确度。

### 简单档跳过 plan 的具体行为

`simple` 档用户回复 Y 时：
- AI 不调用 `.claude/commands/k/plan.md`
- AI 直接调用 `.claude/commands/k/task.md`，跳过 plan-temp.md 的所有段落留痕
- task.md 自动检测 `$PLAN_TEMP` 不存在 → 走「兼容旧流程：从对话上下文获取步骤规划」分支（task.md:68）
- 步骤数不受 plan.md Step 3 的 5 信号扫描约束——AI 直接按 spec 验收场景列 task

> ⛔ HARD-GATE：simple 档下 AI 禁止「为了保险」自行调用 /k:plan。如确实在 task 阶段发现复杂度被低估，应中止并反向回到 spec 重评分。
