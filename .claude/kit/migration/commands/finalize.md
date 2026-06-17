# Migration Finalize: 入库 + 提炼记录 + 清理

## 流程

### 1. 确认 sodex-next Context 已入库（PROJECT_NAME=sodex-next）

检查是否已有该功能的 Context 文档：
- 有 → 继续
- 无 → 执行 `/k/context-learn`

### 2. 从临时文件提炼迁移记录

读取各阶段产出，提取关键信息写入 sodex-next history：

| 读取文件 | 提取内容 |
|---------|---------|
| analyze 产出 | 旧架构摘要、关联功能 |
| spec 产出 | 迁移方案、Endpoint 清单、Breaking Changes |
| plan 产出 | 新旧文件映射、架构映射 |
| verify/debug 过程 | 遇到的问题及解决方式 |

合并生成迁移记录，PROJECT_NAME=sodex-next 写入 history：
- 类型: migration
- 内容: 旧架构摘要 + 迁移方案 + 新旧映射 + 问题及解决方式 + 关键决策

### 3. 踩坑分流（三层归档）

**数据源**：verify Step 4.5 产出的 `logs/<featureId>/records-candidates.md`。

- 文件不存在（verify 无候选） → 跳过本步
- 文件存在 → 逐条展示给用户，用户做分流决策

**流程**：

1. 读取 `records-candidates.md`
2. 对每条候选输出交互块：

   ```
   ─────────────────────────────
   候选 #N: <问题摘要>
     发生阶段: <阶段>
     相关文件: <文件列表>
     AI 推荐: <records | pitfall | history | skip>
     推荐理由: <一句话>
   
   操作:
     [a] records add  — 跨迁移方法论坑（kit 级）
     [p] pitfall add  — 项目通用写代码坑
     [h] history only — 本次具体，不升级
     [s] skip         — 丢弃
     [e] edit         — 改标题/tag 再决定
   
   请输入 a/p/h/s/e:
   ```

3. 按用户输入执行：
   - `a` → 进入 `/k:migration records add` 流程，预填候选内容
   - `p` → 进入 `/k/context-pitfall add` 流程（PROJECT_NAME=sodex-next）
   - `h` → 不额外写文件（候选内容已在 Step 2 写入 history）
   - `s` → 跳过
   - `e` → 让用户改完 id/tag/摘要再回到本条交互

4. 全部处理完，删除 `records-candidates.md` 临时文件

**设计**：
- AI 只推荐不落盘 → 决策权在用户
- 每条独立交互 → 避免整批误判
- dry-run 式 → 用户不回复 Y 不落盘

### 4. 清理临时文件

- 删除 `migration-analyze-<功能ID>.md`
- 删除 `migration-spec-<功能ID>.md`
- 删除 `migration-plan-<功能ID>.md`
- migration-state.json 中移除该功能条目

### 5. Token 汇总输出

从 migration-state.json 的 tokenEstimates 汇总所有步骤：

```
📊 Token 消耗估算：
  analyze:  ~XXXX tokens
  spec:     ~XXXX tokens
  plan:     ~XXXX tokens
  execute:  ~XXXX tokens
  verify:   ~XXXX tokens
  finalize: ~XXXX tokens
  合计:     ~XXXXX tokens
```

### 6. 完成输出

```
✅ <功能ID> 迁移完成

📊 Token 消耗估算：[汇总]
📁 sodex-next Context：已入库
📝 迁移记录：已写入 history
📌 Records（kit 级）：[已录入 N 条 / 无]
⚠️ Pitfall（项目级）：[已录入 N 条 / 无]
🗑️ 临时文件：已清理
```

---

## Token 估算

步骤完成后，估算本步 token 消耗并写入 migration-state.json.tokenEstimates.finalize：

```
inputChars = 各阶段产出摘要 + context-learn 读取
outputChars = history 记录 + pitfall 记录
estimatedTokens = (inputChars + outputChars) / 4
```

预期范围：~800-1300 tokens
