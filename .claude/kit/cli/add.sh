#!/bin/bash
#
# sosokit-add: 新增一个项目到 soso-kit 注册表
#
# 用法：
#   sosokit-add <project-name>           # 建完整脚手架
#   sosokit-add <project-name> --dry-run # 预览
#
# 执行：
#   1. 校验 name 合法（alphanumeric + dash）
#   2. 幂等追加到 projects.conf
#   3. 建 rules/modules/<name>/.gitkeep
#   4. 建 kit/context/library/<name>/{router,history,reference,indexes}/.gitkeep
#
# 依赖：config.sh + identify.sh

set -e

SOURCE="$0"
while [[ -L "$SOURCE" ]]; do
    DIR="$(cd "$(dirname "$SOURCE")" && pwd)"
    SOURCE="$(readlink "$SOURCE")"
    [[ "$SOURCE" != /* ]] && SOURCE="$DIR/$SOURCE"
done
SCRIPT_DIR="$(cd "$(dirname "$SOURCE")" && pwd)"
source "$SCRIPT_DIR/config.sh"

# 确定 SOSO_KIT_ROOT
if [[ -n "$SOSO_KIT_ROOT" ]]; then
    :
elif [[ -d "$DEFAULT_SOSO_KIT_ROOT/.claude" ]]; then
    SOSO_KIT_ROOT="$DEFAULT_SOSO_KIT_ROOT"
else
    SOSO_KIT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
fi
export SOSO_KIT_ROOT
source "$SCRIPT_DIR/identify.sh"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; CYAN='\033[0;36m'; NC='\033[0m'
info()    { echo -e "${BLUE}ℹ${NC} $1"; }
success() { echo -e "${GREEN}✓${NC} $1"; }
warn()    { echo -e "${YELLOW}⚠${NC} $1"; }
error()   { echo -e "${RED}✗${NC} $1" >&2; exit 1; }

# 解析参数
PROJECT_NAME=""
DRY_RUN="false"
while [[ $# -gt 0 ]]; do
    case "$1" in
        -h|--help)
            echo "用法: sosokit-add <project-name> [--dry-run]"
            echo ""
            echo "新增一个项目到 soso-kit 注册表。"
            echo ""
            echo "执行："
            echo "  1. 追加到 .claude/kit/projects.conf（幂等）"
            echo "  2. 建 .claude/rules/modules/<name>/.gitkeep"
            echo "  3. 建 .claude/kit/context/library/<name>/ 骨架"
            echo ""
            echo "项目名要求：alphanumeric + dash（^[a-zA-Z][a-zA-Z0-9-]*$）"
            exit 0
            ;;
        --dry-run)
            DRY_RUN="true"
            shift
            ;;
        *)
            if [[ -z "$PROJECT_NAME" ]]; then
                PROJECT_NAME="$1"
            else
                error "多余参数: $1"
            fi
            shift
            ;;
    esac
done

[[ -z "$PROJECT_NAME" ]] && error "缺少项目名参数，参考：sosokit-add <project-name>"

# 校验项目名
if ! [[ "$PROJECT_NAME" =~ ^[a-zA-Z][a-zA-Z0-9-]*$ ]]; then
    error "项目名不合法: '$PROJECT_NAME'（仅允许字母/数字/dash，且以字母开头）"
fi

# 路径
PROJECTS_CONF="$SOSO_KIT_ROOT/.claude/kit/projects.conf"
RULES_MODULE_DIR="$SOSO_KIT_ROOT/.claude/rules/modules/$PROJECT_NAME"
CONTEXT_LIB_DIR="$SOSO_KIT_ROOT/.claude/kit/context/library/$PROJECT_NAME"
PROJECT_SPEC_DIR="$SOSO_KIT_ROOT/.claude/kit/projects/$PROJECT_NAME"
PROJECT_SPEC_TEMPLATE="$SOSO_KIT_ROOT/.claude/kit/projects/_template"

CONTEXT_SKELETON=("router" "history" "reference" "indexes" "summary" "pitfalls" "reusable")

# 预检
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "  sosokit-add ${CYAN}$PROJECT_NAME${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
info "projects.conf: $PROJECTS_CONF"
info "rules module:  $RULES_MODULE_DIR"
info "context lib:   $CONTEXT_LIB_DIR"
info "project spec:  $PROJECT_SPEC_DIR"
[[ "$DRY_RUN" == "true" ]] && warn "预览模式（--dry-run）"
echo ""

# 幂等判断
ALREADY_REGISTERED="false"
if is_registered "$PROJECT_NAME"; then
    ALREADY_REGISTERED="true"
    warn "项目 '$PROJECT_NAME' 已注册到 projects.conf"
fi

# 显示将要做的操作
echo "将执行："
if [[ "$ALREADY_REGISTERED" == "true" ]]; then
    echo "  ~ projects.conf 跳过（已注册）"
else
    echo -e "  ${GREEN}+${NC} projects.conf 追加 '$PROJECT_NAME'"
fi
if [[ -d "$RULES_MODULE_DIR" ]]; then
    echo "  ~ rules/modules/$PROJECT_NAME/ 已存在"
else
    echo -e "  ${GREEN}+${NC} rules/modules/$PROJECT_NAME/.gitkeep"
fi
if [[ -d "$CONTEXT_LIB_DIR" ]]; then
    echo "  ~ kit/context/library/$PROJECT_NAME/ 已存在"
else
    for sub in "${CONTEXT_SKELETON[@]}"; do
        echo -e "  ${GREEN}+${NC} kit/context/library/$PROJECT_NAME/$sub/.gitkeep"
    done
fi
if [[ -d "$PROJECT_SPEC_DIR" ]]; then
    echo "  ~ kit/projects/$PROJECT_NAME/ 已存在"
elif [[ ! -d "$PROJECT_SPEC_TEMPLATE" ]]; then
    warn "kit/projects/_template/ 不存在,跳过 project spec 复制"
else
    while IFS= read -r f; do
        rel="${f#$PROJECT_SPEC_TEMPLATE/}"
        echo -e "  ${GREEN}+${NC} kit/projects/$PROJECT_NAME/$rel"
    done < <(find "$PROJECT_SPEC_TEMPLATE" -type f)
fi
echo ""

if [[ "$DRY_RUN" == "true" ]]; then
    info "预览完成"
    exit 0
fi

# 执行
if [[ "$ALREADY_REGISTERED" == "false" ]]; then
    register_project "$PROJECT_NAME"
    success "追加 projects.conf"
fi

mkdir -p "$RULES_MODULE_DIR"
touch "$RULES_MODULE_DIR/.gitkeep"
success "rules/modules/$PROJECT_NAME/"

mkdir -p "$CONTEXT_LIB_DIR"
for sub in "${CONTEXT_SKELETON[@]}"; do
    mkdir -p "$CONTEXT_LIB_DIR/$sub"
    touch "$CONTEXT_LIB_DIR/$sub/.gitkeep"
done
success "kit/context/library/$PROJECT_NAME/ 骨架"

if [[ -d "$PROJECT_SPEC_DIR" ]]; then
    warn "kit/projects/$PROJECT_NAME/ 已存在,跳过模版复制"
elif [[ ! -d "$PROJECT_SPEC_TEMPLATE" ]]; then
    warn "kit/projects/_template/ 不存在,跳过 project spec 复制"
else
    mkdir -p "$PROJECT_SPEC_DIR"
    cp -R "$PROJECT_SPEC_TEMPLATE/." "$PROJECT_SPEC_DIR/"
    success "kit/projects/$PROJECT_NAME/ 从 _template 生成"
fi

echo ""
success "项目 '$PROJECT_NAME' 已就绪"
echo ""
echo "下一步："
echo "  1. 往 rules/modules/$PROJECT_NAME/ 放入 rules *.md"
echo "  2. 在目标项目目录跑：sosokit-install"
echo "  3. （可选）在目标项目跑 context-init 补全 library 内容"
echo ""
