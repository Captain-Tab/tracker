#!/bin/bash
#
# soso-kit 共享工具库
#
# 提供 install.sh / sync.sh 共用的：
#   - 颜色/日志函数
#   - 路径过滤 is_excluded (direction: install|sync)
#   - diff 遍历 walk_main_diff / walk_rules_diff
#
# 约束：
#   - 本文件被 source 调用，禁止设置 set -e / set -u 等全局选项
#   - 兼容 bash 3.2（macOS 默认）：不使用 local -n / declare -n
#   - 函数多值返回用固定前缀全局数组 _SOSOKIT_*
#   - 返回 0/1 的函数调用方用 `func x || ...` 成语，避免 set -e 下误退出

# 颜色
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# 日志
info()     { echo -e "${BLUE}ℹ${NC} $1"; }
success()  { echo -e "${GREEN}✓${NC} $1"; }
warn()     { echo -e "${YELLOW}⚠${NC} $1"; }
error()    { echo -e "${RED}✗${NC} $1"; exit 1; }
added()    { echo -e "  ${GREEN}+${NC} $1"; }
modified() { echo -e "  ${YELLOW}~${NC} $1"; }
removed()  { echo -e "  ${RED}-${NC} $1"; }

# 路径排除判断
# 用法：is_excluded "<rel-path>" "<family>" "<direction>"
#   direction: install | sync
# 返回 0 = 排除，1 = 保留
is_excluded() {
    local path="$1"
    local family="$2"
    local direction="$3"

    case "$direction" in
        install|sync) ;;
        *) error "is_excluded: 非法 direction=$direction（仅 install|sync）" ;;
    esac

    # 两向通用排除
    # kit/spec：保留源仓维护的 scripts/，其余（flat md + 子目录）都是用户 spec 内容，不参与同步
    [[ "$path" == kit/spec/scripts || "$path" == kit/spec/scripts/* ]] && return 1
    [[ "$path" == kit/spec/* ]] && return 0
    [[ "$path" == .soso-kit-version ]] && return 0
    # settings：项目级（settings.json）/ 用户本地（settings.local.json）不参与同步
    # - settings.json 归项目方维护（团队共享：hooks、项目特定 allow）
    # - settings.local.json 归个人本地（不入仓）
    [[ "$path" == settings.json || "$path" == settings.local.json ]] && return 0
    # rules 走独立家族化 diff，不参与主 diff
    [[ "$path" == rules || "$path" == rules/* ]] && return 0
    # kit/projects:_template 和非当前家族项目（install 过滤不落地 / sync 不推回）
    [[ "$path" == kit/projects ]] && return 0
    [[ "$path" == kit/projects/_template || "$path" == kit/projects/_template/* ]] && return 0
    if [[ "$path" == kit/projects/* ]]; then
        local _rest="${path#kit/projects/}"
        local _name="${_rest%%/*}"
        [[ "$_name" != "$family" ]] && return 0
    fi

    # 仅 sync 方向：figma 项目本地 references 不推回源仓（每项目自维护）
    # install 方向 NOT 过滤：install 会用源版本覆盖目标，需要在 diff 中显式提示
    if [[ "$direction" == "sync" ]]; then
        [[ "$path" == kit/figma/references/components.md ]] && return 0
        [[ "$path" == kit/figma/references/patterns.md ]] && return 0
        [[ "$path" == kit/figma/references/specification-project.md ]] && return 0
    fi

    return 1
}

# 主 diff 遍历（两目录整体 diff 后按 is_excluded 过滤归类）
# 用法：walk_main_diff <src_config> <tgt_config> <family> <direction>
# 产出（全局数组，调用前自动重置）：
#   _SOSOKIT_ADDED[@]     仅源有
#   _SOSOKIT_MODIFIED[@]  两侧都有内容不同
#   _SOSOKIT_REMOVED[@]   仅目标有
walk_main_diff() {
    local src="$1"
    local tgt="$2"
    local family="$3"
    local direction="$4"

    _SOSOKIT_ADDED=()
    _SOSOKIT_MODIFIED=()
    _SOSOKIT_REMOVED=()

    local line _d _n _r _s
    while IFS= read -r line; do
        if [[ "$line" == Only\ in\ "$src"* ]]; then
            _d="${line#Only in }"; _n="${_d##*: }"; _d="${_d%%: *}"
            _r="${_d#$src}"; _r="${_r#/}"; _r="${_r:+$_r/}$_n"
            is_excluded "$_r" "$family" "$direction" || _SOSOKIT_ADDED+=("$_r")
        elif [[ "$line" == Only\ in\ "$tgt"* ]]; then
            _d="${line#Only in }"; _n="${_d##*: }"; _d="${_d%%: *}"
            _r="${_d#$tgt}"; _r="${_r#/}"; _r="${_r:+$_r/}$_n"
            is_excluded "$_r" "$family" "$direction" || _SOSOKIT_REMOVED+=("$_r")
        elif [[ "$line" == Files\ * ]]; then
            _s="${line#Files }"; _s="${_s%% and *}"
            _r="${_s#$src}"; _r="${_r#/}"
            is_excluded "$_r" "$family" "$direction" || _SOSOKIT_MODIFIED+=("$_r")
        fi
    done < <(diff -rq "$src" "$tgt" 2>/dev/null || true)
}

# 家族化 rules diff（两个扁平 *.md 目录对比）
# 用法：walk_rules_diff <src_flat> <tgt_flat>
#   install 方向：src = $SOSO_KIT_CONFIG/rules/modules/$family, tgt = $target/rules
#   sync    方向：src = $target/rules,                         tgt = $SOSO_KIT_CONFIG/rules/modules/$family
# 产出（调用前自动重置，全部带 "rules/" 前缀）：
#   _SOSOKIT_RULES_ADDED[@]     _SOSOKIT_RULES_MODIFIED[@]     _SOSOKIT_RULES_REMOVED[@]
walk_rules_diff() {
    local src="$1"
    local tgt="$2"

    _SOSOKIT_RULES_ADDED=()
    _SOSOKIT_RULES_MODIFIED=()
    _SOSOKIT_RULES_REMOVED=()

    # 任一侧不存在则直接返回空
    [[ -d "$src" ]] || return 0
    [[ -d "$tgt" ]] || return 0

    local line _d _n _r _s
    while IFS= read -r line; do
        if [[ "$line" == Only\ in\ "$src"* ]]; then
            _d="${line#Only in }"; _n="${_d##*: }"; _d="${_d%%: *}"
            _r="${_d#$src}"; _r="${_r#/}"; _r="${_r:+$_r/}$_n"
            # 防御：src 不应含 modules/.gitkeep（已用 --exclude 过滤，双保险）
            [[ "$_r" == modules || "$_r" == modules/* ]] && continue
            [[ "$_r" == .gitkeep ]] && continue
            _SOSOKIT_RULES_ADDED+=("rules/$_r")
        elif [[ "$line" == Only\ in\ "$tgt"* ]]; then
            _d="${line#Only in }"; _n="${_d##*: }"; _d="${_d%%: *}"
            _r="${_d#$tgt}"; _r="${_r#/}"; _r="${_r:+$_r/}$_n"
            [[ "$_r" == modules || "$_r" == modules/* ]] && continue
            [[ "$_r" == .gitkeep ]] && continue
            _SOSOKIT_RULES_REMOVED+=("rules/$_r")
        elif [[ "$line" == Files\ * ]]; then
            _s="${line#Files }"; _s="${_s%% and *}"
            _r="${_s#$src}"; _r="${_r#/}"
            _SOSOKIT_RULES_MODIFIED+=("rules/$_r")
        fi
    done < <(diff -rq --exclude=modules --exclude=.gitkeep "$src" "$tgt" 2>/dev/null || true)
}

# === 状态文件读取工具 ===
#
# .git/sosokit-state 文件格式（key=value，每行一对）：
#   mode=claude|cursor
#   version=<git short hash>
#   installed=<YYYY-MM-DD HH:MM:SS>
#   install_mode=install|update
#   source=<soso-kit 源路径>
#   family=<家族名>

# 从 state 文件读取指定字段
# 用法：read_state_field <state_file> <field>
# 找不到文件或字段返回空字符串，退出码 0
# worktree-safe：返回 .git/info/exclude 的真实绝对路径
# 用法：git_exclude_path <project_dir>
# 说明：worktree 下 $project_dir/.git 是文件，实际 exclude 在主仓 common dir
git_exclude_path() {
    local proj="$1"
    local common_dir
    common_dir=$(git -C "$proj" rev-parse --git-common-dir 2>/dev/null) || return 1
    case "$common_dir" in
        /*) ;;
        *) common_dir="$proj/$common_dir" ;;
    esac
    echo "$common_dir/info/exclude"
}

# worktree-safe：返回 .git/sosokit-state 的真实绝对路径
# 用法：git_state_path <project_dir>
# 说明：每 worktree 独立 state（用 --git-dir 而非 common-dir）
git_state_path() {
    local proj="$1"
    local git_dir
    git_dir=$(git -C "$proj" rev-parse --git-dir 2>/dev/null) || return 1
    case "$git_dir" in
        /*) ;;
        *) git_dir="$proj/$git_dir" ;;
    esac
    echo "$git_dir/sosokit-state"
}

# worktree-safe：返回 spec 持久备份目录的绝对路径（不含末尾斜杠）
# 用法：spec_backup_dir <project_dir> <mode>
# 说明：基于 git_state_path 的 git-dir（worktree 专属），带 mode 后缀隔离 claude/cursor
#       位于 .git 内，git 不追踪、clean 的 rm -rf 配置目录碰不到
spec_backup_dir() {
    local proj="$1"
    local mode="$2"
    local state_path
    state_path=$(git_state_path "$proj") || return 1
    echo "$(dirname "$state_path")/sosokit-spec-backup-$mode"
}

read_state_field() {
    local state_file="$1"
    local field="$2"

    [[ -f "$state_file" ]] || return 0
    grep "^${field}=" "$state_file" 2>/dev/null | head -n1 | cut -d= -f2- | tr -d '\r' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//'
}

# 解析配置模式：优先 .git/sosokit-state 的 mode 字段，回退到 get_sosokit_mode
# 用法：resolve_config_mode [state_file]
#   state_file 省略时默认 .git/sosokit-state（相对 pwd）
# 依赖：config.sh 中的 get_sosokit_mode（调用前需 source config.sh）
resolve_config_mode() {
    # 省略参数时默认查当前项目的 state（worktree-safe）
    local state_file
    if [[ -n "$1" ]]; then
        state_file="$1"
    else
        state_file=$(git_state_path "$(pwd)" 2>/dev/null)
        [[ -z "$state_file" ]] && state_file=".git/sosokit-state"
    fi
    local mode_from_state
    mode_from_state=$(read_state_field "$state_file" "mode")
    if [[ -n "$mode_from_state" ]]; then
        echo "$mode_from_state"
        return 0
    fi
    # 回退到默认模式解析（要求 config.sh 已 source）
    if type -t get_sosokit_mode >/dev/null 2>&1; then
        get_sosokit_mode
    else
        echo "claude"
    fi
}
