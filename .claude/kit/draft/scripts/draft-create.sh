#!/usr/bin/env bash

# draft-create.sh <type> <slug>
# 把 templates/ 下的固定骨架复制到 .claude/kit/spec/，替换 <SLUG> 占位。type 必须显式。
# 模板文件: .claude/kit/draft/templates/{core,ui,api,bugfix}.md —— 直接编辑即可更新骨架。
# 用法:
#   draft-create.sh feature <slug>   # core.md   → spec/YYYY-MM-DD-<slug>-feature.md
#   draft-create.sh bug <slug>       # bugfix.md → spec/YYYY-MM-DD-<slug>-bugfix.md
#   draft-create.sh ui <slug>        # ui.md     → spec/YYYY-MM-DD-<slug>-ui.md
#   draft-create.sh api <slug>       # api.md    → spec/YYYY-MM-DD-<slug>-api.md
#   draft-create.sh complex <slug>   # core+ui+api → spec/<slug>/{<slug>.md,-ui.md,-api.md}
# 输出: 每个文件一行 CREATED:<path> / ALREADY_EXISTS:<path>

TYPE="$1"
RAW="$2"

case "$TYPE" in
  feature|ui|api|complex) ;;
  bug|bugfix) TYPE="bug" ;;
  *) TYPE="usage" ;;
esac

if [ "$TYPE" = "usage" ] || [ -z "$RAW" ]; then
  cat <<'USAGE'
用法（type 必须显式）:
  /k:draft feature <slug>   # 单文件 · 核心流程/业务逻辑
  /k:draft bug <slug>       # 单文件 · bug 修复
  /k:draft ui <slug>        # 单文件 · UI 开发/调整
  /k:draft api <slug>       # 单文件 · API 对接
  /k:draft complex <slug>   # 三文件 · 核心流程 + UI + API（对标 airdrop）
USAGE
  exit 0
fi

# slug 规范化：小写 + 空格转连字符 + 只留字母数字连字符（保证不含 sed 分隔符 | 和 /）
SLUG=$(echo "$RAW" | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | tr -cd 'a-z0-9-')

if [ -z "$SLUG" ]; then
  echo "ERROR: slug 规范化后为空（只允许字母数字连字符）"
  exit 1
fi

DATE=$(date +%Y-%m-%d)
KIT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
SPEC_DIR="$KIT_ROOT/.claude/kit/spec"
TPL_DIR="$KIT_ROOT/.claude/kit/draft/templates"

# emit <template-file> <dest-path>：复制模板并替换 <SLUG>，不覆盖已存在文件
emit() {
  local tpl="$TPL_DIR/$1"; local dest="$2"
  if [ ! -f "$tpl" ]; then
    echo "ERROR: 模板不存在 $tpl"
    return 1
  fi
  if [ -f "$dest" ]; then
    echo "ALREADY_EXISTS:$dest"
    return 0
  fi
  sed "s|<SLUG>|$SLUG|g" "$tpl" > "$dest"
  echo "CREATED:$dest"
}

case "$TYPE" in
  complex)
    DIR="$SPEC_DIR/$SLUG"
    mkdir -p "$DIR"
    emit core.md   "$DIR/$SLUG.md"
    emit ui.md     "$DIR/$SLUG-ui.md"
    emit api.md    "$DIR/$SLUG-api.md"
    ;;
  feature)
    mkdir -p "$SPEC_DIR"
    emit core.md   "$SPEC_DIR/$DATE-$SLUG-feature.md"
    ;;
  ui)
    mkdir -p "$SPEC_DIR"
    emit ui.md     "$SPEC_DIR/$DATE-$SLUG-ui.md"
    ;;
  api)
    mkdir -p "$SPEC_DIR"
    emit api.md    "$SPEC_DIR/$DATE-$SLUG-api.md"
    ;;
  bug)
    mkdir -p "$SPEC_DIR"
    emit bugfix.md "$SPEC_DIR/$DATE-$SLUG-bugfix.md"
    ;;
esac
