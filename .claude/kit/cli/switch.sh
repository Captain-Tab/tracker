#!/bin/bash
#
# sosokit-switch：切换 soso-kit 配置模式（.cursor 或 .claude）
#
# 用法：
#   sosokit-switch          # 显示当前模式
#   sosokit-switch cursor   # 切换到 .cursor 模式
#   sosokit-switch claude   # 切换到 .claude 模式
#
# 配置文件：~/.sosokit-mode（存储当前模式）

set -e

# 配置文件路径
MODE_FILE="$HOME/.sosokit-mode"
DEFAULT_MODE="claude"

# 颜色
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

info()    { echo -e "${BLUE}ℹ${NC} $1"; }
success() { echo -e "${GREEN}✓${NC} $1"; }
warn()    { echo -e "${YELLOW}⚠${NC} $1"; }

# 获取当前模式
get_current_mode() {
    if [[ -f "$MODE_FILE" ]]; then
        cat "$MODE_FILE"
    else
        echo "$DEFAULT_MODE"
    fi
}

# 设置模式
set_mode() {
    local mode="$1"
    echo "$mode" > "$MODE_FILE"
}

# 显示状态
show_status() {
    local mode=$(get_current_mode)
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  soso-kit 配置模式"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    
    if [[ "$mode" == "cursor" ]]; then
        echo -e "  ${CYAN}●${NC} cursor   ← 当前"
        echo -e "  ○ claude"
    else
        echo -e "  ○ cursor"
        echo -e "  ${CYAN}●${NC} claude   ← 当前"
    fi
    
    echo ""
    echo "  配置目录: .$mode/"
    echo "  配置文件: $MODE_FILE"
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "切换命令："
    echo "  sosokit-switch cursor   # 切换到 Cursor IDE"
    echo "  sosokit-switch claude   # 切换到 Claude Code"
    echo ""
}

# 切换模式
switch_mode() {
    local new_mode="$1"
    local old_mode=$(get_current_mode)
    
    if [[ "$new_mode" != "cursor" && "$new_mode" != "claude" ]]; then
        warn "无效模式: $new_mode"
        echo "可用模式: cursor, claude"
        exit 1
    fi
    
    if [[ "$new_mode" == "$old_mode" ]]; then
        info "已经是 $new_mode 模式"
        exit 0
    fi
    
    set_mode "$new_mode"
    
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo -e "  ${GREEN}✅ 已切换到 $new_mode 模式${NC}"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "  sosokit-install 将分发 .$new_mode/"
    echo "  sosokit-sync 将同步 .$new_mode/"
    echo ""
}

# 帮助
show_help() {
    echo "sosokit-switch - 切换 soso-kit 配置模式"
    echo ""
    echo "用法："
    echo "  sosokit-switch          显示当前模式"
    echo "  sosokit-switch cursor   切换到 .cursor 模式（Cursor IDE）"
    echo "  sosokit-switch claude   切换到 .claude 模式（Claude Code）"
    echo "  sosokit-switch -h       显示帮助"
    echo ""
    exit 0
}

# 主函数
main() {
    case "${1:-}" in
        -h|--help)
            show_help
            ;;
        "")
            show_status
            ;;
        cursor|claude)
            switch_mode "$1"
            ;;
        *)
            warn "未知参数: $1"
            show_help
            ;;
    esac
}

main "$@"
