---
module: sodex-auto-satrack
type: skills
version: 1.1.0
released: 2026-06-08
versioning: semver
status: active
source: .claude/skills/sodex-auto-satrack/
---

# Changelog

所有 sodex-auto-satrack Skill 的重要变更都会记录在此文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

---

## [1.1.0] - 2026-06-08

把「可确定性化的自检」从人工 checklist 升级为机器门禁脚本，并补齐多条落地规则。

### 新增

- **契约 lint 脚本** `scripts/lint-track.mjs`（无依赖 node）：4 类纯静态校验——
  ① 列契约（每个 `track()` payload key ∈ AllowedColumn = sample.json 列 − SystemColumn；比 tsc 强，覆盖变量转发情形）
  ② 内联字面量（禁止 `track(name, 具名变量)` 转发，防绕过 excess-property check）
  ③ manifest 计数（文件顶部「· N 事件」== 实际事件数）
  ④ 文档同步（events/*.ts 事件名都出现在 `docs/track-events-inventory.md`）。
- **机器门禁段**：SKILL.md 新增「机器门禁」章节 + verify.sh 集成说明，4 条对应人工自检项标注为脚本自动校验。
- **强制同步 inventory 规则**：增/改/删事件后必须同步 `docs/track-events-inventory.md`（§0 目录 + 模块表），与 events manifest 两处一致。
- **`$` 前缀防误用规则**：带 `$` 的列名落地前必须在 sample.json 确认存在，否则用无 `$` 业务列（教训：`feeds_share_click` 曾用不存在的 `$channel`）。
- **内联字面量规则**：helper 内 `track()` payload 必须写内联对象字面量，禁止转发 params 变量。

### 变更

- **连钱包/Enable 全局事件改两级维度**：`{ sceneName, evtFrom }`（模块归 sceneName、入口归 evt_from，不再把模块塞进 evt_from 前缀）。
- **保留词守卫**：`sceneName=global` 专指全局 Header；`evt_from=header` 仅全局/页面级 header；feature 顶部区用 `top`。
- **`sodex_connect_wallet_click` 仅专属连钱包入口触发**：动作按钮（Deposit/Transfer/Withdraw/Swap）未连钱包的兜底跳连钱包不埋。

### 配套（项目侧，非 skill 文件）

- `.claude/kit/check/verify.sh`：调用 lint 脚本，接入 `/k:check` MECHANICAL 闸门（gitignored，本地态）。
- `docs/track-events-inventory.md`：全模块埋点盘点文档（37 事件），从 gitignored 的 kit/spec 迁入可入库的 docs/。

---

## [1.0.0] - 2026-06-04

初始版本（commit `5a32a579 feat(skill): add sosokit-auto-satrack`）。

### 新增

- 结构化埋点候选清单生成器：扫模块交互点 → 追 handler 调用链 → 套「后端盲区」启发式打【候选】/【存疑】倾向 → 起 snake_case 事件名 + 从可见变量推 payload。
- 命名规范模板 `sodex_<surface>_[qualifier_]<action>`；事件 helper 落 `shared/track/events/<module>.ts` 一模块一文件 + 顶部「埋点清单」注释表。
- 字段对照 `sensors-event-schema.sample.json` 单一事实源；字段缺口给「复用通用列 / 建议数据团队加列」两条路，禁臆造列名。

---

## 版本说明

| 版本 | 主要特性 |
| ---- | -------- |
| 1.1.0 | 契约 lint 脚本 + 机器门禁；两级维度 + 保留词守卫；$channel/内联/文档同步规则 |
| 1.0.0 | 初始：候选清单生成器 + 命名规范 + 字段字典对照 |
