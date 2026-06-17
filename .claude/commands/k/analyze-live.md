---
description: 静态多 agent + 运行时 debug-capture 双重分析既有项目模块，产出含实测 ground truth 的纯事实分析文档
---

# Analyze-Live: 双重分析（静态 + 运行时）

## 用户输入

```text
$ARGUMENTS
```

---

## 核心定位

`/k:analyze` 的**进阶版本**。在静态多 agent 分析之外，**强制**通过 XHR/fetch 拦截器在用户真实操作中采集运行时数据，用实测 ground truth 校正源码假设。

### 何时该用 analyze-live

| 场景 | 用 analyze | 用 **analyze-live** |
|---|---|---|
| 静态读源码就够 | ✅ | — |
| 需要看真实 request/response 字段 | — | ✅ |
| 源码看不出运行时 patch（拦截器/store 覆盖参数）| — | ✅ |
| 类型定义可能与 response 实际形态不一致 | — | ✅ |
| 多环境（dev/prod）数据差异需识别 | — | ✅ |
| 接口字段命名风格混杂（camelCase / snake_case）| — | ✅ |
| 模块即将迁移，需 fixture-grade ground truth | — | ✅ |

### 与相邻命令的边界

| 命令 | 输入 | 产出 |
|---|---|---|
| `/k:analyze` | 既有项目模块 | 纯静态分析文档 |
| **`/k:analyze-live`** | **既有项目模块（必须能本地运行）** | **静态 + 运行时双重校验的纯事实文档** |
| `/k:debug-capture` | 单次运行时采集 | 仅运行时报告 |

---

## 资产清单（位于 `.claude/kit/analyze-live/`）

| 文件 | 用途 |
|---|---|
| `template.md` | 输出文档结构模板（章节顺序/表格列名固定）|
| `interceptor.template.js` | XHR + fetch 双拦截器代码模板（占位符 `{{PORT}}` / `{{PATTERNS}}`）|
| `scripts/inject.sh` | 渲染模板并注入入口文件，所有行带 `// [CAPTURE]` 标记 |
| `scripts/cleanup.sh` | 4 步清理（拦截器删行 / 检测 `[CAPTURE-TEMP]` / 停服 / 删日志）|
| `scripts/analyze-log.sh` | 解析 debug.log → Markdown 接口清单（去重 + 多形态聚合）|

命令本体只调脚本 + 调 agent + 写文档，不在 prompt 里重复脚本逻辑。

---

<HARD-GATES>
1. 强制运行时采集：无 runtime 数据不出文档
2. 目标项目必须能本地起服务
3. 仅注入 `// [CAPTURE]` 标记的拦截器；临时配置改动每行带 `// [CAPTURE-TEMP]`
4. 表格每行必填 `file:line`
5. 文档必须含"实测 vs 源码"对账章节
6. 不写迁移建议 / 风险评估 / 目标技术栈专属概念
7. 结束必清理（调 `cleanup.sh`，缺一不可）
8. 网关切到 prod 时只读，禁止写操作
9. UI 截图必须标注分析范围红框
10. 文档结构严格按 `template.md` 章节顺序
11. 文档必须含"迁移充分性评估"章节（🔴 阻塞 / 🟡 待确认 / 🟢 实现层 三档分级）和"同页面同源接口边界"章节（划清哪些接口**不属于**当前 spec 范围）。缺任一节 → Step 8 核验拒收
12. 核心类型 / 派生 hook 必须逐字段成表（见 Step 4 派单红线），抽样列举即视为不达标
</HARD-GATES>

---

## 执行步骤

### Step 0：解析输入

输入优先级：
1. 路径指向 `.claude/kit/spec/*.md` → Read
2. 其他 `.md` 路径 → Read
3. 文字描述（项目根 + 入口 + 范围）→ 直接用
4. 都不命中 → 报错反问

### Step 1：澄清范围（最多 5 问）

| # | 问题 | 何时问 |
|---|---|---|
| Q1 | 项目根绝对路径？ | 未明确 |
| Q2 | 模块入口（路由 / 文件 / URL）？ | 未明确 |
| Q3 | 本地 dev 服务地址？ | 必问 |
| Q4 | 关注范围（接口/处理/类型/实时/分支）？ | 未明确 |
| Q5 | 网关 / 后端环境策略：是否需要临时切到 prod 网关采真实数据？| 必确认（涉及风险）|

**截图驱动**：用户提供 UI 截图时**要求标注红框**，明确"分析范围在此"。特别注意主区 tab vs 右侧栏 vs 弹窗 vs 子 tab。冲突时反问。

### Step 2：复杂度判定 + 拦截器策略

复杂度判定（同 /k:analyze）：子模块数 / 关注维度数 / 跨文件耦合 / 资产分支，任一命中"复杂"列 → 复杂模式。

拦截器策略：
- HTTP 库：`grep -rn "axios\|XMLHttpRequest\|fetch(" <project>/{lib,helper,http}` 推断；模板已含 XHR+fetch 双拦截
- URL filter：宽松（覆盖动词关键字 + 资源名段），宁多勿少
- Response 截断：默认 3000，长 HTML 上调

### Step 3：环境准备

```bash
# 3.1 起 debug 服务
bash .claude/kit/debug/scripts/start-server.sh start <PROJECT_ROOT>

# 3.2 网关切换（仅当 Q5 同意切到 prod，需手动 Edit；每行带 [CAPTURE-TEMP]）
# 示例：在 config/develop.ts 中
#   SERVER_API: "https://gw.prod.com", // [CAPTURE-TEMP] 临时切生产网关采真实数据

# 3.3 注入拦截器
bash .claude/kit/analyze-live/scripts/inject.sh <ENTRY_FILE> <PORT> <pattern1,pattern2,...>
```

切到 prod 时输出告警：`⚠ 已切到生产网关。仅供读操作采集，请勿触发写操作（下单/支付/钱包签名）。`

### Step 4：静态多 agent 并行（与采集并行）

任务拆分（同 /k:analyze Step 3-B）：
- B 接口清单 / C 处理逻辑 / F 类型定义（并行）
- D 分支差异（依赖 B+C）/ E 实时性（依赖 B）

派单红线：
- 范围严格限定 Step 1 模块边界
- 每行表格必填 `file:line`
- 主区 / 右侧栏 / 弹窗 / 子 tab 全覆盖（依据截图标注）
- 找不到的写「未发现」，禁止猜测
- 不写迁移建议 / 主观评价
- **核心类型逐字段穷举（强制）**：派给 F（类型定义）agent 时必须显式要求"被任一 spec 范围接口 response 返回的核心类型 / 任一 spec 范围 UI 组件消费的派生 hook 返回值，必须**逐字段成表**（含 type / 必填 / 实测样本或源码默认），禁止只给字段量统计或抽样列举"。同理 C（处理逻辑）agent 必须把核心 `usePost` 类 hook 的派生字段全展开。验收看：表格行数 ≥ 类型字段数。

派 agent 后立即给用户操作指引：

```
🎬 请你做：
1. 浏览器打开 <DEV_URL><ROUTE>
2. 硬刷新（⌘+Shift+R）让拦截器生效
3. 走完功能主路径（每个子 tab / filter / 分页都覆盖）
4. 完成后回 "done"
```

### Step 5：等 "done" + 读日志

```bash
bash .claude/kit/analyze-live/scripts/analyze-log.sh <PROJECT_ROOT>/debug.log [filter-substring]
```

输出含：唯一接口数、每个接口的唯一 Request 形态、Response 样本、调用次数。

### Step 6：双向交叉校验（强制）

主线程汇总：
- 静态 agent 产出 → 接口列表 A
- analyze-log 输出 → 接口列表 B
- 生成"实测 vs 源码"对账表（见 `template.md` 该章节）

发现矛盾 **不要直接覆盖源码结论**，标 `⚠` 写入"存疑项"。

典型矛盾模式：
- 源码硬编码值 vs 实测被运行时 patch 覆盖
- 类型签名 number vs 实测 string
- 字段命名风格混杂
- response 实际多出字段未在 types 定义

### Step 7：汇总文档

按 `.claude/kit/analyze-live/template.md` 章节顺序填充：

输出路径：`.claude/kit/spec/<topic-slug>-detail.md`

slug 命名：`<project-shortname>-<module>-<route-or-asset>-detail.md`

未涉及章节直接省略（不写"略"）。实测 JSON 样本必须真实粘贴。

### Step 8：核验

派核验 Explore agent，四维 + 实测对账完整性：

| 维度 | 检查 |
|---|---|
| 真实性 | 抽样 10-15 条 `file:line` 对照源码 |
| 完整性 | 章节自洽 |
| 遗漏 | 范围内是否漏 tab/接口/处理 |
| 模糊度 | 表述含糊处 |
| 实测对账完整性 | 所有接口是否都在对账表 / 矛盾是否都进存疑项 |
| 字段穷举 | 核心类型 / 派生 hook 是否逐字段成表（行数 ≥ 类型字段数）|
| 出口章节 | "迁移充分性评估"（含 🔴/🟡/🟢 分级）和"同页面同源接口边界"是否都存在；缺任一节直接拒收 |

修订后输出修订摘要。

### Step 9：自动清理（强制）

```bash
bash .claude/kit/analyze-live/scripts/cleanup.sh <PROJECT_ROOT>
```

脚本会：
1. 删所有 `// [CAPTURE]` 行
2. 报告 `[CAPTURE-TEMP]` 临时配置位置（不自动回滚，需人工 Edit 还原以保安全）
3. 停 debug 服务
4. 删 debug.log

⚠ 即使采集失败也必须执行。脚本报告的 `[CAPTURE-TEMP]` 项必须用 Edit 工具逐个还原。

### Step 10：交付

```
✅ Analyze-Live 完成

📄 主文档：.claude/kit/spec/<topic-slug>-detail.md
📊 实测命中接口数：N（含 M 个写操作）
🔍 核验：真实性 N% / 完整性 OK / 遗漏 N / 模糊度 N / 对账矛盾 N
⚠️ 存疑项：<前 3 条>
🧹 清理：✅ 拦截器 / ⚠ 临时配置（人工还原 N 项）/ ✅ 日志 / ✅ 服务

下一步：
- 用于方案设计 / spec 输入
- 若重大遗漏 → 重新运行 /k:analyze-live
- 进入实现 → /k:spec 加载本文档
```

---

## 红线（重申）

| # | 红线 | 违反后果 |
|---|---|---|
| 1 | 必须经过 debug-capture | 拒绝交付 |
| 2 | 拦截器代码每行带 `// [CAPTURE]`；临时配置改动每行带 `// [CAPTURE-TEMP]` | 清理会漏 |
| 3 | 文档必须含"实测 vs 源码"对账章节 | 整章重做 |
| 4 | 表格每行必有 `file:line` | 行不进主体 |
| 5 | 不修改业务代码 | 立即停止 |
| 6 | 不写迁移建议 / 风险评估 / 目标技术栈专属概念 | 整章删除 |
| 7 | 结束必清理 | 视为未完成 |
| 8 | 网关切 prod 时只读，禁写 | 立即停止 |
| 9 | UI 截图必须标注红框 | 反问 |
| 10 | 文档结构严格按 `template.md` | 重排 |

---

## 适用 / 不适用

✅ **适用**：
- 模块即将迁移，需 fixture-grade ground truth
- 源码与运行时可能不一致
- 字段命名风格混杂
- 多环境数据差异需识别

❌ **不适用**：
- 项目无法本地起服务 → 用 `/k:analyze`
- 仅看代码就能确定行为 → `/k:analyze` 更轻量
- 评估外部 GitHub 项目 → `/k:study`
- 修 bug → `/k:debug-on`
- 已有设计要实现 → `/k:spec`

---

## 与现有命令协作

```
模糊想法 →[/k:clarify]→ 设计 spec
                            ↓
既有项目模块 →[/k:analyze]→ 静态文档
                            ↓ (需运行时校验)
                       [/k:analyze-live]→ 静态+实测双重文档 ←┐
                                                          ├→ [/k:spec]→ 实现规范
                                                          └→ 方案评估
```
