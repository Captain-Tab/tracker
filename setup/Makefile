.PHONY: sync pull push logs status restart

HOST := root@107.172.90.184
REMOTE_DIR := /root/watch-account
SCRIPT_DIR := ../script
DOCS_DIR := ../docs
SETUP_DIR := ../setup

# 推送文件到 VPS
sync:
	rsync -avz $(SCRIPT_DIR)/*.mjs $(HOST):$(REMOTE_DIR)/script/
	rsync -avz $(DOCS_DIR)/*.md $(HOST):$(REMOTE_DIR)/docs/
	rsync -avz $(SETUP_DIR)/*.sh $(HOST):$(REMOTE_DIR)/setup/

# 从 VPS 拉回文件
pull:
	rsync -avz $(HOST):$(REMOTE_DIR)/script/*.mjs $(SCRIPT_DIR)/
	rsync -avz $(HOST):$(REMOTE_DIR)/docs/*.md $(DOCS_DIR)/
	rsync -avz $(HOST):$(REMOTE_DIR)/setup/*.sh $(SETUP_DIR)/

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
