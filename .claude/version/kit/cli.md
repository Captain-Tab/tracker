---
module: cli
type: kit
version: 1.22.0
released: 2026-06-09
versioning: semver
status: active
source: .claude/kit/cli/
---

# soso-kit 变更日志

> 版本约定：SemVer，第一个 `## v<x.y.z>` 即当前版本。

## v1.22.0 - 2026-06-09

### ✨ sosokit-deploy — Lark 通知支持多个 Linear Issue + 提取算法强化

**背景**：v1.21.0 单 Linear ID 提取在两类 branch 下不工作：
1. **多 issue branch**（如 `bugfix/sod-189-sod-204-xxx`）—— 仅显示第一个 ID
2. **长单词内部误命中**（如 `feat/sod-189-doable-1-task`）—— grep 在 `DOABLE-1` 内部"挖"出 `OABLE-1` 当 ID

**改动**：

| 文件 | 变更内容 |
|------|----------|
| `scripts/notify.sh` | `_extract_linear_id` → `_extract_linear_ids`（复数）；算法从 `grep -oE` 改为 `sed + awk` 按分隔符切片；要求整 token 严格匹配 `[A-Z]{2,5}` + 紧跟纯数字 token；输出多行（一行一 ID），自动去重保序；notify_lark_success 改为 while 循环累加 JSON 数组，jq 用 `$linears[]` 展开生成多行可点击 Linear 项 |

**新算法核心**：

```bash
echo "$branch" \
  | tr '[:lower:]' '[:upper:]' \
  | sed 's|[/-]|\n|g' \
  | awk '/^[A-Z]{2,5}$/{prev=$0;next} /^[0-9]+$/{if(prev!="")print prev"-"$0;prev="";next} {prev=""}' \
  | awk '!seen[$0]++'
```

关键点：按 `/` 和 `-` 切片成 token，**每个 token 必须整段匹配**，杜绝从 `DOABLE` 这种 6+ 字母长单词内"挖"出 5 字母子串。

**算法实测**：

| Branch | 提取结果 |
|---|---|
| `feat/privy` | 空 |
| `feat/sod-95-fix` | `SOD-95` |
| `bugfix/sod-189-sod-204-xxx` | `SOD-189`, `SOD-204` |
| `feat/sod-1-sod-1-cleanup` | `SOD-1`（去重）|
| `bugfix/sod-1-eng-12-cross-team` | `SOD-1`, `ENG-12`（跨团队）|
| `feat/sod-189-doable-1-task` | `SOD-189`（**DOABLE-1 不再误命中**）|
| `release/2026.06.01` | 空 |

**容错矩阵**（多 ID 场景）：

| 情况 | 处理 |
|------|------|
| branch 无 ID 匹配 | linears 数组为空，跳过整个 Linear 段 |
| 多个 ID 中部分 Linear 查不到 | 只显示成功的 ID，失败的 ID 静默跳过 |
| 全部 ID 查不到 | linears 数组空，整段 Linear 不显示 |
| Linear API 单次网络错 | 该 ID 跳过，不阻塞其他 ID |
| LINEAR_API_KEY 空 | 全部跳过 |

**消息样例**（branch = `bugfix/sod-189-sod-204-xxx`）：

```
✅ Preview 测试 部署成功
本次改动: 修复两个关联 issue 的 UI 对齐
Linear Issue: SOD-189 - 点击 banner 跳转后的 toast 提示    ← 整段可点
Linear Issue: SOD-204 - evm 到 spot 转 soso gas 不足       ← 整段可点
提交: fix(modal): close button alignment
分支: bugfix/sod-189-sod-204-xxx
部署环境: https://preview-08.sodex.io/...                 ← URL 可点
推送人: Tab
```

**性能**：最坏 N 个 ID × 单次 10s timeout = 最坏 N×10s 串行，典型 < 3s。

**验证**：

- bash -n / zsh -n 双语法 OK ✓
- 8 路径 dry-run 测试通过（含旧 OABLE-1 误命中边界用例）✓
- while/here-string 在 zsh 下 loop count 实测 = 2 ✓
- 真实 Linear API 多 ID 查询返回正确（SOD-189 + SOD-204 各自标题与 URL）✓
- 凭据扫描零泄露 ✓
- `.claude` / `.cursor` 镜像 parity ✓

---

## v1.21.0 - 2026-06-09

### ✨ sosokit-deploy — 部署成功推送 Lark 富文本通知 + 可选改动说明 + Linear 自动关联

**背景**：v1.20.0 sleep 方案落地后，部署完成后团队感知滞后，需手动同步到群。本版引入 Lark 自定义机器人通知，并支持：
- 输入本次改动说明（可选）
- 根据 branch 自动匹配 Linear issue 并显示可点击链接
- 整条消息用 post msg_type，URL 文字均可直接点击跳转

**改动**：

| 文件 | 变更内容 |
|------|----------|
| `scripts/notify.sh`（新建）| `notify_lark_success(commit_msg, branch, target_url, pusher, [change_note])`；内含 `_extract_linear_id`（正则 `[A-Z]{2,5}-[0-9]+`）+ `_linear_lookup`（Linear GraphQL 查 title/url）；payload 用 Lark post 富文本（`tag:a` 超链接）；jq 安全序列化；curl 10s 超时；任何失败 `return 0` 不阻塞部署 |
| `scripts/run.sh` | source notify.sh；选完 preview 环境后增 `read CHANGE_NOTE` 输入（可留空）；verify_deploy 后调用 notify_lark_success 传 5 参；推送人硬编码 "Tab" |
| `const.sh` | 新增 `LARK_WEBHOOK_URL` + `LINEAR_API_KEY` 两个变量；含获取方式注释；留空则跳过对应特性 |

**消息模板**：

完整版（branch 含 Linear ID + 用户填了 change_note）：
```
✅ Preview 测试 部署成功
本次改动: 修复 TP/SL 限价触发
Linear Issue: SOD-95 - TP/SL 支持触发限价成交     ← 整段可点跳转 Linear
提交: feat(modal): 限价平仓改响应式
分支: feat/sod-95-limit-close
部署环境: https://preview-10.sodex.io/...         ← URL 可点
推送人: Tab
```

最小版（branch 无 Linear ID + change_note 留空）：
```
✅ Preview 测试 部署成功
提交: Merge branch 'main' into feat/privy
分支: feat/privy
部署环境: https://preview-07.sodex.io/...
推送人: Tab
```

**容错矩阵**：

| 情况 | 处理 |
|------|------|
| `LARK_WEBHOOK_URL` 空 | 静默跳过整个通知 |
| `LINEAR_API_KEY` 空 | 跳过 Linear 查询，其余正常 |
| branch 无 `[A-Z]{2,5}-[0-9]+` 匹配 | 跳过 Linear 行 |
| Linear API 返回 null / 网络错 | 跳过 Linear 行，正常推送其余 |
| `change_note` 留空 | 省略「本次改动」行 |
| Lark API 推送失败 | warning，部署主流程不受影响 |
| 任何错误 | `return 0`，绝不阻塞部署 |

**为什么用 post msg_type**：text msg_type 仅自动渲染纯 URL，无法让"SOD-95 - 标题"这段文字作为单一超链接。post 模式支持 `tag:"a"` 富文本，整段文字 + href 一体可点，视觉与体验更专业。

**为什么不挂失败通知**：部署失败时终端已有完整诊断（4 行可能原因 + 3 条排查指引），重复推群只会污染。如未来有需求可加 `notify_lark_failure`。

**验证**：

- bash -n / zsh -n 双语法 OK ✓
- 4 路径 dry-run 测试通过（含 Linear / 不含 Linear / change_note 空 / change_note 非空）✓
- 真实 Linear API（SOD-1 命中 / SOD-99999 不存在）查询 + 容错路径实测 ✓
- 真实 Lark 群推送 + 富文本渲染视觉验证 ✓
- `.claude` / `.cursor` 三份镜像 diff parity ✓

---

## v1.20.0 - 2026-06-09

### 🔁 sosokit-deploy — 回滚智能等待，改为 3 分钟死等 + Rancher 8 分钟重试窗口

**背景**：v1.19.0 引入的 GitHub Actions API 智能等待在团队实际使用时碰壁——sosovalue-tech 组织 SSO 强制 PAT 最长 7 天有效期，团队成员每周换 token 的摩擦不可接受。本次回滚智能等待整套实现，把"等够长"的责任从"等 build 完成"转嫁给"让 Rancher 滚动更新等够长"——本质上让 K8s 自己的 ImagePullBackOff 重试做镜像就绪的轮询。

**改动**：

| 文件 | 变更内容 |
|------|----------|
| `run.sh` | 删除 `wait_for_build_ready` / `check_gh_token` 函数（共 ~140 行）；常量 `GITHUB_REPO` / `GITHUB_WORKFLOW` 删除；选项 2 改为 sleep 180s（3 分钟，`seq 180 -5 5`）；`do_deploy` 内 Rancher 滚动更新轮询从 `38×8s` 扩到 `60×8s`（5min → 8min）；菜单文案"智能等待..."→"等待 3 分钟后部署（Rancher 重试窗口已自动延长到 8 分钟）" |

**时间窗设计**：

| 阶段 | 时长 | 行为 |
|---|---|---|
| Stage 1 | 0–180s | sleep 死等，给 build 跑起步时间 |
| Stage 2 | 180–660s（最长 8min） | Rancher PATCH + K8s ImagePullBackOff 自动重试拉取，直到 pod 起来或超时 |
| 重试 | 失败后 30s 间隔，最多 2 次 | 现有行为不变 |

**最坏总耗时**：3min + 8min × 2 + 30s = 19.5min；典型场景（build 4min）：3min + 1-2min = ~5min。

**失败信号**：

- 镜像永不就绪 → 8min 后超时报错，30s 后第二轮，最终输出三条排查指引（GitHub Actions / Rancher / 容器日志）
- Rancher API 临时挂 → curl 非 0，8s 后重试
- SHA 不匹配 → `verify_deploy` 末尾 ⚠️ 警告对比期望/实际

**为什么不做智能等待**：

- 组织 SSO 强制 7 天 PAT rotation，团队每周换 token 摩擦不可接受
- AWS ECR 直查方案失败感知与 sleep 方案同延迟（都靠超时兜底），收益太小
- 让 K8s 自己 backoff 重试 = 零新依赖、零鉴权、删码 140 行净减

**验证**：

- bash -n / zsh -n 语法 OK ✓
- 残留 `wait_for_build_ready` / `check_gh_token` / `GH_TOKEN` 引用核查为 0 ✓
- `.claude` 与 `.cursor` 两份镜像 diff 无差异 ✓

---

## v1.19.0 - 2026-06-09

### ✅ sosokit-deploy — 智能等待替换固定 4 分钟死等

**背景**：选项 2 之前固定 sleep 4 分钟，要么过早（镜像还没就绪导致部署旧版本）、要么过晚（构建早完了空等几分钟）。改成基于 GitHub Actions 构建状态的阶梯轮询，命中 build success 立即进入 Rancher 阶段。

**改动**：

| 文件 | 变更内容 |
|------|----------|
| `run.sh` | 新增 `check_gh_token`（`$GH_TOKEN` 环境变量探测）+ `wait_for_build_ready`（三阶段轮询函数，curl + jq 调 GitHub REST API）；SHA 行加判空兜底；选项 2 由 `seq 240 -5 5` 死等替换为 `wait_for_build_ready "$SHA"`；菜单文案"等待 4 分钟"→"智能等待构建完成（最长 10 分钟）" |

**轮询时间窗**：

| 阶段 | 区间 | 节奏 |
|------|------|------|
| Stage 1 | 0–180s | 静默 sleep，不查 API |
| Stage 2 | 180–300s | 每 20s 一次 `gh run list` |
| Stage 3 | 300–600s | 每 60s 一次 `gh run list` |
| Timeout | ≥600s | 报错退出 |

**错误处理矩阵**：

| 情况 | 处理 |
|------|------|
| `conclusion=success` | 立即跳出，进入 Rancher |
| `conclusion ∈ {failure, cancelled, timed_out, ...}` | 立即报错 + 显示 run URL |
| HTTP 401 / 403 / SAML enforcement | 致命错误，指引 `gh auth refresh` + 组织 SSO 授权 |
| 其他 gh API 错（网络抖动等） | 连续 3 次后退出，单次成功重置 |
| Stage 2 首次空数组 | 提示"是否已触发构建"，继续轮询不报错 |
| 非 git 目录（SHA 为空） | 启动时直接退出 |

**设计要点**：

- 鉴权用 `$GH_TOKEN` 环境变量（建议写入 `~/.zshrc`），不在 const.sh 持久化 token；curl + jq 沿用脚本现有模式，零新二进制依赖
- PAT scope 收紧到 `actions:read`（fine-grained）或 `repo`（classic），首次创建需点 "Configure SSO" 授权 sosovalue-tech 组织
- 进入选项 2 时打一段一次性说明（三阶段节奏 + 失败/超时行为），用户预期明确
- Stage 切换打 `🔔 进入 Stage 2/3：...`，便于判断脚本是否在跑
- Rancher 阶段（`do_deploy` + `verify_deploy`、38×8s 滚动更新、30s 重试间隔）零变更

**验证**：

- bash -n / zsh -n 语法 OK ✓
- 关键分支（GH_TOKEN 探测/SHA 兜底/head_sha 过滤/curl HTTP 状态码/401/403/SAML/容忍/Stage 切换/空提醒/超时）静态可证 ✓
- `.claude` 与 `.cursor` 两份镜像 diff 无差异 ✓

---

## v1.18.0 - 2026-06-08

### spec 目录持久备份与回填 —— 修复 clean 删除未追踪 spec 的数据丢失根因

**背景**：`sosokit-clean` 无差别 `rm -rf <配置目录>` 会删掉 `kit/spec/` 下未被 git 追踪的用户文档（宿主项目 `.gitignore` 白名单把 `kit/` 挡在追踪之外），`git checkout HEAD` 无法恢复 → spec 永久丢失。典型触发：skip-worktree 挡住 `git merge` → 需 `clean → merge → install`，clean 一刀删掉 spec。

### Added

- `kit/cli/lib.sh::spec_backup_dir <proj> <mode>` — 基于 `git_state_path` 的 git-dir 计算 `<git-dir>/sosokit-spec-backup-<mode>`，worktree 隔离、git 不追踪、mode 后缀隔离 claude/cursor
- `kit/cli/clean.sh::backup_spec` — 在所有 rm 之前持久备份 spec（除 `scripts/` 外全部，含 AUTO 等 flat 文件）；单份 + 一层 `.prev` 回收站（rotate 无条件，不做差异检测）

### Changed

- `kit/cli/install.sh` spec 回填优先级扩展为「现场 spec > 持久备份 > 空」，install/update 统一尝试持久恢复（以「持久备份存在」作为本项目曾被托管的信号）
- `kit/cli/clean.sh::on_interrupt` 中断提示补一行 spec 持久备份路径

### Fixed

- clean 删除未追踪 spec 导致用户需求文档永久丢失的根因

### 兜底

- 空 spec 跳过备份（避免两次空 clean 冲掉 current + `.prev`）
- 备份失败 `error` 中止 clean，未删除任何文件（数据安全红线）
- 无 git 仓库告警「spec 不会被持久备份」，不静默
- install 持久恢复失败 `warn` 打印备份绝对路径，不中止主体安装

## v1.17.0 - 2026-05-22

### ✅ install/sync 支持 essential 分层 —— rules 跨项目共享层落地

**背景**：5 个 sodex-* 模块下 `constitution.md` / `git-commit.md` / `clean-code.md` / `regular.md`(base) 内容跨模块 100% 重复（git-commit 5/5、constitution 5/5、clean-code 3/3 hash 完全一致；regular 5/5 共享 13 行 base），每改一处要改 5 处。借鉴 mattpocock/skills 的 essential 分层思想，把这 4 个共享 rules 抽到 `.claude/rules/essential/`，cli 两端同步支持。

**关键洞察**（参见 study/output/mattpocock-skills.md）：当前注入策略全 always-on 导致大量重复；mattpocock 的 soft/hard dependency 分级 + lazy creation 思想适合先以"结构分层"先行落地，token 经济效益留待下一轮 model-invoked skill 化。

### 变更

| 文件 | 改动 |
|---|---|
| `kit/cli/install.sh::apply_family_rules` | 在原有 cp `modules/<family>/*.md` 之前先 cp `essential/*.md`；essential 在前可被 module 同名文件覆盖（约定不应冲突）；目标 `essential/` 不存在时跳过（向后兼容旧仓） |
| `kit/cli/sync.sh` | 反向同步引入 `SPLIT_TMP/SPLIT_ESSENTIAL/SPLIT_MODULE` 分流：用 `target/rules/essential/` 文件名集合作为分流键，命中的写回 `essential/`、其余写回 `modules/<family>/`；diff 显示、验证、清理三段分流 |
| `kit/cli/sync.sh` (兼容) | 用空格分隔字符串 + `case` 模式匹配模拟 set，避开 bash 3.x 无 `declare -A` 限制（macOS 默认 bash） |
| `kit/cli/sync.sh` (清理) | `SPLIT_TMP` 在所有 exit 路径清理：无变更 / --dry-run / 用户取消 / cp 失败 / 验证失败 / 成功 |

### 分流逻辑

```
source/rules/*.md (下游扁平结构)
  ├─ 文件名 ∈ target/rules/essential/*.md → SPLIT_ESSENTIAL → essential/
  └─ 其余                                  → SPLIT_MODULE    → modules/<family>/
```

target 无 essential 目录 → 集合为空 → 所有文件归 module → 等价于旧版行为（向后兼容）。

### 测试矩阵

| 场景 | 结果 |
|---|---|
| install sodex-web 到 /tmp | 4 essential + 6 module = 10 个文件 ✓ |
| install sodex-next 到 /tmp | 4 essential + 10 module（含 regular-extra） = 14 ✓ |
| install sodex-biz（空模块）到 /tmp | 4 essential + 0 module = 4 ✓（仅 essential）|
| sync dry-run：下游同时改 constitution + precision-calculation | constitution → essential/、precision-calculation → modules/sodex-web/ ✓ 分流正确 |
| sync dry-run：下游新建无关 .md 文件 | 归入 modules/<family>/ ✓ |
| bash 3.x 兼容（macOS 默认） | 无 declare -A，case 模式匹配通过 ✓ |
| SPLIT_TMP 各 exit 路径 | 6/6 清理覆盖 ✓ |

### 已知非目标

- `install.sh::walk_rules_diff` 在 update 模式下仍用 `modules/<family>/` 对比 `target/rules/`，不分层比对——影响 diff 预览精度，不影响功能（最终 `apply_family_rules` 清空重装）。留作 v1.17.1 优化
- `sosokit-add` 新建项目时未为新模块挂上 essential 引用（实际上不需要——essential 由 install 自动装载，模块目录可空）

### 配套 rules 重组

参见 `version/rules/essential.md` v1.0.0（初次抽取记录）。

---

## v1.16.1 - 2026-05-19

### Changed

- `sosokit-conversation` 列表卡片右侧元信息：在日期前追加文件大小（B/KB/MB/GB 自适应），用 `·` 分隔，参考 `4 days ago · main · 1MB` 视觉
- 影响文件：`.claude/kit/cli/conversation.sh`（HELPEREOF heredoc 内嵌的 Python，新增 `format_size()` 与 `fsize` 读取）

## v1.16.0 - 2026-05-19

### Changed

- `sosokit-conversation` 列表改为卡片式两行布局（参考新闻卡片视觉）：
  - 第 1 行：加粗标题（左，完整不截断） + 日期（右，灰色，按 80 列宽对齐）
  - 第 2 行：灰色最后一条用户消息（放宽到 80 显示宽，独占一行）
  - 日期格式由 `MM-DD HH:MM` 改为 `YYYY-MM-DD HH:MM`，包含年份避免跨年误读
- 技术细节：helper list 输出由 `\n` 分隔改为 `\0` 分隔（bash 变量无法持 NUL，conversation.sh 直接管道喂给 fzf）；fzf 加 `--read0 --gap=1` 启用多行 item 渲染

### Fixed

- `sosokit-conversation` 列表的标题与摘要不准确：
  - 标题优先级改为 `custom-title` → **`ai-title`**（Claude Code 自动生成的会话标题，字段 `aiTitle`）→ `agent-name` → 首条干净用户消息；之前漏读 `ai-title` 导致与 Claude Code `/resume`、终端 tab 标题不一致
  - 过滤器加入 `<task-notification>` / `<system-reminder>` / `<tool-use-id>` 标签，并跳过 `isMeta` / `isSidechain` 的 user 消息，避免 subagent 工具结果污染会话列表
  - 摘要从「第 2 条用户消息」改为「最后一条用户消息」，更贴合"最近上下文"语义
- 影响文件：`.claude/kit/cli/conversation.sh`（HELPEREOF heredoc 内嵌的 Python）；`.conversation-helper.sh` 由 `conversation.sh` 启动时重写，单独改 helper 文件每次运行会被覆盖回旧版——必须改 heredoc 才能持久生效

## v1.15.0 - 2026-05-13

### ✨ 工作流 allow 模板自动下发 —— 免去 `/k:*` 命令权限弹窗

**背景**：v1.14.1 修完 settings 互相覆盖后，目标项目跑 `/k:context-record`、`/k:check` 等命令会反复触发权限弹窗，因为目标 `settings.local.json` 不含 soso-kit 工作流脚本的 allow。讨论中比较了三条路径：

| 方案 | 评估 |
|---|---|
| 用户级 `~/.claude/settings.json` + 手动 setup-allows.sh | 作用域过广（污染非 soso-kit 项目）、跨机器要重做、用户主动跑命令 |
| 不分发，首次弹窗后 Claude Code 自动写入 | 多项目重复劳动 |
| **install 自动 merge 模板到目标 `settings.local.json`** | 作用域精确（限定 sosokit-install 过的项目）、零额外动作、跨机器 install 即恢复 |

### 变更

| 文件 | 改动 |
|---|---|
| `kit/cli/templates/user-allows.json` | **新增** 模板文件，52 条 allow，覆盖 soso-kit 工作流脚本（`bash .claude/kit/**`）、`sosokit-*` CLI、只读 git、Bash 基础读、`pnpm`/`node`/`npx`/`python3` 运行时 |
| `kit/cli/install.sh` | 在 v1.14.1 的 settings 备份-恢复链之后追加 jq merge：模板的 `permissions.allow` 数组与目标 `settings.local.json` 现有 allow 并集 unique 去重；目标其他 key（`outputStyle`、`hooks`、`additionalDirectories` 等）完全不动；目标无 settings.local.json 则用模板创建（剔除 `_meta`） |

### 模板设计原则

- ✅ 走相对路径 `.claude/kit/**`（任何 sosokit-install 过的项目都适用）
- ✅ 只读 / 调用 soso-kit 自身脚本 / 通用包管理器
- ❌ 绝对路径（`/Users/.../...`）
- ❌ 调试残留 / MCP 特定 / WebFetch 特定域名（项目方按需自行添加）
- 含 `_meta` 字段说明 purpose / merge_strategy / version / doc，merge 时自动剔除不入目标

### 合并语义

```
jq -s '
  .[0] as $cur | (.[1] | del(._meta)) as $tpl |
  $cur * { permissions: {
    allow: (($cur.permissions.allow // []) + ($tpl.permissions.allow // [])) | unique
  }}
' "$target_local" "$allows_template"
```

- 模板 `permissions.allow` ∪ 目标 `permissions.allow` → unique
- 目标其他 top-level key 完全保留（`$cur * { permissions: ... }`）
- 目标 `permissions.additionalDirectories` 等同级字段完全保留（`*` 是 jq 的 deep merge）

### Trade-off 声明

| 场景 | 行为 | 备注 |
|---|---|---|
| 用户主动从 `settings.local.json` 删某条模板 allow | 下次 install 会复活它 | 模板是"权威基线"，删除请清理模板或在 jq 后处理 |
| 模板移除某条 allow | install 不会从已有项目里删旧条目（jq union 只加不减） | 残留条目对功能无害，按需手动清理 |
| jq 未安装 | 跳过 merge 并 `warn`，install 主流程继续 | 失败安全 |
| 目标 `settings.local.json` 非合法 JSON | 跳过 merge 并 `warn`，原文件不动 | 防止破坏 |

### 测试矩阵

| 场景 | 结果 |
|---|---|
| T1 全新项目（无 settings.local.json） | 创建文件，52 条 allow，无 `_meta` ✓ |
| T2 已有 settings.local.json + `outputStyle` + `hooks` + 自定义 allow 重叠 | 全部 top-level / 同级字段保留，allow union 去重（53 条）✓ |
| T3 二次 install 幂等 | 仍 53 条，无膨胀 ✓ |
| T4 用户删模板条目后 install | 复活（trade-off 如预期）✓ |
| T5 真实项目 dry-run | settings 仍在 diff 之外（不污染 sync 显示）✓ |

### 体验

```
首装 / 更新（5 秒，零交互）：
  sosokit-install ~/code/sodex-next-feature

之后在该项目内：
  /k:context-record ...          # 直接执行，无弹窗
  /k:check                       # 同上
```

每次 install 自动幂等同步最新模板，新增分发 allow 时无需用户主动配置。

### 后续动作（独立动作，本次未做）

清理 `soso-kit/.claude/settings.json`（仍含 `sosokit-install`、`ln`、`git-worktree skill`、`debug` 服务等开发用 allow），整理后并入 soso-kit 维护者自用的 `settings.local.json`，源仓 `settings.json` 可整张删除。

---

## v1.14.1 - 2026-05-13

### ✅ settings 文件无差别销毁 —— install 覆盖项目 hooks、sync 污染源仓

**现象**：
- `sosokit-install` 把目标项目原有的 `.claude/settings.json`（团队 hooks + 项目 allow）覆盖成 soso-kit 仓的版本，项目方维护的 hooks 蒸发
- `sosokit-sync` 反向把项目 `settings.json` 推回 soso-kit 源仓，污染源仓基线
- `settings.local.json` 同时被双向覆盖：源仓维护者的私人 allow 被项目方版本顶替，反向亦然

**根因**：

| 层 | 缺陷 |
|---|---|
| `lib.sh::is_excluded` | 排除清单缺 `settings.json` / `settings.local.json`，diff 把它们当普通文件处理 |
| `install.sh` | `rm -rf "$target_config" + cp -r "$SOSO_KIT_CONFIG"` 整目录销毁重建，对范围外文件无差别物理覆盖 |
| `sync.sh` | TEMP 阶段 `cp -r "$SOURCE_CONFIG"` 带入项目 settings，swap 后留在源仓 |

更深的边界错位：`settings.json` 本质属项目级团队配置，`settings.local.json` 属用户级本地配置，**两者本就不该进入 soso-kit 分发链**。

### 变更

| 文件 | 修复 |
|---|---|
| `kit/cli/lib.sh` | `is_excluded` 双向排除 `settings.json` / `settings.local.json` |
| `kit/cli/install.sh` | 备份目标 settings 两文件到 mktemp → rm-rf 整目录 → cp 源仓 → 删除源仓带来的 settings → 从备份恢复 |
| `kit/cli/sync.sh` | TEMP 阶段先 `rm` 掉项目 settings 两文件、再从 TARGET 恢复原版，与 `figma references` 同款"项目本地不污染源仓"策略 |

### 设计要点

- **物理保护 + diff 排除双管齐下**：只加 `is_excluded` 不够，install 的 `rm -rf` 模型会直接抹掉文件；只加备份不够，sync 仍会推回污染
- **soso-kit 源仓里的 `settings.json` 不再分发**：install 完成时无条件 `rm` 掉源仓带来的 settings，目标只保留备份恢复的项目原版（若有）
- **首装/虚机项目**：目标本无 settings → 备份为空 → install 完成后目标仍无 settings，由项目方自行创建

### 测试矩阵

| 场景 | 结果 |
|---|---|
| 项目带 marker 的 settings.json/local，install update | marker 完整保留 ✓ |
| 全新项目（无 .claude）首装 | 不创建 settings，源仓版本不分发 ✓ |
| 二次 update | 状态幂等 ✓ |
| sync dry-run（含 sodex-next-feature） | settings 不出现在 diff ✓ |
| install dry-run | settings 不出现在 diff ✓ |
| 三脚本 `bash -n` | 通过 ✓ |

### 后续动作（正交，不在本次范围）

`soso-kit/.claude/settings.json` 当前还含开发用 allow（`sosokit-install`、`ln`、`git-worktree skill`、`debug` 服务等），按本次新语义这些只在源仓内有用，可后续清理并入维护者自用的 `settings.local.json`，无需脚本配合。

---

## v1.14.0 - 2026-05-13

### ✅ sosokit-deploy — 迁移到 sodex-next 项目

**背景**：项目主仓由 `sodex-web` 切换至 `sodex-next`（https://github.com/sosovalue-tech/sodex-next），ECR 镜像名同步变更为 `preview/sodex-next`。同时 sodex-next 构建耗时短于 sodex-web，等待计时从 7 分钟下调至 4 分钟。

**改动**：

| 文件 | 变更内容 |
|------|----------|
| `const.sh` | `SODEX_WEB_REPO` → `SODEX_NEXT_REPO`，路径指向 `/Users/soso/Documents/code/sodex-next` |
| `run.sh` | GitHub Actions URL、ECR 镜像名、分支反查、所有 echo 文案统一替换为 sodex-next；等待计时 `seq 420 -5 5` → `seq 240 -5 5`，菜单与提示文案"7 分钟"→"4 分钟" |
| `deploy.sh` | 同 run.sh（4 处 sodex-web 字面量 + URL） |
| `build.sh` | Actions URL 替换 |
| `README.md` | 文档链接替换 |

**验证**：

- sodex-next 仓库 `.github/workflows/build.yml` 存在，`service_name: sodex-next`，environment 含 `preview`，与新流程兼容 ✓
- Rancher 阶段（38×8s 滚动更新轮询、30s 重试间隔）保持不变 ✓
- `.claude` 与 `.cursor` 两份镜像同步更新 ✓

---

## v1.13.2 - 2026-04-21

### ✅ kit/spec 子目录未隔离 —— sync 误推、install 丢失用户 spec

**现象**：在 `sodex-next-feature` 执行 `sosokit-sync` 时，`kit/spec/vault-migration/*.md` 被当作"新增"推回 soso-kit 源仓。同时 `sosokit-install` 更新模式下，目标项目 `kit/spec/` 子目录里的 spec 文档会被源仓版本覆盖丢失。

**根因**：旧过滤规则只认扁平 `kit/spec/*.md`，不覆盖子目录。

| 位置 | 旧逻辑 | 缺陷 |
|------|------|------|
| `lib.sh::is_excluded` | `[[ $path == kit/spec/*.md ]]` | glob 只匹配一级，`kit/spec/vault-migration/xxx.md` 未排除 |
| `install.sh` 备份 | `cp "$spec_dir"/*.md "$spec_backup/"` | 子目录不备份 |
| `install.sh` 首装清空 | `rm -f "$spec"/*.md` | 子目录残留 |
| `sync.sh` 末尾清理 | `rm -f "$spec"/*.md` | 子目录被推回源仓 |

新 spec 工作流（`/k:spec`、`/k:plan`、`/k:task`）按 feature 分子目录存放文档，旧规则完全没覆盖。

### 变更

| 文件 | 修复 |
|------|------|
| `kit/cli/lib.sh` | `is_excluded` 改为"保留 `kit/spec/scripts/`、排除 `kit/spec/*` 其余所有"，同时覆盖 flat md + 子目录 |
| `kit/cli/install.sh` | 备份遍历 `$spec_dir/*` 除 `scripts/` 外全部 `cp -a` 到 backup；恢复/首装清空改用 `find -mindepth 1 -maxdepth 1 ! -name scripts` |
| `kit/cli/sync.sh` | 末尾兜底清理同步升级为 find 方案 |

### 设计要点

- **保留 `kit/spec/scripts/`**：源仓维护的 `context-preflight.sh` 等脚本仍跟随同步，不算"用户内容"
- **备份用 `cp -a` 而非 `mv`**：脚本中断时用户内容仍在原位，失败安全
- **双保险**：`is_excluded` 阻止进 diff + find 兜底清理，避免 temp 残留污染源仓

### 测试矩阵

| 场景 | 结果 |
|------|------|
| sync dry-run（feature 含 `kit/spec/vault-migration/`） | 子目录文档不再出现在 diff ✓ |
| install dry-run（update 模式） | 同上 ✓ |
| 三脚本 `bash -n` | 通过 ✓ |

### 已知限制

已存在于目标项目但被历史 install 冲掉的 spec 子目录文档，需从各自 git 历史恢复，脚本修复不回溯数据。

---

## v1.13.1 - 2026-04-20

### ✅ worktree 支持修复 —— 硬编码 `.git/` 路径在 worktree 下失效

**现象**：在 git worktree 目录（如 `sodex-next-feature`）执行 `sosokit-install` 后，`.claude/*` 文件仍被 git 追踪，`git status` 满屏变更（用户实测 88 项）。

**根因**：worktree 的 `.git` 是**文件**（`gitdir: /path/to/main/.git/worktrees/<name>`），不是目录。原脚本对 `.git/info/exclude` 和 `.git/sosokit-state` 做了硬编码拼接：

| 文件 | 硬编码位置 | worktree 下后果 |
|------|------|------|
| `install.sh::write_exclude_block` | `$target/.git/info/exclude` | `mkdir -p .git/info` 失败 |
| `install.sh::write_state` | `$target/.git/sosokit-state` | 写入失败位置 |
| `install.sh` git 检测 | `[[ -d "$target/.git" ]]` | false，`hide_from_git` 整个跳过 |
| `clean.sh` / `status.sh` | 4 处读取 | 读错位置 |

之前 `/k:check` 未发现，因为端到端测试只在 `/tmp/sosokit-test`（普通仓库，`.git` 是目录）跑，没覆盖 worktree 场景——**这是 check 的遗漏，已列为教训**。

### 变更

| 文件 | 修复 |
|------|------|
| `kit/cli/lib.sh` | 新增 `git_exclude_path(proj)` / `git_state_path(proj)`，用 `git rev-parse --git-common-dir` / `--git-dir` 解析真实路径；`resolve_config_mode` 默认走 `git_state_path` |
| `kit/cli/install.sh` | `[[ -d .git ]]` → `[[ -e .git ]] && git rev-parse --git-dir`；`write_exclude_block` / `write_state` 参数改经 lib 辅助函数解析 |
| `kit/cli/clean.sh` | 步骤 3/4 读写改用 lib.sh 辅助函数 |
| `kit/cli/status.sh` | `STATE_FILE` / `EXCLUDE_FILE` 改用 lib.sh 辅助函数 |

### 路径解析规则

| 文件 | 位置 | 所有 worktree 共享？ |
|------|------|------|
| `info/exclude` | `--git-common-dir/info/exclude`（主仓） | 是（同一忽略规则） |
| `sosokit-state` | `--git-dir/sosokit-state`（worktree 专属目录） | 否（每 worktree 允许装不同家族） |

### 测试矩阵

| 场景 | 结果 |
|------|------|
| worktree install（sodex-next-feature） | git status 41 → 0 ✓ |
| worktree 幂等 dry-run | "无变更，目标已是最新" ✓ |
| worktree `sosokit-status` | 5 项全 ✅ |
| 另一 worktree（sodex-web-feature） | install + 幂等通过 ✓ |

**建议 `/k:check` 增补**：端到端测试矩阵必须覆盖 worktree 场景（`.git` 是文件），避免同类遗漏。

---

## v1.13.0 - 2026-04-20

### ✨ 新增 sosokit-status + install/clean 防护补强

**背景**：托管态靠三样东西维持——`.git/sosokit-state`、`.git/info/exclude` 的 sosokit 标记块、已追踪文件的 skip-worktree 位。其中任一丢失（被 GUI 工具清除、被用户手动编辑、`git gc` 触及）都会导致托管失效，但 git status 是被"装瞎"的，用户没法靠常规工具诊断。同时 install 原先对宿主 `.claude` 的未提交改动没有保护，首次安装会吞掉用户未 commit 的内容；`git ls-files | xargs` 对含空格/特殊字符的路径会炸。

### 变更

| 文件 | 变更 |
|------|------|
| `kit/cli/status.sh` | **新增** 只读诊断命令：7 项检查（git 仓库根 / state 文件 / exclude 标记块 / skip-worktree 完整性 / 配置目录 / 版本文件 / 版本一致性）；分项 table 输出；退出码细分 `0/1/2/3/10` |
| `kit/cli/lib.sh` | **新增** `read_state_field` 读取 state 单字段；**新增** `resolve_config_mode` 从 state 解析 mode 并回退到 `get_sosokit_mode`（供 clean/status 复用） |
| `kit/cli/install.sh` | **新增** `--force` 参数；首次安装时若宿主 `$CONFIG_DIR_NAME` 有未提交改动则拒绝（update 模式不拦截）；`hide_from_git` 的 `git ls-files` 改用 `-z` + `xargs -0` 处理特殊路径 |
| `kit/cli/clean.sh` | `source lib.sh`；删除内嵌 `resolve_config_mode` 和颜色/日志函数，改用 lib.sh 共用版本；跟踪文件数量改用 `wc -l` 预统计（bash 变量无法保留 NUL），`xargs` 操作改为 `git ls-files -z \| xargs -0` 管道直传，避免含空格/特殊字符路径被截断 |

### 退出码契约（sosokit-status）

| 退出码 | 含义 | 典型场景 |
|--------|------|----------|
| `0` | 健康 | 全部检查通过 |
| `1` | 未安装 | `.git/sosokit-state` 不存在 |
| `2` | 部分失真 | skip-worktree 位丢失、exclude 块被删、版本不一致 |
| `3` | 严重失真 | state 文件损坏、配置目录为空/缺失 |
| `10` | 环境错误 | 不是 git 仓库、不在仓库根目录 |

### 修复建议

- `1` / `2` → 重跑 `sosokit-install`（幂等，自动重建 skip-worktree + exclude 块）
- `3` → 查看 `git log -- <config-dir>`，用 `sosokit-clean` 恢复原项目版本或重装
- `10` → 先 `cd` 到 git 仓库根目录

### 部署

`sosokit-status` 需要手工创建 symlink 后方能作为全局命令使用：

```bash
sudo ln -s /Users/soso/Documents/code/soso-kit/.claude/kit/cli/status.sh /usr/local/bin/sosokit-status
```

（与现有 `sosokit-install` / `sosokit-clean` 的暴露方式一致）

### 兼容性

- `sosokit-install --force` 为**可选**参数，不传时才启用新的脏工作区拦截；现有脚本/CI 如遇到"目标项目 .claude 有未提交改动"会报错并给出 `--force` 提示，按需切换即可
- `lib.sh` 新函数不破坏已有调用方；clean.sh 的 `resolve_config_mode` 语义保持一致

---

## v1.12.0 - 2026-04-20

### ✅ install/sync 共享 lib.sh —— 修复"假变更"误导 + 消除双向不对称

**背景**：v1.10.0 引入 `kit/projects/`、v1.11.0 引入 `rules/modules/<family>/` 后，`sync.sh` 的 diff 过滤（`is_excluded` + 家族化 rules 对比）同步跟进升级，但 `install.sh` 的显示逻辑（L268-296）仍停留在"原始 `diff -rq`"阶段，导致两个问题：

1. **假变更噪音**：`sosokit-install` 输出稳定展示 12 条"变更"（`+ kit/projects/_template`、`+ kit/projects/sodex-next`、`+ rules/.gitkeep`、`+ rules/modules`、`- rules/<10 条扁平 .md>`）。它们是 install 按家族过滤+扁平化的**结构副产物**，不是真有东西待装。用户二次运行时无法确认是否真的幂等。
2. **真实 rules 内容变更完全不可见**：源端 `rules/modules/sodex-web/clean-code.md` 改了内容，原始 `diff -rq` 看到的是源的 `rules/modules/` 和目标的 `rules/*.md` 两个完全不同的路径，只会报 "Only in"，**永远不会报 "Files differ"**。install 的预览对真实变更静默。
3. **双向不对称风险**：sync 的 `is_excluded` 排除 `kit/figma/references/*` 是出于"项目本地自维护"逻辑（保护源仓），但 install 方向会用源覆盖目标，需要在 diff 中**显式提示**——两个方向的过滤规则应不同。

### 变更

| 文件 | 变更 |
|------|------|
| `kit/cli/lib.sh` | **新增** 共享工具库：颜色/日志、`is_excluded(path, family, direction)`、`walk_main_diff`、`walk_rules_diff`。`direction` 参数区分 install / sync 方向，其中 `kit/figma/references/*` 仅在 sync 方向排除 |
| `kit/cli/install.sh` | `source lib.sh`；删除内嵌颜色/日志定义；L268-296 原始 diff 展示块替换为 `walk_main_diff + walk_rules_diff` 组合，输出真实变更 |
| `kit/cli/sync.sh` | `source lib.sh`；删除内嵌颜色/日志、`is_excluded`、两处 diff 循环、verify 块；全部切到 lib.sh 函数 |

### 修复效果

| 场景 | v1.11.0 行为 | v1.12.0 行为 |
|------|-------------|-------------|
| install 二次运行（幂等） | 显示 12 条假变更 | "无变更，目标已是最新" ✓ |
| 源改一条 rule 内容 | **静默**（显示不出来） | `~ rules/clean-code.md` ✓ |
| 目标本地改 figma references | 显示 `~`（正确） | 显示 `~`（保持正确） |
| sync 方向 figma references | 排除（正确） | 排除（保持正确） |

### 设计约束

- lib.sh 被 source 调用，禁止设 `set -e` / `set -u`
- 兼容 bash 3.2（macOS 默认），不用 `local -n` / `declare -n`
- 多值返回走 `_SOSOKIT_*` 前缀全局数组，调用前自动重置
- `direction` 枚举参数，非法值 fail-fast

### 本项目用户需要执行的升级步骤

```bash
cd <your-project>
sosokit-install
```

升级后再次 `sosokit-install --dry-run` 应显示"无变更，目标已是最新"——这是 v1.12.0 幂等性可验证的标志。

### 非目标（留给 Stage 2 / Stage 3）

- 结构操作沉淀：`apply_family_rules` / `filter_projects` / `hide_from_git` / `write_state` 仍留在 install.sh，下个版本再搬入 lib.sh
- `add.sh` / `clean.sh` / `switch.sh` 的路径过滤复用，视后续需要再接入
- sync.sh 的 `kit/figma/references/*` 硬编码排除清理（v1.10+ 后 figma 数据迁入 `kit/projects/<family>/`，可能是死代码，需确认后再删）

---

## v1.11.0 - 2026-04-19

### ✅ sodex-next UI rules 瘦身 + `/k:ui` 接入 kit/projects/ —— 职责分层落地

**背景**:v1.10.0 建成 `kit/projects/<name>/` 按需加载机制并让 `/k:figma` 接入,但 sodex-next 家族 5 个 UI rules(`ui-style` / `modal-component-style` / `use-shared-ui` / `responsive-workflow` / `domain-stories-layout`)仍是 always-on 注入,与 `kit/projects/sodex-next/` 的详情 90%+ 重复。`/k:ui` 也未接入新协议,项目切换仍硬编码。

**设计目标**:

- 确立"红线 always-on + 详情按需加载"职责分层:rules 只写 boolean 级红线(做/不做),详情(完整 token / 映射表 / 示例)归 `kit/projects/<name>/`
- `/k:ui` 对齐 `/k:figma` v1.10.0 加载协议(Step 0.0 识别 + L0 读 PROJECT.md + L1 按需 + 末尾 style-checklist 自检)
- 非 `/k:ui` / `/k:figma` 场景(如 `/k:task` 改 UI)也能被红线挡住硬编码;红线末尾"详情查阅"段指引 Claude 去 `kit/projects/` 读完整清单

### 变更

| 文件 | 变更 |
|------|------|
| `commands/k/ui.md` | **新增 Step 0.0**:项目识别 + Read `PROJECT.md`(自动 `@` 引用 `constraints.md`);"共享规范"表改为三级优先级(`kit/projects/<cur>/` 最高 / `rules/figma-style-mapping.md` 兜底 / `kit/figma/references/*` 旧路径兼容);**新增 Step 6**:生成后 Read `style-checklist.md` 逐项自检并追加"产出说明" |
| `rules/modules/sodex-next/ui-style.md` | 172 → ~55 行,保留核心原则 / 颜色 token 红线(含豁免) / 样式检查清单 / Tailwind v4 尺寸 & 圆角规则;删除完整 token 表、Figma 映射规律、查找流程、示例(归 `tokens.md` + `figma-mapping.md`);末尾加"详情查阅"段 |
| `rules/modules/sodex-next/modal-component-style.md` | 174 → ~50 行,保留判断条件 / 壳层 6 项禁止 / 核心规则 4 条 / 标准模式 / 实操要点;删除 4 组示例代码(归 `patterns.md §modal`);末尾加"详情查阅"段 |
| `rules/modules/sodex-next/use-shared-ui.md` | 57 → ~25 行,保留规则句 / JSX 扫描禁用清单 / 例外;删除 24 行组件清单表 + 执行流程(归 `components.md`);末尾加"详情查阅"段 |
| `rules/modules/sodex-next/responsive-workflow.md` | **删除**(内容 100% 在 `patterns.md §responsive`) |
| `rules/modules/sodex-next/domain-stories-layout.md` | **删除**(内容 100% 在 `patterns.md §directory`) |
| `rules/modules/sodex-next/figma-style-mapping.md` | 原样保留(作 `/k:figma` Step 4 第 2 优先级兜底) |
| `kit/context/library/sodex-next/history/refactor/v1.11.0-rules-slim.md` | 新增分类表,记录每条条款的"红线/详情/删"归类决策,便于未来回溯与 sodex-web 家族类似瘦身参考 |
| `commands/k/CHANGELOG.md` | 新增 v1.11.0 `/k:ui` 改造条目 |

### 职责分层说明

```
rules (always-on 注入)           = boolean 级红线 + 详情查阅指引
   │                               任何场景触发(包括 /k:task 改 UI)
   └─ "详情查阅"段 → kit/projects/  Claude 可主动 Read 完整清单

kit/projects/<name>/ (按需加载)  = 项目详情:token / 映射 / 组件 / 模式 / 自检
   │                               /k:ui /k:figma 通过 Step 0.0 主动加载 L0
   └─ L1 按场景读(tokens/components/patterns/style-checklist)

非 UI rules(如 react / clean-code / constitution / event-driven / git-commit / regular / malicious / figma-style-mapping)
   零改动,always-on 保持原状
```

### 本项目用户需要执行的升级步骤

**⚠️ 必须**:升级后各项目需跑 `sosokit-install` 以同步本地 rules(`apply_family_rules` 会清空 `.claude/rules/` 后装入瘦身版,并清除已删的 `responsive-workflow` / `domain-stories-layout`):

```bash
cd <your-sodex-next-feature>
sosokit-install
```

不执行会导致本地保留旧版大 rules,无法享受 token 节省。

### Token 节省

- sodex-next 家族 UI rules 总行数:**434 → ~130 行**,削 ~70%
- 对 always-on 注入基线 context 的直接压缩,每轮对话都受益

### 非目标(保留给未来)

- sodex-web 家族 rules 瘦身:sodex-web 家族无对应 5 个 UI rules(仅有 `figma-style-mapping` + 非 UI 类),本期不处理
- `/k:ui` 内部的 preflight.sh / compare-styles.sh 脚本路径迁移:本期沿用,v1.12+ 视情况整合到 `kit/projects/`

---

## v1.10.0 - 2026-04-19

### ✅ kit/projects/ 项目级规范承载 —— /k:figma 按项目切换,rules 不变纯新增

**背景**:v1.9.0 统一了项目注册(`projects.conf`),但 `/k:ui` 和 `/k:figma` 仍然把 sodex-web 标准硬编码在命令文件里。新增项目(如 sodex-next)时:

- 命令无法按项目切换规范
- rules/ 已 always-on 加载大表(figma 变量/token 清单/组件清单),承载更多项目差异会继续膨胀 context
- `/k:ui` 和 `/k:figma` 其实共享同一套项目底层真相(tokens / 组件 / 响应式策略),当前各命令各自硬编码,重复维护

**设计目标**:

- 建立 `kit/projects/<name>/` 作为项目级"查阅型数据"的统一承载(命令按需 Read,非 always-on)
- 7 文件模版 + `sosokit-add` 从 `_template/` 复制,新增项目一键生成
- 不动 rules(用户后续 v1.11.0 自行瘦身)、不改 `/k:ui`(留 v1.11.0)
- 命令加载渐进式:L0 入口(PROJECT.md + constraints.md) + L1 子文件按需

**核心机制**:

| 能力 | 实现 |
|------|------|
| 项目规范承载 | `kit/projects/<name>/` 7 文件(PROJECT / constraints / tokens / figma-mapping / components / patterns / style-checklist) |
| 模版化 | `kit/projects/_template/` 含占位符 `{{project}}` / `{{token-system}}` |
| 自动生成 | `sosokit-add <name>` 从 `_template/` 复制到 `kit/projects/<name>/`(幂等) |
| install 过滤 | 仅保留当前项目的 `kit/projects/<family>/`,移除 `_template` 和其他项目 |
| sync 过滤 | 通配排除 `kit/projects/*/` 非当前项目 + `_template`(沿用 figma references 模式) |
| 命令加载 | `/k:figma` 新增 Step 0.0(识别项目 + Read PROJECT.md) + Step 9(读 style-checklist.md 自检);Step 4 把 kit/projects/ 设为最高优先级 |

**文件变更**:

| 文件 | 变更 |
|------|------|
| `kit/projects/_template/` | **新增** 7 文件骨架(含占位符) |
| `kit/projects/sodex-web/` | **新增** 7 文件(基于 figma-style-mapping / regular / precision / wallet-signing / event-driven 抽取) |
| `kit/projects/sodex-next/` | **新增** 7 文件(基于 ui-style / use-shared-ui / modal-component-style / responsive-workflow / domain-stories-layout 抽取) |
| `kit/cli/add.sh` | 新增 `copy_template` 段:从 `_template/` 复制到 `kit/projects/<name>/`,幂等 + dry-run 预览 |
| `kit/cli/install.sh` | 新增 kit/projects 过滤段:仅保留当前家族,移除 `_template` 和其他项目 |
| `kit/cli/sync.sh` | `is_excluded` 扩展:通配排除 `kit/projects/*/` 非当前项目 + `_template`;执行段增加 restore-from-target 逻辑(保护源仓基线) |
| `commands/k/figma.md` | 新增 Step 0.0 + Step 9;Step 4 载入优先级调整(kit/projects/ 最高) |

**渐进加载协议**:

- **L0 必读**:命令启动时 Read `kit/projects/<cur>/PROJECT.md`;PROJECT.md 用 `@constraints.md` 自动引用约束
- **L1 按需**:根据任务类型 Read 对应子文件(从 Figma → figma-mapping.md + tokens.md;写组件 → components.md + patterns.md)
- **L1 自检**:生成代码后 Read `style-checklist.md`,按"过程指针"对照 constraints / tokens,避免与其他文件内容冗余

**SSOT 取舍**:

- `rules/modules/<name>/` **不动**:保留 always-on 注入通道(行为指令)
- `kit/projects/<name>/` **新增**:承接"查阅型数据"(命令按需读)
- 两轨分发目的地不同,**两轨并存零冲突**。rules 内容和 projects 内容可能部分重叠,但 rules 是 always-on、projects 是命令触发,Claude 运行时不会双读

**超出 spec 的范围调整(install.sh)**:

原 spec 仅指定 `sync.sh` 改动。实施时发现 `install.sh` 也必须过滤 `kit/projects/`(否则 install 会把所有项目和 `_template/` 带到目标),否则 sodex-next-feature 本地会出现 sodex-web 的 kit/projects 内容。已同步修复,属必要修复而非 scope creep。

**测试记录**:

| 测试点 | 结果 |
|-------|------|
| `sosokit-add test-xyz --dry-run` | ✅ 预览 7 文件 + 3 骨架完整 |
| `sosokit-add test-xyz` 实建 | ✅ `kit/projects/test-xyz/` 与 `_template/` 同构 |
| 幂等重复执行 | ✅ 跳过已存在,不报错 |
| install 到 sodex-next-feature | ✅ `.claude/kit/projects/` 只含 `sodex-next/`,无 `_template`,无 `sodex-web` |
| sync --dry-run 从 sodex-next-feature | ✅ 无变更(通配排除正确) |
| `/k:figma` 路径引用 | ✅ Step 0.0 / Step 4 / Step 9 正确指向 `kit/projects/<CURRENT_PROJECT>/` |

**v1.10.0 对多项目开发的提升**:

| 维度 | v1.9.0 | v1.10.0 |
|------|--------|---------|
| 项目规范承载 | rules 硬编码(always-on) | **kit/projects/ 按需**(L0 + L1) |
| 新增项目规范成本 | 手动在 rules/ 写 + 命令里引用 | **`sosokit-add` 一键复制 7 文件** |
| 命令与项目解耦 | 命令硬编码 sodex-web | **命令 identify_project → kit/projects/<cur>/** |
| sync/install 项目隔离 | figma references 硬编码排除 | **通配规则,新增项目零手改** |

**v1.11.0 预告**(用户后续自行推进):

- rules 瘦身(移出大数据表,留"规则陈述 + kit/projects/ 指针")
- `/k:ui` 改造接入 kit/projects/(与 /k:figma 共享 tokens / components / patterns)

**v1.12.0+ 待办**:

- `sosokit-sync-template`:模版升级回溯(diff `_template/` 和已存在项目文件,提示合并新段落)

---

## v1.9.0 - 2026-04-19

### ✅ projects.conf 统一项目隔离 —— 合并 families.conf 与 PROJECT_MAPPINGS，新增 sosokit-add

**背景**：v1.8.0 引入家族隔离后，出现了两套并存的项目注册机制：
- `cli/families.conf`（key=value，rules 分发用）
- `context-lib.sh::PROJECT_MAPPINGS`（regex 数组，context 存储用）

两套识别函数（`detect_family` / `resolve_project_name`）重复逻辑，新增项目要改两处，未来做 `/k:figma` / `/k:ui` 的项目差异化还要再开第三套——设计越走越散。

**设计目标**：
- 单一权威配置（SSOT）：`.claude/kit/projects.conf`
- 单一识别函数：`identify_project`（worktree 主识别 + basename prefix fallback）
- 统一 CLI：`sosokit-add <name>` 全量脚手架 + `context-init` 局部自动注册
- 多写入点合法（SSOT 是单一配置，不是单一写入命令）

**核心机制**：

| 能力 | 实现 |
|------|------|
| 项目识别 | `git worktree list \| head -1` 主仓 basename 查表 + cwd basename prefix fallback |
| 注册表 | `kit/projects.conf`（每行一个项目名） |
| 全量脚手架 | `sosokit-add <name>`：projects.conf + rules/modules/ + context/library/ |
| 局部注册 | `context-init` 未注册 → 自动 register_project |
| 只读消费者 | install.sh / sync.sh / context-lib.sh / check.sh 全部 source identify.sh |

**文件变更**：

| 文件 | 变更 |
|------|------|
| `kit/projects.conf` | **新增** 单一权威注册表 |
| `kit/cli/identify.sh` | **新增** `identify_project` + `is_registered` + `register_project` + `list_projects` |
| `kit/cli/add.sh` | **新增** sosokit-add 实现（含 --dry-run + 幂等） |
| `kit/cli/install.sh` | source family.sh → identify.sh；detect_family → identify_project |
| `kit/cli/sync.sh` | 同上 + **新增** figma 项目特定 references 排除（不推回源仓） |
| `kit/context/context-lib.sh` | 删除 PROJECT_MAPPINGS + resolve_project_name；改 source identify.sh |
| `kit/context/action/init/init-project.sh` | 删除 regex 映射追加；改用 register_project 写 projects.conf |
| `kit/check/scripts/check.sh` | resolve_project_name → identify_project |
| `kit/cli/family.sh` | **删除** |
| `kit/cli/families.conf` | **删除** |

**识别逻辑（identify.sh::identify_project）**：

```
1. soso-kit 源仓 → 退出码 2
2. 主识别：git worktree list | head -1 | basename → 查 projects.conf
   覆盖所有 worktree（不管 worktree 叫 sodex-web-feature / sodex-web-bug / sodex-web-urgent）
3. Fallback：cwd basename 以某已注册项目开头 → 归属该项目
   覆盖独立 clone + 命名规范场景（sodex-web-backup → sodex-web）
4. 都未命中 → 退出码 1，提示用 --module <name> 显式指定
```

**相比 v1.8.0 的提升**：

| 维度 | v1.8.0 | v1.9.0 |
|------|--------|--------|
| 配置数量 | 2（families.conf + PROJECT_MAPPINGS） | 1（projects.conf） |
| 识别函数 | 2（detect_family / resolve_project_name） | 1（identify_project） |
| 新增项目成本 | 改 2 文件 + 建 5+ 目录 | `sosokit-add <name>` 一条命令 |
| 独立 clone 命名支持 | 需对应 regex | 自动 prefix 匹配 |
| 未来扩展成本 | 每个子系统开新注册表 | 共用 projects.conf |

**figma references sync 排除（配套保护）**：

`sync.sh::is_excluded` 新增：
- `kit/figma/references/components.md`
- `kit/figma/references/patterns.md`
- `kit/figma/references/specification-project.md`

这些是项目特定内容（组件库 Catalog、页面模板、tailwind token），每个项目本地自维护，不推回源仓污染基线。本地修改和本地 sync 互不干扰。

**向后兼容**：不保留。直接删除 family.sh 和 families.conf，全仓一次性迁移（grep 无残留验证）。

**部署**：`sosokit-add` 还需手动创建 `/usr/local/bin/sosokit-add` 符号链接（权限原因脚本无法自动做）：

```bash
sudo ln -sf /Users/soso/Documents/code/soso-kit/.claude/kit/cli/add.sh /usr/local/bin/sosokit-add
```

**验证结果**：

| 测试 | 结果 |
|------|------|
| 所有脚本语法 | ✅ |
| identify_project（sodex-web-feature → sodex-web） | ✅ |
| identify_project（sodex-web-bugfix → sodex-web） | ✅ |
| identify_project（sodex-next-feature → sodex-next） | ✅ |
| soso-kit 本仓拦截（exit 2） | ✅ |
| Fallback prefix（sodex-web-hotfix → sodex-web） | ✅ |
| sosokit-add --dry-run 新项目 | ✅ |
| sosokit-add 已注册项目（幂等） | ✅ |
| install 从 worktree 识别 | ✅ |
| sync 从 worktree dry-run | ✅ |
| 全仓无 family.sh / families.conf / PROJECT_MAPPINGS / resolve_project_name 残留 | ✅ |

---

## v1.8.0 - 2026-04-19

### ✅ Rules 按项目家族模块化分发 —— sodex-web / sodex-next 物理隔离

**背景**：旧版所有项目共用同一套 `.claude/rules/*.md`。sodex-web 和 sodex-next 两大家族的 UI 栈差异巨大（theme token 体系、modalManager API），共用 rules 时 Claude 会误套规则；且随着 rules 越来越多，每条生效率下降（注意力稀释 + 冲突干扰）。

**设计目标**：
- rules 按项目家族隔离（`modules/sodex-web/` / `modules/sodex-next/`），**物理不重叠**
- skills / kit / settings 继续统一分发（本次不拆）
- 家族识别零命名约束：基于 git worktree 事实推断，不依赖目录命名纪律
- 扩展新家族零脚本改动：纯配置驱动

**核心机制**：

| 能力 | 实现 |
|------|------|
| 家族识别 | `git worktree list \| head -1` 取主仓路径 → `basename` 查 `families.conf` |
| 家族配置 | `cli/families.conf`（`<basename>=<module-dir>` 格式），新增家族加一行 |
| rules 分发 | `install` 仅装 `modules/<family>/*.md` 到目标；`sync` 仅推回 `modules/<family>/` |
| 跨家族隔离 | sync 执行时 cp target/modules 到 temp 保留其他家族，只覆盖当前家族子树 |
| 统一资源 | skills / kit / settings 推回 soso-kit 根，所有家族共享 |
| 手动覆盖 | `--module <name>` flag 跳过自动识别 |
| 本仓拦截 | soso-kit 源仓 install/sync → 退出码 2 + 报错 |
| 识别失败 | 退出码 1 + 列已注册家族 + 提示 `--module` |

**目录结构变更**：

```
soso-kit/.claude/rules/
├── .gitkeep                    # 根目录清空（源头唯一性）
└── modules/
    ├── sodex-web/              # 10 份 rules，从原根目录迁入
    └── sodex-next/             # 10 份 rules，从 sodex-web 复制（独立演化起点）
```

**改动文件**：

| 文件 | 变更内容 |
|------|----------|
| `.claude/kit/cli/families.conf` | **新增**：家族配置（sodex-web / sodex-next） |
| `.claude/kit/cli/family.sh` | **新增**：`detect_family()` + `_lookup_family()` + `list_registered_families()` |
| `.claude/kit/cli/install.sh` | source family.sh；加 `--module` flag；新增 `apply_family_rules()`；state 写入 `family` 字段；help 更新 |
| `.claude/kit/cli/sync.sh` | **重写**：分离主 diff（非 rules）和 rules diff（vs `modules/<family>/`）；原子 swap 保留其他家族 module；打印 Family/Source/Target 三行 |
| `.claude/rules/modules/sodex-web/*.md` | **新增**：10 份 rules 从根目录迁入 |
| `.claude/rules/modules/sodex-next/*.md` | **新增**：从 sodex-web 完整复制 |
| `.claude/rules/*.md` | **删除**：根目录 10 份 rules |
| `.claude/rules/.gitkeep` | **新增**：占位 |

**新增家族的扩展成本**：

```bash
# 1. 追加一行配置
echo "sodex-wallet=sodex-wallet" >> soso-kit/.claude/kit/cli/families.conf
# 2. 建对应 module 目录并放入专属 rules
mkdir -p soso-kit/.claude/rules/modules/sodex-wallet
# 3. 在 sodex-wallet worktree 跑 sosokit-install → 自动识别
```

脚本**零改动**。

**bash 3.2 兼容性**：
- 不使用 `declare -A` 关联数组（macOS 原生 bash 3.2 不支持）
- 用 `grep` + `sed` 从 families.conf 查表

**验证**（全链路回归测试通过）：
- T1: `--module sodex-web` 装到 /tmp/target → 10 份 rules，无 modules/ 子目录，state `family=sodex-web` ✓
- T2: `--module sodex-next` 装到另一目录 → state `family=sodex-next` ✓
- T3: install 到 soso-kit 本仓 → 退出码 2 + "不可对自身 install/sync" ✓
- T4: install 到未注册目录（无 --module） → 退出码 1 + 列已注册家族 ✓
- T5: sync --dry-run → 打印 Family/Source/Target 三行 + 变更清单标注 `→ modules/sodex-web/` ✓
- T6: 实际 sync 推 sodex-web → sodex-web module 更新，**sodex-next module 完全不动** ✓ 关键隔离验证
- T7: 验证 target/.claude/rules/ 只含 *.md，无 modules/ 子目录 ✓

**行为矩阵**：

| 在哪个项目改 | 改了什么 | sync 后 soso-kit 的变化 |
|------------|---------|----------------------|
| sodex-web 家族任一 worktree | `rules/*.md` | 仅 `modules/sodex-web/` 更新 |
| sodex-next 家族任一 worktree | `rules/*.md` | 仅 `modules/sodex-next/` 更新 |
| 任一项目 | `skills/*` / `kit/*` / `settings.*` | 推到 soso-kit 根，所有家族共享 |

**支撑后续决策**：
- sodex-next 可独立精简 rules 而不影响 sodex-web
- 按家族实验"只留 1-3 条高价值 rules"策略，互不干扰
- 未来 skills 若需按家族拆分，`detect_family` 已是通用函数可直接复用

---

## v1.7.0 - 2026-04-17

### ✅ sosokit-install / sosokit-clean — 对 git 完全透明的双向切换

**背景**：旧版 `sosokit-install` 只对已追踪文件设置 `skip-worktree`，但 soso-kit 新增的文件（rules/skills/commands）在目标项目的 git 里从未被追踪，会以 `??` 未追踪状态出现在 `git status`。在移除了 `.claude` ignore 规则的新项目（如 sodex-next）尤其明显。

**设计目标**：
- `sosokit-install` → 安装 soso-kit 配置后，`.claude` / `.cursor` 对 git 完全透明（status 干净）
- `sosokit-clean` → 撤销安装，恢复项目自己的 `.claude` / `.cursor`（从 git HEAD）
- 切换可重复、可中断、可恢复

**核心机制**（git 标准工具组合）：

| 问题 | 解决机制 |
|------|----------|
| 已追踪文件的内容变更 | `git update-index --skip-worktree` |
| 未追踪新文件 | `.git/info/exclude` 写入 `/.claude/` 或 `/.cursor/` |
| 幂等性 | `# sosokit-begin/end` 标记块 + awk 精确匹配先删后写 |
| 模式一致性 | install 写 `.git/sosokit-state`，clean 优先从此读取 |
| 中断恢复 | skip-worktree 在 `rm -rf` 之前设置，中断时 git status 保持干净 |

**改动文件**：

| 文件 | 变更内容 |
|------|----------|
| `.claude/kit/cli/install.sh` | 新增 `hide_from_git()` + `write_exclude_block()` + `write_state()`；操作顺序改为「先 skip-worktree + exclude，再 rm-rf + cp」 |
| `.claude/kit/cli/clean.sh` | 完整重写：去掉 hardcode `.cursor`，改为 `resolve_config_mode()` 从状态文件/`get_sosokit_mode` 动态读取；新增 `git restore --staged` 处理历史脏状态；新增 HEAD 预检查；去掉 `set -e` 改分步容错；失败时打印手动恢复命令；trap INT/TERM |
| `.cursor/kit/install.sh` / `clean.sh` | 完全同步 |

**失败兜底**：

| 失败场景 | 处理 |
|----------|------|
| `rm -rf` 到 `cp` 之间中断 | skip-worktree 已设置，git status 保持干净，重跑 install 即恢复 |
| HEAD 无配置目录（clean 无法恢复）| 预检查拦截，保留目录不删除 |
| `git restore` 失败 | 打印 3 个恢复命令（重装 / checkout HEAD / 从历史 commit 恢复） |
| Ctrl-C 中断 | trap 打印状态检查和恢复指引 |
| 多次运行 | 幂等（skip-worktree 重复设置无害，exclude 标记块先删后写） |

**Bug 修复**：
- 修复 bash 变量紧跟中文全角括号（`$CONFIG_DIR_NAME（`）时变量名解析被多字节字符干扰导致输出乱码。统一改用 `${CONFIG_DIR_NAME}` 显式界定。

**验证**（sodex-next 上完整测试通过）：
- T1: 初始 clean 状态 → install → git status 干净（0 行），exclude 块写入，state 文件写入
- T2: install 后 → clean → 项目 rules 完全恢复（10 个项目自有文件），exclude 块和 state 文件清理
- T3: 连续 install 两次 → exclude 不重复追加（`grep -c sosokit-begin` = 1）
- T4: 连续 clean 两次 → git status 保持干净
- T5: clean 输出不再有变量展开乱码

---

## v1.6.1 - 2026-04-17

### ✅ sosokit-sync — 同步后写入验证

**背景**：Claude 的 Edit/Write 工具在权限不足时会静默失败（返回成功但文件未写入），导致 sosokit-sync 报告成功但 soso-kit 实际未更新。

**改动**：

| 文件 | 变更内容 |
|------|----------|
| `kit/cli/sync.sh` | 同步完成后新增验证步骤：diff 来源与目标，检测未写入/内容不一致/多余文件 |

**验证逻辑**：
- 复制+清理完成后，重新 diff `SOURCE_CONFIG` vs `TARGET_CONFIG`
- 发现差异 → 列出具体文件 + `error()` 退出，提示检查 soso-kit 目录权限
- 无差异 → `success "验证通过：所有文件已正确写入 soso-kit"`

**测试**（T1–T4 均通过）：
- T1: 语法检查（`bash -n`）
- T2: 相同目录 → 无验证失败
- T3: 内容不一致 → 检测到差异
- T4: 目标多余文件 → 检测到

---

## v1.6.0 - 2026-04-12

### ✅ 新增 sosokit-conversation — Claude Code 会话管理

**背景**：Claude Code 无法删除/管理会话，空会话和 subagent 不断堆积。

**功能**：

| 快捷键 | 功能 |
|--------|------|
| `↑/↓` | 选择会话 |
| `Enter` | 查看会话内容 |
| `Ctrl+D` | 删除选中会话 |
| `Ctrl+R` | 重命名选中会话 |
| `Ctrl+A` | 一键清理无价值会话（空/caveat/subagent） |
| `Esc` | 退出 |

**用法**：`sosokit-conversation`（当前项目）/ `sosokit-conversation --all`（所有项目）

**依赖**：fzf（`brew install fzf`）

### ✅ CLI 脚本目录重构 — .sh 文件迁移至 kit/cli/

**背景**：kit/ 根目录混合了脚本和功能模块，结构不清晰。

**改动**：

| 变更 | 说明 |
|------|------|
| `kit/cli/` | 新建目录，集中存放所有 sosokit-* CLI 脚本 |
| `kit/*.sh` → `kit/cli/*.sh` | 迁移 config/clean/install/sync/switch/conversation |
| `kit/CHANGELOG.md` → `kit/cli/CHANGELOG.md` | 迁移变更日志 |
| `/usr/local/bin/sosokit-*` | symlink 更新至 cli/ 路径 |
| `settings.json` / `settings.local.json` | 路径引用更新 |
| `debug/check/mastery` 脚本 | config.sh 路径更新为 `kit/cli/config.sh` |
| `SKILL.md` / `init-worktree.sh` / `docs/` | 文档路径同步更新 |

## v1.5.0 - 2026-04-10

### ✅ Context 写入安全增强 — 内容哈希去重 + 原子写入 + 一致性校验

**背景**：索引文件独立写入，无备份、无回滚、无跨文件校验，写入中断会导致数据不一致。

**改动**：

| 文件 | 变更内容 |
|------|----------|
| `record-helpers.sh` | +4 函数：content hash、批量备份/回滚、一致性校验 |
| `update-router.sh` | 内容哈希去重（相同内容跳过写入） |
| `shared/update-indexes.sh` | 批量备份 + ERR trap 回滚 + 写入后一致性校验 |
| `validate-structure.sh` | 新增 `--integrity` 独立校验模式 |
| `/k/context-learn` | 新增 Step 7c 一致性校验 |
| `/k/context-record` | Step 8 追加一致性校验 |
| `/k/context-audit` | 新增 Step 0b 一致性校验（审计前健康检查） |

### ✅ 借鉴 Superpowers 自审机制 — spec/plan/check 三处质量门

**背景**：对比 Superpowers 后发现 spec 和 plan 阶段缺少自审，问题传递到 check 阶段才发现会导致返工。

**改动**：

| 文件 | 变更内容 |
|------|----------|
| `/k/spec` | Step 8 新增 Spec 自审：内部一致性检查 + 范围分解建议 |
| `/k/plan` | Step 5 新增 Spec 覆盖度自检：逐条对照验收标准，未覆盖的当场补充 |
| `checklist.md` | CHK-01~04b 新增 HARD-GATE：需求检查不通过则停止 |

### ✅ 新增 /k/review — 代码质量诊断命令

**背景**：/k/check 是全面检查（18 项），缺少轻量级的单文件代码质量诊断。

**改动**：

| 文件 | 变更内容 |
|------|----------|
| `/k/review` | 新增命令：规范审查（默认）+ 多视角审查（--deep：边界猎手 + 意图审计） |

---

## v1.4.0 - 2026-04-01

### ✅ sosokit-deploy — 部署后自动验证环境一致性

**背景**：部署完成后无法确认环境实际运行的镜像是否与预期一致（镜像可能尚未构建完成导致部署了旧版本）。

**改动**：

| 文件 | 变更内容 |
|------|----------|
| `run.sh` | 新增 `verify_deploy`：部署成功后重新查询 Rancher，对比实际 SHA 与期望 SHA |

**验证逻辑**：
- ✅ 一致：显示已部署的分支 + SHA + commit message
- ⚠️ 不符：对比期望值与实际值，提示检查 GitHub Actions 构建状态

---

## v1.3.0 - 2026-04-01

### ✅ sosokit-deploy — 菜单显示各环境当前分支 + commit 信息

**背景**：部署前无法得知各 preview 环境当前跑的是哪个分支，容易误覆盖他人的测试环境。

**改动**：

| 文件 | 变更内容 |
|------|----------|
| `run.sh` | 新增 `get_deployed_branch`：从 Rancher 读镜像 SHA，在本地 sodex-web 仓库倒查分支 + commit message |
| `run.sh` | 菜单并行查询 10 个环境，展示 `分支名 / SHA / commit message` 三列 |
| `run.sh` | `wait \|\| true` 修复：防止子 shell 非零退出触发 `set -e` 终止脚本 |
| `const.sh` | 新增 `SODEX_WEB_REPO` 配置项（本地 sodex-web 路径） |

**技术方案选型过程**：
- `git branch -r --contains`：squash merge 后 commit 不在任何分支，失败
- GitHub API：组织禁止 Classic token，fine-grained 需管理员审批，失败
- K8s annotation：只覆盖本脚本部署，CI 部署无法追踪，放弃
- **最终方案**：固定 `git -C $SODEX_WEB_REPO` 路径 + `git branch -r --contains`，解决 CWD 不一致问题，对 squash merge 降级显示短 SHA

**效果**：
```
  * 7) preview-07    hotfix/login-status-sod-88             1924e03  fix: login status
  * 8) preview-08    hotfix/appkit-sod-80                   45bc2ee  fix: appkit crash
```

---

## v1.2.0 - 2026-04-01

### ✅ sosokit-deploy — 扩展 preview 环境至 01-10

**背景**：preview 环境从 4 个扩展至 10 个，新增 05-10 供团队成员分配使用。

**改动**：

| 文件 | 变更内容 |
|------|----------|
| `.claude/kit/deploy/scripts/deploy.sh` | 支持 preview-01 ~ preview-10 |
| `.cursor/kit/deploy/scripts/deploy.sh` | 同步 |

**菜单标记规则**：

| 标记 | 环境 | 含义 |
|------|------|------|
| 无标记 | 01-06 | 正常可用 |
| `*` | 07-09 | 特殊标注（@Tab 负责） |
| `-` | 10 | 特殊标注 |

---

## v1.1.0 - 2026-03-27

### 🔍 对标 spec-kit：spec 工作流增强

基于 spec-kit（SDD 开源工具）完整流程分析，对 soso-kit 的 spec 工作流进行对标优化。
分析了 quickstart.md、contracts.md、Constitution 完整机制后，仅采纳与当前项目规模匹配的部分。

---

#### ✅ clarify.md — 新增验收场景章节（Given/When/Then）

**背景**：clarify 生成的 spec 文档原有「验收标准」为 checklist 格式，表述较为模糊，无法直接转化为可测试的边界定义。

**改动**：

- **Step 5 章节列表**：必要章节从 6 个增至 7 个，新增「验收场景」
- **验收场景格式模板**：Given/When/Then 三段式，内嵌 Given 质量标准说明
  - Given 必须包含具体数值/状态（禁止模糊描述如「用户已登录」）
  - When 为单一操作
  - Then 必须可独立验证，含 UI / 数据 / 状态三类中至少一类
  - 每个用户故事至少 2 个场景（Happy Path + 边界/异常）
- **Step 6 文档自检**：检查项从 5 项增至 6 项，新增「场景具体」

**收益**：spec 文档在 clarify 阶段就锁定边界，plan 拆任务时直接引用，减少实现阶段的反复澄清。

---

#### ✅ plan.md — 任务并行标记 [P]

**背景**：plan 阶段拆分的任务列表全部串行，多人协作时无法识别可并行执行的步骤，单人开发时也无法直观看到依赖关系。

**改动**：

- **Step 3 步骤规划格式**：可并行步骤标注 `[P]`，括号内注明「可与 Step X 并行」
- **[P] 标注规则**：步骤间无依赖关系 + 修改文件不重叠 → 标注 `[P]`；有依赖 → 不标注，串行
- **todolist 格式**：`[P] Step N: [名称] - [文件路径]` 格式示例同步更新

**收益**：依赖关系一目了然；多人协作可同时推进并行步骤；单人时按顺序执行即可。

---

#### ✅ task.md — 执行时识别并展示 [P]

**背景**：plan 新增 [P] 标注后，task 执行阶段需要对应识别并给出提示。

**改动**：

- **Step 3**：遇到 `[P]` 步骤时，执行前输出并行提示（含多人/单人说明）
- **Step 4 进度追踪格式**：进度列表中保留 `[P]` 标记，注释「← 并行步骤」

---

#### ✅ constitution.md — 新增架构约束文档（无流程集成）

**背景**：项目缺少架构层面的约束文档（区别于 `regular.mdc` 管理的代码层规范），无处记录「不可违反的技术选型原则」。

**改动**：

- 新增 `.cursor/rules/constitution.md`，提供架构约束的标准记录格式
- 当前仅作文档记录，**未接入任何执行流程**（流程集成待后续）

---

#### ❌ 分析后未采纳的项

| 功能 | 未采纳原因 |
|------|-----------|
| plan 生成 quickstart.md | G/W/T 已覆盖验收场景，quickstart 与之重复，增加维护负担 |
| plan 生成 contracts.md | 项目为前端项目，不需要自定义 API 规格；后端 API 由服务端定义 |
| Constitution 流程集成（plan 门控） | 当前项目规模小，引入完整检查机制属过度设计 |

---

### 文件变更汇总

| 文件 | 类型 | 说明 |
|------|------|------|
| `.cursor/commands/k/clarify.md` | 修改 | 新增验收场景章节 + 自检项 |
| `.cursor/commands/k/plan.md` | 修改 | 任务拆分支持 [P] 并行标注 |
| `.cursor/commands/k/task.md` | 修改 | 执行阶段识别并展示 [P] |
| `.cursor/rules/constitution.md` | 新增 | 架构约束文档模板 |
