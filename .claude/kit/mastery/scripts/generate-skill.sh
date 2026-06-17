#!/usr/bin/env bash

# Skill 生成脚本
# 从 mastery/skills 目录读取文档,生成标准的 Skill 文档到 .claude/skills 目录

set -e

# 获取脚本所在目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MASTERY_DIR="$(dirname "$SCRIPT_DIR")"
KIT_DIR="$(dirname "$MASTERY_DIR")"
SOURCE_DIR="$MASTERY_DIR/skills"
TEMPLATE_FILE="$KIT_DIR/templates/skill-template.md"
CURSOR_DIR="$(dirname "$KIT_DIR")"
SKILLS_DIR="$CURSOR_DIR/skills"

# 颜色输出
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}📚 Skill 生成器${NC}"
echo ""

# 检查 source 目录
if [ ! -d "$SOURCE_DIR" ]; then
    echo -e "${YELLOW}⚠️  Source 目录不存在: $SOURCE_DIR${NC}"
    exit 1
fi

# 检查模板文件
if [ ! -f "$TEMPLATE_FILE" ]; then
    echo -e "${YELLOW}⚠️  模板文件不存在: $TEMPLATE_FILE${NC}"
    exit 1
fi

# 创建 skills 目录
mkdir -p "$SKILLS_DIR"

# 统计
TOTAL_FILES=0
SUCCESS_COUNT=0
SKIP_COUNT=0

echo -e "${BLUE}📂 扫描 mastery/skills 目录...${NC}"
echo "Source 目录: $SOURCE_DIR"
echo ""

# 遍历 mastery/skills 目录中的所有 .md 文件
for coach_file in "$SOURCE_DIR"/*.md; do
    # 检查文件是否存在
    if [ ! -f "$coach_file" ]; then
        continue
    fi
    
    TOTAL_FILES=$((TOTAL_FILES + 1))
    
    filename="$(basename "$coach_file")"
    echo -e "${BLUE}📄 处理: $filename${NC}"
    
    # 提取文件名(不含扩展名)作为 skill 名称
    skill_name="${filename%.md}"
    
    # 转换为 kebab-case
    skill_name_kebab=$(echo "$skill_name" | tr '[:upper:]' '[:lower:]' | tr '_' '-' | tr ' ' '-')
    
    # 创建 skill 目录
    skill_dir="$SKILLS_DIR/$skill_name_kebab"
    
    # 如果目录已存在,跳过
    if [ -d "$skill_dir" ]; then
        echo -e "${YELLOW}   ⏭️  跳过 (已存在): $skill_name_kebab${NC}"
        SKIP_COUNT=$((SKIP_COUNT + 1))
        echo ""
        continue
    fi
    
    mkdir -p "$skill_dir"
    
    # 读取源文档内容
    content=$(cat "$coach_file")
    
    # 提取第一行作为标题
    title=$(echo "$content" | head -1 | sed 's/^#* *//')
    
    # 提取第2-3行作为摘要(单行)
    summary=$(echo "$content" | sed -n '2,3p' | tr '\n' ' ' | sed 's/  */ /g')
    
    # 生成 description (从标题提取)
    description="$title. Use this skill when working with related tasks."
    
    # 复制模板
    cp "$TEMPLATE_FILE" "$skill_dir/SKILL.md"
    
    # 使用 awk 替换模板变量(更安全)
    awk -v name="$skill_name_kebab" \
        -v desc="$description" \
        -v title="$title" \
        -v summary="$summary" \
        -v filename="$filename" \
        '{
            gsub(/\{\{SKILL_NAME\}\}/, name);
            gsub(/\{\{SKILL_DESCRIPTION\}\}/, desc);
            gsub(/\{\{AUTHOR\}\}/, "soso-kit");
            gsub(/\{\{SKILL_TITLE\}\}/, title);
            gsub(/\{\{SKILL_SUMMARY\}\}/, summary);
            gsub(/\{\{WHEN_TO_APPLY\}\}/, "- Working with " name);
            gsub(/\{\{HOW_IT_WORKS\}\}/, "1. Read the guidelines\n2. Apply best practices\n3. Verify implementation");
            gsub(/\{\{USAGE_EXAMPLE\}\}/, "# Skill is automatically activated when relevant");
            gsub(/\{\{OUTPUT_FORMAT\}\}/, "Guidelines and recommendations");
            gsub(/\{\{REFERENCES\}\}/, "- Source: " filename);
            print;
        }' "$skill_dir/SKILL.md" > "$skill_dir/SKILL.md.tmp"
    
    mv "$skill_dir/SKILL.md.tmp" "$skill_dir/SKILL.md"
    
    # 复制原始文档到 references 目录
    mkdir -p "$skill_dir/references"
    cp "$coach_file" "$skill_dir/references/original.md"
    
    echo -e "${GREEN}   ✅ 生成成功: $skill_dir${NC}"
    SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
    echo ""
done

# 输出统计
echo ""
echo -e "${BLUE}📊 生成统计${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "总文件数: $TOTAL_FILES"
echo -e "${GREEN}成功生成: $SUCCESS_COUNT${NC}"
echo -e "${YELLOW}跳过: $SKIP_COUNT${NC}"
echo ""
echo -e "${GREEN}✨ 完成!${NC}"
echo "Skills 目录: $SKILLS_DIR"
