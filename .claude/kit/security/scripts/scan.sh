#!/bin/bash
# scan.sh - 安全检查扫描脚本
# 使用方式:
#   bash scan.sh list                          — 显示项目列表
#   bash scan.sh branch-check <项目编号>       — 检测分支状态
#   bash scan.sh scan <项目编号> [--confirm-switch|--skip-switch] — 扫描依赖

set -e

# 获取 soso-kit 根目录
if [ -f ".claude/kit/cli/config.sh" ]; then
    KIT_ROOT="$(pwd)"
elif [ -f "../.claude/kit/cli/config.sh" ]; then
    KIT_ROOT="$(cd .. && pwd)"
elif [ -f "../../.claude/kit/cli/config.sh" ]; then
    KIT_ROOT="$(cd ../.. && pwd)"
else
    echo "❌ 未找到 soso-kit 配置"
    exit 1
fi

# 加载项目配置
source "$KIT_ROOT/.claude/kit/security/config.sh"

# 解析项目配置字段
get_project_name()   { echo "$1" | cut -d'|' -f1; }
get_project_path()   { echo "$1" | cut -d'|' -f2; }
get_project_branch() { echo "$1" | cut -d'|' -f3; }

# 解析选中的项目编号（"all" 或 "1,3,5"）
parse_selection() {
    local selection="$1"
    local total=${#PROJECTS[@]}

    if [ "$selection" = "all" ]; then
        seq 0 $((total - 1))
    else
        echo "$selection" | tr ',' '\n' | while read -r num; do
            echo $((num - 1))
        done
    fi
}

# 命令：显示项目列表
cmd_list() {
    echo "📋 项目列表："
    echo ""
    local i=1
    for project in "${PROJECTS[@]}"; do
        local name=$(get_project_name "$project")
        local path=$(get_project_path "$project")
        local branch=$(get_project_branch "$project")
        echo "  $i. $name (分支: $branch)"
        i=$((i + 1))
    done
    echo ""
    echo "请选择：输入 all 全选，或输入编号（如 1,3,5）部分选择"
}

# 命令：批量检测分支状态
cmd_branch_check() {
    local selection="$1"
    local indices=$(parse_selection "$selection")
    local need_switch=0

    echo "🔍 分支状态检测："
    echo ""
    echo "| # | 项目 | 当前分支 | 目标分支 | 状态 |"
    echo "|---|------|---------|---------|------|"

    for idx in $indices; do
        local project="${PROJECTS[$idx]}"
        local name=$(get_project_name "$project")
        local path=$(get_project_path "$project")
        local target_branch=$(get_project_branch "$project")
        local num=$((idx + 1))

        # 检查路径是否存在
        if [ ! -d "$path" ]; then
            echo "| $num | $name | - | $target_branch | ⚠️ 路径不存在 |"
            continue
        fi

        # 检查是否是 git 仓库
        if [ ! -d "$path/.git" ]; then
            echo "| $num | $name | - | $target_branch | ⚠️ 非 git 仓库 |"
            continue
        fi

        # 获取当前分支
        local current_branch=$(cd "$path" && git branch --show-current 2>/dev/null || echo "unknown")

        if [ "$current_branch" = "$target_branch" ]; then
            echo "| $num | $name | $current_branch | $target_branch | ✅ 无需切换 |"
        else
            echo "| $num | $name | $current_branch | $target_branch | ⚠️ 需要切换 |"
            need_switch=$((need_switch + 1))
        fi
    done

    echo ""
    if [ $need_switch -gt 0 ]; then
        echo "⚠️ 有 $need_switch 个项目需要切换分支（会自动 stash/恢复），是否继续？"
    else
        echo "✅ 所有项目已在目标分支，无需切换"
    fi
}

# 命令：扫描依赖
cmd_scan() {
    local selection="$1"
    local switch_mode="$2"  # --confirm-switch 或 --skip-switch
    local indices=$(parse_selection "$selection")

    for idx in $indices; do
        local project="${PROJECTS[$idx]}"
        local name=$(get_project_name "$project")
        local path=$(get_project_path "$project")
        local target_branch=$(get_project_branch "$project")

        echo "===== $name ====="

        # 检查路径
        if [ ! -d "$path" ]; then
            echo "⚠️ $name 路径不存在，已跳过"
            echo "STATUS:SKIPPED:路径不存在"
            echo ""
            continue
        fi

        # 检查 package.json
        if [ ! -f "$path/package.json" ]; then
            echo "⚠️ $name 未找到 package.json，已跳过"
            echo "STATUS:SKIPPED:无 package.json"
            echo ""
            continue
        fi

        cd "$path"

        # 获取当前分支
        local current_branch=$(git branch --show-current 2>/dev/null || echo "unknown")
        local switched=false

        # 分支切换逻辑
        if [ "$current_branch" != "$target_branch" ]; then
            if [ "$switch_mode" = "--skip-switch" ]; then
                echo "⚠️ $name 当前在 $current_branch，用户拒绝切换，已跳过"
                echo "STATUS:SKIPPED:用户拒绝切换分支"
                echo ""
                continue
            fi

            # 检查目标分支是否存在
            if ! git rev-parse --verify "$target_branch" >/dev/null 2>&1; then
                # 尝试 fetch
                git fetch origin "$target_branch" >/dev/null 2>&1 || true
                if ! git rev-parse --verify "origin/$target_branch" >/dev/null 2>&1; then
                    echo "⚠️ $name 分支 $target_branch 不存在，请提供文本输入"
                    echo "STATUS:SKIPPED:分支不存在"
                    echo ""
                    continue
                fi
            fi

            # stash + checkout
            git stash push -m "security-scan-temp" >/dev/null 2>&1 || true
            git checkout "$target_branch" >/dev/null 2>&1
            switched=true
        fi

        # 提取依赖
        echo "DEPS:START"
        extract_deps "$path"
        echo "DEPS:END"
        echo "STATUS:SCANNED"

        # 切回原分支
        if [ "$switched" = true ]; then
            git checkout "$current_branch" >/dev/null 2>&1
            # 恢复 stash（只恢复本次 stash）
            local stash_list=$(git stash list 2>/dev/null | head -1)
            if echo "$stash_list" | grep -q "security-scan-temp"; then
                git stash pop >/dev/null 2>&1 || echo "⚠️ $name stash pop 冲突，已保留 stash，请手动处理"
            fi
        fi

        echo ""
    done
}

# 提取依赖列表
extract_deps() {
    local project_path="$1"

    # 从 package.json 提取 dependencies + devDependencies
    if [ -f "$project_path/package.json" ]; then
        # 使用 node 解析 JSON（比 jq 更通用）
        node -e "
            const pkg = require('$project_path/package.json');
            const deps = { ...pkg.dependencies, ...pkg.devDependencies };
            Object.entries(deps).forEach(([name, version]) => {
                console.log(name + '@' + version);
            });
        " 2>/dev/null || echo "⚠️ package.json 解析失败"
    fi

    # 从 lockfile 提取深层依赖
    if [ -f "$project_path/pnpm-lock.yaml" ]; then
        extract_pnpm_lock "$project_path/pnpm-lock.yaml"
    elif [ -f "$project_path/package-lock.json" ]; then
        extract_npm_lock "$project_path/package-lock.json"
    elif [ -f "$project_path/yarn.lock" ]; then
        extract_yarn_lock "$project_path/yarn.lock"
    fi
}

# 解析 pnpm-lock.yaml 中的包名和版本
extract_pnpm_lock() {
    local lockfile="$1"
    # pnpm v9 格式：'@scope/name@version': 或 'name@version':
    node -e "
        const fs = require('fs');
        const content = fs.readFileSync('$lockfile', 'utf8');
        // 匹配 packages 段之后的 '包名@版本': 格式
        const packagesIdx = content.indexOf('\npackages:');
        if (packagesIdx === -1) process.exit(0);
        const pkgSection = content.slice(packagesIdx);
        // 匹配 '(@scope/name@version)': 或 '(name@version)':
        const regex = /^\s+'(@?[^@'\s][^@']*?)@(\d[^':(]*)/gm;
        let match;
        const seen = new Set();
        while ((match = regex.exec(pkgSection)) !== null) {
            const name = match[1];
            const version = match[2];
            const pkg = name + '@' + version;
            if (!seen.has(pkg)) {
                seen.add(pkg);
                console.log(pkg);
            }
        }
    " 2>/dev/null || true
}

# 解析 package-lock.json 中的包名和版本
extract_npm_lock() {
    local lockfile="$1"
    node -e "
        const lock = require('$lockfile');
        // lockfileVersion 2/3 使用 packages 字段
        const packages = lock.packages || {};
        Object.entries(packages).forEach(([key, val]) => {
            if (key && val.version) {
                // key 格式: node_modules/包名 或 node_modules/@scope/包名
                const name = key.replace(/^node_modules\//, '');
                if (name) console.log(name + '@' + val.version);
            }
        });
        // lockfileVersion 1 使用 dependencies 字段
        if (lock.dependencies && !lock.packages) {
            const walk = (deps, prefix) => {
                Object.entries(deps).forEach(([name, info]) => {
                    console.log(name + '@' + info.version);
                    if (info.dependencies) walk(info.dependencies);
                });
            };
            walk(lock.dependencies);
        }
    " 2>/dev/null || true
}

# 解析 yarn.lock 中的包名和版本
extract_yarn_lock() {
    local lockfile="$1"
    node -e "
        const fs = require('fs');
        const content = fs.readFileSync('$lockfile', 'utf8');
        // yarn.lock 格式：包名@版本范围: \n  version \"实际版本\"
        const regex = /^\"?(@?[^@\s\"]+)@[^:]+:\s*\n\s+version\s+\"([^\"]+)\"/gm;
        let match;
        const seen = new Set();
        while ((match = regex.exec(content)) !== null) {
            const pkg = match[1] + '@' + match[2];
            if (!seen.has(pkg)) {
                seen.add(pkg);
                console.log(pkg);
            }
        }
    " 2>/dev/null || true
}

# 命令：历史 lockfile 回溯
# 用法：bash scan.sh history-check <选择> "<pattern1>|<pattern2>|..."
# 输出每个项目每个 pattern 的命中次数（git log -S 在所有分支 lockfile 中搜索）
cmd_history_check() {
    local selection="$1"
    local patterns_raw="$2"
    local indices=$(parse_selection "$selection")

    if [ -z "$patterns_raw" ]; then
        echo "⚠️ 未提供 pattern，跳过历史回溯"
        return 0
    fi

    # 将 "a|b|c" 拆成数组
    local IFS='|'
    read -r -a patterns <<< "$patterns_raw"
    unset IFS

    for idx in $indices; do
        local project="${PROJECTS[$idx]}"
        local name=$(get_project_name "$project")
        local path=$(get_project_path "$project")

        echo "===== $name ====="

        if [ ! -d "$path/.git" ]; then
            echo "HISTORY:SKIPPED:非 git 仓库"
            echo ""
            continue
        fi

        # 定位 lockfile
        local lockfile=""
        for cand in pnpm-lock.yaml package-lock.json yarn.lock; do
            if [ -f "$path/$cand" ]; then
                lockfile="$cand"
                break
            fi
        done

        if [ -z "$lockfile" ]; then
            echo "HISTORY:SKIPPED:无 lockfile"
            echo ""
            continue
        fi

        echo "HISTORY:START"
        echo "lockfile: $lockfile"
        for pat in "${patterns[@]}"; do
            [ -z "$pat" ] && continue
            # 在所有分支的 lockfile 历史中搜索 pattern，统计命中 commit 数
            local count
            count=$(cd "$path" && git log --all --oneline -S "$pat" -- "$lockfile" 2>/dev/null | wc -l | tr -d ' ')
            if [ "$count" = "0" ]; then
                echo "$pat: NONE"
            else
                echo "$pat: $count commits"
            fi
        done
        echo "HISTORY:END"
        echo ""
    done
}

# 主入口
COMMAND="${1:-list}"
shift || true

case "$COMMAND" in
    list)
        cmd_list
        ;;
    branch-check)
        cmd_branch_check "${1:-all}"
        ;;
    scan)
        cmd_scan "${1:-all}" "${2:-}"
        ;;
    history-check)
        cmd_history_check "${1:-all}" "${2:-}"
        ;;
    *)
        echo "❌ 未知命令: $COMMAND"
        echo "可用命令: list, branch-check, scan, history-check"
        exit 1
        ;;
esac
