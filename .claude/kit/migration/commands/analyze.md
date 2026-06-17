# Migration Analyze: 分析老功能

## 输入

功能 ID / 文件路径 / 功能描述（从路由传入）

## 流程

### 1. Context 加载（PROJECT_NAME=sodex-web）

```bash
KIT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
source "$KIT_ROOT/.claude/kit/context/context-lib.sh" && init_context_config
```

执行 `/k/context load <功能ID>`：
- 有结果 → 继续 Step 2
- 无结果 → **自动入库**：
  a. 输入是文件路径 → 从该文件追溯 import 链，定位功能范围
  b. 输入是功能描述 → grep 关键词定位入口文件，再追溯 import 链
  c. 定位完成 → 执行 `/k/context-learn` 写入 sodex-web（正式入库）
  d. 再次 context load

> 自动入库仅在 migration analyze 中存在，不改动 context load 本身。

### 2. 深入加载（如需）

`/k/context load <功能ID> --full`

判断条件：功能涉及 >3 个关键文件 或 >2 个 API → 加载 --full；否则 L2 quickRef 够用。

### 3. 关联分析

`/k/context files <关键文件>` — 查询跨功能影响范围

### 4. 坑点检查（PROJECT_NAME=sodex-next）

`/k/context-pitfall gates` — 匹配已知坑点（项目级业务坑）

### 4.5 跨迁移方法论坑索引（kit 级，全量注入）

```bash
cat "$KIT_ROOT/.claude/kit/migration/records/index.md"
```

- 目的：注入**跨迁移通用**的方法论坑索引（API 契约、分层归属、产物清理等）
- Token 成本：~500-800（索引精简，每条 1-2 行；详情按需 `Read kit/migration/records/<category>.md`）
- 与 Step 4 互补：pitfall 是项目业务坑，records 是 kit 级工具坑，不重叠

### 4.6 历史 defer 提醒表（kit 级，全量注入）

```bash
cat "$KIT_ROOT/.claude/kit/migration/pending.md" 2>/dev/null || true
```

- 目的：列出历次 migration 标为 `defer` 的规则条目，**每次 analyze 时检查是否已到回补触发条件**
- 若某条 pending 的"触发回补条件"已达成 → 本次迁移计划阶段评估是否拉回实现；否则保持 defer
- 本 feature 若新增 defer 条目，在 Step 8 结束时追加到 pending.md

### 5. 条件触发 /k:debug-capture

**强制触发**（不可跳过）：
- Context API 列表中存在 POST/DELETE 写操作 → 必须执行 `/k:debug-capture`
- 目的：采集旧系统发送的 **request body**（字段名、精度格式、enum 值），作为新实现的 ground truth

**条件触发**：
- context 文档 >30 天未更新 或 功能涉及 3+ 个 API 或 `--capture` → 执行 `/k:debug-capture`
- 否则跳过

> 写操作触发时，capture 报告需在分析报告 `### 写操作 Ground Truth` 章节中列出每个 POST/DELETE 的 requestBody 字段清单。

### 6. 输出分析报告

保存 `migration-analyze-<功能ID>.md`，格式：

```markdown
<!-- MIGRATION_SUMMARY_START -->
功能: <功能ID>
关键文件: <文件列表>
API: <API 列表>
写操作: <POST/DELETE API 列表，无则填 none>
状态管理: <MobX/Zustand/其他>
关联功能: <功能ID列表>
<!-- MIGRATION_SUMMARY_END -->

## 迁移分析：<功能ID>

### 功能摘要
...

### 关联功能
...

### 已知坑点
...

### 写操作 Ground Truth
<!-- 仅当存在 POST/DELETE 时输出此章节 -->
| API | 字段 | 类型/格式 | 示例值 |
|-----|------|-----------|--------|
| POST /api/xxx | amount | string（精度 8 位） | "10.00000000" |
| POST /api/xxx | side | enum string | "BUY" |

### Context 规则消费清单（**强制，有 context doc 时**）

> 若 Step 1 的 `/k/context load` 返回了 context doc，必须把 doc 里的**每条业务规则**（公式、阈值、防抖时长、条件分支、异常分支、校验规则、UI 降级态、网络切换、二次确认等）逐条列出并标注实现状态。
> **不要概述**——逐条列出是为了防止"读过 doc 但只消化了主干流程"。
> 往后 plan / execute / verify 的对照基线就是这张表。

| 序号 | 规则来源（doc § / 行号） | 规则内容（原文/公式） | UI 产物 | 实现状态 | followUp |
|-----|------------------------|---------------------|--------|---------|----------|
| 例1 | vault-withdraw-guide.md §calculateFee L134 | `fee = NAV × amount - previewRedeem`;≤0 显示 `--` | Fees 行文案 | implement | — |
| 例2 | vault-withdraw-guide.md §防抖 L140 | 输入后 1000ms `isDebouncing`,fee 显示 `--` | Fees 行文案(显示层防抖) | implement | — |
| 例3 | vault-withdraw-guide.md §min amount L170 | 链上 `callForMinAmounts(chain, coinSymbol)` + `formatUnits(raw, tokenDecimal)` | helperText "Minimum X sMAG7.SLP"; placeholder "Minimum X" | implement | **禁止硬编码** |
| 例4 | vault-withdraw-guide.md §shouldShowCooldownConfirm L74-89 | 有 cooldownAmount>0 或 isCooldownActive → 弹二次确认弹窗(4 种场景表) | ① 顶部 CooldownBanner ② 二次确认弹窗 ③ helperText | defer | **followUp:** `kit/migration/pending.md#vault-withdraw-cooldown-confirm`(issue/TODO 链接) |
| 例5 | vault-withdraw-guide.md §skeleton L181 | `isLoadingBalance && !isTrading` | 骨架屏遮罩 | implement | — |

**列说明**：
- **UI 产物**:本规则对应的**所有**可见 UI 元素,逐条列出(不可合并)。一条规则可对应 N 个产物(banner、弹窗、按钮态、helper 文案、toast 等),每个产物在 verify 单独勾选。
- **实现状态**:`implement`(本期实现)/ `defer`(本期不实现)/ `skip`(新架构不再需要,如 MobX 特有逻辑)。
- **followUp**(仅 `defer` / `skip` 必填):写明**后续回补入口**——`kit/migration/pending.md` 条目锚点 / issue 链接 / 代码内具体 TODO 锚点。verify 阶段机械读取此列,确保 defer 项已登记跟踪,未登记视为未完成。

**常见容易漏掉的规则类型**(分析 doc 时重点扫):
- **动态阈值**(min/max/minimum amount):**禁止硬编码**,必须查来源是链上/API
- **UI 条件显示**(某态下才显示某字段、某条件才弹确认弹窗)—— 尤其 1 条规则对应多个条件渲染块,UI 产物列必须列全
- **防抖 / 节流时长**(区分 query 防抖 vs 显示层防抖)
- **Fallback 态**(值未就绪时显示什么)
- **多步骤流程的步骤数条件**(如 2 步 vs 3 步由 token 决定)
- **错误文案模板**(特别是含变量替换的 i18n key)
- **被动展示组件**(根据后端/链上状态决定是否渲染 + 渲染什么的 banner / 状态条 / 标签)
- **多步骤 UI 的"step → 事件"映射**:带 N 次 wallet 签名/tx 提交/event 到达的流程,必须逐 step 标注它覆盖哪个具体事件(避免 spinner 空转或跨多个事件)。典型踩坑:3 步 progress UI 里 step 2 只在等 tx 不等签名,用户感知"没对应操作"

### defer 项登记(kit/migration/pending.md)

每当规则标 `defer`,同步追加到 `$KIT_ROOT/.claude/kit/migration/pending.md`:

```markdown
### <featureId>-<rule-short-name>
- **规则**:<analyze 报告里的规则内容>
- **UI 产物**:<逐条>
- **延后理由**:<一句话>
- **触发回补条件**:<例:合约调用已移植后 / Figma 最终稿确定后 / 后端 push 启用后>
- **登记时间**:<YYYY-MM-DD>
```

pending.md 被 `/k:migration` 下一次 analyze 时自动读入,作为**历史 defer 提醒表**,防止 defer 项随新 feature 迭代逐渐遗忘。

**状态枚举**：
- `implement` — 本期实现
- `defer` — 本期不实现(必须写明理由 + 跟踪 issue/TODO 定位)
- `skip` — 不再适用(如老项目 MobX 特有逻辑,新架构由 React Query 替代)

**强制规则**：
- doc 里出现的公式 / 阈值 / 时长必须抽出为独立行,不允许合并成"UI 细节"
- `defer` 行的理由 ≥1 句,不能只写"后续补"
- 未读 context doc(`/k/context load` 返回空)时跳过此章节,并在 analyze 报告开头明确标注 `⚠️ 无 context doc`

### 字段溯源表（**强制**）

> 每个用户可见 / 用于计算的字段都要逐条列出它在老项目的**来源路径**，后续 spec/plan/execute 直接对照此表落地。
> 包括但不限于：余额、价格、nonce、cooldown、数量、Max/Min、费率、ETA、状态位。
> 链上字段必须写到 `合约地址 + ABI 函数` 级别，不能只写"读链上"。

| 展示字段 | 在老项目的源 | 类型 | 关键细节 |
|---------|------------|------|---------|
| 举例: Withdraw Max | 链上 `balanceOf(SLP_TOKEN_ADDRESS, user)` + `decimals()` | chain | 和目标 Coin 无关,SLP 是凭证;decimals 动态读取(≠8) |
| 举例: My Deposit | API `GET /vault/invest-info` → `investInfo.tvl` | api | 与 Withdraw Max 同源不同入口 |
| 举例: cooldownEndTimestamp | 链上 `cooldownInfos(proxyAddress)` | chain | 必须先 `userToAccount(user)` 拿 proxy,直传 user 得 0 |

**字段来源分类**（按优先级填写,优先选最上游的）：
- `chain` — 合约直读(ERC20 balanceOf / Vault cooldownInfos 等),需记录`地址 + ABI fn`
- `api` — HTTP 接口返回字段,需记录`API path + 字段 JSON 路径`
- `store` — 前端 store/hook 派生(不要停在这一层,继续追溯其上游)
- `derived` — 纯计算(列公式 + 依赖字段)
```

### 7. 迁移确认（Checkpoint）

> 复用 clarify 三原则：不允许假设、HARD-GATE、结构化输出。
> analyze 是 migration 唯一没有内置反问机制的步骤（spec/plan/execute/verify 由底层命令覆盖）。

**4 类触发条件**（均为确定性判断，非 AI 主观判断）：

| 触发器 | 条件 | 问题模式 |
|--------|------|---------|
| A 范围边界 | `context files` 发现 ≥2 个关联功能共享核心文件 | "功能 X 和 Y 共享 <组件>，本次是否一并迁移？" |
| B 数据偏差 | capture API 数量 ≠ Context API 数量 | "capture 发现 N 个 API，Context 记录 M 个，差异 API 是否属于本功能？" |
| C 入口不确定 | grep 候选入口文件 ≥3 个（仅 auto-learn 时） | "找到 N 个候选入口，哪个是主入口？" |
| D 旧逻辑模糊 | 代码中存在无注释的特殊逻辑（setTimeout、硬编码、不明条件分支） | "旧代码有 <具体逻辑>，是业务需求还是临时方案？" |

**执行逻辑**：

- 所有触发器均未命中 → 输出 `✅ 分析清晰，无歧义` → 直接继续
- 任一触发器命中 → 输出结构化确认：

```markdown
📋 迁移确认：<功能ID>

【已确认】
- 入口文件：<路径>
- API：N 个（与 Context 一致）

【需确认】
1. <触发器 A/B/C/D 对应的具体问题>
2. ...
```

- **HARD-GATE**：【需确认】非空时，等待用户回复后才继续
- 用户回复后，将确认结果追加到分析报告末尾：

```markdown
### 确认记录
- <用户确认的决策>
```

后续 spec/plan/execute 读取分析报告时自然获取这些决策，不再重复提问。

---

### 8. 更新 migration-state.json

> Step 6 的报告编号不变，checkpoint 插入在报告输出和 state 更新之间。

```json
{
  "featureId": "<功能ID>",
  "targetArch": "sodex-next-5-layer",
  "currentStep": "analyze",
  "startedAt": "<今天日期>",
  "completedSteps": ["analyze"],
  "artifacts": { "analyze": "migration-analyze-<功能ID>.md" },
  "tokenEstimates": {
    "analyze": { "filesRead": [], "inputChars": 0, "outputChars": 0, "estimatedTokens": 0 }
  }
}
```

---

## Token 估算

步骤完成后，估算本步 token 消耗并写入 migration-state.json：

```
计算方式：
- inputChars = 所有读取文件的字符数总和
- outputChars = 生成报告的字符数
- estimatedTokens = (inputChars + outputChars) / 4
- filesRead = 本步读取的文件路径列表
```

预期范围：~600 tokens（有 Context）/ ~1400-2600 tokens（无 Context，含自动入库）
