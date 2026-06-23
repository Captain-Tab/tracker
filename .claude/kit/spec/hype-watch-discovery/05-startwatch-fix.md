# Spec 05 · START WATCH 门控修复（Phase 4，最后）

> 引用总纲 `00-overview.md`。门控状态机见 §2.2，tool 函数契约见 §3.3。冲突以总纲为准。
> 依赖：01（sodex-watch）+ 02（HYPE-watch）。**最后做**（用户指定）。落地直接 `/k:task`。

## 背景与目的

现状：`watcher.mjs:221` 首帧 baseline → `kind:"START"` → 无条件 `sendTelegram(:238)`，每次部署/重连对**每个**地址都推 START WATCH，噪音大。目标：只对 config 中相比上次**新增**的地址推 START WATCH。

## 选定方案

- `tool/` 新增纯函数（总纲 §3.3）`loadSeenAddresses / computeNewAddresses / saveSeen`，**只写一份**，sodex-watch 与 HYPE-watch 共享调用（避免两处重复实现，消除 C2 重复）。
- 持久化文件 `sodex-watch/.seen-addresses.json`（HYPE 同理 `HYPE-watch/.seen-addresses.json`），gitignore。
- watcher 首帧 baseline 推 START WATCH 前加门控：地址 ∈ 新增集合才推 TG，否则只建内部 baseline。

## 设计概要

### 门控逻辑（总纲 §2.2）
1. 启动时 `seen = loadSeenAddresses(path)`；`newAddrs = computeNewAddresses(configAddrs, seen)`。
2. watcher 首帧 baseline：`if (newAddrs.has(addr)) sendTelegram(START)`；已知地址跳过 TG（console banner 照常）。
3. 推完 `saveSeen(path, configAddrs)` 并集落盘。
4. 单地址 CLI 模式（仅 sodex-watch）不经门控，照常推。

### 共享方式
纯函数放 `tool/`，两 venue 各自 import + 传各自文件路径——共享逻辑不共享状态文件。

## i18n 文案

无。

## 边界与约束

- 包含：seen-addresses 门控纯函数 + 接入两 watcher + gitignore。
- 不包含：改动 START 之外的 banner kind 行为；单地址 CLI 门控。

## 集成点

- 新增 `service/tool/seenAddresses.mjs`（`loadSeenAddresses`/`computeNewAddresses`/`saveSeen` + 单测）。
- 新增 `service/tool/reportGate.mjs`（`reportSkipReason({kind, hasOpenPositions, isNew})` → 跳过原因或 null）：把"是否推 TG"判定（SNAPSHOT 无持仓跳过 + START 已知地址跳过）抽成**单一纯函数**，两 watcher 共用、可单测。
- `sodex-watch/main.mjs`（多地址路径）+ `HYPE-watch/main.mjs`：启动时 load seen → computeNewAddresses → saveSeen 并集 → 把 `isNew` 传入各 AccountWatcher 构造。
- `sodex-watch/process/watcher.mjs` + `HYPE-watch/process/watcher.mjs`：发送前调 `reportSkipReason(...)`，有原因则 log 跳过、否则推送（console banner 照常）。`isNew` 缺省 true → 单地址 CLI 模式不门控（交互式照常推）。
- `.gitignore` 增 `service/*/.seen-addresses.json`。
- docs：`watch-account-plan.md`（记 START WATCH 行为变更）、`deploy-commands.md`（强制重推 = 删 `.seen-addresses.json`）、`update-log.md`（Phase 4 条目）。

## 验收标准

- [ ] seen-addresses 三函数有单测（文件缺失→空集、并集落盘、小写归一比对）。
- [ ] sodex-watch 重启：已记录地址不推 START WATCH；新增地址推；文件更新为并集。
- [ ] 删 `.seen-addresses.json` → 下次启动全部地址重推（运维兜底）。
- [ ] 单地址 CLI 模式不受影响（照常推 START）。
- [ ] `node --test` 不退化。

## 验收场景（Given/When/Then）

### 场景 1：仅新增地址推送
- **Given** `sodex-watch/.seen-addresses.json` 含 X、Y；config.watches=[X,Y,Z]
- **When** 重启 sodex-watch，三地址各收首帧
- **Then** 仅 Z 推 START WATCH TG；X、Y 只建 baseline 不推；文件更新为 [X,Y,Z]

### 场景 2：删文件强制重推
- **Given** `.seen-addresses.json` 含全部地址
- **When** 删除该文件后重启
- **Then** 所有 config 地址重新推 START WATCH，文件重建为全集
