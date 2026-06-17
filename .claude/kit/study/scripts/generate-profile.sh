#!/bin/bash
set -e

# soso-kit 自画像生成脚本
# 扫描命令和模块结构，更新 soso-kit-profile.md 中的自动生成区域

KIT_ROOT="$(git rev-parse --show-toplevel)"
PROFILE_PATH="$KIT_ROOT/.claude/version/soso-kit-profile.md"
COMMANDS_DIR="$KIT_ROOT/.claude/commands/k"
MODULES_DIR="$KIT_ROOT/.claude/kit"

# 扫描命令清单
COMMANDS_CONTENT=""
COMMANDS_COUNT=0

for CMD_FILE in "$COMMANDS_DIR"/*.md; do
  [ -f "$CMD_FILE" ] || continue

  FILENAME="$(basename "$CMD_FILE")"

  # 跳过 CHANGELOG.md
  [ "$FILENAME" = "CHANGELOG.md" ] && continue

  NAME="${FILENAME%.md}"
  DESCRIPTION="$(sed -n 's/^description: *//p' "$CMD_FILE" | head -1)"

  COMMANDS_CONTENT="${COMMANDS_CONTENT}- /k:${NAME} — ${DESCRIPTION}\n"
  COMMANDS_COUNT=$((COMMANDS_COUNT + 1))
done

# 扫描模块结构
MODULES_CONTENT=""
MODULES_COUNT=0

for MODULE_DIR in "$MODULES_DIR"/*/; do
  [ -d "$MODULE_DIR" ] || continue

  MODULE_NAME="$(basename "$MODULE_DIR")"

  # 跳过 .DS_Store
  [ "$MODULE_NAME" = ".DS_Store" ] && continue

  # 统计 .sh 脚本数量
  SCRIPT_COUNT=$(find "$MODULE_DIR" -name "*.sh" -not -name ".DS_Store" | wc -l | tr -d ' ')

  # 统计 .md 文件数量（排除 CHANGELOG.md）
  DOC_COUNT=$(find "$MODULE_DIR" -name "*.md" -not -name "CHANGELOG.md" -not -name ".DS_Store" | wc -l | tr -d ' ')

  MODULES_CONTENT="${MODULES_CONTENT}- ${MODULE_NAME}/ (${SCRIPT_COUNT} scripts, ${DOC_COUNT} docs)\n"
  MODULES_COUNT=$((MODULES_COUNT + 1))
done

# 用 awk 替换 AUTO-GENERATED 区域，保留 MANUAL 区域
TEMP_FILE="$(mktemp)"

awk -v commands="$COMMANDS_CONTENT" -v modules="$MODULES_CONTENT" '
BEGIN {
  auto_count = 0
  skipping = 0
}
/<!-- AUTO-GENERATED START -->/ {
  auto_count++
  print
  # 插入对应内容
  if (auto_count == 1) {
    printf "%s", commands
  } else if (auto_count == 2) {
    printf "%s", modules
  }
  skipping = 1
  next
}
/<!-- AUTO-GENERATED END -->/ {
  skipping = 0
  print
  next
}
{
  if (!skipping) print
}
' "$PROFILE_PATH" > "$TEMP_FILE"

mv "$TEMP_FILE" "$PROFILE_PATH"

echo "✅ soso-kit 自画像已更新：$PROFILE_PATH"
echo "📊 命令: ${COMMANDS_COUNT} 个 | 模块: ${MODULES_COUNT} 个"
