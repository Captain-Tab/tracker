# Spec 04 · app/ systemd 编排扩展（Phase 3）

> 引用总纲 `00-overview.md`。单元命名见 §3.5，集成点见 §5，NFR 错峰见总纲 NFR。冲突以总纲为准。
> 依赖：01 + 02 + 03 **本地测试通过后**才做。落地直接 `/k:task`。

## 背景与目的

把 HYPE-watch / HYPE-discovery 纳入 `app/` systemd 编排，上 VPS。沿用现有 `render/apply/status` 三命令 + config 开关 + 幂等 + 旧单元迁移机制。

## 选定方案

扩 `app/index.mjs`：
- `buildUnits` 增 `HYPE-watch.service`（`Type=simple` 长驻）+ `HYPE-discovery.service`（oneshot）+ `HYPE-discovery.timer`。
- config schema 增 `HYPE-watch.{enabled}` / `HYPE-discovery.{enabled,schedule}`。
- 单元改名迁移：旧 `watch.service`→`sodex-watch.service`（01 已在 OLD_WATCH_UNIT 链处理；此处确认 apply 迁移不双开）。

## 设计概要

### NFR 错峰（总纲硬约束）
`HYPE-discovery.timer` 与 `sodex-discovery.timer` 的 OnCalendar **设不同时刻**（如周一 9 点 / 周一 10 点），永不重叠，避免两个大解析 + 两 Node 进程叠加逼近 700MB+。

### 复用
现有 `scheduleToOnCalendar`、warp 依赖注入（`warpDeps`/`envLines`）、幂等 apply（仅内容变才 restart）全部复用。

## i18n 文案

无。

## 边界与约束

- 包含：4 模块单元生成 + config 开关 + 错峰调度 + 旧单元迁移。
- 不包含：跟单相关单元；本地测试未过不进本阶段。

## 集成点

- `service/app/index.mjs:82-114`（buildUnits/各 Unit 函数）、`:26-63`（config schema）、`:21`（迁移链）。
- `setup/Makefile`、`setup/setup-systemd.sh`（如需加 HYPE logs/status 目标）。

## 验收标准

- [ ] `node service/app/index.mjs render` 含 `sodex-watch.service`+`sodex-discovery.timer`+`HYPE-watch.service`+`HYPE-discovery.timer`，OnCalendar 两 discovery 不同时刻。
- [ ] config 关 `HYPE-watch.enabled=false` → render/apply 该单元 disable。
- [ ] VPS `app apply` 迁移旧 `watch.service` 不双开；幂等（无变更不 restart）。

## 验收场景（Given/When/Then）

### 场景 1：四模块单元正确 + 错峰
- **Given** 01/02/03 本地通过，app/config 四模块均 enabled，sodex-discovery 周一 9 点、HYPE-discovery 周一 10 点
- **When** `node service/app/index.mjs render`
- **Then** 输出 4+ 单元，两 discovery timer 的 OnCalendar 分别为 09:00/10:00 Asia/Shanghai，不重叠

### 场景 2：旧单元迁移不双开
- **Given** VPS 上存在旧 `watch.service`（active）
- **When** `node service/app/index.mjs apply`
- **Then** 旧 `watch.service` disable --now + 删除，新 `sodex-watch.service` 启动，二者不并存
