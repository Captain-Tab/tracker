#!/bin/bash
# systemd 持久化部署脚本 — 填入配置后复制到 VPS 执行
#
# 配置区（按实际情况填写）
# ======================================================

WALLET_ADDRESS="0x"                                  # 监听的钱包地址
TG_TOKEN=""                                           # Telegram Bot Token（可选）
TG_CHAT=""                                            # Telegram Chat ID（可选）

# ======================================================

# 组装命令参数
NODE_CMD="/usr/bin/node /root/watch-account/script/watch-account.mjs ${WALLET_ADDRESS}"
[ -n "${TG_TOKEN}" ] && NODE_CMD="${NODE_CMD} --tg-token=${TG_TOKEN}"
[ -n "${TG_CHAT}" ] && NODE_CMD="${NODE_CMD} --tg-chat=${TG_CHAT}"

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
