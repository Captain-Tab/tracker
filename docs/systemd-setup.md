# systemd 持久化部署

## 服务文件说明

```
[Unit]
Description=Sodex Account Watcher    ← 服务名称
After=network-online.target          ← 等网络就绪
After=warp-svc.service               ← 等 WARP 代理先启动
Requires=warp-svc.service            ← WARP 挂了服务也跟着停

[Service]
Type=simple                          ← 简单进程，启动即运行
ExecStart=node /root/watch-account/script/watch-account.mjs --config=/root/watch-account/script/watch.config.json
                                     ← 多地址：读 config（推荐）；单地址改为 .../watch-account.mjs <地址>
Environment=HTTP_PROXY=http://127.0.0.1:40000    ← 让脚本走 WARP
Environment=HTTPS_PROXY=http://127.0.0.1:40000
Restart=always                       ← 挂了自动重启
RestartSec=10                        ← 等 10 秒再重启

[Install]
WantedBy=multi-user.target           ← 开机自启
```

## 启动链

```
VPS 重启 → warp-svc 先启动 → watch-account 后启动 → 全部自动恢复
```

## 一键部署

```bash
bash /root/watch-account/setup/setup-systemd.sh
```

或手动创建（替换 `<地址>` 和可选 Telegram 参数）：

```bash
cat > /etc/systemd/system/watch-account.service << 'EOF'
[Unit]
Description=Sodex Account Watcher
After=network-online.target
After=warp-svc.service
Requires=warp-svc.service

[Service]
Type=simple
ExecStart=/usr/bin/node /root/watch-account/script/watch-account.mjs --config=/root/watch-account/script/watch.config.json
Environment=HTTP_PROXY=http://127.0.0.1:40000
Environment=HTTPS_PROXY=http://127.0.0.1:40000
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable watch-account
systemctl start watch-account
systemctl status watch-account
```

**多地址（推荐）**：用 `--config=script/watch.config.json`，一进程盯多个地址、各推各的 Telegram 会话。配置含 bot token / chat_id，**不入 git**（已加 `.gitignore`），仅 VPS 本地存在。格式（`script/watch.config.json`）：

```json
{
  "tgToken": "全局默认 bot token",
  "watches": [
    { "address": "0xA…", "tgChat": "会话1", "label": "xiao", "at": "20:00" },
    { "address": "0xB…", "tgChat": "会话2", "tgToken": "可选覆盖此地址的 bot" }
  ]
}
```

> 地址项可选字段：`tgToken`（覆盖全局 bot）、`label`（banner 头别名）、`at`（该地址每日镜像时刻 `HH:MM`，错峰用；缺省取全局 `--at` 或默认 `20:00`）。

**单地址（向后兼容）**：ExecStart 改 `.../watch-account.mjs <地址> --tg-token=xxx --tg-chat=xxx`；无 Telegram 则去掉 tg 参数。

## 前置依赖

```bash
cd /root/watch-account && npm install ws          # 硬依赖
# 走 WARP 代理另需：npm install undici https-proxy-agent
```

## 运维命令

```bash
systemctl status watch-account       # 运行状态
systemctl restart watch-account      # 重启
systemctl stop watch-account         # 停止
systemctl disable watch-account      # 取消开机自启
journalctl -u watch-account -f       # 实时日志
journalctl -u watch-account -n 50    # 最近 50 行
```

## 效果

崩溃自动重启、VPS 重启自动拉起、日志统一管理、7×24 长驻、流量走 WARP 代理。
