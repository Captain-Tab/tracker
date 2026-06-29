# HYPE-copy 跟单执行器部署（dry-run）

> 在 VPS 部署跟单执行器（一期 **dry-run**：不签名、不发真实单）。
> 基础部署见 [`../deploy-commands.md`](../deploy-commands.md)；系统/流程见 [`../copy/hype.md`](../copy/hype.md)、[`../copy/core-flow.md`](../copy/core-flow.md)；切实盘缺口见 [`../copy/hype-go-live.md`](../copy/hype-go-live.md)。
> VPS：`root@107.172.90.184`，代码 `/root/service/`（= 本地 `service/`）。

---

## 0. 前置概念（为什么要这几步）

- 跟单执行器 `HYPE-copy` 跑在**独立用户 `trader-exec`**（与读侧 `tracker` 隔离，将来持 agent key）。
- **事件驱动**靠一个"信号文件"跨进程通信：watch（`tracker`）检测到目标变化 → 写信号文件 → copy（`trader-exec`）读到 → 立即对账。难点是"让 trader-exec 能读 tracker 写的文件"（第 4 步权限）。
- 不配信号 → copy 自动退化为 180s 轮询兜底（能跑，只是慢）。

---

## 1. 同步代码 + 装依赖

```bash
# 本地 → VPS 同步 service/（用你既有的同步方式，如 rsync/git）
# VPS 上：
cd /root/service
bash setup/setup-systemd.sh   # 装依赖(含 decimal.js/@nktkas/hyperliquid) + app apply + status
```

> `setup-systemd.sh` 已含跟单执行器依赖（`decimal.js` 必需，缺则 HYPE-copy 启动崩）。

## 2. 填 targets.json（**唯一需人手填的文件**）

```bash
cp /root/service/HYPE-copy/targets.example.jsonc /root/service/HYPE-copy/targets.json
# 编辑：去注释改纯 JSON；填 source.address(被跟目标) / availBalanceSim(dry-run 模拟余额) / tgToken
```
> 一期硬限制：`targets` 只能 1 个元素。`copySignalPath` 不用填（copy 自动派生）。

## 3. 一键部署（其余全脚本）

```bash
cd /root/service
sudo bash setup/setup-copy.sh
```
脚本自动：建 `trader-exec` → 建信号目录 0755（**= 默认开事件驱动**）→ targets.json chmod 600 → 读 target.id 在 `app/config.json` 启用 `hypeCopy`（合并，不动其它服务）→ `app apply` 启 `HYPE-copy@<id>.service`。

## 4. 重启 watch（让它按"信号目录已存在"开始发信号）

```bash
sudo systemctl restart sodex-watch    # 或 HYPE-watch，按你目标的信号源那侧
```
> 事件驱动**默认开**：信号目录存在 → watch 自动写 `<dir>/<address 小写>.json`、copy 自动派生订阅，**无需任何 flag / 路径对齐**。
> 不想要事件驱动：watch config.json 设 `"copySignal": false` → 退回 180s 轮询兜底。

---

## 6. 验证（首跑必看，确认无集成问题）

```bash
# 实例状态
systemctl status HYPE-copy@<id>.service
# 实时日志（journald）
journalctl -u HYPE-copy@<id> -f
# 逐动作 JSONL（含计时 fullMs/execMs）
tail -f /root/service/HYPE-copy/log/HYPE-copy-<id>-$(date +%F).jsonl
```

**看什么**：
- 启动行 `HYPE-copy 启动：… 兜底=180s`；若配了信号还有 `订阅跟单信号：…`。
- 首轮"初始镜像同步"一条；之后目标动 → 开/加/减/平 行。
- JSONL 的 `fullMs/execMs` = 实测延迟（copy 段）；`would-place` 的 coin/方向/量/价是否合理。
- **dry-run 不应有任何真实下单**（`placeDryRun` 不签名）。

## 7. 关闭 / 回滚

```bash
# 停跟单（推 ⏹ 关闭跟单后退出）
systemctl stop HYPE-copy@<id>.service
# 关编排：app/config.json 设 hypeCopy.enabled=false → node app/index.mjs apply
# 回滚信号：watch config.json 删 copySignalDir → 重启 watch（回到无信号，diff=0）
```

> 既有四服务（sodex/HYPE × watch/discovery）不受影响——`apply` 仅追加 HYPE-copy 单元、幂等。

---

## 8. dry-run 阶段不需要的（切实盘才做）

agent key / approveAgent / 真实签名 / 真实余额 / dryRun=false——全部见 [`../copy/hype-go-live.md`](../copy/hype-go-live.md)。一期 dry-run 用 `availBalanceSim` 模拟余额、不碰 key。
