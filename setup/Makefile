.PHONY: sync sync-config pull deploy app-apply app-status status logs-watch logs-discovery restart-watch

HOST := root@107.172.90.184
REMOTE_DIR := /root/service
SERVICE_DIR := ../service

# 推送 service 代码到 VPS（排除含密钥/开关的 config.json 与 log/，由服务器本地维护）
sync:
	rsync -avz --exclude='*/config.json' --exclude='discovery/log/' $(SERVICE_DIR)/ $(HOST):$(REMOTE_DIR)/

# 单独推送密钥配置（watch / discovery，含 TG 凭据；app/config.json 不推，服务器自管开关）
sync-config:
	rsync -avz $(SERVICE_DIR)/watch/config.json $(HOST):$(REMOTE_DIR)/watch/
	rsync -avz $(SERVICE_DIR)/discovery/config.json $(HOST):$(REMOTE_DIR)/discovery/

# 从 VPS 拉回代码（同样排除 config/log）
pull:
	rsync -avz --exclude='*/config.json' --exclude='discovery/log/' $(HOST):$(REMOTE_DIR)/ $(SERVICE_DIR)/

# 一键部署：推代码 + 服务器装依赖并 app apply（自动迁移旧单元）
deploy: sync
	ssh $(HOST) "cd $(REMOTE_DIR) && npm install ws undici https-proxy-agent && node app/index.mjs apply && node app/index.mjs status"

# app 编排：按 app/config.json 同步两个服务
app-apply:
	ssh $(HOST) "cd $(REMOTE_DIR) && node app/index.mjs apply"

app-status:
	ssh $(HOST) "cd $(REMOTE_DIR) && node app/index.mjs status"

# 两个服务运行状态
status:
	ssh $(HOST) "systemctl status watch.service discovery.timer --no-pager"

# 实时监听日志
logs-watch:
	ssh $(HOST) "journalctl -u watch.service -f"

# 最近一次发现运行日志
logs-discovery:
	ssh $(HOST) "journalctl -u discovery.service -n 80 --no-pager"

# 重启监听服务
restart-watch:
	ssh $(HOST) "systemctl restart watch.service"
