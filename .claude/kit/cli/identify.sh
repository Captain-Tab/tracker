#!/bin/bash
#
# soso-kit 项目识别库
#
# 单一权威配置：.claude/kit/projects.conf
# 被 install.sh / sync.sh / add.sh / context-lib.sh / init-project.sh source 使用
#
# 识别优先级（identify_project）：
#   1. soso-kit 本仓 → 退出码 2
#   2. 主识别：git worktree list | head -1 | basename → 查 projects.conf
#      覆盖所有 worktree 场景（worktree 叫什么都无关紧要）
#   3. Fallback：cwd basename 以某已注册项目名开头 → 归属该项目
#      覆盖独立 clone + 命名规范场景（如 sodex-web-backup → sodex-web）
#   4. 都未命中 → 退出码 1，提示 --module override
#
# 依赖：$SOSO_KIT_ROOT（由 config.sh 定义）
# bash 3.2 兼容：无关联数组，纯 grep + while read

# projects.conf 路径
projects_conf_path() {
    echo "$SOSO_KIT_ROOT/.claude/kit/projects.conf"
}

# 列出所有已注册项目（一行一个）
list_projects() {
    local conf
    conf="$(projects_conf_path)"
    [[ ! -f "$conf" ]] && return 1
    grep -vE '^[[:space:]]*(#|$)' "$conf" | awk '{$1=$1; print}'
}

# 列表字符串（逗号分隔，用于错误提示）
list_projects_str() {
    list_projects | tr '\n' ',' | sed 's/,$//; s/,/, /g'
}

# 判断项目是否已注册
is_registered() {
    local name="$1"
    [[ -z "$name" ]] && return 1
    local conf
    conf="$(projects_conf_path)"
    [[ ! -f "$conf" ]] && return 1
    grep -qE "^[[:space:]]*${name}[[:space:]]*$" "$conf"
}

# 幂等注册项目（追加到 projects.conf）
# 退出码：0 新增 / 0 已存在（幂等）/ 1 失败
register_project() {
    local name="$1"
    if [[ -z "$name" ]]; then
        echo "ERROR: register_project 需要项目名" >&2
        return 1
    fi
    if is_registered "$name"; then
        return 0
    fi
    local conf
    conf="$(projects_conf_path)"
    echo "$name" >> "$conf"
}

# 识别当前目录所属项目
# 输入：$1 = 目标项目绝对路径（默认当前目录）
# 输出：项目名到 stdout
# 退出码：0 成功 / 1 未命中 / 2 soso-kit 本仓
identify_project() {
    local target_dir="${1:-$(pwd)}"

    if [[ -z "$target_dir" ]] || [[ ! -d "$target_dir" ]]; then
        echo "ERROR: identify_project 需要有效目录参数，收到：'$target_dir'" >&2
        return 1
    fi

    # 1. soso-kit 本仓拦截
    local target_real kit_real
    target_real="$(cd "$target_dir" && pwd -P)"
    kit_real="$(cd "$SOSO_KIT_ROOT" && pwd -P)"
    if [[ "$target_real" == "$kit_real" ]]; then
        echo "ERROR: 当前目录为 soso-kit 源仓（$kit_real），不可执行此操作" >&2
        return 2
    fi

    # 2. 主识别：worktree 主仓 basename
    local main_worktree main_name
    main_worktree=$(cd "$target_dir" && git worktree list 2>/dev/null | head -1 | awk '{print $1}')

    if [[ -n "$main_worktree" ]]; then
        main_name=$(basename "$main_worktree")
        if is_registered "$main_name"; then
            echo "$main_name"
            return 0
        fi
    fi

    # 3. Fallback：cwd basename 前缀匹配
    local cwd_name
    if cwd_name=$(cd "$target_dir" && basename "$(git rev-parse --show-toplevel 2>/dev/null)" 2>/dev/null); then
        [[ -n "$cwd_name" ]] || cwd_name=$(basename "$target_real")
    else
        cwd_name=$(basename "$target_real")
    fi

    local proj
    while IFS= read -r proj; do
        [[ -z "$proj" ]] && continue
        if [[ "$cwd_name" == "$proj" ]] || [[ "$cwd_name" == "$proj"-* ]]; then
            echo "$proj"
            return 0
        fi
    done < <(list_projects)

    # 4. 识别失败
    {
        echo "ERROR: 无法识别项目"
        echo "  当前目录: $target_dir"
        if [[ -n "$main_worktree" ]]; then
            echo "  git 主仓: $main_worktree"
            echo "  主仓 basename '$main_name' 未在 projects.conf 注册"
        else
            echo "  非 git 仓或未启用 worktree"
        fi
        echo "  cwd basename '$cwd_name' 不匹配任何已注册项目前缀"
        local listed
        listed=$(list_projects_str)
        [[ -n "$listed" ]] && echo "  已注册项目: $listed"
        echo "  解决方案:"
        echo "    a) 使用 --module <name> 显式指定"
        echo "    b) 在 soso-kit 源仓执行：sosokit-add <new-project>"
    } >&2
    return 1
}

# ============================================================
# 兼容旧函数名（调用方迁移期内仍可用，迁移完成后可删此节）
# ============================================================
# NOTE: 按 spec 不保留兼容层，此节故意留空
