#!/bin/bash
# systemd 持久化部署脚本 — 填入配置后复制到 VPS 执行
#
# 配置区（按实际情况填写）
# ======================================================
# 两种模式二选一：
#   A. 单地址：填 WALLET_ADDRESS，留空 CONFIG_PATH
#   B. 多地址：填 CONFIG_PATH，留空 WALLET_ADDRESS

WALLET_ADDRESS=""                                    # 单地址模式：监听的钱包地址
CONFIG_PATH="/root/watch-account/script/watch.config.json"  # 多地址模式：配置文件路径
TG_TOKEN=""                                           # 单地址模式 Telegram Bot Token（可选）
TG_CHAT=""                                            # 单地址模式 Telegram Chat ID（可选）

# ======================================================

# 组装命令参数
if [ -n "${CONFIG_PATH}" ]; then
  NODE_CMD="/usr/bin/node /root/watch-account/script/watch-account.mjs --config=${CONFIG_PATH}"
else
  NODE_CMD="/usr/bin/node /root/watch-account/script/watch-account.mjs ${WALLET_ADDRESS}"
  [ -n "${TG_TOKEN}" ] && NODE_CMD="${NODE_CMD} --tg-token=${TG_TOKEN}"
  [ -n "${TG_CHAT}" ] && NODE_CMD="${NODE_CMD} --tg-chat=${TG_CHAT}"
fi

cat > /etc/systemd/system/watch-account.service << END
[Unit]
Description=Sodex Account Watcher
After=network-online.target
After=warp-svc.service
Requires=warp-svc.service
Wants=network-online.target

[Service]
Type=simple
ExecStart=${NODE_CMD}
Environment=HTTP_PROXY=http://127.0.0.1:40000
Environment=HTTPS_PROXY=http://127.0.0.1:40000
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
END

systemctl daemon-reload
systemctl enable watch-account
systemctl start watch-account
systemctl status watch-account --no-pager
