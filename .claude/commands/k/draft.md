---
description: 生成需求草稿骨架 md（feature/bug/ui/api/complex），省去手动新建文件，直接在上面写
---

# /k:draft — 需求草稿骨架生成

一条命令生成结构化空骨架 markdown，放进 `.claude/kit/spec/`，你直接在上面写，填完丢给 `/k:spec`。

## 执行

**必须用 Bash 实跑下面命令**，由脚本按 type 生成文件，不要自己拼 markdown：

```bash
bash "$(git rev-parse --show-toplevel 2>/dev/null || pwd)/.claude/kit/draft/scripts/draft-create.sh" $ARGUMENTS
```

## 类型

| 用法 | 产物 |
|---|---|
| `/k:draft feature <名>` | 单文件 · 核心流程/业务逻辑 |
| `/k:draft bug <名>` | 单文件 · bug 修复 |
| `/k:draft ui <名>` | 单文件 · UI 开发/调整 |
| `/k:draft api <名>` | 单文件 · API 对接 |
| `/k:draft complex <名>` | 三文件 · 核心流程 + UI + API（对标 airdrop），进 `spec/<名>/` |

> type 必须显式；缺 type 或缺名字 → 脚本回显用法，停下等用户重输。

## 按输出处理

- `CREATED:<path>` → 列出已生成文件，提示用户「可手动改名 / 直接编辑」。
- `ALREADY_EXISTS:<path>` → 告知已存在、未覆盖，让用户决定改名或编辑现有文件。
- 用法列表（参数为空/错）→ 原样展示，停下等重输，不擅自挑一个执行。

> 只生成空骨架，**不预填、不校验**。骨架里的 ★必填 / ○可选 是提示，留空也合法——填多少给多少，downstream `/k:spec` 自动补。

## 更新骨架模板

骨架内容是独立 markdown 文件（仿 `/k:cp` 机制），命令只负责复制 + 替换 `<SLUG>`：

| 模板文件 | 用于 |
|---|---|
| `.claude/kit/draft/templates/core.md` | feature 单文件 / complex 的核心文件 |
| `.claude/kit/draft/templates/ui.md` | ui 单文件 / complex 的 UI 文件 |
| `.claude/kit/draft/templates/api.md` | api 单文件 / complex 的 API 文件 |
| `.claude/kit/draft/templates/bugfix.md` | bug 单文件 |

要改骨架直接编辑对应 `.md` 即可，无需动脚本。文件里写 `<SLUG>` 会在生成时被替换成实际名字。
