# app 服务编排层：集中开关 + discovery 调度 + 统一 WARP 代理

**创建日期**: 2026-06-20 | **类型**: feature | **状态**: 待 spec/plan | **分支**: dev

> 由 `/k:clarify` 产出。新增 `service/app/`（服务编排层）+ `service/lib/WARP/`（统一代理封装），通过 systemd 集中管理 watch / discovery 两个服务的开关与 discovery 的运行调度。

## 背景与目的

`service/` 现有两个服务：`watch`（7×24 守护，已 systemd 部署 `watch-account.service`）与 `discovery`（周期批处理，尚未纳入部署）。当前痛点：

1. **无集中开关**：要单独启停某服务靠手敲 systemctl；无单一配置声明"哪个开、哪个关"。
2. **discovery 无调度**：是 run-and-exit 批处理，没有"每周/每月几点跑"的机制。
3. **discovery 上 VPS 会断网/泄漏 IP**：discovery 零代理处理（`grep` 确认无 undici/ProxyAgent），而 VPS 出网走 WARP 代理（node fetch 不认 HTTP_PROXY），对照 watch `api/index.mjs:6-17` 必须用 undici ProxyAgent。
4. **WARP 代理逻辑散落**：watch 的 fetch 代理（api）与 WS 代理（watcher）各写一份，新服务无法复用。

**目的**：建 `app/` 集中编排（开关 + 调度，一处 config + 一键 apply）+ `lib/WARP/` 统一代理（discovery/watch/未来服务共用），并以独立 systemd 单元保证两服务**进程隔离、互不影响**。

## 选定方案

**`service/app/` 编排层（systemd 原生）+ `service/lib/WARP/` 统一代理。**

核心决策（经 `/k:clarify` 多轮确认）：

- **隔离 + 集中并存**：两个独立 systemd 单元（进程隔离，一个崩不连累另一个）+ 单 `app/config.json` + `app/index.mjs` 控制（集中管理）。app 只**编排** systemd，不托管服务进程。
- **discovery 用 systemd timer 触发**（非 in-process 常驻）：批处理跑完即退，漏跑补偿/日志/隔离由 systemd 免费给。
- **WARP 抽到 `lib/WARP/`**：修复 discovery 代理 bug + 去重 watch + 未来复用。

| 方案 | 取舍 | 选否 |
|---|---|---|
| **A（选定）** app/ 编排 + lib/WARP + systemd 双单元 | 进程隔离 + 集中管理 + 调度声明式 + 代理统一 | ✅ |
| B app.mjs 单进程 supervisor 托管两服务 | 最简单 | ✗ 不隔离（discovery 崩拖垮 watch）、周批处理塞进长驻进程 |
| C schedule 塞进 discovery/、开关各服务自管 | 改动小 | ✗ 关注点泄漏、无集中管理 |

## 设计概要

### 目标结构

> 结构调整：原 `script/` 顶层目录改名为 `service/`（整树改名，内部相对 import 不变）；VPS 部署根 `/root/watch-account` → `/root/service`。

```
service/                  # 原 script/ 改名（代码根；VPS 即 /root/service）
  lib/WARP/index.mjs      # 统一代理：PROXY_URL + installFetchProxy() + installWsProxy()
  app/
    config.json           # gitignore，默认都开 + discovery.schedule + deploy
    config.example.jsonc  # committed 填写参考（带注释，枚举 freq/day/hour 全部取值）
    index.mjs             # 控制 CLI：render / apply / status（ROOT_DIR=__dirname/.. → service/）
  discovery/  watch/  tool/   （两个服务 + 共享，不变结构）
```

### 1. `lib/WARP/index.mjs` — 统一代理封装

```js
export const PROXY_URL = process.env.HTTP_PROXY || process.env.http_proxy || null;
// fetch 代理（undici ProxyAgent）：discovery + watch REST 共用。仅 PROXY_URL 存在时按需 import undici。
export async function installFetchProxy() { /* 抽自 watch/api/index.mjs:9-17 */ }
// WS 代理（ws 包 + https-proxy-agent + globalThis.WebSocket polyfill）：仅 watch 用。
// 失败抛错（缺 ws）→ 由调用方决定（watcher 捕获后 process.exit(1)，保留现有行为）。
export async function installWsProxy() { /* 抽自 watch/process/watcher.mjs 的 ws 块 */ }
```

消费方改动：
- `discovery/api/index.mjs`：顶部 `await installFetchProxy()`（**修复 🔴 代理 bug**）。
- `watch/api/index.mjs`：内联代理块 → `import { PROXY_URL, installFetchProxy }` + `await installFetchProxy()`（去重）。
- `watch/process/watcher.mjs`：内联 ws 块 → `await installWsProxy()`（缺 ws 时 catch→exit(1)）。

### 2. `app/config.json` — 集中开关 + 调度（gitignore，缺文件用代码默认 both on）

```jsonc
{
  "watch":     { "enabled": true },
  "discovery": { "enabled": true, "schedule": { "freq": "weekly", "day": 1, "hour": 9 } },
  "deploy":    { "proxyUrl": "http://127.0.0.1:40000", "requiresWarp": true }
}
```

- `schedule.freq` ∈ {weekly, monthly, daily}；`day`（按 freq）：**weekly=0-6 cron 星期数字（0=周日 1=周一 2=周二 3=周三 4=周四 5=周五 6=周六）** / monthly=1..28（避开月份缺失）/ daily 忽略；`hour` 0..23 整点。
- 校验/归一：非法值回退默认（weekly day=1 / 9 点）；缺 config 文件 → 全默认 both on。
- JSON 不能注释 → committed `service/app/config.example.jsonc` 带注释枚举全部取值作填写参考。
- 含无密钥 → 本可提交，但为防 `make sync/pull` 覆盖服务器开关，**gitignore**，服务器手动放（同 watch/discovery config）。

### 3. `app/index.mjs` — 控制 CLI（零依赖：node:fs/child_process/path/url）

| 子命令 | 行为 | 权限 |
|---|---|---|
| `render` | 打印将生成的 unit 内容 + 计划的 systemctl 动作，**不写不改** | 本机可跑（不调 systemctl） |
| `apply` | render → fail-fast 校验全部 → 写**内容变化的** unit 到 `/etc/systemd/system` → daemon-reload → 按 enabled `enable --now`/`disable --now` → **仅 unit 内容变才 restart**（不误伤在跑的 watch）→ 迁移旧 `watch-account.service`(disable+stop+rm) | root / systemd |
| `status` | 打印 config + `watch.service`/`discovery.timer` 的 is-enabled/is-active + timer 下次触发 | systemd |

- 非 systemd 环境（本机 mac）：apply/status 探测 `systemctl` 不可用 → 报错"仅 systemd 服务器"；render 仍可跑。
- `scheduleToOnCalendar(schedule)` 在此：weekly 用 `["Sun","Mon",..,"Sat"][day]` 映射（day=1→`Mon *-*-* 09:00:00 Asia/Shanghai`）、monthly→`*-*-01 09:00:00 Asia/Shanghai`、daily→`*-*-* 09:00:00 Asia/Shanghai`（**显式 Asia/Shanghai 后缀**，不依赖系统时区，与 watch 一致）。

### 4. 生成的 systemd 单元（路径 from `__dirname`、node from `process.execPath`、proxy from deploy.proxyUrl）

- `watch.service`：`Type=simple`，ExecStart `node .../watch/main.mjs --config .../watch/config.json`，`Restart=always`，WARP After/Requires + `HTTP_PROXY`。
- `discovery.service`：`Type=oneshot`，ExecStart `node .../discovery/main.mjs`，WARP After/Requires + `HTTP_PROXY`。
- `discovery.timer`：`OnCalendar=`（来自 schedule，带 Asia/Shanghai）+ `Persistent=true`（漏跑补偿）。

### 5. 部署层改写

- `setup/setup-systemd.sh`：薄壳——装依赖（ws / undici / https-proxy-agent）+ `node service/app/index.mjs apply`（替代原 watch-only 生成，修旧路径）。
- `setup/Makefile`：`sync` 改 rsync 目录树（tool/watch/discovery/app/lib）；新增 `app-status`/`app-apply` 目标。
- `docs/systemd-setup.md` / `docs/deploy-commands.md`：同步双服务 + app 编排 + 旧单元迁移命令。

## 边界与约束

**包含：**
- `lib/WARP/index.mjs`（统一 fetch+WS 代理）
- `app/{config.json, index.mjs}`（集中开关 + discovery 调度 + render/apply/status）
- 生成 3 个 systemd 单元（watch.service / discovery.service / discovery.timer）
- discovery/watch 改用 lib/WARP；discovery 代理 bug 修复
- setup/Makefile/docs 改写；.gitignore 加 app/config.json

**不包含：**
- watch 内部 daily 快照 timing（at=HH:MM，watch 自身行为，不归 app）
- in-process 调度（用 systemd timer，不自建常驻调度器）
- discovery↔watch 跨进程限流协调（隔离进程无法共享限流单例；周度突发小、低风险，可接受）
- watchConfigPath 回归 bug（已修，归重组 commit，非本 feature）
- monthly 的 29-31 日 / "月末"（capped 1-28）

**已知限制：**
- discovery 在 `PROXY_URL` 存在时需 undici（破坏其"纯零依赖"——仅 VPS 代理场景；无代理时仍零依赖）。
- `app apply` 需 root + systemd，仅服务器可完整跑；本机用 `render` 审查。
- OnCalendar 显式时区后缀需 systemd ≥ v240（现代 VPS 均满足）。

## 集成点

| 文件 / 符号 | 改动 |
|---|---|
| `script/` → `service/` | **整树改名**（内部相对 import 不变）；VPS `/root/watch-account`→`/root/service` |
| `service/lib/WARP/index.mjs` | **新增** PROXY_URL + installFetchProxy + installWsProxy |
| `service/app/config.json` | **新增**（gitignore，schedule.day 用 cron 0-6） |
| `service/app/config.example.jsonc` | **新增**（committed，注释枚举全部取值） |
| `service/app/index.mjs` | **新增** render/apply/status + scheduleToOnCalendar + unit 模板 |
| `service/discovery/api/index.mjs` | 加 `await installFetchProxy()`（修代理 bug） |
| `service/watch/api/index.mjs` | 内联代理块 → lib/WARP；PROXY_URL 来源改 lib/WARP |
| `service/watch/process/watcher.mjs` | 内联 ws 块 → `await installWsProxy()` |
| `setup/setup-systemd.sh` | 改写为薄壳调 `app apply` |
| `setup/Makefile` | sync 改目录树 + app 目标 |
| `docs/systemd-setup.md` / `docs/deploy-commands.md` | 同步双服务 + app 编排 + 迁移 |
| `.gitignore` | 加 `service/app/config.json` |

## 验收标准

- [ ] `node --check` 通过：lib/WARP/index.mjs、app/index.mjs；改动后 discovery/watch 全 .mjs 通过
- [ ] `node service/app/index.mjs render` 本机（非 systemd）可跑，打印 3 个 unit 内容 + 计划动作，不调 systemctl 不报错
- [ ] discovery 在 `HTTP_PROXY` 环境下经 lib/WARP `installFetchProxy()` 走代理（不再裸连）
- [ ] watch 改用 lib/WARP 后行为不变（fetch 代理 + WS 代理 + 缺 ws 时 exit(1)）
- [ ] `scheduleToOnCalendar`：weekly/monthly/daily 三种各产出正确的带 `Asia/Shanghai` 的 OnCalendar 串
- [ ] `app apply` 幂等：unit 内容未变时**不 restart watch**（不断 WS）
- [ ] `app apply` 迁移：存在旧 `watch-account.service` 时 disable+stop+rm，不双开
- [ ] `app/config.json` 缺失 → 默认 both on；非法 schedule → 回退默认；已入 .gitignore
- [ ] 非 systemd 环境 `app apply`/`status` 优雅报错（不崩）
- [ ] discovery enabled=false → apply 后无 discovery.timer/service；watch enabled=false → 无 watch.service

## 验收场景

### 场景 1：render 本机干跑（无 root / 非 systemd）
- **Given** 本机 macOS（无 systemctl），`app/config.json` 缺失（用默认 watch+discovery 均 enabled、schedule weekly/day=1/9）
- **When** 运行 `node service/app/index.mjs render`
- **Then** stdout 打印 watch.service / discovery.service / discovery.timer 三段 unit 内容（OnCalendar 含 `Mon *-*-* 09:00:00 Asia/Shanghai`）+「将 enable 两个服务」的计划；不调用 systemctl、退出码 0、不报错

### 场景 2：discovery 走 WARP 代理（修复 🔴 bug）
- **Given** 环境变量 `HTTP_PROXY=http://127.0.0.1:40000`，discovery/api/index.mjs 顶部已 `await installFetchProxy()`
- **When** 运行 `node service/discovery/main.mjs --dry-run`
- **Then** stderr 出现 `[proxy] fetch 走代理 http://127.0.0.1:40000`；所有 sodex API 请求经代理发出（不裸连泄漏真实 IP）

### 场景 3：apply 幂等不误重启 watch
- **Given** VPS 上 watch.service 正在运行（多个 WS 长连），仅把 `app/config.json` 的 `discovery.schedule.hour` 从 9 改为 10
- **When** 运行 `node service/app/index.mjs apply`
- **Then** discovery.timer 的 OnCalendar 更新为 10 点并 reload；watch.service **不被 restart**（`systemctl show watch.service -p ActiveEnterTimestamp` 不变、WS 连接不断）

### 场景 4：单独关闭某服务
- **Given** `app/config.json` 设 `discovery.enabled=false`、`watch.enabled=true`，VPS 已部署两服务
- **When** 运行 `node service/app/index.mjs apply`
- **Then** discovery.timer/service 被 `disable --now`（`systemctl is-enabled discovery.timer` = disabled）；watch.service 仍 active（互不影响）

### 场景 5：旧单元迁移防双开
- **Given** VPS 上存在旧 `watch-account.service`（active），尚无新 `watch.service`
- **When** 运行 `node service/app/index.mjs apply`
- **Then** 旧 `watch-account.service` 被 disable+stop+rm，新 `watch.service` enable+start；同一地址不出现两个监听进程（无双倍 TG）

### 场景 6：watch 改用 lib/WARP 行为不变
- **Given** lib/WARP 抽取完成，watch/api 与 watcher 改调 installFetchProxy/installWsProxy
- **When** 运行 `node service/watch/main.mjs <地址> --snapshot`（有 ws 包）
- **Then** 输出 banner/仓位/平仓历史与抽取前一致；`HTTP_PROXY` 下 fetch 走代理；删除 ws 包后启动 → `process.exit(1)` 并提示装 ws（保留现有行为）
