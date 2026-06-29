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

## 2. 建写侧用户 trader-exec（一次性）

```bash
sudo useradd --system --no-create-home --shell /usr/sbin/nologin trader-exec
```

## 3. 配 copy 目标（targets.json）

```bash
# 按样例填（含 tgToken/目标地址/availBalanceSim）：
cp /root/service/HYPE-copy/targets.example.jsonc /root/service/HYPE-copy/targets.json
# 编辑：去掉注释改成纯 JSON；填 source.address（被跟目标）、availBalanceSim（dry-run 模拟余额）
# 权限收敛（含 agentKeyRef 占位，仅 trader-exec 可读）：
sudo chown trader-exec:trader-exec /root/service/HYPE-copy/targets.json
sudo chmod 600 /root/service/HYPE-copy/targets.json
```

> 一期硬限制：`targets` 只能 1 个元素（≥2 拒绝启动）。

## 4. （可选）开启事件驱动 + 跨进程信号权限

不做这步 → copy 走 180s 轮询兜底（仍可用）。要"目标动→秒级跟"才做：

**4a. 建信号目录**（信号不含密钥，简单法用人人可读）：
```bash
sudo install -d -o tracker -m 0755 /var/lib/tracker/copy-signal
#  install -d        建目录（同时设属主/权限）
#  -o tracker        属主=tracker（watch 用户，能写）
#  -m 0755           人人可读、仅 tracker 可写（信号非敏感，省去建共享组）
```
> 严格隔离版（不想人人可读）：`sudo groupadd copysig && sudo install -d -o tracker -g copysig -m 0750 /var/lib/tracker/copy-signal && sudo usermod -aG copysig trader-exec`（trader-exec 入组才能读）。

**4b. watch 侧 config 加 `copySignalDir`**（`/root/service/{sodex,HYPE}-watch/config.json`，按信号源所在那侧加）：
```jsonc
{ "copySignalDir": "/var/lib/tracker/copy-signal", "tgToken": "...", "watches": [ ... ] }
```
→ watch 在每个被监听地址变动时写 `/var/lib/tracker/copy-signal/<address>.json`。不加=不写（diff=0）。

**4c. copy 侧 targets.json 加 `copySignalPath`**：指向 watch 为**你的目标地址**写的同一文件：
```jsonc
"copySignalPath": "/var/lib/tracker/copy-signal/<目标 source.address>.json"
```

> 三者对齐（目录权限 + watch 写 + copy 读同一文件），目标一动 ~1s 内触发。任一未配 → 退化轮询，不报错。

## 5. 开启编排 + apply

`/root/service/app/config.json` 加（或改）：
```jsonc
"hypeCopy": { "enabled": true, "targets": ["<targets.json 里的 target.id>"] }
```
```bash
cd /root/service
node app/index.mjs render   # 干跑审查生成的 HYPE-copy@<id>.service
node app/index.mjs apply     # 写盘 + enable + start
```

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
