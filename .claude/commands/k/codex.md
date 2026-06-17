---
description: 拉取并核验当前 PR 的 Codex 审核结果，对 Critical/High 跑四步漏斗给出修复/不修复终局结论
---

# /k:codex: PR 审核结果核验

## 用户输入

```text
$ARGUMENTS
```

---

## 核心目的

一次性拉取当前分支对应 PR 的 Codex 审核结果（总结评论 + 全部行内评论），确认 codex_review 已就绪后，对每条 **Critical / High** finding 跑四步漏斗核验，落到明确终局：**不需修复（给依据）** 或 **需修复（给方案→等确认→执行）**。

仅终端展示，不回贴 GitHub PR。**只核验 Critical + High，Med/Low 既不深挖也不输出**——聚焦真正高危项，不制造噪声（Critical 是最高级，绝不可漏）。只核 Codex 审核，不碰其它 CI（取数脚本已只喂 codex_review）。

输出样式：**L（段落锚点）+ 顶底开口框（每条 finding，无左竖线、换行不破相）+ Q（反问门）**。

监听由 `/k:codex-on` / `/k:codex-off` 负责，本命令不碰 watch。

---

## 参数

| 参数 | 含义 | 默认 |
|------|------|------|
| `<PR号>` | 显式指定 PR | 自动探测当前分支 |
| `--list-only` | 只列 findings，不跑四步漏斗 | 关（默认核验） |
| `--fix` | 对确认为真的问题，确认后落地修复 | 关（默认只给方案等确认） |

---

## 执行步骤

### Step 1: 取数（脚本，确定性）

```bash
KIT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
bash "$KIT_ROOT/.claude/kit/codex/scripts/codex.sh" fetch $PR_ARG
```

脚本内部已 `unset GITHUB_TOKEN`（失效 token 会盖掉 keyring 有效 token 导致 401）、自动探测 PR/repo，输出三段：`## CHECKS` / `## CODEX_SUMMARY` / `## INLINE_COMMENTS`。**CHECKS 段脚本只输出 `codex_review: <bucket>` 一行**——其它 CI（check/pr_quality/build/test）根本不喂进来，从源头杜绝「顺手报 CI」。

`$PR_ARG`：用户显式传了 PR 号就带上，否则留空让脚本探测。

### Step 2: 确认审核就绪（命令逻辑）

读 `## CHECKS` 的 `codex_review: <bucket>` 一行：

| bucket | 处理 |
|------|------|
| `pass` | 审核就绪 → 进 Step 3 |
| `pending` | 提示「Codex 审核进行中，可用 /k:codex-on 监听完成」，停止 |
| `fail` | 提示「Codex 审核 job 本身失败」，停止 |
| `not_found` | 提示「未探到 codex_review check，确认该仓启用了 Codex」，停止 |

> ⛔ 禁止 `gh run view --log` 主动拉 CI 日志、禁止刨 CI 失败根因——越界。（其它 CI 成败脚本已不喂入，无需也无从分流。）

### Step 3: 整理 findings（命令逻辑）

#### 解析守卫（防假通过，先于提取）

Step 2 已确认 `codex_review=pass` → Codex **必然已发总结评论**。据此判别「真干净」与「没解析到」：

| 情况 | 含义 | 处理 |
|------|------|------|
| `## CODEX_SUMMARY` 段**非空** | 取数正常，可信任 Critical/High 计数 | 正常提取 Critical+High → 进 Step 3.5 |
| `## CODEX_SUMMARY` 段**为空** | codex_review 过了却没抓到总结 = **取数异常**（`codex-pr-review` 标记可能变更 / 评论未落地），**不是干净 PR** | ⛔ 停止，提示「codex_review 通过但未解析到审核总结，检查 codex.sh 的评论标记」，**禁止进 Step 3.5 短路报成功** |

> 这是「fetch 空」与「真 0 Critical/High」的硬区分——二者输出绝不能一样，否则解析失败会伪装成「审核通过」。

#### 提取

从 `## CODEX_SUMMARY` 的分级表与 `## INLINE_COMMENTS`（按 `[reviewer] file:line` 归类）中**提取 Critical + High 两级**（Critical 是最高级，绝不可漏），每条对应到 `file:line` 并标注其严重级。同一处多 reviewer 命中的合并标注。

**Med/Low 直接丢弃，不进入后续任何步骤、不输出。**

`--list-only`：只列 Critical/High 标题 + 位置，不进 Step 4。

### Step 3.5: 无 Critical/High 短路（早退）

> 前置：已过 Step 3 解析守卫（`## CODEX_SUMMARY` 非空）。本短路只在「**确实解析到审核总结、且其中 0 条 Critical 与 0 条 High**」时触发——「没解析到」属异常，已在 Step 3 拦截，不会到这里。

整理完若 **Critical + High 合计 = 0**，直接短路——**不进 Step 4 漏斗、不进 Step 6 主动门**，给成功提示后结束：

```
──── ✅ Codex 审核通过 ────

   PR #<N>
   Codex 总结                                 ✅ 已解析
   Critical/High                              ✅ 0 条

   就 Codex 审核而言无需改动。
```

> 这是最常见的「干净 PR」路径，必须最短：一眼成功，不展开漏斗、不追问、不提 CI。

### Step 4: 四步漏斗核验（主对话，逐条 Critical/High）

> 前置：仅当 Step 3.5 判定 Critical + High 合计 ≥ 1 才进入本步。Critical 优先排在 High 前核验。

结论纪律复用 `.claude/kit/cp/prompts/gate.md`（决策门）+ `ship.md`（每条结论指向源码行号，无行号标 `[推理]` 并说明缺什么证据）。

对每条 Critical/High finding 顺序跑四步，任一步否决即可提前定论：

```
0. 真伪闸  — 读 file:line 源码, 确认问题技术上成立吗?
            ❌误报 → 给出 Codex 漏看的上下文/约束, 出局, 不进 1-3
            ✅成立 / ⚠️存疑 → 进 1
1. 相关性  — git diff <base>...HEAD, 报错行是否在本 PR changeset?
            base 自动探测: git rev-parse --abbrev-ref origin/HEAD → main → master
2. 历史追溯 — git blame 根因行: 本次引入 / 路过旧坑 (附 commit + 日期)
3. 风险评估 — 可达性 + 影响面 + 严重度 → 风险等级(高/中/低) → 是否需修
```

> ⛔ **真伪闸硬约束（构建 / typecheck / lint 类 finding）**：凡 finding 断言「会编译失败 / tsc 报错 / lint 不过 / 构建挂」，**必须实跑真实工具复现**（`pnpm exec tsc --noEmit` / `pnpm lint` / build），**禁止只靠静态推理（如「import .json 应该报 TS2732」）下「成立」结论**。跑不出来 = 判误报出局。
> 教训：moduleResolution=bundler 隐含 resolveJsonModule，静态推断的 TS2732 实测根本不复现——纯推理误报会一路通到「需修复」。`[推理]` 仅可用于风险/影响判断，**不可用于「问题是否成立」**。

每条 Critical/High 强制**二选一终局**：

- **❌ 不需修复** — 明确写「此问题不需修复」+ 依据（指向行号）+ 原因（误报 / 真但风险可接受）
- **✅ 需修复** — 明确「此问题需修复」+ 为何（指向行号 / **构建类须附实跑复现输出**）+ 修复方案（改哪几行、怎么改）→ 进 Step 4.5 回归闸

### Step 4.5: 修复回归闸 + 落地后路由（gate.md 决策门）

用户确认方案后落地（`--fix` 同样**先停下等确认**）。落地全程强制：先按失败模式定路由，再跑回归三连，最后路由到下一步。

#### 1. 失败模式分流（决定 commit 路 / check 路）

按 fix **改了什么**判，不看行数/文件数：

| 失败模式 | fix 形态 | 判据：错了谁能抓 | 路由 |
|---------|---------|----------------|------|
| **编译期可判定** | 改 config / 类型标注 / import 路径 / 常量 / 文案 | tsc/lint 跑过 = 正确 | **commit 路** |
| **运行期语义** | 改函数体逻辑 / if-else-return 分支 / 错误处理早退 / 数据转换 / 异步顺序 | 工具过了仍可能错，要读逻辑 | **check 路** |

判据：fix diff 命中控制流/逻辑关键字（if/else/return/分支/await 顺序/try-catch）→ 运行期语义 → check 路；否则 → commit 路。

> **用户可否决**：输出「判定走 commit / check 路 + 一句依据」，附 `回复『改判 check』/『改判 commit』可覆盖`（同 spec「同意档位？」挑战通道）。

#### 2. 回归证据三连（缺一不可，**路由无关，永远自己跑**）

```
① 复现   — 改前实跑确认 finding 真的发生（贴工具输出）。复现不了 → 退回判误报
② 验净   — 改后全量跑「与 fix 类型相符的校验工具」(tsc / lint / test) 确认 0 新增报错。
            这是本 fix 的机械证明, 永远在此自己跑——不依赖、不外包给 /k:check 的 verify.sh
            (verify.sh 是项目级、内容不可假设, 可能根本不跑 tsc; 靠它兜底会漏验)。
            若 fix 类型无对应机械工具(如纯文案), 如实写明"无适用机械校验"。
③ 验生效 — 证明改动确实改变了行为：--showConfig diff / 行为探针 / 报错从有到无
           若 ③ 证明改动是 no-op（如显式写了 bundler 已隐含的值）→
           必须如实标注「冗余 / 防御性，非修复」，不得谎称「已修复 bug」
```

#### 3. 路由到下一步（终点都是 commit 建议，不自动提交）

机械证明已由 ②验净 在上面完成（两条路都跑过）。路由只决定**要不要额外做独立语义复审**：

- **commit 路**（编译期可判定）→ ②已是完整证明，无需独立语义复审 → 直接调 `/k:commit`（给建议）。
- **check 路**（运行期语义）→ tsc 过了仍可能逻辑错 → 额外调 `/k:check` 做**独立语义复审**（SUBAGENT + MAIN）→ PASS 后由 check 内部走到 `/k:commit` 建议。
  > /k:check 会按其 verify.sh 再跑一次机械闸，可能与 ②验净 有重叠——这是项目级 verify.sh 决定的，不为省这一次而跳过 ②（跳了就赌 verify.sh 含 tsc，赌输=漏验）。

> ③ 的 no-op 自查防「给误报开 no-op 方案还宣称修好」——上一轮 resolveJsonModule 正是栽在这里。

### Step 5: 输出（L + 顶底开口框，不含 Med/Low）

段落锚点用 L；每条 Critical/High 用**顶底开口框**：`┌─ 编号 · 严重级 · 判定 · 标题 ─` 开顶、`└──` 收底，**内容行无任何左竖线**（换行不破相的关键），字段名 2 字。严重级在顶线显式标 `Critical`/`High`，Critical 排在前。**不含任何 CI 段。**

```
──── 🔬 Critical/High 核验 · N 条（✅需修 X / ❌不需修 Y / ⚠️确认 Z）────

┌─ 1/N · 🔴Critical · ✅ 需修复 · <精简标题> (<category>) ──────
   位置  file:line
   判定  <成立 + 一句>
   相关  <在/不在本 PR diff>
   历史  <本次引入 / 路过旧坑 + commit>
   风险  <等级 + 一句>
   方案  <改哪几行、怎么改>
└──────────────────────────────────────────

┌─ 2/N · High · ❌ 不需修复 · <精简标题> (<category>) ──────
   位置  file:line
   判定  <误报 / 真但无害>
   依据  <判据，指向行号；无行号标 [推理]>
└──────────────────────────────────────────
```

**换行硬纪律（保证长内容不破相）**：
- **内容行禁用任何左竖线 `│`/`├`**——这是树形/竖线框换行断列的病根；A 靠顶/底单行边界分隔，内容行裸缩进，溢出回行首也不断列。
- **字段压 1 行**；确需多行 → **手动在约 72 字处换行**，续行挂缩进对齐到内容起始列（不靠终端软换行）。
- **顶线 `┌─ … ─` 标题精简**、尾部 `─` 只补几个不顶满宽度 → 顶线本身永不换行。
- `└──` 底线固定短长度，不随内容变。

> Critical+High = 0 的情况已在 Step 3.5 短路，不会走到这里——本段只在 Critical/High ≥ 1 时输出。

### Step 6: 主动门（无条件触发，Q 样式）

无论结论如何，结尾必须主动给下一步并 ⏸ 等待——不允许"汇报完即停"。复用 `cp/prompts/gate.md` 决策门：

- **有 Critical/High 需修复** → 列出每条修复方案（Critical 排最前），⏸ 等用户确认；确认后才执行（`--fix` 同样要等确认）。
- **Critical/High 全部不需修复** → 明确收尾「本 PR 代码无需改动（就 Codex 审核而言）」；无待办则不强行 ⏸。（注：不评论 CI 状态。）

```
──── ❓ 下一步 ────

   <一句总结：需改动的 Critical/High 清单 / 或 就 Codex 审核而言本 PR 无需改动>

  【需确认】<若有需修 Critical/High，列方案编号（Critical 在前）>
     1. <方案 1>
     2. <方案 2>

⏸ 回复要执行的编号，或「跳过」结束
```

`--fix`：用户确认后对 ✅ 需修问题逐条落地——**必须走 Step 4.5 回归闸三连**（改前复现 / 改后验净 / 验生效，no-op 如实标注），说明改了什么；❌ 不需修的不动。
