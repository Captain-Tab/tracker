# soso-kit 自画像

## 定位

Claude Code 工具集，通过 `.claude/commands` + `.claude/kit` 提供结构化 AI 工作流。将 AI 辅助开发从零散对话提升为系统化的工程流程。

## 命令清单

<!-- AUTO-GENERATED START -->
- /k:analyze-live — 静态多 agent + 运行时 debug-capture 双重分析既有项目模块，产出含实测 ground truth 的纯事实分析文档
- /k:analyze — 逆向分析既有项目模块，产出带源码定位的纯事实分析文档（不修改代码、不给建议）
- /k:auto-off — 关闭 Auto 模式，/k:spec 和 /k:clarify 恢复标准行为
- /k:auto-on — 开启 Auto 模式，/k:spec 和 /k:clarify 将自动搜索 context，无需 --c 标志
- /k:check — 提交前进行代码检查和验收
- /k:clarify — 将模糊想法转化为结构化设计方案，进入 spec 工作流前使用
- /k:codex-off — 停止 /k:codex-on 开启的 Codex 审核监听进程并清理记录。幂等执行
- /k:codex-on — 后台监听当前 PR 的 Codex 审核，完成后自动执行 /k:codex 核验并播报。停止用 /k:codex-off
- /k:codex — 拉取并核验当前 PR 的 Codex 审核结果，对 Critical/High 跑四步漏斗给出修复/不修复终局结论
- /k:commit — 根据当前 git diff 生成符合规范的 commit message
- /k:context-audit — 检测 Context 文档是否需要更新（基于 git 历史，零 token 检测）
- /k:context-init — 初始化新项目 Context Library 骨架（支持补全）
- /k:context-learn — 从代码逆向生成 Context 文档并入库
- /k:context-pitfall — Pitfall 查询与记录：list/load/add/update/remove
- /k:context-record — 将 spec 文档记录到 Context Library（新功能入库）
- /k:context-remove — 删除 Context 功能及其关联文档（慎用）
- /k:context-report — Context 健康报告：过期检测、共享文件风险、最近活动、模块覆盖
- /k:context-update — 差量更新已有 Context 文档（保留人工内容）
- /k:context — 上下文查询：list/search/load/files/tag/recent/outline/unfold。写入命令请用 /k/context-record /k/context-learn /k/context-update /k/context-audit /k/context-remove /k/context-init
- /k:cowork — 多会话协同看板：init 建板 / pickup 进会话续接 / handoff 出会话落盘（SSOT 集中管理）
- /k:cp — 快捷 prompt 库：按名 cat 一段写死的 prompt 当作本轮指令（见 .claude/kit/cp/prompts/）
- /k:debug-capture — API 采集 session（自包含一次性流程），拦截 fetch 请求并与 Context 文档对比。用于 /k/migration analyze
- /k:debug-off — 终结调试 session，清理 // [DEBUG: 插桩、删除日志、停止服务
- /k:debug-on — 启动调试 session，运行假设 → 插桩 → 收集 → 分析 → 迭代工作流。完成后用 /k:debug-off 清理
- /k:distill — 读取最新 insight 报告，套用查重+门槛+完整性纪律，蒸馏出"扩展/新建/skip"决策，输出带日期、可核查无遗漏的报告到 docs/distill
- /k:draft — 生成需求草稿骨架 md（feature/bug/ui/api/complex），省去手动新建文件，直接在上面写
- /k:figma — Figma 设计稿还原为 React + Tailwind CSS 代码
- /k:mastery — 规范分析并直接应用 Skills 执行任务
- /k:migration — 编排 soso-kit 现有命令实现 sodex-web → sodex-next 结构化迁移工作流
- /k:plan — 确认执行方案并拆分实现步骤
- /k:pr — 根据当前分支与目标分支的差异生成结构化 PR 标题与正文
- /k:review — 对代码变更进行深度审查：完整性、规范性、边界、意图
- /k:security — 扫描前端项目依赖安全性，检测恶意包和已知漏洞
- /k:spec — 理解需求背景并生成功能规范
- /k:study — 获取、分析 GitHub 项目并与 soso-kit 对比，输出结构化研究文档
- /k:task — 执行任务清单，按步骤实现需求
- /k:ui-migration — UI 迁移（Phase 1 精简版）：figma 还原 → props 化 → 落地 features/，供 /k:migration 对接
- /k:ui — UI/样式需求二次确认，确保理解一致后再实现
- /k:version — 版本矩阵查询与 bump：list / show / bump
<!-- AUTO-GENERATED END -->

## 模块结构

<!-- AUTO-GENERATED START -->
- analyze-live/ (3 scripts, 1 docs)
- auto/ (3 scripts, 0 docs)
- check/ (2 scripts, 3 docs)
- clarify/ (3 scripts, 0 docs)
- cli/ (11 scripts, 0 docs)
- codex/ (2 scripts, 0 docs)
- commands/ (0 scripts, 0 docs)
- context/ (35 scripts, 138 docs)
- cowork/ (1 scripts, 4 docs)
- cp/ (1 scripts, 4 docs)
- debug/ (1 scripts, 1 docs)
- deploy/ (5 scripts, 1 docs)
- docs/ (0 scripts, 3 docs)
- draft/ (1 scripts, 4 docs)
- figma/ (1 scripts, 5 docs)
- mastery/ (2 scripts, 2 docs)
- migration/ (2 scripts, 40 docs)
- plan/ (3 scripts, 1 docs)
- principles/ (0 scripts, 4 docs)
- projects/ (0 scripts, 56 docs)
- scripts/ (3 scripts, 0 docs)
- security/ (2 scripts, 0 docs)
- spec/ (2 scripts, 0 docs)
- startup/ (0 scripts, 0 docs)
- study/ (5 scripts, 16 docs)
- task/ (1 scripts, 0 docs)
- templates/ (0 scripts, 12 docs)
- ui-migration/ (0 scripts, 4 docs)
- ui/ (2 scripts, 0 docs)
<!-- AUTO-GENERATED END -->

## 核心设计哲学

<!-- MANUAL START -->
**底层分工**
- 脚本处理机械操作（文件扫描、JSON 读写、git 操作），AI 处理智能分析
- Shell 输出 JSON / 计数 / 退出码，workflow .md 编排流程并消费这些信号

**判断机制（替代 AI 自我判断的核心）**
- **VERDICT 机械评分**：spec 阶段 5 维度计分 + 6 类红线扫描 → simple / medium / complex，下游 plan / task / check 按 VERDICT 调强度，避免 AI 自判「这个简单」
- **HARD-GATE 原子块**：关键步骤把信号收集合并为单个 Bash 块（如 commit 4 路信号、check 三闸门），禁止凭 session 记忆跳过
- **信号密度优先**：commit 用 `-U0` + numstat 替代 `-U3` 全量；check 输出按 verdict 分级压缩；先压每行密度再谈采样

**工作流水线**
- clarify → spec → plan → task → check / commit / pr 全链路，每步可独立跳入、可重入
- simple 档可跳过 plan 直达 task，complex 档走完全部信号扫描
- 4 层 Context 系统：index → router → sections → full document，读写分离命令族

**反模式与教训**
- **反「AI 记忆作 ground truth」**：formatter / hook / 用户手改都可能改文件，状态判断必须实跑 git / tool，不可凭印象
- **反「同源 subagent 防偏差」**：实测 0 命中（同模型 + 同 spec + 同 repo 共享偏差源），已删除，改用质疑前提 + 机械评分
- **反「输出层冗长 = 严格」**：constitution「严格 ≠ 繁琐」分层——工序层可严格（grep / 自检 / 反查），输出层必须简洁
- **反「过度根因化」**：bug / 异常必追根因，日常功能开发不强求

**规则层定位**
- `essential/` 元原则 + clean-code + commit 规范，少而精，每条规则必须能回答「删了会怎样」
- `modules/<project>/` 项目专属约束，避免污染通用层
- 红线分 6 类跨栈：auth-payment / schema-migration / money-precision / crypto-sign / secret-handling / api-breaking
<!-- MANUAL END -->

## 技术栈

- Shell (bash) 脚本
- Claude Code workflow (.md)
- jq 处理 JSON
- Context Library 知识管理
- Git 版本控制集成
