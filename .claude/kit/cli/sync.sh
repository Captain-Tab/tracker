#!/bin/bash
#
# sosokit-sync：将当前项目的配置推回 soso-kit
#
# 用法：
#   sosokit-sync                          # diff 确认后同步
#   sosokit-sync --dry-run                # 只显示 diff，不执行
#   sosokit-sync --module <family>        # 显式指定家族（跳过自动识别）
#
# 家族识别：
#   rules/ 按家族推回 soso-kit/.claude/rules/modules/<family>/
#   skills/ / kit/ / settings 等推回 soso-kit/.claude/ 根目录（统一）
#
# 适用场景：
#   在其他项目（含 worktree）修改了配置后，推回 soso-kit 作为新的基准

set -e

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

# 确定 soso-kit 路径
if [[ -n "$SOSO_KIT_ROOT" ]]; then
    :
elif [[ -d "$DEFAULT_SOSO_KIT_ROOT/.claude" ]]; then
    SOSO_KIT_ROOT="$DEFAULT_SOSO_KIT_ROOT"
else
    SOSO_KIT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
fi

# 颜色/日志函数来自 lib.sh

CONFIG_MODE=$(get_sosokit_mode)
CONFIG_DIR_NAME=".${CONFIG_MODE}"

# 解析参数
DRY_RUN="false"
EXPLICIT_MODULE=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --dry-run) DRY_RUN="true"; shift ;;
        --module)
            if [[ -z "$2" ]] || [[ "$2" == --* ]]; then
                error "--module 需要参数（项目名），见 projects.conf"
            fi
            EXPLICIT_MODULE="$2"
            shift 2 ;;
        -h|--help)
            echo "用法: sosokit-sync [--dry-run] [--module <family>]"
            echo ""
            echo "当前模式: $CONFIG_MODE ($CONFIG_DIR_NAME)"
            echo ""
            echo "将当前项目配置推回 soso-kit："
            echo "  - rules/         → soso-kit/.claude/rules/modules/<family>/"
            echo "  - skills/ / kit/ → soso-kit/.claude/（统一）"
            echo ""
            echo "选项:"
            echo "  --dry-run          只显示 diff，不执行"
            echo "  --module <family>  显式指定家族，跳过自动识别"
            echo ""
            echo "切换模式:"
            echo "  sosokit-switch cursor"
            echo "  sosokit-switch claude"
            exit 0 ;;
        *) error "未知参数: $1" ;;
    esac
done

SOURCE_CONFIG="$(pwd)/$CONFIG_DIR_NAME"
TARGET_CONFIG="$SOSO_KIT_ROOT/$CONFIG_DIR_NAME"

[[ ! -d "$SOURCE_CONFIG" ]] && error "当前目录无 $CONFIG_DIR_NAME: $(pwd)"

# 项目识别：--module override > identify_project
FAMILY=""
if [[ -n "$EXPLICIT_MODULE" ]]; then
    FAMILY="$EXPLICIT_MODULE"
    if [[ ! -d "$TARGET_CONFIG/rules/modules/$FAMILY" ]]; then
        error "指定的模块不存在: modules/$FAMILY"
    fi
else
    FAMILY=$(identify_project "$(pwd)")
    df_exit=$?
    if [[ $df_exit -ne 0 ]]; then
        exit $df_exit
    fi
fi

TARGET_RULES_MODULE="$TARGET_CONFIG/rules/modules/$FAMILY"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "  sosokit-sync ${CYAN}[$CONFIG_MODE]${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
info "家族: $FAMILY"
info "来源: $SOURCE_CONFIG"
info "目标(非-rules): $TARGET_CONFIG"
info "目标(rules):    $TARGET_RULES_MODULE"
echo ""

# 过滤规则 / diff 遍历来自 lib.sh（is_excluded / walk_main_diff / walk_rules_diff）

# 主 diff（非 rules 部分，方向：项目 → 源仓）
walk_main_diff "$SOURCE_CONFIG" "$TARGET_CONFIG" "$FAMILY" "sync"
ADDED=("${_SOSOKIT_ADDED[@]}")
MODIFIED=("${_SOSOKIT_MODIFIED[@]}")
REMOVED=("${_SOSOKIT_REMOVED[@]}")

# 按 target/rules/essential/ 的文件名集合分流 source/rules/*.md
# - 命中 essential 集合 → 推回 target/rules/essential/
# - 其余 → 推回 target/rules/modules/$FAMILY/
# target 无 essential 目录时，所有文件都归 module（向后兼容旧仓）
SPLIT_TMP=$(mktemp -d)
SPLIT_ESSENTIAL="$SPLIT_TMP/essential"
SPLIT_MODULE="$SPLIT_TMP/module"
mkdir -p "$SPLIT_ESSENTIAL" "$SPLIT_MODULE"

# bash 3.x 兼容：用空格分隔的字符串模拟 set
ESSENTIAL_NAMES_STR=""
if [[ -d "$TARGET_CONFIG/rules/essential" ]]; then
    for _f in "$TARGET_CONFIG/rules/essential"/*.md; do
        [[ -e "$_f" ]] || continue
        ESSENTIAL_NAMES_STR="$ESSENTIAL_NAMES_STR $(basename "$_f")"
    done
fi

for _f in "$SOURCE_CONFIG/rules"/*.md; do
    [[ -e "$_f" ]] || continue
    _name=$(basename "$_f")
    case " $ESSENTIAL_NAMES_STR " in
        *" $_name "*) cp "$_f" "$SPLIT_ESSENTIAL/" ;;
        *)            cp "$_f" "$SPLIT_MODULE/" ;;
    esac
done

# rules essential diff：source 中归入 essential 的 vs target/rules/essential/
walk_rules_diff "$SPLIT_ESSENTIAL" "$TARGET_CONFIG/rules/essential"
ESSENTIAL_ADDED=("${_SOSOKIT_RULES_ADDED[@]}")
ESSENTIAL_MODIFIED=("${_SOSOKIT_RULES_MODIFIED[@]}")
ESSENTIAL_REMOVED=("${_SOSOKIT_RULES_REMOVED[@]}")

# rules 家族化 diff：source 中归入 module 的 vs target/rules/modules/$FAMILY/
walk_rules_diff "$SPLIT_MODULE" "$TARGET_RULES_MODULE"
RULES_ADDED=("${_SOSOKIT_RULES_ADDED[@]}")
RULES_MODIFIED=("${_SOSOKIT_RULES_MODIFIED[@]}")
RULES_REMOVED=("${_SOSOKIT_RULES_REMOVED[@]}")

# ── 显示 diff ─────────────────────────────
TOTAL=$(( ${#ADDED[@]} + ${#MODIFIED[@]} + ${#REMOVED[@]} \
       + ${#RULES_ADDED[@]} + ${#RULES_MODIFIED[@]} + ${#RULES_REMOVED[@]} \
       + ${#ESSENTIAL_ADDED[@]} + ${#ESSENTIAL_MODIFIED[@]} + ${#ESSENTIAL_REMOVED[@]} ))

if [[ $TOTAL -eq 0 ]]; then
    success "无变更，soso-kit 已是最新"
    echo ""
    rm -rf "$SPLIT_TMP"
    exit 0
fi

echo -e "${CYAN}变更文件（共 $TOTAL 个）：${NC}"
echo ""

if [[ ${#ADDED[@]} -gt 0 ]] || [[ ${#RULES_ADDED[@]} -gt 0 ]] || [[ ${#ESSENTIAL_ADDED[@]} -gt 0 ]]; then
    echo -e "  ${GREEN}新增 $(( ${#ADDED[@]} + ${#RULES_ADDED[@]} + ${#ESSENTIAL_ADDED[@]} )) 个：${NC}"
    for f in "${ADDED[@]}"; do added "$f"; done
    for f in "${ESSENTIAL_ADDED[@]}"; do added "$f  ${CYAN}→ essential/${NC}"; done
    for f in "${RULES_ADDED[@]}"; do added "$f  ${CYAN}→ modules/$FAMILY/${NC}"; done
    echo ""
fi

if [[ ${#MODIFIED[@]} -gt 0 ]] || [[ ${#RULES_MODIFIED[@]} -gt 0 ]] || [[ ${#ESSENTIAL_MODIFIED[@]} -gt 0 ]]; then
    echo -e "  ${YELLOW}修改 $(( ${#MODIFIED[@]} + ${#RULES_MODIFIED[@]} + ${#ESSENTIAL_MODIFIED[@]} )) 个：${NC}"
    for f in "${MODIFIED[@]}"; do modified "$f"; done
    for f in "${ESSENTIAL_MODIFIED[@]}"; do modified "$f  ${CYAN}→ essential/${NC}"; done
    for f in "${RULES_MODIFIED[@]}"; do modified "$f  ${CYAN}→ modules/$FAMILY/${NC}"; done
    echo ""
fi

if [[ ${#REMOVED[@]} -gt 0 ]] || [[ ${#RULES_REMOVED[@]} -gt 0 ]] || [[ ${#ESSENTIAL_REMOVED[@]} -gt 0 ]]; then
    echo -e "  ${RED}删除 $(( ${#REMOVED[@]} + ${#RULES_REMOVED[@]} + ${#ESSENTIAL_REMOVED[@]} )) 个：${NC}"
    for f in "${REMOVED[@]}"; do removed "$f"; done
    for f in "${ESSENTIAL_REMOVED[@]}"; do removed "$f  ${CYAN}← essential/${NC}"; done
    for f in "${RULES_REMOVED[@]}"; do removed "$f  ${CYAN}← modules/$FAMILY/${NC}"; done
    echo ""
fi

if [[ "$DRY_RUN" == "true" ]]; then
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo -e "  ${YELLOW}预览完成（--dry-run，未执行）${NC}"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    rm -rf "$SPLIT_TMP"
    exit 0
fi

# ── 确认 ───────────────────────────────────
echo -n "确认同步到 soso-kit？[y/N] "
read -r CONFIRM
echo ""

if [[ "$CONFIRM" != "y" && "$CONFIRM" != "Y" ]]; then
    warn "已取消"
    rm -rf "$SPLIT_TMP"
    exit 0
fi

# ── 执行同步 ────────────────────────────────
# 1. 非 rules 部分：整目录原子 swap（保留 target 的 rules/modules 不被覆盖）
#    策略：cp source 到 temp → 把 temp/rules 替换成 target 当前的 rules 结构 → swap
TEMP_DIR=$(mktemp -d)
TEMP_CONFIG="$TEMP_DIR/$CONFIG_DIR_NAME"
cp -r "$SOURCE_CONFIG" "$TEMP_CONFIG" || { rm -rf "$TEMP_DIR" "$SPLIT_TMP"; error "复制失败，soso-kit 未改动"; }

# temp 的 rules 是 source 家族的文件；现在需要让它符合 soso-kit 的 rules/ 结构：
# soso-kit rules/ 只保留 modules/ 子树（所有家族），根目录除 .gitkeep 外不应有文件
# 策略：把 temp/rules 内容整体清空，再从 target 拷 modules/ 进来，最后把 source 的 *.md 归入对应家族
rm -rf "$TEMP_CONFIG/rules"
mkdir -p "$TEMP_CONFIG/rules"

# 从 target 拷贝 modules/ 整个（保留其他家族不变）
if [[ -d "$TARGET_CONFIG/rules/modules" ]]; then
    cp -r "$TARGET_CONFIG/rules/modules" "$TEMP_CONFIG/rules/modules"
fi

# 从 target 拷贝 essential/（保留 essential 基线，下面会被 source 中归入 essential 的文件覆盖）
if [[ -d "$TARGET_CONFIG/rules/essential" ]]; then
    cp -r "$TARGET_CONFIG/rules/essential" "$TEMP_CONFIG/rules/essential"
fi

# 保留 target 的 .gitkeep（如果存在）
[[ -f "$TARGET_CONFIG/rules/.gitkeep" ]] && cp "$TARGET_CONFIG/rules/.gitkeep" "$TEMP_CONFIG/rules/"

# 恢复 target 的 settings（项目级/本地配置不参与同步：sync 不让项目 settings 污染源仓）
# - settings.json：项目方维护的团队配置
# - settings.local.json：维护者个人本地（soso-kit 自用）
for f in settings.json settings.local.json; do
    rm -f "$TEMP_CONFIG/$f"
    if [[ -f "$TARGET_CONFIG/$f" ]]; then
        cp -a "$TARGET_CONFIG/$f" "$TEMP_CONFIG/$f"
    fi
done

# 恢复 target 的 figma 项目特定 references（不让项目本地内容污染源仓基线）
for f in kit/figma/references/components.md kit/figma/references/patterns.md kit/figma/references/specification-project.md; do
    if [[ -f "$TARGET_CONFIG/$f" ]]; then
        mkdir -p "$(dirname "$TEMP_CONFIG/$f")"
        cp "$TARGET_CONFIG/$f" "$TEMP_CONFIG/$f"
    else
        rm -f "$TEMP_CONFIG/$f"
    fi
done

# 恢复 target 的 kit/projects/ 中 _template 和非当前项目目录
# 防御性:先清理 temp 里可能存在的其他项目目录(source 不应有)
if [[ -d "$TEMP_CONFIG/kit/projects" ]]; then
    for dir in "$TEMP_CONFIG/kit/projects"/*/; do
        [[ -d "$dir" ]] || continue
        _pname=$(basename "$dir")
        if [[ "$_pname" != "$FAMILY" ]]; then
            rm -rf "$dir"
        fi
    done
fi
# 从 target 恢复(_template + 非当前项目)
if [[ -d "$TARGET_CONFIG/kit/projects" ]]; then
    mkdir -p "$TEMP_CONFIG/kit/projects"
    for dir in "$TARGET_CONFIG/kit/projects"/*/; do
        [[ -d "$dir" ]] || continue
        _pname=$(basename "$dir")
        if [[ "$_pname" != "$FAMILY" ]]; then
            # 显式目标路径：避免 BSD cp 在源带尾部斜杠时扁平化内容
            cp -r "$dir" "$TEMP_CONFIG/kit/projects/$_pname"
        fi
    done
fi

# 用 source 中归入 essential 的文件覆盖 temp 的 essential
if [[ -d "$TARGET_CONFIG/rules/essential" ]]; then
    mkdir -p "$TEMP_CONFIG/rules/essential"
    cp "$SPLIT_ESSENTIAL"/*.md "$TEMP_CONFIG/rules/essential/" 2>/dev/null || true
fi

# 用 source 中归入 module 的文件覆盖 temp 里对应家族模块
rm -rf "$TEMP_CONFIG/rules/modules/$FAMILY"
mkdir -p "$TEMP_CONFIG/rules/modules/$FAMILY"
cp "$SPLIT_MODULE"/*.md "$TEMP_CONFIG/rules/modules/$FAMILY/" 2>/dev/null || true

# 原子 swap
rm -rf "$TARGET_CONFIG"
mv "$TEMP_CONFIG" "$TARGET_CONFIG"
rm -rf "$TEMP_DIR"
success "同步 $CONFIG_DIR_NAME/ 到 soso-kit"
[[ -d "$TARGET_CONFIG/rules/essential" ]] && success "  essential rules → essential/"
success "  module rules → modules/$FAMILY/"
success "  其他统一覆盖"

if [[ -d "$TARGET_CONFIG/kit/spec" ]]; then
    find "$TARGET_CONFIG/kit/spec" -mindepth 1 -maxdepth 1 ! -name scripts -exec rm -rf {} + 2>/dev/null || true
fi
success "清空 kit/spec 用户内容"

rm -f "$TARGET_CONFIG/.soso-kit-version" 2>/dev/null || true
success "删除 .soso-kit-version"

# ── 验证 ──────────────────────────────────
VERIFY_FAILED=()

# 主 diff 验证（与显示共用 walk_main_diff 的过滤规则）
walk_main_diff "$SOURCE_CONFIG" "$TARGET_CONFIG" "$FAMILY" "sync"
for f in "${_SOSOKIT_ADDED[@]}";    do VERIFY_FAILED+=("仅来源有: $f"); done
for f in "${_SOSOKIT_REMOVED[@]}";  do VERIFY_FAILED+=("仅目标有: $f"); done
for f in "${_SOSOKIT_MODIFIED[@]}"; do VERIFY_FAILED+=("内容不一致: $f"); done

# rules essential 验证（source 中归入 essential 的 vs target/rules/essential）
walk_rules_diff "$SPLIT_ESSENTIAL" "$TARGET_CONFIG/rules/essential"
for f in "${_SOSOKIT_RULES_ADDED[@]}";    do VERIFY_FAILED+=("${f/#rules\//essential 仅来源有: }"); done
for f in "${_SOSOKIT_RULES_REMOVED[@]}";  do VERIFY_FAILED+=("${f/#rules\//essential 仅目标有: }"); done
for f in "${_SOSOKIT_RULES_MODIFIED[@]}"; do VERIFY_FAILED+=("${f/#rules\//essential 内容不一致: }"); done

# rules 家族化验证（source 中归入 module 的 vs target/rules/modules/$FAMILY）
walk_rules_diff "$SPLIT_MODULE" "$TARGET_RULES_MODULE"
for f in "${_SOSOKIT_RULES_ADDED[@]}";    do VERIFY_FAILED+=("${f/#rules\//rules 仅来源有: }"); done
for f in "${_SOSOKIT_RULES_REMOVED[@]}";  do VERIFY_FAILED+=("${f/#rules\//rules 仅目标有: }"); done
for f in "${_SOSOKIT_RULES_MODIFIED[@]}"; do VERIFY_FAILED+=("${f/#rules\//rules 内容不一致: }"); done

if [[ ${#VERIFY_FAILED[@]} -gt 0 ]]; then
    echo ""
    echo -e "  ${RED}验证失败！以下差异未正确同步：${NC}"
    for f in "${VERIFY_FAILED[@]}"; do
        echo -e "  ${RED}✗${NC} $f"
    done
    echo ""
    rm -rf "$SPLIT_TMP"
    error "同步验证不通过"
fi

rm -rf "$SPLIT_TMP"
success "验证通过：essential 与 modules/$FAMILY/ 分流，其他统一同步"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "  ${GREEN}✅ sosokit 同步成功${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
