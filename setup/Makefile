.PHONY: sync sync-config pull pull-logs deploy app-apply app-status status logs-watch logs-discovery logs-hype-watch logs-hype-discovery restart-watch restart-hype-watch

HOST := root@107.172.90.184
REMOTE_DIR := /root/service
SERVICE_DIR := ../service

# 推送 service 代码到 VPS（排除含密钥/开关的 config.json 与 log/，由服务器本地维护）
sync:
	rsync -avz --exclude='*/config.json' --exclude='*-discovery/log/' $(SERVICE_DIR)/ $(HOST):$(REMOTE_DIR)/

# 单独推送密钥配置（sodex / HYPE 的 watch + discovery，含 TG 凭据；app/config.json 不推，服务器自管开关）
sync-config:
	rsync -avz $(SERVICE_DIR)/sodex-watch/config.json $(HOST):$(REMOTE_DIR)/sodex-watch/
	rsync -avz $(SERVICE_DIR)/sodex-discovery/config.json $(HOST):$(REMOTE_DIR)/sodex-discovery/
	rsync -avz $(SERVICE_DIR)/HYPE-watch/config.json $(HOST):$(REMOTE_DIR)/HYPE-watch/
	rsync -avz $(SERVICE_DIR)/HYPE-discovery/config.json $(HOST):$(REMOTE_DIR)/HYPE-discovery/

# 从 VPS 拉回代码（同样排除 config/log）
pull:
	rsync -avz --exclude='*/config.json' --exclude='*-discovery/log/' $(HOST):$(REMOTE_DIR)/ $(SERVICE_DIR)/

# 下载 discovery 日志到本地（sodex + HYPE）
pull-logs:
	mkdir -p $(SERVICE_DIR)/sodex-discovery/log $(SERVICE_DIR)/HYPE-discovery/log
	scp $(HOST):$(REMOTE_DIR)/sodex-discovery/log/discovery-*.{json,md} $(SERVICE_DIR)/sodex-discovery/log/
	scp $(HOST):$(REMOTE_DIR)/HYPE-discovery/log/discovery-*.{json,md} $(SERVICE_DIR)/HYPE-discovery/log/

# 一键部署：推代码 + 服务器装依赖并 app apply（自动迁移旧单元）
deploy: sync
	ssh $(HOST) "cd $(REMOTE_DIR) && npm install ws undici https-proxy-agent && node app/index.mjs apply && node app/index.mjs status"

# app 编排：按 app/config.json 同步两个服务
app-apply:
	ssh $(HOST) "cd $(REMOTE_DIR) && node app/index.mjs apply"

app-status:
	ssh $(HOST) "cd $(REMOTE_DIR) && node app/index.mjs status"

# 四个服务运行状态
status:
	ssh $(HOST) "systemctl status sodex-watch.service sodex-discovery.timer HYPE-watch.service HYPE-discovery.timer --no-pager"

# 实时监听日志（sodex / HYPE）
logs-watch:
	ssh $(HOST) "journalctl -u sodex-watch.service -f"
logs-hype-watch:
	ssh $(HOST) "journalctl -u HYPE-watch.service -f"

# 最近一次发现运行日志（sodex / HYPE）
logs-discovery:
	ssh $(HOST) "journalctl -u sodex-discovery.service -n 80 --no-pager"
logs-hype-discovery:
	ssh $(HOST) "journalctl -u HYPE-discovery.service -n 80 --no-pager"

# 重启监听服务（sodex / HYPE）
restart-watch:
	ssh $(HOST) "systemctl restart sodex-watch.service"
restart-hype-watch:
	ssh $(HOST) "systemctl restart HYPE-watch.service"
