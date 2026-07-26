# filterWatchReady() 质量复核层

> 在 discovery ⑥ observing 阶段新增 watch-ready 质量复核，对首次通过 2 周持续性审核的地址二次过滤。

## 验收场景

### G1: HYPE 全部通过
GIVEN HYPE promoted address: score=86, activeDays=28, nTrades=8, PF=2180, RF=2179, weekPnl=+274K
WHEN filterWatchReady(scored, promoted, 'HYPE')
THEN address in watchReady with label="BTC+ETH赚", reason="评分86·活跃28天·8笔·PF 2180"

### G2: HYPE 活跃不足
GIVEN HYPE promoted address: activeDays=14
WHEN filterWatchReady with HYPE thresholds
THEN address in needsMoreObservation with reason="活跃14天<21"

### G3: Sodex PF 不足
GIVEN sodex promoted address: PF=1.56, nTrades=1000
WHEN filterWatchReady(scored, promoted, 'sodex')
THEN address in needsMoreObservation with reason="PF1.6<2.0"

### G4: 首次 promote 才触发
GIVEN entry.weeksSeen.length === PROMOTE_WEEKS (first promotion)
WHEN observing builds promoted list
THEN filterWatchReady is called for this address

### G5: 上次失败下次重评
GIVEN entry.watchReady=false from last week, address promoted again this week
WHEN observing runs
THEN filterWatchReady is called again (re-evaluate)

### G6: TG 消息包含新段
GIVEN decisions.watchReady (3 items), decisions.needsMoreObservation (4 items)
WHEN buildObservingTgMessage
THEN message includes "✅ 建议立即添加" section and "⚠️ 已 promote 但未通过复核" section

### G7: Label 去重
GIVEN trades with coins [CL, CL]
WHEN generateLabel(trades, 'HYPE')
THEN label="CL赚" (not "CL+CL赚")

## 涉及文件
- service/HYPE-discovery/process/observing.mjs
- service/sodex-discovery/process/observing.mjs

## 新增抽象
- filterWatchReady() — 质量复核主函数
- generateLabel() — 自动生成 label
- WATCH_READY_HYPE / WATCH_READY_SODEX — 阈值常量

## 阈值定义

### HYPE
| 条件 | 值 |
|------|-----|
| scoreMin | 55 |
| activeDaysMin | 21 |
| nTradesMin | 8 |
| pfMin | 2.0 |
| rfMin | 2.0 |
| weekPnlRatio | > -0.3 |

### Sodex
| 条件 | 值 |
|------|-----|
| scoreMin | 55 |
| activeDaysMin | 21 |
| nTradesMin | 20 |
| pfMin | 2.0 |
| maxLossRatio | ≤ 0.5 |
