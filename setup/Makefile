.PHONY: sync sync-config pull logs-f logs status restart

HOST := root@107.172.90.184
REMOTE_DIR := /root/watch-account
SCRIPT_DIR := ../script

# 推送脚本到 VPS（watch-account.mjs）
sync:
	rsync -avz $(SCRIPT_DIR)/watch-account.mjs $(HOST):$(REMOTE_DIR)/script/

# 推送配置文件到 VPS（含 TG 凭据，不入 git）
sync-config:
	rsync -avz $(SCRIPT_DIR)/watch.config.json $(HOST):$(REMOTE_DIR)/script/

# 从 VPS 拉回文件
pull:
	rsync -avz $(HOST):$(REMOTE_DIR)/script/watch-account.mjs $(SCRIPT_DIR)/
	rsync -avz $(HOST):$(REMOTE_DIR)/script/watch.config.json $(SCRIPT_DIR)/

# VPS 上查看状态
status:
	ssh $(HOST) "systemctl status watch-account --no-pager"

# VPS 上查看日志（最后 50 行）
logs:
	ssh $(HOST) "journalctl -u watch-account -n 50 --no-pager"

# VPS 上实时日志
logs-f:
	ssh $(HOST) "journalctl -u watch-account -f"

# VPS 上重启服务
restart:
	ssh $(HOST) "systemctl restart watch-account"
