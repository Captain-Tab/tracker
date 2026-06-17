---
description: 编排 soso-kit 现有命令实现 sodex-web → sodex-next 结构化迁移工作流
---

# Migration: 跨架构迁移工作流

## 用户输入

```text
$ARGUMENTS
```

---

## Step 0: 前置检查

```bash
KIT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
MIGRATION_DIR="$KIT_ROOT/.claude/kit/migration"
```

### 项目检测

检测当前项目是否为 sodex-next：
- 检查项目目录名或 package.json name 是否包含 `sodex-next`
- **否** → 输出 `⚠️ migration 命令需要在 sodex-next 项目目录下执行`，停止
- **是** → 继续

### 架构规则检测

检测 `.claude/rules/` 是否包含架构规则：
- 存在且含分层约束 → 继续
- 缺失 → 自动从 `docs/generation-contract.md` 提取核心规则补全

---

## Step 1: 模式路由

```bash
SUBCMD=$(echo "$ARGUMENTS" | awk '{print $1}')
FEATURE_ARG=$(echo "$ARGUMENTS" | sed 's/^[^ ]* *//')

case "$SUBCMD" in
  analyze|spec|plan|execute|verify|finalize|status)
    # 单步模式：读取对应子命令文件并执行
    # Read: $MIGRATION_DIR/commands/$SUBCMD.md
    ;;
  records)
    # 方法论坑记录子命令（独立于迁移主流程，仅做 records 管理）
    # Read: $MIGRATION_DIR/commands/records.md
    # FEATURE_ARG 此时是 records 的 SUBCOMMAND(list/load/add/update/remove) + 参数
    ;;
  *)
    # 全流程模式：$ARGUMENTS 视为功能名
    FEATURE_ARG="$ARGUMENTS"
    # 依次执行 analyze → spec → plan → execute → verify → finalize
    # 每步读取 $MIGRATION_DIR/commands/<step>.md 执行
    # 每步完成后提示 "🔄 继续进入 <下一步> 阶段？(Y/N)"
    ;;
esac
```

**子命令文件路径**：`$MIGRATION_DIR/commands/<subcmd>.md`

---

## 全流程引导

当进入全流程模式时，按固定顺序执行：

```
analyze → spec → plan → execute → verify → finalize
```

每步完成后：
1. 输出该步骤的产出摘要
2. 提示 `🔄 继续进入 <下一步> 阶段？(Y/N)`
3. Y → 读取下一步子命令文件继续
4. N → 停止，用户可后续通过独立子命令继续

---

## 项目级数据流

```
analyze:  读 sodex-web Context（旧架构分析）、读 sodex-next pitfall（已知坑点）
          + 读 kit/migration/records/index.md（跨迁移方法论坑，kit 级）
spec:     读 sodex-web Context + sodex-next references（生成迁移规范）
plan:     读 sodex-next pitfall + reusable（计划阶段）
execute:  读 sodex-next migration-references（实现参考）
verify:   末尾聚合本次问题到 migration-records-candidates.md（供 finalize 分流）
finalize: 写 sodex-next Context + history + (records | pitfall)（三层分流）
```

通过 `PROJECT_NAME` 环境变量切换项目，现有命令行为不变。

---

## Records 子命令（跨迁移方法论坑）

与 pitfall 的关系：**独立**。

| | pitfall | records |
|---|---|---|
| 归属 | 项目级（PROJECT_NAME 隔离） | kit 级（跨项目） |
| 内容 | 项目业务坑 | 迁移工具方法论坑 |
| 查询入口 | `/k/context-pitfall` | `/k:migration records` |

详见 `kit/migration/commands/records.md`。
