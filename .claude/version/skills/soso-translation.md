---
module: soso-translation
type: skills
version: 1.0.0
released: 2026-05-30
versioning: semver
status: active
source: .claude/skills/soso-translation/
---

# Changelog

所有 soso-translation Skill 的重要变更都会记录在此文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

---

## [1.0.0] - 2026-05-30

合并 `soso-translation-auto`（sodex-web）+ `soso-translation-next`（sodex-next）为单一通用 skill，并实现完全自包含与通用化。

### 新增

- **单 skill 通用化**：替代旧的两个项目专用 skill，适用 sodex-web / sodex-next / exp-ads-feature 等任意带 locales 目录的项目（含 monorepo 多 app）。
- **完全自包含，零项目脚本依赖**：主翻译 API（SosoValue Gemini）、`shouldKeepText`、Google fallback、目标语言探测全部内联，不再 require 项目 `scripts/i18n/*` 或调用 `pnpm i18n` / `soso-i18n` CLI。根因：exp-ads-feature 无 `scripts/i18n/*`（改用外部包），旧 skill 在其上直接报错。
- **配置驱动布局 + 自愈探测**（`resolve-config.cjs`）：
  - 配置存 soso-kit 源仓 `skills/soso-translation/projects/<项目名>.json`（看得见、可管理、活过 `sosokit-install` 的 rm -rf 重拷）
  - 反查源仓根（`sosokit-install` 软链）+ 按 git 主仓 basename 识别项目
  - 配置缺失自动探测目录布局并落盘；`--reinit` 强制重探
  - 目标语言不入库，每次扫 `localesDir` 子目录（适配各项目/各 app 语言集差异）
- **`sync-keys.cjs`**：自包含同步 key 结构（替代 `pnpm i18n --sync-by-en`），支持 `--all` / `--prune`。
- **并发翻译**（`translate-keys.cjs`）：有界并发池（默认 5，`--concurrency N` 可调），60 条约 12s（旧串行约 50-60s），约 5 倍提速；写阶段串行、每文件写一次，结构性免竞态。
- **同源去重**：`(lang, enValue)` 相同的合并为单一翻译任务，结果回填所有共享 key，省去重复 API 调用。
- **周期纯文本进度**：TTY / 非 TTY（AI 调用）通用，不再用 `\r` 帧动画刷屏。

### 继承

- 三层 fallback：主 API → Google → 英文兜底；同源检测 + 字符集校验 + `{{var}}` 占位符保护
- `scan-untranslated.cjs` 三类盲区检测（logic return / JSX 文本节点 / 静态常量 label），去掉对项目 `config.cjs` 的依赖、IGNORE 规则内联
- glossary 用 sodex-next 超集（含 Buy/Sell、订单类型/状态）

### 已知局限

- glossary / whitelist 不接入自动翻译器（术语一致性靠 AI 人工校正）
- scan 正则召回有限（漏文本节点内嵌 `{变量}` 的混合 JSX）
- 主 API key 硬编码（轮换时静默退 Google）
- 项目识别依赖 git 主仓 basename；非 git / 名称不一致的新项目需手动对齐配置文件名

---

## 版本说明

| 版本 | 主要特性 |
| ---- | -------- |
| 1.0.0 | 合并双 skill；完全自包含；配置驱动 projects/；并发 + 去重 + 通用进度 |
