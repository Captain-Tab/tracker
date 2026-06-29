#!/bin/bash
# systemd 部署（薄壳）：在 VPS 执行。代码部署在 /root/service/（= 本地 service/ 同步过来）。
# 装依赖 + 由 app 编排层按 config 生成/启停四个服务（sodex/HYPE × watch+discovery），并迁移旧单元。
# 开关/调度改 /root/service/app/config.json（缺则默认 both on）。
set -e

cd /root/service

echo "[1/3] 安装依赖（watch/discovery: ws undici https-proxy-agent；HYPE-copy 执行器: decimal.js @nktkas/hyperliquid）"
npm install ws undici https-proxy-agent decimal.js @nktkas/hyperliquid

echo "[2/3] app apply：生成/同步 systemd 单元（自动迁移旧 watch.service/discovery.* 等单元）"
node app/index.mjs apply

echo "[3/3] 状态"
node app/index.mjs status

# 提示：
#   - 单独开关/改调度：编辑 /root/service/app/config.json 后重跑 `node app/index.mjs apply`
#   - 监听地址：/root/service/{sodex,HYPE}-watch/config.json（多地址 + TG，含密钥不入 git）
#   - 发现配置：/root/service/{sodex,HYPE}-discovery/config.json（TG，含密钥不入 git）
#   - 两 discovery 务必错峰（app/config.json 的 discovery / hypeDiscovery 设不同 hour），app render/apply 会对相同 OnCalendar 告警
#
# HYPE-copy 跟单执行器（dry-run；默认 hypeCopy.enabled=false，不启）：
#   - 开启：app/config.json 设 hypeCopy.enabled=true + targets:["<id>"]，重跑 apply（装 HYPE-copy@<id>.service）
#   - 写侧用户：sudo useradd --system --no-create-home --shell /usr/sbin/nologin trader-exec
#   - 配置：HYPE-copy/targets.json（单目标，按 targets.example.jsonc；含 agentKeyRef，chmod 600 + chown trader-exec）
#   - 事件驱动（可选）：watch config.json 加 copySignalDir，targets.json 加 copySignalPath 指向同一文件；
#     信号目录 sudo install -d -o tracker -g <共享组> -m 0750 <copySignalDir> 且 trader-exec 入组（详见 docs/copy/core-flow.md）
#   - 详见 docs/copy/hype-go-live.md（dry-run→实盘缺口）
