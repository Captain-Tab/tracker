# systemd 持久化部署（app 编排层）

代码部署在 VPS **`/root/service/`**（= 本地 `service/` 同步过来），两个服务由 `service/app/` 编排层经 systemd 集中管理，**进程隔离、互不影响**：

| 服务 | 性质 | systemd 单元 |
| --- | --- | --- |
| **watch** | 7×24 长驻监听（WS 长连） | `watch.service`（Restart=always） |
| **discovery** | 周期批处理（每周/每月，跑完即退） | `discovery.service`(oneshot) + `discovery.timer` |

开关与调度集中在 `/root/service/app/config.json`，由 `node app/index.mjs` 翻译成 systemd 单元。

## 一键部署

```bash
cd /root/service && bash /root/service-repo/setup/setup-systemd.sh   # 或直接：
cd /root/service && npm install ws undici https-proxy-agent && node app/index.mjs apply && node app/index.mjs status
```

本地一键（项目 `setup/` 下）：`make deploy`（推 `service/` → VPS `/root/service/` 后装依赖 + apply）。

## 集中开关 + 调度：`/root/service/app/config.json`

```json
{
  "watch": { "enabled": true },
  "discovery": {
    "enabled": true,
    "schedule": { "freq": "weekly", "day": 1, "hour": 9 }
  },
  "deploy": { "proxyUrl": "http://127.0.0.1:40000", "requiresWarp": true }
}
```

> JSON 不能写注释，填写参考见 `service/app/config.example.jsonc`（committed，枚举全部取值）。

- `enabled`：各服务独立开关（缺文件 → 默认 both on）。
- `schedule.freq`：`weekly` | `monthly` | `daily`。
- `schedule.day`（按 freq）：
  - **weekly** → 星期数字（cron 习惯）：`0`=周日 `1`=周一 `2`=周二 `3`=周三 `4`=周四 `5`=周五 `6`=周六
  - **monthly** → `1..28`（避开 29-31，防月份缺失）
  - **daily** → 忽略
- `schedule.hour`：`0..23` 整点。**时区固定 Asia/Shanghai**（OnCalendar 显式后缀，不依赖系统时区）。
- `deploy.proxyUrl`：WARP 代理地址（写入单元 `HTTP_PROXY`）；`requiresWarp`：是否依赖 `warp-svc.service`。
- 含开关/调度、**无密钥** → 入 `.gitignore`，服务器本地维护（改完重跑 `app apply`）。

## app 编排 CLI（VPS 上 cwd=`/root/service`）

```bash
node app/index.mjs render    # 干跑：打印将生成的 unit + 计划动作（本机/任意机可跑，不调 systemctl）
node app/index.mjs apply     # 写变化的 unit → 启停 → 仅内容变才 restart → 迁移旧单元（root + systemd）
node app/index.mjs status    # config + watch.service / discovery.timer 状态 + 下次触发
```

> 本机（开发机，无 systemd）只能跑 `render`（在仓库根用 `node service/app/index.mjs render`）；`apply`/`status` 仅 systemd 服务器可用。

- **幂等**：`apply` 仅在 unit 内容变化时 `restart`——改 discovery 调度不会重启正在跑的 watch（不断 WS）。
- **迁移**：`apply` 检测旧 `watch-account.service` → `disable --now` + 删除（防与新 `watch.service` 双开）。

## 单独控制某服务

```bash
# 关 discovery 仅留 watch：app/config.json 设 discovery.enabled=false，然后
node app/index.mjs apply
# 改 discovery 每周时间（如改周三 10 点）：schedule={freq:"weekly",day:3,hour:10}，重跑 apply（watch 不受影响）
```

## 监听地址 / 发现配置（含密钥，不入 git）

- `/root/service/watch/config.json`：多地址监听 + Telegram。
- `/root/service/discovery/config.json`：发现门槛 + Telegram chat。

watch 多地址格式：

```json
{
  "tgToken": "全局默认 bot token",
  "watches": [
    { "address": "0xA…", "tgChat": "会话1", "label": "xiao", "at": "20:00" },
    { "address": "0xB…", "tgChat": "会话2", "tgToken": "可选覆盖此地址的 bot" }
  ]
}
```

## 前置依赖

```bash
cd /root/service && npm install ws undici https-proxy-agent
# ws 硬依赖；undici=fetch 走 WARP；https-proxy-agent=WS 走 WARP
```

## 运维命令

```bash
systemctl status watch.service discovery.timer   # 两服务状态
systemctl restart watch.service                  # 重启监听
journalctl -u watch.service -f                   # 实时监听日志
journalctl -u discovery.service -n 80            # 最近一次发现日志
systemctl list-timers discovery.timer            # 下次发现触发时刻
```

或本地 `make`：`make status` / `make logs-watch` / `make logs-discovery` / `make app-apply` / `make app-status`。

## 从旧部署迁移（/root/watch-account → /root/service）

旧版：`/root/watch-account/script/`（含已重组删除的 `watch-account.mjs`）+ 手写 `watch-account.service`。迁移：

```bash
# VPS 上：迁移目录 + 拉新代码到 /root/service（本地 make deploy 会自动推到 /root/service）
mv /root/watch-account /root/service   # 或重新 git clone / make sync 到 /root/service
cd /root/service && git pull
npm install ws undici https-proxy-agent
node app/index.mjs apply               # 自动 disable+删除旧 watch-account.service，建 watch.service + discovery
```

## 效果

崩溃自动重启、VPS 重启自动拉起、两服务进程隔离、discovery 漏跑补偿（`Persistent=true`）、流量走 WARP 代理、开关/调度集中一处。
