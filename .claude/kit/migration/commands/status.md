# Migration Status: 查看迁移进度

## 流程

### 1. 执行进度脚本

```bash
bash "$KIT_ROOT/.claude/kit/migration/scripts/migration-status.sh" "$KIT_ROOT/.claude/kit/migration/migration-state.json"
```

### 2. Token 消耗展示

如果 migration-state.json 中有 tokenEstimates，额外输出：

```
📊 已消耗 Token 估算：
  analyze:  ~XXXX tokens  ✅
  spec:     ~XXXX tokens  ✅
  plan:     ~XXXX tokens  🔄
  execute:  待执行
  verify:   待执行
  finalize: 待执行
  已消耗:   ~XXXXX tokens
```

---

## Token 估算

本命令无 token 消耗估算（仅查询，不产出）。
