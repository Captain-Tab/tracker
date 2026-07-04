#!/bin/bash
# HYPE-copy 一键部署脚本（本地执行，推代码 + 重启服务 + 快速验证）
# 用法: bash setup/deploy-copy.sh [sync|restart|status|logs|log-jsonl]
set -e

HOST="root@107.172.90.184"
REMOTE_DIR="/root/service"

_ssh() { ssh "$HOST" "$@"; }

case "${1:-sync}" in
  sync)
    echo ">>> 同步 service/ 代码到 VPS（排除 config.json）..."
    rsync -avz --exclude='*/config.json' --exclude='*-discovery/log/' \
      "$(cd "$(dirname "$0")/../service" && pwd)/" "$HOST:$REMOTE_DIR/"
    echo ">>> 推送 targets.json + sodex-watch config..."
    rsync -avz ../service/HYPE-copy/targets.json "$HOST:$REMOTE_DIR/HYPE-copy/"
    rsync -avz ../service/sodex-watch/config.json "$HOST:$REMOTE_DIR/sodex-watch/"
    echo ">>> 修复权限 + 重启全部服务..."
    _ssh "
      chown trader-exec:trader-exec /root/service/HYPE-copy/targets.json
      chmod 600 /root/service/HYPE-copy/targets.json
      systemctl restart sodex-watch HYPE-watch HYPE-copy@demo-1.service
    "
    sleep 3
    echo ">>> 服务状态..."
    _ssh "systemctl is-active sodex-watch HYPE-watch HYPE-copy@demo-1.service"
    echo ""
    echo ">>> HYPE-copy 启动日志..."
    _ssh "journalctl -u HYPE-copy@demo-1.service -n 15 --no-pager"
    ;;

  restart)
    echo ">>> 重启所有 watch + copy 服务..."
    _ssh "systemctl restart sodex-watch HYPE-watch HYPE-copy@demo-1.service"
    echo ">>> 服务状态..."
    _ssh "systemctl is-active sodex-watch HYPE-watch HYPE-copy@demo-1.service"
    ;;

  status)
    _ssh "cd $REMOTE_DIR && node app/index.mjs status"
    echo ""
    _ssh "systemctl list-timers HYPE-copy-expiry.timer --no-pager"
    ;;

  logs)
    _ssh "journalctl -u HYPE-copy@demo-1.service -f"
    ;;

  log-jsonl)
    _ssh "tail -f $REMOTE_DIR/HYPE-copy/log/HYPE-copy-demo-1-\$(date +%F).jsonl"
    ;;

  *)
    echo "用法: bash setup/deploy-copy.sh <命令>"
    echo ""
    echo "  sync        推代码 + 重启 HYPE-copy（默认）"
    echo "  restart     重启所有 watch + copy 服务"
    echo "  status      查看服务状态 + timer"
    echo "  logs        实时 journal 日志"
    echo "  log-jsonl   实时 JSONL 业务日志"
    exit 1
    ;;
esac
