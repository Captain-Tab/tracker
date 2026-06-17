---
module: context
type: kit
version: 2.12.0
released: 2026-05-31
versioning: semver
status: active
source: .claude/kit/context/
---

# Context 系统变更日志

> 版本约定：SemVer，第一个 `## v<x.y.z>` 即当前版本。

## v2.12.0 - 2026-05-31

### 🚀 history 结构化演进索引 + 差量更新双闸（借鉴 OpenSpec spec delta 原则）

#### 背景

`/k:study OpenSpec` 调研对照后发现：OpenSpec 的 spec delta 体系（声明式 ADDED/MODIFIED/REMOVED + 机器合并 + 写入前重建校验）有三条原则可嫁接到 Context 差量更新，但其强格式机制不适用于人读文档，故只借原则不搬机制。

#### 变更

| 文件 | 说明 |
|------|------|
| `action/update/scripts/append-history.sh` | history 条目新增 `sections`（section 级操作 `{title, op}`）+ `symbols`（outline 符号 diff）字段，可选参数 `--sections-file`/`--symbols-file`，缺省为空结构保持向后兼容 |
| `commands/k/context-update.md` | Step 6c 接入结构化字段（复用 Step 3 `AFFECTED_SECTIONS` + Step 2.5 outline diff）；Step 4b 加完整块纪律 + 行数兜底自检（防改写丢内容）；新增 Step 4d 写入前骨架校验（结构漂移拒绝定稿）；执行契约同步 |

#### 设计决策

- **P3 结构化 history（ROI 最高）**：history 从「代码文件流水账」升级为可机器溯源的 section/符号级演进索引——支持「某 section 被哪几次变更动过」「某符号哪次引入」查询；数据复用既有产物，几乎零增量成本
- **P1 完整块防丢**：借 delta 的 MODIFIED 完整块纪律，要求被改章节逐字保留无关内容 + 行数 <70% 兜底回查
- **P2 写入前骨架闸**：借 delta 的写入前重建校验，Step 4d 用 grep 标题集对比检出结构漂移，零 token
- **只借原则不搬机制**：不引入 delta 强格式（人读文档不适用，会 silent fail）；向后兼容（旧调用/旧条目不受影响，record 首次路径暂不带结构化字段）

## v2.11.0 - 2026-05-21

### 🚀 反向索引一致性硬化 + rebuild 兜底

#### 背景

`/k:study agentmemory` 调研对照后发现：soso-kit 的 `indexes/files.json` / `indexes/tags.json` 是 router 的派生数据，但 write 路径未做"两个真相源一致"保证——存在三类隐性失真：

1. **remove 时毁掉 router**：`remove-feature.sh:76` 把 `.features` 当数组写（实际是 object），删除一条会清空整个 router 文件
2. **update 时旧引用变僵尸**：`update-indexes.sh` 改 tags/files 只追加不清理，旧 file→feature / tag→feature 映射继续指向已不再使用该文件/标签的 feature
3. **失真无兜底**：手工编辑 / merge 冲突 / bug 写坏时，没有从 router 重新派生的恢复路径

#### 核心改动

**`action/remove/scripts/remove-feature.sh`**

- 修复 router 删除：`.features = [.features[] | select(...)]` → `del(.features[$id])`（features 是 object 不是 array）
- 同步清理 `.history[$id]`（router 内 history 同名 key）
- 同步清理 `context-index.json` 的 `recentQueue` / `modules[].features` / `meta.totalFeatures` 三字段（之前只清 recentQueue）

**`shared/update-indexes.sh`**

- 加无条件 prune 段：在 files / tags 写入之前，先从两个反向索引中清掉**所有**指向当前 feature 的旧引用 + 删空 entry
- 防场景：用户改 keyFiles 后 `src/old.ts` 仍指着这个 feature；改 tags 后 `tag-old` 仍指着这个 feature

**`shared/rebuild-indexes.sh` 新增**

- 从 `router/*.json` 扫描所有 feature 的 `quickRef.keyFiles` / `tags` / `quickRef.relatedConcepts`
- 完全重建 `indexes/files.json` 和 `indexes/tags.json`，覆盖原文件
- 支持 `--dry-run` 预览（输出 old → new 数量差，临时文件留作 review）
- 通过 `jq empty` 校验跳过非法 JSON router
- 实测 sodex-web 36 features：发现 tags.json 实际比 router 真相源少 37 个 tag → 漂移真实存在

**`action/record/scripts/search-similar.sh`**

- 加 Level 3a `JACCARD`：两段 summary 的词集合交并比 ≥ 70% 判定为实质相同
- 解决"标题不同但 summary 实质相同"的命名漂移（中英差异 / 改名）
- 位于现有 Level 3b（30% 关键词重叠率）之前——更严格的语义指标优先
- 顺手修原有 `sed 's/[^a-z0-9一-龥]/ /g'` 在 macOS BSD 不支持的 unicode escape bug → 改为 `[一-龥]` 直接字符范围

**`context-lib.sh` + `commands/k/context.md`**

- 新增 `context_rebuild_indexes` 函数（支持 `--dry-run` / `-n`）
- `/k:context rebuild-indexes` / `/k:context rebuild` 子命令路由
- help 文本新增「维护命令」段

#### 验证

- fixture 测试：rebuild 从空开始正确产出；remove jq 修复前后对比验证 features 不再被毁；update prune 验证 `src/a.ts` 和 `tag-a` 在改 keyFiles 后正确消失；Jaccard 在 summary 实质相同时命中
- 在 sodex-web 真实数据上 `rebuild --dry-run` 跑通，揭示 tags.json 既有漂移 37 项

#### 破坏性

- 无。所有改动为 bug 修复 + 新增能力，不影响既有 router / context-index schema。

#### 灵感来源

- `/k:study agentmemory` —— 借鉴"反向索引应为写入流程的副产物"原则与 jaccardSimilarity 阈值 0.7

---

## v2.10.0 - 2026-04-30

### 🚀 router schema 扩展 — 影响面字段（自动化基建第 1 步）

#### 背景

roadmap §二「修改影响面」要求 context 文档承载横向关联信息。当前 quickRef 只能定位「这个功能在哪」，无法回答「改这个会影响哪些地方」。配合后续 Stop Hook / clarify 强制查询，构成 MVA（最小可用自动化）三件套的第 1 步。

#### 核心改动

**router schema — quickRef 新增 4 字段 + 顶层 1 字段（全部可选）**

- `quickRef.callers: string[]` — 调用方清单（格式 `path:line - description`，竖线分隔传入）
- `quickRef.sideEffects: { emits, invalidates, writes }` — 副作用三元组（事件/缓存/外部写入）
- `quickRef.relatedFeatures: string[]` — 关联 feature id（横向引用）
- `quickRef.pitfalls: string[]` — 关联 pitfall id（反向引用 pitfall 库）
- 顶层 `lastVerified: YYYY-MM-DD` — 最近一次内容验证日期，用于过期检测

**`record/scripts/analyze-document.sh` — 模板加 4 字段空占位**

- quickRef 模板末尾追加 `callers / sideEffects / relatedFeatures / pitfalls` 空结构
- 不强制 AI 推断（callers 需扫调用方，sideEffects 需扫 emit/invalidate，模板提供占位由后续 record 流程交互式确认）

**`record/scripts/update-router.sh` — 新建 feature 写入 lastVerified**

- 与 `created / updated` 同级，初始值 = 今日

**`record/scripts/validate-structure.sh` — 类型守卫不强制必填**

- 4 个新字段做 type 检查（存在则验证类型，不存在不报错）
- 兼容 36 个旧 feature「不强制回填」原则

**`update/scripts/update-router-fields.sh` — 新增 5 个 CLI 参数**

- `--callers <竖线分隔>` / `--related-features <逗号分隔>` / `--pitfalls <逗号分隔>`
- `--side-effects-file <json-path>` — 通过文件传 object 避免 shell 转义
- `--last-verified <YYYY-MM-DD>`
- 增量更新原则：只更新传入字段，未传字段保持原值

#### 验证

- 4 个修改脚本 `bash -n` 语法检查通过
- sodex-web 11 个 router 文件 / 36 个 feature 全部 validate 通过（兼容性 OK）
- 端到端测试：写入 → validate → 增量更新 → 类型守卫报警，全链路工作正常

#### 破坏性

- 无。所有新字段可选，旧 feature 无需迁移。

#### 已知遗留（非本版本引入）

- `analyze-document.sh` 输出的 JSON 数组有尾随逗号 bug（pre-existing），`coreLogic / keyComponents / keyFiles / tags` 均受影响；下游 `update-router.sh` 已能消化，可作为独立任务后续处理。

---

## v2.9.0 - 2026-04-14

### 🚀 新增 context init 命令 — 多项目支持

#### 背景

context library 目录结构已支持多项目（library/sodex-web, library/sodex-next），但缺少标准化的初始化流程。新增项目需手动创建骨架目录、模板文件和映射配置，易遗漏。

#### 核心改动

**`context-lib.sh` — case → regex 映射表**

- 原 `case` glob 匹配（`sodex-web*`）替换为 `PROJECT_MAPPINGS` 数组 + `resolve_project_name()` 函数
- regex `^project(-.+)?$` 精准匹配 worktree 变体，拒绝前缀误匹配（如 `sodex-webinar` 不再匹配 `sodex-web`）
- 预留 `MAPPINGS_INSERT_ANCHOR` 锚点，init 脚本自动追加新映射

**`action/init/init-project.sh` — 骨架初始化脚本**

- 项目名检测：路径参数 basename > git repo name > 报错提示
- `--dry-run` 预览模式：展示将创建的目录、文件、映射行
- 完整创建：7 目录 + context-index.json（v2.5）+ CONTEXT-UNEXPLOITED.md + indexes 空骨架
- 补全模式：目录已存在时逐项补缺，已有文件不动
- 映射追加：sed 在锚点前插入，幂等检查

**`commands/k/context.md` — init 路由**

- 函数映射表新增 `init` → Step 2.5 专用流程
- 两步交互：--dry-run 预览 → 用户确认 → 正式执行

#### 新增文件

| 文件 | 说明 |
|------|------|
| `.claude/kit/context/action/init/init-project.sh` | init 核心脚本 |

---

## v2.8.5 - 2026-03-27

### ✂️ 写入命令 token 优化：learn / record / audit

#### 背景

对三个写入命令（context-learn、context-record、context-audit）进行 token 流程分析，与 claude-mem 压缩模式对比，识别可无损压缩的环节。第一原则：精确读取代码与生成逻辑优先，token 节省在此基础上进行。

#### 核心改动

**`commands/k/context-learn.md` — Step 8 内嵌 + 输出约束 + token 计量**

- **Step 8 内嵌 Step 4**：质量自检四维度（架构/可定位/逻辑/完整性）从独立 Read+审查步骤改为 Step 4 写作时的内嵌约束。文档刚写完仍在上下文，独立 Read 工具调用冗余。
- **Step 2 输出约束**：新增 `> 输出约束`：AI 直接输出 JSON 结构，不在 JSON 前重复解释分析过程。推理内部完成，只输出结论。
- **Step 1b token 计量**：新增 `ACTUAL_READ_TOKENS` 记录，按文件列出读取估算，供 Step 9 成本报告使用（原 Step 9 用 `FILE_TOKENS_TOTAL` 是 outline 估算，现改为实际读取量）。
- **执行契约**：移除 Step 8 独立条目，Step 4 更新为"含内嵌质量自检"。

**`commands/k/context-record.md` — Step 5 sections.summary 生成 + 成本标签修正**

- **Step 5 新增 `CORRECTED_SECTIONS`**：analyze-document.sh 输出的 sections.summary 固定为 `"TODO: 生成摘要"`。新增指令：AI 基于 section title + OUTLINE_MAP（已在上下文）填写实际 summary（≤30字），得到 `CORRECTED_SECTIONS`，Step 6 用其替代 `$SECTIONS`。无额外 Read 工具调用。
- **Token 成本标签修正**：将 `keyFiles 读取节省` 改为 `keyFiles 参考体积`，说明改为"AI 未读取源码"。原标签"通过 outline 跳过全文读取"误导性强——record 中 AI 从未计划读取 keyFiles。同时修正措辞矛盾"三项后两项合计"→"后两项合计"。

**`commands/k/context-audit.md` — WORKFLOW.md 内联**

- 原设计：context-audit.md 通过 Read 工具加载 WORKFLOW.md（125行）再执行。WORKFLOW.md 仅被 context-audit.md 唯一引用（CHANGELOG 引用为历史记录，非功能性）。
- 新设计：WORKFLOW.md 全部内容直接内联进 context-audit.md，消除一次 Read 工具调用。逻辑 100% 等价，WORKFLOW.md 文件保留（历史引用安全）。

#### 评估过程中否定的优化项

- **context-learn Step 1b 选择性读取（types.ts outline-only）**：否定。types.ts 是信息密度最高的文件（联合类型、interface 字段定义状态机结构），outline 丢失所有实现细节，违反第一原则。
- **context-record 全局 token 架构优化**：无需。record 已是 shell-first 设计，AI 仅参与 coreLogic 精选和最终报告，~330-600t，属最优。

#### Token 节省效果

| 命令 | 优化项 | 节省量 |
|-----|-------|-------|
| context-learn | Step 8 内嵌（消除 Read 调用）+ Step 2 输出约束 | ~450-800t/次 |
| context-record | sections.summary 从 TODO→实际值 | +100t 成本，换取 record 后立即可用 |
| context-audit | WORKFLOW.md 内联（消除 Read 调用） | 检测阶段 ~300t（节省 57%） |

#### 改动文件

- `commands/k/context-learn.md` — Step 1b 计量、Step 2 约束、Step 4 内嵌自检、Step 8 折叠、Step 9 更新
- `commands/k/context-record.md` — Step 5 CORRECTED_SECTIONS、Step 9 token 标签修正
- `commands/k/context-audit.md` — WORKFLOW.md 内联，文件从 43 行扩展至 119 行

---

## v2.8.4 - 2026-03-27

### 🔍 Search 增强 + Load 分层 + Update token 优化

#### 背景

context 命令在三个环节存在 token 浪费：search 搜索域窄且结果冗余、load 缺少章节级精准读取、context-update Step 5b 对全部章节重写 summary。

#### 核心改动

**`context-lib.sh` — `context_search` 重写**

- **扩展搜索域**：新增 `sections[].summary`、`quickRef.keyComponents[]` 两个字段参与匹配（原仅搜索 id/title/summary/tags/coreLogic）
  - 效果：搜索 `"toClob"`、`"Enable Trading"` 等只在章节摘要里的词，原来找不到，现在命中
- **命中数排序**：用临时文件收集结果，`sort -rn` 按命中次数降序排列，最相关结果排第一
- **修复 `found` 变量 bug**：原来 `found=1` 在子 shell 中无法传回，"未找到"判断始终错误，改用临时文件后修复
- **输出压缩**：移除每条结果的 `coreLogic`（长函数签名），格式从 7-8 行压缩至 3 行
  - token 节省：每条结果 ~130 tokens → ~45 tokens（**节省 65%**）

**`context-lib.sh` — `context_load` 新增 `--section <n>` 模式**

- 用法：`/k/context load <id> --section 3` — 只提取第 3 章节内容
- 利用 router.json 中已有的 `sections[].lineRange`，`sed -n '{start},{end}p'` 精准提取
- 早期退出：section 模式在获取 feature 后立即处理，完全跳过 L2 摘要输出
- 无效编号时列出所有可用章节及 token 估算

```
📄 vault-deposit  [§2/12: 架构概览]  ~400 tokens
（章节内容）
💡 其他章节: /k/context load vault-deposit --section <n> | 完整文档: --full
```

**`commands/k/context-update.md` — Step 5a summary 差量生成**

- 原行为：validate-sections.sh --fix 输出全 TODO → AI 为所有章节重写 summary
- 新行为：按章节类型分别处理

| 章节类型 | summary 来源 | 处理规则 |
|---------|------------|---------|
| 在 `AFFECTED_SECTIONS` 中 | Step 4b 已读取的当前内容 | 重新生成 |
| 不在 `AFFECTED_SECTIONS` 中 | `SECTIONS_LIST` 中的旧 summary | 核对旧 summary 不含变更符号 → 复用；否则重新生成 |

复用条件：旧 summary 不包含 `OUTLINE_ADDED/REMOVED/MODIFIED` 中任何变更的函数名或概念词。安全网保留（AI 主动核对，非盲目复用）。

#### 验收结果

| 场景 | 测试 | 结果 |
|------|------|------|
| 扩展搜索域 | `context search "toClob"` | ✅ 命中 vault-deposit（sections.summary 匹配） |
| 命中数排序 | `context search "状态机"` | ✅ vault-deposit 多命中排第一 |
| 空结果处理 | `context search "xxxxnotexist"` | ✅ "未找到"正确输出 |
| --section 正常 | `context load vault-deposit --section 2` | ✅ 仅输出架构概览章节，~400 tokens |
| --section 无效编号 | `context load vault-deposit --section 99` | ✅ 列出全部章节清单，正确报错 |
| 原有 load 不受影响 | `context load vault-deposit` | ✅ L2 摘要正常输出 |
| bash 语法 | `bash -n context-lib.sh` | ✅ 无语法错误 |

#### Token 节省效果

| 操作 | 改前 | 改后 |
|------|------|------|
| search 每条结果 | ~130 tokens | ~45 tokens（**节省 65%**） |
| load 读单章节 vs 全文 | 3000-6500 tokens | 300-700 tokens（**节省 85-94%**） |
| context-update Step 5b（12章2章受影响） | ~360 tokens | ~60-80 tokens（**节省 ~80%**） |

#### 改动文件

- `kit/context/context-lib.sh` — `context_search` 重写，`context_load` 新增 `--section` 模式
- `commands/k/context-update.md` — Step 5a summary 差量生成规则

---

## v2.8.3 - 2026-03-26

### 🔬 AST 增强：class 成员可见 + unfold 精准取函数

#### 背景

v2.8.2 的 `outline` 只显示顶层符号（`◆ ClassName L1-380`），看不到 class 内部方法；要查看函数实现必须全量 Read 整个文件，浪费大量 token。

#### 核心改动

**`tools/outline.js` — class 成员深度遍历**

- 使用 TS Compiler API 遍历 class 成员（方法/属性/getter/setter/constructor）
- 每个成员显示 private/static 修饰符、参数类型、返回类型、精确行号
- 显示 member 数量摘要：`◆ ClassName (9 members)`
- 降级方案（regex）行为不变，仅 TS Compiler API 路径新增成员遍历

输出示例（改后）：
```
◆ FigmaService [exported]  L24-289  (14 members)
   ○ (private) apiKey: string  L25
   ƒ constructor({ figmaApiKey, figmaOAuthToken }: FigmaAuthOptions)  L30-34
   ƒ (private) getAuthHeaders(): Record<string, string>  L36-44
   ƒ async downloadImages(...): Promise<ImageProcessingResult[]>  L140-256
   ⊙ get isLoading: boolean  L48-50
   ⊙ set currentAmount(val: string)  L52-54
```

**`tools/unfold.js` — 新工具：按符号名精准提取函数实现**

- 输入：文件路径 + 符号名（支持 `FuncName` / `ClassName` / `ClassName.method` / `ClassName.constructor`）
- 输出：该符号完整源代码 + 精确行号 + token 节省估算
- 优先使用 TS Compiler API，找不到 typescript 时降级为花括号计数
- 错误提示引导用户先用 outline 查看可用符号

```
📌 FigmaService.getAuthHeaders
   文件: src/services/figma.ts:L36-44
   ~86 tokens（全文 ~2386 tokens，节省 ~2300 tokens）

  private getAuthHeaders(): Record<string, string> { ... }
```

**`tools/unfold.sh` — 新文件：shell 包装器**

**`context-lib.sh` — 新增 `context_unfold` + project root 修复**

- 新增 `context_unfold <file> <symbol>` 函数
- **bug 修复**：`context_outline` / `context_unfold` 传入绝对路径时，改用文件所在目录作为 project root，让 Node.js 向上查找目标项目的 `node_modules/typescript`（原来传 `$(pwd)` 会找到 soso-kit 目录，无 typescript 时降级 regex）

**`commands/k/context.md` — 新增 `unfold` / `u` 命令映射**

**`action/learn/scripts/learn-from-code.sh` — 重写：从 head -100 到 outline 扫描**

- 完全重写为代码结构扫描工具，替代原有 `head -100` 盲读方式
- 按优先级排序文件：hooks(1) > index(2) > tsx(3) > types(4) > ts(5)
- 累计 `FILE_TOKENS_TOTAL`，供 `discovery_cost` 计算
- 输出 Step 1b 读取顺序列表
- 移除内嵌 AI 分析 prompt（已由 `context-learn.md` Step 2 承接）

#### 验收结果

| 场景 | 测试 | 结果 |
|------|------|------|
| outline class 成员 | `FigmaService`（14个成员） | ✅ 全部显示，含类型/行号 |
| outline 顶层函数 | `maskApiKey`、`getServerConfig` | ✅ 签名完整 |
| unfold class 方法 | `FigmaService.getAuthHeaders` | ✅ L36-44，~86 tokens |
| unfold constructor | `FigmaService.constructor` | ✅ L30-34 |
| unfold 顶层函数 | `maskApiKey` | ✅ L22-25，~31 tokens |
| unfold 整个 class | `FigmaService` | ✅ L24-289 |
| unfold 不存在符号 | `FigmaService.nonExistent` | ✅ 提示用 outline 查看 |
| 绝对路径 project root | 跨项目调用（soso-kit → Figma项目） | ✅ 正确找到目标 typescript |
| context_unfold 集成 | via `context-lib.sh` | ✅ L49-57 精确（修复前 L49-50） |
| learn-from-code 目录 | 3文件目录 | ✅ 按优先级输出骨架 + token 合计 |

#### Token 节省效果

| 操作 | 改前 | 改后 |
|------|------|------|
| 查看 290 行文件的某方法 | Read 全文 ~2386 tokens | unfold ~86 tokens（**节省 96%**） |
| 了解 class 结构 | Read 全文 | outline ~200 tokens（**节省 92%**） |
| learn 代码扫描 | head -100（前100行，无结构） | outline（完整骨架 + 行号） |

#### 改动文件

- `tools/outline.js` — 增强 class 成员遍历
- `tools/unfold.js` — 新建
- `tools/unfold.sh` — 新建
- `context-lib.sh` — 新增 `context_unfold`，修复绝对路径 project root
- `commands/k/context.md` — 新增 `unfold` / `u` 命令映射
- `action/learn/scripts/learn-from-code.sh` — 重写为 outline 扫描工具

---

## v2.8.2 - 2026-03-26

### 🛠 Pitfalls 脚本化：索引操作全部由脚本承接

#### 背景

v2.8.1 的 `add/update/remove` 步骤要求 AI 手动编辑 `index.json`，JSON 操作容易出现括号遗漏、逗号错位等错误。本次将所有索引写操作提取为独立脚本，AI 只负责内容生成和用户交互。

#### 核心改动

**新增 `action/pitfall/scripts/` 目录**

| 脚本 | 职责 |
|------|------|
| `add-to-index.sh` | 追加条目到 index.json + index.md，自动计算 estimatedTokens，重复 ID 拒绝写入 |
| `update-index-entry.sh` | 更新指定条目元数据字段，自动重算 estimatedTokens，支持环境变量传入变更字段 |
| `remove-from-index.sh` | 删除 .md 文件，从 index.json + index.md 同时移除，不存在的 ID 报错退出 |

**`context-pitfall.md` 重构**

- `add`：AI 引导填字段 + Write .md → 调用 `add-to-index.sh` 同步索引
- `update`：AI Edit .md → 调用 `update-index-entry.sh` 同步索引
- `remove`：AI 展示条目 + 等待用户确认 → 调用 `remove-from-index.sh` 执行清理
- `list` / `load` 改为调用 `query-pitfall.sh`（含 token 显示，与 v2.8.1 一致）

#### 职责边界

```
AI 负责                     脚本负责
──────────────────────      ────────────────────────
引导用户填写字段             add-to-index.sh
理解修改意图                 update-index-entry.sh
Edit/Write .md 内容         remove-from-index.sh
获取用户删除确认
```

#### 验收结果

| 命令 | 功能 | 边界处理 |
|------|------|---------|
| list | ✅ token 合计显示 | — |
| load | ✅ 完整内容 + token | ✅ 不存在 ID 报错提示 |
| add | ✅ 三处同步（.md + json + md） | ✅ 重复 ID 拒绝写入 |
| update | ✅ 字段更新 + token 重算 | ✅ 不存在 ID 报错 |
| remove | ✅ 文件 + 两个索引全清理 | ✅ 不存在 ID 报错 |

#### 改动文件

- `action/pitfall/scripts/add-to-index.sh` — 新建
- `action/pitfall/scripts/update-index-entry.sh` — 新建
- `action/pitfall/scripts/remove-from-index.sh` — 新建
- `commands/k/context-pitfall.md` — 重构 add/update/remove 步骤，补充 update/remove 子命令

---

## v2.8.1 - 2026-03-26

### 🔗 Pitfalls 系统：从孤立写入到查询闭环

#### 背景

v2.8.0 建立了 Pitfalls 写入机制，但 index 仅为 markdown 表格，无法被脚本检索；pitfall 与 context feature 之间没有连接；`context load` 时不会提示已知坑。本次升级将 pitfall 接入查询体系，形成完整闭环。

#### 核心改动

**机器可读索引**

- 新增 `library/<project>/pitfalls/index.json` — 脚本唯一信源，AI 读脚本输出而非凭记忆，消除幻觉
- 字段：`id / tags / title / summary / related_feature / severity / date / path`

**Pitfall 格式升级**

- `action/pitfall/template.md` — 加入 frontmatter（`id/tags/related_feature/severity/date`），内容结构不变
- `library/sodex-web/pitfalls/trade-feerate-mobx.md` — 存量数据补齐 frontmatter

**新增查询脚本**

- `query/query-pitfall.sh` — 三种模式：列出全部 / 按 tag 搜索 / 按 ID 加载完整内容
- `query/check-feature-pitfalls.sh` — 被动检查：输入 feature-id，输出关联 pitfall 提示（无匹配则静默）

**context load 集成**

- `context.md` load 命令末尾追加 `check-feature-pitfalls.sh`，加载 feature 时自动附加 pitfall 提示
- 懒加载设计：只输出 ID + 一句话，不加载完整内容，零额外 token

**context-pitfall add 修复**

- `context-pitfall.md` add 步骤补充同步更新 `index.json` 的逻辑，保持 md 与 json 一致

#### 加载层级（渐进式）

| 触发方式 | 输出 | Token |
|---------|------|-------|
| `context load <feature>` | pitfall ID + 一句话（被动） | ~0 |
| `/k/context-pitfall` | 全部 pitfall 列表 | 极少 |
| `/k/context-pitfall <id>` | 完整 pitfall 内容 | ~300 |

#### Token 计算

| 操作 | Token 来源 | 显示位置 |
|------|-----------|---------|
| `list` | `index.json.estimatedTokens` 求和 | 标题行 + 每条条目 |
| tag 搜索 | 匹配条目的 `estimatedTokens` 求和 | 标题行 + 每条条目 |
| `--id` 加载 | 实际文件大小 `chars / 4` | 内容末尾 `📊 ~X tokens 已加载` |
| `check-feature-pitfalls` | 仅输出 ID + 一行提示 | 不显示（近零） |

`estimatedTokens` 存储在 `index.json` 每条条目中，新增 pitfall 时需同步填写（参考文件大小 chars/4）。

#### 改动文件

- `library/sodex-web/pitfalls/index.json` — 新建，加 `estimatedTokens` 字段
- `action/pitfall/template.md` — 加 frontmatter
- `library/sodex-web/pitfalls/trade-feerate-mobx.md` — 加 frontmatter
- `query/query-pitfall.sh` — 新建，含 token 显示
- `query/check-feature-pitfalls.sh` — 新建
- `commands/k/context.md` — load 命令集成 pitfall 检查
- `commands/k/context-pitfall.md` — add 步骤补充 index.json 同步

---

## v2.8.0 - 2026-03-23

### 🪤 Pitfalls 系统：已知问题库

#### 背景

AI agent 每次对话记忆清空，历史踩过的坑无法持久化，下次遇到相同问题仍需重新调试。需要一个轻量机制：记录真实问题 → 按需加载 → 事前规避。

#### 核心改动

**新增目录结构**

- `action/pitfall/template.md` — 新增 pitfall 模板，`add` 时引导填写
- `library/<project>/pitfalls/index.md` — 轻量索引（ID + 标签 + 一句话描述）
- `library/<project>/pitfalls/<id>.md` — 具体条目（问题、误判过程、根因、避免方式）

**新增命令**

- `commands/k/context-pitfall.md` — 入口命令，支持 `list` / `load <id>` / `add`

**首条 pitfall**

- `trade-feerate-mobx`：MobX 缺少 `makeObservable` 导致组件不渲染（标签：mobx,store,react,响应式）

#### 设计原则

| 特性 | 说明 |
|------|------|
| 不与 context feature 绑定 | 一个问题可跨模块，生命周期独立 |
| 不与 rules 混合 | rules 是"怎么做对"，pitfalls 是"曾经错在哪" |
| 渐进式加载 | 先看 index（极少 token），再按需 load 具体条目 |
| 手动触发 | 用户判断任务有风险时主动加载，不强制注入 |

#### 改动文件

- `action/pitfall/template.md` — 新建
- `library/sodex-web/pitfalls/index.md` — 新建
- `library/sodex-web/pitfalls/trade-feerate-mobx.md` — 新建
- `commands/k/context-pitfall.md` — 新建

---

## v2.7.3 - 2026-03-19

### 📊 Token 成本显示：写入命令全覆盖 + 读取命令按需显示

#### 背景

`context-learn` 已有完整的 `📊 Token 成本` 块，但 `context-record`、`context-update` 缺失，`context` 读命令完全没有 token 信息，无法感知每次操作的实际消耗。

#### 核心改动

**context-record.md**

- Step 2：新增 `SPEC_TOKENS` 计算（`awk` 统计 spec 文件字符数 / 4）
- Step 9：添加完整 `📊 Token 成本` 块，含三项：`keyFiles 读取节省`（通过 outline 跳过全文读取）、`spec 文档读取`、`AI 分析与写作`

**context-update.md**

- Step 3：新增 `AFFECTED_TOKENS`（实际读取章节 token 和）、`SAVED_TOKENS`（未读章节 token 和）两个变量
- Step 8：添加完整 `📊 Token 成本` 块，核心是"局部读取节省"对比，体现差量读取的价值

**context.md（读命令）**

- 只对 `load` 显示 token——唯一加载完整 reference 文档的命令，有显示价值
- token 查询合并进 Step 3 的同一条 bash 命令（`jq` 读取 router JSON `sections[].estimatedTokens` 求和），无额外 bash 调用
- `search/list/files/tag/recent/outline` 不显示——返回轻量索引元数据，估算无意义

#### 设计原则

| 命令 | 是否显示 | 原因 |
|------|----------|------|
| `learn` | ✅ 已有 | 加载多个源文件，成本高 |
| `record` | ✅ 新增 | spec 读取 + AI 分析有成本 |
| `update` | ✅ 新增 | 体现局部读取 vs 全文读取的节省 |
| `load` | ✅ 新增 | 加载完整 reference，可能 2000–5000 tokens |
| `search/list/files/tag/recent` | ❌ 不显示 | 返回索引元数据，token 极小且估算无意义 |

#### 改动文件

- `commands/k/context-record.md` — Step 2 加 SPEC_TOKENS，Step 9 加 Token 成本块
- `commands/k/context-update.md` — Step 3 加 AFFECTED/SAVED_TOKENS，Step 8 加 Token 成本块
- `commands/k/context.md` — Step 3/4 重写，load 合并 token 查询，其他命令不显示

---

## v2.7.2 - 2026-03-16

### ⚡ 执行可靠性 + Token 优化：WORKFLOW 内联 + 执行契约 + 部分读取

#### 背景

两类问题同时修复：
1. **提前终止**：LLM 写完 reference 文档后（最显眼的输出）就停止，跳过 router/history/index 等后续步骤
2. **Token 浪费**：每次命令调用都 Read WORKFLOW.md（470-652 行），消耗 5,000-5,900 tokens，占总消耗 30-40%

#### 核心改动

**P0：修复 audit 链式触发 Bug**

`audit/WORKFLOW.md` Step 3 和 `context-audit.md` 原来指向已归档的 `action/update/WORKFLOW.md`，用户确认更新时走旧逻辑。修复为读取新的自包含命令文件 `commands/k/context-update.md`。

**P1：context-update.md WORKFLOW 内联 + 执行契约 + 部分读取（节省 ~9,100 tokens/次）**

- WORKFLOW 内联（Optimization A）：将 `action/update/WORKFLOW.md`（476 行）内容直接并入命令文件，消除每次 Read 调用
- 执行契约：命令文件顶部添加必须完成的步骤清单，Step 8 完成报告要求真实文件路径（无法伪造）
- 部分读取（Optimization B）：Step 1 提取 router sections 的 lineRange，Step 4 仅读取受影响章节而非全量文档，节省 3,000-6,000 tokens

Token 对比：
| 项目 | 之前 | 之后 |
|------|------|------|
| WORKFLOW.md Read | ~5,100 tokens | 0（已内联） |
| reference doc Read | 全量 4,900-8,600 tokens | 部分 ~500-1,000 tokens |
| 合计节省 | — | ~9,100 tokens/次（约 70%） |

**P2：context-record.md WORKFLOW 内联 + 执行契约（节省 ~5,900 tokens/次）**

- 将 `action/record/WORKFLOW.md`（652 行）内容内联至命令文件
- 添加执行契约（Steps 4-9 必须全部完成）
- 在 Step 4、5、6、7 末尾添加强制继续指令，防止提前终止
- Step 9 完成报告要求真实路径（RELATIVE_PATH、MODULE_CONFIG_PATH）

**P3：context-learn.md WORKFLOW 内联 + 执行契约（节省 ~5,400 tokens/次）**

- 将 `action/learn/WORKFLOW.md`（531 行）内容内联至命令文件
- 添加执行契约（Steps 4-9，含 7b）
- 两个主要停止点（Step 4 写完文档后、Step 8 质量检查后）添加强制继续指令

#### 改动文件

- `commands/k/context-update.md` — 53 行 → 405 行，完全重写（内联 + 执行契约 + 部分读取）
- `commands/k/context-record.md` — 37 行 → 366 行，完全重写（内联 + 执行契约）
- `commands/k/context-learn.md` — 39 行 → 460 行，完全重写（内联 + 执行契约）
- `commands/k/context-audit.md` — 修复 update 引用（P0 Bug fix）
- `action/update/WORKFLOW.md` — 归档（顶部添加归档说明，内容保留）
- `action/record/WORKFLOW.md` — 归档（同上）
- `action/learn/WORKFLOW.md` — 归档（同上）
- `action/audit/WORKFLOW.md` — Step 3 修复 update 引用（P0 Bug fix）

---

## v2.7.1 - 2026-03-14

### 🔗 关联文件同步更新：命令引用统一为新命令名

#### 改动

修复 `check.md` / `check.sh` / `check/README.md` / `context/README.md` 中遗留的旧 action 命令引用，与 v2.7.0 的命令拆分保持一致。

**`commands/k/check.md`**：`--r` 触发逻辑中的 `source record/WORKFLOW.md` → 改为 Read 工具指令注释，修复 `/k/check --r` 实际不执行 record 的问题。

**`kit/check/scripts/check.sh`**：echo 提示中 `/k/context record` → `/k/context-record`

**`kit/check/README.md`**：3 处 `/k/context record` → `/k/context-record`

**`kit/context/README.md`**：更新命令（需在 soso-kit 主仓库执行）代码块，所有 action 命令替换为新命令名，并补充 `audit` 命令。

#### 改动文件

- `commands/k/check.md` — 修复 `--r` source 调用
- `kit/check/scripts/check.sh` — 更新提示文案
- `kit/check/README.md` — 文档引用同步
- `kit/context/README.md` — action 命令全部更新为新写法

---

## v2.7.0 - 2026-03-13

### 🤖 AI 命令可靠性重构：READ/ACTION 分离 + Bash 工具执行

#### 背景

原 `context.md` 使用 `source context-lib.sh && function()` 模式，AI 无法执行 bash 函数，只能脑内模拟，导致 load/search/record/learn/update 等命令不稳定甚至完全失效。

#### 核心改动

**1. context.md 职责收窄（READ 命令专用）**

- 只处理 `list / search / load / files / tag / recent / outline / help`
- 改为明确指示 AI 使用 **Bash 工具**执行，模板：
  ```bash
  cd "$KIT_ROOT" && source .cursor/kit/context/context-lib.sh && <FN>
  ```
- 新增 few-shot 示例（`load trade-deposit`），强化 AI 识别准确率
- ACTION 命令统一提示用户使用独立命令

**2. ACTION 命令拆分为独立 command 文件（5 个）**

| 命令 | 文件 | 对应 WORKFLOW |
|------|------|--------------|
| `/k/context-record` | `context-record.md` | `action/record/WORKFLOW.md` |
| `/k/context-learn <path>` | `context-learn.md` | `action/learn/WORKFLOW.md` |
| `/k/context-update <id>` | `context-update.md` | `action/update/WORKFLOW.md` |
| `/k/context-audit <id>` | `context-audit.md` | `action/audit/WORKFLOW.md` |
| `/k/context-remove <id>` | `context-remove.md` | `remove-feature.sh`（带对话确认） |

每个文件统一模式：Bash 工具找 KIT_ROOT + 校验写权限 → **Read 工具**读取 WORKFLOW.md → 严格执行所有步骤。

**3. audit/WORKFLOW.md 链式触发修复**

- Step 3 的 `source update/WORKFLOW.md` → 改为 **Read 工具**读取并执行，打通 audit → update 链路

#### 改动文件

- `commands/k/context.md` — 重写，READ 命令专用 + few-shot
- `commands/k/context-record.md` — 新建
- `commands/k/context-learn.md` — 新建
- `commands/k/context-update.md` — 新建
- `commands/k/context-audit.md` — 新建
- `commands/k/context-remove.md` — 新建
- `action/audit/WORKFLOW.md` — 修复 Step 3 source 调用

---

## v2.6.4 - 2026-03-12

### ⚡ record Step 4.5 脚本化：节省 ~2500 tokens/次

#### 改动

`scan-outline.sh` 新增 `--doc-path` 参数，支持从文档路径提取 keyFiles（原有 feature-id 模式不变）：

```bash
# 原有用法（update Step 2.5）
bash scan-outline.sh <feature-id>

# 新增用法（record Step 4.5）
bash scan-outline.sh --doc-path <doc-path>
```

`--doc-path` 模式：从合并文档中 grep `src/*.ts|tsx` 路径，执行相同的 outline 扫描循环，末尾输出机器可读变量 `FILE_TOKENS_TOTAL=<N>`。

同步更新 record Step 4.5：65 行内联 bash → 3 行脚本调用，节省 **~2500 tokens / 次 record 调用**。

#### 改动文件

- `action/update/scripts/scan-outline.sh` — 新增 `--doc-path` 参数 + token 累计输出
- `action/record/WORKFLOW.md` — Step 4.5 压缩为脚本调用

---

## v2.6.3 - 2026-03-12

### 🔍 Outline 全面集成：record 入库质量提升 + learn token 统计 + update Step 2.5 修复

#### 核心改进

**1. record 新增 Step 4.5（Outline 扫描，可选）**

`/k/context record` 工作流在 Step 4（合并文档）后、Step 5（生成 quickRef）前，新增可选的 outline 扫描步骤：

- 自动从合并文档中提取 keyFiles 路径
- 自动检测目标代码库（sodex-web）
- 逐文件执行 outline 扫描，获取真实函数签名 + 行号
- 将扫描结果 `$OUTLINE_MAP` 传给 Step 5，使 `coreLogic` 质量与 `learn` 命令产出一致
- 若代码库不可访问，graceful 跳过（不阻断流程）
- 不可用时 coreLogic 标注 `[推断，无行号]`，提示精度较低
- 零 AI token 消耗，同时输出 keyFiles 全量读取 token 估算

```
📊 Outline 扫描完成：
  扫描文件数: 3
  keyFiles 全量读取估算: ~2160 tokens（本次 outline 扫描: ~0 tokens）
```

**2. learn Step 1a + Step 9 token 成本统计**

- Step 1a：在 outline 循环中累计每文件 token 估算到 `FILE_TOKENS_TOTAL`
- Step 5：`discovery_cost` 由"~3200 tokens 估算"改为基于 `FILE_TOKENS_TOTAL` 的实测值
- Step 9：新增 token 成本报告（outline 扫描 / 全量读取 / AI 分析 / 总计）

```
📊 Token 成本
  outline 扫描         : ~0 tokens
  keyFiles 全量读取估算: ~2160 tokens
  AI 分析与写作        : ~800 tokens
  ─────────────────────────
  本次总计             : ~2960 tokens
```

**3. update Step 2.5 修复（意外删除后恢复）**

`d4ede3a` 提交意外覆盖了 `d774b9f` 添加的 update Step 2.5，本次修复恢复并增强：

- 恢复 `scan-outline.sh` 调用和符号变更分析流程
- 新增**低精度基线检测**（Step 1）：检查 coreLogic 是否含行号
  - `high`：含行号（来自 learn 或 outline 增强后的 record）→ 正常做增删改对比
  - `low`：纯文本推断（来自未增强的 record）→ 以 outline 当前状态作为新基线，只识别删除和签名变化，避免误报"所有函数都是新增"
- Step 3 评估标准同步更新，引用 outline 符号变更数据
- Step 4 新增 outline 行号驱动的代码引用规范
- Step 8 完成摘要新增 `Outline 符号` 统计行

#### 改动文件

- `action/record/WORKFLOW.md` — 新增 Step 4.5 + Step 5 coreLogic 生成规范
- `action/learn/WORKFLOW.md` — Step 1a 累计 token + Step 5 discovery_cost 实测化 + Step 9 token 报告
- `action/update/WORKFLOW.md` — 恢复 Step 2.5 + Step 1 基线质量检测 + Step 3/4/8 outline 联动

---

## v2.6.2 - 2026-03-12

### 🔍 Update 命令 AST 感知 + Clarify 进度显示

#### 核心改进

**1. `scan-outline.sh` — Update Step 2.5（零 token AST 符号扫描）**

`/k/context update` 工作流新增 Step 2.5，在读取 git commits 后、评估变更幅度前，自动扫描 keyFiles 的函数/类/接口符号骨架：

- 零 AI token 消耗（纯 shell 脚本执行）
- 精准识别：➕ 新增函数、➖ 删除函数、✏️ 签名变化
- 对比文档已记录的符号，确保文档与代码不脱节
- 输出符号变更汇总，驱动后续章节评估和文档重写

```
📊 Outline 符号变更
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  useDeposit.ts:
    ➕ normalizeCoinSymbol      L44
    ➕ buildFlashBridgeCallConfig L53-86
  useFundingToken.ts:
    ✏️ withLogoRemoteNativeTokenList (返回类型变化)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

最终汇总报告新增 `Outline 符号` 统计行（➕新增数 ➖删除数 ✏️修改数）。

**2. `/k/clarify` 进度显示**

每次提问前展示当前进度，格式 `📍 问题 N/总数`，其中总数为开始前预估（可随理解深入调整）。消除用户对"还有几个问题"的不确定感。

**3. `context learn` JSON 验证步骤（Step 7b）**

learn WORKFLOW 新增 Step 7b：使用 `python3 -m json.tool` 验证所有修改的 JSON 文件，若格式错误立即修复后继续。防止手动编辑引入格式错误导致数据损坏。

**4. 部署脚本优化**

`run.sh` 等待时间从 10 分钟调整为 8 分钟，更符合实际镜像构建耗时。

#### Context 数据更新

- 新增 `trade-deposit` context（trade 模块充值流程完整文档）
- 新增 `stake-page` context（stake 模块页面导航与路由文档）
- 新增 `router/stake.json` 路由配置文件

#### 改动文件

- `action/update/scripts/scan-outline.sh` — 新增（AST 符号扫描）
- `action/update/WORKFLOW.md` — 新增 Step 2.5 + 符号驱动文档更新规范
- `action/learn/WORKFLOW.md` — 新增 Step 7b JSON 验证
- `.cursor/commands/k/clarify.md` — 新增进度显示规则
- `.cursor/kit/deploy/scripts/run.sh` — 等待时间 10min → 8min
- `library/sodex-web/router/trade.json` — trade-deposit context 更新
- `library/sodex-web/router/stake.json` — 新增 stake-page context
- `library/sodex-web/reference/trade/trade-deposit-guide.md` — 详细指南
- `library/sodex-web/reference/stake/stake-page-guide.md` — 新增

---

## v2.6.1 - 2026-03-11

### ✨ clarify 命令提问策略升级

参考 spec-kit 澄清流程，重构 `/k/clarify` Step 2 的提问机制。

#### 变更内容

**分层提问框架（最多 8 问）**：

- **必问 2 个**（固定顺序）：用户场景（Q1）、成功指标（Q2）
- **核心问 4 个**（按模糊度选）：排除项、数据模型、集成、错误处理
- **可选问 2 个**（复杂需求才追加，标注可跳过）：NFR、优先级

**新增提问规则**：
- 每问附上推荐答案和理由，降低用户决策成本
- 核心 4 个按模糊度评估，已清晰的维度直接跳过
- 追问（基于用户回答引入的新信息）不计入 8 问配额

#### 设计原则

- 8 问 = 维度探索配额（方向性问题）
- 追问 = 对已触发维度的深挖，不混用配额
- 总上限 8 问防止提问疲劳，追问无限制确保细节不丢

---

## v2.6.0 - 2026-03-10

### 🔍 AST 代码导航 + 渐进式加载（Smart Explore）

受 claude-mem Smart Explore 启发，引入 AST 驱动的代码符号提取，并重构 context load 为渐进式加载。

#### 新增功能

**1. `tools/outline.js` — 文件符号骨架提取（核心）**
- 优先使用项目内 TypeScript Compiler API（精准 AST）
- 找不到时自动降级纯 Node.js 正则方案（零依赖）
- 提取：导出/内部函数、类、接口、类型、枚举，带完整签名和行号
- 约 30 token 了解一个文件，vs 读全文 ~700 token（节省 ~96%）

**2. `/k/context outline <path>` — 新命令**
- 查看任意文件的符号骨架，不需要文件在 context 索引里
- 支持缩写：`/k/context o <path>`

**3. `/k/context file` 增强**
- 原有功能保留：显示文件所属 feature
- 新增：自动附加文件符号骨架
- 文件不在 context 索引里时也展示骨架（不再直接 exit）

**4. `context load` 渐进式加载**
- 默认模式：摘要 + quickRef + sections 索引（~300 token）
- `--full` 模式：追加完整参考文档（~5000 token）
- 用法：`/k/context load vault-deposit --full`

**5. `context search` AST 感知**
- coreLogic 字段参与搜索匹配（函数签名可被搜索到）
- 搜索结果附加 coreLogic 符号列表（最多 3 条）

**6. `discovery_cost` 新字段**
- router JSON 新增 `discovery_cost` 字段
- 记录研究该功能的 token 成本（如 `~4800 tokens`）
- `context load` 默认层展示，让 AI 评估记忆价值权重

**7. `context learn` 更新**
- Step 1 新增 outline 扫描阶段（先骨架后全读）
- Step 2 的 coreLogic 格式改为带签名+行号
- Step 5 新增 discovery_cost 字段记录

#### 改动文件

- `tools/outline.js` — 新增
- `tools/outline.sh` — 新增
- `context-lib.sh` — context_load / context_search / context_outline 更新
- `query/query-file.sh` — 附加 outline 输出
- `action/learn/WORKFLOW.md` — Step 1 + Step 2 + Step 5 更新
- `.cursor/commands/k/context.md` — 新增 outline 命令分发

---

## v2.5.6 - 2026-02-24

### 🔍 Sections 验证机制

**核心改进**：
1. **新增验证脚本** `validate-sections.sh`：
   - 验证 router sections 配置与文档章节对齐
   - 支持 `--verbose` 详细对比模式
   - 支持 `--fix` 生成修复建议

2. **context_load 自动检查**：
   - 加载时自动检测章节数量不匹配
   - 提示运行验证脚本

3. **analyze-document.sh 改进**：
   - 清理 emoji 后再提取标题
   - 更准确的 lineRange 计算
   - 明确的 summary 占位符

4. **record WORKFLOW 验证步骤**：
   - 生成 sections 后自动验证
   - 发现问题时提示手动检查

**使用方法**：
```bash
# 验证现有配置
bash validate-sections.sh --doc-path <doc> --sections "<json>" --verbose

# 生成修复建议
bash validate-sections.sh --doc-path <doc> --fix
```

**实施文件**：
- `action/record/scripts/validate-sections.sh` - 新增
- `action/record/scripts/analyze-document.sh` - 改进
- `action/record/WORKFLOW.md` - 添加验证步骤
- `context-lib.sh` - context_load 添加检查
- `README.md` - 添加 Sections 配置规范

---

## v2.5.5 - 2026-02-17

### 🔧 架构简化：移除冗余 record 命令

**核心改进**：
1. **移除冗余命令**：
   - ✅ 删除 `.cursor/commands/k/record.md`
   - ✅ check.md --r 直接调用 WORKFLOW.md
   - ✅ 避免命令重复

2. **调用链优化**：
   ```
   之前：check.md --r → record.md → WORKFLOW.md
   现在：check.md --r → WORKFLOW.md（直接）
   ```

3. **架构清晰度**：
   - `/k/check --r` - 检查并记录（直接调用工作流）
   - `/k/context record` - 独立记录（统一入口）
   - 移除中间层，架构更简洁

**设计理由**：
- v2.5.3 创建独立 record.md 是为了节省 token
- v2.5.4 模板外部化后，直接调用 WORKFLOW 更优
- 避免维护两个入口（record.md 和 context.md）

**实施文件**：
- `.cursor/commands/k/check.md` - 修改为直接调用 WORKFLOW
- `.cursor/commands/k/record.md` - 删除

**影响范围**：
- 无破坏性变更
- `/k/check` 和 `/k/check --r` 完全正常
- 用户使用 `/k/context record` 记录功能

---

## v2.5.4 - 2026-02-17

### ⚡ Token 优化：Check 模板外部化

**核心改进**：
1. **模板外部化**：
   - ✅ 提取 238 行 checklist 模板到独立文件
   - ✅ 创建 `.cursor/kit/check/templates/checklist.md`
   - ✅ 创建 `.cursor/kit/check/scripts/check.sh`
   - ✅ 简化 `check.md` 从 262 行到 30 行

2. **Token 节省**：
   ```
   之前：check.md = 262 行 ≈ 13,100 tokens
   现在：check.md = 30 行 ≈ 1,200 tokens
   节省：11,900 tokens（90.8%）✅
   ```

3. **架构改进**：
   ```
   .cursor/kit/check/
   ├── templates/
   │   └── checklist.md    # Checklist 模板（不计入 tokens）
   ├── scripts/
   │   └── check.sh        # 检查逻辑脚本
   └── README.md           # 使用文档
   ```

**设计优势**：
- ✅ **显著节省 tokens**：从 13,100 → 1,200（90.8%）
- ✅ **分离关注点**：模板内容 vs 脚本逻辑
- ✅ **易于维护**：修改 checklist 不影响命令逻辑
- ✅ **向后兼容**：`/k/check` 和 `/k/check --r` 完全兼容

**实施文件**：
- `.cursor/commands/k/check.md` - 简化为 30 行
- `.cursor/kit/check/templates/checklist.md` - 完整 checklist
- `.cursor/kit/check/scripts/check.sh` - 检查逻辑

**影响范围**：
- 无破坏性变更
- 完全向后兼容
- Token 使用大幅降低

**Token 优化策略总结**：
| 版本 | 优化内容 | Token 节省 | 累计节省 |
|------|---------|-----------|---------|
| v2.5.3 | record 命令独立 | 45.8% | 11,900 |
| v2.5.4 | check 模板外部化 | 90.8% | 11,900 |
| **总计** | - | - | **23,800** |

---

## v2.5.3 - 2026-02-17

### ⚡ Token 优化：独立 record 命令

**核心改进**：
1. **创建独立命令**：
   - ✅ 新增 `/k/record` 命令（独立文件）
   - ✅ 直接调用 record 工作流
   - ✅ 不再通过 context 路由

2. **Token 节省**：
   ```
   之前：check.md + context.md = 520 行 ≈ 26,000 tokens
   现在：check.md + record.md  = 282 行 ≈ 14,100 tokens
   节省：45.8% token ✅
   ```

3. **更新调用**：
   - ✅ `check.md --r` 改为调用 `/k/record`
   - ✅ 避免加载完整的 context.md（258 行）
   - ✅ 只加载必要的 record.md（20 行）

**额外优势**：
- ✅ **性能提升**：加载时间减少 45%
- ✅ **独立性**：用户可直接调用 `/k/record`
- ✅ **一致性**：与 `/k/check`、`/k/spec` 同级
- ✅ **向后兼容**：`/k/context record` 仍然可用

**实施文件**：
- `.cursor/commands/k/record.md` - 新增独立命令
- `.cursor/commands/k/check.md` - 更新调用方式

**影响范围**：
- 无破坏性变更
- 完全向后兼容
- 性能显著提升

---

## v2.5.2 - 2026-02-17

### 🎯 终极简化：action + query 清晰分离

**核心改进**：
1. **读写分离架构**：
   - ✅ 创建 `action/` 目录，统一管理所有写入操作
   - ✅ 迁移 `record/`, `learn/`, `update/`, `remove/` 到 `action/`
   - ✅ 保持 `query/` 独立，明确只读操作
   - ✅ 保持 `shared/` 独立，作为工具库

2. **目录结构优化**：
   ```
   .cursor/kit/context/
   ├── action/       # 所有写入操作（4个命令）
   │   ├── record/
   │   ├── learn/
   │   ├── update/
   │   └── remove/
   ├── query/        # 所有读取操作（2个脚本）
   ├── shared/       # 共享工具
   └── library/      # 数据存储
   ```

3. **路径引用更新**：
   - ✅ `context-lib.sh` - 3 个函数路径
   - ✅ `context.md` - record 工作流路径
   - ✅ `README.md` - 目录结构图

**设计优势**：
- ✅ **清晰分类**：action（写）vs query（读）vs shared（工具）
- ✅ **扁平结构**：只有 4 个顶层目录
- ✅ **语义明确**：一眼看出每个目录的作用

**影响范围**：
- 无破坏性变更
- 所有命令向后兼容
- 只是目录位置调整

---

## v2.5.1 - 2026-02-17

### 🏗️ 架构优化 + Learn 增强

**核心改进**：
1. **目录结构模块化**：
   - ✅ 删除多余的 `.cursor/kit/library/` 目录
   - ✅ 创建独立模块目录：`update/`, `learn/`, `remove/`
   - ✅ 每个模块有自己的 `scripts/` 子目录
   - ✅ 更新 `context-lib.sh` 路径引用

2. **Learn 脚本增强**：
   - ✅ 新增 **数据流分析** (dataFlow) 维度
     - 追踪输入 → 处理 → 输出的完整链路
     - 识别状态管理方式和副作用
   - ✅ 增强分析提示
     - 提供详细的分析清单和示例
     - 强调"如何实现"而非"做什么"
   - ✅ 代码类型检测
     - 自动识别 Hook/Component/Module
     - 显示代码内容预览（前 100 行）

3. **分析能力提升**：
   - ✅ 5 个分析维度：核心逻辑、数据流、关键组件、技术标签、分类建议
   - ✅ 结构化输出：JSON 格式 + quickRef 标准
   - ✅ 实用性优先：准确描述代码实际行为

**新目录结构**：
```
.cursor/kit/context/
├── update/scripts/update-feature.sh
├── learn/scripts/learn-from-code.sh
└── remove/scripts/remove-feature.sh
```

**升级影响**：
- 无破坏性变更
- 所有命令向后兼容
- Learn 分析质量显著提升

---

## v2.5 - 2026-02-17

### 🚀 命令优化：精简 + 增强管理功能

**核心改进**：
1. **命令精简**（-18%）：
   - ❌ 删除 `timeline` 子命令（低频使用）
   - ❌ 删除 `recent` 子命令（可用 list 替代）
   - ✅ 从 11 个命令精简到 9 个命令

2. **新增写入命令**（完整 CRUD）：
   - ✅ `/k/context learn <path>` - **从代码学习生成 Context 文档**
     - AI 分析代码提取核心逻辑、关键组件、技术标签
     - 自动生成符合 Context 格式的文档
     - 填补"代码→文档"的空白（record 需要 spec）
   - ✅ `/k/context update <id>` - 更新功能元数据
     - 交互式修改标题、摘要、标签、文件列表
     - 自动更新 router 和索引
   - ✅ `/k/context remove <id>` - 安全删除功能
     - 二次确认防止误删
     - 自动清理所有索引和引用
     - 文档归档到 .archive/ 目录

3. **命令结构优化**：
   - **写入命令（4个）**：record, learn, update, remove
   - **读取命令（5个）**：list, load, search, file, tag
   - **总计**：9 个命令，职责清晰

**创新亮点**：
- 🌟 **learn 命令**：遗留代码理解的利器
  - 场景：没有 spec 文档的代码、理解他人代码、快速建立上下文
  - 工作流：代码 → AI 分析 → 生成文档 → 保存到 Context Library
  - 互补关系：新开发用 record（基于 spec），理解旧代码用 learn（基于代码）

**实现文件**：
- `.cursor/kit/context/record/scripts/update-feature.sh` - update 命令实现
- `.cursor/kit/context/record/scripts/remove-feature.sh` - remove 命令实现
- `.cursor/kit/context/record/scripts/learn-from-code.sh` - learn 命令实现
- `.cursor/commands/k/context.md` - 更新路由逻辑

**影响范围**：
- 更新 `context.md` 路由逻辑
- 更新 `context-lib.sh` 函数定义
- 更新帮助文档和示例

---

## v2.4 - 2026-02-17

### 🏗️ 架构重构：统一命令 + 自包含设计

**核心改进**：
1. **命令统一**：
   - ✅ `/k/record` 合并到 `/k/context record`
   - ✅ 所有 context 操作统一入口
   - ✅ 符合 Git/Docker 等主流工具的命令风格

2. **目录重组**：
   - ✅ `kit/record/` → `kit/context/record/`
   - ✅ `kit/library/` → `kit/context/library/`
   - ✅ 新增 `kit/context/shared/` 共享工具
   - ✅ context 系统完全自包含

3. **新增查询命令**：
   - ✅ `/k/context file <path>` - 查询文件涉及的功能
   - ✅ `/k/context tag <tag>` - 查询使用某标签的功能
   - ✅ 充分利用 v2.3 的反向索引

4. **路径引用更新**：
   - ✅ 更新 9 个文件的路径引用
   - ✅ 批量替换 + 手动确认关键文件
   - ✅ 确保所有脚本正常工作

**设计优势**：
- ✅ **高内聚**：context 系统在一个目录，代码+数据统一管理
- ✅ **低耦合**：内部模块化，对外统一接口
- ✅ **符合惯例**：统一入口 + 子命令风格

**兼容性**：
- `/k/record` 已合并到 `/k/context record`
- 通过 `/k/check --r` 自动调用 `/k/context record`

---

## v2.3 - 2026-02-16

### ✅ 已完成

#### /k/record 命令与 check.md 重构（v2 更新）

**最新改进（2026-02-17 v3）**：
1. **混合索引方案**（反向索引 + 功能标签）：
   - ✅ **文件反向索引** (`indexes/files.json`)：file-path → features[]
     - O(1) 查询："这个文件涉及哪些功能？"
     - 支持多功能映射（一个文件可属于多个功能）
     - 自动记录 lastUpdate 时间
   - ✅ **功能标签索引** (`indexes/tags.json`)：tag-name → feature-ids[]
     - 概念级查询："哪些功能使用了状态机模式？"
     - 标签策略：仅使用功能级标签（state-machine、bridge、polling）
     - 避免文件级标签（文件路径本身就是最好的标签）
   - ✅ **自动维护**：/k/record Step 7 后自动调用 `update-indexes.sh`
   - ✅ **轻量化**：保持 context-index.json 仅 5KB，索引文件独立存储
   - ✅ **性能提升**：查询复杂度从 O(n) 降低到 O(1)

2. **索引设计文档**：
   - 新增 `.cursor/kit/context/record/INDEXES.md`（完整设计文档）
   - 包含：索引格式、标签策略、维护机制、查询示例
   - 性能对比：v2.2 vs v2.3 对比表

---

**最新改进（2026-02-16 晚上 v2）**：
1. **Type 逻辑简化**（方案 A）：
   - ✅ **创建新功能**：固定 `type=feat`，无需用户选择
     - 理由：记录新功能到 context 本质就是"feat"
     - 减少一个选择步骤，更符合语义
   - ✅ **更新现有功能**：保留 Type 选择（fix/refactor/feat）
     - 提供智能推荐（基于 spec 关键词和 commit message）
     - 用户从菜单选择具体的变更类型
   - ✅ 效率提升：创建新功能时减少 **1 个选择步骤**

---

**改进（2026-02-16 晚上 v1）**：
1. **智能推荐与自动化升级**：
   - ✅ 新增 `search-similar.sh`：三级匹配搜索相似功能
     - ⭐⭐⭐ 精准 Title 匹配（不区分大小写）
     - ⭐⭐ 模糊 Title 匹配（关键词重叠 ≥50%）
     - ⭐ Summary 关键词匹配（≥30%）
   - ✅ 新增 `suggest-feature-id.sh`：智能推荐 Feature ID（自动递增编号）
   - ✅ 新增 `suggest-module.sh`：基于文件路径分析推荐 Module
   - ✅ 新增 `suggest-type.sh`：基于 spec 内容和 commit 推荐 Type（仅更新时使用）

2. **record.md Step 2 重构**：
   - 自动提取 Title 和 Summary（从 spec 文档）
   - 自动搜索相似功能，提供交互式选择
   - 分支处理：
     - **更新现有**：自动读取配置 + 选择变更类型
     - **创建新功能**：智能推荐 + 菜单选择，减少 70% 输入量
   - 用户只需确认关键决策（更新 or 新建、ID、Module）

3. **用户体验优化**：
   - 交互式菜单（PS3 select）替代手动输入
   - 智能推荐默认值，回车确认即可
   - ID 冲突自动检测，避免覆盖
   - 最终汇总确认，防止误操作

---

**改进（2026-02-16 下午）**：
1. **重组 record 目录结构**：
   - 新增 `scripts/` 子目录，所有脚本移至此处
   - 保持目录整洁，便于维护

2. **改进 history 文档生成格式**：
   - 符合 context 规范的 8 章节标准格式
   - 自动提取：核心需求、流程图、组件表格、解决方案、文件列表
   - 智能合并 spec 和旧 history 内容
   - 生成格式与现有优秀文档一致

---

#### /k/record 命令与 check.md 重构（初版）

**背景问题**：
- check.md 承担了太多职责（检查 + 文档合并，409行）
- 文档更新逻辑（103-326行）与检查逻辑耦合
- 无法独立执行文档更新
- 不符合 context v2.2 模块化架构

**解决方案**：职责分离 + 自动化工具

```
check.md (重构后)
├── 核心职责：代码检查、验证、commit 建议
├── 移除：文档合并逻辑（224行）
└── 新增：--r 参数支持（可选调用 record）

/k/record (新命令)
├── 核心职责：记录功能到 Context Library
├── 支持：context v2.2 模块化架构
├── 自动：生成 quickRef 和 sections
└── 更新：router 配置 + context-index.json
```

**实现细节**：

1. **新增 .cursor/kit/context/record/ 目录**（6个脚本工具）
2. **新增 /k/record 命令**（9个步骤的完整工作流）
3. **check.md 重构**（409行 → 185行，减少 55%）
4. **自动化特性**：自动提取、自动生成、自动备份

**使用流程**：
```bash
/k/check              # 只检查
/k/check --r          # 检查后自动记录
/k/record             # 只记录
```

---

## v2.2 - 2026-02-15

### ✅ 已完成

#### 模块化架构重构

**背景问题**：
- 单个 context-index.json 文件包含所有模块的详细配置，随着项目增长会越来越大（321行）
- 新增模块时需要在一个大文件中添加所有信息，不易维护
- 缺少模块级别的独立管理

**解决方案**：
将配置拆分为**主索引 + 模块配置**的两层结构：

```
library/sodex-web/
├── context-index.json        # 主索引（轻量级，76行）
│   └── modules[]             # 只包含模块列表和 recentQueue
│
├── router/                   # 路由配置目录（集中管理）
│   ├── vault.json           # vault 模块的所有功能配置
│   ├── shared.json          # shared 模块的所有功能配置
│   ├── stake.json           # 未来模块
│   ├── network.json
│   └── points.json
│
├── history/                  # 历史文档（按模块/功能组织）
│   ├── vault/
│   └── shared/
│
└── reference/                # 参考文档（按模块/功能组织）
    ├── vault/
    └── shared/
```

**实现细节**：

1. **主索引瘦身**（321行 → 76行，**减少 76%**）：
   - 只保留 meta + modules[] + recentQueue
   - 每个模块只记录基本信息和 configPath

2. **模块配置独立管理**：
   - 每个模块在 `router/{module}.json` 中维护自己的所有功能
   - 包含 features、history、索引等完整信息

3. **增强 context-lib.sh**：
   - 新增 `load_module_config()` - 按需加载模块配置
   - 新增 `get_feature_from_module()` - 从模块获取功能信息
   - 所有查询函数支持模块化加载

**优势**：
- ✅ 主索引轻量化：321行 → 76行（**减少 76%**）
- ✅ 模块独立管理：新增模块只需创建 router/{module}.json
- ✅ 按需加载：只加载需要的模块配置，提升性能
- ✅ 易于维护：模块配置独立，修改互不影响
- ✅ 扩展性强：支持无限增加新模块
- ✅ 向后兼容：保持所有命令接口不变

**新增模块流程**：
1. 创建 `router/{module}.json` 配置文件
2. 在主索引的 `modules[]` 中添加模块信息
3. 在 `history/` 或 `reference/` 中存放文档
4. 无需修改 context-lib.sh，自动支持

---

## v2.1 - 2026-02-15

### ✅ 已完成

#### L2.5 层 - 章节索引（四层渐进式披露）

**背景问题**：
- L2（quickRef，~200 tokens）到 L3（完整文档，~6000-12000 tokens）跨度太大
- 长参考文档（>400行）缺少中间层的结构化摘要
- AI 难以快速定位到文档的特定章节

**解决方案**（方案1 + 方案5混合）：
```
L1 (索引层)          ~800 tokens      快速浏览所有功能
    ↓
L2 (快速参考)        ~200 tokens      核心逻辑摘要
    ↓
L2.5 (章节索引)      ~600 tokens      长文档的章节结构  ← 新增
    ↓
L3 (完整文档)        ~6000 tokens     详细实现文档
```

**实现细节**：
1. **添加 sections 字段**：
   ```json
   {
     "reference": {
       "vault-deposit-01": {
         "referencePath": "reference/vault/vault-deposit-guide.md",
         "sections": [
           {
             "title": "架构概览",
             "summary": "分层状态机设计...",
             "lineRange": [3, 35],
             "estimatedTokens": 500
           }
         ]
       }
     }
   }
   ```

2. **增强 context_load 输出**：
   - 如果功能有 sections，先显示章节索引
   - 每个章节显示：标题、行号范围、token估算、摘要
   - 然后显示完整文档

3. **混合策略**：
   - 长参考文档（>400行）：添加 sections + referencePath
   - 短历史文档（<300行）：只使用 historyPath，直接加载

**效果**：
- ✅ Token优化提升：从 73-94% → **85-94%**
- ✅ AI 能够快速了解文档结构（600 tokens）
- ✅ 支持按章节定位，提高查找效率
- ✅ 保持现有命令接口不变（不添加新命令）

**示例**：
```bash
/k/context load vault-deposit-01

# 输出：
📑 章节索引 (L2.5)
[1] 架构概览 [3-35] (~500 tokens)
[2] 状态转换 [38-65] (~400 tokens)
...

📖 完整文档 (L3)
# Vault Deposit 功能指南
...
```

---

## v2.0 - 2026-02-15

### ✅ 已完成

#### 1. 注释规范修复
- ❌ 删除所有装饰线分隔符（`====`）
- ✅ 改为简短中文单行注释
- ✅ 符合 regular.mdc + clean-code.mdc 规范

#### 2. 分类结构重构
**从技术分类改为功能模块分类**：

```
修改前：                修改后：
components/            vault/          (Vault 充值提现与流动性)
features/       →      stake/          (质押相关功能)
infrastructure/        network/        (网络切换与多链支持)
                       points/         (积分与奖励系统)
                       shared/         (共享基础设施)
```

**优势**：
- ✅ 按功能模块自然分组，查找更直观
- ✅ 符合团队工作模式（不同人负责不同模块）
- ✅ 支持类型标签（feature/component/infrastructure）
- ✅ 新增 byModule 索引

**数据迁移**：
- ✅ 所有文档已迁移到新结构
- ✅ context-index.json 已更新（v2.0）
- ✅ historyPath 已更新
- ✅ 测试验证通过

#### 3. 权限控制机制（方案4）
**实施只读 + 主仓库更新模式**：

| 位置 | 权限 | 说明 |
|------|------|------|
| **soso-kit 主仓库** | 读写 | 可查询 + 可更新 context |
| **Worktree** | 只读 | 只可查询，无法修改 |

**实现细节**：
- ✅ 自动检测当前位置（主仓库 vs worktree）
- ✅ 设置 `CONTEXT_READONLY_MODE` 环境变量
- ✅ 更新命令自动检查写权限
- ✅ 只读模式下给出清晰提示

**命令分类**：
```bash
# 查询命令（只读，任何位置可用）
/k/context list
/k/context search <keyword>
/k/context recent
/k/context load <id>
/k/context timeline <id>
/k/context files <path>

# 更新命令（需在主仓库执行）
/k/context add        (占位符)
/k/context update     (占位符)
/k/context remove     (占位符)
```

#### 4. 项目映射机制
**支持 worktree 自动映射**：

```bash
sodex-web          → library/sodex-web/  ✅
sodex-web-stake    → library/sodex-web/  ✅ 自动映射
sodex-web-network  → library/sodex-web/  ✅ 自动映射
```

**效果**：
- 所有 worktree 访问同一份 context 数据
- 无需配置，自动识别
- 数据一致性保证

#### 5. 目录结构修复
- ✅ 删除嵌套的 `.cursor` 目录
- ✅ 确保正确的结构：`library/sodex-web/{history,reference,context-index.json}`

---

## 系统状态

### 目录结构
```
soso-kit/
└── .cursor/kit/
    ├── context/
    │   ├── context-lib.sh      # 核心函数库 v2.0
    │   ├── README.md            # 使用文档
    │   └── CHANGELOG.md         # 本文件
    └── library/
        └── sodex-web/
            ├── context-index.json  # v2.0 (module-based)
            ├── reference/
            │   ├── vault/
            │   ├── stake/
            │   ├── network/
            │   ├── points/
            │   └── shared/
            └── history/
                ├── vault/
                ├── stake/
                ├── network/
                ├── points/
                └── shared/
```

### 索引文件变化（v2.0）

**新增字段**：
```json
{
  "meta": {
    "version": "2.0",
    "structureType": "module-based"
  },
  "reference": {
    "feature-id": {
      "module": "vault",      // 新增：功能模块
      "type": "feature"       // 新增：类型标签
    }
  },
  "indexes": {
    "byModule": {...}         // 新增：模块索引
  }
}
```

---

## 下一步计划

### 短期（v2.1）
- [ ] 实现 `context_add` 命令
- [ ] 实现 `context_update` 命令
- [ ] 实现 `context_remove` 命令

### 中期（v2.2）
- [ ] 集成到 `k/check` 命令（自动更新 context）
- [ ] 添加 context 验证工具
- [ ] 支持批量导入历史文档

### 长期（v3.0）
- [ ] AI 自动生成 quickRef
- [ ] 语义搜索支持
- [ ] Session 聚合（按天/任务）
- [ ] 跨项目索引合并查询

---

## 迁移指南

### 从 v1.0 升级到 v2.0

**步骤1：备份数据**
```bash
cp -r .cursor/kit/library .cursor/kit/library.backup
```

**步骤2：迁移目录结构**
```bash
# 根据功能模块重新组织文档
# components/ → 按实际功能分到 vault/stake/network/points/shared
# features/ → 同上
# infrastructure/ → 移到 shared/
```

**步骤3：更新 context-index.json**
```bash
# 添加 meta.version = "2.0"
# 添加 meta.structureType = "module-based"
# 将 category 改为 module + type
# 添加 indexes.byModule
# 更新所有 historyPath
```

**步骤4：测试验证**
```bash
/k/context list          # 验证查询正常
/k/context load <id>     # 验证文档路径正确
```

---

## 技术决策

### 为什么选择方案4（只读 + 主仓库更新）？

✅ **优势**：
- 单一数据源，避免冲突
- 权限清晰，审计友好
- 数据一致性保证

⚠️ **权衡**：
- Worktree 无法直接贡献数据
- 需要切换到主仓库才能更新

**结论**：对于文档管理场景，数据一致性优先级高于便利性。

### 为什么使用功能模块而非技术分类？

✅ **优势**：
- 符合业务视角（产品经理/开发者都按功能思考）
- 查找更直观（想找 vault 就去 vault 目录）
- 符合团队分工（不同人负责不同模块）
- 扩展性好（新增模块时清晰独立）

**示例对比**：
```
技术分类：想找 Vault Deposit → 先判断是 feature 还是 component → 再搜索
功能模块：想找 Vault Deposit → 直接去 vault/ 目录查找 ✅
```

---

最后更新: 2026-02-15
