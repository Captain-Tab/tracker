#!/bin/bash
# HYPE-copy 跟单执行器一键部署（VPS 执行，sudo）。dry-run，不碰真钱/密钥。
# 唯一需你手填的文件 = HYPE-copy/targets.json（业务数据：被跟目标地址 / 模拟余额 / token）。
# 其余全自动：建 trader-exec、建信号目录(=默认开事件驱动)、收敛权限、启用 hypeCopy、apply 启服务。
# 用法：① cp HYPE-copy/targets.example.jsonc HYPE-copy/targets.json 并填好  ② sudo bash setup/setup-copy.sh
set -e

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"   # = service/ 根（VPS 上即 /root/service）
SIGNAL_DIR="/var/lib/tracker/copy-signal"      # 与 lib/copy-signal DEFAULT_SIGNAL_DIR 一致
TARGETS="$ROOT_DIR/HYPE-copy/targets.json"
APP_CONFIG="$ROOT_DIR/app/config.json"

echo "[1/5] 写侧用户 trader-exec（已存在则跳过）"
id trader-exec &>/dev/null || useradd --system --no-create-home --shell /usr/sbin/nologin trader-exec

echo "[2/5] 信号目录 $SIGNAL_DIR（0755；目录存在即默认开事件驱动，watch/copy 自动用）"
install -d -o tracker -m 0755 "$SIGNAL_DIR"

if [ ! -f "$TARGETS" ]; then
  echo "❌ 未找到 $TARGETS"
  echo "   请先：cp $ROOT_DIR/HYPE-copy/targets.example.jsonc $TARGETS"
  echo "   去注释改纯 JSON、填 source.address / availBalanceSim / tgToken，再重跑本脚本。"
  exit 1
fi

echo "[3/5] targets.json 权限收敛（仅 trader-exec 可读）"
chown trader-exec:trader-exec "$TARGETS"
chmod 600 "$TARGETS"

echo "[4/5] 读 target.id 并在 app/config.json 启用 hypeCopy（合并，不动其它服务开关）"
TARGET_ID="$(node -e "const t=require('$TARGETS').targets; const id=t&&t[0]&&t[0].id; if(!id){console.error('targets[0].id 缺失');process.exit(1)} process.stdout.write(String(id))")"
if [ -z "$TARGET_ID" ]; then echo "❌ targets.json 的 targets[0].id 为空，请检查后重跑"; exit 1; fi
node -e "
const fs=require('fs'); const p='$APP_CONFIG';
const c = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p,'utf8')) : {};
c.hypeCopy = { enabled: true, targets: ['$TARGET_ID'] };
fs.writeFileSync(p, JSON.stringify(c, null, 2) + '\n');
console.log('  hypeCopy.enabled=true targets=[$TARGET_ID]');
"

echo "[5/5] app apply：生成/启动 HYPE-copy@$TARGET_ID.service"
if command -v systemctl >/dev/null 2>&1; then
  node "$ROOT_DIR/app/index.mjs" apply
else
  echo "  ⚠️ 无 systemctl（非 systemd 机器）→ 跳过 apply；在 VPS 上重跑或手动 node app/index.mjs apply"
fi

cat <<EOF

✅ 部署完成（dry-run）。target=$TARGET_ID
  事件驱动：信号目录已建 → watch（重启后）自动写信号、copy 自动订阅；无需改 watch config。
  关闭事件驱动（如需）：watch config.json 设 "copySignal": false。
  验证：
    journalctl -u HYPE-copy@$TARGET_ID -f
    tail -f $ROOT_DIR/HYPE-copy/log/HYPE-copy-$TARGET_ID-\$(date +%F).jsonl
  注意：watch 服务需重启一次才会按"信号目录已存在"自动开始发信号（systemctl restart sodex-watch / HYPE-watch）。
详见 docs/deploy/hype-copy.md
EOF
