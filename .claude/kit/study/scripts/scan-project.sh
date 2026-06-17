#!/bin/bash
set -e

# 项目扫描脚本：生成项目概览信息

PATH_ARG=""
NAME_ARG=""

# 参数解析
while [[ $# -gt 0 ]]; do
  case "$1" in
    --path)
      PATH_ARG="$2"
      shift 2
      ;;
    --name)
      NAME_ARG="$2"
      shift 2
      ;;
    *)
      echo "未知参数: $1" >&2
      exit 1
      ;;
  esac
done

if [[ -z "$PATH_ARG" || -z "$NAME_ARG" ]]; then
  echo "用法: scan-project.sh --path <localPath> --name <projectName>" >&2
  exit 1
fi

if [[ ! -d "$PATH_ARG" ]]; then
  echo "路径不存在: $PATH_ARG" >&2
  exit 1
fi

# 临时文件存储输出，用于末尾计算 token 估算
TMPFILE=$(mktemp)
trap 'rm -f "$TMPFILE"' EXIT

cd "$PATH_ARG"

{
  echo "## 项目: $NAME_ARG"
  echo "## 路径: $PATH_ARG"
  echo ""

  # 目录结构（2层）
  echo "### 目录结构（2层）"
  tree -L 2 --dirsfirst -I 'node_modules|.git|dist|build|.next' 2>/dev/null || find . -maxdepth 2 -type d \
    -not -path '*/node_modules*' -not -path '*/.git*' -not -path '*/dist*' -not -path '*/build*' -not -path '*/.next*' \
    | sort | head -50
  echo ""

  # 入口文件
  echo "### 入口文件"
  if [[ -f "package.json" ]]; then
    echo "name: $(jq -r '.name // "无"' package.json)"
    echo "description: $(jq -r '.description // "无"' package.json)"
    echo ""
    echo "scripts:"
    jq -r '.scripts // {} | keys[]' package.json 2>/dev/null | sed 's/^/  - /'
    echo ""
    echo "dependencies:"
    jq -r '.dependencies // {} | keys[]' package.json 2>/dev/null | sed 's/^/  - /'
    echo ""
    echo "devDependencies:"
    jq -r '.devDependencies // {} | keys[]' package.json 2>/dev/null | sed 's/^/  - /'
  elif [[ -f "Cargo.toml" ]]; then
    echo "检测到 Cargo.toml (Rust 项目)"
    head -20 Cargo.toml
  elif [[ -f "go.mod" ]]; then
    echo "检测到 go.mod (Go 项目)"
    head -20 go.mod
  elif [[ -f "setup.py" ]]; then
    echo "检测到 setup.py (Python 项目)"
    head -20 setup.py
  elif [[ -f "pyproject.toml" ]]; then
    echo "检测到 pyproject.toml (Python 项目)"
    head -20 pyproject.toml
  else
    echo "未检测到已知的项目配置文件"
  fi
  echo ""

  # 语言统计
  echo "### 语言统计"
  EXTENSIONS=("ts" "tsx" "js" "jsx" "py" "rs" "go" "sh" "md" "css" "scss" "html" "json" "yaml" "yml" "toml" "vue" "svelte")
  STATS=""
  for EXT in "${EXTENSIONS[@]}"; do
    COUNT=$(find . -type f -name "*.${EXT}" -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/dist/*' -not -path '*/build/*' -not -path '*/.next/*' 2>/dev/null | wc -l | tr -d ' ')
    if [[ "$COUNT" -gt 0 ]]; then
      STATS="${STATS}${COUNT} ${EXT}\n"
    fi
  done
  # 按数量降序排列，取 top 10
  echo -e "$STATS" | sort -rn | head -10 | while read -r LINE; do
    [[ -n "$LINE" ]] && echo "  .${LINE#* }: ${LINE%% *} files"
  done || true
  echo ""

  # 最近 10 条 Commit
  echo "### 最近 10 条 Commit"
  if git rev-parse --is-inside-work-tree &>/dev/null; then
    git log --oneline -10 2>/dev/null || echo "无 git 历史"
  else
    echo "非 git 仓库"
  fi
  echo ""

  # README 摘要
  echo "### README 摘要"
  if [[ -f "README.md" ]]; then
    head -100 README.md
  elif [[ -f "readme.md" ]]; then
    head -100 readme.md
  elif [[ -f "README" ]]; then
    head -100 README
  else
    echo "无 README"
  fi
  echo ""

} > "$TMPFILE"

# 输出内容
cat "$TMPFILE"

# Token 估算
CHAR_COUNT=$(wc -c < "$TMPFILE" | tr -d ' ')
TOKEN_EST=$((CHAR_COUNT / 3))
echo "### Token 估算"
echo "~${TOKEN_EST} tokens"
