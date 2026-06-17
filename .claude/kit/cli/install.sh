#!/bin/bash
#
# soso-kit 配置安装/更新脚本
#
# 功能：将 soso-kit 的配置（.cursor 或 .claude）安装或更新到其他项目
#       安装后配置目录对 git 完全透明（skip-worktree + .git/info/exclude）
#
# 用法：
#   sosokit-install <target-project> [target-project2] ...
#
# 示例：
#   sosokit-install ~/code/my-project
#   sosokit-install ~/code/project-a ~/code/project-b
#   sosokit-install --dry-run ~/code/my-project
#
# 参数：
#   target-project    目标项目路径（可指定多个）
#   --dry-run         预览模式，不实际执行
#   -h, --help        显示帮助
#
# 模式切换：
#   sosokit-switch cursor   # 切换到 .cursor 模式
#   sosokit-switch claude   # 切换到 .claude 模式
#
# 行为：
#   - 首次安装：复制整个配置目录，清空 kit/spec 用户内容（保留 scripts/）
#   - 更新模式：复制整个配置目录，恢复原有 kit/spec 用户内容（保留 scripts/）
#   - git 项目：自动 skip-worktree + 写 .git/info/exclude，配置目录对 git 透明
#   - 写入 .git/sosokit-state 记录安装状态（供 sosokit-clean 使用）
#
# 配置：
#   优先级：环境变量 > 默认路径 > 脚本位置计算
#   可通过环境变量 SOSO_KIT_ROOT 覆盖默认配置

set -e

# 引入公共配置（解析 symlink，找到真实脚本目录）
SOURCE="$0"
while [[ -L "$SOURCE" ]]; do
    DIR="$(cd "$(dirname "$SOURCE")" && pwd)"
    SOURCE="$(readlink "$SOURCE")"
    [[ "$SOURCE" != /* ]] && SOURCE="$DIR/$SOURCE"
done
SCRIPT_DIR="$(cd "$(dirname "$SOURCE")" && pwd)"
source "$SCRIPT_DIR/config.sh"
source "$SCRIPT_DIR/identify.sh"
source "$SCRIPT_DIR/lib.sh"

# 配置项：优先环境变量，其次默认路径，最后脚本位置计算
if [[ -n "$SOSO_KIT_ROOT" ]]; then
    : # 使用环境变量
elif [[ -d "$DEFAULT_SOSO_KIT_ROOT/.claude" ]]; then
    SOSO_KIT_ROOT="$DEFAULT_SOSO_KIT_ROOT"
else
    SOSO_KIT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
fi

# 颜色/日志函数来自 lib.sh

# 获取当前模式和配置目录
CONFIG_MODE=$(get_sosokit_mode)
CONFIG_DIR_NAME=".${CONFIG_MODE}"
SOSO_KIT_CONFIG="$SOSO_KIT_ROOT/$CONFIG_DIR_NAME"

# 显示帮助
show_help() {
    echo "soso-kit 配置安装/更新脚本"
    echo ""
    echo "当前模式: $CONFIG_MODE ($CONFIG_DIR_NAME)"
    echo ""
    echo "用法: sosokit-install <target-project> [target-project2] ..."
    echo ""
    echo "参数:"
    echo "  target-project  目标项目路径（可指定多个）"
    echo ""
    echo "选项:"
    echo "  -h, --help         显示帮助"
    echo "  --dry-run          预览模式，不实际执行"
    echo "  --force            强制安装：跳过宿主项目 $CONFIG_DIR_NAME 脏工作区检查"
    echo "                     （仅首次安装时检查，未提交改动可能丢失）"
    echo "  --module <name>    显式指定项目（跳过自动识别）"
    echo "                     已注册项目见 .claude/kit/projects.conf"
    echo ""
    echo "示例:"
    echo "  sosokit-install ~/code/my-project"
    echo "  sosokit-install ~/code/project-a ~/code/project-b"
    echo "  sosokit-install --dry-run ~/code/my-project"
    echo ""
    echo "切换模式:"
    echo "  sosokit-switch cursor   # 切换到 .cursor"
    echo "  sosokit-switch claude   # 切换到 .claude"
    exit 0
}

# 幂等写入 .git/info/exclude 标记块
# 参数：exclude_file, config_dir
write_exclude_block() {
    local exclude_file="$1"
    local config_dir="$2"
    local marker_begin="# sosokit-begin: $config_dir"
    local marker_end="# sosokit-end: $config_dir"

    # 确保 exclude 文件存在（新仓库可能没有）
    mkdir -p "$(dirname "$exclude_file")"
    touch "$exclude_file"

    # 删除旧标记块（awk 精确字符串匹配，避免正则歧义）
    if grep -qF "$marker_begin" "$exclude_file" 2>/dev/null; then
        local tmp
        tmp=$(mktemp)
        awk -v b="$marker_begin" -v e="$marker_end" \
            '$0==b{s=1;next} $0==e{s=0;next} !s{print}' \
            "$exclude_file" > "$tmp" && mv "$tmp" "$exclude_file"
    fi

    # 追加新标记块
    {
        echo ""
        echo "$marker_begin"
        echo "/$config_dir/"
        echo "$marker_end"
    } >> "$exclude_file"
}

# 让配置目录对 git 完全透明
# 1. skip-worktree 已追踪文件（隐藏内容变更 & 删除）
# 2. .git/info/exclude 忽略未追踪的新文件
# 参数：target_project, config_dir
hide_from_git() {
    local target_project="$1"
    local config_dir="$2"

    # 1. skip-worktree 已追踪文件（-z/-0 处理含空格/特殊字符路径）
    local tracked_count
    tracked_count=$(cd "$target_project" && git ls-files -z "$config_dir" 2>/dev/null | tr -d -c '\0' | wc -c | tr -d ' ')
    if [[ "$tracked_count" -gt 0 ]]; then
        (cd "$target_project" && git ls-files -z "$config_dir" 2>/dev/null | xargs -0 git update-index --skip-worktree 2>/dev/null) || true
        success "skip-worktree: $tracked_count 个已追踪文件的变更被隐藏"
    fi

    # 2. .git/info/exclude 忽略新文件（worktree-safe：解析真实路径）
    local exclude_file
    exclude_file=$(git_exclude_path "$target_project") || error "无法解析 .git/info/exclude 路径"
    write_exclude_block "$exclude_file" "$config_dir"
    success "exclude: 新文件不会出现在 git status"
}

# 写入安装状态文件（供 sosokit-clean 读取）
# 参数：target_project, mode, install_mode, source_dir, family
write_state() {
    local target_project="$1"
    local mode="$2"
    local install_mode="$3"
    local source_dir="$4"
    local family="$5"
    # worktree-safe：每 worktree 独立 state 文件
    local state_file
    state_file=$(git_state_path "$target_project") || error "无法解析 sosokit-state 路径"

    local git_hash
    git_hash=$(cd "$source_dir" && git rev-parse --short HEAD 2>/dev/null || echo "unknown")
    local install_date
    install_date=$(date "+%Y-%m-%d %H:%M:%S")

    cat > "$state_file" <<EOF
mode=$mode
version=$git_hash
installed=$install_date
install_mode=$install_mode
source=$source_dir
family=$family
EOF
}

# 按家族装入 rules：清空目标 rules/，先装 essential/，再装指定 module
# 参数：target_config, family
apply_family_rules() {
    local target_config="$1"
    local family="$2"
    local essential_dir="$SOSO_KIT_ROOT/.claude/rules/essential"
    local module_dir="$SOSO_KIT_ROOT/.claude/rules/modules/$family"

    if [[ ! -d "$module_dir" ]]; then
        error "家族模块目录不存在: $module_dir"
    fi

    local target_rules="$target_config/rules"
    rm -rf "$target_rules"
    mkdir -p "$target_rules"

    # 先装 essential（跨项目共享规则），再装 module 专属
    # essential 在前可被 module 同名文件覆盖（约定：模块不应与 essential 同名）
    if [[ -d "$essential_dir" ]]; then
        cp "$essential_dir"/*.md "$target_rules/" 2>/dev/null || true
    fi

    cp "$module_dir"/*.md "$target_rules/" 2>/dev/null || {
        warn "模块 $family 无 rules 文件（仅装 essential）"
    }
}

# 安装/更新单个项目
install_to_project() {
    local target_project="$1"
    local dry_run="$2"
    local explicit_module="$3"
    local force="$4"

    # 展开路径
    target_project="${target_project/#\~/$HOME}"
    local target_config="$target_project/$CONFIG_DIR_NAME"

    # 检查目标项目是否存在
    if [[ ! -d "$target_project" ]]; then
        error "目标项目不存在: $target_project"
    fi

    # 项目识别：--module override > identify_project
    local family=""
    if [[ -n "$explicit_module" ]]; then
        family="$explicit_module"
        # 校验 module 目录存在
        if [[ ! -d "$SOSO_KIT_ROOT/.claude/rules/modules/$family" ]]; then
            error "指定的模块不存在: modules/$family"
        fi
    else
        # identify_project 自己处理 soso-kit 本仓拦截（退出码 2）
        family=$(identify_project "$target_project")
        local df_exit=$?
        if [[ $df_exit -ne 0 ]]; then
            exit $df_exit
        fi
    fi

    # 判断模式
    local mode="install"
    if [[ -d "$target_config" ]]; then
        mode="update"
    fi

    # 检测 git 仓库（worktree-safe：.git 可能是目录也可能是文件）
    local has_git="false"
    if [[ -e "$target_project/.git" ]] && git -C "$target_project" rev-parse --git-dir >/dev/null 2>&1; then
        has_git="true"
    fi

    # 首次安装拦截脏工作区：避免吞掉宿主项目 .claude 的未提交改动
    # update 模式允许继续（skip-worktree 已标注原文件，不存在"覆盖用户改动"风险）
    if [[ "$mode" == "install" ]] && [[ "$has_git" == "true" ]] && [[ "$force" != "true" ]]; then
        local dirty
        dirty=$(cd "$target_project" && git status --porcelain -- "$CONFIG_DIR_NAME" 2>/dev/null)
        if [[ -n "$dirty" ]]; then
            echo ""
            echo -e "${RED}✗${NC} 目标项目 $CONFIG_DIR_NAME 存在未提交改动，拒绝首次安装："
            echo ""
            echo "$dirty" | sed 's/^/    /'
            echo ""
            echo "处理方案（任选其一）："
            echo "  1. 提交或 stash 这些改动后重试："
            echo "       (cd $target_project && git add $CONFIG_DIR_NAME && git commit -m 'save')"
            echo "       (cd $target_project && git stash push -- $CONFIG_DIR_NAME)"
            echo "  2. 强制安装（跳过检查，未提交改动可能丢失）："
            echo "       sosokit-install --force $target_project"
            echo ""
            exit 1
        fi
    fi

    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    if [[ "$mode" == "install" ]]; then
        echo -e "  sosokit 安装 ${CYAN}[$CONFIG_MODE]${NC}"
    else
        echo -e "  sosokit 更新 ${CYAN}[$CONFIG_MODE]${NC}"
    fi
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    info "来源: $SOSO_KIT_CONFIG"
    info "目标: $target_project"
    info "家族: $family (rules 来自 modules/$family/)"
    if [[ "$mode" == "install" ]]; then
        info "模式: 首次安装（清空 kit/spec 用户内容）"
    else
        info "模式: 更新（保留 kit/spec 用户内容）"
    fi
    [[ "$dry_run" == "true" ]] && warn "预览模式，不实际执行"
    echo ""

    # 更新模式显示变更文件（install 和 dry-run 都显示）
    # 主 diff + rules 家族化 diff（经 is_excluded 过滤，避免假变更）
    if [[ "$mode" == "update" ]]; then
        walk_main_diff "$SOSO_KIT_CONFIG" "$target_config" "$family" "install"
        walk_rules_diff "$SOSO_KIT_CONFIG/rules/modules/$family" "$target_config/rules"

        local total=$(( ${#_SOSOKIT_ADDED[@]} + ${#_SOSOKIT_MODIFIED[@]} + ${#_SOSOKIT_REMOVED[@]} \
                      + ${#_SOSOKIT_RULES_ADDED[@]} + ${#_SOSOKIT_RULES_MODIFIED[@]} + ${#_SOSOKIT_RULES_REMOVED[@]} ))

        if [[ $total -eq 0 ]]; then
            success "无变更，目标已是最新"
            echo ""
        else
            local f
            for f in "${_SOSOKIT_ADDED[@]}"; do added "$f"; done
            for f in "${_SOSOKIT_RULES_ADDED[@]}"; do added "$f"; done
            for f in "${_SOSOKIT_MODIFIED[@]}"; do modified "$f"; done
            for f in "${_SOSOKIT_RULES_MODIFIED[@]}"; do modified "$f"; done
            for f in "${_SOSOKIT_REMOVED[@]}"; do removed "$f"; done
            for f in "${_SOSOKIT_RULES_REMOVED[@]}"; do removed "$f"; done
            echo ""
        fi
    fi

    if [[ "$dry_run" == "true" ]]; then
        [[ "$mode" == "install" ]] && success "[预览] 将复制整个 $CONFIG_DIR_NAME/ 并清空 kit/spec 用户内容"
    else
        # 更新模式：提前备份 spec 用户内容（保留 scripts/ 外的 flat md + 子目录）
        local spec_backup=""
        if [[ "$mode" == "update" ]]; then
            local spec_dir="$target_config/kit/spec"
            if [[ -d "$spec_dir" ]]; then
                spec_backup=$(mktemp -d)
                shopt -s nullglob
                local _has_backup="false"
                for _item in "$spec_dir"/*; do
                    [[ "$(basename "$_item")" == "scripts" ]] && continue
                    cp -a "$_item" "$spec_backup/"
                    _has_backup="true"
                done
                shopt -u nullglob
                if [[ "$_has_backup" == "true" ]]; then
                    info "备份 kit/spec 用户内容"
                else
                    rmdir "$spec_backup"
                    spec_backup=""
                fi
            fi
        fi

        # 备份目标 settings（install/update 都做：rm -rf 会无差别销毁项目级/本地配置）
        # - settings.json：项目方维护的团队配置（hooks、项目 allow）
        # - settings.local.json：用户个人本地配置
        local settings_backup=""
        for _sname in settings.json settings.local.json; do
            if [[ -f "$target_config/$_sname" ]]; then
                [[ -z "$settings_backup" ]] && settings_backup=$(mktemp -d)
                cp -a "$target_config/$_sname" "$settings_backup/"
            fi
        done
        [[ -n "$settings_backup" ]] && info "备份 settings 文件（保留项目配置）"

        # 关键：先让 git 闭眼（skip-worktree + exclude），再动硬盘
        # 这样即使 rm-rf 后脚本中断，git status 也保持干净
        if [[ "$has_git" == "true" ]]; then
            hide_from_git "$target_project" "$CONFIG_DIR_NAME"
        fi

        # 复制配置目录
        rm -rf "$target_config"
        cp -r "$SOSO_KIT_CONFIG" "$target_config"
        success "复制 $CONFIG_DIR_NAME/"

        # 按家族过滤 rules（清空目标 rules/ + 装入 modules/$family/*.md）
        apply_family_rules "$target_config" "$family"
        success "应用家族 rules: $family ($(ls "$target_config/rules"/*.md 2>/dev/null | wc -l | tr -d ' ') 个)"

        # 过滤 kit/projects/:仅保留当前家族,移除 _template 和其他项目
        local projects_dir="$target_config/kit/projects"
        if [[ -d "$projects_dir" ]]; then
            for dir in "$projects_dir"/*/; do
                [[ -d "$dir" ]] || continue
                local pname=$(basename "$dir")
                if [[ "$pname" != "$family" ]]; then
                    rm -rf "$dir"
                fi
            done
            success "过滤 kit/projects/:仅保留 $family"
        fi

        # 处理 kit/spec 用户内容（flat md + 子目录），保留 scripts/
        local target_spec="$target_config/kit/spec"
        if [[ -d "$target_spec" ]]; then
            find "$target_spec" -mindepth 1 -maxdepth 1 ! -name scripts -exec rm -rf {} + 2>/dev/null || true
        fi
        # 回填优先级：现场备份（update 现场 spec） > 持久备份（clean 之后） > 清空
        # 持久备份 install/update 统一尝试：其存在即"本项目曾被托管过"的信号
        local persist_backup=""
        [[ "$has_git" == "true" ]] && persist_backup=$(spec_backup_dir "$target_project" "$CONFIG_MODE" 2>/dev/null)
        if [[ -n "$spec_backup" ]]; then
            mkdir -p "$target_spec"
            cp -a "$spec_backup"/. "$target_spec/" 2>/dev/null || true
            rm -rf "$spec_backup"
            success "恢复 kit/spec 用户内容（现场）"
        elif [[ -n "$persist_backup" ]] && [[ -d "$persist_backup" ]]; then
            if mkdir -p "$target_spec" && cp -a "$persist_backup"/. "$target_spec/" 2>/dev/null; then
                success "恢复 kit/spec 用户内容（持久备份）"
            else
                # 恢复失败不中止主体安装，打印绝对路径供人工恢复
                warn "从持久备份恢复 spec 失败，请手动恢复：$persist_backup → $target_spec"
            fi
        else
            success "清空 kit/spec 用户内容"
        fi

        # 处理 settings：先抹掉源仓带来的（不该分发），再恢复目标原版
        rm -f "$target_config/settings.json" "$target_config/settings.local.json"
        if [[ -n "$settings_backup" ]]; then
            for _sname in settings.json settings.local.json; do
                [[ -f "$settings_backup/$_sname" ]] && cp -a "$settings_backup/$_sname" "$target_config/$_sname"
            done
            rm -rf "$settings_backup"
            success "恢复 settings 文件"
        else
            success "未发现项目 settings，跳过"
        fi

        # 下发 soso-kit 工作流通用 allow 到目标 settings.local.json（jq union 去重）
        local allows_template="$SOSO_KIT_ROOT/.claude/kit/cli/templates/user-allows.json"
        local target_local="$target_config/settings.local.json"
        if [[ ! -f "$allows_template" ]]; then
            warn "跳过 allow 下发：模板缺失 $allows_template"
        elif ! command -v jq >/dev/null 2>&1; then
            warn "跳过 allow 下发：jq 未安装（brew install jq）"
        else
            if [[ -f "$target_local" ]]; then
                local _tmp_local
                _tmp_local=$(mktemp)
                # 模板用 del(._meta) 剔除说明字段；union allow 数组、unique 去重；其他 key 保留
                if jq -s '
                    .[0] as $cur | (.[1] | del(._meta)) as $tpl |
                    $cur * { permissions: {
                        allow: (($cur.permissions.allow // []) + ($tpl.permissions.allow // [])) | unique
                    }}
                ' "$target_local" "$allows_template" > "$_tmp_local" 2>/dev/null; then
                    mv "$_tmp_local" "$target_local"
                    success "merge 工作流 allow → settings.local.json"
                else
                    rm -f "$_tmp_local"
                    warn "settings.local.json 不是合法 JSON，跳过 allow 下发"
                fi
            else
                # 首次创建：剔除模板的 _meta 说明字段
                jq 'del(._meta)' "$allows_template" > "$target_local"
                success "创建 settings.local.json（仅含工作流 allow 模板）"
            fi
        fi

        # 记录版本信息
        local version_file="$target_config/.soso-kit-version"
        local git_hash
        git_hash=$(cd "$SOSO_KIT_ROOT" && git rev-parse --short HEAD 2>/dev/null || echo "unknown")
        local install_date
        install_date=$(date "+%Y-%m-%d %H:%M:%S")
        {
            echo "source: $SOSO_KIT_ROOT"
            echo "version: $git_hash"
            echo "installed: $install_date"
            echo "mode: $mode"
        } > "$version_file"

        # 写入状态文件（供 clean 读取模式）
        if [[ "$has_git" == "true" ]]; then
            write_state "$target_project" "$CONFIG_MODE" "$mode" "$SOSO_KIT_ROOT" "$family"
        fi
    fi

    # 完成
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    if [[ "$dry_run" == "true" ]]; then
        echo -e "  ${YELLOW}预览完成${NC}"
    elif [[ "$mode" == "install" ]]; then
        echo -e "  ${GREEN}✅ sosokit 安装成功${NC}"
    else
        echo -e "  ${GREEN}✅ sosokit 更新成功${NC}"
    fi
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
}

# 主函数
main() {
    local dry_run="false"
    local explicit_module=""
    local force="false"
    local targets=()

    # 解析参数
    while [[ $# -gt 0 ]]; do
        case "$1" in
            -h|--help)
                show_help
                ;;
            --dry-run)
                dry_run="true"
                shift
                ;;
            --force)
                force="true"
                shift
                ;;
            --module)
                if [[ -z "$2" ]] || [[ "$2" == --* ]]; then
                    error "--module 需要参数（项目名），见 projects.conf"
                fi
                explicit_module="$2"
                shift 2
                ;;
            *)
                targets+=("$1")
                shift
                ;;
        esac
    done

    # 无参数时默认使用当前目录
    if [[ ${#targets[@]} -eq 0 ]]; then
        targets=("$(pwd)")
    fi

    # 检查 soso-kit 配置目录是否存在
    if [[ ! -d "$SOSO_KIT_CONFIG" ]]; then
        error "soso-kit $CONFIG_DIR_NAME 目录不存在: $SOSO_KIT_CONFIG"
    fi

    # 处理每个目标项目
    for target in "${targets[@]}"; do
        install_to_project "$target" "$dry_run" "$explicit_module" "$force"
    done

    # 总结
    if [[ ${#targets[@]} -gt 1 ]]; then
        echo ""
        success "共处理 ${#targets[@]} 个项目"
    fi
}

# 执行
main "$@"
