#!/bin/bash

# 上下文管理核心函数库，提供项目历史和文档的查询功能
#
# 项目识别：统一使用 .claude/kit/cli/identify.sh 的 identify_project
# 单一权威配置：.claude/kit/projects.conf

# 从当前目录向上查找 soso-kit 根目录（包含 .claude/kit/context/library）
find_kit_root() {
    local current_dir="$(pwd)"
    local max_depth=5
    local depth=0

    while [ $depth -lt $max_depth ]; do
        if [ -d "$current_dir/.claude/kit/context/library" ]; then
            echo "$current_dir"
            return 0
        fi

        # 到达根目录则停止，避免无限向上查找
        if [ "$current_dir" = "/" ]; then
            return 1
        fi

        current_dir="$(cd "$current_dir/.." && pwd)"
        depth=$((depth + 1))
    done

    return 1
}

# 初始化上下文配置
init_context_config() {
    local KIT_ROOT=$(find_kit_root)

    if [ -z "$KIT_ROOT" ]; then
        echo "❌ 未找到 soso-kit 项目根目录"
        echo "请确保在 soso-kit 项目或其子目录中执行此命令"
        return 1
    fi

    # 上下文库目录（固定路径：在 .claude/kit/context/library）
    export CONTEXT_LIBRARY_DIR="$KIT_ROOT/.claude/kit/context/library"

    # 获取当前项目名（优先环境变量，其次 identify_project，兜底 git basename）
    if [ -z "$PROJECT_NAME" ]; then
        # source identify.sh（需要 SOSO_KIT_ROOT 已设置）
        export SOSO_KIT_ROOT="$KIT_ROOT"
        # shellcheck source=/dev/null
        source "$KIT_ROOT/.claude/kit/cli/identify.sh"

        local detected
        if detected=$(identify_project "$(pwd)" 2>/dev/null); then
            export PROJECT_NAME="$detected"
        elif git rev-parse --show-toplevel >/dev/null 2>&1; then
            # 未注册项目：使用 git basename（context-init 会触发注册）
            export PROJECT_NAME=$(basename $(git rev-parse --show-toplevel))
        else
            export PROJECT_NAME="sodex-web"
        fi
    fi

    # 项目上下文目录和索引文件
    export CONTEXT_PROJECT_DIR="$CONTEXT_LIBRARY_DIR/$PROJECT_NAME"
    export CONTEXT_INDEX_FILE="$CONTEXT_PROJECT_DIR/context-index.json"

    # 检测是否在主仓库（soso-kit）中，用于权限控制
    if [ "$(pwd)" = "$KIT_ROOT" ] || [ "$(basename $(git rev-parse --show-toplevel 2>/dev/null || echo ''))" = "soso-kit" ]; then
        export CONTEXT_READONLY_MODE="false"
    else
        export CONTEXT_READONLY_MODE="true"
    fi
}

# 检查索引文件是否存在
check_index_file() {
    if [ ! -f "$CONTEXT_INDEX_FILE" ]; then
        echo "❌ 索引文件不存在: $CONTEXT_INDEX_FILE"
        echo ""
        echo "请先创建 context-index.json 文件或确认项目名称正确"
        echo "当前项目: $PROJECT_NAME"
        return 1
    fi
    return 0
}

# 检查是否允许写操作（只在主仓库允许）
check_write_permission() {
    if [ "$CONTEXT_READONLY_MODE" = "true" ]; then
        echo "❌ 只读模式：当前在 worktree 中，无法修改 context library"
        echo ""
        echo "💡 如需更新 context，请在 soso-kit 主仓库中执行："
        echo "   cd ~/Documents/code/soso-kit"
        echo "   /k/context <update-command>"
        echo ""
        return 1
    fi
    return 0
}

# 加载指定模块的配置文件
load_module_config() {
    local module_id="$1"
    local config_path=$(jq -r ".modules[] | select(.id==\"$module_id\") | .configPath" "$CONTEXT_INDEX_FILE")

    if [ "$config_path" = "null" ] || [ -z "$config_path" ]; then
        return 1
    fi

    local full_path="$CONTEXT_PROJECT_DIR/$config_path"

    if [ ! -f "$full_path" ]; then
        return 1
    fi

    cat "$full_path"
}

# 从模块配置中获取功能信息
get_feature_from_module() {
    local feature_id="$1"

    # 从主索引找到功能所属模块
    local module_id=$(jq -r ".modules[] | select(.features[] == \"$feature_id\") | .id" "$CONTEXT_INDEX_FILE")

    if [ -z "$module_id" ] || [ "$module_id" = "null" ]; then
        return 1
    fi

    # 加载模块配置
    local module_config=$(load_module_config "$module_id")
    if [ -z "$module_config" ]; then
        return 1
    fi

    # 返回功能信息
    echo "$module_config" | jq ".features.\"$feature_id\""
}

# 显示所有功能列表，按分类展示标题和摘要
context_list() {
    init_context_config
    check_index_file || return 1

    echo "📋 功能列表 ($PROJECT_NAME)"
    echo ""

    # 读取所有模块
    jq -r '.modules[] | @json' "$CONTEXT_INDEX_FILE" | while read -r module_json; do
        local module_id=$(echo "$module_json" | jq -r '.id')
        local emoji=$(echo "$module_json" | jq -r '.emoji')
        local name=$(echo "$module_json" | jq -r '.name')
        local description=$(echo "$module_json" | jq -r '.description')
        local features=$(echo "$module_json" | jq -r '.features[]' 2>/dev/null || echo "")

        echo "$emoji $name ($description)"

        if [ -z "$features" ]; then
            echo "  (暂无功能)"
            echo ""
            continue
        fi

        # 加载模块配置
        local module_config=$(load_module_config "$module_id")
        if [ -z "$module_config" ]; then
            echo "  (模块配置加载失败)"
            echo ""
            continue
        fi

        # 显示该模块下的所有功能
        echo "$features" | while read item_id; do
            local feature=$(echo "$module_config" | jq ".features.\"$item_id\"")
            local title=$(echo "$feature" | jq -r '.title')
            local summary=$(echo "$feature" | jq -r '.summary')
            local updated=$(echo "$feature" | jq -r '.updated')

            echo "  [$item_id] $title"
            echo "    $summary"
            echo "    更新: $updated"
            echo ""
        done
    done
}

# 搜索功能，支持在 ID、标题、摘要、标签、章节摘要、组件名中模糊匹配
# 按命中数排序，输出紧凑格式
context_search() {
    local keyword="$1"

    init_context_config
    check_index_file || return 1

    if [ -z "$keyword" ]; then
        echo "❌ 请提供搜索关键词"
        echo "用法: /k/context search <keyword>"
        return 1
    fi

    local keyword_lower=$(echo "$keyword" | tr '[:upper:]' '[:lower:]')
    local tmp_file=$(mktemp)

    # 遍历所有模块，收集匹配结果到临时文件（格式: hit_count\titem_id\tmodule_name\ttitle\tsummary\ttags）
    jq -r '.modules[] | @json' "$CONTEXT_INDEX_FILE" | while read -r module_json; do
        local module_id=$(echo "$module_json" | jq -r '.id')
        local module_name=$(echo "$module_json" | jq -r '.name')
        local features=$(echo "$module_json" | jq -r '.features[]' 2>/dev/null || echo "")

        [ -z "$features" ] && continue

        local module_config=$(load_module_config "$module_id")
        [ -z "$module_config" ] && continue

        echo "$features" | while read item_id; do
            local feature=$(echo "$module_config" | jq ".features.\"$item_id\"")
            local title=$(echo "$feature" | jq -r '.title')
            local summary=$(echo "$feature" | jq -r '.summary')
            local tags=$(echo "$feature" | jq -r '.tags | join(", ")' 2>/dev/null)

            # 扩展搜索域：+ sections[].summary + keyComponents
            local core_logic=$(echo "$feature" | jq -r '.quickRef.coreLogic[]?' 2>/dev/null | tr '\n' ' ')
            local sections_summary=$(echo "$feature" | jq -r '.sections[]?.summary' 2>/dev/null | tr '\n' ' ')
            local key_components=$(echo "$feature" | jq -r '.quickRef.keyComponents[]?' 2>/dev/null | tr '\n' ' ')

            local search_text=$(echo "$item_id $title $summary $tags $core_logic $sections_summary $key_components" | tr '[:upper:]' '[:lower:]')
            local hit_count=$(echo "$search_text" | grep -o "$keyword_lower" | wc -l | tr -d ' ')

            if [ "$hit_count" -gt 0 ]; then
                printf "%s\t%s\t%s\t%s\t%s\t%s\n" \
                    "$hit_count" "$item_id" "$module_name" "$title" "$summary" "$tags" >> "$tmp_file"
            fi
        done
    done

    local count=$(wc -l < "$tmp_file" | tr -d ' ')

    if [ "$count" -eq 0 ]; then
        echo "🔍 未找到: \"$keyword\""
        rm -f "$tmp_file"
        return 0
    fi

    echo "🔍 \"$keyword\" → $count 个结果"
    echo ""

    # 按命中数降序排序，紧凑输出（移除 coreLogic，节省 ~60% token）
    sort -t$'\t' -k1 -rn "$tmp_file" | while IFS=$'\t' read -r hits item_id module_name title summary tags; do
        echo "[$item_id] $title  ($module_name)"
        echo "  $summary"
        [ -n "$tags" ] && echo "  #$tags"
        echo ""
    done

    echo "💡 /k/context load <id>  查看详情 | --full 查看完整文档"

    rm -f "$tmp_file"
}

# 显示最近更新记录，按时间倒序排列
context_recent() {
    init_context_config
    check_index_file || return 1

    echo "📅 最近更新"
    echo ""

    # 读取 recentQueue（v2.2 结构调整为顶层）
    local count=$(jq '.recentQueue | length' "$CONTEXT_INDEX_FILE")

    if [ "$count" -eq 0 ]; then
        echo "暂无更新记录"
        return 0
    fi

    for i in $(seq 0 $(($count - 1))); do
        local date=$(jq -r ".recentQueue[$i].date" "$CONTEXT_INDEX_FILE")
        local type=$(jq -r ".recentQueue[$i].type" "$CONTEXT_INDEX_FILE")
        local item_id=$(jq -r ".recentQueue[$i].id" "$CONTEXT_INDEX_FILE")
        local summary=$(jq -r ".recentQueue[$i].summary" "$CONTEXT_INDEX_FILE")

        echo "[$date] [$type] $item_id"
        echo "  $summary"
        echo ""
    done
}

# 加载并显示功能文档
# 默认: 摘要 + quickRef + sections 索引（~300 token）
# --full: 追加完整参考文档（~5000 token）
context_load() {
    local raw="$1"
    local full_mode=false
    local section_mode=false
    local section_num=""
    local item_id

    # 解析 --section <n>
    if echo "$raw" | grep -qE -- "--section"; then
        section_mode=true
        section_num=$(echo "$raw" | grep -oE -- "--section [0-9]+" | grep -oE '[0-9]+')
        item_id=$(echo "$raw" | sed -E 's/--section [0-9]+//' | tr -s ' ' | sed 's/^ //;s/ $//')
    # 解析 --full / -f 标志
    elif echo "$raw" | grep -qE -- "--full|-f\b"; then
        full_mode=true
        item_id=$(echo "$raw" | sed -E 's/--full|-f//' | tr -s ' ' | sed 's/^ //;s/ $//')
    else
        item_id="$raw"
    fi

    init_context_config
    check_index_file || return 1

    if [ -z "$item_id" ]; then
        echo "❌ 请提供功能 ID"
        echo "用法: /k/context load <id>          # 摘要模式（默认）"
        echo "      /k/context load <id> --full   # 加载完整文档"
        echo ""
        echo "提示: 使用 /k/context list 查看所有功能 ID"
        return 1
    fi

    # 从模块配置中获取功能信息
    local feature=$(get_feature_from_module "$item_id")
    if [ -z "$feature" ] || [ "$feature" = "null" ]; then
        echo "❌ 未找到功能: $item_id"
        echo ""
        echo "提示: 使用 /k/context list 查看所有功能 ID"
        return 1
    fi

    # ── --section 模式：提取单章节，跳过 L2 输出（token 优先）──────────────
    if [ "$section_mode" = true ]; then
        local sections_count=$(echo "$feature" | jq ".sections | length")

        # 无效编号：列出可用章节
        if [ -z "$section_num" ] || [ "$section_num" -lt 1 ] || [ "$section_num" -gt "$sections_count" ]; then
            echo "❌ 章节编号无效，共 $sections_count 章（1-$sections_count）"
            echo ""
            for i in $(seq 0 $(($sections_count - 1))); do
                local t=$(echo "$feature" | jq -r ".sections[$i].title")
                local tk=$(echo "$feature" | jq -r ".sections[$i].estimatedTokens")
                echo "  [$((i+1))] $t  ~$tk tokens"
            done
            return 1
        fi

        # 解析文档路径
        local doc_path=$(echo "$feature" | jq -r ".referencePath")
        if [ "$doc_path" = "null" ] || [ -z "$doc_path" ]; then
            local module_id=$(jq -r ".modules[] | select(.features[] == \"$item_id\") | .id" "$CONTEXT_INDEX_FILE")
            local module_config=$(load_module_config "$module_id")
            doc_path=$(echo "$module_config" | jq -r ".history.\"$item_id\"[0].historyPath")
        fi
        local full_path="$CONTEXT_PROJECT_DIR/$doc_path"

        if [ ! -f "$full_path" ]; then
            echo "❌ 文档不存在: $full_path"
            return 1
        fi

        local idx=$((section_num - 1))
        local start=$(echo "$feature" | jq -r ".sections[$idx].lineRange[0]")
        local end=$(echo "$feature" | jq -r ".sections[$idx].lineRange[1]")
        local sec_title=$(echo "$feature" | jq -r ".sections[$idx].title")
        local sec_tokens=$(echo "$feature" | jq -r ".sections[$idx].estimatedTokens")

        echo "📄 $item_id  [§$section_num/$sections_count: $sec_title]  ~$sec_tokens tokens"
        echo ""
        sed -n "${start},${end}p" "$full_path"
        echo ""
        echo "💡 其他章节: /k/context load $item_id --section <n> | 完整文档: --full"
        return 0
    fi

    local load_label=$( [ "$full_mode" = true ] && echo "完整文档" || echo "摘要" )
    echo "📄 $item_id  [$load_label]"
    echo ""

    # ── L2: quickRef 摘要层 ──────────────────────────────────────────────────
    local title=$(echo "$feature" | jq -r ".title")
    local summary=$(echo "$feature" | jq -r ".summary")
    local discovery_cost=$(echo "$feature" | jq -r ".discovery_cost // empty")

    echo "标题: $title"
    echo "摘要: $summary"
    [ -n "$discovery_cost" ] && echo "研究成本: $discovery_cost"
    echo ""

    # quickRef.coreLogic
    local core_logic_count=$(echo "$feature" | jq ".quickRef.coreLogic | length" 2>/dev/null)
    if [ -n "$core_logic_count" ] && [ "$core_logic_count" -gt 0 ]; then
        echo "核心逻辑:"
        for i in $(seq 0 $(($core_logic_count - 1))); do
            local logic=$(echo "$feature" | jq -r ".quickRef.coreLogic[$i]")
            echo "  • $logic"
        done
        echo ""
    fi

    # quickRef.keyFiles
    local key_files_count=$(echo "$feature" | jq ".quickRef.keyFiles | length" 2>/dev/null)
    if [ -n "$key_files_count" ] && [ "$key_files_count" -gt 0 ]; then
        echo "关键文件:"
        for i in $(seq 0 $(($key_files_count - 1))); do
            local kf=$(echo "$feature" | jq -r ".quickRef.keyFiles[$i]")
            echo "  $kf"
        done
        echo ""
    fi

    # tags
    local tags=$(echo "$feature" | jq -r ".tags | join(\", \")" 2>/dev/null)
    [ -n "$tags" ] && echo "标签: $tags" && echo ""

    echo "💡 查看完整文档: /k/context load $item_id --full"
    echo ""

    # 检查是否有 sections（L2.5层 - 章节索引）
    local has_sections=$(echo "$feature" | jq -r ".sections")

    if [ "$has_sections" != "null" ]; then
        # 获取文档路径用于验证
        local ref_path=$(echo "$feature" | jq -r ".referencePath")
        local doc_full_path=""
        if [ "$ref_path" != "null" ] && [ -n "$ref_path" ]; then
            doc_full_path="$CONTEXT_PROJECT_DIR/$ref_path"
        fi

        # 快速验证章节数量（如果文档存在）
        if [ -n "$doc_full_path" ] && [ -f "$doc_full_path" ]; then
            local actual_sections=$(grep -c "^## " "$doc_full_path" 2>/dev/null || echo "0")
            local config_sections=$(echo "$feature" | jq ".sections | length")

            if [ "$actual_sections" != "$config_sections" ]; then
                echo "⚠️  章节配置可能过期（文档: $actual_sections, 配置: $config_sections）"
                echo "   运行 validate-sections.sh --fix 生成修复建议"
                echo ""
            fi
        fi

        echo "📑 章节索引 (L2.5)"
        echo ""

        # 获取 sections 数量
        local sections_count=$(echo "$feature" | jq ".sections | length")

        # 循环显示每个章节
        for i in $(seq 0 $(($sections_count - 1))); do
            local section_title=$(echo "$feature" | jq -r ".sections[$i].title")
            local section_summary=$(echo "$feature" | jq -r ".sections[$i].summary")
            local section_range=$(echo "$feature" | jq -r ".sections[$i].lineRange | \"[\(.[0])-\(.[1])]\"")
            local section_tokens=$(echo "$feature" | jq -r ".sections[$i].estimatedTokens")

            echo "[$((i + 1))] $section_title $section_range (~$section_tokens tokens)"
            echo "    $section_summary"
            echo ""
        done

        echo "---"
        echo ""
    fi

    # 优先加载 referencePath
    local doc_path=$(echo "$feature" | jq -r ".referencePath")

    if [ "$doc_path" = "null" ] || [ -z "$doc_path" ]; then
        # 如果没有 referencePath，尝试从模块的 history 中加载
        local module_id=$(jq -r ".modules[] | select(.features[] == \"$item_id\") | .id" "$CONTEXT_INDEX_FILE")
        local module_config=$(load_module_config "$module_id")

        doc_path=$(echo "$module_config" | jq -r ".history.\"$item_id\"[0].historyPath")

        if [ "$doc_path" = "null" ] || [ -z "$doc_path" ]; then
            echo "❌ 未找到文档路径"
            return 1
        fi
    fi

    local full_path="$CONTEXT_PROJECT_DIR/$doc_path"

    if [ ! -f "$full_path" ]; then
        echo "❌ 文档文件不存在: $full_path"
        return 1
    fi

    # 非 --full 模式：到此结束，不加载完整文档
    if [ "$full_mode" = false ]; then
        return 0
    fi

    echo "📖 完整文档 (L3)"
    echo ""
    echo "文件路径: $doc_path"
    echo "---"
    echo ""
    cat "$full_path"
}

# 显示功能的演进时间线，包含所有历史更新记录
context_timeline() {
    local item_id="$1"

    init_context_config
    check_index_file || return 1

    if [ -z "$item_id" ]; then
        echo "❌ 请提供功能 ID"
        echo "用法: /k/context timeline <id>"
        return 1
    fi

    # 从模块配置中获取功能信息
    local feature=$(get_feature_from_module "$item_id")
    if [ -z "$feature" ] || [ "$feature" = "null" ]; then
        echo "❌ 未找到功能: $item_id"
        return 1
    fi

    local title=$(echo "$feature" | jq -r ".title")

    echo "📅 功能演进时间线: $item_id"
    echo ""
    echo "功能: $title"
    echo ""

    # 获取模块ID并加载历史记录
    local module_id=$(jq -r ".modules[] | select(.features[] == \"$item_id\") | .id" "$CONTEXT_INDEX_FILE")
    local module_config=$(load_module_config "$module_id")
    local history=$(echo "$module_config" | jq ".history.\"$item_id\"")

    # 获取历史记录数量
    local count=$(echo "$history" | jq "length")

    if [ "$count" = "null" ] || [ "$count" -eq 0 ]; then
        echo "暂无历史记录"
        return 0
    fi

    echo "总更新次数: $count"
    echo ""

    # 循环输出每条历史记录
    for i in $(seq 0 $(($count - 1))); do
        local date=$(echo "$history" | jq -r ".[$i].date")
        local type=$(echo "$history" | jq -r ".[$i].type")
        local summary=$(echo "$history" | jq -r ".[$i].summary")
        local files=$(echo "$history" | jq -r ".[$i].files | join(\", \")")

        echo "[$date] [$type]"
        echo "  $summary"
        echo "  文件: $files"
        echo ""
    done
}

# 查询涉及指定文件的所有功能，支持路径模糊匹配
context_files() {
    local file_pattern="$1"

    init_context_config
    check_index_file || return 1

    if [ -z "$file_pattern" ]; then
        echo "❌ 请提供文件路径或模式"
        echo "用法: /k/context files <path>"
        return 1
    fi

    echo "📁 文件历史: $file_pattern"
    echo ""

    local found=0

    # 搜索 byFiles 索引
    jq -r '.indexes.byFiles | keys[]' "$CONTEXT_INDEX_FILE" | while read file_path; do
        # 如果文件路径包含搜索模式
        if echo "$file_path" | grep -i "$file_pattern" >/dev/null; then
            echo "文件: $file_path"
            echo "涉及功能:"

            # 读取涉及的功能 ID
            jq -r ".indexes.byFiles.\"$file_path\"[]" "$CONTEXT_INDEX_FILE" | while read item_id; do
                local title=$(jq -r ".reference.\"$item_id\".title" "$CONTEXT_INDEX_FILE")
                echo "  - [$item_id] $title"
            done
            echo ""
            found=1
        fi
    done

    if [ $found -eq 0 ]; then
        echo "未找到匹配的文件"
    fi
}

# 添加新功能（占位符，需要在主仓库执行）
context_add() {
    init_context_config
    check_write_permission || return 1

    echo "📝 添加新功能到 context library"
    echo ""
    echo "⚠️  此功能正在开发中，即将推出..."
    echo ""
    echo "当前支持的操作："
    echo "  - 手动编辑: $CONTEXT_INDEX_FILE"
    echo "  - 手动添加文档到: $CONTEXT_PROJECT_DIR/history/ 或 reference/"
    return 1
}

# 更新功能元数据（需要在主仓库执行）
# 注意：此函数已迁移为 WORKFLOW.md 形式，由 Claude 直接执行
# 实际入口在 context.md，通过 source update/WORKFLOW.md 触发
# 此函数保留作 fallback，正常路径不会走到这里
context_update() {
    echo "⚠️  请通过 /k/context update <id> 触发（WORKFLOW.md 模式）"
    echo "   直接调用此函数已废弃"
}

# 删除功能（需要在主仓库执行）
context_remove() {
    local feature_id="$1"
    init_context_config
    check_write_permission || return 1

    bash "$KIT_ROOT/.claude/kit/context/action/remove/scripts/remove-feature.sh" "$feature_id"
}

# 从代码学习生成 Context 文档（需要在主仓库执行）
# 注意：此函数已迁移为 WORKFLOW.md 形式，由 Claude 直接执行
# 实际入口在 context.md，通过 source WORKFLOW.md 触发
# 此函数保留作 fallback，正常路径不会走到这里
context_learn() {
    local code_path="$1"
    init_context_config
    check_write_permission || return 1

    echo "⚠️  请通过 /k/context learn <path> 触发（WORKFLOW.md 模式）"
    echo "   直接调用此函数已废弃"
}

# 初始化新项目的 context library 骨架（不受 write_permission 限制）
# 用法: context_init "--dry-run /path" 或 context_init "/path"
context_init() {
    local KIT_ROOT=$(find_kit_root)

    if [ -z "$KIT_ROOT" ]; then
        echo "❌ 未找到 soso-kit 项目根目录"
        return 1
    fi

    # 将输入字符串拆分为独立参数传递给脚本
    eval bash "$KIT_ROOT/.claude/kit/context/action/init/init-project.sh" "$KIT_ROOT" $1
}

# 直接执行时显示帮助，source 时导出函数
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
    echo "Context Library v2.0"
    echo ""
    echo "查询命令（只读，任何位置可用）："
    echo "  - context_list"
    echo "  - context_search <keyword>"
    echo "  - context_recent"
    echo "  - context_load <id>"
    echo "  - context_timeline <id>"
    echo "  - context_files <path>"
    echo ""
    echo "更新命令（需要在 soso-kit 主仓库执行）："
    echo "  - context_add        (开发中)"
    echo "  - context_update     (开发中)"
    echo "  - context_remove     (开发中)"
    echo ""
    echo "使用方法: source context-lib.sh"
fi

# 查询文件涉及的功能
context_query_file() {
    local file_path="$1"
    bash "$KIT_ROOT/.claude/kit/context/query/query-file.sh" "$file_path"
}

# 查询使用某标签的功能
context_query_tag() {
    local tag_name="$1"
    bash "$KIT_ROOT/.claude/kit/context/query/query-tag.sh" "$tag_name"
}

# 提取文件符号骨架（AST outline）
context_outline() {
    local file_path="$1"

    if [ -z "$file_path" ]; then
        echo "❌ 缺少参数: 文件路径"
        echo "用法: /k/context outline <file-path>"
        return 1
    fi

    # 绝对路径时用文件所在目录作为 project root，让 Node.js 向上找 node_modules/typescript
    local project_root
    if [[ "$file_path" == /* ]]; then
        project_root="$(dirname "$file_path")"
    else
        project_root="$(pwd)"
    fi

    bash "$KIT_ROOT/.claude/kit/context/tools/outline.sh" "$file_path" "$project_root"
}

# 提取指定符号的完整实现（AST unfold）
context_unfold() {
    local file_path="$1"
    local symbol_name="$2"

    if [ -z "$file_path" ] || [ -z "$symbol_name" ]; then
        echo "❌ 缺少参数: 文件路径 或 符号名"
        echo "用法: /k/context unfold <file-path> <symbol-name>"
        echo "示例: /k/context unfold src/stores/VaultStore.ts VaultStore.deposit"
        echo "      /k/context unfold src/hooks/useVault.ts useVault"
        return 1
    fi

    # 绝对路径时用文件所在目录作为 project root，让 Node.js 向上找 node_modules/typescript
    local project_root
    if [[ "$file_path" == /* ]]; then
        project_root="$(dirname "$file_path")"
    else
        project_root="$(pwd)"
    fi

    bash "$KIT_ROOT/.claude/kit/context/tools/unfold.sh" "$file_path" "$symbol_name" "$project_root"
}

# 兜底重建反向索引（files.json / tags.json）：从 router/*.json 重新派生
context_rebuild_indexes() {
    local dry_run_flag=""
    if [ "$1" = "--dry-run" ] || [ "$1" = "-n" ]; then
        dry_run_flag="--dry-run"
    fi

    init_context_config

    if [ "$PROJECT_NAME" = "soso-kit" ]; then
        echo "❌ 在 soso-kit 主仓库下无法定位目标项目"
        echo "💡 请在具体项目仓库（如 sodex-web）下运行，或显式指定:"
        echo "   bash $KIT_ROOT/.claude/kit/context/shared/rebuild-indexes.sh --project <name>"
        return 1
    fi

    bash "$KIT_ROOT/.claude/kit/context/shared/rebuild-indexes.sh" \
        --project "$PROJECT_NAME" \
        $dry_run_flag
}

# 显示命令帮助信息
context_help() {
    echo "上下文管理命令 - 使用指南"
    echo ""
    echo "用法: /k/context [子命令] [参数]"
    echo ""
    echo "📖 查询命令（只读，任何位置可用）："
    echo "  list, ls              显示所有功能列表（按分类）"
    echo "  search, s <keyword>   搜索功能（按关键词）"
    echo "  load, l <id>                  加载摘要（quickRef + sections索引）"
    echo "  load <id> --section <n>       加载指定章节（~400-700 tokens）"
    echo "  load <id> --full              加载完整文档（~3000-6500 tokens）"
    echo "  files, f <path>       查询文件涉及的功能"
    echo "  outline, o <path>     提取文件符号骨架（函数/类型/行号）"
    echo "  unfold, u <path> <symbol>  提取指定符号完整实现（精准取函数）"
    echo "  tag <tag-name>        查询使用某标签的功能"
    echo ""
    echo "🚀 项目初始化："
    echo "  init <path-or-name>   初始化新项目 context 骨架（支持补全）"
    echo ""
    echo "✏️  更新命令（需在 soso-kit 主仓库执行）:"
    echo "  record                记录功能到 Context Library"
    echo "  learn <path>          从代码学习生成 Context 文档"
    echo "  update <id>           更新功能元数据"
    echo "  remove, rm <id>       删除功能"
    echo ""
    echo "🛠️  维护命令："
    echo "  rebuild-indexes       从 router/ 重建 files.json / tags.json"
    echo "  rebuild-indexes -n    dry-run 预览（不写入）"
    echo ""
    echo "  help, h               显示此帮助信息"
    echo ""
    echo "示例："
    echo "  /k/context list"
    echo "  /k/context search vault"
    echo "  /k/context load transfer-01"
    echo "  /k/context files src/hooks/useAutoSwitchNetwork.ts"
    echo "  /k/context outline src/hooks/useVaultDeposit.ts"
    echo "  /k/context unfold src/stores/VaultStore.ts VaultStore.deposit"
    echo "  /k/context tag state-machine"
    echo "  /k/context init /path/to/project"
    echo "  /k/context record"
    echo ""
    echo "💡 提示："
    echo "  - 在 worktree 中：只能查询，无法修改"
    echo "  - 在 soso-kit 主仓库：可以查询和更新"
}
