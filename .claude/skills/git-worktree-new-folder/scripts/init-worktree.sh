#!/bin/bash
#
# Git Worktree 初始化脚本
#
# 用法：
#   sosokit-worktree <branch-name> [target-dir]
#   sosokit-worktree feature/my-feature
#   sosokit-worktree feature/my-feature ../custom-dir
#   sosokit-worktree feature/my-feature --skip-config

set -e

# 颜色
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; RED='\033[0;31m'; CYAN='\033[0;36m'; NC='\033[0m'
info()    { echo -e "${BLUE}ℹ${NC} $1"; }
success() { echo -e "${GREEN}✓${NC} $1"; }
warn()    { echo -e "${YELLOW}⚠${NC} $1"; }
error()   { echo -e "${RED}✗${NC} $1"; exit 1; }

# 获取当前配置模式
get_sosokit_mode() {
    if [[ -f "$HOME/.sosokit-mode" ]]; then
        cat "$HOME/.sosokit-mode"
    else
        echo "claude"
    fi
}

show_help() {
    local mode=$(get_sosokit_mode)
    echo "用法: sosokit-worktree <branch-name> [target-dir] [--skip-config]"
    echo ""
    echo "当前模式: $mode (.$mode)"
    echo ""
    echo "示例:"
    echo "  sosokit-worktree feature/my-feature"
    echo "  sosokit-worktree feature/my-feature ../custom-dir"
    echo "  sosokit-worktree feature/my-feature --skip-config"
    exit 0
}

# 解析参数
BRANCH_NAME=""; TARGET_DIR=""; SKIP_CONFIG="false"
while [[ $# -gt 0 ]]; do
    case "$1" in
        -h|--help)       show_help ;;
        --skip-config)   SKIP_CONFIG="true"; shift ;;
        --skip-cursor)   SKIP_CONFIG="true"; shift ;;  # 兼容旧参数
        *)
            [[ -z "$BRANCH_NAME" ]] && BRANCH_NAME="$1" || TARGET_DIR="$1"
            shift ;;
    esac
done

[[ -z "$BRANCH_NAME" ]] && error "请提供分支名称。使用 -h 查看帮助。"

ORIGINAL_DIR=$(pwd)
PROJECT_NAME=$(basename "$ORIGINAL_DIR")

# 自动生成目标目录名
if [[ -z "$TARGET_DIR" ]]; then
    BRANCH_SUFFIX=$(echo "$BRANCH_NAME" | sed 's/.*\///')
    TARGET_DIR="../${PROJECT_NAME}-${BRANCH_SUFFIX}"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Git Worktree 初始化"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
info "原目录: $ORIGINAL_DIR"
info "新分支: $BRANCH_NAME"
info "目标目录: $TARGET_DIR"
echo ""

[[ -d "$TARGET_DIR" ]] && error "目标目录已存在: $TARGET_DIR"

# Step 1: 创建 worktree
info "创建 worktree..."
if git show-ref --verify --quiet "refs/heads/$BRANCH_NAME"; then
    git worktree add "$TARGET_DIR" "$BRANCH_NAME"
else
    git worktree add "$TARGET_DIR" -b "$BRANCH_NAME"
fi
success "Worktree 创建成功"

# Step 2: 安装依赖
cd "$TARGET_DIR"
if [[ -f "package.json" ]]; then
    info "安装依赖 (pnpm install)..."
    pnpm install || { git worktree remove "$TARGET_DIR" --force 2>/dev/null; error "依赖安装失败，已清理 worktree"; }
    success "依赖安装完成"
else
    info "无 package.json，跳过依赖安装"
fi

# Step 3: 安装配置
CONFIG_MODE=$(get_sosokit_mode)
if [[ "$SKIP_CONFIG" == "true" ]]; then
    warn "跳过配置安装 (--skip-config)"
elif command -v sosokit-install &>/dev/null; then
    info "安装配置 [${CYAN}$CONFIG_MODE${NC}]..."
    sosokit-install
else
    warn "未找到 sosokit-install，跳过配置安装"
    warn "请先运行: sudo ln -sf \$SOSO_KIT_ROOT/.claude/kit/cli/install.sh /usr/local/bin/sosokit-install"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "  ${GREEN}✅ Worktree 初始化完成${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "新工作目录: $(pwd)"
echo "当前分支: $(git branch --show-current)"
echo ""
echo "下一步: cd $TARGET_DIR"
