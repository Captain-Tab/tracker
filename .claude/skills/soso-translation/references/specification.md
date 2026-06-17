# 翻译完整性 / 正确性检查规范

> sodex-next 已有完整的 i18n 检查体系，本 skill **不重复维护规则**，统一接入下方流程。

---

## 最终验收：`/check-i18n`

PR 提交前必跑。规则、模块划分、报告模板、索引格式全部维护在：

- 检查规则 SSOT：[`docs/i18n-check.md`](../../../../docs/i18n-check.md)
- 触发命令（任选其一）：
  - Claude Code 内：`/check-i18n`
  - 命令行：`pnpm i18n:auto_check`
- 输出位置：`.i18n-check/<module>.md` + `.i18n-check/README.md`（汇总索引）
- 范围：`git diff origin/main...HEAD` ∪ `git diff` ∪ `git diff --cached` 去重后的全部 i18n 改动

---

## 编辑当下：`scan-untranslated.cjs`

skill 自带的轻量本地自检，速度快、零成本，但**召回有限**（正则不懂 AST），仅作为编辑流程的"预警"，不能替代 `/check-i18n`。

```bash
node .claude/skills/soso-translation/scripts/scan-untranslated.cjs <file_or_dir>
```

覆盖：
- sonner `toast.{success,error,info,warning,loading,promise}` 调用裸字符串
- 包装 `notify.{success,error,warning,loading}` 调用裸字符串
- JSX 属性白名单（title / desc / placeholder 等，复用 `scripts/i18n/config.cjs` `TRANSLATABLE_JSX_ATTR_NAMES`）
- 三元表达式中的硬编码英文短句
- Modal `options.title / options.description` 字面量

---

## 翻译前置约束（生成 / 修改翻译时必读）

1. **glossary**：[`./glossary.md`](./glossary.md) 中规定译法的术语**必须使用规定译法**，不可自行翻译
2. **whitelist**：[`../scripts/whitelist.cjs`](../scripts/whitelist.cjs) 中的词汇**保持原文不翻译**
3. **时间范围 / 数值单位**：按 glossary 规定翻译
4. **`{{variable}}` 插值占位符**：保持完整不翻译
5. **HTML 标签**（`<span>`、`<b>` 等）：保持完整不翻译

---

## 检查报告格式（流程 A / B 末尾必须输出给用户）

```markdown
## 翻译检查报告

**扫描范围**：<file_or_dir>
**扫描结果**：✅ 无遗漏 / ⚠️ 发现 N 处

| Line | 场景 | 内容 |
|------|------|------|
| 45   | sonner toast | "Loading..." |
| 78   | JSX placeholder | "Enter amount" |
```

PR 前再跑一次 `/check-i18n` 做最终验收。
