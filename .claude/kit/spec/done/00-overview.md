# Spec 总纲 · watch 候选地址历史记录

> 本文件是 spec-set SSOT。子件只引用、不重定义。冲突以本总纲为准。

## 0. 背景与目的

discovery 目前只排除 watch config 中当前在监听的地址。被移除的地址没有记录，会在下一轮 discovery 中重新出现——"我们已经判过并放弃了的人"。需要持久化记录所有曾关注过的地址，discovery 排除"当前监听 + 历史记录"的并集。

## 1. 共享契约

### 1.1 存储格式

```
sodex-watch/.watch-candidates.json
HYPE-watch/.watch-candidates.json
```

```json
{
  "0xabc...": "2026-06-23",
  "0xdef...": "2026-06-25"
}
```

- key: 地址（小写归一）
- value: 加入日期（YYYY-MM-DD）
- 追加不删，手动维护（本地编辑 + scp 推送）

### 1.2 加载函数（tool/ 共用）

```js
// tool/watchCandidates.mjs
loadCandidates(path)    // → Map<string, string>；文件缺失→空 Map
saveCandidates(path, map) // 落盘
mergeCandidates(existing, configAddrs, date) // 并集
```

### 1.3 discovery 排除逻辑

两 discovery 的 `loadWatchConfig` 扩展为：
- 读当前 watch config → 当前监听集
- 读 `.watch-candidates.json` → 历史候选集
- 排除 = 当前监听 ∪ 历史候选

## 2. 子件依赖拓扑

```
01-candidate-store → 02-discovery-exclude
                        (依赖 01 的 loadCandidates)
```

## 3. 验收标准

- [ ] `tool/watchCandidates.mjs` load/save/merge 三函数可用，单测通过
- [ ] sodex-discovery + HYPE-discovery 排除"当前监听 + 历史候选"
- [ ] `.watch-candidates.json` 文件缺失不阻断（视为空历史）
- [ ] `.gitignore` 包含 `.watch-candidates.json`
- [ ] `node --test` 不退化

## 4. 验收场景

### 场景 1：历史排除（Happy Path）
- **Given** sodex-watch/config = [A, B]；sodex-watch/.watch-candidates.json = {C: "2026-06-23", D: "2026-06-24"}
- **When** discovery 运行
- **Then** 排除集 = {A, B, C, D}，日志显示"排除已监听 X 个 + 历史候选 Y 个"

### 场景 2：文件缺失不阻断
- **Given** .watch-candidates.json 不存在
- **When** discovery 运行
- **Then** 排除集仅含当前 watch config 地址，不报错

### 场景 3：mergeCandidates 幂等
- **Given** 已有 {A: "2026-06-23"}，config 新增 A, B
- **When** mergeCandidates(existing, [A, B], "2026-06-26")
- **Then** A 日期保持 "2026-06-23"，B 新增 "2026-06-26"

## 5. 不包含（边界）

- 自动写入——地址加入历史由人工操作（本地编辑 JSON + scp）
- 日志对比分析脚本
- 修改 watch/main.mjs 或 app/systemd

## 6. 集成点

- `service/tool/watchCandidates.mjs` — 新建共用模块
- `service/sodex-discovery/main.mjs:77-87,139-146` — 排除逻辑扩展
- `service/HYPE-discovery/main.mjs:39-56,71` — 排除逻辑扩展
- `.gitignore` — 新增 `.watch-candidates.json`
- `service/sodex-discovery/process/collect.mjs` / `service/HYPE-discovery/process/collect.mjs` — 排除集传入（现有接口不变，仅 caller 并集）
