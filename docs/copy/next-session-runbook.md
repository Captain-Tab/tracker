# 下一步执行清单（会话交接 runbook）

> **用途**：新会话照此执行「部署 dry-run → 联网观察（gate）→ agent wallet 授权准备」，然后等观察结果。
> **当前状态（2026-07-04）**：Part A（v3 资金模型接入主循环）+ agent wallet 凭据基建（provision CLI + expiry-check timer）**已实现并提交**。执行器仍纯 dry-run（不签名、不动钱）。
> 相关：`agent-wallet.md`（授权原理/流程）、`hype-go-live.md`（切实盘缺口）、`hype-dry-run-testing.md`（日志/字段核对）、spec `09-go-live-real-trading.md`。

---

## 依赖顺序（先看清）

```
① 部署 dry-run ──▶ ② 联网观察（gate）──▶ 等结果 ──▶ 通过 → Part B（真钱）
                                             │
③ agent wallet 授权（本地，为 B-3 准备）─────┘ 可在观察期并行准备，不阻塞 ①②
```

**关键**：**dry-run 部署 + 观察不需要 agent wallet**（dry-run 不签名）。③ 授权是为将来真实下单（B-3）准备，可并行、不是 ①② 的前置。

---

## ① 部署 dry-run（服务器执行）

**前置**：`service/HYPE-copy/targets.json` 已填好（当前：`id=demo-1`、`source.address` 已填、`availBalanceSim=500`、`minOpenCapital=500`/`maxCoinCapital=1000`、`dryRun=true`、`tgToken`/`tgChat` 已填）。**dry-run 无需 masterAddress / agent key。**

```bash
# VPS 上（sudo）
sudo bash setup/setup-copy.sh          # 建 trader-exec + 信号目录 + 启用 hypeCopy + app apply
systemctl restart sodex-watch HYPE-watch   # 让 watch 按"信号目录已存在"开始发信号（事件驱动）
```

`setup-copy.sh` 会一并建 `HYPE-copy-expiry.timer`（dry-run 无 masterAddress → 每日自动跳过，正常）。

**确认启动**：

```bash
journalctl -u HYPE-copy@demo-1 -f          # 看启动 + 每轮对账
systemctl list-timers HYPE-copy-expiry.timer
```

启动首轮应看到：**「建立基线快照（只跟部署后新开）：<目标当前持仓币>」** —— 证明基线逻辑生效（存量仓被记为 baseline，不接盘）。

---

## ② 联网观察（gate，动真钱前唯一验证防线）

**看哪里**：
```bash
tail -f service/HYPE-copy/log/HYPE-copy-demo-1-$(date +%F).jsonl   # 每动作 JSONL
grep '"result":"place"'        <jsonl>   # would-place
grep -E '"result":"(would-defend|skip-no-open|alert)"' <jsonl>    # 防守/跳过/告警
```
以及 TG 跟单推送（`tgChat`）。

**通过标准（逐项确认合理）**：
- [ ] 启动：基线快照记录了目标**存量**币，之后**不对存量仓下单**（只跟部署后新开）
- [ ] 目标新开某币 → `would-place`：生存杠杆 `floor(L*)` 合理（≥1、≤maxLeverage）、size 方向对、名义 ≥ $10
- [ ] 目标加仓超基线 → 不跟增（followRatio 封顶 1）；目标减 → `reduceOnly` 按比例减
- [ ] 目标平仓 → close 卡片（目标/跟单双卡 + P&L 折算）
- [ ] 目标 lp 后撤 → `would-defend` 补保证金（size 不变）；到 maxCoinCapital 仍不够 → exhausted 告警能推 TG
- [ ] 资金只够 N 个币 → top-N + `alert` 能推 TG
- [ ] 无崩溃、无异常大额 would-place、无"目标态空响应被当清仓"之类异常
- [ ] 重启执行器 → 从盘恢复 baseline + myPos（不重新接盘、不重复开）

**观察时长**：不看日历，看**目标实际发生几轮 开/加/减/平**，确认每类都输出合理即可（目标活跃几小时，安静就多等）。

**记录**：把异常/存疑的 would-place 追加到 `hype-dry-run-testing.md` §四。

---

## ③ Agent Wallet 授权（本地执行，为 B-3 准备 · 可并行）

> ⚠️ **本地跑、需主钱包私钥、不在服务器**。dry-run 观察不需要它；这是真实下单前的凭据准备。授权后 agent 会挂着直到 B-3 接入签名才用（带 180 天有效期，到期 expiry-check 会提醒）。

```bash
# 本地（你的机器），模式C 生成新 agent
node provision/hype-copy-approve-agent.mjs --id=demo-1
#   → stdin 隐藏输入主钱包私钥；二次确认；主钱包签 approveAgent
#   → 输出 agent 私钥 + 落盘命令
```

按输出提示：
1. 把 agent 私钥贴到服务器 `/etc/tracker/HYPE-copy-demo-1-agent.key`（chmod 600 + chown trader-exec）
2. 在 `targets.json` 填 `masterAddress` = 你的主账户地址（填后 expiry-check 才会真正监控）
3. HL 前端核对该 agent 已列入、可撤销

**前置确认**：主钱包已是 Hyperliquid 注册账户（已入金/存在）才能 approveAgent。

---

## 然后：等结果 → 回报

观察够了，回报以下给下一个会话，决定是否进 Part B：

```
观察时长：__；目标发生的动作：开__次 / 加__ / 减__ / 平__
would-place 是否合理：__（杠杆/size/方向/防守）
异常/告警：__
gate 结论：通过 / 不通过（原因）
agent 授权：已授权(agent地址__) / 未授权
```

**通过 → Part B**（顺序，铁律见 spec 09 §8）：
B-1 真实余额 → B-2 授权(已备) → B-3 真实签名 → B-4 fee/chase → **B-sec 安全硬阻断** → B-5 `dryRun:false` + 主网小额。
**B-sec 全做完 + 授权就绪，才允许翻 `dryRun:false`。**

---

## 给新会话的一句话上下文

> Part A（v3 dry-run）+ agent 凭据基建已提交。当前纯 dry-run。本次任务：部署 dry-run + 联网观察验证 v3 输出合理（gate），并行准备 agent 授权；**不写实盘代码、不翻 dryRun**。观察通过后才进 Part B。详见本文件 + spec `09-go-live-real-trading.md`。
