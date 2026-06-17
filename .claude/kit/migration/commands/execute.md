# Migration Execute: 逐步实现

## 流程

### 1. 读取 migration-plan

读取 `migration-plan-<功能ID>.md`。

### 1.5 先查新项目参考实现（编码前必做）

在开始任何 UI 交互 / 状态管理 / auth 流程的编码之前，**先搜索新项目中是否已有相似模式**：

```bash
# 搜索示例：Enable Trading 相关
grep -rn "enableTrading\|useEnableTrading\|Enable.*Trading" src --include="*.tsx" --include="*.ts" -l

# 搜索示例：Dialog 相关模式
grep -rn "openModal\|openResponsive\|ModalInjectedProps" src --include="*.tsx" -l
```

**规则**：
- 找到参考 → 直接对齐，**不自己推断实现方式**，记录参考文件路径到 plan
- 没找到 → 读老项目对应代码后再实现
- 常见可复用模式位置：
  - Enable Trading → `src/features/trade/containers/useEnableTrading.ts`
  - Dialog 按钮状态 → `src/features/vault/components/dialogs/VaultWithdrawDialog/VaultWithdrawButton.tsx`
  - Mutation toast 时序 → `src/features/vault/containers/useSubmitVaultDeposit.ts`
  - Auth 闸门 → `src/features/auth/components/AuthStepsModal/index.tsx`

> **跳过此步的代价**：反复猜测正确实现方式，同一问题修复 3-5 次。

### 1.6 Debug 触发规则（修复失败时）

| 情况 | 动作 |
|------|------|
| 第一次修复后仍复现 | 重新分析根因，检查是否有其他层问题 |
| **第二次修复后仍复现** | **强制执行 `/k:debug-on` 插桩**（完成后运行 `/k:debug-off` 清理），禁止继续猜测 |
| 涉及时序/并发/状态批量更新 | 直接 `/k:debug-on`（完成后 `/k:debug-off` 清理），不尝试盲改 |

> 同一问题第二次修复失败 = 根因判断有误，必须用数据说话。

### 2. 场景化参考文档条件加载（PROJECT_NAME=sodex-next）

```bash
REFS_DIR="$KIT_ROOT/.claude/kit/context/library/sodex-next/migration-references"
```

根据 plan 步骤内容按需加载：

| plan 步骤涉及 | 加载文件 |
|--------------|---------|
| catch/error/toast | `$REFS_DIR/error-handling.md` |
| WS/subscribe/stream | `$REFS_DIR/websocket.md` |
| sign/wallet/approve | `$REFS_DIR/wagmi.md` |

不涉及则不加载，每份 ~200-400 tokens。

### 2.5 Signing 参数对照表（plan 含 sign/wallet/approve 时必做）

涉及钱包签名 / CallForPermit / API 提交的步骤，**编码前**先建对照表，逐字段与老项目核对：

| 字段 | 老项目值 | 新项目值 | 核对结论 |
|---|---|---|---|
| ERC-2612 permit `spender` | 读老项目 | 待填 | ✅/❌ |
| CallForPermit typed data `to` | 读老项目 | 待填 | ✅/❌ |
| CallForPermit API request `to` | 读老项目 | 待填 | ✅/❌ |
| `cmdType` 字符串 | 读老项目 | 待填 | ✅/❌ |
| `cmdData` ABI 编码参数顺序 | 读老项目 | 待填 | ✅/❌ |
| `verifyingContract` | 读老项目 | 待填 | ✅/❌ |

**规则**：
- 表中任一字段不一致 → 编码前先确认正确值，不允许直接沿用"看起来合理"的常量
- 常量容易混淆（如 `CALL_FOR_PERMIT_ADDRESS` / `VAULT_CALLER_ADDRESS` / `SLP_TOKEN_ADDRESS`）：必须追溯到老项目的实际 address 值做等价对比，不能仅凭命名推断
- 产出写入 `logs/<featureId>/signing-checklist.md`，供 verify 阶段 CHK-A7 之前检查

### 3. 调用 /k/task 逐步执行

按 plan 中的步骤顺序执行。每步完成后更新进度。

### 3.5 生成后注释扫描（每步完成后必做）

每个 /k:task 步骤产出代码后，立即扫描新增/修改文件：

```bash
grep -rn "老项目\|旧代码\|方案 [A-Z]\|对齐老\|history 2[0-9]\{7\}\|L[0-9]\{2,4\}:\|注意:老\|迁移自" \
  <新增/修改的文件> --include="*.ts" --include="*.tsx" 2>/dev/null
```

**命中则立即修改**：
- 只删注释中的来源引用词（文件名:行号、方案代号、history 日期）
- 保留注释的 WHY 内容，不删整条注释
- 删完后若整条注释无实质内容则删除整行

### 4. 更新 migration-state.json

---

## Token 估算

步骤完成后，估算本步 token 消耗并写入 migration-state.json.tokenEstimates.execute：

```
inputChars = plan 文档 + references（如加载）+ 代码读取
outputChars = 生成代码字符数
estimatedTokens = (inputChars + outputChars) / 4
```

预期范围：~2000-5000 tokens（取决于功能复杂度）
