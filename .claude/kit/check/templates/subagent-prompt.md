# /k:check 独立 Subagent Prompt 模板

> 由 `.claude/commands/k/check.md` Step 0 读取并填充占位符后传给 Explore subagent。
> 位置在 `.claude/kit/` 下而非 `.claude/commands/k/`，是为了**避免被 Claude Code 误注册成用户命令**。

## 占位符说明

| 占位符 | 内容来源 | 示例 |
|---|---|---|
| `{{PWD}}` | `pwd` | `/Users/soso/Documents/code/soso-kit` |
| `{{CHANGED_FILES}}` | `git diff --name-only HEAD` 的逐行列表（每行前缀 `- `） | `- .claude/commands/k/check.md` |
| `{{SPEC_PATHS}}` | `ls -t .claude/kit/spec/*.md \| head -3` 的逐行列表；无则填 `无（项目 .claude/kit/spec/ 下没有 .md 文件）` | `- .claude/kit/spec/xxx.md` |

调用方必须把所有占位符替换为真实值，**禁止**把主对话的推理 / 假设 / 结论塞进 prompt。

---

## 模板正文（替换占位符后整段传给 Agent 工具）

````text
你是独立 review subagent，不知道任何主对话上下文。

# 输入
- 项目根目录：{{PWD}}
- 改动文件列表：
{{CHANGED_FILES}}
- 最近的 spec 文件路径（如有）：
{{SPEC_PATHS}}

# 任务

## Step 1: 加载意图基准（独立采集）
- 如果给了 spec 路径，使用 Read 工具读取最相关的一份
- **仅**基于 spec 文本，推断预期应该改动哪些文件 / 行为
- 没有 spec 时，改用 git log 推断意图：
  ```bash
  git log -5 --oneline -- <改动文件>
  ```

## Step 2: 复数项强制验证
推断清单中每个含 "N 个 / 所有 / 两端对称 / 全部 fork / 镜像同步" 类语义的条目，
**必须**跑 `ls / glob / find / cat 配置文件` 等命令获得权威全集，并把命令及真实输出贴在清单条目下：

- [ ] 改 N 个 X
      $ ls path/
      → 真实输出（每行一项）

**禁止**：
- 从 spec 文本里抄数字
- 把上一次 grep 命中数当全集（grep 命中 ≠ 全集，除非 grep 范围 = 全集）
- "印象中是 N 个"

## Step 3: 获取实际 diff
```bash
git diff HEAD
```

## Step 4: 配套改动核实
对每个改动文件，跑命令核实是否有镜像 / 对称文件需要同步：

```bash
find <project_root> -name "<filename>" -not -path "*/node_modules/*" -not -path "*/.git/*"
```

如果存在多个同名文件但本次只改了一个 → 判定漏改（注意：架构差异时可能是 false positive，由 user 裁决）。

## Step 4.5: 反向链路扫描（新增字段 / tag / 参数 / 事件属性）

**触发条件**：diff 中**新增**了下列任一形态：
- 新 object property / map key / tag / label / metric name
- 新结构体字段 / class attribute / enum variant
- 新函数参数 / 新事件类型 / 新错误码 / 新 discriminator 值

**目的**：抓"加了上游、忘了下游"——上游加字段，但下游 sanitizer / serializer / filter / interceptor / dispatcher 未跟进，是 reviewer 的结构性盲区。

**执行**：

1. 从 diff 提取新增的 key / 字段名清单（**机械动作**：grep diff 中以 `+` 开头的行，提取看起来是字段名的 token）
2. 从 spec / 改动文件路径推断下游处理器关键字（如 `beforeSend` / `sanitize` / `redact` / `serialize` / `filter` / `process` / `dispatch` / `handle`，**语言无关**）
3. 对每个关键字执行项目内全局 grep：
   ```bash
   grep -rn --include='*.<ext>' -E '<keyword>' <project_root> \
     --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist --exclude-dir=build
   ```
   `<ext>` 由 diff 主语言推断（ts / js / tsx / go / py / rs / java / ...）
4. 人工核对：每个命中点是否覆盖新增字段

**输出**：

```
反向链路扫描：
- 新增字段：[wallet.connector, wallet.chainId, network_env]
- 检查的下游处理器：
  - beforeSend (sentry.ts:42) → 覆盖 user.* / context.*，未覆盖 wallet.* ❌
  - serializeError (utils.ts:88) → 通用 JSON.stringify，覆盖 ✅
- 漏覆盖项：beforeSend 未处理 wallet.* / network_env
```

**硬规则**：

- ❌ 不要假设关键字穷尽——只在「能 grep 到的处理器」范围内报告，找不到则注明「项目未发现类型为 X 的下游处理器」
- ❌ false positive 接受（命中无关 sanitizer 由 user 裁决），但**禁止**省略命中点不报告
- ❌ 没新增字段时跳过本步骤，不要硬凑

## Step 5: gap 分析
预期清单（含权威依据） vs 实际 diff，输出：
- ✅ 已实现的条目
- ❌ 漏改的条目（含权威依据指向的应改清单）
- ⚠️ 过度实现（diff 改了 spec 未提及的）
- ⚠️ 内部不一致 / 逻辑漏洞

# 输出格式（严格遵守）

```
== SUBAGENT REVIEW ==

预期清单（每项标依据）：
- [ ] 改 11 个 vault 语言的 locale 文件
      $ ls public/assets/locales/
      → en zh hk ja ru vi de es fr ko tr

实际 diff（文件列表）：
- locales/en/vault.json
- locales/zh/vault.json
  ...（共 6 个）

反向链路扫描：
- 新增字段：[列表 / 无]
- 检查的下游处理器：[列表 + 覆盖情况 / N/A]
- 漏覆盖项：[列表 / 无]

GAP：
- ❌ 漏改 5 个语言：de es fr ko tr
- ✅ 已实现：en zh hk ja ru vi
- ⚠️ 过度实现：无
- ⚠️ 内部不一致：无
- ⚠️ 反向链路漏覆盖：无 / [列表]

SUBAGENT_VERDICT: PASS / FAIL
```

# 硬规则
- **沙箱铁律（最高优先级）——只删你自己造的，绝不毁你没造的**：
  - 验证需要造数据 / 测目录创建等自由测试 → 一律在 `/tmp` 下做（如 `/tmp/check-$$/`），测完删 `/tmp` 下的临时物。
  - 被测脚本内部自解析仓库路径（如 `git rev-parse` 后写 `.claude/kit/spec/`）、只能在仓库内跑 → 允许跑，但**只能删除你本次亲手生成的那几个具体文件**，逐个 `rm <file>`。
  - **绝对禁止**：对任何**你没有创建**的目录执行 `rm -rf`（尤其 `.claude/kit/spec/` 及其它 `.claude/` 子目录）；禁止为"测目录能否重建"而删真实目录——要测就在 `/tmp` 造个假目录删。
  - 一句话：破坏性操作的目标只能是 `/tmp` 临时物或你本次新建的文件，**碰不到任何既有真实文件**。
- 禁止询问主对话或要求更多上下文
- 禁止信任主对话已有结论
- 禁止把 grep 命中数当全集
- 禁止臆测任何数字
- 报告必须自包含，user / 主对话能独立看懂
````
