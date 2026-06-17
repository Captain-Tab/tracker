#!/bin/bash
set -e

# 解析参数
LOCAL_PATH=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --path)
      LOCAL_PATH="$2"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done

# 验证 --path 参数
if [[ -z "$LOCAL_PATH" ]]; then
  echo '{"commit":"","branch":"","updated":false,"message":"❌ 请提供 --path 参数"}'
  exit 1
fi

if [[ ! -d "$LOCAL_PATH" ]]; then
  echo '{"commit":"","branch":"","updated":false,"message":"❌ 目录不存在: '"$LOCAL_PATH"'"}'
  exit 1
fi

cd "$LOCAL_PATH"

# 检测默认分支
DEFAULT_BRANCH=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@')

if [[ -z "$DEFAULT_BRANCH" ]]; then
  if git show-ref --verify --quiet refs/heads/main 2>/dev/null; then
    DEFAULT_BRANCH="main"
  else
    DEFAULT_BRANCH="master"
  fi
fi

# 切换到默认分支
git checkout "$DEFAULT_BRANCH" --quiet

# 尝试 pull
UPDATED=true
if ! git pull --ff-only --quiet 2>/dev/null; then
  UPDATED=false
fi

COMMIT=$(git rev-parse --short HEAD)

if [[ "$UPDATED" == "true" ]]; then
  echo '{"commit":"'"$COMMIT"'","branch":"'"$DEFAULT_BRANCH"'","updated":true,"message":"✅ 已更新到最新"}'
else
  echo '{"commit":"'"$COMMIT"'","branch":"'"$DEFAULT_BRANCH"'","updated":false,"message":"⚠️ pull 冲突，跳过更新，使用当前版本"}'
fi
