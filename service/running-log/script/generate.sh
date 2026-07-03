#!/usr/bin/env bash
# 服务运行日志聚合脚本 — 从 VPS journalctl 提取核心事件生成周报
# 用法: bash generate.sh [开始日期] [结束日期]  （默认最近 7 天，日期格式 YYYY-MM-DD）
set -u
HOST="${TRACKER_HOST:-root@107.172.90.184}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="$SCRIPT_DIR/../log"
mkdir -p "$LOG_DIR"
NOW_SH=$(TZ=Asia/Shanghai date '+%Y-%m-%d %H:%M')
TODAY_SH=$(TZ=Asia/Shanghai date '+%Y-%m-%d')

if [ $# -ge 2 ]; then SINCE_SH="$1"; UNTIL_SH="$2"
elif [ $# -eq 1 ]; then SINCE_SH="$1"; UNTIL_SH="$TODAY_SH"
else SINCE_SH=$(TZ=Asia/Shanghai date -v-7d '+%Y-%m-%d'); UNTIL_SH="$TODAY_SH"
fi

REPORT="$LOG_DIR/weekly-${UNTIL_SH}.md"
echo ">>> 范围: ${SINCE_SH} -> ${UNTIL_SH}"

# 在 VPS 上执行聚合（单次 SSH）
# 将查询脚本写到临时文件上传，避免 heredoc / quoting 问题
TMP_VPS="/tmp/tracker-report-$$.sh"
cat > "/tmp/_tracker_gen.sh" << 'SCRIPT'
#!/usr/bin/env bash
set -u
SINCE="$1"; UNTIL="$2"
svcs=(sodex-watch HYPE-watch HYPE-copy@demo-1 sodex-discovery HYPE-discovery)
for svc in "${svcs[@]}"; do
  log=$(journalctl -u "${svc}.service" --since="$SINCE" --until="$UNTIL" --no-pager 2>/dev/null || true)
  echo "@SVC $svc"
  echo "@RESTART $(echo "$log" | grep -c "Started ${svc}" 2>/dev/null || echo 0)"
  echo "@WSDC $(echo "$log" | grep -c 'CLOSE code=' 2>/dev/null || echo 0)"
  echo "@WSDIST"
  echo "$log" | grep 'CLOSE code=' | grep -oE '[A-Z][a-z]{2} [0-9]{2} [0-9]{2}:' | sort | uniq -c | sort -rn | head -10
  echo "@WSDIST_END"
  echo "@APIERR $(echo "$log" | grep -c -E 'WS ERROR|502|REST.*失败|限流|throttle' 2>/dev/null || echo 0)"
  echo "@ERRSAMPLE"
  echo "$log" | grep -E 'WS ERROR|502|REST.*失败|限流' | tail -5
  echo "@ERRSAMPLE_END"
  echo "@CRASH $(echo "$log" | grep -c -E 'Failed with result|exited.*status|非法|启动失败' 2>/dev/null || echo 0)"
  echo "@DEPLOY"
  echo "$log" | grep "Started ${svc}" | grep -oE '[A-Z][a-z]{2} [0-9]{2} [0-9]{2}:[0-9]{2}'
  echo "@DEPLOY_END"
  if echo "$svc" | grep -q copy; then
    echo "@SKIP"
    echo "$log" | grep -E 'skip-|启动失败|非法' | tail -10
    echo "@SKIP_END"
  fi
  echo "@END"
done
SCRIPT

scp -q "/tmp/_tracker_gen.sh" "${HOST}:${TMP_VPS}" 2>/dev/null || {
  echo "!!! 无法连接 VPS"
  rm -f "/tmp/_tracker_gen.sh"
  exit 1
}
RAW=$(ssh -o ConnectTimeout=5 "$HOST" "bash $TMP_VPS '$SINCE_SH' '$UNTIL_SH' && rm -f $TMP_VPS" 2>/dev/null)
rm -f "/tmp/_tracker_gen.sh"

if [ -z "$RAW" ]; then
  echo "!!! VPS 无日志数据"
  exit 1
fi

# ---------- 解析 ----------
get_field() { echo "$RAW" | grep "^@${1} " | head -1 | sed "s/^@${1} //" | tr -d ' '; }
get_block() {
  local start="@${1}" end="@${1}_END"
  echo "$RAW" | sed -n "/^${start}$/,/^${end}$/p" | grep -v "^@"
}

cat > "$REPORT" << EOF
# 服务运行周报 ${SINCE_SH} → ${UNTIL_SH}

> 生成时间：${NOW_SH}（上海时间）· VPS：${HOST}

## 概览

| 服务 | 重启 | WS断连 | API错误 | 崩溃 |
|------|:--:|:--:|:--:|:--:|
EOF

for svc in "sodex-watch" "HYPE-watch" "HYPE-copy@demo-1"; do
  sec=$(echo "$RAW" | sed -n "/^@SVC ${svc}$/,/^@END$/p")
  r=$(echo "$sec" | grep "^@RESTART " | sed 's/@RESTART //' | tr -d ' '); r=${r:-0}
  w=$(echo "$sec" | grep "^@WSDC " | sed 's/@WSDC //' | tr -d ' '); w=${w:-0}
  a=$(echo "$sec" | grep "^@APIERR " | sed 's/@APIERR //' | tr -d ' '); a=${a:-0}
  c=$(echo "$sec" | grep "^@CRASH " | sed 's/@CRASH //' | tr -d ' '); c=${c:-0}
  echo "| $svc | ${r} | ${w} | ${a} | ${c} |" >> "$REPORT"
done
echo "" >> "$REPORT"

# 部署时间线
echo "## 部署/重启时间线" >> "$REPORT"
for svc in "sodex-watch" "HYPE-watch" "HYPE-copy@demo-1" "sodex-discovery" "HYPE-discovery"; do
  sec=$(echo "$RAW" | sed -n "/^@SVC ${svc}$/,/^@END$/p" || true)
  [ -z "$sec" ] && continue
  r=$(echo "$sec" | grep "^@RESTART " | sed 's/@RESTART //' | tr -d ' '); r=${r:-0}
  deploys=$(echo "$sec" | sed -n '/^@DEPLOY$/,/^@DEPLOY_END$/p' | grep -v "^@")
  if [ -n "$deploys" ]; then
    echo "" >> "$REPORT"
    echo "**${svc}** — ${r} 次" >> "$REPORT"
    echo "$deploys" | while read -r ts; do
      [ -z "$ts" ] && continue
      echo "- \`${ts}\`" >> "$REPORT"
    done
  fi
done
echo "" >> "$REPORT"

# WS 断连分布
echo "## WS 断连分布" >> "$REPORT"
for svc in "sodex-watch" "HYPE-watch"; do
  sec=$(echo "$RAW" | sed -n "/^@SVC ${svc}$/,/^@END$/p" || true)
  [ -z "$sec" ] && continue
  w=$(echo "$sec" | grep "^@WSDC " | sed 's/@WSDC //' | tr -d ' '); w=${w:-0}
  if [ "$w" -gt 0 ]; then
    echo "" >> "$REPORT"
    echo "**${svc}** — ${w} 次" >> "$REPORT"
    echo '```' >> "$REPORT"
    echo "$sec" | sed -n '/^@WSDIST$/,/^@WSDIST_END$/p' | grep -v "^@" >> "$REPORT"
    echo '```' >> "$REPORT"
  fi
done
echo "" >> "$REPORT"

# API/WS 错误
echo "## API / WS 错误" >> "$REPORT"
for svc in "sodex-watch" "HYPE-watch" "HYPE-copy@demo-1"; do
  sec=$(echo "$RAW" | sed -n "/^@SVC ${svc}$/,/^@END$/p" || true)
  [ -z "$sec" ] && continue
  a=$(echo "$sec" | grep "^@APIERR " | sed 's/@APIERR //' | tr -d ' '); a=${a:-0}
  if [ "$a" -gt 0 ]; then
    echo "" >> "$REPORT"
    echo "**${svc}** — ${a} 条" >> "$REPORT"
    echo '```' >> "$REPORT"
    echo "$sec" | sed -n '/^@ERRSAMPLE$/,/^@ERRSAMPLE_END$/p' | grep -v "^@" >> "$REPORT"
    echo '```' >> "$REPORT"
  fi
done
echo "" >> "$REPORT"

# 业务异常
echo "## 业务异常" >> "$REPORT"
sec=$(echo "$RAW" | sed -n '/^@SVC HYPE-copy@demo-1$/,/^@END$/p' || true)
if [ -n "$sec" ]; then
  skips=$(echo "$sec" | sed -n '/^@SKIP$/,/^@SKIP_END$/p' | grep -v "^@" || true)
  if [ -n "$skips" ]; then
    echo "" >> "$REPORT"
    echo '```' >> "$REPORT"
    echo "$skips" >> "$REPORT"
    echo '```' >> "$REPORT"
  else
    echo "" >> "$REPORT"
    echo "无业务异常" >> "$REPORT"
  fi
fi
echo "" >> "$REPORT"

cat >> "$REPORT" << EOF
---
> 脚本 \`service/running-log/script/generate.sh\` · ${SINCE_SH} → ${UNTIL_SH}（上海时间）
EOF

echo ""
echo "=== 报告已生成 ==="
echo "文件：$REPORT"
wc -l < "$REPORT" | xargs echo "行数："