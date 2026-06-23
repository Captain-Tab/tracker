# 横切 · TODO / 未证实项 / 待部署动作

> 本功能（hype-watch-discovery）所有**推迟功能 / 未证实假设 / 待部署验证**的单一集中清单。
> 总纲 `00-overview.md` 的「不包含 / 已知限制」是边界 SSOT，本文是其**可执行待办视图** + 状态跟踪。新发现的 TODO 都往这里加。
> 状态：⬜ 未做 / 🔬 待实测 / ✅ 已验证（保留以防重复怀疑）。

---

## A. 推迟的功能（明确第二步 / 后续，本期不做）

| # | 项 | 来源 spec | 说明 |
|---|---|---|---|
| A1 | ⬜ 跟单交易执行（Exchange / EIP-712 签名） | `00 §不包含` | 整个交易侧未做；信任边界与监听完全不同，需私钥/agent wallet，单独立项 |
| A2 | ⬜ HYPE-discovery 逐笔真账本深度评估（evaluate/score） | `00 §不包含`、`03:8,22,47` | 当前仅 leaderboard 粗筛；深度评估对 top 候选拉 clearinghouseState/userFills |
| A3 | ⬜ 离场提醒 `orderUpdates` 实时化 | `02:42` | 当前用 frontendOpenOrders 快照 diff；可解析 WS orderUpdates status 更精确 |
| A4 | ⬜ 平仓跨 oid 聚合 | `00 §不包含` | 当前按单 oid 聚合；跨 oid（手动分批平仓）仍多行 |
| A5 | ⬜ testnet 支持 | `00 §不包含`、`03:47` | 仅 Mainnet |

## B. 待部署 / 验证动作（本期范围内，本机无法验，需 VPS / 凭据）

| # | 项 | 来源 spec | 说明 |
|---|---|---|---|
| B1 | 🔬 VPS `app apply`：旧单元迁移不双开 + 6 单元启停 | `04 验收场景2` | 本机无 systemd，只验了 `app render`；apply/迁移需 VPS 实跑 |
| B2 | ⬜ 填 `HYPE-watch/config.json` + `HYPE-discovery/config.json` 的 TG `tgToken`/`tgChat` | `00 §3.2` | 现留空占位（空则 sendTelegram no-op）；填后才真正推送 |
| B3 | 🔬 sodex-watch START 门控真实 WS 端到端 | `05` | 本机未跑真实 Sodex WS；逻辑由 HYPE 端到端 + 单测证实，结构同构 |
| B4 | ⚠️ 首次部署 `.seen-addresses.json` 不存在 → 一次性 START 基线推送 | `05` | 预期行为（建立基线）；部署时知悉，之后重启安静 |

## C. 未证实的假设 / 已知限制（带兜底，待实证）

| # | 项 | 来源 spec | 兜底 / 现状 |
|---|---|---|---|
| C1 | 🔬 HYPE leaderboard `roi` 是否受充提污染 | `00 §不包含`、`03:30` | [推理] 未实证；故门槛只用 pnl/vlm，不用 roi。可第二步拉 userNonFundingLedgerUpdates 反推 |
| C2 | ⚠️ leaderboard 非官方端点稳定性 / schema 变更 | `00 §已知限制`、`03` | 已兜底：40s 超时 + 失败跳过本轮 + 字段缺失跳过该行 |
| C3 | ⚠️ HYPE meta universe 上新变 index | `00 §已知限制` | 已实现 6h 周期刷新；加载失败精度回退默认不阻断 |
| C4 | 🔬 `mark = positionValue / |size|` 反推 | `02 §3.1`（总纲） | HYPE 持仓不直接给 markPx，反推用于展示；与真实 markPx 可能微差，未对账 |
| C5 | ⚠️ 重构非零回归（重命名波及 app/setup/docs） | `00 §已知限制` | Phase 0/3 已本地验证；生产链路最终以 VPS 为准 |

## D. 已验证（解除的不确定项，记录以防重复怀疑）

| # | 项 | 证据 |
|---|---|---|
| D1 | ✅ HYPE WS 心跳格式 = `{method:"ping"}` → `{channel:"pong"}` | Phase 1 实测（原 HARD GATE） |
| D2 | ✅ HYPE-discovery 流式解析峰值 98MB（vs 非流式 264MB） | Phase 2 `/usr/bin/time -l` 实测 |
| D3 | ✅ START 门控：已知地址不推 / 新增推 / 删文件重推 | Phase 4 端到端 + 单测 |
