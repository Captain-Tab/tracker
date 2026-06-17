#!/bin/bash
# codex-watch.sh - Codex 审核监听生命周期（供 /k:codex-on / /k:codex-off）
# 用法: bash codex-watch.sh <watch|watch-stop|watch-list> [PR] [first-delay]
#
# 关键约定:
# - 全程 unset GITHUB_TOKEN: 失效 token 会盖掉 keyring 有效 token 导致 401
# - watch 是阻塞循环, 由 /k:codex-on 用 run_in_background 拉起; 进程自己写/清 PID marker
# - 完成信号只看 codex_review 离开 pending (Codex 是主审)
# - 轮询节奏(实测端到端 4-8min): 0-5min 不查; 5min 首查; 之后每 5min; 20min 后每 3min; 30min 超时

unset GITHUB_TOKEN

CMD="${1:-}"

STATE_DIR="${TMPDIR:-/tmp}/codex-watch"
mkdir -p "$STATE_DIR"

# 轮询节奏常量(秒)
FIRST_DELAY=300      # 首查点 5min
INTERVAL_EARLY=300   # 5-20min 每 5min
INTERVAL_LATE=180    # 20min 后 每 3min
PHASE_SWITCH=1200    # 20min 切换点
TIMEOUT=1800         # 30min 超时

detect_pr() { gh pr view --json number -q .number 2>/dev/null; }

# 查 codex_review 的 bucket, 非 pending 即视为完成
# check 名跨仓不一致: sodex-web 是 "codex_review", sodex-next 是 "codex / codex_review"
# 故用包含匹配而非精确匹配; 多条命中取第一条
codex_bucket() {
  gh pr checks "$1" --json name,bucket \
    -q 'first(.[] | select(.name | contains("codex_review")) | .bucket) // empty' 2>/dev/null
}

case "$CMD" in
  # 阻塞轮询: 盯到 codex_review 离开 pending 即退出 (由 codex-on 后台拉起)
  watch)
    PR="${2:-$(detect_pr)}"
    [ -z "$PR" ] && { echo "ERR: 无法探测 PR" >&2; exit 1; }
    DELAY="${3:-$FIRST_DELAY}"

    PIDFILE="$STATE_DIR/pr-$PR.pid"
    echo "$$" > "$PIDFILE"
    trap 'rm -f "$PIDFILE"' EXIT

    ELAPSED=0
    # 0 -> 首查点: 静默等待
    sleep "$DELAY"
    ELAPSED="$DELAY"

    while true; do
      BUCKET="$(codex_bucket "$PR")"
      if [ -n "$BUCKET" ] && [ "$BUCKET" != "pending" ]; then
        echo "CODEX_WATCH_DONE PR=$PR codex_review=$BUCKET"
        exit 0
      fi
      if [ "$ELAPSED" -ge "$TIMEOUT" ]; then
        echo "CODEX_WATCH_TIMEOUT PR=$PR elapsed=${ELAPSED}s"
        exit 0
      fi
      if [ "$ELAPSED" -lt "$PHASE_SWITCH" ]; then
        INT="$INTERVAL_EARLY"
      else
        INT="$INTERVAL_LATE"
      fi
      sleep "$INT"
      ELAPSED=$((ELAPSED + INT))
    done
    ;;

  # 停止 watcher: 传 PR 停指定, 不传停全部
  watch-stop)
    PR="${2:-}"
    if [ -z "$PR" ]; then
      any=0
      for f in "$STATE_DIR"/pr-*.pid; do
        [ -e "$f" ] || continue
        any=1
        name="$(basename "$f" .pid)"
        # 区分真停掉活进程 vs 仅清理残留 marker, 避免误报"已停止"
        if kill "$(cat "$f")" 2>/dev/null; then
          echo "已停止 $name"
        else
          echo "清理残留 marker $name"
        fi
        rm -f "$f"
      done
      [ "$any" = 0 ] && echo "无运行中的 watcher"
      exit 0
    fi
    PIDFILE="$STATE_DIR/pr-$PR.pid"
    if [ -f "$PIDFILE" ]; then
      kill "$(cat "$PIDFILE")" 2>/dev/null || true
      rm -f "$PIDFILE"
      echo "已停止监听 PR #$PR"
    else
      echo "未在监听 PR #$PR"
    fi
    ;;

  # 列出运行中的 watcher, 顺手清理死 marker
  watch-list)
    found=0
    for f in "$STATE_DIR"/pr-*.pid; do
      [ -e "$f" ] || continue
      pid="$(cat "$f")"
      pr="$(basename "$f" .pid | sed 's/^pr-//')"
      if kill -0 "$pid" 2>/dev/null; then
        echo "监听中: PR #$pr (PID $pid)"
        found=1
      else
        rm -f "$f"
      fi
    done
    [ "$found" = 0 ] && echo "无运行中的 watcher"
    ;;

  *)
    echo "用法: bash codex-watch.sh <watch|watch-stop|watch-list> [PR] [first-delay]" >&2
    exit 1
    ;;
esac
