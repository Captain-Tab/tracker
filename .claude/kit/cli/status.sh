#!/bin/bash
#
# sosokit-status：只读诊断 sosokit 托管态的健康度
#
# 用法：
#   sosokit-status                  # 在宿主项目根目录执行
#   sosokit-status -h | --help
#
# 退出码契约：
#   0   健康
#   1   未安装（无 .git/sosokit-state）
#   2   部分失真（skip-worktree 缺失、exclude 块缺失、版本不一致等）
#   3   严重失真（.claude 为空 / 状态文件损坏）
#   10  运行环境错误（不是 git 仓库、不在根目录）
#
# 设计：
#   - 纯只读，不修改任何文件
#   - 退出码取累积最严重等级
#   - 如需修复，重跑 sosokit-install（幂等）

# 不设 set -e：诊断工具要把所有问题收集完再退出

# 解析 symlink，找到真实脚本目录
SOURCE="$0"
while [[ -L "$SOURCE" ]]; do
    DIR="$(cd "$(dirname "$SOURCE")" && pwd)"
    SOURCE="$(readlink "$SOURCE")"
    [[ "$SOURCE" != /* ]] && SOURCE="$DIR/$SOURCE"
done
SCRIPT_DIR="$(cd "$(dirname "$SOURCE")" && pwd)"
source "$SCRIPT_DIR/config.sh"
source "$SCRIPT_DIR/lib.sh"

# 退出码累积器：取最严重等级
EXIT_CODE=0
bump_exit() {
    local level="$1"
    # 严重度优先级：10 > 3 > 2 > 1 > 0
    local -a order=(0 1 2 3 10)
    local cur_rank=0 new_rank=0 i=0
    for i in "${!order[@]}"; do
        [[ "${order[$i]}" == "$EXIT_CODE" ]] && cur_rank=$i
        [[ "${order[$i]}" == "$level"     ]] && new_rank=$i
    done
    [[ $new_rank -gt $cur_rank ]] && EXIT_CODE="$level"
}

# 行内检查输出：check "标签" "状态" "详情"
#   状态：ok | warn | fail
check_line() {
    local label="$1"
    local status="$2"
    local detail="$3"
    local icon
    case "$status" in
        ok)   icon="${GREEN}✅${NC}" ;;
        warn) icon="${YELLOW}⚠${NC}" ;;
        fail) icon="${RED}❌${NC}" ;;
        *)    icon="  " ;;
    esac
    printf "  %b %-24s %s\n" "$icon" "$label" "$detail"
}

# 帮助
if [[ "$1" == "-h" ]] || [[ "$1" == "--help" ]]; then
    cat <<EOF
sosokit-status：只读诊断 sosokit 托管态健康度

用法：
  sosokit-status       # 在宿主项目根目录执行

退出码：
  0   健康
  1   未安装
  2   部分失真（建议重跑 sosokit-install）
  3   严重失真
  10  运行环境错误
EOF
    exit 0
fi

# === 检查 1：是否在 git 仓库根目录 ===
if ! git rev-parse --git-dir &>/dev/null; then
    echo -e "${RED}✗${NC} 当前目录不是 git 仓库"
    exit 10
fi
GIT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
if [[ "$(pwd)" != "$GIT_ROOT" ]]; then
    echo -e "${RED}✗${NC} 请在 git 仓库根目录运行（当前根目录: $GIT_ROOT）"
    exit 10
fi

# === 收集状态元信息 ===
# worktree-safe：解析真实 state 文件路径
STATE_FILE=$(git_state_path "$PWD" 2>/dev/null)
[[ -z "$STATE_FILE" ]] && STATE_FILE=".git/sosokit-state"
STATE_EXISTS="false"
[[ -f "$STATE_FILE" ]] && STATE_EXISTS="true"

CONFIG_MODE=$(resolve_config_mode "$STATE_FILE")
CONFIG_DIR_NAME=".${CONFIG_MODE}"

STATE_MODE=$(read_state_field "$STATE_FILE" "mode")
STATE_FAMILY=$(read_state_field "$STATE_FILE" "family")
STATE_VERSION=$(read_state_field "$STATE_FILE" "version")
STATE_INSTALLED=$(read_state_field "$STATE_FILE" "installed")
STATE_SOURCE=$(read_state_field "$STATE_FILE" "source")

VERSION_FILE="$CONFIG_DIR_NAME/.soso-kit-version"
VERSION_FILE_HASH=""
if [[ -f "$VERSION_FILE" ]]; then
    VERSION_FILE_HASH=$(grep '^version:' "$VERSION_FILE" 2>/dev/null | cut -d: -f2- | tr -d '[:space:]')
fi

# === 头部信息 ===
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "  sosokit status ${CYAN}[$CONFIG_MODE]${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
printf "  %-14s %s\n" "目标项目"  "$GIT_ROOT"
printf "  %-14s %s\n" "配置目录"  "$CONFIG_DIR_NAME"
if [[ "$STATE_EXISTS" == "true" ]]; then
    printf "  %-14s %s\n" "安装模式" "${STATE_MODE:-<缺失>}"
    printf "  %-14s %s\n" "安装家族" "${STATE_FAMILY:-<缺失>}"
    printf "  %-14s %s\n" "安装时间" "${STATE_INSTALLED:-<缺失>}"
    printf "  %-14s %s\n" "安装版本" "${STATE_VERSION:-<缺失>}"
    printf "  %-14s %s\n" "来源"     "${STATE_SOURCE:-<缺失>}"
fi
echo ""
echo "状态检查："

# === 检查 2：.git/sosokit-state ===
if [[ "$STATE_EXISTS" != "true" ]]; then
    check_line "状态文件" fail "缺失 $STATE_FILE（未执行 sosokit-install）"
    bump_exit 1
    # 未安装视作基线情况：继续后续检查让用户看到全貌
else
    if [[ -z "$STATE_MODE" ]] || [[ -z "$STATE_VERSION" ]]; then
        check_line "状态文件" fail "$STATE_FILE 存在但关键字段缺失"
        bump_exit 3
    else
        check_line "状态文件" ok "$STATE_FILE"
    fi
fi

# === 检查 3：.git/info/exclude 标记块（worktree-safe） ===
EXCLUDE_FILE=$(git_exclude_path "$PWD" 2>/dev/null)
[[ -z "$EXCLUDE_FILE" ]] && EXCLUDE_FILE=".git/info/exclude"
MARKER_BEGIN="# sosokit-begin: $CONFIG_DIR_NAME"
if [[ -f "$EXCLUDE_FILE" ]] && grep -qF "$MARKER_BEGIN" "$EXCLUDE_FILE" 2>/dev/null; then
    check_line "exclude 标记块" ok "$EXCLUDE_FILE"
else
    if [[ "$STATE_EXISTS" == "true" ]]; then
        check_line "exclude 标记块" fail "缺失（未追踪新文件将出现在 git status）"
        bump_exit 2
    else
        check_line "exclude 标记块" warn "未配置（未安装状态下属正常）"
    fi
fi

# === 检查 4：skip-worktree 位完整性 ===
# git ls-files -v：首字符 S = skip-worktree，小写 s / 其他 = 未标记
if [[ -d "$CONFIG_DIR_NAME" ]]; then
    tracked_total=$(git ls-files "$CONFIG_DIR_NAME" 2>/dev/null | wc -l | tr -d ' ')
    if [[ "$tracked_total" -gt 0 ]]; then
        # 统计未被 skip-worktree 标记的已追踪文件
        unmarked_list=$(git ls-files -v "$CONFIG_DIR_NAME" 2>/dev/null | awk '/^[^S]/ {sub(/^. /,""); print}')
        unmarked_count=0
        if [[ -n "$unmarked_list" ]]; then
            unmarked_count=$(printf '%s\n' "$unmarked_list" | wc -l | tr -d ' ')
        fi
        marked_count=$((tracked_total - unmarked_count))

        if [[ "$STATE_EXISTS" != "true" ]]; then
            # 未安装 + 有跟踪文件：跳过此项（项目本身的 .claude 不应被托管）
            check_line "skip-worktree" ok "$tracked_total 个跟踪文件（未托管，属正常）"
        elif [[ "$unmarked_count" -eq 0 ]]; then
            check_line "skip-worktree" ok "$marked_count/$tracked_total 个文件已冻结"
        else
            check_line "skip-worktree" fail "$marked_count/$tracked_total 个已冻结（$unmarked_count 个失真）"
            # 仅展示前 3 个失真文件
            printf '%s\n' "$unmarked_list" | head -n 3 | sed 's|^|       └─ |'
            if [[ "$unmarked_count" -gt 3 ]]; then
                printf "       └─ ... 还有 %d 个\n" $((unmarked_count - 3))
            fi
            bump_exit 2
        fi
    else
        check_line "skip-worktree" ok "无已追踪文件"
    fi
else
    if [[ "$STATE_EXISTS" == "true" ]]; then
        check_line "skip-worktree" fail "$CONFIG_DIR_NAME 目录不存在"
        bump_exit 3
    else
        check_line "skip-worktree" warn "$CONFIG_DIR_NAME 目录不存在"
    fi
fi

# === 检查 5：.claude 目录非空 ===
if [[ -d "$CONFIG_DIR_NAME" ]]; then
    entry_count=$(find "$CONFIG_DIR_NAME" -mindepth 1 -maxdepth 1 2>/dev/null | wc -l | tr -d ' ')
    if [[ "$entry_count" -gt 0 ]]; then
        check_line "配置目录" ok "$CONFIG_DIR_NAME（$entry_count 个顶层条目）"
    else
        check_line "配置目录" fail "$CONFIG_DIR_NAME 为空"
        [[ "$STATE_EXISTS" == "true" ]] && bump_exit 3
    fi
else
    check_line "配置目录" warn "$CONFIG_DIR_NAME 不存在"
    [[ "$STATE_EXISTS" == "true" ]] && bump_exit 3
fi

# === 检查 6：.soso-kit-version 存在 ===
if [[ -f "$VERSION_FILE" ]]; then
    check_line "版本文件"       ok "$VERSION_FILE（${VERSION_FILE_HASH:-<无 version 行>}）"
else
    if [[ "$STATE_EXISTS" == "true" ]]; then
        check_line "版本文件"   fail "缺失 $VERSION_FILE"
        bump_exit 2
    else
        check_line "版本文件"   warn "缺失（未安装状态下属正常）"
    fi
fi

# === 检查 7：state.version 与 version 文件一致 ===
if [[ "$STATE_EXISTS" == "true" ]] && [[ -n "$STATE_VERSION" ]] && [[ -n "$VERSION_FILE_HASH" ]]; then
    if [[ "$STATE_VERSION" == "$VERSION_FILE_HASH" ]]; then
        check_line "版本一致性"     ok "$STATE_VERSION"
    else
        check_line "版本一致性"     fail "state=$STATE_VERSION vs file=$VERSION_FILE_HASH"
        bump_exit 2
    fi
fi

# === 建议 ===
echo ""
case "$EXIT_CODE" in
    0)
        echo -e "${GREEN}✅ 托管态健康${NC}"
        ;;
    1)
        echo -e "${BLUE}ℹ 当前未安装 sosokit 托管${NC}"
        echo "  安装命令： sosokit-install"
        ;;
    2)
        echo -e "${YELLOW}⚠ 检测到部分失真${NC}"
        echo "  修复建议： 重跑 sosokit-install（幂等，会重建 skip-worktree + exclude 块）"
        ;;
    3)
        echo -e "${RED}✗ 严重失真${NC}"
        echo "  排查建议："
        echo "    1. 查看状态文件：cat .git/sosokit-state"
        echo "    2. 查看 git 历史：git log --oneline -- $CONFIG_DIR_NAME"
        echo "    3. 恢复原项目版本：sosokit-clean"
        echo "    4. 或重装：sosokit-install"
        ;;
esac
echo ""

exit "$EXIT_CODE"
