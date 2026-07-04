# HYPE-copy dry-run 部署 & 首次观察报告

> 生成时间：2026-07-04 14:50 CST | 部署时间：2026-07-04 14:13 CST
> target: `demo-1` (`0xf936EaFdc34a1E534082B50eA13625854DC38EC0` → Hyperliquid)

## 1. 部署确认

| 项目 | 状态 |
|------|------|
| 代码版本 | v3 资金模型（`planBudgetReconcile` + `planFollow` + 生存杠杆 + top-N + 逐仓防守） |
| `HYPE-copy@demo-1` | ✅ active |
| `HYPE-copy-expiry.timer` | ✅ active（每日 09:00 CST） |
| `sodex-watch` | ✅ active，含 target 地址（`account_id=1163`，标签「测试跟单」） |
| `HYPE-watch` | ✅ active |
| 事件驱动 | ✅ 信号目录 `/var/lib/tracker/copy-signal/` 就绪 |
| Agent 私钥 | ✅ `/etc/tracker/HYPE-copy-demo-1-agent.key` (600, trader-exec) |
| `targets.json` 权限 | ✅ 600, trader-exec |

### 启动日志

```
14:13:09 HYPE-copy 启动：target=demo-1 dryRun=true avail(sim)=500 预算 M0=500/max=1000 兜底=180s
14:13:10 [demo-1] 建立基线快照（只跟部署后新开）：无存量仓
14:20:19 [demo-1] 恢复状态：baseline 0 币 / 在跟 0 币（重启恢复）
```

## 2. 观察统计（截至 14:50 CST）

| 指标 | 数值 |
|------|------|
| 总 reconcile 次数 | 71 |
| 涉及币种 | SPCX-USD (46), MSTR-USD (22), XAUT-USD (1) |
| `skip-unmappable` | 69 次 |
| `baseline` | 1 次 |
| `alert` | 1 次 |
| `would-place` | 0 次 |

## 3. 关键事件

### 3.1 基线建立（14:13:10）

```
result: baseline, baselineCoins: []（无存量仓）
```

部署时目标仅有 MSTR 仓位（unmappable），因此基线为空。

### 3.2 MSTR-USD → skip-unmappable（持续）

```
coin: MSTR-USD, result: skip-unmappable, reason: 无 hype 映射
```

MSTR（MicroStrategy）在 Hyperliquid 上无对应 perp，正确跳过。目标仓位：0.985 MSTR 5x LONG, entry 90.43, mark 106.16。

### 3.3 XAUT-USD → skip-unmappable（14:42）

```
coin: XAUT-USD, result: skip-unmappable, reason: 无 hype 映射
```

XAUT 在黑名单中（商品 perp），正确跳过。

### 3.4 ETH → alert（14:43:17）⚠️

```
coin: (空), result: alert, reason: 资金仅够跟 0 个币，未跟：ETH
```

**目标新开了 ETH 仓位。** ETH 可映射到 Hyperliquid，但 `availBalanceSim=500` / `maxCoinCapital=1000` 的预算不足以跟随（ETH 名义价值远超预算上限）。v3 top-N 分配后将 ETH 归入 `alert`，符合预期。

## 4. Gate 通过标准核对

| 标准 | 状态 | 说明 |
|------|------|------|
| 基线快照 | ✅ | 建立成功，不对存量仓下单 |
| 新开仓 would-place | ⏳ | 尚未出现（ETH 因预算不够未进 would-place） |
| 跟随加减 | ⏳ | 尚未出现 |
| 平仓 close 卡片 | ⏳ | 尚未出现 |
| 防守 would-defend | ⏳ | 尚未出现 |
| top-N + alert | ✅ | ETH alert 正确触发 |
| 无崩溃/异常 | ✅ | 运行稳定 |
| 重启恢复 | ✅ | 14:20 重启 → 从盘恢复 baseline=0 / myPos=0 |

## 5. 结论

- **v3 预算模型正常运行**：baseline 过滤、黑名单过滤、HL universe 校验、top-N 分配、alert 告警全部跑通。
- **未看到 would-place**：因为目标目前只有 unmappable 币种（MSTR/XAUT）和大额 ETH。ETH 虽是 mappable 但 $500 模拟预算不足以开仓。
- **建议**：将 `availBalanceSim` 提高到 50000（目标有 ETH 仓位时更可能触发 would-place）；或等目标开一个小额币种。

---

## 快捷命令

```bash
bash setup/deploy-copy.sh sync       # 推代码 + 重启
bash setup/deploy-copy.sh status     # 查看状态
bash setup/deploy-copy.sh log-jsonl  # 实时 JSONL
bash setup/deploy-copy.sh logs       # journal 日志
```
