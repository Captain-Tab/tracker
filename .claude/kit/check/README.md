# Check 系统文档

## 概述

Check 系统用于代码提交前的质量检查和验收，支持自动记录到 Context Library。

---

## 目录结构

```
.cursor/kit/check/
├── templates/
│   └── checklist.md       # 完整的检查清单模板
├── scripts/
│   └── check.sh           # 检查逻辑脚本
└── README.md              # 本文档
```

---

## 使用方式

### 基本用法

```bash
# 只执行检查，不记录到 Context Library
/k/check

# 检查完成后自动记录到 Context Library
/k/check --r
```

### 工作流程

1. **加载 Checklist**：
   - 从 `templates/checklist.md` 加载完整检查清单
   - 包含 CHK-01 到 CHK-18 共 18 项检查

2. **显示 Git 状态**：
   - 未跟踪文件（untracked files）
   - 变更内容（staged/unstaged changes）
   - 最近提交记录（用于参考 commit 风格）

3. **AI 执行检查**：
   - 根据 checklist 逐项检查代码
   - 验证需求、技术、AI 代码质量、交付标准

4. **生成报告**：
   - 检查报告（通过/未通过统计）
   - Git Commit 建议（中英文双语）
   - 问题记录和改进建议

5. **可选记录**（仅 `--r` 参数）：
   - 自动调用 `/k/context-record`
   - 将功能记录到 Context Library

---

## Checklist 内容

### 1. 需求检查（4 项）

- CHK-01: 功能需求(MUST)全部满足
- CHK-02: 边界情况已处理
- CHK-03: 没有遗漏的功能点
- CHK-04: 没有逻辑问题

### 2. 技术检查（6 项）

- CHK-05: 代码符合项目规范
- CHK-06: 代码符合通用规范
- CHK-07: 无明显性能问题
- CHK-08: 错误处理完善
- CHK-09: 弹窗/Drawer 状态重置
- CHK-10: useEffect 依赖项稳定性

### 3. AI 生成代码审查（5 项）

- CHK-11: 逻辑正确性
- CHK-12: 边界处理
- CHK-13: 代码风格
- CHK-14: 依赖合理
- CHK-15: 无冗余代码

### 4. 交付检查（3 项）

- CHK-16: 文档已更新
- CHK-17: 代码已自查
- CHK-18: 可正常运行

---

## Token 优化

### v2.5.4 优化成果

通过**模板外部化**策略，实现了显著的 token 节省：

| 指标 | 优化前 | 优化后 | 节省 |
|------|--------|--------|------|
| **文件行数** | 262 行 | 30 行 | 88.5% |
| **Token 消耗** | ~13,100 | ~1,200 | **90.8%** |

### 优化原理

**问题分析**：
- `check.md` 原有 262 行
- 其中 238 行是 checklist 模板（AI 必须看到）
- 只有 20 行是脚本逻辑

**解决方案**：
- 将 238 行模板提取到 `templates/checklist.md`
- 脚本逻辑提取到 `scripts/check.sh`
- `check.md` 只保留命令入口（30 行）

**关键技术**：
- 模板按需加载：只在执行时加载
- 脚本模块化：逻辑与模板分离
- 路径动态解析：支持在任意位置执行

---

## 技术细节

### check.sh 脚本功能

1. **环境准备**：
   - 自动定位 soso-kit 根目录
   - 验证配置文件存在性

2. **参数解析**：
   - 检测 `--r` 参数
   - 设置 `HAS_RECORD_FLAG` 标志

3. **模板加载**：
   - 从 `templates/checklist.md` 读取完整 checklist
   - 使用 `cat` 命令输出模板内容

4. **Git 分析**：
   - 执行 `git status --short` 显示未跟踪文件
   - 执行 `git diff --stat` 显示变更统计
   - 执行 `git log --oneline -5` 显示最近提交

5. **用户提示**：
   - 显示下一步操作指引
   - 如果有 `--r` 参数，提示将自动记录

### check.md 命令流程

1. **Step 0: 环境准备**
   - 定位 soso-kit 根目录
   - 验证配置有效性

2. **Step 1: 执行检查**
   - 调用 `check.sh` 脚本
   - 传递所有参数 `$ARGUMENTS`

3. **Step 2: 条件记录**
   - 检测 `--r` 参数
   - 如果存在，调用 `/k/context-record`

---

## 扩展与维护

### 修改 Checklist

编辑 `templates/checklist.md` 即可，无需修改命令代码：

```bash
vim .cursor/kit/check/templates/checklist.md
```

### 修改检查逻辑

编辑 `scripts/check.sh`：

```bash
vim .cursor/kit/check/scripts/check.sh
```

### 添加新功能

在 `check.sh` 中添加新的分析步骤：

```bash
# 示例：添加 ESLint 检查
echo "### ESLint 检查"
echo ""
npx eslint . --format compact || echo "ESLint 检查失败"
echo ""
```

---

## 相关命令

- `/k/check` - 代码检查（本命令）
- `/k/check --r` - 检查 + 自动记录
- `/k/context-record` - 记录功能到 Context Library
- `/k/spec` - 生成功能规范
- `/k/task` - 执行任务清单

---

## 常见问题

### Q: 为什么不把 template 内容也放在 check.sh 中？

**A**: Token 优化原因。如果放在 check.sh 中：
- check.sh 会变成 250+ 行
- Claude 每次加载 check.md 时都会加载 check.sh
- 无法实现 token 节省

通过外部模板：
- check.md 只有 30 行（~1,200 tokens）
- 模板只在运行时加载，不计入命令 token
- 节省 90.8% token

### Q: 如果在子目录执行 /k/check 会找到模板吗？

**A**: 会。`check.sh` 会自动向上查找 soso-kit 根目录：
```bash
if [ -f ".cursor/kit/config.sh" ]; then
    KIT_ROOT="$(pwd)"
elif [ -f "../.cursor/kit/config.sh" ]; then
    KIT_ROOT="$(cd .. && pwd)"
elif [ -f "../../.cursor/kit/config.sh" ]; then
    KIT_ROOT="$(cd ../.. && pwd)"
fi
```

### Q: --r 参数是如何传递的？

**A**: 通过 `$ARGUMENTS` 变量：
1. 用户执行 `/k/check --r`
2. `check.md` 接收到 `$ARGUMENTS="--r"`
3. 传递给 `check.sh $ARGUMENTS`
4. check.sh 通过 `grep -q "\--r"` 检测参数

---

## 版本历史

- **v2.5.4** (2026-02-17): 模板外部化，节省 90.8% tokens
- **v2.5.3** (2026-02-17): record 命令独立
- **v2.4** (2026-02-17): 统一命令架构

---

## 参考资料

- [Context 变更日志](../../version/kit/context.md) - 完整变更历史
- [Context 系统架构](../context/ARCHITECTURE.md) - 整体架构设计
- [Record 工作流](../context/action/record/WORKFLOW.md) - 记录工作流详解
