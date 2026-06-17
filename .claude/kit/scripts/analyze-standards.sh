#!/bin/bash

# analyze-standards.sh
# 动态分析任务并推荐适用的规范和 Skills
# 用法: bash analyze-standards.sh "任务描述" [file1] [file2] ...

set -e

# 颜色输出
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# 获取脚本所在目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KIT_DIR="$(dirname "$SCRIPT_DIR")"
CURSOR_DIR="$(dirname "$KIT_DIR")"
RULES_DIR="$CURSOR_DIR/rules"
SKILLS_DIR="$CURSOR_DIR/skills"

# 参数
TASK_DESC="$1"
shift 2>/dev/null || true
FILES=("$@")

# 数组存储结果
declare -a MATCHED_RULES
declare -a MATCHED_SKILLS
declare -a CHECKLIST

echo -e "${BLUE}📋 规范分析结果${NC}"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# 分析任务描述
echo -e "${CYAN}📝 任务描述${NC}: $TASK_DESC"
echo ""

# 识别任务类型
TASK_TYPE="修改"
if [[ "$TASK_DESC" =~ (创建|新建|添加|新增|create|add|new) ]]; then
    TASK_TYPE="创建"
elif [[ "$TASK_DESC" =~ (重构|refactor|restructure) ]]; then
    TASK_TYPE="重构"
elif [[ "$TASK_DESC" =~ (优化|性能|performance|optimize) ]]; then
    TASK_TYPE="优化"
elif [[ "$TASK_DESC" =~ (修复|fix|bug) ]]; then
    TASK_TYPE="修复"
fi
echo -e "${CYAN}🎯 任务类型${NC}: $TASK_TYPE"
echo ""

# 动态读取可用规范
echo -e "${BLUE}📂 可用规范 ($RULES_DIR/)${NC}"
AVAILABLE_RULES=()
if [ -d "$RULES_DIR" ]; then
    for rule_file in "$RULES_DIR"/*.mdc; do
        if [ -f "$rule_file" ]; then
            rule_name=$(basename "$rule_file")
            AVAILABLE_RULES+=("$rule_name")
            echo "  - $rule_name"
        fi
    done
fi
echo ""

# 动态读取可用 Skills
echo -e "${BLUE}🎯 可用 Skills ($SKILLS_DIR/)${NC}"
AVAILABLE_SKILLS=()
if [ -d "$SKILLS_DIR" ]; then
    for skill_dir in "$SKILLS_DIR"/*/; do
        if [ -d "$skill_dir" ] && [ -f "$skill_dir/SKILL.md" ]; then
            skill_name=$(basename "$skill_dir")
            desc=$(grep "^description:" "$skill_dir/SKILL.md" 2>/dev/null | head -1 | sed 's/description: //' || echo "无描述")
            AVAILABLE_SKILLS+=("$skill_name")
            echo "  - $skill_name"
            echo "    ${desc:0:50}..."
        fi
    done
fi
echo ""

# 动态匹配规范（基于文件内容和关键词）
echo -e "${BLUE}🔍 智能匹配分析${NC}"

# 根据任务描述匹配规范
TASK_LOWER=$(echo "$TASK_DESC" | tr '[:upper:]' '[:lower:]')

# 定义关键词组（用于语义匹配）
declare -A KEYWORD_GROUPS
KEYWORD_GROUPS["react"]="react|组件|component|hook|usestate|useeffect|jsx|tsx"
KEYWORD_GROUPS["code"]="代码|code|clean|规范|命名|naming|refactor|重构"
KEYWORD_GROUPS["git"]="git|分支|branch|worktree|commit|merge"
KEYWORD_GROUPS["style"]="样式|style|css|scss|ui|design|设计"
KEYWORD_GROUPS["perf"]="性能|performance|优化|optimize|usememo|usecallback"

# 智能匹配规范（读取文件内容）
for rule in "${AVAILABLE_RULES[@]}"; do
    rule_file="$RULES_DIR/$rule"
    rule_lower=$(echo "$rule" | tr '[:upper:]' '[:lower:]')
    rule_content=""
    
    # 读取规范文件内容（前50行）用于语义匹配
    if [ -f "$rule_file" ]; then
        rule_content=$(head -50 "$rule_file" 2>/dev/null | tr '[:upper:]' '[:lower:]' || echo "")
    fi
    
    matched=false
    match_reason=""
    
    # 基于内容的语义匹配
    if [[ "$TASK_LOWER" =~ (${KEYWORD_GROUPS["react"]}) ]]; then
        if [[ "$rule_content" =~ (react|component|hook|jsx) ]] || [[ "$rule_lower" =~ react ]]; then
            matched=true
            match_reason="React 相关"
        fi
    fi
    
    if [[ "$TASK_LOWER" =~ (${KEYWORD_GROUPS["code"]}) ]]; then
        if [[ "$rule_content" =~ (clean|code|naming|规范) ]] || [[ "$rule_lower" =~ clean ]]; then
            matched=true
            match_reason="代码规范"
        fi
    fi
    
    if [[ "$TASK_LOWER" =~ (${KEYWORD_GROUPS["perf"]}) ]]; then
        if [[ "$rule_content" =~ (performance|优化|memo|callback) ]]; then
            matched=true
            match_reason="性能优化"
        fi
    fi
    
    # 通用规范始终添加
    if [[ "$rule_lower" =~ regular ]]; then
        matched=true
        match_reason="通用规范"
    fi
    
    if [ "$matched" = true ]; then
        MATCHED_RULES+=("$rule")
        echo "  - 匹配规范: $rule ($match_reason)"
    fi
done

# 智能匹配 Skills（读取 description 和内容）
for skill in "${AVAILABLE_SKILLS[@]}"; do
    skill_file="$SKILLS_DIR/$skill/SKILL.md"
    if [ -f "$skill_file" ]; then
        # 读取 description 和文件前30行内容
        skill_desc=$(grep "^description:" "$skill_file" 2>/dev/null | head -1 | tr '[:upper:]' '[:lower:]' || echo "")
        skill_content=$(head -30 "$skill_file" 2>/dev/null | tr '[:upper:]' '[:lower:]' || echo "")
        
        matched=false
        match_reason=""
        
        # 基于 description 和内容的语义匹配
        if [[ "$TASK_LOWER" =~ (${KEYWORD_GROUPS["git"]}) ]]; then
            if [[ "$skill_desc" =~ (git|worktree|branch) ]] || [[ "$skill_content" =~ (git|worktree|branch) ]]; then
                matched=true
                match_reason="Git/分支相关"
            fi
        fi
        
        if [[ "$TASK_LOWER" =~ (${KEYWORD_GROUPS["react"]}) ]]; then
            if [[ "$skill_desc" =~ (react|component) ]] || [[ "$skill_content" =~ (react|component) ]]; then
                matched=true
                match_reason="React 相关"
            fi
        fi
        
        if [[ "$TASK_LOWER" =~ (${KEYWORD_GROUPS["style"]}) ]]; then
            if [[ "$skill_desc" =~ (style|design|ui|css) ]] || [[ "$skill_content" =~ (style|design|ui|css) ]]; then
                matched=true
                match_reason="样式/设计相关"
            fi
        fi
        
        if [ "$matched" = true ]; then
            MATCHED_SKILLS+=("$skill")
            echo "  - 匹配 Skill: $skill ($match_reason)"
        fi
    fi
done

# 根据文件类型匹配
if [ ${#FILES[@]} -gt 0 ]; then
    echo ""
    echo -e "${BLUE}📂 涉及文件${NC}"
    for file in "${FILES[@]}"; do
        echo "  - $file"
        case "$file" in
            *.tsx|*.jsx)
                for rule in "${AVAILABLE_RULES[@]}"; do
                    [[ "$rule" =~ react ]] && MATCHED_RULES+=("$rule")
                    [[ "$rule" =~ clean ]] && MATCHED_RULES+=("$rule")
                done
                CHECKLIST+=("组件命名使用 PascalCase")
                CHECKLIST+=("Props 类型完整定义")
                ;;
            *.ts|*.js)
                for rule in "${AVAILABLE_RULES[@]}"; do
                    [[ "$rule" =~ clean ]] && MATCHED_RULES+=("$rule")
                done
                CHECKLIST+=("命名规范一致")
                CHECKLIST+=("错误处理完善")
                ;;
            *.css|*.scss|*.less)
                CHECKLIST+=("样式命名规范")
                ;;
            *.md)
                CHECKLIST+=("注释使用中文")
                ;;
        esac
    done
fi

# 添加通用检查项
CHECKLIST+=("注释使用中文，简洁格式")

# 去重
MATCHED_RULES=($(printf '%s\n' "${MATCHED_RULES[@]}" | sort -u))
MATCHED_SKILLS=($(printf '%s\n' "${MATCHED_SKILLS[@]}" | sort -u))
CHECKLIST=($(printf '%s\n' "${CHECKLIST[@]}" | sort -u))

echo ""

# 输出匹配的规范
echo -e "${GREEN}📋 适用规范${NC}"
if [ ${#MATCHED_RULES[@]} -gt 0 ]; then
    priority=1
    for rule in "${MATCHED_RULES[@]}"; do
        if [ -f "$RULES_DIR/$rule" ]; then
            echo "  $priority. $rule ✅"
        fi
        ((priority++))
    done
else
    echo "  无特定规范匹配"
fi
echo ""

# 输出匹配的 Skills
echo -e "${GREEN}🎯 适用 Skills${NC}"
if [ ${#MATCHED_SKILLS[@]} -gt 0 ]; then
    priority=1
    for skill in "${MATCHED_SKILLS[@]}"; do
        skill_dir="$SKILLS_DIR/$skill"
        if [ -d "$skill_dir" ]; then
            echo "  $priority. $skill ✅"
            if [ -f "$skill_dir/SKILL.md" ]; then
                desc=$(grep "^description:" "$skill_dir/SKILL.md" | head -1 | sed 's/description: //')
                echo "     - ${desc:0:60}..."
            fi
        fi
        ((priority++))
    done
else
    echo "  无特定 Skills 匹配"
fi
echo ""

# 输出检查清单
echo -e "${YELLOW}✅ 检查清单${NC}"
for item in "${CHECKLIST[@]}"; do
    echo "  - [ ] $item"
done
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${GREEN}分析完成!${NC}"
