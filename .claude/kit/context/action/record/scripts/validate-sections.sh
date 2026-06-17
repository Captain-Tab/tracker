#!/bin/bash

# 验证 router sections 配置是否与实际文档章节对齐
# 用于 context load 时的自动检查和 record 后的验证

set -e

# 参数解析
DOC_PATH=""
SECTIONS_JSON=""
VERBOSE=false
FIX_MODE=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --doc-path)
            DOC_PATH="$2"
            shift 2
            ;;
        --sections)
            SECTIONS_JSON="$2"
            shift 2
            ;;
        --verbose|-v)
            VERBOSE=true
            shift
            ;;
        --fix)
            FIX_MODE=true
            shift
            ;;
        *)
            echo "未知参数: $1"
            exit 1
            ;;
    esac
done

# 验证参数
if [ -z "$DOC_PATH" ] || [ ! -f "$DOC_PATH" ]; then
    echo "❌ 文档文件不存在: $DOC_PATH"
    exit 1
fi

# 提取文档中的实际章节（二级标题）
extract_actual_sections() {
    local doc_path="$1"

    # 使用 grep 提取二级标题行号，再用 Python 清理 emoji
    # 注意：不用 awk 字符类处理 emoji，避免多字节编码损坏汉字
    grep -n "^## " "$doc_path" | python3 -c "
import sys, re
for line in sys.stdin:
    line = line.rstrip('\n')
    colon_idx = line.index(':')
    linenum = line[:colon_idx]
    title = line[colon_idx+1:]          # '## emoji 标题'
    title = title[3:]                    # 去掉 '## '
    # 移除 emoji（宽 Unicode 范围，不影响 CJK 汉字 U+4E00-U+9FFF）
    title = re.sub(r'[\U0001F000-\U0001FFFF\U00002600-\U000027BF\U0000FE0F]+\s*', '', title)
    title = title.strip()
    print(linenum + '|' + title)
"
}

# 计算章节结束行号
calculate_end_lines() {
    local doc_path="$1"
    local sections_info="$2"
    
    local total_lines=$(wc -l < "$doc_path" | tr -d ' ')
    local prev_line=""
    local prev_title=""
    local result=""
    
    while IFS='|' read -r line_num title; do
        if [ -n "$prev_line" ]; then
            local end_line=$((line_num - 1))
            result="${result}${prev_line}|${end_line}|${prev_title}\n"
        fi
        prev_line="$line_num"
        prev_title="$title"
    done <<< "$sections_info"
    
    # 最后一个章节
    if [ -n "$prev_line" ]; then
        result="${result}${prev_line}|${total_lines}|${prev_title}"
    fi
    
    echo -e "$result"
}

# 从 router JSON 提取配置的 sections
parse_configured_sections() {
    local sections_json="$1"
    
    echo "$sections_json" | jq -r '.[] | "\(.lineRange[0])|\(.lineRange[1])|\(.title)"'
}

# 主验证逻辑
validate() {
    local doc_path="$1"
    local sections_json="$2"
    
    # 提取实际章节
    local actual_raw=$(extract_actual_sections "$doc_path")
    local actual_sections=$(calculate_end_lines "$doc_path" "$actual_raw")
    
    # 解析配置的 sections
    local configured_sections=""
    if [ -n "$sections_json" ]; then
        configured_sections=$(parse_configured_sections "$sections_json")
    fi
    
    local errors=0
    local warnings=0
    
    echo "📊 Sections 验证报告"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    
    # 检查章节数量
    local actual_count=$(echo "$actual_sections" | grep -c '|' || echo "0")
    local config_count=0
    if [ -n "$sections_json" ] && [ "$sections_json" != "null" ]; then
        config_count=$(echo "$sections_json" | jq 'length')
    fi
    
    echo "📋 章节数量: 文档 $actual_count vs 配置 $config_count"
    
    if [ "$actual_count" != "$config_count" ]; then
        echo "   ⚠️  章节数量不匹配"
        warnings=$((warnings + 1))
    else
        echo "   ✅ 章节数量一致"
    fi
    echo ""
    
    # 逐章节验证
    if [ "$VERBOSE" = true ]; then
        echo "📑 详细对比:"
        echo ""
        
        local idx=0
        while IFS='|' read -r start_line end_line title; do
            [ -z "$start_line" ] && continue
            
            echo "[$((idx + 1))] $title"
            echo "    实际: [$start_line-$end_line]"
            
            if [ -n "$configured_sections" ]; then
                local config_line=$(echo "$configured_sections" | sed -n "$((idx + 1))p")
                if [ -n "$config_line" ]; then
                    local config_start=$(echo "$config_line" | cut -d'|' -f1)
                    local config_end=$(echo "$config_line" | cut -d'|' -f2)
                    local config_title=$(echo "$config_line" | cut -d'|' -f3)
                    
                    echo "    配置: [$config_start-$config_end] $config_title"
                    
                    # 检查行号差异
                    local start_diff=$((start_line - config_start))
                    local end_diff=$((end_line - config_end))
                    
                    if [ "$start_diff" -ne 0 ] || [ "$end_diff" -ne 0 ]; then
                        echo "    ❌ 行号偏差: 起始 $start_diff, 结束 $end_diff"
                        errors=$((errors + 1))
                    else
                        echo "    ✅ 行号匹配"
                    fi
                else
                    echo "    ❌ 配置中缺少此章节"
                    errors=$((errors + 1))
                fi
            fi
            echo ""
            idx=$((idx + 1))
        done <<< "$actual_sections"
    fi
    
    # 总结
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    if [ $errors -eq 0 ] && [ $warnings -eq 0 ]; then
        echo "✅ 验证通过"
        return 0
    else
        echo "⚠️  发现 $errors 个错误, $warnings 个警告"
        return 1
    fi
}

# 生成修复建议（JSON 格式）
generate_fix() {
    local doc_path="$1"
    
    local actual_raw=$(extract_actual_sections "$doc_path")
    local actual_sections=$(calculate_end_lines "$doc_path" "$actual_raw")
    
    echo "["
    local first=true
    while IFS='|' read -r start_line end_line title; do
        [ -z "$start_line" ] && continue
        
        if [ "$first" = true ]; then
            first=false
        else
            echo ","
        fi
        
        # 估算 tokens（每行约 15 tokens）
        local lines=$((end_line - start_line + 1))
        local tokens=$((lines * 15))
        
        cat <<SECTION
  {
    "title": "$title",
    "summary": "TODO: 添加章节摘要",
    "lineRange": [$start_line, $end_line],
    "estimatedTokens": $tokens
  }
SECTION
    done <<< "$actual_sections"
    echo ""
    echo "]"
}

# 执行
if [ "$FIX_MODE" = true ]; then
    generate_fix "$DOC_PATH"
else
    validate "$DOC_PATH" "$SECTIONS_JSON"
fi
