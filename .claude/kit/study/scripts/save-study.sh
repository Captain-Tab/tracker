#!/bin/bash
set -e

# 参数解析
NAME=""
REPO=""
LOCAL_PATH=""
COMMIT=""
DOC_PATH=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --name)
      NAME="$2"
      shift 2
      ;;
    --repo)
      REPO="$2"
      shift 2
      ;;
    --path)
      LOCAL_PATH="$2"
      shift 2
      ;;
    --commit)
      COMMIT="$2"
      shift 2
      ;;
    --doc-path)
      DOC_PATH="$2"
      shift 2
      ;;
    *)
      echo '{"registryUpdated":false,"message":"❌ 未知参数: '"$1"'"}'
      exit 1
      ;;
  esac
done

# 验证所有参数存在
if [ -z "$NAME" ]; then
  echo '{"registryUpdated":false,"message":"❌ 缺少 --name 参数"}'
  exit 1
fi
if [ -z "$REPO" ]; then
  echo '{"registryUpdated":false,"message":"❌ 缺少 --repo 参数"}'
  exit 1
fi
if [ -z "$LOCAL_PATH" ]; then
  echo '{"registryUpdated":false,"message":"❌ 缺少 --path 参数"}'
  exit 1
fi
if [ -z "$COMMIT" ]; then
  echo '{"registryUpdated":false,"message":"❌ 缺少 --commit 参数"}'
  exit 1
fi
if [ -z "$DOC_PATH" ]; then
  echo '{"registryUpdated":false,"message":"❌ 缺少 --doc-path 参数"}'
  exit 1
fi

# 验证文档文件存在
if [ ! -f "$DOC_PATH" ]; then
  echo '{"registryUpdated":false,"message":"❌ 文档文件不存在: '"$DOC_PATH"'"}'
  exit 1
fi

# Token 统计
DOC_CHARS=$(wc -c < "$DOC_PATH" | tr -d ' ')
ESTIMATED_TOKENS=$((DOC_CHARS / 3))

# 计算路径
KIT_ROOT="$(git rev-parse --show-toplevel)"
REGISTRY="$KIT_ROOT/.claude/kit/study/registry.json"

# docPath 转为相对于 KIT_ROOT 的路径
RELATIVE_DOC_PATH="${DOC_PATH#$KIT_ROOT/}"

# 确保 registry.json 存在
if [ ! -f "$REGISTRY" ]; then
  echo '{"registryUpdated":false,"message":"❌ registry.json 不存在: '"$REGISTRY"'"}'
  exit 1
fi

# 用临时文件更新 registry.json，保留已有 aliases
TEMP=$(mktemp)
TODAY=$(date +%Y-%m-%d)

jq --arg name "$NAME" \
   --arg repo "$REPO" \
   --arg localPath "$LOCAL_PATH" \
   --arg docPath "$RELATIVE_DOC_PATH" \
   --arg today "$TODAY" \
   --arg commit "$COMMIT" \
   '
   # 保留已有 aliases，合并新 name
   (.projects[$name].aliases // []) as $existingAliases |
   (if ($existingAliases | index($name)) then $existingAliases else $existingAliases + [$name] end) as $mergedAliases |

   .projects[$name] = {
     "repo": $repo,
     "localPath": $localPath,
     "docPath": $docPath,
     "lastStudyAt": $today,
     "lastCommit": $commit,
     "aliases": $mergedAliases
   } |
   .meta.totalProjects = (.projects | length) |
   .meta.lastUpdated = $today
   ' "$REGISTRY" > "$TEMP" && mv "$TEMP" "$REGISTRY"

# 输出结果
echo '{"registryUpdated":true,"tokens":{"docChars":'"$DOC_CHARS"',"estimatedTokens":'"$ESTIMATED_TOKENS"'}}'
