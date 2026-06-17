# Migration Verify: 架构验证 + 行为验证

## 流程

### 1. 标准检查

执行 `/k/check`（现有 18 项清单）

### 2. 架构专属检查（6 项）

```bash
bash "$KIT_ROOT/.claude/kit/migration/scripts/verify-arch.sh" "<新功能目录>"
```

检查项：
- CHK-A1: Import 方向（UI 不 import services/infra）
- CHK-A2: 旧代码残留（不 import 旧 MobX Store）
- CHK-A3: 数据转换位置（normalize 在 domain/ 下）
- CHK-A4: 文件命名（符合命名契约）
- CHK-A5: 导出合规（feature index.ts）
- CHK-A6: TODO 扫尾门禁（feature 内无 TODO/FIXME/XXX/HACK 残留）
- CHK-A7: 注释迁移痕迹扫描
- CHK-A8: Signing 参数对照表完整性（功能含钱包签名时）
  - 检查 `logs/<featureId>/signing-checklist.md` 是否存在
  - 表中所有字段核对结论均为 ✅，无 ❌ 或空白
- CHK-A9: Retry 行为验证（**功能含 retry 逻辑时才触发**）
  - 判断条件：plan/spec 中出现 retry、Try Again、重试、失败恢复等关键词，或老项目存在失败后就地重试的 UI
  - 验证矩阵（每种错误类型逐行确认）：

    | 错误类型 | 用户能否就地重试 | 重试时是否跳过已完成步骤 | 与老项目一致 |
    |---|---|---|---|
    | USER_REJECTED | □ | □ | □ |
    | NETWORK / API 错误 | □ | □ | □ |
    | 其他 UNKNOWN | □ | □ | □ |

  - **关键规则**：`shouldShowRetry` 的触发范围必须与老项目对齐——若老项目对所有错误均可就地重试，新项目不能只开放 USER_REJECTED

```bash
grep -rn "老项目\|旧代码\|方案 [A-Z]\|对齐老\|history 2[0-9]\{7\}\|L[0-9]\{2,4\}:\|注意:老\|迁移自" \
  <功能目录> --include="*.ts" --include="*.tsx" 2>/dev/null \
  && echo "❌ CHK-A7 fail: 注释含迁移痕迹，执行 3.5 清理后重验" \
  || echo "✅ CHK-A7 pass"
```

### 3. 行为验证清单

提示用户手动确认：

```markdown
请确认以下项目：
□ 核心路径可走通
□ 边界情况正确（余额不足、金额为 0 等）
□ 错误处理正确（网络错误 → toast、签名拒绝 → 静默关闭）
□ 与老项目 UI 显示一致（特别是精度）
□ API 请求参数与老项目一致
□ 字段溯源表逐条对照（analyze 报告 §字段溯源表）：每个 UI 字段的数据来源（chain/api/store/derived）与老项目一致，特别检查 decimals 是否动态读取
□ Context 规则消费清单逐条对照（analyze 报告 §Context 规则消费清单）：
  - **implement 项**：UI 产物列的每一项单独勾选(一条规则对应 N 个产物要分别查 N 个)
  - **defer / skip 项**：followUp 列必须指向 `kit/migration/pending.md` 条目或有效 issue/TODO 锚点；空白或 "后续补" 等占位视为不合格
  - **pending.md 一致性**：本 feature 所有 `defer` 条目已追加到 `kit/migration/pending.md`(grep `<featureId>-` 确认存在)
```

### 4. 问题处理

如有问题 → 提示 `是否执行 /k:debug-on 进行调试？（完成后用 /k:debug-off 清理）`

### 4.5 聚合本次问题到 records candidates（供 finalize 分流）

从 migration-state.json 的 `problems[]` / debug 会话记录 / 架构检查 fail 项中，聚合本次迁移遇到的**所有问题**，不做判断，只做机械收集：

```bash
# 输出文件（finalize 读取，不持久化）
CANDIDATES_FILE="$KIT_ROOT/.claude/kit/migration/logs/<featureId>/records-candidates.md"
```

候选文件格式：

```markdown
# Records Candidates for <featureId>

> 本次迁移发现的问题集合，finalize 阶段由用户逐条分流到 history / records / pitfall。

## 候选条目

### 候选 #1
- **问题摘要**: <一句话描述>
- **发生阶段**: analyze | spec | plan | execute | verify
- **相关文件**: <文件路径列表>
- **修复方式**: <已修复方式，若有>
- **AI 推荐分流**: records | pitfall | history | skip
- **推荐理由**: <一句话>

### 候选 #2
...
```

**只聚合不判断**：AI 推荐分流作为参考信号，最终决策在 finalize 由用户完成。

### 5. 更新 migration-state.json

---

## Token 估算

步骤完成后，估算本步 token 消耗并写入 migration-state.json.tokenEstimates.verify：

```
inputChars = check 清单 + verify-arch 输出 + 代码读取（如 debug）
outputChars = 检查报告字符数
estimatedTokens = (inputChars + outputChars) / 4
```

预期范围：~500 tokens（无 debug）/ ~3500 tokens（含 debug）
