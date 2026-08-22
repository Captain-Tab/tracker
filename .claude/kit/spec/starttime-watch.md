# HYPE-watch + sodex-watch 增加 startTime（观察起点）时间戳

> 两个 watch 服务的 `config.watches[]` 每地址新增 `startTime`（Unix 毫秒），标记观察起点：既过滤历史平仓，又作为元数据。

## 背景

新地址加入 watch 后，日报/快照会把加入之前的历史平仓也报出来。HYPE 平仓来源 `userFills`（`fill.time`，Unix 毫秒），sodex 平仓来源 `perps/positions`（`updated_at`），当前均无观察起点边界，历史记录污染新地址的日报。

## 需求

1. config schema 变更：`watches[]` 每项新增 `startTime` 字段
2. config 加载校验：解析 + 容错（缺省/非法回退不过滤）
3. 透传：main 把 `w.startTime` 传入 watcher / dailySnapshot
4. 过滤：平仓历史只展示 `startTime` 之后的记录
5. 回填：旧地址从 VPS 日志推算首次 START WATCH 时刻；新地址填加入时刻
6. 文档同步

## 契约

- `startTime` 字段：Unix 毫秒 number；缺省 `undefined`（不过滤）；非法（负数/非数字）→ 告警回退不过滤
- 过滤语义：仅展示「记录时间 >= startTime」的平仓
  - HYPE：`fill.time`（Unix 毫秒）>= startTime
  - sodex：`updated_at`（单位待实测，若为秒需 ×1000 对齐毫秒）>= startTime
- 元数据：`startTime` 同时作为观察起点，供后续统计（观察时长等）

## 验收场景

### 场景 1：config 解析 startTime
GIVEN config.json `watches[]` 某项含 `startTime=1720000000000`
WHEN `loadConfig` 解析
THEN 该 watch 项含 `startTime`（number），缺失项容错不阻断

### 场景 2：HYPE 平仓历史过滤
GIVEN HYPE 地址 `startTime=T`，`userFills` 含 `time<T` 与 `time>=T` 的平仓
WHEN watcher `fetchAndReport` / `dailySnapshot` 拉取解析
THEN 仅展示 `time>=T` 的平仓记录

### 场景 3：sodex 平仓历史过滤
GIVEN sodex 地址 `startTime=T`，`perps/positions` 含 `updated_at<T` 与 `>=T` 的记录
WHEN 解析平仓历史
THEN 仅展示 `updatedAt>=T` 的记录

### 场景 4：startTime 缺省回退
GIVEN 旧配置无 `startTime` 字段
WHEN 运行 watch
THEN 不过滤历史（行为回退现状），无报错

### 场景 5：非法 startTime 容错
GIVEN `startTime` 为负数/非数字
WHEN `loadConfig`
THEN 告警并回退默认（不过滤）

### 场景 6：旧地址回填
GIVEN 旧 11 个 HYPE 地址从 VPS 日志推算首次 START WATCH 时刻
WHEN 写回 config.json
THEN 每地址 `startTime` 为对应首次观察时刻

### 场景 7：两 venue 单测不退化
GIVEN HYPE-watch 与 sodex-watch 各自实现 `startTime`
WHEN `node --test`
THEN 两 venue 测试通过

## 涉及文件

- service/HYPE-watch/config.json
- service/HYPE-watch/process/config.mjs
- service/HYPE-watch/main.mjs
- service/HYPE-watch/process/watcher.mjs
- service/HYPE-watch/process/dailySnapshot.mjs
- service/HYPE-watch/process/parse.mjs
- service/HYPE-watch/api/index.mjs
- service/sodex-watch/config.json
- service/sodex-watch/process/config.mjs
- service/sodex-watch/main.mjs
- service/sodex-watch/process/watcher.mjs
- service/sodex-watch/process/dailySnapshot.mjs
- service/sodex-watch/process/parse.mjs
- service/sodex-watch/api/index.mjs
- service/sodex-watch/process/snapshot.mjs
- docs/watch/hype.md
- docs/watch/sodex.md
- docs/update-log.md

## 新增抽象

- `filterByStartTime` — 平仓历史时间过滤（HYPE 按 `time`，sodex 按 `updatedAt`，各 venue 独立实现）
- `parseStartTime` — config 层 `startTime` 解析/校验

## 不包含

- 不改 discovery 推荐/评分逻辑
- 不删改已配置的 watch 地址与标签
- 不加新依赖
