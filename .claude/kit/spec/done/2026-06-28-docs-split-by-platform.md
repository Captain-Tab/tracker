# Spec: docs 按平台拆分（sodex / hype）

## 背景与目的

`docs/` 下多数功能文档目前以 sodex 视角为主体、hype 用零散小节占位（共用一份）。随 `service/sodex-*` 与 `service/HYPE-*` 独立同构演进，两边 API/字段/算法差距将拉大，混在一份文档会越来越难维护。

目的：把**功能方案文档**按平台拆为 sodex / hype 两份；**基建/通用文档保持共用**。延续已有先例 `api-confidence/{sodex,hype}.md` 的"功能子目录内分平台文件"模式。

## 选定方案

判断原则：
- **基建是一份**（一套 VPS、一个 `app` 编排生成 `sodex-*`+`HYPE-*` 六个 systemd 单元）→ 文档共用，不拆。
- **功能实现是两份**（独立同构代码）→ 功能方案文档随实现拆，且**只拆 hype 侧已有实现的功能**（避免空壳）。

组织约定：功能子目录内按平台分文件（`docs/<feature>/{sodex,hype}.md`）；update-log 保单线；copy-trade-blueprint 归 hype。

## 设计概要

### 目标结构

```
docs/
  api-confidence/  {sodex.md, hype.md}     ← 已存在，不动（样板）
  watch/           {sodex.md, hype.md}     ← 拆自 watch-account-plan.md
  discovery/       {sodex.md, hype.md}     ← 拆自 discover-traders-plan.md
  coin-profile/    {sodex.md, hype.md}     ← 拆自 coin-profile.md
  query/           {sodex.md}              ← 移自 query-account.md（仅 sodex，hype 无实现）
  hype/copy-trade-blueprint.md             ← 移自 copy-trade-blueprint.md（归 hype）
  ── 基建/通用：根级保持不动 ──
  server-architecture.md  systemd-setup.md  deploy-commands.md
  warp-guide.md  principles/*  update-log.md
```

### 拆分动作与内容切分

| 源文件 | 动作 | 切分/修正 |
|--------|------|-----------|
| `watch-account-plan.md` | git mv → `watch/sodex.md`；新建 `watch/hype.md` | sodex REST/字段映射归 sodex；hype clearinghouseState/userFills 字段归 hype（参考 HYPE-watch 实现） |
| `discover-traders-plan.md` | git mv → `discovery/sodex.md`；新建 `discovery/hype.md` | §十"HYPE 按币种画像"段**移出**（归 coin-profile/hype）；discovery/hype.md 写 HYPE-discovery 发现系统（已实现） |
| `coin-profile.md` | git mv → `coin-profile/sodex.md`；新建 `coin-profile/hype.md` | §六"待实现"**修正为已实现**（HYPE-discovery/profile.mjs 已落地）；合并 discover §十 的 HYPE 画像内容，去重 |
| `query-account.md` | git mv → `query/sodex.md` | 不建 hype.md（HYPE 无 query 工具）；标注"hype 待实现时再加" |
| `copy-trade-blueprint.md` | git mv → `hype/copy-trade-blueprint.md` | 整体移动 |
| 基建 5 类 + principles + update-log | 不动 | sodex 专属示例就地标注"HYPE 对称同构" |

### 交叉引用更新

- `server-architecture.md` 引用 `copy-trade-blueprint §10.7` → 更新路径为 `hype/copy-trade-blueprint.md`。
- `coin-profile.md`/`discover-traders-plan.md` 互引、引用 spec 路径 → 拆后更新。
- 全库 grep `coin-profile.md` / `watch-account-plan.md` / `discover-traders-plan.md` / `query-account.md` / `copy-trade-blueprint.md` 旧路径并更新（含 `.claude/`、`CLAUDE.md`、其它 docs）。

## 边界与约束

**包含：** watch / discovery / coin-profile 拆双平台；query 移 sodex 单份；blueprint 归 hype；交叉引用更新；coin-profile "待实现"过时表述修正；§六/§十 HYPE 画像去重。

**不包含：**
- 基建/通用文档（server-architecture / systemd-setup / deploy-commands / warp-guide / principles）的拆分；
- update-log 拆分（保单线）；
- 任何 `service/` 代码改动（纯文档重构）；
- 为 hype 未实现功能（query）建正文文档。

**已知限制：**
- query/ 下暂只有 sodex.md，目录单文件略显单薄——可接受，待 hype query 实现再补。
- 一份拆两份时 git mv 只能保其中一份的历史；新建的 hype 版无历史（内容来自原文档 hype 小节 + 代码）。

## 集成点

- 移动/新建：`docs/watch/`、`docs/discovery/`、`docs/coin-profile/`、`docs/query/`、`docs/hype/` 下文件。
- 引用更新：`docs/server-architecture.md`、可能的 `CLAUDE.md` / `.claude/**`、其它 docs 内交叉链接。

## 验收标准

- [ ] `docs/watch/{sodex.md,hype.md}` 存在；原 `watch-account-plan.md` 不再存在。
- [ ] `docs/discovery/{sodex.md,hype.md}` 存在；原 `discover-traders-plan.md` 不再存在。
- [ ] `docs/coin-profile/{sodex.md,hype.md}` 存在；hype.md 表述为"已实现"（无"待实现"字样）。
- [ ] `docs/query/sodex.md` 存在；无 `docs/query/hype.md`；原 `query-account.md` 不再存在。
- [ ] `docs/hype/copy-trade-blueprint.md` 存在；原根级 `copy-trade-blueprint.md` 不再存在。
- [ ] 基建/通用文档（server-architecture / systemd-setup / deploy-commands / warp-guide / principles / update-log）路径不变、内容未误删。
- [ ] §六/§十 HYPE 按币种画像内容不再重复（仅存于 coin-profile/hype.md）。
- [ ] 全库无残留指向旧路径的链接：`grep -rn` 旧文件名（排除 spec 自身）零命中或已更新。
- [ ] `service/` 目录零改动（`git diff --stat` 不含 service）。

## 验收场景

### 场景 1：功能文档已拆双平台（Happy Path）
- **Given** 拆分前 `docs/watch-account-plan.md` 单文件存在（24 处 sodex / 1 处 hype）
- **When** 执行拆分动作
- **Then** `docs/watch/sodex.md` 与 `docs/watch/hype.md` 均存在，原单文件消失，`git log --follow docs/watch/sodex.md` 能看到原文件历史

### 场景 2：query 不拆 hype（避免空壳）
- **Given** `service/` 下仅 `sodex-watch/query.mjs` 存在、无 HYPE query 工具
- **When** 处理 `query-account.md`
- **Then** 仅生成 `docs/query/sodex.md`，**不**生成 `docs/query/hype.md`

### 场景 3：coin-profile 过时表述修正
- **Given** 原 `coin-profile.md §六` 写"HYPE 对称扩展（待实现）"，但 `HYPE-discovery/profile.mjs` 已实现
- **When** 生成 `docs/coin-profile/hype.md`
- **Then** 文档表述为已实现（指向 `HYPE-discovery/profile.mjs`），无"待实现"字样

### 场景 4：交叉引用无残留
- **Given** `docs/server-architecture.md` 等引用了旧文件名 `copy-trade-blueprint.md` 等
- **When** 拆分完成后全库 `grep -rn` 旧路径（排除本 spec）
- **Then** 零命中，或所有命中均已更新为新路径

### 场景 5：基建文档与代码零误伤
- **Given** 基建文档（server-architecture 等）和 `service/` 代码不在拆分范围
- **When** 拆分完成
- **Then** `git diff --stat` 中基建文档仅交叉引用行变化、`service/` 零改动
