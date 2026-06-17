#!/bin/bash

# 初始化新项目的 context library 骨架
# 用法: init-project.sh <KIT_ROOT> [--dry-run] <path-or-name>
#       init-project.sh <KIT_ROOT> <path-or-name>

set -e

KIT_ROOT="$1"
shift

if [ -z "$KIT_ROOT" ]; then
    echo "❌ 缺少 KIT_ROOT 参数"
    exit 1
fi

LIBRARY_DIR="$KIT_ROOT/.claude/kit/context/library"
PROJECTS_CONF="$KIT_ROOT/.claude/kit/projects.conf"

# source identify.sh（需要 SOSO_KIT_ROOT）
export SOSO_KIT_ROOT="$KIT_ROOT"
# shellcheck source=/dev/null
source "$KIT_ROOT/.claude/kit/cli/identify.sh"

# 解析参数
DRY_RUN=false
INPUT=""

for arg in "$@"; do
    case "$arg" in
        --dry-run)
            DRY_RUN=true
            ;;
        *)
            INPUT="$arg"
            ;;
    esac
done

# 检测项目名
# 优先级：显式参数 > identify_project（worktree+fallback）> git basename
detect_project_name() {
    local input="$1"

    # 优先使用参数
    if [ -n "$input" ]; then
        if [[ "$input" == */* ]]; then
            basename "$input"
        else
            echo "$input"
        fi
        return 0
    fi

    # 尝试 identify_project（已注册项目直接命中）
    local detected
    if detected=$(identify_project "$(pwd)" 2>/dev/null); then
        echo "$detected"
        return 0
    fi

    # 未注册：用 git repo basename 作为新项目名
    if git rev-parse --show-toplevel >/dev/null 2>&1; then
        local repo_name=$(basename "$(git rev-parse --show-toplevel)")
        if [ "$repo_name" = "soso-kit" ]; then
            return 1
        fi
        echo "$repo_name"
        return 0
    fi

    return 1
}

PROJECT_NAME=$(detect_project_name "$INPUT" || true)

if [ -z "$PROJECT_NAME" ]; then
    echo "❌ 无法检测项目名"
    echo ""
    echo "请提供项目路径或名称："
    echo "  /k/context init /path/to/project"
    echo "  /k/context init project-name"
    exit 1
fi

PROJECT_DIR="$LIBRARY_DIR/$PROJECT_NAME"

# 检查是否已注册到 projects.conf
check_mapping_exists() {
    is_registered "$PROJECT_NAME"
}

# 定义骨架结构
SKELETON_DIRS=(
    "history"
    "indexes"
    "pitfalls"
    "reference"
    "reusable"
    "router"
    "summary"
)

# 补全检测：列出缺失项
detect_missing() {
    local missing_dirs=()
    local missing_files=()

    for dir in "${SKELETON_DIRS[@]}"; do
        if [ ! -d "$PROJECT_DIR/$dir" ]; then
            missing_dirs+=("$dir/")
        fi
    done

    if [ ! -f "$PROJECT_DIR/context-index.json" ]; then
        missing_files+=("context-index.json")
    fi
    if [ ! -f "$PROJECT_DIR/CONTEXT-UNEXPLOITED.md" ]; then
        missing_files+=("CONTEXT-UNEXPLOITED.md")
    fi
    if [ ! -f "$PROJECT_DIR/indexes/files.json" ]; then
        missing_files+=("indexes/files.json")
    fi
    if [ ! -f "$PROJECT_DIR/indexes/tags.json" ]; then
        missing_files+=("indexes/tags.json")
    fi

    # 输出到全局变量
    MISSING_DIRS=("${missing_dirs[@]}")
    MISSING_FILES=("${missing_files[@]}")
}

# --dry-run 模式：输出预览
if [ "$DRY_RUN" = true ]; then
    echo "📋 Context Init 预览"
    echo ""
    echo "项目名称: $PROJECT_NAME"
    echo "目标路径: $PROJECT_DIR"
    echo ""

    if [ -d "$PROJECT_DIR" ]; then
        echo "📂 模式: 补全（目录已存在，仅补缺失项）"
        detect_missing
        echo ""

        if [ ${#MISSING_DIRS[@]} -eq 0 ] && [ ${#MISSING_FILES[@]} -eq 0 ]; then
            echo "✅ 骨架完整，无需补全"
        else
            if [ ${#MISSING_DIRS[@]} -gt 0 ]; then
                echo "缺失目录:"
                for d in "${MISSING_DIRS[@]}"; do
                    echo "  + $d"
                done
            fi
            if [ ${#MISSING_FILES[@]} -gt 0 ]; then
                echo "缺失文件:"
                for f in "${MISSING_FILES[@]}"; do
                    echo "  + $f"
                done
            fi
        fi
    else
        echo "📂 模式: 完整创建"
        echo ""
        echo "将创建目录:"
        for d in "${SKELETON_DIRS[@]}"; do
            echo "  + $d/"
        done
        echo ""
        echo "将创建文件:"
        echo "  + context-index.json"
        echo "  + CONTEXT-UNEXPLOITED.md"
        echo "  + indexes/files.json"
        echo "  + indexes/tags.json"
    fi

    echo ""

    # 映射检查
    if check_mapping_exists; then
        echo "🔗 映射: 已存在，无需追加"
    else
        echo "🔗 映射: 将追加到 context-lib.sh"
        echo "  \"^${PROJECT_NAME}(-.+)?\$:${PROJECT_NAME}\""
    fi

    echo ""
    echo "---"
    echo "确认后执行: /k/context init $INPUT"

    exit 0
fi

# 正式执行

# 创建模板文件
write_context_index() {
    local today=$(date +%Y-%m-%dT00:00:00Z)
    cat > "$PROJECT_DIR/context-index.json" << JSONEOF
{
  "meta": {
    "version": "2.5",
    "project": "$PROJECT_NAME",
    "lastUpdated": "$today",
    "totalFeatures": 0,
    "totalModules": 0,
    "structureType": "module-based",
    "indexes": {
      "files": "indexes/files.json",
      "tags": "indexes/tags.json"
    }
  },
  "modules": [],
  "recentQueue": []
}
JSONEOF
}

write_unexploited() {
    cat > "$PROJECT_DIR/CONTEXT-UNEXPLOITED.md" << 'MDEOF'
# 待探索功能清单

> 记录尚未纳入 Context Library 的功能模块，后续逐步补充。

## 待记录

<!-- 格式: - [ ] 功能描述 — 涉及文件/模块 -->

MDEOF
}

write_files_index() {
    local today=$(date +%Y-%m-%d)
    cat > "$PROJECT_DIR/indexes/files.json" << JSONEOF
{
  "meta": {
    "lastUpdated": "$today",
    "totalFiles": 0,
    "description": "文件反向索引：file-path -> features[]，用于快速查询「这个文件涉及哪些功能」"
  },
  "index": {}
}
JSONEOF
}

write_tags_index() {
    local today=$(date +%Y-%m-%d)
    cat > "$PROJECT_DIR/indexes/tags.json" << JSONEOF
{
  "meta": {
    "lastUpdated": "$today",
    "totalTags": 0,
    "description": "功能标签索引：tag-name -> feature-ids[]，用于查询「哪些功能使用了某概念」"
  },
  "index": {}
}
JSONEOF
}

# 追加项目名到 projects.conf（幂等）
append_mapping() {
    if check_mapping_exists; then
        echo "  🔗 已注册 projects.conf，跳过"
        return 0
    fi

    if register_project "$PROJECT_NAME"; then
        echo "  🔗 已注册到 projects.conf"
    else
        echo "  ⚠️  注册失败，请手动追加到 $PROJECTS_CONF"
        return 1
    fi
}

# 执行创建/补全
if [ -d "$PROJECT_DIR" ]; then
    echo "📂 补全模式: $PROJECT_NAME"
    detect_missing

    if [ ${#MISSING_DIRS[@]} -eq 0 ] && [ ${#MISSING_FILES[@]} -eq 0 ]; then
        echo "  ✅ 骨架完整，无需补全"
    else
        for d in "${MISSING_DIRS[@]}"; do
            mkdir -p "$PROJECT_DIR/$d"
            echo "  + $d"
        done

        for f in "${MISSING_FILES[@]}"; do
            case "$f" in
                "context-index.json") write_context_index ;;
                "CONTEXT-UNEXPLOITED.md") write_unexploited ;;
                "indexes/files.json") mkdir -p "$PROJECT_DIR/indexes" && write_files_index ;;
                "indexes/tags.json") mkdir -p "$PROJECT_DIR/indexes" && write_tags_index ;;
            esac
            echo "  + $f"
        done
    fi
else
    echo "📂 创建项目: $PROJECT_NAME"

    # 创建目录
    mkdir -p "$PROJECT_DIR"
    for d in "${SKELETON_DIRS[@]}"; do
        mkdir -p "$PROJECT_DIR/$d"
        echo "  + $d/"
    done

    # 创建模板文件
    write_context_index
    echo "  + context-index.json"

    write_unexploited
    echo "  + CONTEXT-UNEXPLOITED.md"

    write_files_index
    echo "  + indexes/files.json"

    write_tags_index
    echo "  + indexes/tags.json"
fi

echo ""

# 追加映射
append_mapping

echo ""
echo "✅ 初始化完成: $PROJECT_DIR"
