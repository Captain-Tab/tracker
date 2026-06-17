---
description: 对代码变更进行深度审查：完整性、规范性、边界、意图
---

# 代码 Review

## 用户输入

```text
$ARGUMENTS
```

---

## 核心目的

从 reviewer 视角（而非 author 视角）审查代码变更，回答：
- **完整性**：spec 预期的改动是否全部实现（漏改？）
- **规范性**：代码是否符合项目规范（错改？）
- **边界**：改动是否引入未处理的边界条件（错改？）
- **意图**：实现是否偏离 spec、是否影响已有代码（逻辑冲突？）

输出：每个维度 PASS/FAIL + 具体位置，最终 `VERDICT: PASS / FAIL`。

---

## 执行步骤

### Step 1: 确定审查范围

按以下优先级确定要 review 的文件（找到即停）：

**1a. 用户指定了文件路径** → 直接使用

**1b. 用户未指定** → 从分支改动推断：

```bash
# 全部改动文件（用于完整性 / 意图审计）
git diff --name-only HEAD

# 代码文件（用于规范 / 边界审查）
git diff --name-only HEAD -- '*.ts' '*.tsx' '*.js' '*.jsx'
```

有改动 → 使用；无改动 → 检查暂存区（同上两条命令加 `--cached`）。

**1c. 以上都没有** → 询问用户指定文件路径

---

### Step 2: 加载意图基准

> ⚠️ **强制先于 diff 执行**：必须先建立预期改动清单，再获取 diff，防止确认偏差。

按优先级获取（找到即停）：

**2a. 当前对话中的 spec/需求描述**
- 对话中是否有 spec 内容、`/k/spec` 或 `/k/plan` 的输出
- 有 → 作为意图基准

**2b. 对话中无上下文 → 查找 spec 文档**
- 从改动文件路径推断功能模块（如 `src/pages/vault/` → vault）
- 查找最近的 spec 文件：
  ```bash
  ls -t .claude/kit/spec/*.md 2>/dev/null | head -3
  ```
- 找到 → 读取，作为意图基准

**2c. 以上都没有 → 主动询问**
> 未找到相关 spec。请提供本次改动的需求背景，或回复 `skip` 跳过完整性检查。

**获取到意图基准后，强制输出预期改动清单**（此步骤不可跳过）：

```
📋 预期改动清单（基于 spec）：

文件/模块层面：
- [ ] [推断应改动的文件或模块，含 PC/Mobile 对称项]

功能/行为层面：
- [ ] [spec 要求的功能点或行为]
```

> 推断时注意：UI 组件通常有 PC 和 Mobile 两个版本，若 spec 涉及 UI，两端都应列入预期。

---

### Step 3: 获取实际变更

```bash
git diff --stat HEAD
git diff HEAD
```

输出实际改动文件列表。

---

### Step 4: 完整性检查

对比 Step 2 预期清单 vs Step 3 实际改动：

**执行方式**：
1. 逐项检查预期清单，在 diff 文件列表中确认是否存在对应变动
2. 特别检查 PC/Mobile 对称性：若改了 PC 组件，Mobile 对应组件是否也在 diff 中
3. 同级平行实现扫描：本次修改若属复制粘贴式同款 pattern（弹窗家族 claim/unstake/withdraw、多个 wrapper/hook），grep 同款实现的其他文件，确认需同改的邻居未被漏掉（区别于 Step 7 grep 调用方——此处找的是平行同款，非下游调用方）
4. 标出 gap（预期有但 diff 中没有的项，含漏改的同级邻居）

**内部记录到 MAIN_REPORT.completeness**（Step 8 表格汇总，此处不单独输出）：
- 已实现：[列表]
- 漏改：[列表 + 说明]
- COMPLETENESS: PASS / FAIL / SKIPPED

> 无 spec（2c 用户回复 `skip`）→ `COMPLETENESS: SKIPPED`，不影响 VERDICT。

---

### Step 5: 规范审查

> 规范已通过 CLAUDE.md 注入当前上下文，直接按已知规则检查，无需重新读取文件。

**仅对代码文件（Step 1b 的 `*.ts` `*.tsx` `*.js` `*.jsx` 列表）执行**。

通用规范：
- **clean-code**：命名（verb-noun / is/has/can 前缀）、不可变、类型安全（禁 any）、早返回、单一职责
- **regular**：中文注释、不删除 commented-out 代码、Zustand selector 稳定性

项目专属规范（如适用）：
- **弹窗/Drawer**（CHK-09）：组件打开后是否正确重置状态，是否存在数据残留风险
- **useEffect 依赖**（CHK-10）：依赖项引用是否稳定（原始值 / useMemo / useCallback），是否有内联对象/数组/函数作为依赖
- **精度计算**（CHK-10b，涉及金额/余额/价格时）：比较用 `calculate`、运算用 `calculate`、显示用 `floorToDecimal`、MobX 依赖提取具体字段

对每个问题，输出 file:line + 违反的规范条目。

**内部记录到 MAIN_REPORT.standards**（Step 8 表格汇总，此处不单独输出）：
- 问题列表：[file:line + 规范依据]（无问题填"无规范违反"）
- STANDARDS: PASS / FAIL

---

### Step 6: 边界猎手

对 diff 中每个改动的函数/组件，机械走查未处理的边界条件：

检查维度：
- 空值/undefined：参数、返回值、可选链末端
- 数组边界：空数组、单元素
- 数值边界：0、负数、NaN
- 异步竞态：并发调用、组件卸载后的回调
- 状态组合：多个 boolean/enum 的组合是否穷举

**只报告未处理的路径**，已处理的静默跳过。

> 非代码文件（`.md` / `.sh` / `.json` 等配置文档）无边界条件，直接输出 `EDGE_CASES: N/A`。

**内部记录到 MAIN_REPORT.edge_cases**（Step 8 表格汇总，此处不单独输出）：
- 未处理路径：[位置 / 触发条件 / 建议防护]（无发现填"未发现未处理的边界条件"）
- EDGE_CASES: PASS / FAIL / N/A

---

### Step 7: 意图审计

对照 Step 2 的意图基准，检查：

1. **偏离检测**：spec 要求但代码未实现的行为；代码实现了但 spec 未提及的（过度实现）
2. **调用方影响**：对每个被修改的函数/组件，grep 调用方，检查接口是否仍然兼容
3. **逻辑冲突**：改动是否与周边已有代码产生矛盾

**内部记录到 MAIN_REPORT.intent**（Step 8 表格汇总，此处不单独输出）：
- 偏差点：[file:line + 说明]（无偏差填"实现与 spec 意图一致"）
- INTENT: PASS / FAIL / SKIPPED

---

### Step 8: 输出报告（**唯一**用户可见输出位置）

```markdown
## 📋 Review 报告

审查范围：[文件列表]
意图基准：[spec 文件名 / 对话上下文 / 已跳过]

| 维度    | 结果              | 关键证据                                  |
|---------|-------------------|-------------------------------------------|
| 完整性  | PASS/FAIL/SKIPPED | <一句证据 / FAIL 时列漏改项概要>          |
| 规范    | PASS/FAIL         | <file:line — 规范条目 / PASS 一句概括>    |
| 边界    | PASS/FAIL/N/A     | <位置 + 触发 + 防护 / PASS 一句>          |
| 意图    | PASS/FAIL/SKIPPED | <偏差点 file:line / PASS 一句>            |

## VERDICT: PASS / FAIL

FAIL 详情（仅 FAIL 时列出，每项 ≤ 1 行 / 80 字符）：
- <file:line> — <说明>
```

**约束**：
- "关键证据"列每格 ≤ 1 行；细节超出时压缩成「N 处问题，详见 FAIL 详情」
- 表格 + FAIL 详情是**唯一**输出，不再用 `####` 小节标题
- PASS 时不输出 FAIL 详情段

**VERDICT 判定规则**：
- 任意维度为 `FAIL` → `VERDICT: FAIL`
- 所有维度为 `PASS` / `SKIPPED` / `N/A` → `VERDICT: PASS`
- `SKIPPED` 时附注：`⚠️ 无 spec，完整性/意图检查已跳过`

---

## 原则

- **不自动修改文件**，只输出报告
- **预期清单必须先于 diff 生成**（Step 2 完成后才执行 Step 3）
- **只报告缺失和问题**，不评价风格偏好
- **每个维度独立 PASS/FAIL**，VERDICT 是综合结论
- **不凑数量**：没有问题就说没有，不强行找问题
