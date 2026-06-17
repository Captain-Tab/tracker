#!/bin/bash

# 通用辅助函数库，为 record 命令提供基础功能

# 读取 spec 文档内容
read_spec_content() {
    local spec_dir="$1"
    local spec_file="$spec_dir/spec.md"

    if [ -f "$spec_file" ]; then
        cat "$spec_file"
    else
        # 如果没有 spec.md，合并所有 .md 文件
        find "$spec_dir" -name "*.md" -exec cat {} \; 2>/dev/null || echo ""
    fi
}

# 读取 history 文档内容
read_history_content() {
    local history_dir="$1"
    local matched_file="$2"

    if [ -n "$matched_file" ] && [ -f "$history_dir/$matched_file" ]; then
        cat "$history_dir/$matched_file"
    else
        echo ""
    fi
}

# 提取核心流程图
extract_core_flowcharts() {
    local content="$1"

    # 提取所有代码块内容（包括流程图）
    echo "$content" | awk '/```/{if(flag){print buf; buf=""} flag=!flag; next} flag{buf=buf $0 "\n"}'
}

# 提取核心组件列表
extract_core_components() {
    local content="$1"

    # 提取表格或列表形式的组件信息
    echo "$content" | grep -E "^(- |\| )" | grep -iE "(component|hook|file|function|组件|钩子)"
}

# 生成文档文件名
generate_doc_filename() {
    local feature_slug="$1"
    local change_type="$2"

    local date_prefix=$(date +%Y%m%d)

    echo "${date_prefix}-${feature_slug}-${change_type}.md"
}

# 备份文件
backup_file() {
    local file_path="$1"
    local backup_dir=".claude/kit/context/record/.backup/$(date +%Y%m%d-%H%M%S)"

    if [ -f "$file_path" ]; then
        mkdir -p "$backup_dir"
        cp "$file_path" "$backup_dir/"
        echo "$backup_dir/$(basename "$file_path")"
    else
        echo ""
    fi
}

# 验证 JSON 格式
validate_json() {
    local json_file="$1"

    if [ ! -f "$json_file" ]; then
        echo "❌ 文件不存在: $json_file"
        return 1
    fi

    if ! jq empty "$json_file" 2>/dev/null; then
        echo "❌ JSON 格式错误: $json_file"
        return 1
    fi

    return 0
}

# 从 feature ID 提取 feature slug（去除数字后缀）
extract_feature_slug() {
    local feature_id="$1"
    echo "$feature_id" | sed 's/-[0-9]*$//'
}

# 估算 token 数（粗略估计）
estimate_tokens() {
    local content="$1"
    local char_count=$(echo "$content" | wc -c)
    # 粗略估算：中文约 2 字符/token，英文约 4 字符/token
    # 取平均值 3 字符/token
    echo $(( char_count / 3 ))
}

# 提取文件路径列表
extract_file_paths() {
    local content="$1"

    # 匹配 src/... 路径
    echo "$content" | grep -oE "src/[a-zA-Z0-9/_-]+\.(ts|tsx|js|jsx|vue|css|scss)" | sort -u
}

# 提取标签关键词
extract_tags() {
    local content="$1"
    local module="$2"

    # 从内容中提取常见技术关键词
    local keywords=$(echo "$content" | grep -oiE "(modal|hook|state|api|store|component|feature|fix|refactor|bridge|stake|vault|deposit|withdraw|transfer|network|chain)" | tr '[:upper:]' '[:lower:]' | sort -u | head -10)

    # 添加模块名作为第一个标签
    if [ -n "$keywords" ]; then
        echo "$module"
        echo "$keywords"
    else
        echo "$module"
    fi
}

# 清理临时文件
cleanup_temp_files() {
    local temp_dir=".claude/kit/context/record/.temp"
    if [ -d "$temp_dir" ]; then
        rm -rf "$temp_dir"
    fi
}

# 创建临时目录
create_temp_dir() {
    local temp_dir=".claude/kit/context/record/.temp/$(date +%Y%m%d-%H%M%S)"
    mkdir -p "$temp_dir"
    echo "$temp_dir"
}

# 合并多行为单行（用于 JSON）
merge_lines() {
    tr '\n' ' ' | sed 's/  */ /g'
}

# 计算内容哈希（用于去重检测）
# 对 JSON 规范化排序后取 SHA-256 前 16 位
compute_content_hash() {
    local json_content="$1"
    echo "$json_content" | jq -Sc '.' 2>/dev/null | shasum -a 256 | cut -c1-16
}

# 批量备份多个文件到同一目录
# 用法: backup_batch file1 file2 file3 ...
# 输出: 备份目录路径
backup_batch() {
    local backup_dir=".claude/kit/context/record/.backup/$(date +%Y%m%d-%H%M%S)"
    mkdir -p "$backup_dir"

    for file_path in "$@"; do
        if [ -f "$file_path" ]; then
            cp "$file_path" "$backup_dir/"
        fi
    done

    echo "$backup_dir"
}

# 从批量备份恢复所有文件
# 用法: rollback_batch <backup_dir> <target_dir1/file1> <target_dir2/file2> ...
rollback_batch() {
    local backup_dir="$1"
    shift

    if [ ! -d "$backup_dir" ]; then
        echo "❌ 备份目录不存在: $backup_dir"
        return 1
    fi

    for file_path in "$@"; do
        local filename=$(basename "$file_path")
        if [ -f "$backup_dir/$filename" ]; then
            cp "$backup_dir/$filename" "$file_path"
            echo "  ↩️  已恢复: $file_path"
        fi
    done
}

# 跨文件一致性校验
# 验证 context-index、router、files-index、tags-index 之间的引用完整性
validate_integrity() {
    local context_dir="$1"
    local index_file="$context_dir/context-index.json"
    local files_index="$context_dir/indexes/files.json"
    local tags_index="$context_dir/indexes/tags.json"
    local errors=0

    if [ ! -f "$index_file" ]; then
        echo "❌ context-index.json 不存在"
        return 1
    fi

    echo "🔗 跨文件一致性校验"

    # 收集 context-index 中所有 feature ID
    local all_index_fids=$(jq -r '[.modules[].features[]] | unique | .[]' "$index_file")

    # 1. context-index 中每个 module 的 feature ID 必须在对应 router 中存在
    local module_count=$(jq '.modules | length' "$index_file")
    for i in $(seq 0 $(($module_count - 1))); do
        local mod_id=$(jq -r ".modules[$i].id" "$index_file")
        local config_path=$(jq -r ".modules[$i].configPath" "$index_file")
        local router_file="$context_dir/$config_path"

        if [ ! -f "$router_file" ]; then
            echo "  ❌ router 文件不存在: $config_path"
            errors=$((errors + 1))
            continue
        fi

        # 逐个检查 feature ID
        local feature_ids=$(jq -r ".modules[$i].features[]" "$index_file" 2>/dev/null)
        for fid in $feature_ids; do
            [ -z "$fid" ] && continue
            if ! jq -e ".features.\"$fid\"" "$router_file" >/dev/null 2>&1; then
                echo "  ❌ $fid 在 context-index[$mod_id] 中但不在 router/$mod_id.json 中"
                errors=$((errors + 1))
            fi
        done
    done

    # 2. files-index 中的 feature ID 必须在 context-index 中存在
    if [ -f "$files_index" ]; then
        local files_fids=$(jq -r '[.index[].features[]] | unique | .[]' "$files_index" 2>/dev/null)
        for fid in $files_fids; do
            [ -z "$fid" ] && continue
            if ! echo "$all_index_fids" | grep -qx "$fid"; then
                echo "  ❌ $fid 在 files.json 中但不在 context-index 中"
                errors=$((errors + 1))
            fi
        done
    fi

    # 3. tags-index 中的 feature ID 必须在 context-index 中存在
    if [ -f "$tags_index" ]; then
        local tags_fids=$(jq -r '[.index[]] | flatten | unique | .[]' "$tags_index" 2>/dev/null)
        for fid in $tags_fids; do
            [ -z "$fid" ] && continue
            if ! echo "$all_index_fids" | grep -qx "$fid"; then
                echo "  ❌ $fid 在 tags.json 中但不在 context-index 中"
                errors=$((errors + 1))
            fi
        done
    fi

    # 4. totalFeatures 是否与实际数量一致
    local declared_total=$(jq '.meta.totalFeatures' "$index_file")
    local actual_total=$(jq '[.modules[].features | length] | add' "$index_file")
    if [ "$declared_total" != "$actual_total" ]; then
        echo "  ❌ totalFeatures 不一致: 声明=$declared_total, 实际=$actual_total"
        errors=$((errors + 1))
    fi

    if [ $errors -eq 0 ]; then
        echo "  ✅ 一致性校验通过"
        return 0
    else
        echo "  ❌ 发现 $errors 个一致性问题"
        return 1
    fi
}
