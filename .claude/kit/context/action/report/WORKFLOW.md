---
description: 生成 Context 健康报告（零 token：纯 bash 脚本）
---

# Report: Context 健康报告

扫描项目 context library，输出四个维度的健康状态，全程无 AI 分析，零 token 消耗。

**输出内容：**
- **Features** — 所有 feature 更新日期 + 过期状态（stale / aging / fresh）
- **高风险共享文件** — 被多个 feature 引用的文件，改动时需注意影响范围
- **最近活动** — recentQueue 最近 5 条变更记录
- **模块覆盖** — 各模块 feature 数量，标注空模块

---

## 执行

使用 Bash 工具（单次调用）：

```bash
dir=$(pwd); KIT_ROOT=""; for i in 1 2 3 4 5; do [ -d "$dir/.cursor/kit/context/library" ] && KIT_ROOT="$dir" && break; dir="$(dirname "$dir")"; done && cd "$KIT_ROOT" && source .cursor/kit/context/context-lib.sh && bash .cursor/kit/context/action/report/scripts/report.sh
```

展示完整输出，结束。

---

## 状态说明

| 标记 | 含义 |
|---|---|
| ✅ fresh | 14 天内更新 |
| ⏰ aging | 15–30 天未更新 |
| ⚠️ stale | 超过 30 天未更新，建议执行 `/k/context-audit <id>` |
| ❓ no date | 缺少 updated 字段 |
