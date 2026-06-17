#!/bin/bash
#
# sosokit-clean：恢复项目自己的配置目录（.cursor 或 .claude）
#
# 用法：
#   sosokit-clean
#
# 功能：
#   撤销 sosokit-install 的所有效果，把配置目录恢复为 git 中的原始版本
#   - 取消已暂存状态（git restore --staged）
#   - 取消 skip-worktree 标记
#   - 清理 .git/info/exclude 的 sosokit 标记块
#   - 删除 .git/sosokit-state
#   - 删除 soso-kit 版本，从 git HEAD 恢复项目版本
#
# 模式来源：
#   优先从 .git/sosokit-state 读取（保证 install/clean 模式一致）
#   回退到 ~/.sosokit-mode
#
# 失败兜底：
#   所有非致命步骤单独容错，恢复失败时打印手动恢复命令

# 不用 set -e：各步骤单独处理失败，避免半途退出留下脏状态

# 解析 symlink，找到真实脚本目录
SOURCE="$0"
while [[ -L "$SOURCE" ]]; do
    DIR="$(cd "$(dirname "$SOURCE")" && pwd)"
    SOURCE="$(readlink "$SOURCE")"
    [[ "$SOURCE" != /* ]] && SOURCE="$DIR/$SOURCE"
done
SCRIPT_DIR="$(cd "$(dirname "$SOURCE")" && pwd)"
source "$SCRIPT_DIR/config.sh"
source "$SCRIPT_DIR/lib.sh"

# 确定 soso-kit 路径（用于禁止在 soso-kit 自身运行）
if [[ -n "$SOSO_KIT_ROOT" ]]; then
    :
elif [[ -d "$DEFAULT_SOSO_KIT_ROOT/.claude" ]]; then
    SOSO_KIT_ROOT="$DEFAULT_SOSO_KIT_ROOT"
else
    SOSO_KIT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
fi

# 颜色/日志/resolve_config_mode 由 lib.sh 提供

# spec 持久备份路径（备份成功后赋值，供中断提示引用）
SPEC_BACKUP=""

# Ctrl-C / 异常中断处理
on_interrupt() {
    echo ""
    cat <<EOF

${YELLOW}⚠  sosokit-clean 被中断，当前状态可能不完整${NC}

检查并手动恢复：
  git status                                # 查看当前状态
  git checkout HEAD -- $CONFIG_DIR_NAME     # 从 git HEAD 恢复
  sosokit-install                           # 或重装 soso-kit 版本

EOF
    [[ -n "$SPEC_BACKUP" ]] && echo -e "${YELLOW}  spec 已持久备份在：$SPEC_BACKUP${NC}\n"
    exit 130
}
trap 'on_interrupt' INT TERM

# 删除配置目录前，把 spec 用户内容（除 scripts 外）持久备份到 .git 内
# 单份 + 一层 .prev：每次有效备份前把旧 current 无条件挪成 .prev（不做差异检测）
# 空 spec 跳过（避免空内容冲掉已有备份）；备份失败 error 中止（数据安全：未删任何文件）
backup_spec() {
    local spec_dir="$CONFIG_DIR_NAME/kit/spec"
    [[ -d "$spec_dir" ]] || return 0

    # 收集除 scripts 外的用户内容；为空则跳过
    local has_content="false" _item
    shopt -s nullglob dotglob
    for _item in "$spec_dir"/*; do
        [[ "$(basename "$_item")" == "scripts" ]] && continue
        has_content="true"; break
    done
    shopt -u nullglob dotglob
    [[ "$has_content" == "true" ]] || return 0

    local backup_dir
    backup_dir=$(spec_backup_dir "$PWD" "$CONFIG_MODE") || { warn "无法解析备份路径，跳过 spec 备份"; return 0; }

    # rotate：旧 current → .prev（单层回收站）
    if [[ -d "$backup_dir" ]]; then
        rm -rf "$backup_dir.prev"
        mv "$backup_dir" "$backup_dir.prev" || error "spec 备份失败（rotate .prev）：$backup_dir。已中止 clean，未删除任何文件"
    fi

    # 写入新 current（除 scripts 外全部，含 AUTO 等 flat 文件）
    mkdir -p "$backup_dir" || error "spec 备份失败（建目录 $backup_dir）。已中止 clean，未删除任何文件"
    shopt -s nullglob dotglob
    for _item in "$spec_dir"/*; do
        [[ "$(basename "$_item")" == "scripts" ]] && continue
        cp -a "$_item" "$backup_dir/" || error "spec 备份失败（复制 $_item）。已中止 clean，未删除任何文件"
    done
    shopt -u nullglob dotglob

    SPEC_BACKUP="$backup_dir"
    success "spec 已持久备份: $backup_dir"
}

# === 前置检查 ===

# 禁止在 soso-kit 目录运行
if [[ "$(pwd)" == "$SOSO_KIT_ROOT" ]]; then
    error "不能在 soso-kit 目录运行（soso-kit 的配置应被 git 正常追踪）"
fi

# 解析模式
CONFIG_MODE=$(resolve_config_mode)
CONFIG_DIR_NAME=".${CONFIG_MODE}"

# 检查配置目录是否存在
if [[ ! -d "$CONFIG_DIR_NAME" ]]; then
    error "当前目录没有 $CONFIG_DIR_NAME 文件夹"
fi

# 判断是否在 git 仓库根目录
HAS_GIT=false
if git rev-parse --git-dir &>/dev/null; then
    git_root=$(git rev-parse --show-toplevel 2>/dev/null)
    if [[ "$(pwd)" == "$git_root" ]]; then
        HAS_GIT=true
    else
        error "请在 git 仓库根目录运行（当前根目录: $git_root）"
    fi
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "  sosokit clean ${BLUE}[$CONFIG_MODE]${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# === 无 git 仓库：直接删除 ===
if [[ "$HAS_GIT" == "false" ]]; then
    warn "当前目录不在 git 仓库中，无法从 git 恢复原始 $CONFIG_DIR_NAME"
    # 无 git-dir 可放持久备份，spec 删除后无法找回，明确告警不静默
    if [[ -d "$CONFIG_DIR_NAME/kit/spec" ]]; then
        warn "无 git 仓库：spec 不会被持久备份，删除后无法找回，请先手动保存 $CONFIG_DIR_NAME/kit/spec"
    fi
    rm -rf "$CONFIG_DIR_NAME"
    success "已删除 soso-kit 的 $CONFIG_DIR_NAME"
    exit 0
fi

# 持久备份 spec（必须在任何 rm 之前；失败会 error 中止，此时未动任何文件/git 状态）
backup_spec

# === 查询 index 中已追踪的文件数（bash 变量无法保留 NUL，只统计数量 + 后续直接管道取列表） ===
tracked_count=$(git ls-files "$CONFIG_DIR_NAME" 2>/dev/null | wc -l | tr -d ' ')

# === 步骤 1：取消暂存（处理历史 staged 状态）===
# install/历史操作可能在 index 中留下 staged 的新文件，先 unstage
if ! git diff --cached --quiet -- "$CONFIG_DIR_NAME" 2>/dev/null; then
    if git restore --staged "$CONFIG_DIR_NAME" 2>/dev/null \
       || git reset HEAD -- "$CONFIG_DIR_NAME" 2>/dev/null; then
        success "已取消暂存"
    else
        warn "取消暂存失败，继续执行"
    fi
fi

# === 步骤 2：取消 skip-worktree（-z/-0 处理含空格/特殊字符路径） ===
if [[ "$tracked_count" -gt 0 ]]; then
    if git ls-files -z "$CONFIG_DIR_NAME" 2>/dev/null | xargs -0 git update-index --no-skip-worktree 2>/dev/null; then
        success "已取消 skip-worktree（恢复追踪）"
    else
        warn "部分文件取消 skip-worktree 失败"
    fi
fi

# === 步骤 3：清理 .git/info/exclude 标记块（worktree-safe） ===
exclude_file=$(git_exclude_path "$PWD" 2>/dev/null)
[[ -z "$exclude_file" ]] && exclude_file=".git/info/exclude"
marker_begin="# sosokit-begin: $CONFIG_DIR_NAME"
marker_end="# sosokit-end: $CONFIG_DIR_NAME"

if [[ -f "$exclude_file" ]] && grep -qF "$marker_begin" "$exclude_file" 2>/dev/null; then
    tmp=$(mktemp)
    if awk -v b="$marker_begin" -v e="$marker_end" \
        '$0==b{s=1;next} $0==e{s=0;next} !s{print}' \
        "$exclude_file" > "$tmp" 2>/dev/null && mv "$tmp" "$exclude_file"; then
        success "已清理 .git/info/exclude"
    else
        rm -f "$tmp" 2>/dev/null
        warn "清理 .git/info/exclude 失败，手动检查该文件"
    fi
fi

# === 步骤 4：删除状态文件（worktree-safe） ===
_state_file=$(git_state_path "$PWD" 2>/dev/null)
[[ -z "$_state_file" ]] && _state_file=".git/sosokit-state"
rm -f "$_state_file" 2>/dev/null

# === 步骤 5：无追踪文件情况，直接删除退出 ===
if [[ "$tracked_count" -eq 0 ]]; then
    warn "$CONFIG_DIR_NAME 下没有被 git 追踪的文件"
    rm -rf "$CONFIG_DIR_NAME"
    success "已删除 soso-kit 的 ${CONFIG_DIR_NAME}（无可恢复版本）"
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo -e "  ${GREEN}✅ sosokit clean 完成${NC}"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    exit 0
fi

# === 步骤 6：预检查 HEAD 是否有可恢复版本 ===
if ! git ls-tree HEAD -- "$CONFIG_DIR_NAME" 2>/dev/null | grep -q .; then
    error "HEAD 中不存在 ${CONFIG_DIR_NAME}，无法恢复项目版本。
保留当前目录，请手动处理：
  - 从历史提交恢复：git log --oneline -- $CONFIG_DIR_NAME
  - 或重装 soso-kit：sosokit-install"
fi

# === 步骤 7：删除 soso-kit 版本 ===
rm -rf "$CONFIG_DIR_NAME"

# === 步骤 8：从 git 恢复项目版本 ===
if git restore "$CONFIG_DIR_NAME" 2>/dev/null \
   || git checkout -- "$CONFIG_DIR_NAME" 2>/dev/null; then
    success "已恢复原始 ${CONFIG_DIR_NAME}（从 git HEAD）"
else
    cat <<EOF

${RED}✗ 从 git 恢复 $CONFIG_DIR_NAME 失败${NC}

目录已删除但未成功恢复，手动执行任一方案：

  1. 重装 soso-kit 版本：
       sosokit-install

  2. 强制从 HEAD 恢复项目版本：
       git checkout HEAD -- $CONFIG_DIR_NAME

  3. 查看 git 历史选择版本：
       git log --oneline -- $CONFIG_DIR_NAME
       git checkout <commit> -- $CONFIG_DIR_NAME

EOF
    exit 1
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "  ${GREEN}✅ sosokit clean 完成${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "$CONFIG_DIR_NAME 已恢复为 git 中的项目版本"
