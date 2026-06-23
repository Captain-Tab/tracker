# VPS 部署命令

> VPS: `root@107.172.90.184` / 代码路径: `/root/service/`（= 本地 `service/`）
> 四个服务（sodex/HYPE × watch+discovery）：`{sodex,HYPE}-watch.service`（长驻监听）+ `{sodex,HYPE}-discovery.timer`/`.service`（周期发现），由 `service/app/` 编排层经 systemd 集中管理。下方命令以 sodex 为例，HYPE 把单元名 `sodex-` 换成 `HYPE-` 同理。两 discovery 默认错峰（9 点 / 10 点）。

## 本地快捷命令（项目 `setup/` 目录下执行）

```bash
make sync            # 推送 service/ 代码到 VPS /root/service（排除 config/log）
make sync-config     # 单独推送 watch/discovery 密钥配置（app/config.json 不推，服务器自管）
make pull            # 从 VPS 拉回代码
make pull-logs       # 下载 discovery 日志到本地 service/sodex-discovery/log/
make deploy          # 一键：推代码 + 服务器装依赖并 app apply
make app-apply       # 按 app/config.json 同步两个服务
make app-status      # app 编排状态
make status          # systemctl 两服务状态
make logs-watch      # 实时监听日志
make logs-discovery  # 最近一次发现日志
make restart-watch   # 重启监听服务
```

## VPS 直连

```bash
ssh root@107.172.90.184
cd /root/service          # 所有 node app/... 命令在此目录执行
```

---

## 服务管理（首选 app 编排，集中管理）

### 开关 / 调度（改 config + apply）

```bash
vim /root/service/app/config.json        # 改 watch/discovery enabled、discovery.schedule
cd /root/service && node app/index.mjs apply    # 同步到 systemd（幂等，不误重启 watch）
node app/index.mjs render                # 干跑预览将生成的 unit（不改系统）
node app/index.mjs status                # 两服务状态 + 下次发现时刻
```

> `schedule.day`：weekly 用 cron 星期数字 0=周日..6=周六；monthly 用 1-28。详见 `service/app/config.example.jsonc`。

### 首次部署 / 迁移（含旧 /root/watch-account 迁移）

```bash
mv /root/watch-account /root/service     # 旧目录迁移（或 make sync 推到 /root/service）
cd /root/service && git pull
npm install ws undici https-proxy-agent
node app/index.mjs apply                 # 装好后 apply：自动迁移旧 watch-account.service
```

### 监听地址 / 发现配置（含密钥，本地维护）

```bash
vim /root/service/sodex-watch/config.json        # 多地址 + TG（HYPE-watch 同理）
vim /root/service/sodex-discovery/config.json    # 发现门槛 + TG（HYPE-discovery 同理）
# watch 改完：systemctl restart sodex-watch.service
# discovery 改完：下次 timer 触发即生效（或 systemctl start sodex-discovery.service 手动跑一次）

# START WATCH 门控：重启只对 config 新增地址推 START WATCH；已知地址不重推。
# 强制全部地址重推 START（如换了 TG 群、想重新对账）：删状态文件再重启
rm -f /root/service/sodex-watch/.seen-addresses.json && systemctl restart sodex-watch.service   # HYPE-watch 同理
```

---

## 底层 systemctl（按需）

```bash
systemctl start|stop|restart sodex-watch.service        # 监听服务
systemctl start sodex-discovery.service                 # 手动跑一次发现
systemctl status sodex-watch.service sodex-discovery.timer    # 两服务状态
systemctl enable|disable sodex-watch.service            # 监听自启
systemctl enable|disable sodex-discovery.timer          # 发现定时自启
systemctl list-timers sodex-discovery.timer             # 下次发现触发时刻

# 删（停止并移除）
systemctl disable --now sodex-watch.service && rm /etc/systemd/system/sodex-watch.service
systemctl disable --now sodex-discovery.timer && rm /etc/systemd/system/sodex-discovery.{timer,service}
systemctl daemon-reload
```

### 日志

```bash
journalctl -u sodex-watch.service -f                    # 监听实时
journalctl -u sodex-watch.service -n 50                 # 监听最近 50 行
journalctl -u sodex-discovery.service -n 80             # 最近一次发现
journalctl -u sodex-discovery.service --since "7 day ago"  # 近一周发现历史
```
