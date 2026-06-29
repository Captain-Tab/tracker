#!/bin/bash
# HYPE-copy 跟单执行器一次性环境准备（VPS 执行，root）。dry-run，不碰真钱/密钥。
# 做三件需 root 的事：建写侧用户 trader-exec、建跟单信号目录(默认)、收敛 targets.json 权限。
# 唯一需人手填的 = HYPE-copy/targets.json 的业务内容（目标地址/token），脚本结束有提示。
# 用法：sudo bash setup/setup-copy.sh
set -e

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"   # = service/ 根（VPS 上即 /root/service）
SIGNAL_DIR="/var/lib/tracker/copy-signal"      # 与 lib/copy-signal DEFAULT_SIGNAL_DIR 一致
TARGETS="$ROOT_DIR/HYPE-copy/targets.json"

echo "[1/3] 写侧用户 trader-exec（已存在则跳过）"
id trader-exec &>/dev/null || useradd --system --no-create-home --shell /usr/sbin/nologin trader-exec

echo "[2/3] 跟单信号目录 $SIGNAL_DIR（tracker 写、人人可读；信号非敏感，用 0755 省去建组）"
install -d -o tracker -m 0755 "$SIGNAL_DIR"
#  install -d  建目录 | -o tracker 属主=watch 用户(能写) | -m 0755 人人可读、仅 tracker 可写

echo "[3/3] targets.json 权限收敛（仅 trader-exec 可读，含 agentKeyRef 占位）"
if [ -f "$TARGETS" ]; then
  chown trader-exec:trader-exec "$TARGETS"
  chmod 600 "$TARGETS"
  echo "  已 chown trader-exec + chmod 600"
else
  echo "  ⚠️ 未找到 $TARGETS —— 请先按 HYPE-copy/targets.example.jsonc 创建后重跑本步（或手动 chmod 600）"
fi

cat <<EOF

✅ 环境就绪。接下来（需人手填 / 改 config）：
  1. 填业务配置：cp HYPE-copy/targets.example.jsonc HYPE-copy/targets.json
     → 去注释改纯 JSON，填 source.address(被跟目标) / availBalanceSim / tgToken；填完重跑本脚本第 3 步收敛权限
  2. 开事件驱动（可选）：在 {sodex,HYPE}-watch/config.json 加一行 "copySignal": true
     → watch 即向 $SIGNAL_DIR/<address>.json 写信号；copy 自动派生订阅（无需在 targets.json 填路径）
  3. 开执行器：app/config.json 设 "hypeCopy": { "enabled": true, "targets": ["<target.id>"] }
     → node app/index.mjs apply
  4. 验证：journalctl -u HYPE-copy@<id> -f
详见 docs/deploy/hype-copy.md
EOF
