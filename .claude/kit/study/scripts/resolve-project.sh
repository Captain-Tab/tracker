#!/bin/bash
set -e

KIT_ROOT="$(git rev-parse --show-toplevel)"
REGISTRY_FILE="$KIT_ROOT/.claude/kit/study/registry.json"
CODE_DIR="/Users/soso/Documents/code"
INPUT="$1"

# 输入为空
if [ -z "$INPUT" ]; then
  echo '{"status":"error","message":"❌ 请提供项目名称或 GitHub URL"}'
  exit 0
fi

# 查 registry.json aliases
if [ -f "$REGISTRY_FILE" ]; then
  MATCH=$(jq -r --arg input "$INPUT" \
    '.projects | to_entries[] | select(.value.aliases[]? == $input) | .value | {status:"found", localPath:.localPath, repo:.repo, name:.name}' \
    "$REGISTRY_FILE" 2>/dev/null | head -1)

  if [ -n "$MATCH" ]; then
    echo "$MATCH"
    exit 0
  fi
fi

# 查本地 git 目录
if [ -d "$CODE_DIR/$INPUT/.git" ]; then
  # 尝试从 git 获取远程仓库地址
  REPO=$(git -C "$CODE_DIR/$INPUT" remote get-url origin 2>/dev/null || echo "")
  echo "{\"status\":\"found\",\"localPath\":\"$CODE_DIR/$INPUT\",\"repo\":\"$REPO\",\"name\":\"$INPUT\"}"
  exit 0
fi

# 匹配 GitHub URL
if echo "$INPUT" | grep -q "github.com"; then
  REPO_NAME=$(basename "$INPUT" .git)
  LOCAL_PATH="$CODE_DIR/$REPO_NAME"

  # 已存在则直接返回
  if [ -d "$LOCAL_PATH/.git" ]; then
    echo "{\"status\":\"found\",\"localPath\":\"$LOCAL_PATH\",\"repo\":\"$INPUT\",\"name\":\"$REPO_NAME\"}"
    exit 0
  fi

  # 先检查仓库是否可访问
  if ! git ls-remote "$INPUT" HEAD >/dev/null 2>&1; then
    # 区分网络问题和仓库不存在
    if curl -s --connect-timeout 5 "https://github.com" >/dev/null 2>&1; then
      echo "{\"status\":\"error\",\"message\":\"❌ 仓库不可访问: $INPUT\"}"
    else
      echo '{"status":"error","message":"❌ 网络连接失败"}'
    fi
    exit 0
  fi

  # 执行 clone
  if git clone "$INPUT" "$LOCAL_PATH" >/dev/null 2>&1; then
    echo "{\"status\":\"cloned\",\"localPath\":\"$LOCAL_PATH\",\"repo\":\"$INPUT\",\"name\":\"$REPO_NAME\"}"
    exit 0
  else
    echo "{\"status\":\"error\",\"message\":\"❌ Clone 失败: $INPUT\"}"
    exit 0
  fi
fi

# 均失败
echo '{"status":"not_found","message":"❌ 未找到项目，请提供 GitHub URL 或检查拼写"}'
