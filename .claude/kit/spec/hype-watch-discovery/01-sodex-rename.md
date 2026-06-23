# Spec 01 · Sodex 重命名（Phase 0 地基）

> 引用总纲 `00-overview.md`。冲突以总纲为准。
> 依赖：无（本子件是地基）。落地时直接 `/k:task`。

## 背景与目的

把现有 `watch/`→`sodex-watch/`、`discovery/`→`sodex-discovery/`，确立「按交易所对称」布局，为 HYPE 模块腾位。纯机械重构，**逻辑零变更**（START WATCH 修复在 05，不在此）。

## 选定方案

- `git mv service/watch service/sodex-watch`、`git mv service/discovery service/sodex-discovery`（整树改名，相对 import 不变）。
- 同步所有外部引用（见集成点），无残留旧路径/旧单元名。

## 设计概要

### 涟漪同步清单
- `app/index.mjs`：单元名 `watch.service/discovery.service/discovery.timer`→`sodex-watch.service/sodex-discovery.service/sodex-discovery.timer`；ExecStart 路径 `watch/main.mjs`→`sodex-watch/main.mjs`、`discovery/main.mjs`→`sodex-discovery/main.mjs`；`DEFAULT_CONFIG`/`loadConfig` 的 `watch`/`discovery` 键名；`OLD_WATCH_UNIT:21` 迁移链追加 `watch.service`→`sodex-watch.service`。
- `setup/Makefile`：`sync-config:13-14`、`status:38`、`logs-watch:41-42`、`logs-discovery:45-46`、`restart-watch:49-50`。
- `setup/setup-systemd.sh`：`:20-21` 路径注释。
- `.gitignore`：`watch/config.json`→`sodex-watch/config.json`、`discovery/config.json`→`sodex-discovery/config.json`、`discovery/log`→`sodex-discovery/log`。
- `docs/`：`systemd-setup`、`deploy-commands`、`watch-account-plan`、`discover-traders-plan`、`query-account` 中路径/单元名；`update-log.md` 追加本次条目。

## 边界与约束

- 包含：双目录改名 + 全部外部引用同步 + docs/update-log。
- 不包含：任何 watch/discovery 内部逻辑改动（START WATCH 在 05）。

## 集成点

见总纲 §5（行号锚点）。

## 验收标准

- [ ] `service/sodex-watch/` `service/sodex-discovery/` 存在，旧目录消失。
- [ ] `node service/app/index.mjs render` 输出单元名/ExecStart 全部 sodex-*，迁移动作含旧 `watch.service`。
- [ ] `grep -rn "watch/main.mjs\|discovery/main.mjs\|\"watch.service\"" service setup docs` 无残留旧引用（排除迁移用的 OLD_WATCH_UNIT）。
- [ ] `node --test` 41/41 通过。

## 验收场景（Given/When/Then）

### 场景 1：render 链路一致
- **Given** 完成双目录改名 + 涟漪同步
- **When** `node service/app/index.mjs render`
- **Then** 三单元名为 sodex-*，ExecStart 指向 `sodex-watch/main.mjs`、`sodex-discovery/main.mjs`，迁移含旧 watch.service

### 场景 2：测试与引用无残留
- **Given** 改名完成
- **When** 跑 `node --test` + grep 旧路径
- **Then** 41/41 通过；除 `OLD_WATCH_UNIT` 迁移项外无 `watch/`、`discovery/`、`watch.service` 残留引用
