# VPS 部署命令

> VPS: `root@107.172.90.184` / 代码路径: `/root/service/`（= 本地 `service/`）
> 两个服务：`watch.service`（长驻监听）+ `discovery.timer`/`discovery.service`（周期发现），由 `service/app/` 编排层经 systemd 集中管理。

## 本地快捷命令（项目 `setup/` 目录下执行）

```bash
make sync            # 推送 service/ 代码到 VPS /root/service（排除 config/log）
make sync-config     # 单独推送 watch/discovery 密钥配置（app/config.json 不推，服务器自管）
make pull            # 从 VPS 拉回代码
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
vim /root/service/watch/config.json        # 多地址 + TG
vim /root/service/discovery/config.json    # 发现门槛 + TG
# watch 改完：systemctl restart watch.service
# discovery 改完：下次 timer 触发即生效（或 systemctl start discovery.service 手动跑一次）
```

---

## 底层 systemctl（按需）

```bash
systemctl start|stop|restart watch.service        # 监听服务
systemctl start discovery.service                 # 手动跑一次发现
systemctl status watch.service discovery.timer    # 两服务状态
systemctl enable|disable watch.service            # 监听自启
systemctl enable|disable discovery.timer          # 发现定时自启
systemctl list-timers discovery.timer             # 下次发现触发时刻

# 删（停止并移除）
systemctl disable --now watch.service && rm /etc/systemd/system/watch.service
systemctl disable --now discovery.timer && rm /etc/systemd/system/discovery.{timer,service}
systemctl daemon-reload
```

### 日志

```bash
journalctl -u watch.service -f                    # 监听实时
journalctl -u watch.service -n 50                 # 监听最近 50 行
journalctl -u discovery.service -n 80             # 最近一次发现
journalctl -u discovery.service --since "7 day ago"  # 近一周发现历史
```
