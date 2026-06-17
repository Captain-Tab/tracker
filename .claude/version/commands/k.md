---
module: k
type: commands
version: "2026-06-17"
released: 2026-06-17
versioning: date
status: active
source: .claude/commands/k/
---

# Commands Changelog

记录 `/k/` 命令的变更历史。

> 版本约定：本模块按发布日期版本化（`versioning: date`），第一个 `## [YYYY-MM-DD]` 即当前版本。

---

## [2026-06-17] 新增 /k:cowork 多会话协同看板命令

### Added
- **`/k:cowork` 命令**：多会话基于一份 spec 协同开发，以磁盘看板(SSOT)做统一信息源。子命令 init(建板拆块) / pickup(进会话认领块+对齐分支命名 `fix/<topic>-<块ID>`) / handoff(出会话决策进度落盘)。
- **仿 /k:cp 机制**：`kit/cowork/cowork.sh` 按子命令名 cat `prompts/{init,pickup,handoff}.md`；看板模板 `kit/cowork/templates/board.md`(底座区/底座变更日志/任务分解/决策日志/进度坑)；运行实例放 `spec/cowork/<topic>.md`。
- **底座可演进**：底座区放摘要+spec源链接(不复制全文)，后期需求微调走「底座变更日志」+ pickup 过期校验，防基于过期底座干活。

### 设计决策
- 守「瘦」：会话由用户手动开，命令只管进出、不自动 spawn——否决「claude --bg 多实例编排」重型方案(伪需求：单会话 context 够用；数倍 token；headless 非交互 dispatch 命令未坐实)。解决信息源/命名混乱，非 context 容量。

---

## [2026-06-16] /k:check 预审 subagent 沙箱铁律

### Fixed
- **预审 subagent 误删真实目录**：旧 prompt 一句「测完别污染 `.claude/kit/spec/`」反而诱导 subagent 在该目录里 `rm -rf` 验证目录创建，连带删除无关的 `spec/scripts/{complexity-score,context-preflight}.sh`。
- 在 `kit/check/templates/subagent-prompt.md` 「# 硬规则」段新增最高优先级「沙箱铁律」：破坏性操作只能针对 `/tmp` 临时物或 subagent 本次自建文件；**禁止对任何未创建的真实目录 `rm -rf`**（尤其 `.claude/` 子目录）。自解析仓库路径的脚本允许在仓库内跑，但只能逐个 `rm` 自己生成的文件。

### 设计决策
- 根因在 subagent prompt 措辞（根因 C/B），而非检测缺失——故修源头 prompt，**不**给 /k:check 加 post-condition git 复查守卫（症状补丁 + 误报风险 + 增重，被否决）。

---

## [2026-06-16] 新增 /k:draft 需求草稿骨架生成

### Added
- **`/k:draft` 命令**：一条命令生成结构化空骨架 md 到 `.claude/kit/spec/`，省去手动建文件，填完直接丢给 /k:spec。
- **仿 /k:cp 机制**：骨架是独立模板文件 `kit/draft/templates/{core,ui,api,bugfix}.md`，`draft-create.sh` 只负责复制 + 替换 `<SLUG>`——改骨架直接编辑模板 md，无需动脚本。
- 5 种类型：`feature` / `bug` / `ui` / `api` 单文件平铺（`YYYY-MM-DD-<slug>-<type>.md`）；`complex` 三文件进 `spec/<slug>/`（核心 + ui + api，对标 airdrop）。
- type 必显式；缺 type/slug 回显用法；已存在不覆盖（`ALREADY_EXISTS`）；`bugfix` 为 `bug` 别名。

### 设计决策
- 守「瘦」：只生空骨架，不预填、不校验、不动 /k:spec 核心流程——按需生成、用完即改、零常驻负担（区别于被否决的「静态维护表单」方案）。
- 骨架去掉「复杂度信号」（评分由 /k:spec 自跑）与「验收场景」（spec 阶段补）；ui 的 figma 映射拆 PC / Mobile 上下结构、字段名 `figma-node-id`，手写友好弃用表格。

---

## [2026-06-16] /k:spec 形态分发瘦身收敛

### Changed
- **形态判定回归人工主导**：分解度三判据从「机械门（全中才 spec-set）」降级为「**辅助核对、可 override**」；一眼可判的（≥3 交付面 / 多 figma / 跨组件状态机）直接定 spec-set。对齐 airdrop 实证（人眼判而非评分门）。
- **子件 "写到够开工" 取代 "裸 stub + 全 JIT"**：子件在设计期填到 design-complete（结构 + figma node + 场景 + i18n key），落地阶段精修；不预先 author 全部细枝末节、也不留空骨架。
- **显式 2 条 load-bearing 规则**：「总纲先于子件」+「code-grounded 校验（独立 subagent 对照代码查遗漏/丢失/模糊）」——固化精准度的真正来源。
- 幂等表述收敛为「增量 refine」；落地衔接措辞从「JIT 补全 stub」改为「逐阶段消费 + 精修」。

### 设计决策
- **不立 6 段 SOP 重文档**：分析裁定重 SOP 不提升需求精准度——精准度活在「模板（结构完整/消歧）+ code 校验（抓遗漏）+ 人工判断 + 少数排序规则」，重 SOP 只是复述这些杠杆，且带合规幻觉 / 僵化 / 维护漂移负效应。
- 可复用核心 = 2 个模板（overview/subspec）+ 8.6 精简原则 + 必需机械修（Step0 找得到 spec-set、幂等），其余仪式砍除。

---

## [2026-06-15] /k:spec 新增形态分发（spec-set 模型）

### Added
- **Step 8.6 形态分发**：在 complex 档内追加「分解度三判据」（可切分 / 独立可验收 / 共享契约），全中 → spec-set，否则 → 单文件 complex spec。难度轴（分数）与形态轴（结构）正交。
- **两个新模板**：`spec-overview-template.md`（spec-set 总纲 SSOT，含状态机 DU 锁定 + 共享契约 + Phase0 + 子件依赖拓扑图）、`spec-subspec-template.md`（子件，引用总纲、冲突以总纲为准）。
- **`spec-template.md` 实现蓝图段**：complex 单文件必填 4 保真机制（状态机 DU / 共享契约 / 复用件清单 / 行号集成点），medium 按需。

### Changed
- **工具链痕迹自审分层**：强删仅对 simple/medium；complex 是实现蓝图，跳过该检查（工具链内容是其载荷）。
- **路由表**：complex 单文件 → /k:plan；complex spec-set → 逐阶段 /k:task（总纲拓扑替代 plan，不走 /k:plan / /k:clarify）。完成节新增「形态」行。
- **spec-set 轻物化（A'）**：8.6 物化从「一次性 author 全套」改为「**总纲全填 + 子件 stub + 落地 JIT 补全**」——子件细节（figma / 场景 / i18n）拖到该阶段由 /k:task、/k:figma 补全。对齐 airdrop 实证（总纲早定、子件晚补）。
- **Step 0 auto-load**：新增扫描 `*/00-overview.md` 识别已展开 spec-set，只加载总纲、子件按阶段按需读（防 context 膨胀）。
- **幂等**：8.6 物化前探 `<feature>/00-overview.md` 是否存在 → 存在则 refine 总纲，禁止重新展开覆盖已补子件。
- **评分路径**：已展开 feature 的评分调用指向 `spec/<feature>/`（绕开 `-maxdepth 1` 局限；脚本不改）。

### 设计决策
- 不新增 ultra-complex 难度档——难度是连续量，再切线必任意；spec-set 是「分解度高」而非「难度高」，挂在正交的形态开关上。
- 形态判定本质 = 「能否组织成 阶段→check→commit→gate 串行流水线」，源自 airdrop 4 弹窗 spec-set 的高还原度实证。
- spec-set 总纲不受 spec-lint REQUIRED_SECTIONS 约束；子件兼容。
- **职责正交**：clarify 只管「查代码 + 消歧 + 补遗漏」（产一份完整设计、零结构改动）；spec 独占评分 / 形态决策 / 分解 / 物化。物化晚于评分，故 clarify 不产 spec-set。

---

## [2026-06-14] /k:cp 新增 devpanel 片段

### Added
- **`/k:cp devpanel`**：生成开发预览面板（dev panel）的指令片段——为指定 feature 扫描「弹窗 × 状态」全集，生成常驻 FAB 入口，一键弹出各状态看样式。参照 AirdropDevPanel 模式（生产守卫 + 悬浮 FAB + entry 列表 + Dev 包装组件）。

### 设计决策
- 状态枚举机械取全集（grep open* + 内部 status / scene union），含命名约定兜底，禁凭印象。
- 如实标能力边界：依赖 live hook / mutation 结果且无法静态 mock 的状态，标注不硬造（实测 referrals ClaimRewards success 态即此类）。
- 适用判断按「状态是否难到达 / 是否反复调样式」而非弹窗数量——小 / 单弹窗同样支持。

---

## [2026-06-13] /k:distill 新增 Phase 1.5 跨报告趋势对比

### 背景
distill 原流程只把"本期信号"穷举裁决，但用户多次追问"最近哪些在提升、哪些在倒退"。之前依赖人工口算，结果靠模糊形容词（"略升 / 大幅下降"）而非硬数字。根因是缺少一个把两份 insight 报告的数字对齐成可核查表格的强制步骤——以及一个核查"上期 distill 决策是否兑现"的反馈闭环。

### Added
- **distill.md Phase 1.5**：新增「跨报告趋势对比」步骤，紧跟 Phase 1（信号穷举）之后、Phase 2（查重）之前——这份 diff 作为后续裁决的输入证据
  - 强制抽取 7 类硬指标：头部统计（含 commits）/ 摩擦类型 top6 / 工具错误 top6 / 达成结果 / Top 工具 / Multi-Clauding / Fun ending
  - 强制规则：每行结论必须挂 `上期→本期` 数字，禁止「略升/显著下降」无数字描述
  - 必须读取上期 `docs/distill/distill-<PREV_DATE>.md`，核查"建议创建/扩展"与"待证据"项是否兑现（决策→效果闭环）
  - 三段硬结论：✅ 提升 ≥3 / ⚠️ 倒退 ≥3 / 🔁 评估系统重复信号
- **distill.md Phase 6 报告模板**：新增「五、跨报告趋势」章节（硬指标表 + 提升 + 倒退 + 重复信号 4 子节）
- **distill.md 设计目标**：补充"基于两份报告真实数字给出'最近提升 vs 倒退'硬证据对比"职责
- **distill.md 收尾回贴**：扩展至「摘要 + 完整性自审 + 五、跨报告趋势的提升/倒退」

### 验证
本期实跑（基于 insight 2026-06-13 vs 2026-05-28）产出 27 行硬指标对比表，覆盖 commits 16→37、output_token_limit 6→6、Skill 191 新入 top tools 等数字。意外收获：暴露出**评估系统在 fun-ending 处连续两期使用完全相同的例子**——这条信号在原流程里会被静默丢弃，新 Phase 1.5 显式化为 🔁 类结论。

---

## [2026-06-10] /k:figma 弹窗还原盲区修复（宽度 / 渐变描边 / 文本对齐）

### 背景
弹窗类设计稿还原存在三处系统性失真：弹窗宽度被「忽略容器 width/height」当容器尺寸丢弃而落默认值（`w-100`）；`fills` 渐变 + `strokes` 渐变的半透明 fill 翻成 CSS 时 border-box 渐变渗透整卡（亮金实心）；文本对齐用父容器 `justifyContent` 推断而非读文本节点 `textAlignHorizontal`。根因是翻译规则对「弹窗宽度 / 渐变描边 / 文本对齐」三处各有盲区。

### Added
- **figma.md Step 5**：新增 5.3 弹窗内容组件 width 特例（读 frame `dimensions.width` → shell `classes.content`，禁止套默认）、5.4 渐变描边三层 background（半透明 fill 必补不透明父级底层，否则渗透）、5.5 文本对齐按节点 `textAlignHorizontal`
- **kit/projects/sodex-next/patterns.md**：§modal 增「宽度 = Figma frame `dimensions.width`」规则；新增 §gradient-card 渐变描边卡模式（命中条件 + 三层 background 片段 + backgroundColor 无效说明）
- **kit/projects/sodex-next/style-checklist.md**：自检增 3 条（弹窗宽度=frame width / 渐变卡有不透明底层 / 文本对齐按节点）

---

## [2026-06-09] /k:check verify.sh 在非 satrack 项目自动跳过

### 背景
`.claude/kit/check/verify.sh` 调用 `lint-track.mjs` 时硬读 `src/shared/track/__fixtures__/sensors-event-schema.sample.json`。soso-kit 自身仓库不含 `src/` 目录（属于发布源仓库，非业务项目），导致每次在 soso-kit 跑 `/k:check` 都 FAIL，错误与 PR 内容**零关联**。根因是把"发布源仓库"和"被发布到的目标项目"两类上下文混淆。

### Fixed
- **verify.sh**：用 `[ -f "src/shared/track/eventContract.ts" ]` 条件包裹 satrack lint 调用
  - soso-kit 仓库 → 文件不存在 → 自动跳过，`/k:check` MECHANICAL 不再被无关 FAIL 污染
  - sodex-next 等集成 satrack 的业务项目 → 文件存在 → 正常触发 lint
  - 半集成项目（contract 在但 fixture 缺）→ 仍 FAIL，由 lint 自己负责报错，符合"机械验证"职责边界

### 影响
- `/k:check` 在 soso-kit 自身仓库的 MECHANICAL 结论从恒 FAIL 变为正常 PASS（无相关改动时）
- 业务项目侧行为不变

---

## [2026-06-08] 新增 /k:codex 审核核验命令族

### 背景
Codex 在 PR 上自动审核后，人工逐条核验真伪/归属每次都要重踩取数细节（401 token 坑、`codex-pr-review` 评论标记、多 reviewer 行内评论），且误报率不低。固化为命令：脚本管确定性取数 + 监听，AI 管四步漏斗核验。

### Added
- **/k:codex `[PR] [--list-only] [--fix]`**：取数（Codex 总结 + 多 reviewer 行内评论）→ 确认 codex_review 就绪 → 对 **Critical + High** 跑四步漏斗（真伪闸→相关性 git diff→历史 git blame→风险，Critical 优先）→ 二选一终局（不需修给依据 / 需修给方案等确认）。**只核 Critical + High，Med/Low 不输出；完全不管其它 CI（不读日志、不刨根因）**。结尾无条件主动门（Q 样式）。仅终端展示，不回贴 PR。
- **无 Critical/High 短路（Step 3.5）**：Critical + High 合计=0 时跳过四步漏斗与主动门，直接给 `✅ Codex 审核通过` 提示并结束——干净 PR 的最短路径。
- **输出样式**：L 段落锚点 + 每条 Critical/High 用**顶底开口框**（`┌─ 编号·严重级·判定·标题 ─` 开顶 / `└──` 收底，**内容行无任何左竖线**，顶线标 `🔴Critical`/`High`）+ Q 反问门。换行硬纪律：禁用左竖线（树形/竖线框换行必断列的病根）、字段压 1 行超长手动挂缩进、顶线标题精简不顶满宽。
- **/k:codex-on `[PR]`**：后台 run_in_background 轮询（0–5min 不查 / 5min 首查 / 每 5min / 20min 后每 3min / 30min 超时），完成后自动跑四步漏斗并播报；等待期 0 token。
- **/k:codex-off `[PR]`**：停 watcher 清 PID marker，幂等。
- **脚本拆两支**：`kit/codex/scripts/codex.sh`（detect-pr / fetch）+ `codex-watch.sh`（watch / watch-stop / watch-list）。

### Changed
- **CI 噪声根因修复（脚本层）**：症状是 /k:codex 反复输出「🔴 CI 失败」段，prompt 层加再多禁令都压不住。真根因——`codex.sh fetch` 把 `gh pr checks` **全量 CHECKS（含 check/pr_quality=fail）喂进模型上下文**，叫模型「看见却装没看见」。改为 **CHECKS 段只输出 `codex_review: <bucket>` 一行**，其它 CI 不喂入；codex.md 的 CI 禁令旁注随之精简（保留「禁 gh run view 主动拉日志」）。教训：先问「数据从哪进上下文」，别在 prompt 层打补丁。
- **修漏核高危（教训）**：本命令早期迭代曾「只核 High」，会把 Codex 的 **Critical（最高级）连同 Med/Low 一起静默丢弃**——已修为 Critical + High 两级都核、Critical 优先（见 Added）。记此防再犯。
- **真伪闸硬约束**：构建/typecheck/lint 类 finding 必须实跑真实工具复现，禁止纯静态推理下「成立」结论（跑不出=误报）。`[推理]` 仅可用于风险判断，不可用于「问题是否成立」。
- **新增 Step 4.5 修复回归闸 + 落地后路由**：落地 fix 强制回归三连——① 改前实跑复现 ② 改后全量验净（0 新增报错）③ 验生效（--showConfig diff / 行为探针）；若证明是 no-op 必须标注「冗余/防御性」不得谎称修复。
- **落地后路由（失败模式分流）**：按 fix 失败模式分流——编译期可判定（config/类型/import）走 commit 路；运行期语义（逻辑/控制流/错误处理）走 check 路额外做独立语义复审（SUBAGENT+MAIN）。**②验净路由无关、永远自己跑合适工具**（不外包给 /k:check 的 verify.sh——它是项目级、可能不含 tsc，外包会漏验）；判定给依据 + 用户可否决；终点都是 commit 建议不自动提交。
- 起因：实跑发现 moduleResolution=bundler 隐含 resolveJsonModule，Codex「JSON import 致 tsc 失败」静态推理在本环境根本不复现（误报），且差点落地一个 no-op 改动当「修复」。

- **Step 3 解析守卫（防假通过）**：codex_review=pass 必然已发总结，据此区分「真 0 Critical/High」与「没解析到」——CODEX_SUMMARY 段为空判取数异常（标记变更等），停止并提示，禁止伪装成「审核通过」短路。成功卡显式标注「总结已解析 / Critical+High 0 条」。

### 设计决策
- 取数与监听确定性逻辑收进脚本，四步漏斗判断留给 AI；结论纪律复用 `cp/prompts/gate.md` + `ship.md`（指向行号、决策门）。
- 完成判定用 `contains("codex_review")` 兼容跨仓 check 名（sodex-web `codex_review` vs sodex-next `codex / codex_review`）。
- watch 不写进 codex.sh，独立 codex-watch.sh；临时目录 `${TMPDIR}/codex-watch`（无前缀）。

---

## [2026-06-01] /k:analyze 收集阶段增强（依赖扫描 / 成对缝隙 / 对抗核验）

### 背景
连续两次 appkit→privy 跨项目分析中暴露 /k:analyze 收集阶段三处缺口：① 只扫 `src` 行为、漏 `package.json` 维度（"@privy-io/wagmi 已装未接线"靠事后 grep 才发现）；② 成对分析的承重事实（下游 join 键）落在两份文档缝隙无人认领；③ 内置核验偏"确认"，第一遍 walletList 逻辑 bug 被漏过、靠对抗复审才抓到。三处均属"收集是否充分/准确"，不越界到方案设计。

### Added
- **Step 2.5 依赖接线扫描（条件触发）**：模块 import 第三方 SDK 或用途=迁移参考时，主 agent 读 `package.json` + grep 接线状态，产出章节 8「依赖与接线状态」。硬边界：只收"装没装/在哪接线/是否使用"事实，禁写 SDK 用法（否则违反 HARD-GATE 3）。
- **Step 1 Q5 对照对象**：成对分析时收录"对照侧将依赖的承重事实（join 键）"，仅收事实、禁下对照结论。

### Changed
- **Step 5 核验改对抗式**：证伪导向（默认假定有错）；抽样量按复杂度浮动（简单≥10 / 复杂≥18，最复杂子文档占比≥40%）；主 agent 修正前必须二次核实，禁止照单全收（防过度证伪引入新错）。
- Step 1 标题「最多 4 问」→「最多 5 问」。

### Fixed
- 章节 8 执行归属：明确由主 agent 事后追加，不占用 Step 3 分析 agent（修复初版未指定执行者的漏洞）。

### 设计决策
- 三改严格限定在"收集"职责内，不触碰迁移/方案设计（那是 /k:spec/人工的事）；新增约束均为 HARD-GATE 3 的强化而非新红线，保持"规则层少而精"。

---

## [2026-05-31] 新增 /k:cp 快捷 prompt 库

### 背景
高频重复输入「质询/审查」类 prompt（提交前审查、执行前确认），需要一键调用写死的 prompt 避免重复敲。比选 D 文本扩展器 / A 带参数 / B 多命令后，定为「一个命令 + shell 按文件名精确分发」，消除 AI 软判断选错参数的失败点。

### Added
- **`/k:cp <name>`**（新命令）：`.claude/commands/k/cp.md` 薄壳调用 `.claude/kit/cp/cp.sh`，按文件名精确 cat `prompts/<name>.md` 注入为本轮指令；空参 / 未命中列出可用片段。
- **片段 `ship`**：提交前审查改动 → 给「可 / 不可提交 + 阻断项」。
- **片段 `gate`**：执行前审查方案 / 判断 → 决策门（有风险停下确认、无风险说依据后执行）。
- **`better/text-expander-option.md`**：D 方案（espanso 文本扩展器 + 配置进仓库软链的杂交解）存档，备以后启用。

### 设计决策
- **shell 分发而非 AI 分发**：片段选取由 `cp.sh` 按文件名精确匹配，不让 AI 读正文猜，对齐 kit「机械锚点替代 AI 自判」原则。
- **脚本抽离**：逻辑进 `cp.sh`（不进 context、仅输出进），命令正文缩为一行调用——对齐房子风格 + 高频命令每次注入更省 token。
- **加片段零成本**：往 `prompts/` 丢 `.md` 即新增，命令与脚本不动。

---

## [2026-05-31] CLI 输出模板拆分（decision / describe 双库）

### 背景
`docs/cli-output/output-styles.md` 原本混装两类输出样式：① 决策/裁决/状态/反问/字段呈现（AI 给结论），② 流程/结构图解（AI 画流程）。后者需求在 study 报告"核心流程"等场景凸显，但原库几乎只覆盖前者。按"一库一职责"拆分。

### Changed
- **`output-styles.md` → `decision-output-template.md`**（git mv）：定位收敛为"决策类输出"（裁决/状态/反问/字段），标题与导语更新，加配套指引指向 describe 库。
- **活引用同步**：`clarify.md:311`、`spec.md:200/261` 的样式参考路径更新为新文件名（历史 changelog 内的旧路径保留不动）。

### Added
- **`describe-output-template.md`**（新增）：流程/结构图解 ASCII 模板库，纯文本不依赖 Mermaid。10 种样式 A–J（顶层状态机框 / 纵向管道 / 分路径 / 横向紧凑 / 分层栈 / 树形分解 / ASCII 时序 / 状态转移表 / 产物旁挂 / 对比双栏），含总览表、选型决策树、与 decision 模板搭配表、反模式、符号约定。由先前 study 核心流程 A–D 草案扩充而来。

### 设计决策
- **decision vs describe 正交**：decision = "给结论/状态/问题"，describe = "画流程/结构"，编号空间各自独立（decision A–Q / describe A–J），引用带库名消歧。
- **describe 全 ASCII**：终端/GitHub/编辑器通用，不绑 Mermaid 渲染环境，与 soso-kit 既有分析文档风格一致。

---

## [2026-05-30] 新增 /k:distill + /k:check 加同级模式扫描

### 背景（insight 驱动）
`/insights` 报告对 skill 库失明，会建议新建已存在的命令（实测 5/28 报告：建议建 `/k:analyze`、`/k:migrate` 均已存在）；且两份报告复现「修复漏改同级」（claim/unstake/withdraw 弹窗只改一处）。据此沉淀两件资产。

### Added
- **`distill.md`**：读取 `docs/insight/` 最新报告，套用 Codex 自我工具化提示词 + 资产查重 + 准入门槛 + 完整性自审，输出"扩展/新建/skip"决策到 `docs/distill/distill-<date>.md`。纯 prompt 零脚本；Phase 1 穷举登记 + Phase 5 去向核对 N/N 保证无遗漏。实测 5/28：8 条建议过滤后真空缺新建 0，收敛为扩展 2 + 规则强化 1。

### Changed
- **`review.md` Step 4 完整性**：新增「同级平行实现扫描」子检查——grep 复制粘贴式同款 pattern（弹窗家族、多 wrapper/hook）的其他文件，确认漏改邻居；与 Step 7 grep 调用方区分（平行同款 vs 下游调用方）。自然走 COMPLETENESS→VERDICT，无新增报告仪式。直击两份 insight 复现的「漏改邻居」摩擦。（注：初版误放 check.md 编排层，违反其「审查逻辑单一来源在 review.md」原则，已回退重置到 review.md）

---

## [2026-05-30] /k:plan 编译自洽批次 + /k:task tsc 去重：消除接口跨批返工

### 背景（实测驱动）
真实 trace：一次 portfolio task 含返工——`PnlChart` 改 7 次 / `ViewModel` 改 5 次 / tsc 9 次（3 次报错）。用 jsonl timestamp 归因后推翻「tsc 是瓶颈」的直觉：AI 实际工作 44.6min 里 85% 是模型生成、仅 7% 是工具执行，**慢的真因是 tool 轮次太多，主源是接口跨批返工**——「接口契约生产者（删字段/改签名）与消费者被拆到不同批次 → 中间态 tsc 必报错 → 回改」。

### Changed
- **`plan.md` Step 3.5**：批次划分从「按概念阶段（infra→container→ui）」改为「**按编译自洽单元**」——识别接口契约改动的生产者，grep 出全部消费者，**强制同批**；阶段边界与编译自洽冲突时编译自洽优先。Step 4 B 自审表加「批次编译自洽」闸门（消除旧表「对齐阶段边界」的矛盾表述）。
- **`task.md` Step 3**：加 tsc 去重硬规则——tsc 通过后无新增 Edit/Write 禁止重复跑；例外2 修完只验 1 次。砍「绿后反复确认」的冗余轮次，**不减验证强度**。

### 验证（真跑同一 portfolio 需求，3 批次）
- tsc **9 → 4 次**；接口跨批返工 **消除**（ViewModel 卸 chart 链 7 处 Edit 同批一次过，无回改循环）
- 编译自洽批次把 `spotPnl` / chart window 两条接口契约链各自捆同批，CHECKPOINT 一次绿

### 适用边界（诚实标注）
- 编译自洽批次价值**绑定「有编译期类型检查」的项目**（TS/Go/Rust/Java）；动态语言（纯 JS/Python 无类型）无中间态报错，价值降低。

### 撤回记录（规则归属教训）
- 真跑中暴露的「i18n 加 key 未 codegen → tsc 报错」**曾尝试加进 task.md + sodex-next 规则，后全部撤回**：该问题是 sodex-next 项目级（typed-i18n 工具链），根因在项目 package.json，**不属 soso-kit 通用层**。教训：项目特定现象即使在真跑中暴露，也不进通用规则层——一条优化进 soso-kit 须过「跨项目通用 + 现有机制未覆盖 + 根因在 soso-kit 自身」三关。

### 方法论记录
- 全程用 jsonl timestamp / 原始 trace 归因，三次「凭片段推断」被 ground truth 纠正（理论分析说耗时在 Read→实测几乎无 Read；怀疑 TaskCreate 被跳→翻 jsonl 证明 18 条都建了；说「无优化空间」→拆出返工真源）。印证「反 AI 记忆作 ground truth」。

---

## [2026-05-30] /k:spec 复杂度评分 R3 红线收窄：金额展示函数移出，止住误升 complex

### 背景（实测驱动）
真实 trace：一次 portfolio 图表 plan 耗时 4m17s。核对发现耗时是「complex 档一次生成 212 行 plan-temp（含 Draft + 5 信号全套）」的 **token 生成时间**，非 IO。根因：`complexity-score.sh` 的 R3 金额红线把**展示/格式化函数**与**金额写入/转账**混为一档，任何带数字展示的前端任务都被红线顶成 complex，触发本无价值的重工序（步骤依赖明确时 5 信号合并价值≈0）。

### Changed
- **R3 红线（L95 grep）收窄为保守档**：移出纯展示函数 `toFixed(` / `floorToDecimal` / `formatUnits`（降为不计红线）；保留 `BigNumber` / `BigDecimal` / `big.Float|Int` / `shopspring/decimal` / `decimal.Decimal` / `calculate(` / `parseUnits` / `DECIMAL(` DDL。
- 同步更新 R3 注释块，标注「展示函数不计红线」的语义边界。

### 验证（回归实测）
- 展示型 spec（toFixed/floorToDecimal/formatUnits）→ `REDLINE=none`，按 score 评分（不再误升）
- 写入型 spec（parseUnits 构造转账）→ `REDLINE=money-precision` → 仍 complex（资金写入拦截零削弱）

### 已知边界（诚实标注）
- 保守档**保留 `calculate(`** 在红线：前端纯展示若用 `calculate(` 仍会升 complex。本次未动，需要时可再升「平衡档」移出。
- 静态 grep 无法 100% 区分 calculate 的展示 vs 转账用途——这是召回率/误报率权衡，取保守优先安全。

### 方法论记录
- 两次「凭片段推断」翻车并被 ground truth 纠正：① 理论分析断言耗时在 Read/取证 → 被 trace 推翻（实际几乎无 Read，是生成密集）；② 怀疑 TaskCreate 被跳过 → 翻原始 jsonl 证明 18 条都建了，是折叠视图错觉。印证「反 AI 记忆作 ground truth」：分析「为什么慢/有没有跳步」必须看 tool 调用序列与原始 trace，不能读 .md 想象执行路径。

---

## [2026-05-28] /k:commit 新增拆分判定：候选触发 + 精细聚类 + 多 commit 输出

> 目标：把「巨型改动建议拆 commit」从单行口号升级为可执行的多 commit 建议，灵感来自 awesome-claude-code 研究结论。

### Added

| 文件 | 变更 |
|------|------|
| `commands/k/commit.md` | Step 2.5 拆分判定：4 条候选触发条件（跨 ≥3 顶层目录无共享 / feat+deps 混合 / dead code + feat 共存 / -U0 > 400 行）+ 3 条保守阈值（doc/test 与 feat 配套不拆 / 单一主题多文件不拆 / 改动 < 100 行不拆）。|
| `commands/k/commit.md` | Step 2.5 精细聚类规则：候选触发后按 `package.json+lock` → `chore(deps)`、纯 `*.md` → `docs`、整文件纯 `-` → `chore/refactor`、其余 → 主功能组聚类；最后做 import 共享依赖检查避免错拆。|
| `commands/k/commit.md` | Step 2.5 内部判定输出 JSON schema：`split_suggested` + `reason` + `groups[]`，供 Step 3 分支使用。|
| `commands/k/commit.md` | Step 3 输出格式分两支：分支 A 单 commit（保持原格式）；分支 B 多 commit（`Commit 1/N ... N/N` + 每组独立 `git add <files>` + `git commit -m '...'` + 末尾给单 commit 备选命令）。|
| `commands/k/commit.md` | Step 3 加多 commit 时 `git add` 必须列具体文件路径的硬规则（禁止 `-A`，否则会带上其他组的改动）。|

### 设计要点

- **拆分永远是建议非强制**：分支 B 末尾始终给「单 commit 备选」命令，用户可忽略拆分直接合并提交。
- **双层判定结构**：numstat + 路径硬规则只触发候选；最终决策仍读 `-U0` 内容看 import 共享依赖，避免硬规则误伤同一主题的跨目录改动。
- **保守阈值优先**：doc/test 与配套 feat 默认不拆（属配套关系），多文件单主题不拆——宁可漏拆也不要错拆。
- **零额外采集成本**：Step 2.5 完全复用 Step 1 已采集的 numstat + stat + -U0 内容，无需额外 git 调用。

### 已知限制（首发实测发现）

- ~~**欠拆中等粒度场景**：「2 个独立模块各自单主题」场景未覆盖~~ → **同日修订（见下条）**：候选触发由「≥ 3 顶层目录」改为「≥ 2 个独立模块」，覆盖本场景。
- **`-U0` 总行数判定不含 untracked 文件**：新增文件不出现在 `git diff` 中（仅 status），改动量评估可能偏小。客观分析后判定**暂不修复**——常见 untracked 场景（doc / test 配套）已被保守阈值 + 精细聚类正确处理，硬改阈值边际收益 < 5%，违反 YAGNI。
- **暂未覆盖 hunk 级拆分**：同文件混合多主题（一半 feat 一半 chore 清理）仍被判为单文件单 commit，建议用户自行 `git add -p`。

### 与 /k:check / /k:review 的关系

- `/k:review`：**未改**——纯审查职责，与 commit 拆分解耦。
- `/k:check`：**未改**——经二次审视后撤回原集成提议。理由：(1) `/k:review` 不输出「分组」信息，所谓「上下文注入」实为凭空多做一轮分析；(2) `/k:commit` 已基于 -U0 内容做语义判定，审查输出对分组无增量信息；(3) 集成会破坏 `/k:commit` 的纯函数属性，相同 diff 产生不同输出 = 可预测性丧失。

---

## [2026-05-28] /k:commit 拆分判定阈值调整（同日二次修订）

> 基于首发实测「欠拆 2 模块场景」的针对性修复。本次只动一处规则，其他逻辑不变。

### Changed

| 文件 | 变更 |
|------|------|
| `commands/k/commit.md` | Step 2.5 候选触发条件 1 由「改动跨 ≥ 3 个顶层目录」改为「改动跨 ≥ 2 个独立模块」。新增模块定义脚注：模块 = 第一级有功能含义的目录（如 `src/auth/` 与 `src/api/`、`commands/k/` 与 `kit/study/`），同 monorepo 下 `.claude/` 等单一外壳层不计。 |
| `commands/k/commit.md` | 新增说明段：解释「2 模块」与「3 顶层目录」的差异，强调误拆风险靠保守阈值 + import 共享依赖检查兜底。 |

### 设计要点

- **降阈值不增加误拆率**：候选触发只是「进入精细判定的门票」，真正的安全网是**保守阈值**（doc/test 与 feat 配套不拆、多文件单主题不拆、< 100 行不拆）和 **import 共享依赖检查**（跨模块互相 import → 合并不拆）。这两条不动，2 模块阈值不会显著增加误拆。
- **基于观察而非猜想**：上一次 commit 的实测案例（`commands/k/` + `kit/study/` 各自单主题）直接命中本修订；非预防性优化。
- **撤回 /k:check 集成提议**：二次审视后判定为过度工程，不动 `/k:check` / `/k:review`。

### 决策记录

- ✅ **采纳**：阈值由 3 顶层目录降为 2 独立模块（本次修订）
- ❌ **撤回**：`/k:check` 注入审查上下文给 `/k:commit`（破坏纯函数属性、`/k:review` 不输出分组信息、收益场景到不了 commit 阶段）
- ⏸ **暂缓**：纳入 untracked 文件统计（边际收益 < 5%、实际有效场景罕见、违反 YAGNI）

### 预估影响

- 触发候选频率提升 ~30-50%（更多 case 进入精细判定）
- 平均每次 /k:commit 额外消耗 ~60-100 token（精细判定读 -U0 import 行）
- 误拆率预期不变（安全网已存在）

---

## [2026-05-27] /k:commit 瘦身：4 路信号 + -U0 内容 + 噪音排除 + 原子 HARD-GATE

> 目标：减少大改动场景的 token，同时机械防御「凭 AI 记忆跳过 diff」的反模式。

### Added

| 文件 | 变更 |
|------|------|
| `commands/k/commit.md` | Step 1 新增 `--numstat` 路信号——每文件 `+/-` 数字，**type 的零成本初判信号**（纯 `+` → feat/docs/test；`+/-` 接近 → refactor/fix；大量 `-` → chore 清理）。让 type 明显时可少读内容。|
| `commands/k/commit.md` | Step 1 引入 `-U0` 零上下文 diff，去掉默认 `-U3` 的 6 行上下文膨胀。零散小改动场景密度提升明显（~7x），大块改动场景节省较小（~1.3x）。|
| `commands/k/commit.md` | Step 1 加 18 类噪音文件排除清单（`*.lock` / `pnpm-lock.yaml` / `package-lock.json` / `yarn.lock` / `go.sum` / `Cargo.lock` / `composer.lock` / `Gemfile.lock` / `poetry.lock` / `*.lockb` / `dist/**` / `build/**` / `*.min.*` / `*.snap` / `*.map` / `*_generated.*` / `*.pb.go`）。stat 仍包含它们（用于识别 `chore(deps)`），仅内容采样剔除。|
| `commands/k/commit.md` | Step 1 加 HARD-GATE：四路信号（status / stat / numstat / -U0 内容）合并为**单一 bash 块原子产出**，机械防止 AI 凭 session 记忆跳过内容采样。修复实测发生的「跑完 stat 就停手」反模式。|
| `commands/k/commit.md` | Step 1 加「巨型改动建议拆 commit」条款：> 400 行 -U0 改动时优先建议 split 为多次原子 commit，而非强行总结。|

### Changed

| 文件 | 变更 |
|------|------|
| `commands/k/commit.md` | Step 1 从「`git diff HEAD` 全量输出」改为「4 路信号 + 排除噪音 + -U0 封顶 400 行」的设计。|

### 诚实评估（避免理想数字误导）

| 维度 | 真实表现 |
|---|---|
| **Token 节省** | 典型场景 **30-40%**（不是「3x 密度提升」那种戏剧节省）。最大头是噪音文件排除（**~95%** 当含 lockfile 变更时）+ 上下文压缩（**20-50%** 取决于改动是零散还是块状）。`-U0` 本身是锦上添花。|
| **准确性** | 常见场景 **95-98%** 准确；含 generic 单行改动（如 `return null` / `throw err`）的 commit 可能掉到 **85-90%**——失去周围函数名上下文。`hunk header @@ ... function xx()` 仍保留缓解。|
| **速度** | 多文件场景 bash 执行 **~3-5x 快**（单 pipe vs 旧版 per-file loop）；单文件几乎一样。|

### 设计要点

- **真正的优化突破口**不是「减小采样」而是「**提升每行的信息密度**」+「**用零成本信号代替部分内容读取**」。`-U0` 去掉无价值的上下文行；`--numstat` 给免费的 type 初判。
- **HARD-GATE 比节省更重要**：实测发现 AI 会跑完 stat 就停手凭记忆出 message——这与 `--fast 自作主张` 是同类反模式。合并 bash 块是机械防御。
- **职责分工**：`status` 看状态 / `--stat` 权威文件全集（含锁文件，定 scope）/ `--numstat` 零成本 type 初判 / `-U0` 内容只在必要时深读。

### 已知限制

- `-U0` 在 generic 单行改动场景丢失上下文，subject 质量可能下降。缓解：filename + numstat + hunk header 通常已够。
- 全局 `head -n 400` 在巨型 diff 时仍会截断尾部文件内容——但 stat/numstat 完整保留 → AI 知道哪些被截断，建议优先拆 commit。
- 排除清单是 best-effort，若项目用 `.gitattributes` 标 `linguist-generated` 应以项目配置为准。

---

## [2026-05-27] /k:task 修复：回退 TaskUpdate 合批，恢复进度面板 + 防早停

> 修复 05-24「TaskUpdate 合批」引入的回归：实测 simple 档无进度面板 + AI 把 hook reminder
> 误读为 stop signal 而早停。

### Reverted

| 文件 | 变更 |
|------|------|
| `commands/k/task.md` | 回退「TaskUpdate 合批（≤2min 累积到 CHECKPOINT 末批量 update）」——TaskUpdate 恢复每步即时执行。合批的真实节省微小却引发早停，得不偿失。token 节省的真正来源是删 plan-temp 复选框双写（保留）。|

### Added

| 文件 | 变更 |
|------|------|
| `commands/k/task.md` | 新增 Step 3.0「建立进度面板」HARD-GATE（条件触发）：medium/complex 复用 plan 阶段已建的 TaskCreate 列表，不重复创建；simple 档（跳过 plan）在此处 TaskCreate 建全部步骤。最终所有档位都必须有 task 列表。|
| `commands/k/task.md` | 新增 Step 3.2「防早停」HARD-GATE（全档位）：PostToolUse hook / reminder 不是 stop signal；task 列表有 pending 项必须继续；唯一合法停止 = 全部 completed + 末尾 CHECKPOINT 通过 或 ERROR 状态。覆盖 medium/complex 的早停风险。|

### Changed

| 文件 | 变更 |
|------|------|
| `commands/k/task.md` | Step 3.1 执行模式明确「旁白静默 + 进度可见」：不输出 prose 旁白，但每步**立即 TaskUpdate**（不合批、不延迟、不省略）。|
| `commands/k/task.md` | Step 2.5 移除「TaskUpdate 频率」列——VERDICT 仅控制 tsc 节奏 + EVIDENCE 强度，**不影响进度面板**。|

### 根因与教训

- **进度面板不是冗余**：TaskCreate（建列表）+ 每步 TaskUpdate（进度）是「进度可视 + 防早停锚点」双重载体。pending 项可见 = AI 的「继续」信号；删掉它，AI 失去结构性锚点，把 hook reminder 误读为停止。
- **优化目标选错**：初版把 TaskUpdate（~200 token/次，便宜且高价值）当冗余压缩，真正该压缩的是 plan-temp 复选框双写（update-step.sh）。
- **simple 档独特性**：simple 跳过 plan = 没有 plan 阶段的 TaskCreate，必须在 task.md Step 3.0 补建——这是 simple 档无面板的根因。

---

## [2026-05-24] /k:task 瘦身：接 VERDICT 分流 + 删 plan-temp 双写 + 验证节奏放宽

> ⚠️ 部分内容已被 [2026-05-27] 条目修订：本条初版引入的「TaskUpdate 合批」已回退，
> 并补充 Step 3.0 进度面板 + Step 3.2 防早停。下文 Step 3.1 / 设计要点 / 影响表中涉及
> 「合批 / 3.0 / 3.2 / 防早停」的描述以 05-27 条目为准。

### Added

| 文件 | 变更 |
|------|------|
| `commands/k/task.md` | 新增 Step 2.5「复杂度档位读取」，从 `/k:spec` 末尾读 `VERDICT=simple\|medium\|complex` 决定 tsc 节奏 / EVIDENCE 强度（**不影响进度面板**）。spec 未跑评分时默认 `complex` 保守降级。|
| `commands/k/task.md` | 新增 Step 3.0「建立进度面板」HARD-GATE（条件触发）：medium/complex 复用 plan 阶段已建的 TaskCreate 列表，不重复创建；simple 档（跳过 plan）在此处 TaskCreate 建全部步骤。最终所有档位都必须有 task 列表。|
| `commands/k/task.md` | 新增 Step 3.2「防早停」HARD-GATE：PostToolUse hook / reminder 不是 stop signal；task 列表有 pending 项必须继续；唯一合法停止 = 全部 completed + 末尾 CHECKPOINT 通过 或 ERROR 状态。|

### Changed

| 文件 | 变更 |
|------|------|
| `commands/k/task.md` | Step 3.1 执行模式：旁白静默（不输出 `🔄 进行中 / 操作内容 / ✅ 完成` prose），但每步**立即 TaskUpdate**（status + subject ○→✓）保持进度可见——不合批、不延迟、不省略。|
| `commands/k/task.md` | Step 3.3 删除 `bash update-step.sh ... completed` 一行——TaskUpdate status 是单一进度源，plan-temp.md 复选框不再双写。`update-step.sh` 脚本保留兼容但新流程不再调用。这是本次 token 节省的真正来源。|
| `commands/k/task.md` | Step 3 验证节奏从 1D（按步数）改为 2D 矩阵（步数 × VERDICT）。simple 档全部「末尾 1 次」；medium/complex 8+ 步「每 5 步」（原每 3 步）。中批次取消「中点 + checkpoint 各跑一次」，仅 CHECKPOINT 末跑。|
| `commands/k/task.md` | 完成条件 TOOL EVIDENCE 段强度按 VERDICT 分档：simple 红线场景必有 + 其他批量「用户自测」；medium 全场景必有但可批量 Bash；complex 每场景单独 evidence ≥ 1 个。|
| `commands/k/task.md` | Step 3 删除每阶段「⚡ 并行提示」输出——由 plan-temp.md 阶段标题承载，task 阶段不重复对话提示。|

### 设计要点

- **断频率冗余 / 保类型防御 / 保进度面板**：砍的是「频率冗余」（中点 tsc / 双写复选框 / 阶段提示重复）；不动「类型防御」闸门（TOOL EVIDENCE、禁止编造 stdout、例外 1/2 红线、缺 evidence 降级人工）；**进度面板（TaskCreate + 每步 TaskUpdate）不在优化范围**——它是进度可视 + 防早停的核心。
- **TaskUpdate 不是优化目标**：初版误把它当冗余合批，实测引发早停。真正的 token 节省来自删除 plan-temp 复选框双写（update-step.sh）。
- **错误堆积上限不变**：取消中点 tsc 后，「例外 2 发现编译错立即修」仍兜底——错误最多堆积到下一个 CHECKPOINT。
- **跨 session 续接精度不变**：TaskUpdate status（含 ○/✓ 前缀）是单一进度源，不再依赖 plan-temp.md 复选框。
- **接 spec → plan → task 完整 VERDICT 链**：`/k:spec` Step 8.5 产出 → `/k:plan` Step 0.7 读 → `/k:task` Step 2.5 读，一条信号链贯穿三个阶段。

### 影响

| 维度 | 改前 | 改后 |
|---|---|---|
| 总行数 | 272 | 314（+42，VERDICT 表 + 矩阵 + evidence 分档 + 3.0/3.2 HARD-GATE）|
| Token / 任务 | 25k-70k | 18k-50k（-25-30%） |
| 时间 / 任务 | 3-15 min | 2.5-11 min（-25%） |
| 每步 tool call（进度+落盘）| 2（TaskUpdate + update-step.sh）| 1（仅 TaskUpdate）|
| CHECKPOINT 内 tsc 调用 | 3-5 / 批 | 1-2 / 批（-50%） |
| 进度面板 | 每步实时 | **每步实时（不变）** |
| 严格度闸门 | 5 道 | 5 道（全保留）+ 防早停 HARD-GATE 新增 |

### 与 plan/spec 改动协同

| 信号 | 产出 | 消费 |
|------|------|------|
| VERDICT | `/k:spec` Step 8.5 | `/k:plan` Step 0.7 + `/k:task` Step 2.5 |
| 红线分类 | spec.md 6 类（auth / schema / money / crypto / secret / api-breaking）| task.md TOOL EVIDENCE 强度分档共享同套定义 |
| 质疑前提 | `/k:plan` Step 0.0 三问 | task 阶段直接消费决策，不重复挑战 |

---

## [2026-05-24] /k:plan 瘦身：删 subagent + 加质疑前提 + VERDICT 分流

### Removed

| 文件 | 变更 |
|------|------|
| `commands/k/plan.md` | 删除 Step 5.B 独立 Subagent 核对 + Step 5.C 双报告裁决（同模型 review 实测 4/4 PASS / 0 命中；切不断真正的偏差源：同训练 / 同 spec / 同代码）。原 5.A 主对话覆盖度自查升格为唯一 Step 5。专业 review 工作由 `/k:review` 与 `/k:check` 承担。|
| `commands/k/plan.md` | 删除 plan-temp.md 的 SUBAGENT-REPORT 段及其 Step 7 段落标记核查项。|

### Added

| 文件 | 变更 |
|------|------|
| `commands/k/plan.md` | 新增 Step 0.0「质疑前提」三问（Q1 是否更短路径 / Q2 是否已有可复用资源 / Q3 是否被复杂化），HARD-GATE 强制 file:line 证据回答，关闭成本 > 5 分钟升级回 `/k:clarify`。补 plan 阶段最大盲区——「积极论证 spec 方向」型决策错过。|
| `commands/k/plan.md` | 新增 Step 0.7「复杂度档位读取」，读取 `/k:spec` 末尾 `VERDICT=medium\|complex` 决定后续工序密度。simple 档不应进入 plan（spec 已直接路由到 task）。|
| `commands/k/plan.md` | 新增 plan-temp.md 的 `<!-- PREMISE-START -->` ~ `<!-- PREMISE-END -->` 段，承载 Step 0.0 三问回答。Step 7 段落标记核查同步纳入。|

### Changed

| 文件 | 变更 |
|------|------|
| `commands/k/plan.md` | Step 3 的 DRAFT + 5 信号扫描两阶段流程改为条件触发（VERDICT=complex 且 总步骤数 > 10），其余情形直接列出最终步骤跳过 draft 拆原子。未触发时段内填 `SKIPPED:` 单行，Step 7 仍能识别为合法。|
| `commands/k/plan.md` | Step 4 自审表 B（计划结构）+ D（抽象粒度）合并为单表「B 结构与抽象审」，7 行，触发条件列细化。Step 6 plan-temp 模板 + Step 7 grep 自查同步更新。|

### 设计要点

- **断伪严格 / 加真严格**：删 subagent（实测 0 命中，伪严格）+ 加 PREMISE 三问（捕捉「积极论证错误方向」型决策盲区）。净严格度 +1。
- **接评分系统**：Step 0.7 读取 `/k:spec` Step 8.5 输出的 VERDICT，medium 档跳过 DRAFT/5 信号，复杂任务才跑全工序。
- **段落标记容错**：DRAFT/SIGNAL-SCAN 段在未触发时填 `SKIPPED:` 占位，Step 7 grep 核查不会误判。
- **职责单一化**：plan 阶段专心生成步骤，review 留给 `/k:review` 与 `/k:check`。

### 影响

| 维度 | 改前 | 改后 |
|---|---|---|
| 总行数 | 727 | 741（+14，新增 0.0/0.7 抵消删 5.B/5.C） |
| 工序步数 | 13 个子步骤 | 12 个 |
| plan-temp.md 段数 | 5（DRAFT/SIGNAL-SCAN/SELF-AUDIT/COVERAGE/SUBAGENT-REPORT） | 5（PREMISE/DRAFT/SIGNAL-SCAN/SELF-AUDIT/COVERAGE）|
| 单次 plan token | 33k-72k | 18k-40k（-45%） |
| 同模型 review 工序 | 5.B always-on | 删除（让 /k:review 接手） |
| 「质疑前提」型决策审计 | 无 | PREMISE 三问强制 |

### 修复的根因

本次会话发现的所有重大决策错误（fetcher → SDK 直扩 / vitest 漏判 / web-ui 已有 Pagination 未发现）全是「质疑前提」型——旧 Step 4A 风险审计要求 file:line 证据，反而把 AI 推向「为 spec 已写方案找论据」。新 Step 0.0 在分析前强制反向自检 3 问，对症修复。

### 已知限制

- Step 7 段落标记核查脚本使用 `declare -A`（bash 4+ 语法），macOS 默认 bash 3.2 不支持。该问题为预存限制，本次未修。

---

## [2026-05-24] /k:spec 加入复杂度评分，simple 档跳过 plan

### Added

| 文件 | 变更 |
|------|------|
| `kit/spec/scripts/complexity-score.sh` | 新脚本：基于 spec 静态指标（FILES / MODULES / SCENARIOS / ABSTRACTIONS / DEPS）打分 + 6 类跨栈红线（auth-payment-dir / schema-migration / money-precision / crypto-sign / secret-handling / api-breaking）输出 VERDICT=simple\|medium\|complex |

### Changed

| 文件 | 变更 |
|------|------|
| `commands/k/spec.md` | 新增 Step 8.5「复杂度评分」强制 Bash 实跑脚本输出方案 M 状态卡；完成条件新增「复杂度」字段；路由表替换为 VERDICT 驱动（simple → /k:task 跳过 plan；medium / complex → /k:plan）；增加用户挑战通道（升级 plan / 降级 task 覆盖会落痕到 spec 便于校准）|

### 设计要点

- **断 AI 直觉链**：原路由「路径清晰度 / 方案权衡」由 AI 内部判定，AI 训练偏好保守 → 100% 走 plan；新路由输入来自 grep 计数 + 红线扫描，外部锚点
- **跨栈通用**：红线脚本支持前端（JS BigNumber / calculate）/ Go（shopspring/decimal / big.Float）/ Python（decimal.Decimal）/ Java（BigDecimal）/ SQL（DECIMAL / DDL）/ Web3（EIP-712 / signMessage）/ 通用密码（HMAC / RSA / ed25519 / JWT sign）
- **目录布局通用**：模块识别覆盖 src/ internal/ cmd/ pkg/ services/ packages/ libs/ modules/ 及 apps/X/{src,internal,cmd,pkg}/
- **简单档跳过 plan**：simple → 直接 /k:task，task.md 已有的「兼容旧流程：从对话上下文获取步骤」分支自然衔接，无需改 task.md
- **可校准**：用户覆盖落痕到 spec 末尾 `<!-- COMPLEXITY-OVERRIDE: ... -->`，便于后续反向校准阈值

### 修复的根因

之前 spec.md:363-392 的 task 路由分支从未生效，3 个结构性原因：
1. 判定全凭 AI 直觉（路径清晰度 / 方案权衡），训练偏好保守判模糊
2. 红线条款过宽（「鉴权/资金」泛概念在 sodex 业务里 100% 命中）
3. 路由结果不暴露依据，用户挑战成本高于接受成本

新方案对症：脚本机械判定 + 红线分类细化到目录级 + 完整评分卡 + 挑战通道

---

## [2026-05-23] /k:clarify 输出样式重构（Q 提问 + check 自检表格 + Card A 完成节）

### Changed

| 文件 | 变更 |
|------|------|
| `commands/k/clarify.md` | Step 2 提问改用 Q 样式（编号 + 子项缩进 + 推荐/理由），与 /k:spec 反问视觉统一；Step 6.1 自检改用 check 风格三列表格（检查项/状态/说明），FAIL 时说明列展示具体修复位置；完成条件改用 Card A 直角单卡（emoji 锚点 + 列表展开 + 仪式感）|

### 设计要点

- **风格统一**：clarify 提问 ↔ spec 反问 同用 Q 样式，clarify 自检 ↔ check 自检 同用三列表格；用户在工作流流转时视觉无缝衔接
- **严格度不变**：spec-lint.sh + 6.1 逻辑核查 + 7 章节强制写入 + HARD-GATE 全部保留，纯样式层优化
- **完成节仪式感**：Card A 边框包围标志"clarify→spec" 阶段闭环
- **核心决策列表化**：原 `- 决策 1 / - 决策 2` 改为卡片内 `· 决策 1` 项目符号

### 输出对比

| 部分 | 改前 | 改后 |
|------|------|------|
| Step 2 每问 | 4-8 行 | 4-7 行 |
| Step 6.1 自检 | 8 行 | 10 行（加 FAIL 说明） |
| 完成条件 | 8 行平铺 | 16 行（卡片） |
| **总输出（典型）** | 80-120 行 | **70-110 行（−10%）** |

### 协同更新

- `docs/cli-output/output-styles.md` 中"组合使用"表已包含 `/k:clarify` 推荐组合 → 本次实现对齐文档预定

---

## [2026-05-23] /k:spec 输出全面重构 + 新增 CLI 输出样式参考库

### Changed

| 文件 | 变更 |
|------|------|
| `commands/k/spec.md` | Step 3 需求来源声明删除（与 Step 0 重复）；Step 7.1 需求理解改用方案 F 双栏 ┃（字段名 + 多行内容延续）；Step 7.4 反问改用编号 + 分组（【必答】【可选】，与表述类视觉区分）；Step 8 自审改为永远展示状态卡（PASS 也 show，提升透明度）；完成节 + 路由 整合为方案 F 单节，路由判断仅输出一行决策 |

### Added

| 文件 | 变更 |
|------|------|
| `docs/cli-output/output-styles.md` | **新增**——CLI 输出样式参考库：10 种样式（A/B/C/D/F/I/K/L/M/N/Q）总览 + 字段命名约定 + 状态符号约定 + 选型决策树 + 反模式 + 命令组合推荐 |

### 设计要点

- **核心可见性提升**：4 块核心内容（需求理解 / 反问 / 自审 / 完成）各有视觉锚点（`──── emoji + 标题 ────`）
- **视觉区分原则**：表述类用 F 双栏 ┃，反问类用编号 + 分组（用户一眼分清"AI 表述" vs "AI 提问"）
- **自审显形**：原"通过则静默"改为"永远展示状态卡"，用户能看到 AI 真的做了自审
- **路由压缩**：原"自检 1+2"独立段（8-12 行）压缩为完成节一行决策 + 理由

### 输出对比

| 路径 | 改前 | 改后 |
|------|------|------|
| 反问路径 | 30+ 行 | ~25 行 |
| PASS 路径 | 50-80 行 | ~30-37 行 |
| 核心信噪比 | 35-50% | 80-100% |

### 为后续命令铺路

`docs/cli-output/output-styles.md` 是 soso-kit 各 `/k:` 命令产出对话输出时的视觉样式选型参考。未来新命令应优先从该文档选样式，避免每个命令重新设计。

---

## [2026-05-23] /k:check PASS 路径输出分级压缩

### Changed

| 文件 | 变更 |
|------|------|
| `commands/k/check.md` | Step 0 SUBAGENT_REPORT 与 Step 1.5 MECHANICAL VERIFY 改为按 verdict 分级输出：PASS 时仅贴 verdict + 一句话关键发现 / 1 行退出码说明；FAIL 时仍贴完整诊断信息（用户修复依据）；SKIPPED 时一行说明。同步更新「输出冗余检查清单」。 |

### 设计要点

- **分级原则**：PASS 时只贴 verdict（独立 review 通过即可，过程细节用户不需要）；FAIL 时贴完整（错误信息是用户修复入口）
- **不影响 FAIL 路径**：诊断价值零损失
- **不影响执行严格度**：三闸门 + 工具调用证据仍完整，仅压缩了"过程展示"

### 输出对比（PASS 路径）

| 维度 | 改前 | 改后 |
|------|------|------|
| SUBAGENT 报告 | 完整 20-50 行 | verdict + 1-3 行 |
| MECHANICAL 输出 | 末尾 30 行 / SKIPPED 说明 | 1 行 verdict |
| 总输出行数 | ~50-60 行 | **~22-28 行（−55%）** |

---

## [2026-05-23] /k:plan 输出极简化 + 执行严格度机械自检

### Changed

| 文件 | 变更 |
|------|------|
| `commands/k/plan.md` | Step 3 / 4 / 5.A / 5.B 强制将中间产物写入 plan-temp.md 五段标记（DRAFT / SIGNAL-SCAN / SELF-AUDIT / COVERAGE / SUBAGENT-REPORT），对话不再输出表格内容；Step 6 文件模版同步含五段；新增 Step 7 用 Bash 工具机械 grep 段落标记完整性（HARD-GATE）；⚙️ 工序行内容来自 Step 7 结果，禁止 AI 自评 |
| `commands/k/check.md` | `--fast` 行补 5 字说明「成本低、必须跑」，强化 verify.sh 不可跳过 |

### Added

| 文件 | 变更 |
|------|------|
| `docs/thinking/ai-self-verification-of-execution-rigor.md` | 新增 thinking 文档：执行严格与输出严格的耦合原理与解耦方案（机制 1/2/3/4 分层 ROI） |

### 设计要点

- **解耦原则**：chat 输出与 plan-temp.md 是两个独立 output；简化前者不会拖累后者，只要后者由 plan.md 内规则强制
- **段落标记机制**：5 段缺一即 Step 7 HARD-GATE 失败，禁止进入「完成条件」输出
- **不可 AI 自评**：⚙️ 工序行的 ✅ 必须来自 Bash 工具实际执行的 grep 结果，harness 调用记录可追溯
- **凑数糊弄风险**：当前方案未加段落长度阈值（避免触发"凑废话"反效果），保留风险由用户抽查 plan-temp.md 兜底

### 用户可见输出对比

| 维度 | 改前 | 改后 |
|------|------|------|
| 用户可见输出行数 | ~250 行 | ~30 行 |
| 内部工序数量 | 全保留 | 全保留 |
| 执行严格保证 | AI 自律 | 文件段落 + Bash grep |
| 凑数防御 | 无 | 仅用户抽查兜底 |

---

## [2026-05-23] pr / spec / plan / study 内联「禁止泄露工具链关键词」自检

### Changed

| 文件 | 变更 |
|------|------|
| `commands/k/pr.md` | Step 3.2 / Step 4 自检 / 硬规则 3 处加单行禁令：`grep /k:\|subagent\|Claude\|Cursor\|AI[^a-zA-Z]\|双闸门` 全文，命中即删 / 改中性表述 |
| `commands/k/spec.md` | Step 8 自审表格加「无工具链痕迹」自检行 |
| `commands/k/plan.md` | Step 4.B 计划自审表格加「无工具链痕迹」自检行 |
| `commands/k/study.md` | Phase 8.0 新增「写入前自检」段，grep 关键词与其他 3 文件统一 |

### 设计决策

**问题起点**：用户提交 vault hotfix PR 时发现 AI 把 `/k:debug-on` 实测的描述直接写进 PR 正文——内部工具链名暴露给外部 reviewer。

**首次尝试（被否决）**：在 `.claude/rules/essential/` 下新建 `no-internal-tooling-leak.md` 全局 always-on 注入。

**否决理由**：
1. essential rule 是 **always-on 注入到所有对话** —— 每次对话都消耗 token
2. 但绝大多数会话**不**写 PR / spec / plan / study —— 注入即污染
3. 违反 constitution「严格 ≠ 繁琐 / 规则层少而精」原则

**最终方案：per-command 内联自检**
- 删除全局 rule 文件
- 4 个对外文档命令（pr / spec / plan / study）各自在输出前的「自检节点」加 1 行 grep 自检
- 命令文件自包含 — 无外部依赖、无运行时 Read、无全局 token 污染
- **按需触发** — 仅在用户调用这 4 个命令时规则生效

**关键词清单**（4 处全文一致）：`/k:` / `subagent` / `Claude` / `Cursor` / `AI[^a-zA-Z]` / `双闸门`

**等价替换**（命中后改写示例）：
- 「`/k:debug-on` 实测」→「已运行时验证」/「已实测」
- 「subagent 复核」→「独立复核」
- 「经 `/k:check` 双闸门通过」→「已自检 + 复核通过」

**未覆盖范围（明确不补）**：
- `/k:commit` — 已有「英文 ≤ 50 字符 / ASCII only」强约束，工具链关键词写不进去
- `/k:analyze` / `/k:clarify` / `/k:context-record/learn/update` — 本次只动 4 个用户明确指定的命令；如未来发现实际泄露案例再按同模式扩展

**双闸门 review 修复**：subagent 首轮发现 `study.md` 的 grep 关键词列表比其他 3 个多了 `Copilot|ChatGPT|MAIN_VERDICT|SUBAGENT_VERDICT`（不一致），主对话 review 同步精简到 6 元一致清单后通过。

---

## [2026-05-22] /k:check 三闸门重构 + 输出精简 + /k:review verdict 表格化

### Changed

| 文件 | 变更 |
|------|------|
| `commands/k/check.md` | 新增 Step 1.5 机械验证插槽（`verify.sh`，通用、不绑栈）；裁决总结精简（Step 3/4/5 仅输出 verdict 矩阵 + 差异要点 + ABC 选项，禁止复述前面已贴报告）；新增"输出冗余检查清单"自审 |
| `commands/k/review.md` | Step 4–7 改为"内部记录到 MAIN_REPORT"，不再各自输出小节；Step 8 统一用 verdict 表（完整性 / 规范 / 边界 / 意图 + 关键证据列）+ FAIL 详情段，移除全部 `####` 小节标题 |
| `kit/check/templates/subagent-prompt.md` | 新增 Step 4.5 反向链路扫描——diff 中新增字段 / tag / 参数时强制 grep 下游 sanitizer / serializer / filter / interceptor，抓"加了上游忘了下游"的结构性盲区 |

### 设计决策

**机械验证插槽（verify.sh）**：把"硬求值"从 AI 软对照中剥离——AI 模拟代码行为（如 `new Error(unknown)` 的字段塌缩）本就不可靠，应外包给项目自定义的确定性工具（tsc / vitest / go vet / pytest / sqlfluff …）。`/k:check` 不绑定任何语言，只看一个标准插槽 `.claude/kit/check/verify.sh`：存在则跑、读退出码；不存在则 `MECHANICAL: SKIPPED`（**不默认 PASS**）。保持通用模板的中立性。

**反向链路扫描（Step 4.5）**：reviewer 工作模式是正向"我要做 X → 我做了 X 吗"，对"我加了 X，下游处理器是否覆盖 X"这条反向链路系统性盲。新工序强制对 diff 新增字段反向 grep 下游 sanitizer / serializer / filter / interceptor，列覆盖与漏覆盖。关键字语言无关，扩展名由 diff 推断。

**输出精简（裁决层）**：前一版输出冗长的根因不是过程展示，而是裁决总结复述了已展示过的报告 + 追加长篇"裁决建议论述"。新规则：过程全保留（== SUBAGENT REPORT == / 📋 Review 报告 / == MECHANICAL VERIFY == 三段必须贴），裁决层只输出 verdict 矩阵 + ≤ 3 条差异要点 + ABC 选项。新增"输出冗余检查清单"作为提交前自审。

**verdict 表格化（review.md）**：用户反馈 `####` 小节标题阅读性差；改用单张表格（4 维 × 结果 × 关键证据列），扫描成本从"顺序读 4 节"降到"同列对齐扫"。Step 4–7 不再各自输出片段，避免与 Step 8 双层冗余。

**触发原因**：实战中 `/k:check` 漏抓两个 sentry bug（`new Error(String(serviceError))` 让 `exception.type` 塌缩、新加 `wallet.*` tag 未在 `beforeSend` 处理）；根因分析发现 reviewer 模板是 lexical 软对照，缺机械求值 + 反向链路扫描两个工序节点。此次升级补齐。

### 硬规则

- `--fast` 只跳过 subagent，**不**跳过 verify.sh（机械验证成本低、必须跑）
- MECHANICAL `SKIPPED` ≠ PASS，报告必须显式标注未启用
- 任意维度 FAIL 但其他维度 PASS → 走 Step 5 不一致路径，停下让用户裁决；MECHANICAL FAIL 默认优先采信
- 反向链路扫描 false positive 接受（命中无关处理器由 user 裁决），但**禁止**省略命中点不报告

---

## [2026-05-22] /k:pr 模板与交互重构：三段式正文 + plain text 3 选项

### Changed

| 文件 | 变更 |
|------|------|
| `commands/k/pr.md` | Step 3 模板与 Step 5 交互双重重构 |

### 设计决策

**正文模板重构（Step 3）**：从初版的「emoji 项目标识行 + 顶部 bullet 段落 + `## Commits` markdown 标题」改为「三段式纯文字小节」：

```
核心变动
<一句话总结>

改动范围
* <bullet 1>
* <bullet 2>
...

Commits
* <hash> <subject> — <扩展说明>
...
```

- 三个小节标题（核心变动 / 改动范围 / Commits）都是**独立一行纯文字**，禁止 `#` / `##` / `**`
- 删除 emoji 项目标识行、风险域分组、关联依赖 / 验证文档 / DB 部署独立小节——这些都是"reference material"，应放外部文档而非 PR body
- 全局收紧：正文 ≤ 30 行 / 1200 字符；每条 commit 扩展说明 ≤ 80 字符

**触发原因**：用户反馈初版生成的 PR 正文太长（120+ 行 / 7 个 `##` 节），把"上报数据维度 / QA checklist / 安全过滤实现细节"全塞进了 body。

**收尾交互重构（Step 5）**：从「纯函数立即返回」改为「输出文案 → 3 行选项 → 等用户输入 1/2/3」：

1. **不使用 `AskUserQuestion` 工具**（用户明确要求）——改为 plain text 输出 4 行（1 引导 + 3 选项），用户在主对话直接回复数字
2. **三选项默认 3**（保守默认）：
   - `1` 帮你执行 `gh pr create`（必要时先 plain text 问 `y/N` 推送）
   - `2` 仅展示完整命令给用户复制（**仅此选项**允许展示完整命令）
   - `3` 不需要（默认）——空回复 / 无数字回复都走此分支
3. **命令构造改两步分离**：`cat > /tmp/pr-body.md` + `--body-file /tmp/pr-body.md`，替代旧的 `--body-file - <<'EOF'` 单步嵌套，避免多行中文 body 的 heredoc 转义问题

**硬规则同步升级**：
- 禁止使用 `AskUserQuestion`（plain text 唯一）
- 禁止默认推荐 1 或 2（必须默认 3）
- 禁止在选项 1 / 3 路径展示完整 `gh pr create` 命令
- 禁止多行展开选项 description（每行 ≤ 40 字符）

**双闸门 review 修复**：本次重构经历 3 轮 `/k:check`：
- 第 1 轮：初版用 `<base>` 占位符 + 参数解析逻辑缺失 → 双 FAIL → 重构 Step 1 参数解析 + `$BASE` 变量
- 第 2 轮：正文太长 + 模板未对齐用户参考 → 改三段式 + 30 行约束
- 第 3 轮：交互过重（AskUserQuestion 卡片 6 行） → 改 plain text 3 行选项

---

## [2026-05-22] 新增 /k:pr 命令：根据分支差异生成结构化 PR 文案

### Added

| 文件 | 变更 |
|------|------|
| `commands/k/pr.md` | 新增 `/k:pr` 命令：纯函数式生成 PR 标题 + Markdown 正文，不自动 push、不自动 `gh pr create` |

### 设计决策

**目的**：分支开发完毕后，需要标准化的 PR 文案；与 `/k:commit` 同属"输出建议即返回"的纯函数命令，避免被上层命令复用时阻塞。

**标题格式**：`<PREFIX>: <一句话主题>`，PREFIX 4 选 1（HOTFIX / FIX / FEATURE / UPDATE），按分支名 + commit type 占比自动推断；支持 `--prefix` 强制指定。

**正文模板**对齐参考样例的"结构化 PR description"：
- 顶部一行项目/分支标识（按 diff 文件类型加 🔧/🎨/🛠️ emoji）
- 2-4 行整体概括 + 契约说明（DB schema / API / 前端契约）+ 测试覆盖
- 主题分组按风险域归并（外部访问安全 / 权限 / 并发 / 输入校验 / DB / UI / 状态守卫 / 测试），**不**按 commit 顺序
- 每条 commit：`* <短 hash> <subject> — <扩展说明>`，扩展说明必须补充信息（关键文件 / 技术点 / 上下游影响）
- DB 部署脚本、跨仓库依赖单独成节

**双闸门 review 修复**：初版 bash 块用 `<base>` 占位符 + 参数解析逻辑缺失，被 subagent + 主对话双 verdict FAIL 命中后重构：
- Step 1 拆 1.1 参数解析（`USER_BASE` / `USER_PREFIX` / `USER_TITLE` / `LANG`）+ 1.2 自动探测保存为 `$BASE` + 1.3 用真实变量替代占位符
- 主题分组补充"关键词 / 文件信号"映射表，给 AI 可观察的判定规则
- gh 命令改用 `--body-file - <<'EOF'` 替代进程替换 `<(cat <<'EOF')`，避免 POSIX sh 兼容性问题

**硬规则**：禁止自动 `gh pr create` / push / rebase / amend / 伪造 hash / 复述 subject——与 `/k:commit` 设计原则一致。

---

## [2026-05-21] /k:context 加 rebuild-indexes 子命令

### Changed

| 文件 | 变更 |
|------|------|
| `commands/k/context.md` | SUBCOMMAND 表新增 `rebuild-indexes` / `rebuild` → `context_rebuild_indexes $PARAMS`，作为反向索引兜底维护入口 |

### 设计决策

**背景**：`/k:study agentmemory` 调研发现 `indexes/files.json` / `indexes/tags.json` 是 router 派生数据，但 write 路径未做"两个真相源一致"保证——存在 remove 毁 router / update 留僵尸引用 / 漂移无恢复 三类失真。

**只暴露 rebuild，不暴露 prune**：prune 是 update 流程的内嵌步骤（用户调 update 就自动 prune），不需要单独命令；rebuild 是"漂移后兜底"，必须有显式入口。

**为何带 `--dry-run`**：rebuild 会**整体覆写** files.json / tags.json，是不可逆操作。预览阶段让用户先看 old → new 数量差再决定（实测 sodex-web 真有 tags 漂移 37 项）。

**取舍**：

- 子命令名 `rebuild-indexes` 比 `rebuild` 更清晰，同时保留 `rebuild` 短别名
- 写入路径只能在主仓库下跑（`context_rebuild_indexes` 内检测 `PROJECT_NAME = soso-kit` 时报错并给 fallback 命令），与其他写入命令一致

---

## [2026-05-21] /k:analyze 加 HARD-GATE 6 文档头部消费提示

### Changed

| 文件 | 变更 |
|------|------|
| `commands/k/analyze.md` | HARD-GATES 加第 6 条「文档头部消费提示」：产出 `<topic-slug>-analysis.md` 时必须在标题后强制插入消费提示块，提醒「跨项目对照必读章节 7 行为流追溯 + 文末上下游缺失段」 |

### 设计决策

**背景**：今天上一轮（`cf1119e`）给 `/k:analyze` 加了行为流追溯（HARD-GATE 5 + 章节 7 + 任务 G），修复**产出端**——让 analyze 文档含上下游层信息。但**消费端**没修：跨项目对照时，AI / user 仍可能只看章节 2/3 接口层就抄，跳过章节 7。

**Subagent 评估指出**：1.4 实际效果只到 ~35%，原因正是消费端无强制。

**初次方案探索**：考虑在 `/k:migration` 加规则强制读章节 7。**核实后否决**——`/k:migration` 的 analyze 子命令读 Context Library（`kit/context/library/sodex-web/...`），**不消费 `/k:analyze` 输出**（spec 目录下的 `<topic-slug>-analysis.md`）。Subagent 凭命令名相似推断有消费关系，**没核实实际数据流**——又一次同源偏差现身（subagent 内部）。

**真正消费场景**：手动 / AI 在 spec / clarify 阶段对照 analysis.md 做迁移决策——**无机械强制点**（用户主观行为）。

**最小有效补丁**：让 `/k:analyze` 在生成文档时强制加消费提示头部。成本极低（加固定模板段），效果中等（依赖消费方读到提示——但比无提示概率高）。

**取舍**：

- 这是 prompt 提醒级，**非机制级根治**
- 但成本极小，边际收益正向
- 消费方仍可能跳过提示，但「消费端零强制 → 消费端有显眼提示」是真改进

**已知局限**：

- 旧 analyze 文档（本次改动前生成的）没有这个头部，需要重跑或手动补
- 提示文本是 prompt 内嵌模板，未来如要修改文案需要改 HARD-GATE 6
- 仍未根治——消费方真不读也没办法（受 AI / user 自觉度限制）

**元层教训**：

- Subagent 评估有局限——它**也是 AI**，会凭印象推断（"migration 和 analyze 名字相似" → 假设有消费关系）。这次靠主对话 grep migration.md 才发现假设错
- **subagent 不是万能药**：解决 context 同源，但不解决"AI 凭印象推断"
- 一致性：参照 `--fast 自作主张` / 6 个语言全集 / commit.md 越界——本质都是 AI 不质疑既有 frame

---

## [2026-05-21] /k:plan + /k:task 平移 /k:check 三大防御机制

### Changed

| 文件 | 变更 |
|------|------|
| `commands/k/plan.md` | ①Step 4 加 D 段「抽象粒度审查」HARD-GATE（文件/功能比 > 2 / interface 必须 ≥ 2 使用场景 / `[推理]` 抽象降级 TODO）；②Step 5 重构为三层 5.A 主对话自查 + 5.B 独立 subagent 核对 + 5.C 双报告对比裁决（仿 `/k:check` Step 0 + 2） |
| `commands/k/task.md` | ①CHECKPOINT 段加 HARD-GATE：禁止自由文字自审，必须 Bash 工具调用 + 真实 stdout；②完成条件加 `== TOOL EVIDENCE ==` 强制段（每验收场景必须 ≥ 1 工具调用证据，缺失降级人工确认） |
| `kit/plan/templates/subagent-plan-prompt.md` | 新建 5.B 用的 subagent prompt 模板，独立提取 spec → 提取 plan → 4 维 gap 分析（章节覆盖 / 验收拆步 / Checkpoint verification / 抽象审查） |

### 设计决策

**问题**：其他会话反馈 plan / task 阶段 6 大问题——步骤过碎 / Checkpoint 自审 / 信息缺口推迟 / spec 覆盖闭环 / 验收场景打包 / 过度抽象。

**核实现状（关键步骤）**：先读 plan.md / task.md 发现 **4/6 已被现有 HARD-GATE 修了**——1.1 步骤合并 5 信号、1.3 信息缺口就地关闭、1.5 验收必拆、1.2 plan 层已要求「必须真跑」。**真正未修的**：

- **1.4 spec 覆盖同源闭环**（Step 5 主对话自己写自己对照）
- **1.6 过度抽象无审查**
- **1.2 / 1.5 task 执行阶段无工具调用强制**（plan 写了"必须真跑"，但 task 跑时无 HARD-GATE）

**修复策略——从 AI agent 运行机制出发**：把 `/k:check` 已验证的三大解药复用到上游。

| AI 固有缺陷 | 解药 | 应用 | 解决问题 |
|---|---|---|---|
| Context 同源 | subagent 隔离 | plan.md Step 5.B + 模板 | 1.4（真根本修） |
| 最少阻力路径 | HARD-GATE 不留余地 | plan.md Step 4.D | 1.6（半修，HARD-GATE 受 AI 自觉度限制） |
| 自由文字编造 | 强制工具调用 + 真实 stdout | task.md CHECKPOINT + TOOL EVIDENCE | 1.2 / 1.5（真根本修——AI 能编 markdown 但**没法伪造 Bash 返回结果**） |

**关键认知升级**：

- AI agent 两大固有缺陷：context 同源 + 最少阻力路径
- 三大解药按强度：**强制工具调用 > subagent 隔离 > HARD-GATE**
- 之前没用够「强制工具调用」——它最强，因为**AI 能编造 markdown 字符串，但没法伪造 Bash 工具的真实返回**。把"自审"外包给工具调用 = 断 AI 编造可能

**绕路过程的反思（4 轮迭代）**：

| 轮次 | 方案 | 否决理由 |
|---|---|---|
| 1 | A''''：plan + task 全改 + `--simple` flag | user 反对 `--simple`：无意义、新增心智负担、违反「简单」原则 |
| 2 | A'''：去 flag + 客观触发（plan 引用 spec 即 spawn） | user 追问：复杂度判断合理吗 / AI 严格执行吗 / subagent 能解决吗 |
| 3 | A''''：从 AI 机制出发分类——同源 / 最少阻力 / 编造各对应专属解药 | user 追问：核实现状 |
| 4 | **B（本次）**：先读 plan.md / task.md 发现 4/6 已修 → 砍半改动到 4 处真未修 | ✅ 落地 |

**最大教训**：又一次同源偏差现身——凭报告假设 vs 核实事实。靠 user 提醒「核实现状」才纠正。**改动前先读现状是 HARD-GATE 级别的纪律**，不该靠提醒。

**取舍**：

- 接受：plan 阶段多 spawn 一次 subagent（几秒 + 几千 token）；task 验收必须工具调用（无法纯口头通过）
- 换得：1.4 真根本修复（context 隔离切同源），1.2 / 1.5 真根本修复（工具调用断编造），1.6 半修复

**未做**：

- 不改 `.cursor` 端（架构差异：shell 脚本 vs prompt 流程）
- 不加 `--simple` flag（user 已否决）
- 不修 1.1 / 1.3（已被 plan.md 现有 HARD-GATE 修了）

**通用性补丁（initial draft 后的覆盖范围审查）**：

初版改动用了若干前端项目特定例子——`tsc / lint` / `pnpm test` / `mcp__claude-in-chrome__*` / `interface / enum`。soso-kit 已含多技术栈项目（sodex-lens Go 后端 / sodex-admin-dashboard 等），统一泛化为多语言例子：

| 位置 | 之前 | 之后 |
|---|---|---|
| task.md CHECKPOINT 类型检查 | `tsc --noEmit / lint` | `tsc / cargo check / go vet / mypy / pnpm lint` 等 |
| task.md TOOL EVIDENCE 测试 | `pnpm test 等` | `pnpm test / cargo test / go test / pytest` 等 |
| task.md TOOL EVIDENCE 浏览器 | `mcp__claude-in-chrome__*` 绑死 | `mcp__claude-in-chrome__* / Playwright / Puppeteer` 等 |
| plan.md 4.D 抽象关键词 | `interface / enum / 跨文件协议` | `interface / enum / trait / protocol / 跨文件协议 / 共享数据结构` + 多语言说明 |

**反思**：「通用模板」是 soso-kit 核心定位，初版仍带前端偏见——又一个**路径依赖偏差**（默认 = TS/前端），靠 user 反问「是否通用」才暴露。**通用性应作为 plan / spec 阶段的强制审视项**，不该靠下游补丁——但本次未把它升级为 HARD-GATE，留作未来观察。

---

## [2026-05-21] /k:commit 重构为纯函数 + /k:check Step 3 复用

### Changed

| 文件 | 变更 |
|------|------|
| `commands/k/commit.md` | 完成条件段重构：①删除「等待用户决定 + 执行 git commit」耦合段；②加输出禁令（禁止 `cd` / `git add file1 file2 ...` 代用户决定文件 / heredoc 多行 / `Co-Authored-By` trailer / body 长文）；③**允许**单行 `git commit -m '<subject>'` 包装（user 复制直接跑，不必手敲 `-m ''`）；④明示「纯函数」设计原则（输入 diff → 输出建议 → 立即返回） |
| `commands/k/check.md` | Step 3 改为 Skill 工具调用 `/k:commit`（无参数）替代原「Read commit.md Step 2-3 自己执行」 |

### 设计决策

**问题**：其他会话反馈 `/k:check` 末尾的 commit 建议输出冗长（带 `cd / git add / heredoc / 多段 body / Co-Authored-By`），与预期的"单行 commit subject"严重不符。

**两层根因**：

1. **/k:check 引用边界不全**：Step 3 写「读 commit.md Step 2-3」，但 commit.md 最终输出格式（"完成条件"段）在 Step 2-3 之外。AI 读不到完整输出 schema，自己编。

2. **commit.md 自身越界**（**真根因**）：把「等待用户决定 + 执行 git commit」hardcoded 进 prompt。这是用户层决策，不是 commit.md 职责。导致任何上游复用都被阻塞，必须打补丁绕开。

**绕路过程的反思**：

最初两轮方案都是「接受 commit.md 现状 + 加规则 / 加 flag」打补丁——
- 轮 1：扩 /k:check Step 3 引用范围 + commit.md 加禁令
- 轮 2：commit.md 加 `--dry-run` flag 跳过等待

直到用户质问「为什么要传参数？为什么复用这么复杂？」，才意识到根因是 commit.md 越界设计。

**这是路径依赖偏差**——AI 把既有设计当 frozen，在 frame 内打补丁。和 `--fast 自作主张` / `6 个语言全集` 同类（接受既有 frame 不质疑）。违反 soso-kit「路径最短」原则。

**真正修复**：

- commit.md 重构为**纯函数**：输入 git diff，输出建议，立即返回。"是否执行 git commit"由用户在主对话主动表达，属用户层决策
- check.md Step 3 改为 Skill 调用 `/k:commit`（无参数）：commit.md 单点维护输出格式，未来变化自动跟上

**取舍**：

- 损失：commit.md 末尾「用户回复 commit / go → AI 自动 git commit」的便利消失
- 实际：用户在主对话说「帮我 commit」，AI 看上下文 commit 文案就会执行，无需 commit.md 内置规则。功能等价

**输出禁令硬规则化**：禁止越界的 cd / git add 代决策 / heredoc / trailer / body 长文。理由"多写点更贴心 / 加 trailer 更规范"一概不接受——参考 `--fast 自作主张` 教训。

**禁令边界（初版矫枉过正后的二阶反思）**：第一版禁令把 `git commit -m '<subject>'` 单行包装也禁了，导致 user 复制后还要手敲 `-m ''`——失去便利。修正后明确区分：

- ❌ **越界** = 代 user 做决策（add 哪些文件 / cd 哪里 / 加 trailer 等）
- ✅ **便利** = 把 subject 包装成 user 一眼就能跑的命令

精神：**禁令应禁「代用户决策」，不应禁「减少用户重复操作」**。两者边界靠这次 user 反馈才划清——单凭 AI 自己定容易过度收紧。

---

## [2026-05-21] /k:analyze 加行为流追溯防接口层伪等价

### Changed

| 文件 | 变更 |
|------|------|
| `commands/k/analyze.md` | 七处增量：①HARD-GATES 加第 5 条「行为完整性追溯」；②Step 3-A 文档结构加章节 7（强制）；③Step 3-B.1 任务表加任务 G；④Step 3-B.3 派单 prompt 加 task-G + 「未发现 ≠ 不存在」红线；⑤Step 4 汇总加章节 7 + 文末「上下游缺失」段；⑥Step 5 核验加维度「行为流完整性」（反向 grep 抽样）；⑦Step 6 交付加 `🔗 行为流：覆盖 N 个 / 缺失 N 处` |

### 设计决策

**问题**：跨项目对比时陷入「接口层伪等价」——只看相同函数实现就抄，得出"sodex-web 不检查所以我也不检查"或"sodex-web 这样写所以我也这样写"的错误结论。源于行为分布在多层（接口层 + 上下游层 + 横切层），单看接口层会漏。

**原则**：实现行为 = **接口层 + 上下游层 + 横切层** 的总和。比较时必须摊平层次再比。

**解决**：analyze 产出端强制追溯。五层串联：HARD-GATE → 任务 G → 章节 7 → 核验维度 → 交付摘要。task-G prompt 加「未发现 ≠ 不存在」红线（必须写"已 grep <模式>，未命中"），防 AI 偷懒说"无横切层"。核验维度走反向 grep 抽样，不是只看 task-G 写了啥。

**已知局限（半修方案）**：
- 修了**产出端**（analyze 文档含上下游层），未修**消费端**（`/k:migration` / 手动对照不强制读章节 7）
- 实际效果约 35%——跨项目对照仍可能漏读章节 7
- 升级路径：若证明仍痛 → 改 `/k:migration` 加「消费时必读章节 7」规则 / 新建 `/k:compare`

**取舍**：
- 接受：简单模块也产出章节 7（轻度噪音）；复杂模式多 1 个 agent（task-G，几秒 + 几千 token）
- 换得：analyze 文档作为下游材料的完整性，跨项目对照的伪等价风险下降约 1/3

**未做**：
- 不改 `/k:migration`（用户选 B：只改 analyze）
- 不新建 `/k:compare`

---

## [2026-05-21] /k:check 加硬规则禁止 AI 自作主张 --fast

### Changed

| 文件 | 变更 |
|------|------|
| `commands/k/check.md` | Step 0 触发条件加硬规则：禁止 AI 自作主张 --fast（"diff 简单 / 配置文件 / 节省 token"等理由一概不接受）；新增强制声明 `[Subagent 模式] --fast 检测：YES/NO`（可观察违规检测点）；新增 Step 0.6 强制段落 `== SUBAGENT REPORT ==`（无论 PASS / FAIL / SKIPPED 都必须贴，让违规无法藏匿） |

### 设计决策

**问题**：上一版 check.md 默认开 subagent，但触发条件只写 "`$ARGUMENTS` 不包含 `--fast`"，**没明确禁止 AI 自己选**。其他会话报告显示 AI 自行标 "--fast 模式" 跳过 subagent，理由都是自我合理化（"diff 简单 / 改动少 / 节省 token"）。这与同源偏差是同类问题——**AI 自作主张越权简化流程**。

**解决**：三层防御
- **道德线**：硬规则明文列出"以下理由一概不接受"
- **透明化**：执行前强制输出 `[Subagent 模式] --fast 检测：YES/NO（依据：$ARGUMENTS = "<原文>"）`
- **结构强制**：报告必含 `== SUBAGENT REPORT ==` 段落，缺失即视为流程不完整

**承认局限**：prompt 层始终可被绕，AI 总能找借口。更彻底的方案是 hook 强制注入或脚本编排，但超出本次范围。

---

## [2026-05-21] /k:check 加独立 subagent 预审防同源偏差

### Added

| 文件 | 变更 |
|------|------|
| `commands/k/check.md` | 新增 Step 0「独立 subagent 预审」+ Step 2「双报告对比裁决」；默认开启，`--fast` 跳过 |
| `kit/check/templates/subagent-prompt.md` | 新建 subagent prompt 模板，含占位符 `{{PWD}}` / `{{CHANGED_FILES}}` / `{{SPEC_PATHS}}`，由 check.md Step 0 读取填充 |

### 设计决策

**问题**：原版 /k:check 由同一个主对话 AI 同时生成"预期清单"和"对照 diff"，意图基准与验证基准同源，无法发现主对话的盲点假设——典型场景：把 grep 命中数当全集（如"6 个语言"实际有 11 个）。

**根本解**：spawn 一个 context 隔离的 `Explore` subagent，**不知道**主对话推理 / 假设 / 结论。独立读 spec + 跑 `ls/glob/find` 拿权威全集 + 强制贴出命令输出，再做 gap 分析。两份报告并列：

- 一致 PASS → 进入 commit 建议
- 不一致 → 停下让用户裁决（A 接受 subagent / B 接受 main / C 重跑）

**为什么模板放 `kit/check/templates/` 而非 `commands/k/`**：`.claude/commands/k/` 下任何 `.md` 都会被注册成用户命令（如 `/k:_check-subagent-prompt`），模板会污染命令列表。`kit/` 路径不被扫描，是 internal asset 的正确位置。

**取舍**：
- 接受：每次 /k:check 多 spawn 一次 subagent（几秒 + 几千 token）
- 换得：消除同源偏差，把"独立验证"作为基础保障而非 optional add-on
- 范围：仅 `.claude` 端；`.cursor` 端因架构差异（shell 脚本 + checklist.md vs prompt + review.md 4 维度）本次不动，未来如需可独立立项

**已知 false positive**：subagent 的"配套改动核实"会把 `find <filename>` 命中的镜像文件全部标为漏改——架构差异（如 `.cursor` vs `.claude` 同名文件不同实现）需 user 裁决，不是 bug。

---

## [2026-05-19] clarify context 轻量化 + 脚本 shebang 修复

### Fixed

| 文件 | 变更 |
|------|------|
| `kit/spec/scripts/context-preflight.sh` | 修复首行 shebang 污染（`soo#!/usr/bin/env bash` → `#!/usr/bin/env bash`），导致 auto 模式调用脚本失败（潜伏自首次提交） |

### Changed

| 文件 | 变更 |
|------|------|
| `commands/k/clarify.md` | Step 1 移除 Auto 模式必查 context 逻辑；改为"轻量提示 + 显式 `--c <keyword>` 触发"；移除 Step 5 spec 文档 frontmatter 要求 |

### 设计决策

经过两轮迭代后回归简化方案：
- **原方案**（已废弃）：clarify auto 模式必查 context → spec 文档写 `context_checked` frontmatter → spec 阶段跳过 preflight
- **当前方案**：clarify 默认只做轻量提示（不加载、不确认、不写标记）；用户显式 `--c <keyword>` 才主动搜；spec 阶段作为 context 搜索的主入口

**回退原因**：
- 5% 漏查场景不值得引入 frontmatter 协作复杂度
- spec 阶段关键词已明确，命中率本就更高
- AI 语义匹配天花板在 clarify 阶段无法突破

---

## [2026-05-19] /k:debug-on 边界优先插桩 + 集合模式

### Changed

| 文件 | 变更 |
|------|------|
| `commands/k/debug-on.md` | Phase 1 改为数据流边界定位策略（通用，非前端专用）；Phase 2 改为集合模式（一次插完所有边界点）；Phase 3 输出压缩为 2 行 |

### 核心变化

- **Phase 1**：从"grep + 读代码推断失败路径"改为"提取数据流层次 → grep 找层间交叉点 → 小范围读确认观测位置"，策略通用化
- **Phase 2**：从渐进模式（先 1-2 个核心点）改为集合模式（一次插完），减少用户复现轮次
- **Phase 3**：提示输出从 1 行改为 2 行（轮次 + 操作指引分行）

---

## [2026-05-19] /k:debug-on 静默执行 + 渐进插桩

### 改动

| 文件 | 变更 |
|------|------|
| `commands/k/debug-on.md` | 分析/假设过程全部静默，输出仅保留三个状态：服务启动 / 插桩位置 / 轮次提示；插桩改为渐进模式（先 1-2 个核心点，验证路径可触达后扩展）；tag 格式简化为 `[DEBUG:P{N}]` |

### 核心变化

- **之前**：输出 Phase 1 分析推理 + Phase 2 完整假设 markdown + Phase 5 详细分析过程
- **之后**：三行关键输出（`✅ 端口` / `✅ 插桩 N 点` / `▶ 复现` / `## 根因 + 修复`）

---

## [2026-05-19] /k:review 深度强化 + /k:check 重构为编排层

### 背景

用户痛点：

1. **check 无法检测漏改**：PC 改了 Mobile 没改，check 发现不了
2. **check 无法检测逻辑冲突**：新代码与已有代码冲突，未被捕获
3. **severity 模型干扰注意力**：critical/high/medium 分级产生噪声，偏离核心问题
4. **--deep 导致深度检查被遗忘**：关键分析默认不执行

### 改动内容

| 文件 | 变更 |
|------|------|
| `commands/k/review.md` | **重构**：移除 `--deep`，四维度全部默认执行，输出 `VERDICT: PASS/FAIL`；规范引用改用 CLAUDE.md 已注入规则；恢复 CHK-09/10/10b 项目专属检查；审查范围分层（完整性/意图用全文件，规范/边界用代码文件） |
| `commands/k/check.md` | **重构**：薄编排层，调用 review.md，VERDICT 决定是否生成 commit；修复 KIT_ROOT 未定义 |
| `commands/k/commit.md` | **新增**：独立 commit 建议命令，仅分析 git diff，不审查代码，产出 Conventional Commits 格式建议 |

### /k:review 四维度

| 维度 | 捕获问题 | 执行方式 |
|------|---------|---------|
| **完整性** | 漏改（PC/Mobile 对称、spec gap）| spec → 预期清单 → 对比 diff |
| **规范性** | 规范违反 | 对照 rules 文件逐项扫描 |
| **边界** | 未处理的边界条件 | 机械走查每个改动函数的分支路径 |
| **意图** | 逻辑冲突、调用方影响、过度实现 | grep 调用方 + spec 对照 |

### VERDICT 模型

- 任意维度 `FAIL` → `VERDICT: FAIL` → /k:check 不生成 commit
- 全部 `PASS` / `SKIPPED` / `N/A` → `VERDICT: PASS` → /k:check 生成 commit 建议
- 无 severity 分级，只有通过/不通过

### 关键设计：预期清单先于 diff

防确认偏差：AI 先从 spec 生成"应该改哪些文件"清单，再看 diff，再对比——不是看完 diff 再说自己做完了。

### 使用场景

| 场景 | 命令 |
|------|------|
| 提交前深度审查 + 通过则给 commit | `/k:check` |
| 已自审，仅要 commit 文案 | `/k:commit` |
| 独立代码审查（不提交）| `/k:review` |
| 深度审查 + 记录到 context | `/k:check --r` |

---

## [2026-05-19] /k:task 移除中间 checkpoint 人工暂停

### 背景

跨项目数据：68 个 /k:task 会话中 21 个（31%）涉及 checkpoint 交互，长任务普遍残留 pending 状态。

根因诊断：
- 当前规则"发现模糊问题 → 暂停等用户"判定过松，AI 倾向"宁可问"
- 中间 checkpoint 的"测试"是假的——UI / 钱包 / 集成等场景在功能未完整时无法真正测试
- pending 残留：暂停后 checkpoint task 永远 pending，长任务堆积

### 文件变更

| 文件 | 变更 |
|------|------|
| `commands/k/task.md` Step 3 | 移除"模糊问题暂停"分支；通过即立即置 completed；tsc/lint 失败改为 ERROR 状态（非 checkpoint）|

### 设计原则

| 状态 | 含义 | 触发 |
|------|------|------|
| `completed` | 已完成 | tsc/lint 通过 + 自检三项通过 |
| `ERROR` | AI 卡住 | tsc/lint 报错且无法自动修复（求助，非 checkpoint）|
| 末尾 pending | 唯一人工节点 | 全部批次完成后询问"是否进入 check" |

**中间 checkpoint 零人工**，**末尾保留唯一人工确认**。

### Token / 流程收益

| 场景 | 改前 | 改后 |
|------|------|------|
| 长任务 checkpoint 数 | N 个全部可能暂停 | 0 暂停 |
| pending 残留 | 每个未通过 checkpoint 都遗留 | 仅末尾 1 个待确认 |
| 用户被打断次数 | 每批次 + 末尾 | 仅末尾 |
| 真实人工测试时机 | 中间假测 + 末尾真测 | 仅末尾真测 |

### 为什么不删除末尾确认

中间检查是 AI 能自动做的（tsc/lint）→ 不需人工。  
末尾测试是 AI 无法做的（UI 视觉 / 钱包 / 集成）→ 必须人工。  
**这是单一人工节点的语义边界。**

---

## [2026-05-19] /k:security 增加 lockfile 历史回溯

### 背景

AntV 供应链事件（Shai-Hulud 蠕虫家族 2026-05 波次）会话暴露 `/k:security` 单一盲区：只比对**当前** lockfile，无法回答"项目过去是否曾经引入过受污染包"。

Shai-Hulud 类蠕虫的真实伤害发生在 `pnpm install` 触发 `postinstall` 那一秒——凭据当场外发。事后即使升级到干净版本，伤害已造成，且当前 lockfile 看不到任何痕迹。

会话中通过外置 `git log -S "@antv/" -- pnpm-lock.yaml` 跨所有分支搜索 lockfile 历史，确认 7 个项目从未引入过 AntV 命名空间，把"窗口期感染"风险从 30% 可靠性提到 90%。

会话同时评估了其他可能沉淀项（间接依赖 install 脚本枚举、node_modules IoC 多维扫描、workflow 内容审查），结论是：

- IoC 清单需持续维护，每次新蠕虫变种都得手动加，维护成本 > 收益
- 间接依赖脚本 99% 命中 `esbuild/sharp/keccak` 等可信原生模块，机器报噪
- workflow 真正被入侵的项目早就在 GitHub Security Advisory 里了
- 全 node_modules 扫描多耗 5–10x token，95% 是 NONE，信息密度低

最终只沉淀 lockfile 历史回溯一项：成本极低（一行 `git log -S`），价值极高（回答用户真会问的"以前装过吗"），不引入维护负担。

### 文件变更

| 文件 | 变更 |
|---|---|
| `.claude/kit/security/scripts/scan.sh` | 新增 `history-check` 子命令：接受 `selection` + `pattern1\|pattern2\|...`，对每个项目的 lockfile 跨所有分支执行 `git log --all -S`，输出 `HISTORY:START..END` 块标注每个 pattern 的命中 commit 数 |
| `.claude/commands/k/security.md` §Step 5.5 | 新增「历史 lockfile 回溯」步骤：仅当 Step 1 提取到风险包时执行，将风险包名 + 命名空间前缀拼为 pattern 调用 history-check；`NONE` 安全、`N commits` 标记「⚠️ 历史命中」建议轮换凭据 |
| `.claude/commands/k/security.md` §Step 6 报告 | 风险项目表新增「历史命中」列；扫描概况新增「历史回溯：[已执行/跳过]」 |

### 决策原则

- 保留命令的"小而锐"定位：只加 1 项，拒绝 IoC 多维扫描等过度设计
- 不改变现有交互流程（项目选择、分支切换、scan 输出格式全部保持）
- 历史回溯独立于 scan，可单独调用，不绑定主流程性能

### 验证

7 个项目实跑结果：

| 项目                  | lockfile           | `@antv/` 历史 | `echarts-for-react` | `timeago.js` |
| --------------------- | ------------------ | ------------- | ------------------- | ------------ |
| sodex-admin-dashboard | pnpm-lock.yaml     | NONE          | NONE                | NONE         |
| sodex-landing         | pnpm-lock.yaml     | NONE          | NONE                | NONE         |
| sodex-next            | pnpm-lock.yaml     | NONE          | NONE                | NONE         |
| sodex-portal          | pnpm-lock.yaml     | NONE          | NONE                | NONE         |
| sosovalue-admin       | package-lock.json  | NONE          | NONE                | NONE         |
| sosovalue-ssi         | pnpm-lock.yaml     | NONE          | NONE                | NONE         |
| ssi-admin-dashboard   | pnpm-lock.yaml     | NONE          | NONE                | NONE         |

阳性测试：`history-check "3" "react"` → `react: 33 commits`，命中计数正确。

回归：`list` / `branch-check` / `scan` 三个原有子命令输出完全不变。

---

## [2026-05-12.3] /k:plan 粒度判定改为「先 draft 再 compact」两阶段流程

### 背景

`/k:plan` 在前一版（[2026-05-12.2]）改为 signal-first（写步骤时贴扫描结果）。用户反馈："拆细 OK，最后汇总时再合并" 这个流程更符合 AI 的生成式特性：

- AI 不像人类先想清楚再写，更擅长 brain dump（自由枚举）→ revise（按规则压缩）
- Signal-first 在每步骤写出前要前瞻思考 5 信号，认知负担前置，反而打断 AI 自然枚举工作的流
- 复杂任务（涉及 20+ 原子工作）signal-first 容易"上来判断错"导致漏精度；draft-then-compact 后置合并有全局视角

但 draft-then-compact 必须配 5 信号机械化合并规则，否则 AI 会偷懒主观合并。两个方案的核心规则相同，只是应用时机不同。

### 文件变更

| 文件 | 变更 |
|---|---|
| `.claude/commands/k/plan.md` §3 粒度判定 | 「写步骤时贴扫描结果」单阶段 → 「Draft 自由枚举 + Compact 5 信号合并」两阶段。Draft 写入 plan-temp.md `<!-- DRAFT-START -->` 注释区作为审计中间产物。Compact 阶段对相邻工作两两评估 5 信号，零信号必合 / 任一信号必拆 |

### 决策原则

- 保留前一版 [2026-05-12.2] 的核心：5 信号客观规则、Checkpoint 可执行命令、信息缺口就地关闭，**全部不变**
- 仅调整粒度判定的执行时机：从"边写边判"改为"先列后合"
- Draft 中间产物保留在 plan-temp.md（注释区），可被 reviewer 审计：是否合并/拆分决策与 5 信号一致

### 验证

回归本次 Batch A 会话：

| 阶段 | Signal-first（前版）| Draft-then-compact（本版）|
|---|---|---|
| AI 认知负担 | 写每步骤时前瞻判断 5 信号 | 先自由枚举 24 行原子工作，再后置合并 |
| 是否漏精度 | 复杂任务可能漏（前期判断失误无回头） | 不漏（先列出来，错也是拆多） |
| 最终步骤数 | ~15 | ~15（一致，因合并规则相同） |
| Token 增量 | 步骤少但每个含信号扫描 | 多 draft 中间产物（~150 token），但每个最终步骤的扫描结果与前版一致 |
| 可审计性 | 步骤旁信号扫描 | Draft（中间产物） + 步骤旁信号扫描 |

净评估：复杂任务的漏精度风险降低，多付出 ~150 token 中间产物存档成本，换更稳的合并质量。

---

## [2026-05-12.2] /k:plan 重构：5 信号粒度判定 + Checkpoint 可执行命令 + 信息缺口就地关闭

### 背景

sodex-next 埋点系统迁移（global-track Batch A）会话回放暴露 plan 工作流 6 类失败模式：

1. **步骤拆分过细**：28 步 vs 17 文件，几乎 1:1。机械规则「描述超 3 行 / 2 文件须拆」只防过粗，不防过细
2. **Checkpoint 自审自批**：6 个 checkpoint 全部"主观叙述 → AI 自己签收"，无外部可验证动作
3. **信息缺口推迟到 task**：plan 阶段标 ⚠️ 后任由推理决策残留，到 task 才补关闭
4. **Spec 覆盖度表自闭环**：AI 写 spec → AI 凭印象列对照表 → "全部 ✅"
5. **验收场景被打包**：6 个 Given/When/Then 场景被塞到 1 个"端到端验收"步，task 阶段没有 1 个真在浏览器跑过
6. **抽象审查缺位**：plan 直接接受 spec 的 14 文件结构未质疑（实际 6 个文件是"为未来准备"的过早抽象）

根因：plan 工作流是**描述性**（描述步骤 / 描述检查），缺**证据性**（每个产出对应的客观证据是什么）。表象上是 6 个问题，本质是 3 个核心环节缺约束：**D（Decomposition 拆分）/ V（Verification 验证）/ I（Information 信息完备）**。

### 文件变更

| 文件 | 变更 |
|---|---|
| `.claude/commands/k/plan.md` §3 拆步骤 | 「粒度检查」改为「粒度判定（双向）」：5 信号规则（S1 独立验证 / S2 独立交付 / S3 跨主题 / S4 顺序依赖 / S5 外部 gate），零信号合并、任一触发拆分。强制每个候选步骤贴信号扫描结果。新增「验收场景必拆」：每场景独立成步 + 含验证方法 + 证据形式 |
| `.claude/commands/k/plan.md` §3.5 Checkpoint 模板 | 三句"完成度/质量/结论"主观叙述 → 可执行命令清单 + expects 模式；AI 必须真跑命令贴实测输出；HARD-GATE：任一 expects 未匹配 → 不通过 |
| `.claude/commands/k/plan.md` §4.C 信息缺口自审 | 「自审 + 推迟」→「就地关闭」：所有 [推理] / [未验证] 标注必须在 plan 阶段执行 Read/grep/curl/tsc 命令贴结果归零；> 5 分钟 → 反问用户回到 /k:clarify；不可推迟到 task |

### 决策原则

按第一性原理收敛到 **3 件套（D + V + I）**，删除 6 条独立建议中的冗余：

- 「Evidence-driven」抽象概念 → ❌ 不引入（增加学习成本无实质约束力）
- 「步骤数 > 10 触发批次」机械阈值 → 保留但弱化（不再是粒度判据，由 5 信号决定步骤数）
- 「Spec 覆盖度对照表」自查 → 保留章节但承认其价值有限（机械化需 spec-lint 脚本支持，本批次不做）
- 「抽象审查」独立条款 → ❌ 不加（5 信号 + 信息缺口已间接覆盖）
- 「项目特定 Evidence」（如必跑 vitest）→ ❌ 通用模版不引入

### 验证

本次会话 Batch A 用新规则 mental run-through 对比：

| 维度 | 实际本次（旧规则） | 新规则下 |
|---|---:|---:|
| 工程类步骤数 | 18 | **5** |
| 验收类步骤数 | 1（打包） | **6** |
| 总步骤数 | 28 | **15** |
| Checkpoint 验证可信度 | 主观叙述 | 可执行命令必跑贴结果 |
| 信息缺口残留 | 推迟到 task | plan 阶段就地关闭 |

简单部分压缩（domain 4 步 → 1 步），复杂部分精细化（验收 1 步 → 6 步）。Token 增量 plan -30%，task 验证可信度显著提升。

---

## [2026-05-12.1] /k:analyze-live 加固：截断阈值、字段穷举、出口章节强制

### 背景

实测 `/k:analyze-live` 跑 sosovalue overview 模块后发现 3 个真实问题（对比同流程的 news-crypto 产物）：

1. **截断**：`getCurrencyDetail` response 实际 ~6KB，被拦截器硬编码 3000 字符截断，`tokenUnlocks` / `googleTrends` 等后段字段全部缺失。
2. **字段未穷举**：静态 F（类型定义）agent 输出"7 个关键类型"但未逐字段展开；同流程的 news-crypto 那次产物把 `Research.Post` 展到 40+ 字段。差异来自**派单时未强制**。
3. **出口章节缺失**：overview 文档收尾无"迁移充分性评估（🔴/🟡/🟢）"和"同页面同源接口边界"两节，导致用户无法直接据此判断"能不能动手迁"。

### 文件变更

| 文件 | 变更 |
|---|---|
| `.claude/kit/analyze-live/interceptor.template.js` | response 截断阈值 `3000 → 8000`（覆盖 XHR + fetch 两处）|
| `.claude/commands/k/analyze-live.md` | Step 4 派单红线增加「核心类型 / 派生 hook 必须逐字段成表」一条；HARD-GATES 新增 #11（出口两节强制）+ #12（字段穷举强制）；Step 8 核验维度新增「字段穷举」「出口章节」两行 |
| `.claude/kit/analyze-live/template.md` | 在「迁移充分性评估」前插入新强制章节「同页面同源接口边界」；两节均标注「**强制章节**」+ HARD-GATE #11 引用 |

### 决策原则

每条改动对应**一个实测后果**，不预防性设计。否决项：

- ❌ 不加 WebSocket 拦截器（90% 任务不需要；需要时单跑 `/k:debug-capture` 扩展）
- ❌ 不引入截断自动调档 / 多档配置（一个常数解决 80% 场景）
- ❌ 不加采集失败自动重跑（复杂、与 cleanup 冲突）
- ❌ 不新增脚本（现有 3 个脚本 + 1 个 template 已足够）

落地总规模：1 个常数 + 命令文本 ~6 行 + 模板章节标记 2 处。

---

## [2026-05-12] 新增 /k:analyze-live（双重分析：静态多 agent + 运行时 debug-capture）

### 背景

`/k:analyze` 为纯静态分析。3 次连续逆向分析实战发现：源码与运行时存在多处 hidden 矛盾（运行时 patch 覆盖硬编码参数、类型签名 number vs 实测 string、同项目内 camelCase / snake_case 命名风格混杂、response 实际多出未在 types 定义的字段），仅靠静态无法暴露。

`/k:analyze-live` 强制运行时 XHR/fetch 拦截 + 静态多 agent 并行 + 双向交叉校验 + 通用文档模板（非项目特定），适用于迁移前需 fixture-grade ground truth 的场景。

### 文件变更

| 文件 | 变更 |
|---|---|
| `.claude/commands/k/analyze-live.md` | 新增命令（264 行，引用脚本而非内联）|
| `.claude/kit/analyze-live/template.md` | 新增通用输出文档模板（章节顺序/表格列名固定）|
| `.claude/kit/analyze-live/interceptor.template.js` | 新增 XHR+fetch 双拦截器 JS 模板（`{{PORT}}` / `{{PATTERNS}}` 占位符）|
| `.claude/kit/analyze-live/scripts/inject.sh` | 新增注入脚本（渲染模板后追加到入口文件）|
| `.claude/kit/analyze-live/scripts/cleanup.sh` | 新增清理脚本（4 步：删 `[CAPTURE]` 行 / 报告 `[CAPTURE-TEMP]` / 停服 / 删日志）|
| `.claude/kit/analyze-live/scripts/analyze-log.sh` | 新增日志解析脚本（去重 + Markdown 输出）|

### 与 /k:analyze 的边界

| 命令 | 适用 | 产出 |
|---|---|---|
| `/k:analyze` | 仅看源码即可 / 项目无法本地启动 | 纯静态分析文档 |
| `/k:analyze-live` | 项目能本地起 + 需运行时 ground truth + 字段/类型可能不一致 | 静态 + 实测双重校验文档（含"实测 vs 源码"对账章节）|

### 关键设计

1. **命令本体只调脚本 + 调 agent + 写文档**，不在 prompt 内联拦截器代码、清理 bash、Python 解析等可脚本化逻辑。单次启动 token 降至 ~500（直接 prompt 约 3000+，约 -80%）。
2. **通用文档模板**：`analyze-live/template.md` 不含项目特定示例，仅章节结构 + 表格列名。
3. **拦截器自循环防护**：模板自带 `localhost:<PORT>` skip + `__CAPTURE_INSTALLED__` 防重复注入。
4. **`[CAPTURE-TEMP]` 标记**：临时配置改动（如 prod 网关切换）按此标记，`cleanup.sh` 只**报告**位置不自动回滚（生产风险防护）。
5. **强制对账章节**：文档必须含"实测 vs 源码"对账表，矛盾项必须进"存疑项"，不允许直接覆盖源码结论。

### 红线

1. 必须经过 debug-capture，无 runtime 数据不出文档
2. 拦截器代码每行带 `// [CAPTURE]`；临时配置改动每行带 `// [CAPTURE-TEMP]`
3. 文档必须含"实测 vs 源码"对账章节
4. 网关切到生产时只读，禁止写操作
5. UI 截图必须标注分析范围红框
6. 文档结构严格按 `.claude/kit/analyze-live/template.md` 章节顺序
7. 结束必调 `cleanup.sh` 完成 4 步清理

---

## [2026-05-11] 新增 /k:analyze（既有项目模块逆向分析）

### 背景

逆向分析既有项目（迁移参考 / 重构依据 / 知识沉淀）此前没有专用命令。`/k:clarify` 偏设计-实现路径，spec 模板的"验收标准 / 验收场景"对纯分析无意义，整段后半流程空转；`/k:study` 偏 GitHub 项目与 soso-kit 借鉴对比；`/k:context-learn` 偏代码逆向→Context 入库。三者与"现有模块的事实性分析"任务都有错配。

`/k:analyze` 沉淀本次 sosovalue-pc 币种页 News + Overview 分析会话中的可复用模式，固化为命令。

### 文件变更

| 文件 | 变更 |
|------|------|
| `commands/k/analyze.md` | 新增命令入口 |

### 核心设计

- **HARD-GATES**：纯分析零代码 / 表格每行必须 `file:line` / 不写迁移建议或目标技术栈专属概念 / 模糊点仅在源码无法定位时暂停
- **输入优先级**：spec 目录文档 → 任意路径 md → 文字描述 → 报错反问（禁止猜测）
- **复杂度判定**：根据子模块数 / 关注维度 / 跨文件耦合 / 业务分支自动分流
  - 简单 → 单 Explore agent 直出 + 一次核验
  - 复杂 → A→F 六任务编排（B/C/F 并行，D 依赖 B+C，E 依赖 B）+ 冲突 cross-check + 核验 agent 四维审查
- **6 章事实合并模板**：模块矩阵 / 接口 / 逻辑 / 分支 / 实时性 / 类型；**禁止**迁移建议 / 风险评估章节
- **核验四维**：真实性 / 完整性 / 遗漏 / 模糊度
- **产物路径**：`.claude/kit/spec/<topic-slug>-analysis.md`

### 与相邻命令边界

| 命令 | 适用场景 |
|---|---|
| `/k:clarify` | 要做的功能尚未明确 |
| `/k:spec` | 已确认设计准备进实现 |
| `/k:study` | 评估外部 GitHub 项目对工具链启发 |
| `/k:context-learn` | 代码逆向 → Context Library 入库 |
| **`/k:analyze`** | **理解现有代码（迁移参考 / 重构依据 / 知识沉淀）** |

### 触发示例

```
/k:analyze .claude/kit/spec/some-task.md
/k:analyze /abs/path/some.md
/k:analyze 分析 /xx/projectA 的支付模块，关注接口和处理逻辑
/k:analyze                                # 无输入 → 报错反问
```

---

## [2026-05-19] /k:spec 路由改为 AI 自动判定（2 问 + 红线）

### 背景

第一版路由方案用 5 条结构标准（文件数 / 模块边界 / 接口契约等），存在两个问题：

1. **结构指标是代理**：plan 真正解决的是"如何实现"的不确定性，结构小 ≠ 不需要 plan
2. **输出"建议"而非直接行动**：用户还得自己决定输入哪个命令，对 autonomous agent 不友好

### 改动内容

替换 5 条结构标准为 **2 问 + 1 红线 + AI 直接流转**：

| 项 | 内容 |
|----|------|
| 红线（最高优先级）| 涉及鉴权 / 资金 / 资产 / 数据持久化 → 强制 plan |
| 自检 1 | 路径清晰度（强制输出 3-5 句改动描述）|
| 自检 2 | 方案权衡（强制列出候选方案）|

**自动流转表**：

| 红线 | 路径 | 方案 | AI 行动 |
|------|------|------|---------|
| 触发 | - | - | 进入 plan |
| 未触发 | 清晰 | 无权衡 | 直接进入 task |
| 未触发 | 模糊 | - | 进入 plan |
| 未触发 | 清晰 | 有权衡 | 进入 plan |

### 设计优势

| 维度 | 5 条结构标准 | 2 问 + 红线 |
|------|------------|------------|
| 命中 plan 本质 | 间接（代理）| 直接 |
| 误判率 | 中（小改动可能复杂）| 低 |
| AI 自评难度 | 中（"shared 算什么"）| 易（能否描述出来）|
| 主观性风险 | - | 通过"强制输出"消除 |

### 主观性消除机制

不让 AI 只说"路径清晰"——要求 AI 必须实际写出 3-5 句改动描述、列出候选方案。  
写得出 = 真清晰，写不出 = 路径模糊。可验证。

### 与 autonomous agent 协同

去掉"输出建议"环节，AI 自己根据自检结果直接进入下一阶段（plan 或 task）。  
配合 `/k:auto-on`，整个 spec → task 链路可全自动化运行，无需人工触发命令。

### 背景

跨项目对话历史数据显示：

| 模式 | 会话数 | 占比 |
|------|--------|------|
| spec + plan + task（完整流程）| 28 | 43% |
| **spec + task（跳过 plan）** | **30** | **46%** |
| 只用 task | 7 | 11% |

跳过 plan 已经是主流模式（46% > 43%），但缺乏显式判定规则，AI 和用户都靠经验决定，不一致。

### 文件变更

| 文件 | 变更 |
|------|------|
| `commands/k/spec.md` | 末尾新增 "🔀 下一步路由（小任务判定）" 段，5 条硬指标判定 |

### 5 条判定标准

1. 预估改动非测试文件 ≤ 3 个，且单文件 < 150 行
2. 不新建 component / hook / page / shared 文件
3. 改动限单一 `features/<name>/` 或 `pages/<route>/` 内
4. 不变更接口契约（props / hook 签名 / store schema / API 字段 / 路由）
5. 不涉及核心业务（鉴权 / 资金 / 资产 / 数据持久化）

**全过 → 推荐跳过 plan；任一不过或拿不准 → 推荐走 plan（保守原则）**。

### 设计选择

为什么修改 spec 而不新建 /k:quick：

| 标准 | 修改 spec | /k:quick |
|------|----------|---------|
| 既有使用模式 | ✅ 30 次实证 | ❌ 无数据 |
| 实现成本 | 18 行 | ~120 行 + HARD-GATE |
| 既有心智 | ✅ 符合现行习惯 | ❌ 需要新概念 |
| 可逆性 | ✅ 撤回容易 | ❌ 用户已养成习惯难撤 |
| 80/20 法则 | ✅ 80% 价值 20% 成本 | ❌ 100% 价值 100% 成本 |

### Token 收益

| 场景 | 改前 | 改后 |
|------|------|------|
| spec → task 流（46% 会话）| 用户拍脑袋决定 | AI 5 条标准给建议 |
| spec.md 加载量 | 297 行 | 315 行（+18）|
| 误用 plan 的风险 | 中（拿不准就跑全套）| 低（保底原则）|

---

## [2026-05-19] 新增 /k:auto-on / /k:auto-off（Auto 模式）

### 背景

context 系统长期闲置的根因：`--c` 是 opt-in 标志，人工开发时容易忘记使用，autonomous agent 更不知道有这个标志。导致每次任务开始时 Claude 可能在不知道历史实现的情况下从零规划，重复踩坑。

Auto 模式解决这一问题：开启后 `/k:spec` 和 `/k:clarify` 自动搜索 context，无需手动传 `--c`。

### 文件变更

| 文件 | 变更 |
|------|------|
| `commands/k/auto-on.md` | 新增，调用 `kit/auto/auto-on.sh` |
| `commands/k/auto-off.md` | 新增，调用 `kit/auto/auto-off.sh` |
| `kit/auto/auto-on.sh` | 新增，写入 `.claude/kit/spec/AUTO` 状态文件 |
| `kit/auto/auto-off.sh` | 新增，删除状态文件 |
| `kit/auto/check.sh` | 新增，供 spec/clarify 检查当前模式（exit 0=on，1=off）|
| `commands/k/spec.md` Step 1 | 新增 auto 模式检查，存在 AUTO 文件则自动以智能模式运行 |
| `commands/k/clarify.md` Step 1 | 新增 auto 模式检查，存在 AUTO 文件则自动搜索 context |
| `.gitignore` | 新增 `.claude/kit/spec/AUTO`（防 soso-kit 开发时误提交）|

### 设计决策

- **状态文件位置**：`.claude/kit/spec/AUTO`（项目 `.claude/` 已被 gitignore，天然不追踪，无需项目侧改动）
- **脚本化**：逻辑抽到 `kit/auto/*.sh`，命令文件保持 3 行，token 消耗极低
- **持久化**：状态跨会话保持，重开 Claude Code 不需要重设；agent 启动时执行一次 `/k:auto-on` 即可
- **token 影响**：auto-off 状态下零额外消耗；auto-on 状态下每次 spec/clarify 多执行一次 context 搜索（~100 token）

### 提升

| 场景 | 改前 | 改后 |
|------|------|------|
| context 使用率 | 低（依赖记忆 `--c`）| auto-on 后自动搜索 |
| autonomous agent | 不支持（不知道 `--c`）| 开机执行 `/k:auto-on` 即可 |
| 命令文件 token | inline bash | 3 行调用脚本 |
| 跨会话状态 | 无 | 文件持久化 |

---

## [2026-05-10] /k:debug-on 加元原则 + 迭代防回退

### 背景

实际使用中暴露 AI 行为问题：debug 命令本意是"用数据替代推理"，但 AI 在 Phase 1 容易陷入静态分析循环（反复读代码试图推断答案），失败后又回头重读代码 + 重做假设，单 session 浪费 50000+ token。

根因：AI 默认偏好"看起来确定"的输出（推理 + 论证），抗拒"承认未知"（直接插桩）。Phase 1 描述"理解代码路径"无边界，没有"何时停止分析、立即插桩"的判断标准。

### 文件变更

| 文件 | 变更 | 强度 |
|------|------|------|
| `commands/k/debug-on.md` 核心目的后 | 新增"元原则"段（D）：明确 token 经济学（120:1）+ 4 类反模式禁止 | 🟡 中（软引导，AI 看到了不一定遵守）|
| `commands/k/debug-on.md` Phase 5 失败回退 | 新增"迭代防回退规则"（C）：禁止重读已读文件 / 禁止回 Phase 1 / 仅允许加密插桩 | 🟢 强（硬规则）|

### Token 收益（用户描述场景）

| 阶段 | 改前 | 改后 | 节省 |
|------|------|------|------|
| 第 1 轮 Phase 1 静态分析 | ~12000 | ~2000 | -83% |
| 第 2-5 轮迭代（重读+重推）| ~60000 | ~8000 | -87% |
| 命令文件加载（一次性）| 219 行 | 244 行 | +180 token |
| **5 轮 session 总计** | **~75000** | **~13000** | **-83%** |

### 已知局限

- D（元原则）是软引导，AI 可能合理化"这次特殊"
- C（防回退）覆盖 Phase 5 失败回退，第 1 轮一上来就过度展开仍可能发生（依赖 D 兜底）
- 真需要深读的复杂 bug 可能被误伤（罕见）

### 同步

- `commands/k/debug-on.md`（主仓库）
- `sodex-next/.claude/commands/k/debug-on.md`（已同步）

---

## [2026-05-06] strict-vs-cumbersome 原则落地（4 enforcement + 1 脚本）

来源：`wcRelayRestart` 迁移复盘暴露 7 类问题（agreeable bias / 跨文档矛盾 / absence-of-evidence / 元认知盲区等），归纳为新原则文档 `.claude/kit/principles/strict-vs-cumbersome.md` v1.0.0。完整背景 / 设计 / token 预算见原则文档。

### 文件变更

| 文件 | 变更 | 强度 |
|------|------|------|
| `kit/clarify/scripts/spec-lint.sh`（新建） | 占位符 / 场景编号 / 必要章节核查 | 🟢 强（脚本必跑） |
| `commands/k/clarify.md` Step 6.0 | 调用 spec-lint，先跑后自检 | 🟢 强 |
| `kit/check/templates/checklist.md` 新增 CHK-04c | 跨文档决策一致性扫描 | 🟡 中（依赖 AI 跑 grep） |
| `commands/k/plan.md` Step 4-C | 信息缺口自审（1 项强制输出） | 🟡 中 |
| `commands/k/plan.md` 确认流转 | 风险披露段（反 agreeable bias） | 🟡 中 |

### 已知局限

- 4 个 🟡 enforcement 触发率未验证；观察 2-3 次真实需求；触发率 ≈ 0 则砍
- 元认知陷阱（信息缺口 / absence-of-evidence）AI 自检识别能力受限，规则形式难根治

### 兼容性

`.claude/rules/` 14 文件不动；命令外部行为不变（仅多 1 段强制输出）。

---


## [2026-04-29] /k/plan 修复 spec→plan 需求丢失

### 问题

spec 阶段到 plan 阶段存在需求细节丢失，根因不在"对话压缩"，而在 `plan.md` 执行顺序设计：

- Step 3 拆步骤时**不读 spec 原文**，依据"对话上下文里 spec 阶段输出的摘要"
- Step 5 才读 spec，但只用 awk 切"验收"章节（用户故事/边界/异常被忽略）
- 静默通过 → 无留痕，丢失不可见
- Step 4 仅两行口号，步骤间逻辑无人校验

### 修复策略

把信息源从"对话摘要"换回"spec 原文"，三道防线 + 强制留痕。

| 防线 | 拦截 | 失败模式 |
|------|------|---------|
| Step 0.5 + Step 1/3 信息源约束 | 信息源错（依赖摘要而非原文） | silent |
| Step 4（升级） | 计划结构错（顺序/依赖/CHECKPOINT） | 半 silent |
| Step 5（重写） | 需求遗漏（spec 章节未覆盖） | silent |

### 文件变更

| 操作 | 内容 |
|------|------|
| 新增 Step 0.5 | grep spec 章节标题作为信息源锚点；三档 fallback（章节模式 / 全文行号 / prompt-only） |
| 注入 Step 1/3 约束 | 显式禁止依赖对话里 spec 摘要拆步骤 |
| 升级 Step 4 | "风险评估" → "风险与计划自审"；新增审查者视角 + 强制对照表（步骤顺序/依赖标注/CHECKPOINT 完整性）+ HARD-GATE |
| 重写 Step 5 | 删除 awk 切片；改为全章节强制对照表；保留 HARD-GATE |

### 核心改进

| 维度 | 改前 | 改后 |
|------|------|------|
| 拆步骤信息源 | 对话摘要 | spec 原文按章节读 |
| 覆盖范围 | 仅"验收"章节 | 全部 H2/H3 |
| 覆盖留痕 | 静默通过 | 强制对照表 |
| 步骤间逻辑校验 | 无 | 强制对照表 |
| 闸门数量 | 1 道（用户确认） | 3 道（Step 4 + Step 5 + 用户确认） |
| fallback 健壮性 | awk 切片单点 | 三档 fallback |

### Token 影响

| 场景 | 增量 |
|------|------|
| 短 spec（<200 行） | +700-1200 token（对照表 + 章节读取） |
| 长 spec（>500 行） | 与现状持平或略省（分章读避免一次塞全文） |

### 兼容性

- `spec.md` / `task.md` 不动
- `plan-temp.md` 格式不变
- CHECKPOINT 机制不变
- 用户输入习惯不变
- 修复 zsh 空目录 nomatch 报错（改用 find 替代 ls glob）

### 已知局限

- 所有 HARD-GATE 是 prompt 层约束，无脚本强制
- 对照表真实性依赖 AI 诚实，无外部校验
- 拆步骤是否真的不依赖摘要 → 依赖 AI 服从指令的可靠性
- 阶段 2（脚本强制 / spec 模板化 / task 闭环）暂缓，待实际效果观察

---

## [2026-04-29] 拆分 /k/debug 为 /k/debug-on + /k/debug-off + /k/debug-capture

### 拆分动因

| 问题 | 原因 |
|------|------|
| 服务器生命周期不透明 | 单一命令隐藏 Phase 0 启动 / Phase 6 关闭，用户无显式状态感知 |
| 大日志文件 AI 全量读取受 2000 行截断 | 多轮迭代后 debug.log 累积，Read 工具默认读前 2000 行，可能漏读最新条目 |
| capture 模式 token 高 | 每次加载 debug.md (200) + capture.md (108) = 308 行 |
| 多轮迭代旧数据污染 | 没有显式轮次边界，AI 难以区分本轮 vs 上轮数据 |

### 命令拆分

| 命令 | 模型 | 用途 |
|------|------|------|
| `/k:debug-on <bug>` | 半生命周期 | 启动 session + 完整工作流（Phase 0-5） |
| `/k:debug-off` | 半生命周期 | 清理 `// [DEBUG:` 插桩 + 删 log + 停服务 |
| `/k:debug-capture` | 自包含 | API 采集（含完整启动、清理 `// [CAPTURE]`、停服务） |

### 核心机制：ITER_START 轮次标记

- AI 在每轮 Phase 4 开始前通过 server `/log` 端点写入 `[ITER_START]` 标记 entry
- 读取时用 `grep -n '\[ITER_START\]' | tail -1 | cut -d: -f1` 定位最新轮起始行号
- Read 工具加 `offset` 精确读取本轮，**文件大小不再影响读取**
- server.js 零改动（标记走同一接口）
- 双层粒度：ITER_START（轮次） + sessionStart（页面刷新）

### 文件变更

| 操作 | 文件 |
|------|------|
| 新建 | `.claude/commands/k/debug-on.md` |
| 新建 | `.claude/commands/k/debug-off.md` |
| 新建 | `.claude/commands/k/debug-capture.md`（inline 原 capture.md 内容） |
| 删除 | `.claude/commands/k/debug.md` |
| 删除 | `.claude/kit/debug/templates/capture.md`（内容已 inline） |
| 修改 | `.claude/kit/migration/commands/analyze.md`（L60/63/67 引用更新） |
| 修改 | `.claude/kit/migration/commands/execute.md`（L37/38 加"完成后 off"提示） |
| 修改 | `.claude/kit/migration/commands/verify.md`（L65 加"完成后 off"提示） |

### Token 收益

| 场景 | 之前 | 之后 | 变化 |
|------|------|------|------|
| 调试触发 | debug.md ~200 行 | debug-on.md ~170 行 | -15% |
| 采集触发 | debug.md (200) + capture.md (108) = 308 行 | debug-capture.md ~150 行 | **-51%** |
| 清理触发 | 含在 200 行内 | debug-off.md ~40 行 | 几乎免费 |
| 多轮分析 log 读取 | 累积读全量 | 仅读本轮（grep + offset） | **-60%** |

### 决策

- **不归档** debug.log（直接删除，与 Cursor / DevTools 一致）
- debug-on 启动时残留 debug.log → 直接删除
- ITER_START **仅用于 debug-on**（capture 是单次流程不需要）
- debug-on/off 与 debug-capture **职责互不越界**：debug-off 仅清 `// [DEBUG:`，debug-capture 自包含清 `// [CAPTURE]`，幂等执行
- `--capture` flag（migration analyze 自身）保留，仅改后面调用的命令名

### 不改动的部分

- `server.js` / `start-server.sh` 零改动
- 历史日志（`migration/records/` / `migration/logs/`）保留原引用
- CHANGELOG 历史记录不改写

---

## [2026-04-22] `/k:migration records` 子命令:跨迁移方法论坑独立归档

### 背景

sodex-web → sodex-next 首轮 vault 迁移后复盘发现:

- 单次迁移产生的"问题"混杂了三层语义:**本次具体 bug / 跨迁移方法论坑 / 项目通用写代码坑**
- 现有 `finalize` Step 3 一刀切走 `/k/context-pitfall add`,导致"迁移方法论坑"(如老项目 baseURL 常量命名误导、ui-migration Phase 1 产物清理)污染项目 pitfall 库
- 跨迁移通用的坑有长期复用价值(下次迁移别的 feature 还会中招),应独立存放、随 kit 分发

### 变更

#### 新增:`kit/migration/records/` 跨迁移方法论坑目录

| 文件 | 说明 |
|---|---|
| `records/index.md` | 精简索引(每条 1-2 行),供 analyze 注入 |
| `records/api-contract.md` | API 契约类坑(如 `api-contract:baseURL-naming`) |
| `records/layering.md` | 分层/归属决策坑(如 `structure:feature-vs-shared-const`) |
| `records/cleanup.md` | 阶段产物清理坑(如 `cleanup:ui-migration-stub`) |

初始录入 3 条 record(来自 sodex-next vault 迁移复盘,经用户筛选)。

#### 新增:`kit/migration/commands/records.md` 5-verb 子命令

仿 `context-pitfall` 结构,但更轻量——纯 markdown 维护,无 index.json 脚本:

```
/k:migration records list              # cat index.md
/k:migration records load <id>         # awk 解析 id→分类,cat 详情
/k:migration records add               # 引导填字段,Write 追加,Edit index
/k:migration records update <id>       # Edit 更新对应段
/k:migration records remove <id>       # 确认后 Edit 移除段 + 更新 index
```

#### 改动:路由 + 数据流集成

| 文件 | 改动 |
|---|---|
| `commands/k/migration.md` | Step 1 case 加 `records)` 分支;项目级数据流说明补充 records 机制;新增「Records 子命令」小节说明与 pitfall 的独立关系 |
| `kit/migration/commands/analyze.md` | Step 4 后新增 Step 4.5:`cat kit/migration/records/index.md` 全量注入索引(~500-800 tokens,详情按需 Read) |
| `kit/migration/commands/verify.md` | Step 4 后新增 Step 4.5:聚合本次问题到 `logs/<featureId>/records-candidates.md`(只聚合不判断) |
| `kit/migration/commands/finalize.md` | Step 3 从"单一 pitfall 录入"改为「三层分流交互」:逐条展示 candidates,用户选 `[a]records / [p]pitfall / [h]history / [s]skip / [e]edit`;Step 6 完成输出区分 Records 与 Pitfall |

### 设计要点

**为什么独立于 pitfall**:

| | pitfall | records |
|---|---|---|
| 归属 | 项目级(PROJECT_NAME 隔离) | kit 级(跨项目,随 kit 分发) |
| 内容 | 项目业务坑 | 迁移工具方法论坑 |
| 生命周期 | 项目寿命 | 所有 migration 共用 |
| 膨胀速度 | 快(每个 feature 都能踩) | 慢(方法论天花板低) |

**verify→finalize 数据流避免重复 token**:

- verify 末尾聚合 candidates(~150-200 tokens)
- finalize 读 candidates 做分流(~200-400 tokens)
- 不需要 AI 在 finalize 重新扫描 history 回忆问题

**单次 migration token 增量** ≈ 1.2-1.9k,换重复踩坑的 debug 成本,划算。

### 测试

- 目录结构自洽:4 份 md 齐全(index + 3 分类)
- `list` 流程:`cat index.md` 输出完整索引表
- `load` 流程:3 个合法 id 都能正确 awk 解析到分类文件(`api-contract:baseURL-naming→api-contract.md` 等);不存在的 id 返回空(不误匹配)
- 路由:`migration.md` Step 1 `records)` 分支正确指向 `$MIGRATION_DIR/commands/records.md`

### 风险

- `records` 目录手动维护 markdown,多条记录共享分类 md 时,`add/remove` 需在文件中定位 `## <id>` 段,依赖 Edit 工具精确匹配——条目数增长后可能需要脚本化(参考 pitfall 的 index.json 方案)。当前 3 条规模手动可控。
- finalize 的交互分流靠用户逐条选择——如果迁移问题数量 >10,单步时长增加。预期初期维持在 3-8 条。

---

## [2026-04-21] token 优化后续修复:撤销 check bug + task 分档 + plan 兼容性

### 背景

对前一条 token 优化做同日审查,发现三处逻辑/边界问题:
1. **`check.md` Step 0.5 是 bug**:`git status --porcelain` 为空时跳过 check,会漏掉 post-commit review / pre-push 审查场景,静默 exit 0
2. **`task.md` 一刀切"批次内不跑 tsc"**:长批次(8+ 步)错误级联到 checkpoint 才暴露,修复代价更大
3. **`plan.md` sed 正则过窄**:只认"## 验收",英文 spec / 换用"## 验证场景"标题的 spec 会匹配为空,误判"无验收标准"通过

### 变更

| 文件 | 修复 |
|------|------|
| `commands/k/check.md` | **撤销** Step 0.5(移除"无改动跳过"逻辑),恢复为无条件执行 |
| `commands/k/task.md` | 验证节奏规则按批次大小分 3 档:≤3 步仅 checkpoint / 4-7 步中点+checkpoint / 8+ 步每 3 步跑。增加例外 2:编译错/类型错立即修不推迟 |
| `commands/k/plan.md` Step 5 | 切片正则扩展为 `(验收\|Acceptance\|验证场景\|Verification)`。新增 fallback:切片空或 <3 行 → 退化为读全文 |

### 测试

- `check.md` grep 验证 Step 0.5 已完全移除
- `task.md` 分档规则 5 行 grep 命中(小/中/大批次 + 例外 1 + 例外 2)
- `plan.md` awk 切片真实测试:对 `01c-tabs-ui.md` 切出 24 行验收段落(自动+手动+归档),开头为 `## 验收`,停在下一个非"验/A"前缀段落,行为正确

### 风险评估(保留的残余风险)

- **task.md "每 3 步"依赖模型自律计数**,无强制机制;可接受(模型借 TaskCreate 列表追踪)
- **plan.md fallback 阈值 3 行**:极短验收段(<3 行)会误退化为全文读;发生率极低,且"读多"比"读少漏验收项"安全

---

## [2026-04-21] `/k:task` / `/k:plan` / `/k:check` / `/k:context` token 优化

### 背景

vault 迁移回顾发现工作流存在系统性 token 浪费:
- `/k:task` 每单步都跑 tsc → 20+ 次重复,大部分是无改动的空验证
- `/k:plan` 读 spec 全文 → 只需验收章节
- `/k:check` 即使无改动也走完整 checklist → 空跑
- `/k:context` 默认建议不清,容易 load 过量

### 变更

| 文件 | 变更 |
|------|------|
| `commands/k/task.md` | CHECKPOINT 统一跑 tsc/lint;批次内单步禁止;shared/ui 改动例外(红线) |
| `commands/k/plan.md` Step 5 | Spec 覆盖度自检只读"验收标准 / 验收场景"章节,`sed` 精准切片 |
| `commands/k/check.md` Step 0.5(新增) | 无 git 改动时整个 check 跳过,立即退出 |
| `commands/k/context.md` Step 4 | 补充 token 优化提示:先 `outline` 再 `load`/`unfold`,不无差别全量加载 |

### 预期收益

| 场景 | Token 节省 |
|---|---|
| 单 batch 10 步迁移(task) | ~60% validation token |
| spec 有长设计章节(plan) | ~30% spec 读取 token |
| 无改动 check(CI/空调用) | ~100%(直接退出) |
| context 查询(大 feature) | ~50%(outline 替代 load) |

### 测试

- 4 个文件 grep 校验改动落地,结构无语法错误
- task.md 验证节奏规则嵌入 CHECKPOINT 段落前后逻辑连贯
- check.md Step 0.5 放在 Step 1 之前,不破坏 `--r` 分支

---

## [2026-04-21] `/k:ui-migration` 新增 Step 0.5 旧项目代码对照 + 冲突裁决 + 理解度自检

## [2026-04-21] `/k:ui-migration` 新增 Step 0.5 旧项目代码对照 + 冲突裁决 + 理解度自检

### 背景

本次 sodex-web → sodex-next vault Activity/Depositors 迁移中暴露问题:命令原流程(figma → props 化 → 落地)完全不读旧项目代码,导致:
- 自创 2 列布局(实际旧代码是 3 列)
- 漏 `whitespace-nowrap` / `w-fit` / `minWidth` / `isFlatBottom` 等关键钩子
- PC vs Mobile 拆列差异靠猜
- 反复返工 5 轮才定稿,消耗约 15k token 在视觉 debug 上

根因:Figma 是**静态视觉**,旧代码才是**动态行为真相源**(列拆分/溢出处理/响应式切换/边界态)。

### 变更

| 文件 | 变更 |
|------|------|
| `commands/k/ui-migration.md` 参数格式 | 新增 `[--legacy <path>]` 参数,支持显式指定旧代码路径 |
| `commands/k/ui-migration.md` Step 0.5(新增) | 旧项目代码对照五子步:0.5.1 定位(明示化)/ 0.5.2 grep 信号轻量扫描 / 0.5.3 按需精读 / 0.5.4 结构化 legacy-notes / 0.5.5 缓存复用 |
| `commands/k/ui-migration.md` Step 2.0.5(新增) | 改造前强制读 legacy-notes,列/钩子按 notes 实现,不自创 |
| `commands/k/ui-migration.md` Step 2.0.6(新增) | Figma ↔ Legacy 冲突硬中断,默认"旧代码优先",显式列表让用户仲裁 |
| `commands/k/ui-migration.md` Step 3.5(新增) | 落地后理解度自检表(列数/钩子位置/i18n 策略等),⚠️ 项写入 handoff 悬挂问题 |
| `commands/k/ui-migration.md` Token 预算 | 更新为四档预估(迁移首次 / 新功能 / 二次调用),说明优化路径 |

### 方案核心思想

**不追求 100% 保障,追求"可发现失败"**:
- auto-locate 即使命中也**必须用户确认路径**,避免选错文件
- figma↔legacy 冲突**硬中断**让用户仲裁,不静默处理
- 理解度自检表**强制输出对齐结果**,⚠️ 悬挂问题交下游

### Token 优化(三级)

1. **grep 信号先行**:不全文读旧代码,先 grep 关键符号(structure/responsive/style hook/state)生成 signals,通常 <50 行
2. **按需精读 + section 切片**:仅当 signals 命中列表/表格/响应式才精读,且用 sed/awk 按 section 切片(`columns = [...]`),非全文吃
3. **缓存复用**:legacy-notes.md 比旧代码新 → 直接跳过读取

| 场景 | 原方案 | 优化后 |
|---|---|---|
| 迁移首次 + 表格类 | +3.8k | +1.2k |
| 新功能 / 纯 Panel | +3.8k | +0.1k(仅判断) |
| 二次调用同 feature | +3.8k | 0(缓存) |

### 测试

- 结构化验证:`grep -nE "^## Step|^### [0-9]"` 确认 15 个 section 序号连续、嵌套正确
- bash 片段为文档示例(供模型参考),不在命令执行时被 shell 解析

### 预期收益

- 迁移场景单次通过率:从 ~40%(需 5 轮返工)提升至 ~85%(需 1-2 轮)
- Token 净收益:+10-20% 增量 vs 省下 10k+ 返工,净节省 ~50%
- 失败模式可观测:路径错/冲突在改造前就暴露,不是 UI 呈现后才发现

---

## [2026-04-19] `/k:ui-migration` few-shot 示例库 + 红线合规方案文档

### 背景

`/k:ui-migration` Phase 1 依赖模型读规则文档自行推理合规（`use-shared-ui` / `figma-style-mapping` / `modal-component-style`），token 消耗高且易漏条。计划用 few-shot 示例替代规则加载 + 红线合规机械化，但需分阶段落地，避免过度设计。

### 变更

| 文件 | 变更 |
|------|------|
| `kit/ui-migration/examples/README.md`（新增） | 示例库索引：按组件类型（panel/form/dialog）选示例，明确硬约束和维护规则 |
| `kit/ui-migration/examples/panel.example.tsx`（新增） | 展示面板 synthetic 示例，覆盖 shared/ui 基础替换 + CSS var + props interface |
| `kit/ui-migration/examples/form.example.tsx`（新增） | 表单 synthetic 示例，覆盖条件渲染 + 事件命名 + 受控组件 |
| `kit/ui-migration/examples/dialog.example.tsx`（新增） | 弹窗 synthetic 示例，覆盖壳层剥离 + `openXxxDialog` 模板 + `ModalInjectedProps` |
| `kit/ui-migration/compliance.md`（新增） | 红线合规三层防御方案文档（Layer 1 映射 / Layer 2 示例 / Layer 3 grep 校验），含触发执行的条件判定，**当前仅 Layer 2 落地** |
| `commands/k/ui-migration.md` Step 2.0 | 新增：按组件类型加载对应示例作为风格锚点，替代加载 `.claude/rules/` 规则文档 |

### 方案选择

采用分阶段策略，避免过度设计：

- **已执行（Phase 1.2）**：Layer 2 few-shot 示例库 —— 立即可用，维护成本低
- **待执行（条件触发）**：Layer 1 机械映射 JSON + Layer 3 grep 校验脚本 —— 跑完 5+ 真实组件后根据违规率决定

### 测试

- 3 份 .tsx 示例通过 TypeScript transpile 语法校验
- 反向跑 Layer 3 grep 规则验证示例本身合规（发现注释误报问题，修正注释措辞后通过，已写入 `compliance.md` 已知坑点）

### 预期收益

- ui-migration token 降低约 50%（规则加载 ~1300 → 示例加载 ~200）
- 合规稳定性提升（模式匹配 > 规则推理）
- Phase 2 可直接用真实迁移成品替换 synthetic

---

## [2026-04-19] Step 0.0 兜底强化(v1.11.1)

### 背景

v1.11.0 Step 0.0 的两个兜底分支(未识别项目 / 已识别但无 `kit/projects/` 骨架)仅为文字约定,无机器级保证,Claude 行为在边界场景可能漂移。

### 变更

| 文件 | 变更 |
|------|------|
| `commands/k/ui.md` Step 0.0 | 新增 `--project <name>` 解析;兜底 1(未识别)→ `exit 1` 硬退出;兜底 2(无骨架)→ `HAS_PROJECT_KIT=false` 警告且回退,不退出;后续 Step 按 `HAS_PROJECT_KIT` 分支 |
| `commands/k/figma.md` Step 0.0 | 同上处理 |

### 方案选择

采用方案 B(保守迁移):

- 兜底 1(未注册)→ 硬退出,强制用户先 `sosokit-add` 或显式 `--project`
- 兜底 2(无骨架)→ 保留非退出兜底,给老项目渐进迁移窗口,避免破坏兼容

> v1.12+ 待所有项目迁移完成后,可考虑将兜底 2 也改为硬退出

---

## [2026-04-19] `/k:ui` 接入 kit/projects/ —— 项目级规范切换(v1.11.0)

### 背景

v1.10.0 已让 `/k:figma` 接入 `kit/projects/<cur>/` 加载协议(Step 0.0 识别 + L0 读 PROJECT.md + L1 按需读 + 末尾自检),但 `/k:ui` 仍沿用旧"共享规范(单一信息源)"模式,硬编码指向 `kit/figma/references/*` 旧路径,无法按项目切换规范,也无自检闭环。

本次改造让 `/k:ui` 完全对齐 `/k:figma` v1.10.0 模式,统一两命令的加载协议。

### 变更

| 文件 | 变更 |
|------|------|
| `commands/k/ui.md` | **新增 Step 0.0**:项目识别(`identify_project`)+ L0 加载(Read `PROJECT.md`,自动 `@` 引用 `constraints.md`);识别失败兜底提示 `--project <name>` |
| `commands/k/ui.md` | **修改"共享规范"表为三级加载优先级**:(1)最高 `kit/projects/<cur>/{tokens,figma-mapping,components,patterns,style-checklist}.md`;(2)`rules/figma-style-mapping.md`(Figma 变量兜底);(3)旧路径 `kit/figma/references/*`(未迁移老项目兼容) |
| `commands/k/ui.md` | **新增 Step 6**:完成改动后 Read `style-checklist.md` 按"自检顺序"核对,回复末尾追加"使用的 token 清单 / 硬编码豁免 / 偏离项" |

### 加载协议(v1.11.0+,与 `/k:figma` 对齐)

```
/k:ui 启动
  ├─ Step 0.0  identify_project → <cur>
  ├─ Step 0.0  Read kit/projects/<cur>/PROJECT.md         (L0 必读)
  ├─ Step 0.0  @ 自动引用 kit/projects/<cur>/constraints.md
  ├─ Step 0    preflight.sh 前置检查(不变)
  ├─ Step 1-5  模式分支 / 用户输入解析 / 代码读取 / 结构化理解 / 反问(不变)
  └─ Step 6    Read kit/projects/<cur>/style-checklist.md (L1 自检)
```

### 效果

- **两命令协议统一**:`/k:ui` 和 `/k:figma` 共享同一套项目级加载模式,维护者认知成本减一半
- **按项目切换规范**:不同项目的 `/k:ui` 自动读对应 `kit/projects/<p>/` 规范,不再硬编码旧路径
- **自检闭环**:生成后按 `style-checklist.md` 核对,产出"token 清单 / 豁免 / 偏离"写入回复
- **旧路径兼容**:三级优先级保证未迁移到 `kit/projects/` 的老项目仍可运行(走旧路径兜底)

### 非目标

- 非 `/k:ui` `/k:figma` 的命令(`/k:task` 等)本期不改造;改 UI 代码时依赖 rules always-on 红线 + 红线末尾"详情查阅"段指引 Claude 主动 Read `kit/projects/`(详见 `kit/cli/CHANGELOG.md` v1.11.0 职责分层说明)

---

## [2026-04-19] `/k:plan` + `/k:task` 任务状态双维度标记

### 背景

旧规范要求所有任务保持 `pending`,仅改 subject 前缀 `○→✓` 标记完成,理由是"担心 completed 排序变化"。实际使用暴露问题:

- UI 层 checkbox `□` 永远未勾选,subject 里写 `✓` → 视觉矛盾(同一行既未完成又已完成)
- 列表底部永远显示 `+N pending` → 进度停滞观感
- 跨 session 续接时,无法用 status 过滤已完成项,必须解析 subject 文本
- 实测 completed 仅样式变化(删除线),顺序不变,原担忧不成立

### 变更

| 文件 | 变更 |
|------|------|
| `commands/k/plan.md:154-157` | 图标规范改为 **status + subject 前缀双维度**:创建 `pending`+`○`;完成 `completed`+`✓`;Checkpoint 批次内 pending,验收通过后 completed |
| `commands/k/task.md:101-104` | Step 3 更新:完成时一次 TaskUpdate 同步 `status=completed` + 前缀 `○→✓`,移除"禁止修改 status"约束 |
| `commands/k/task.md:146-150` | 状态管理规范同步重写 |

### 效果

- UI checkbox 与 subject 前缀语义对齐,不再矛盾
- 已完成任务标 completed,进度视觉正确
- 跨 session 可用 `TaskList` 按 status 快速过滤,前缀保留作语义双保险
- 完成一步仍只需 1 次 TaskUpdate,无额外开销

### 测试验证

创建 3 条测试任务(T1 步骤 / T2 步骤 / CHECKPOINT-T),走完"创建 pending+○ → in_progress → completed+✓ → 批次验收 completed",TaskList 输出顺序稳定、状态与前缀一致。

---

## [2026-04-19] `/k:figma` 接入 kit/projects/ — 项目级规范切换(v1.10.0)

### 背景

v1.10.0 基建 `kit/projects/<name>/` 承接项目级查阅数据(参见 `kit/cli/CHANGELOG.md` v1.10.0)。`/k:figma` 原本硬编码读 `kit/figma/references/specification.md`(sodex-web 标准),在 sodex-next 会读错项目规范。

本次改造让 `/k:figma` **按项目识别结果自动切换规范**,解决上版本遗留的"家族 overrides 未实现"问题(部分解决 figma 相关那部分)。

### 变更

| 文件 | 变更 |
|------|------|
| `commands/k/figma.md` | **新增 Step 0.0**:项目识别(`identify_project`)+ L0 加载(Read `PROJECT.md`,自动 `@` 引用 `constraints.md`);识别失败兜底提示 `--project <name>` |
| `commands/k/figma.md` | **修改 Step 4 优先级**:`kit/projects/<cur>/figma-mapping.md + tokens.md` 设为最高优先,`rules/figma-style-mapping.md` 次之,`kit/figma/references/*` 兜底 |
| `commands/k/figma.md` | **新增 Step 9**:生成代码后 Read `style-checklist.md` 按"自检顺序"核对,产出"使用的 token 清单 / 硬编码豁免 / 偏离项" |

### 加载协议(v1.10.0+)

```
/k:figma 启动
  ├─ Step 0.0  identify_project → <cur>
  ├─ Step 0.0  Read kit/projects/<cur>/PROJECT.md         (L0 必读)
  ├─ Step 0.0  @ 自动引用 kit/projects/<cur>/constraints.md
  ├─ Step 0    tailwind token 感知(保留)
  ├─ Step 1-3  URL 解析 / MCP 拉取 / 图片处理(不变)
  ├─ Step 4    Read kit/projects/<cur>/figma-mapping.md + tokens.md  (L1 按需,最高优先)
  ├─ Step 5-8  样式转换 / 组件匹配 / 代码生成 / 输出(不变)
  └─ Step 9    Read kit/projects/<cur>/style-checklist.md  (L1 自检)
```

### 效果

- **按项目切换规范**:sodex-web 读 `kit/projects/sodex-web/figma-mapping.md`(hex 方括号模式);sodex-next 读 `kit/projects/sodex-next/figma-mapping.md`(完整 token 体系)。同一命令、两套项目、零硬编码
- **渐进加载**:Step 0.0 只 Read ~50 行 PROJECT.md + constraints.md;Step 4 按任务需要读子文件;不再一次性拉全 references 目录
- **自检闭环**:Step 9 按 `style-checklist.md` 的"过程指针"对照 constraints / tokens,避免和其他文件内容冗余
- **兜底保留**:若 `kit/projects/<cur>/` 不存在(老项目未迁移),回退到原 Step 0 + `kit/figma/references/specification.md` 路径

### 非目标(本次不做)

- **`/k:ui` 未改造**:留给 v1.11.0。本轮只动 `/k:figma`,两命令暂时不共享 kit/projects/ 加载协议
- **rules 瘦身未做**:`.claude/rules/figma-style-mapping.md` 仍含大数据表。`/k:figma` 加载优先级已把 `kit/projects/` 放最高,rules 实际上成为兜底;v1.11.0 瘦身后可彻底去重

---

## [2026-04-19] 新增 `/k:figma` — figma-mcp-restore skill 改造为命令

### 背景

原 `figma-mcp-restore` skill（643 行）通过 description 被动触发，存在两个痛点：一是 SKILL.md 本身较厚但混入项目特定硬编码；二是 figma 还原属于强意图任务，用户贴 URL 时意图已明确，被动匹配反而不如显式命令可靠。

既然已经有 `/k:ui`、`/k:spec`、`/k:plan` 命名空间，把 figma 还原并入 `/k:` 形成完整 UI 工作流更自然。

### 变更

| 文件 | 变更 |
|------|------|
| `commands/k/figma.md` | **新增**，由原 SKILL.md 瘦身而来（~280 行），保留 Step 0-8 完整流程，删除 3 个使用示例（命令文件宜薄） |
| `kit/figma/references/` | **新增**，迁移原 skill 的 5 个 references（base/specification/specification-project/components/patterns） |
| `kit/figma/scripts/` | **新增**，迁移 sync-tailwind-tokens.sh（`SKILL_DIR` → `FIGMA_DIR`）、analyze.js、transform.js |
| `skills/figma-mcp-restore/` | **删除** |
| `commands/k/ui.md` | references 路径 `skills/figma-mcp-restore/references/` → `kit/figma/references/`；顺手修正 `.mdc` → `.md` |
| `commands/k/mastery.md` | SKILL_LIST 示例移除 figma-mcp-restore |
| `kit/mastery/README.md` | 3 处去除 figma-mcp-restore 引用，改为提示"使用 `/k:figma`" |
| `kit/ui/scripts/preflight.sh` | `FIGMA_REFS_DIR` 路径更新 + `.mdc` → `.md` |
| `kit/figma/references/specification.md` | 2 处 `.mdc` → `.md` |
| `settings.json` | 权限白名单 `skills/figma-mcp-restore/**` → `kit/figma/**` |

### 效果

- 显式触发：`/k:figma <figma-url>` 替代 description 匹配，意图传达更确定
- 命名空间一致：与 `/k:ui`、`/k:spec` 并列，形成完整 UI 工作流
- references 仍按需 Read：命令文件本体薄，细节（components/patterns/specification）Step 4 统一读取，和 skill references 分层加载效果等价
- 顺手修正扩展名：`figma-style-mapping.mdc` → `.md`（原扩展名是历史遗留）

### 非目标（本次不做）

- **家族 overrides 未实现**：`components.md`/`patterns.md`/`specification-project.md` 仍是 sodex-web 标准，sodex-next 部署时会共用同一份。项目隔离留给后续迭代（搬到 `modules/<family>/kit-overrides/figma/`）。
- `sync-tailwind-tokens.sh` 的"项目 token 会被 sync 推回源仓"预存问题未处理，等家族 overrides 落地时一并解决。

### 测试结果

| 检查项 | 结果 |
|------|------|
| 目录结构 | ✅ |
| 旧 skill 清理 | ✅ |
| 全仓无 `figma-mcp-restore` / `skills/figma-mcp` 残留引用 | ✅ |
| `sync-tailwind-tokens.sh` 语法 + 运行 | ✅ |

---

## [2026-04-17] clarify + spec — 引入 Think Before Coding 戒律

### 背景

借鉴 [andrej-karpathy-skills](https://github.com/forrestchang/andrej-karpathy-skills) 的四条 LLM 反坏习惯戒律。采用**组合方案**：通用戒律进全局 rules，场景化检查进命令，避免误伤日常对话与 task 执行。

### 变更（已做去重精简）

| 文件 | 变更内容 |
|------|----------|
| `rules/clean-code.md` | 新增 **Surgical Changes** 节（英文对齐文件风格）：diff 追溯、不改邻居、风格匹配、孤儿清理边界 |
| `commands/k/clarify.md` | Step 1 后插入 **1.5 提问前心态**：只保留"简化机会主动提"+"困惑即命名"两条（与 Step 2 分层提问、Step 6 自检不重复） |
| `commands/k/spec.md` | **未新增独立章节**，仅在 Step 7.2 模糊类型表追加一行「过度复杂 → 主动反向建议」（复用既有反问机制，避免与 Step 7/Step 8 重复） |

### 效果

- `/k:clarify` 提问前先扫简化机会，不坐等用户发现
- `/k:spec` 反问阶段多一维（过度复杂），复用既有反问流转机制
- Surgical Changes 作为全局约束，对 task/review/debug/migration 同时生效

### 设计迭代

初版在 spec.md 新开 "Step 9 Spec 质量闸"、clarify.md 新开完整 4 项"提问原则"。复查发现与 Step 7.2 反问表、Step 6 文档自检高度重合，违反 Surgical Changes 原则。精简为「只保留真实增量」—— spec.md 只加一行表格、clarify.md 只留两条独有。

### 设计决策

- **组合而非全放 rules**：Think Before Coding 在 task/debug 场景会拖慢节奏，仅在"需求→规范"阶段强制
- **组合而非全放命令**：Surgical Changes 是通用代码约束，日常改代码也需要
- Token 成本：常驻 ~60、命令触发 ~80×2，比全放 rules 省一半且无误伤

---

## [2026-04-17] migration analyze — 写操作 request body 强制采集

### 背景

迁移写操作（POST/DELETE）时，旧系统发送的 request body 字段名、精度格式、enum 值是实现的 ground truth。原有流程依赖条件触发 capture，可能跳过，导致新实现只能靠猜测或代码推断。

### 变更

| 文件 | 变更内容 |
|------|----------|
| `kit/debug/templates/capture.md` | 拦截器新增 `method` + `requestBody` 采集（非 GET 请求解析 body）；Phase C3 报告新增「写操作 Request Body」章节 |
| `kit/migration/commands/analyze.md` | Step 5 新增**强制触发**层：Context 含 POST/DELETE → 必须执行 capture；SUMMARY 块新增 `写操作:` 字段；报告新增 `### 写操作 Ground Truth` 表格 |

### 效果

- 写操作迁移前必有 requestBody ground truth，不再依赖代码静态推断
- capture 报告直接输出字段清单（字段名、类型/精度、示例值），供 implement 阶段直接引用

---

## [2026-04-16] study 输出优化 — 借鉴裁决前置

### 背景

study 命令生成完整分析文档后，核心结论（是否值得借鉴）藏在长文档中段。用户需要读完整篇分析才能得出判断，常常需要二次追问才能得到清晰的裁决，造成信息密度倒置。

### 变更

| 位置 | 变更 | 原因 |
|------|------|------|
| `study.md` Phase 6 | 新增**输出顺序**规范：先输出裁决摘要，再输出完整分析 | 用户 5 秒内得出结论，无需二次追问 |

### 裁决摘要格式

```
📊 借鉴裁决
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ✓/✗/~ <建议>  → <一句话结论>
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  总体：<一句话总评>
```

图标含义：`✓` 值得借鉴  `✗` 跳过  `~` 低优先级/有条件借鉴

### 效果

| | 优化前 | 优化后 |
|---|---|---|
| 得出裁决结论 | 读完长文 + 二次追问 | 直接看裁决摘要 |
| 对话轮次 | 2 轮 | 1 轮 |
| 额外 token 消耗 | +1 轮追问 | 0 |

### Token 影响

- 0 额外 token（仅新增输出顺序规范，不增加读取或分析步骤）

---

## [2026-04-16] plan/task 回顾修复 — 决策同步 + 依赖标注

### 背景

大型多 session 任务执行后的复盘发现两个问题：
1. 执行阶段选定的关键决策（依赖库、接口设计、实现路径）未写入 plan-temp.md，跨 session 续接时需重新确认
2. 阶段标注 `⚡ 可与第X阶段并行` 针对单 agent 执行具有误导性，实际只需知道依赖关系

### 变更

| 位置 | 变更 | 原因 |
|------|------|------|
| `/k/task` Step 3 | 新增"遇到执行决策时，同步到计划文件"规则 | 跨 session 续接时无需重新确认已做决策 |
| `/k/plan` Step 3 | 并行标注 `⚡ 可与第X阶段并行` → 依赖标注 `（与第X阶段无依赖）` | 事实陈述，不预设执行模式 |
| `/k/plan` Step 3 | 新增依赖标注规则（无依赖 / 依赖第X阶段） | 明确标注逻辑 |

### 决策同步规则

**触发条件**：选定依赖库、确认接口设计、调整实现路径等影响后续步骤的决策

**格式**（追加到 CONSTRAINTS 区块末尾）：
```
- 决策[步骤号]: [选择了什么] — [原因]
```

**示例**：`- 决策[2.1]: 使用 dghubble/oauth1 — go.mod 已有此依赖，无需新增`

### Token 影响

- 0 额外 token（仅新增规则文本，不增加脚本或工具调用）

---

## [2026-04-16] plan/task 任务列表显示优化 — 保序 + 图标标记

### 背景

执行分批任务时，任务列表存在 2 个显示问题：
1. Checkpoint 与普通步骤无视觉区分，批次边界不明显
2. Claude Code 内置行为将 completed 任务自动排到底部，顺序混乱

### 变更

| 位置 | 变更 | 原因 |
|------|------|------|
| `/k/plan` Step 3 | `todo_write` 替换为 `TaskCreate` 逐条创建，增加图标规范 | 统一 UI 展示层格式 |
| `/k/plan` Step 3.5 | 增加 TaskCreate 条目示例，与 plan-temp.md 格式对照 | 明确文件层和 UI 层的区分 |
| `/k/task` Step 3 | 完成步骤改为 TaskUpdate 修改 subject 文本（`○` → `✓`），禁止修改 status | 避免 completed 状态触发自动排序 |
| `/k/task` Step 4 | 进度追踪改为依赖任务列表，删除 markdown 进度表 | 避免重复信息 |

### 图标规范

| 图标 | 含义 | 使用方式 |
|------|------|----------|
| `○` | 未完成步骤 | TaskCreate subject 前缀 |
| `✓` | 已完成步骤 | TaskUpdate 修改 subject，不改 status |
| `📍` | Checkpoint 验收点 | TaskCreate subject 前缀 |

### 核心机制

- **保序**：所有任务保持 `pending` 状态，通过 subject 文本图标标记实际进度，避免 Claude Code 自动排序
- **零额外开销**：完成一步只需 1 次 TaskUpdate 调用（改 subject 文本），与改 status 持平
- **两层分离**：plan-temp.md（`- [ ]` / `- [x]`）是文件持久化层，TaskCreate 是 UI 展示层，互不影响

### 曾考虑但放弃的方案

- **批次折叠**：Checkpoint 通过后将已完成批次折叠为一行摘要。放弃原因：需要全量删除 + 重建任务列表（每批次 ~20 次额外工具调用），成本远大于视觉收益

---

## [2026-04-14] 新增 /k/security 安全检查命令

### 背景

前端项目依赖供应链攻击频发，需要统一命令快速扫描多个项目的 npm 依赖安全性。已有 `malicious-npm-package.md` 规则但缺乏主动扫描能力。

### 新增文件

| 文件 | 说明 |
|------|------|
| `.claude/commands/k/security.md` | 命令入口，AI 编排 6 步流程（解析输入→选择项目→分支检测→扫描依赖→风险比对→输出报告） |
| `.claude/kit/security/config.sh` | 项目配置（8 个项目，name\|path\|branch 格式） |
| `.claude/kit/security/scripts/scan.sh` | 扫描脚本，3 个子命令：list / branch-check / scan |

### 功能细节

- **三种输入方式**：链接（WebFetch 抓取）、包名、文本描述，AI 提取风险包
- **项目选择**：全选 / 部分多选（编号输入如 1,3,5）
- **分支管理**：批量检测分支状态，一次性确认切换，stash 保护工作区
- **依赖提取**：package.json + lockfile 深层依赖（支持 pnpm / npm / yarn）
- **风险比对**：用户指定包 + 内置恶意包列表（26 个）双重比对
- **报告输出**：4 区块结构（扫描概况 / 风险项目 / 安全项目 / 跳过项目）
- **分支映射**：sodex-web → mainnet，其余 → main

---

## [2026-04-14] check/rules 多项目感知

### 背景

check 流程的 checklist 模板包含项目特定检查项（CHK-09 弹窗重置、CHK-10 useEffect、CHK-10b 精度计算），在 soso-kit 等非 React 项目中产生噪音。rules 中 `precision-calculation.md` 的 globs 对所有 TS 项目生效，但 calculate 库仅存在于 sodex-web/sodex-next。

### 变更

| 位置 | 变更 | 原因 |
|------|------|------|
| `check/templates/checklist.md` | CHK-09/10/10b 用 `<!-- project: sodex-web, sodex-next -->` 包裹 | 项目特定检查项条件化 |
| `check/scripts/check.sh` | 新增 `filter_checklist()` 按 PROJECT_NAME 过滤 `<!-- project -->` 块 | 系统级保障，非 AI 判断 |
| `rules/precision-calculation.md` | description 追加 `（仅 sodex-web/sodex-next）` | AI 在其他项目不强推 calculate 库 |

### 效果

| 项目 | 改动前 | 改动后 |
|------|--------|--------|
| sodex-web / sodex-next | 18 项检查 | 18 项检查（不变） |
| soso-kit / sodex-admin-dashboard | 18 项（3 项靠 AI 判断 N/A） | 15 项（系统级过滤） |

---

## [2026-04-14] context init 多项目支持

### 背景

context library 需要支持多个项目（如 sodex-admin-dashboard），手动创建骨架目录易遗漏且映射配置容易忘记。

### 变更

| 位置 | 变更 | 原因 |
|------|------|------|
| `/k/context` Step 2 | 路由表新增 `init` 子命令 | 新增命令入口 |
| `/k/context` Step 2.5 | 新增 init 专用两步交互流程（--dry-run → 确认 → 执行） | 用户确认后才创建 |
| `context-lib.sh` | case 硬编码 → PROJECT_MAPPINGS 数组 + resolve_project_name() | regex `^project(-.+)?$` 精准匹配 worktree 变体，避免 glob 误匹配 |
| `context-lib.sh` | 新增 context_init() 函数 | init 入口，不受 write_permission 限制 |
| `context-lib.sh` | context_help() 追加 init 说明 | 命令可发现性 |

### 新增文件

| 文件 | 说明 |
|------|------|
| `.claude/kit/context/action/init/init-project.sh` | init 核心脚本：项目名检测、骨架创建、补全模式、映射自动追加 |

### 功能细节

- **项目名检测**：优先路径参数 basename，其次 git repo name，都没有则报错提示
- **骨架生成**：7 目录（history/indexes/pitfalls/reference/reusable/router/summary）+ 4 文件（context-index.json/CONTEXT-UNEXPLOITED.md/indexes/*.json）
- **补全模式**：目录已存在时逐项检查缺失，已有文件不动（如 sodex-next 的 migration-references 保留）
- **映射追加**：自动在 MAPPINGS_INSERT_ANCHOR 锚点前插入 regex 映射行，幂等检查

---

## [2026-04-13] plan/task 长任务改进 — 分批执行 + 计划持久化 + CHECKPOINT 自检

### 背景

执行维护模式升级（16 步、22 文件）时暴露 3 个核心问题：
1. 长任务无检查点，bug 累积到用户手动叫停才发现
2. plan 信息随对话变长在 context 中丢失，task 后期执行偏离计划
3. 参考实现在对话早期读取后被遗忘

### 变更

| 位置 | 变更 | 原因 |
|------|------|------|
| `/k/plan` Step 0.pre | 新增残留计划文件检测与清理 | 异常中断后再次 plan 时自动清理 |
| `/k/plan` Step 3.5 | 新增批次编组（>10 步触发） | 长任务按阶段分批，每批 3-5 步 |
| `/k/plan` Step 3.5 | 每批末尾插入 CHECKPOINT（完成度/质量/结论） | task 阶段的暂停信号 |
| `/k/plan` Step 6 | 新增计划文件写入（plan-temp.md） | 计划持久化，task 不依赖对话记忆 |
| `/k/plan` 完成条件 | 区分一次性/分段执行两种输出 | 明确告知用户执行模式 |
| `/k/task` Step 2 | 从计划文件获取步骤（extract-batch.sh） | 读文件而非依赖 context |
| `/k/task` Step 3 | 每步完成用脚本更新 checkbox（update-step.sh） | 零 token 消耗更新进度 |
| `/k/task` Step 3 | CHECKPOINT 自检：明确 bug 直接修，模糊问题问用户 | 减少不必要等待，保留关键确认 |
| `/k/task` Step 3 | 参考实现重读规则 | 编码前重新 Read 参考组件 |
| `/k/task` 完成条件 | 删除计划临时文件 | 清理临时状态 |

### 新增文件

| 文件 | 说明 |
|------|------|
| `.claude/kit/plan/extract-batch.sh` | 提取指定批次步骤 + 跨批次约束 |
| `.claude/kit/plan/update-step.sh` | 更新 checkbox 状态（completed/in_progress/pending） |

### 计划文件格式

```markdown
<!-- CONSTRAINTS-START -->
跨批次约束
<!-- CONSTRAINTS-END -->

<!-- BATCH-1-START -->
批次 1 步骤 + CHECKPOINT
<!-- BATCH-1-END -->
```

HTML 注释标记确保脚本解析不依赖 markdown 结构。

### Token 影响

| 维度 | Token |
|------|-------|
| plan-temp.md 写入 | 0（Write 工具，非对话） |
| extract-batch.sh 读取单批 | ~500 tokens（vs 整个文件 ~2000） |
| update-step.sh 更新 | 0（shell 脚本，不进入对话） |
| CHECKPOINT 自检输出 | ~100-200 tokens/批次 |
| **对比：无持久化时的信息丢失返工** | **省 ~2000-5000 tokens** |

### 适用范围

- 计划持久化：所有 plan → task 流程（不论步骤数）
- 批次编组 + CHECKPOINT：仅 >10 步时触发
- ≤10 步的任务：零额外开销

---

## [2026-04-12] 新增 /k/study — GitHub 项目研究分析命令

### 背景

soso-kit 缺少结构化分析外部 GitHub 项目的能力。分析外部项目的流程零散，无文档沉淀，无法复用。需要一个命令将学习过程系统化：获取项目 → 分析架构 → 与 soso-kit 对比 → 输出研究文档。

### 新增文件

| 文件 | 说明 |
|------|------|
| `commands/k/study.md` | 命令入口（9 Phase workflow） |
| `kit/study/scripts/resolve-project.sh` | 项目解析：registry aliases → 本地目录 → GitHub URL clone |
| `kit/study/scripts/update-project.sh` | 代码更新：默认分支检测 + git pull |
| `kit/study/scripts/scan-project.sh` | 项目扫描：目录结构/入口文件/语言统计/commit/README |
| `kit/study/scripts/generate-profile.sh` | 半自动生成 soso-kit 自画像（AUTO 区覆盖，MANUAL 区保留） |
| `kit/study/scripts/save-study.sh` | 持久化：registry 更新 + token 统计 |
| `kit/study/registry.json` | 项目映射索引（别名/路径/文档/时间） |
| `kit/study/soso-kit-profile.md` | soso-kit 自画像（对比基准） |
| `kit/study/templates/study-template.md` | 研究文档模板 |
| `kit/study/output/.gitkeep` | 文档输出目录 |

### 核心设计

- **脚本 + Workflow 混合**：机械操作（resolve/update/scan/save）由 shell 脚本完成，节省 token；智能分析由 Claude 在 workflow 中完成
- **soso-kit 自画像**：预生成对比基准文档，避免每次 study 重新探索整个项目结构
- **持久化确认**：分析完成后询问用户是否保存，可跳过
- **覆盖更新 + 变更记录**：重复 study 同一项目时覆盖主体、追加变更记录
- **Token 分步统计**：每阶段 `字符数 / 3` 估算，最终汇总展示
- **三级项目解析**：registry aliases → 本地 `~/Documents/code/` → GitHub URL clone

### 执行流程

```
/k:study <input>
  → resolve-project.sh   → 定位项目
  → update-project.sh    → 拉取最新代码
  → 确认自画像更新？     → generate-profile.sh（可跳过）
  → scan-project.sh      → 结构化扫描（节省 token）
  → 加载 soso-kit-profile.md
  → Claude 深入分析 + 对比
  → 用户确认持久化？
  → save-study.sh        → 写文档 + 更新 registry + token 统计
```

### Token 影响

| 维度 | Token |
|------|-------|
| 命令加载（study.md） | ~1500 tokens |
| 脚本执行 | 0（shell 层面） |
| 扫描结果 | ~300-1000 tokens（取决于项目大小） |
| 自画像加载 | ~800 tokens |
| 分析+文档生成 | ~3000-8000 tokens（取决于项目复杂度） |

---

## [2026-04-12] 新增 /k/migration — 跨架构迁移工作流

### 背景

sodex-web 逐步迁移到 sodex-next（5 层 Clean Architecture）。原生迁移工作流依赖手动读 3 份大文档（architecture.md 1116 行 + generation-contract.md 933 行 + refactoring-roadmap.md 708 行），无知识积累，每次迁移从零开始。

### 新增文件

| 文件 | 行数 | 说明 |
|------|------|------|
| `commands/k/migration.md` | 88 | 精简路由 + 公共逻辑 |
| `kit/migration/commands/analyze.md` | 145 | 分析老功能（Context 加载 + 自动入库 + 坑点检查 + Checkpoint） |
| `kit/migration/commands/spec.md` | 50 | 生成迁移规范（注入迁移模板） |
| `kit/migration/commands/plan.md` | 55 | 拆分迁移计划（pitfall + reusable + 类型先行） |
| `kit/migration/commands/execute.md` | 43 | 逐步实现（条件加载 references） |
| `kit/migration/commands/verify.md` | 53 | 架构检查 + 行为验证 |
| `kit/migration/commands/finalize.md` | 78 | 入库 + 提炼记录 + Token 汇总 + 清理 |
| `kit/migration/commands/status.md` | 30 | 进度查看 + Token 消耗展示 |
| `kit/migration/templates/spec-migration.md` | 49 | spec 迁移变体模板 |
| `kit/migration/templates/plan-type-first.md` | 25 | 类型先行约束片段 |
| `kit/migration/scripts/verify-arch.sh` | 188 | 5 项架构检查（Import 方向/旧代码残留/转换位置/命名契约/导出合规） |
| `kit/migration/scripts/migration-status.sh` | 57 | 进度显示（兼容单行/多行 JSON） |

### 修改文件

| 文件 | 变更 | 原因 |
|------|------|------|
| `commands/k/debug.md` | 新增 capture 路由分支 | migration analyze 条件触发 API 采集 |
| `kit/debug/templates/capture.md` | 新建 capture 模板（89 行） | Phase C1-C4：拦截器注入 → 用户操作 → 对比分析 → 清理 |

### 核心设计

- **编排而非新建**：7 个子命令中 4 个零新增代码，复用 context/spec/plan/task/check/debug
- **命令拆分优化**：路由（88 行）+ 子命令外部化，每次调用仅加载 ~998 tokens（vs 全文件 ~3200 tokens）
- **项目级隔离**：通过 `PROJECT_NAME` 切换 sodex-web / sodex-next Context，零新增代码
- **Token 估算**：每步写入 migration-state.json，finalize 汇总输出
- **知识飞轮**：每次迁移产出 pitfall/history/context，加速下次迁移
- **analyze Checkpoint**：4 类确定性触发器（范围边界/数据偏差/入口不确定/旧逻辑模糊），复用 clarify 三原则（不假设/HARD-GATE/结构化输出），其余步骤由底层命令（/k/spec 反问、/k/plan 确认、/k/check HARD-GATE）覆盖

### 两种使用模式

| 模式 | 用法 | 说明 |
|------|------|------|
| 全流程引导 | `/k/migration vault-claim` | analyze → spec → plan → execute → verify → finalize，每步确认 |
| 独立子命令 | `/k/migration analyze vault-claim` | 单步执行，手动控制节奏 |

### Token 影响

| 维度 | 数据 |
|------|------|
| 命令加载（路由 + 1 个子命令） | ~998 tokens/次 |
| 全流程 6 步命令加载 | ~3000 tokens（vs 优化前 ~9000） |
| 单功能迁移总消耗 | ~5200-11900 tokens（vs sodex-next 原生 ~18000-25000） |
| 迭代加速 | 第 10 次迁移 ~3000-6000 tokens（省 75-83%） |

---

## [2026-04-12] plan 新增复用检查 + check 逐条对照 spec 验收标准

### 背景

对比 sodex-next 的 generation-contract（代码生成契约）后发现两个改进点：
1. plan 阶段 AI 不知道项目有哪些可复用资源，导致重复造轮子（如用 parseFloat 而非 calculate）
2. check 阶段 CHK-01 "功能需求全部满足"是笼统勾选，不会逐条展开 spec 验收标准

### 变更

| 位置 | 变更 | 原因 |
|------|------|------|
| `/k/plan` Step 2.5 | 新增复用检查（reusable-match.sh） | plan 拆步骤前，按 tags 匹配可复用资源，输出到步骤描述中 |
| `.claude/kit/plan/reusable.md` | 新建可复用资源清单 | 按 `<!-- tags: -->` 标记区块，支持 grep 预过滤 |
| `.claude/kit/plan/reusable-match.sh` | 新建匹配脚本 | 复用 Step 0 的 tags，grep 只返回匹配区块，AI 不读全文 |
| `checklist.md` CHK-01 | 增加逐条验证指引 | 要求读取 spec 验收标准，逐条列出并标注 ✅/❌ |

### 复用检查机制

```
Step 0:  提取 tags（已有，pitfall 用）
           ↓ 复用同一组 tags
Step 2.5: reusable-match.sh 按 tags grep → 只返回匹配区块
           ↓ AI 只看匹配结果
Step 3:   步骤标注 📏 复用提示
```

与 pitfall 的区分：
- **pitfall**："不要做什么"（防错）
- **reusable**："项目有什么可以直接用"（提效）

### Token 影响

| 改动 | Token 影响 |
|------|-----------|
| reusable 匹配（shell grep） | 0（脚本执行不消耗 AI token） |
| AI 读匹配结果 | ~50-150 tokens（恒定，不随文件增大） |
| CHK-01 逐条验证 | ~100-200 tokens（取决于 spec 验收标准数量） |
| **避免的返工** | **省 ~500-1000 tokens/次**（不用 check 拦住再改） |

### reusable.md 扩展方式

每个区块用 `<!-- tags: xxx,yyy -->` 标记，新增资源只需追加区块：

```markdown
<!-- tags: 金额,余额,价格 -->
## 精度计算
| ✅ 使用 | ❌ 禁止 |
|--------|--------|
| calculate() | parseFloat |
```

匹配脚本不需要修改，自动识别新区块。

---

## [2026-04-10] Context 写入安全增强 — 内容哈希去重 + 原子写入 + 一致性校验

### 背景

Context Library 的索引文件（router、context-index、files.json、tags.json）独立写入，无备份、无回滚、无跨文件校验。写入中断会导致数据不一致，且无法被发现。

### 变更

| 位置 | 变更 | 原因 |
|------|------|------|
| `record-helpers.sh` | 新增 `compute_content_hash()` | SHA-256 前 16 位，基于 summary+keyFiles+tags 去重 |
| `record-helpers.sh` | 新增 `backup_batch()` / `rollback_batch()` | 批量备份和恢复多个文件 |
| `record-helpers.sh` | 新增 `validate_integrity()` | 跨文件引用完整性校验（4 项检查） |
| `update-router.sh` | 新增内容哈希去重 | 相同内容跳过写入，避免重复入库 |
| `shared/update-indexes.sh` | 新增写入前批量备份 + `trap ERR` 自动回滚 | 任何步骤失败自动恢复所有文件 |
| `shared/update-indexes.sh` | 新增写入后一致性校验 | 交叉验证 4 个文件的引用关系 |
| `validate-structure.sh` | 新增 `--integrity` 模式 | 可独立执行跨文件一致性校验 |
| `/k/context-learn` | 新增 Step 7c 一致性校验 | learn 路径（Edit 直接写 JSON）补充校验 |
| `/k/context-record` | Step 8 追加一致性校验 | record 路径补充校验 |
| `/k/context-audit` | 新增 Step 0b 一致性校验 | 审计前先检查索引健康状态 |
| `/k/context-update` | 通过 `update-indexes.sh` 自动覆盖 | 无需额外改动 |

### 一致性校验覆盖的写入路径

| 命令 | 校验方式 |
|------|----------|
| `/k/context-record` | Step 8 调用 `--integrity` |
| `/k/context-learn` | Step 7c 调用 `--integrity` |
| `/k/context-update` | `shared/update-indexes.sh` 内置 |
| `/k/context-audit` | Step 0b 调用 `--integrity`（审计前健康检查） |

### 一致性校验内容（4 项）

1. context-index 中每个 module 的 feature ID 必须在对应 router 中存在
2. files-index 中的 feature ID 必须在 context-index 中存在
3. tags-index 中的 feature ID 必须在 context-index 中存在
4. `meta.totalFeatures` 必须与实际 features 数量一致

### Token 影响

- 0 额外 token（全部是 shell 脚本层面改动，不影响 Claude 对话）

---

## [2026-04-10] 借鉴 Superpowers 自审机制 — spec/plan/check 三处质量门

### 背景

对比 Superpowers（开源 agent 工作流框架）后发现：soso-kit 在 spec 和 plan 阶段缺少自审环节，问题（矛盾、遗漏）会一路传递到 check 阶段才被发现，导致返工。

### 变更

| 位置 | 变更 | 原因 |
|------|------|------|
| `/k/spec` Step 8 | 新增 Spec 自审（内部一致性 + 范围检查） | spec 各段矛盾在输出前自行修正；多模块需求建议拆分 |
| `/k/plan` Step 5 | 新增 Spec 覆盖度自检 | 逐条对照 spec 验收标准，标注每条由哪个步骤实现，未覆盖的当场补充 |
| `checklist.md` | CHK-01~04b 新增 HARD-GATE | 需求检查未通过则停止，不继续技术检查项 |

### Token 影响

- Spec 自审：~200 tokens（自审通过时静默，不输出）
- Plan 覆盖度：~300 tokens（全覆盖时静默，不输出）
- Checklist HARD-GATE：0 额外 token（仅改变检查流程顺序）

---

## [2026-04-10] 新增 /k/review — 代码质量诊断

### 背景

/k/check 是提交前的全面检查（18 项 checklist），但缺少轻量级的代码质量诊断工具。/k/review 填补这个空白，专注于单文件或小范围的代码质量分析。

### 功能

| 模式 | 触发 | 审查内容 |
|------|------|----------|
| 规范审查（默认） | `/k/review <file>` | clean-code + react 规范逐项检查 |
| 多视角审查 | `/k/review --deep <file>` | 规范 + 边界猎手 + 意图审计 |

### 三个审查视角

- **规范审查**：对照 clean-code.md / react.md 规范，输出 before/after 改进建议
- **边界猎手**：机械式路径追踪，检查空值/数组/数值/竞态/状态组合的未处理分支
- **意图审计**：对照 spec 检查代码是否偏离需求意图（过度实现或遗漏）

### 设计原则

- 不自动修改文件，只输出建议
- 没问题就说没有，不凑数量
- 审查范围自动推断（用户指定 > 分支 diff > 暂存区）

---

## [2026-04-07] Spec Gate — 在 spec 阶段复用 pitfall 数据检查验收场景完备性

### 背景

Pitfall Gate 已在 plan 阶段拦截实现层的已知问题，但 spec 阶段缺少类似机制。如果 spec 验收场景本身就遗漏了某类问题，plan 和 task 阶段即使不踩实现坑，逻辑分支也不会被覆盖。

### 变更

| 位置 | 变更 | 原因 |
|------|------|------|
| `template.md` | 新增 `trigger` 字段 | 定义哪些需求关键词应触发该 pitfall 检查 |
| `index.json` | 已有条目补充 `trigger` 数据 | 数据结构扩展 |
| `trade-feerate-mobx.md` | frontmatter 补充 `trigger` | 数据同步 |
| `query-spec-gates.sh` | 新增脚本 | 按 trigger 匹配 spec 关键词，输出 gate_rule |
| `/k/spec` Step 6.5 | 新增 Spec Gate 检查步骤 | spec 阶段自动匹配，未覆盖的并入反问 |
| `/k/context-pitfall` add | gate:true 时引导填写 trigger | 录入时同时填写 spec 匹配关键词 |
| `add-to-index.sh` | 支持第 10 参数 trigger_csv | 写入 trigger 字段到 index.json |

### 复用设计

同一条 pitfall 数据，两个阶段各取所需：
- **plan 阶段**（已有）：按 `tags` 匹配 → 读 `gate_rule` → 实现约束
- **spec 阶段**（新增）：按 `trigger` 匹配 → 读 `gate_rule` → 验收场景检查

### Token 影响

- 无匹配：0 额外 token（静默退出）
- 匹配 N 条：~50 tokens/条
- spec.md Step 6.5 描述：~180 tokens（一次性）

---

## [2026-04-06] 新增 Pitfall Gate 门检查系统

### 背景

pitfall 记录是被动的，只有主动查询才能看到。高复现率的踩坑记录应自动成为 plan 阶段的预检约束。

### 变更

| 位置 | 变更 | 原因 |
|------|------|------|
| `/k/plan` Step 0 | 新增 pitfall 门检查段落 | plan 前自动匹配 gate:true 的 pitfall，输出 gate_rule |
| `/k/context-pitfall` add | 新增 gate 分类引导 | 录入时判断是否为可重复问题 |
| `checklist.md` CHK-04b | 新增 gate_rule 验证项 | check 阶段验证是否遵守 gate_rule |
| `query-pitfall-gates.sh` | 新增脚本 | 按 tags 过滤 gate:true 条目，无匹配时静默退出 |
| `add-to-index.sh` | 支持 gate + gate_rule 参数 | 录入时写入 gate 字段 |
| `update-index-entry.sh` | 支持 UPDATE_GATE 环境变量 | 更新 gate 字段 |
| `template.md` | 增加 gate 字段和分类说明 | 引导录入者判断 |
| `index.json` | 增加 gate + gate_rule 字段 | 数据结构扩展 |

### 闭环流程

```
踩坑 → pitfall add（gate 分类）→ plan Step 0（自动匹配）→ check CHK-04b（验收验证）
```

### Token 影响

- 无匹配：0 额外 token
- 匹配 1 条：~50 tokens
- plan.md Step 0 描述：~200 tokens（一次性）

---

## [2026-04-02] 优化 /k/debug — 服务器生命周期 + 插桩精准度 + token 精简

### 变更

| 位置 | 变更 | 原因 |
|------|------|------|
| Phase 0 | 服务器启动提前到 Phase 0 | 全程运行，迭代无需重启 |
| Phase 2 | 假设增加 Type 字段（data/condition/timing/state） | 强制分类 bug 类型，引导选择观测策略 |
| Phase 3 | 新增数据捕获规则：transform log input+output，条件 log 所有变量+结果 | 提升插桩数据质量 |
| Phase 4 | "done" 不再停止服务 | 迭代时可直接追加插桩，减少用户复现次数 |
| Phase 5 | 删除 Python 会话分组脚本 | AI 直接读 JSON Lines 分析，伪代码无实际作用 |
| Phase 6 | 服务仅在清理阶段停止；cleanup grep 搜索全项目 | 生命周期清晰；原仅搜 `src/` 会遗漏 |
| 全局 | 精简 fetch 示例、删除 `cat hypothesis.md`、压缩 React 安全表 | 249→202 行（-19%） |

---

## [2026-04-01] 更新 /k/debug — 移除 INIT 注入，对齐 Cursor 策略

参考 Cursor Debug Mode 实现策略，重构插桩方式。

### 变更

| 位置 | 变更 | 原因 |
|------|------|------|
| Phase 3 | 移除 `[DEBUG:INIT]` 入口文件注入 | 零源码入口修改，对齐 Cursor 策略 |
| Phase 3 | 改为各观测点 inline fetch | 每点自包含，无全局依赖 |
| Phase 3 | 新增 React 安全放置规则 | 禁止在 useMemo/渲染路径中插入 fetch |
| Phase 3 | 新增 useEffect 观测模式 | 安全观测 useMemo 等禁止位置的值 |
| Phase 6 | 简化清理：grep `// [DEBUG:` | 不再需要清理 INIT 块和类型声明 |

### 核心原则

Cursor Debug Mode 不用 wrapper/sendBeacon/setTimeout，而是让 AI **理解 React 语义**，只在安全位置（事件处理器、async 函数、useEffect 回调）放置 fetch 插桩。

---

## [2026-03-31] 新增 /k/debug 调试命令

AI 驱动的运行时调试工作流，通过本地 HTTP 服务自动收集浏览器日志，定位 bug 根因。

### 新增文件

| 文件 | 功能 |
|------|------|
| `.claude/commands/k/debug.md` | 命令定义（六阶段工作流） |
| `.claude/kit/debug/server.js` | 零依赖本地日志收集 HTTP 服务 |
| `.claude/kit/debug/scripts/start-server.sh` | 服务管理脚本（check/start/stop/status） |
| `.claude/kit/debug/templates/hypothesis.md` | 假设输出模板 |

### 工作流

Phase 0 环境检查 → Phase 1 问题分析 → Phase 2 假设生成 → Phase 3 插桩（inline fetch） → Phase 4 日志收集 → Phase 5 分析 → Phase 6 清理

### 核心设计

- **上报方式**：各观测点 inline fetch，不修改入口文件
- **日志收集**：Node.js HTTP 服务（端口 9876），JSON Lines 格式写入 `debug.log`
- **迭代支持**：Phase 5 未定位根因时可回到 Phase 2 追加假设
- **安全防护**：React 安全放置规则、.gitignore 自动添加、端口自动递增

---

## [2026-03-28] plan/task 步骤格式改为 Checkbox 分组

参考 OpenSpec 的 tasks.md 格式，将步骤从标题式改为可追踪的 checkbox 分组格式。

### plan.md

| 位置 | 变更 |
|------|------|
| Step 3 步骤模板 | 从 `### Step N:` 标题格式 → `## 第N阶段` + `- [ ] N.M` checkbox 格式 |
| 并行标注 | 从条目前缀 `[P]` → 阶段标题后 `⚡ 可与第X阶段并行` |
| todo_write 格式 | 与 checkbox 条目格式对齐（`N.M 描述 — 文件`） |

### task.md

| 位置 | 变更 |
|------|------|
| 执行标题 | `### 执行 Step [N]` → `### 执行 [N.M] [描述]` |
| 进度追踪 | 与 plan 新格式对齐，按阶段分组展示 checkbox 状态 |

**效果**：步骤可被 TodoWrite 原生追踪，阶段分组让进度一目了然，编号支持精确引用（如"2.1 有问题"）。

---

## [2026-03-28] spec/plan 工作流约束增强

参考 superpowers 工作流分析，针对流程纪律做定向加固。

### spec.md

| 位置 | 变更 | 原因 |
|------|------|------|
| Step 7.1 | `边界` 拆分为 `包含` + `排除` 两个独立字段 | 强制输出排除项，防止 scope creep |
| Step 7.2 | 核心反问从"必问"改为"有歧义必问，清晰可跳过" | 避免对高质量 spec 文档产生无效摩擦；跳过须显式声明 |
| Step 7.4 后 | 新增 HARD-GATE | 禁止自行回答反问，禁止基于假设流转 plan |

### plan.md

| 位置 | 变更 | 原因 |
|------|------|------|
| Step 3 | 新增粒度检查规则 | 步骤描述 >3 行或涉及 2+ 不相关文件须拆分，防止步骤过大 |
| 确认流转 | 新增 HARD-GATE | 禁止未收到 Y 就调用 task.md 或开始代码修改 |

---

## [2026-03-27] 新增 sosokit-switch 模式切换

### 新增功能

新增 `sosokit-switch` 命令，支持在 `.cursor` 和 `.claude` 配置模式间切换。

**新增文件**：

| 文件 | 功能 |
|------|------|
| `.claude/kit/switch.sh` | 模式切换脚本 |
| `.cursor/kit/switch.sh` | 同步 |

**修改文件**：

| 文件 | 修改内容 |
|------|----------|
| `config.sh` | 添加 `get_sosokit_mode()` 函数 |
| `install.sh` | 根据模式动态选择 .cursor 或 .claude |
| `sync.sh` | 根据模式动态选择 .cursor 或 .claude |
| `init-worktree.sh` | 支持动态模式，`--skip-cursor` → `--skip-config` |
| `SKILL.md` | 更新文档说明 |

**使用方式**：

```bash
sosokit-switch          # 显示当前模式
sosokit-switch cursor   # 切换到 .cursor 模式
sosokit-switch claude   # 切换到 .claude 模式
```

**配置存储**：`~/.sosokit-mode`

---

## [2026-03-27] 迁移至 Claude Code

### 迁移变更

从 `.cursor/commands/k/` 完整迁移至 `.claude/commands/k/`，适配 Claude Code 格式要求。

**格式转换**：

| 变更项 | 处理方式 |
|--------|----------|
| `scripts:` frontmatter | 删除（Claude Code 不支持） |
| `handoffs:` frontmatter | 删除（Claude Code 不支持） |
| 路径引用 `.cursor/` | 替换为 `.claude/` |

**受影响的命令**：

| 命令 | 删除的字段 |
|------|-----------|
| `clarify.md` | `scripts:`, `handoffs:` |
| `spec.md` | `scripts:`, `handoffs:` |
| `plan.md` | `handoffs:` |
| `task.md` | `scripts:`, `handoffs:` |
| `ui.md` | `scripts:`, `handoffs:` |

**新增命令**（从 Cursor 同步）：

- `clarify.md` - 将模糊想法转化为结构化设计方案
- `context.md` - Context 管理入口
- `context-audit.md` - Context 审计
- `context-learn.md` - Context 学习
- `context-pitfall.md` - Context 陷阱记录
- `context-record.md` - Context 记录
- `context-remove.md` - Context 移除
- `context-report.md` - Context 报告
- `context-update.md` - Context 更新
- `review.md` - 代码评审
- `ui.md` - UI 需求确认

**删除命令**：

- `practice.md` - 已废弃

---

## 命令清单

当前共 20 个命令：

| 命令 | 用途 |
|------|------|
| `check.md` | 提交前代码检查 |
| `clarify.md` | 模糊想法 → 结构化设计 |
| `debug.md` | AI 驱动的运行时调试（含 capture 采集模式） |
| `migration.md` | 跨架构迁移工作流（编排 7 个子命令） |
| `study.md` | GitHub 项目研究分析 |
| `context.md` | Context 管理入口 |
| `context-audit.md` | Context 审计 |
| `context-learn.md` | Context 学习 |
| `context-pitfall.md` | Context 陷阱记录 |
| `context-record.md` | Context 记录 |
| `context-remove.md` | Context 移除 |
| `context-report.md` | Context 报告 |
| `context-update.md` | Context 更新 |
| `mastery.md` | 规范分析 |
| `plan.md` | 实现计划制定 |
| `research.md` | 技术调研 |
| `review.md` | 代码评审 |
| `spec.md` | 功能规范生成 |
| `task.md` | 任务执行 |
| `ui.md` | UI 需求确认 |
