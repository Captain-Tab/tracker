#!/bin/bash
#
# sosokit-conversation：Claude Code 会话管理
#
# 用法：
#   sosokit-conversation          # 当前项目会话
#   sosokit-conversation --all    # 所有项目会话
#
# 快捷键：
#   ↑/↓        选择会话
#   Enter       查看会话内容
#   Ctrl+D      删除选中会话
#   Ctrl+R      重命名选中会话
#   Ctrl+A      一键清理所有无价值会话（空/caveat/subagent）
#   Esc         退出
#
# 依赖：fzf (brew install fzf)
#

set -e

# 解析 symlink，找到真实脚本目录
SOURCE="$0"
while [[ -L "$SOURCE" ]]; do
    DIR="$(cd "$(dirname "$SOURCE")" && pwd)"
    SOURCE="$(readlink "$SOURCE")"
    [[ "$SOURCE" != /* ]] && SOURCE="$DIR/$SOURCE"
done
SCRIPT_DIR="$(cd "$(dirname "$SOURCE")" && pwd)"
source "$SCRIPT_DIR/config.sh"

# 颜色
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'
RED='\033[0;31m'; CYAN='\033[0;36m'; NC='\033[0m'; DIM='\033[2m'
success() { echo -e "${GREEN}✓${NC} $1"; }
warn()    { echo -e "${YELLOW}⚠${NC} $1"; }
error()   { echo -e "${RED}✗${NC} $1"; exit 1; }
info()    { echo -e "${BLUE}ℹ${NC} $1"; }

# 检查 fzf
command -v fzf &>/dev/null || error "需要 fzf，请运行: brew install fzf"

# Claude 会话存储根目录
CLAUDE_PROJECTS="$HOME/.claude/projects"
[[ -d "$CLAUDE_PROJECTS" ]] || error "未找到 Claude 会话目录: $CLAUDE_PROJECTS"

# 解析参数
SCOPE="current"
while [[ $# -gt 0 ]]; do
    case "$1" in
        --all|-a) SCOPE="all"; shift ;;
        -h|--help)
            echo "用法: sosokit-conversation [--all]"
            echo ""
            echo "  --all, -a  显示所有项目会话"
            echo ""
            echo "快捷键:"
            echo "  ↑/↓        选择会话"
            echo "  Enter       查看会话内容"
            echo "  Ctrl+D      删除选中会话"
            echo "  Ctrl+R      重命名选中会话"
            echo "  Ctrl+A      一键清理无价值会话"
            echo "  Esc         退出"
            exit 0 ;;
        *) error "未知参数: $1" ;;
    esac
done

# 确定搜索目录
if [[ "$SCOPE" == "current" ]]; then
    PROJECT_DIR_NAME=$(pwd | sed 's|/|-|g')
    SEARCH_DIR="$CLAUDE_PROJECTS/$PROJECT_DIR_NAME"
    if [[ ! -d "$SEARCH_DIR" ]]; then
        error "当前目录无 Claude 会话: $(pwd)"
    fi
    PROJECT_LABEL=$(basename "$(pwd)")
else
    SEARCH_DIR="$CLAUDE_PROJECTS"
    PROJECT_LABEL="所有项目"
fi

export SEARCH_DIR SCOPE PROJECT_LABEL

# ── 生成列表的独立脚本（供 fzf reload 调用）──
HELPER="$SCRIPT_DIR/.conversation-helper.sh"
cat > "$HELPER" << 'HELPEREOF'
#!/bin/bash
# conversation-helper: 供 fzf 内部调用的辅助脚本
# 用法:
#   conversation-helper list          → 生成会话列表
#   conversation-helper delete <path> → 删除会话
#   conversation-helper rename <path> → 重命名会话
#   conversation-helper clean         → 清理无价值会话
#   conversation-helper view <path>   → 查看会话内容

ACTION="$1"
shift

case "$ACTION" in
list)
    python3 -c '
import json, os, glob, re
from datetime import datetime

search_dir = os.environ["SEARCH_DIR"]
scope = os.environ["SCOPE"]

if scope == "current":
    patterns = [f"{search_dir}/*.jsonl"]
else:
    patterns = [f"{search_dir}/*/*.jsonl"]

files = []
for p in patterns:
    files.extend(glob.glob(p))
files = [f for f in files if "/subagents/" not in f]

def display_width(text):
    w = 0
    for ch in text:
        if ord(ch) > 0x7F: w += 2
        else: w += 1
    return w

def truncate(text, max_w):
    if not text: return ""
    w = 0
    for i, ch in enumerate(text):
        cw = 2 if ord(ch) > 0x7F else 1
        if w + cw > max_w - 2: return text[:i] + ".."
        w += cw
    return text

def pad(text, width):
    dw = display_width(text)
    return text + " " * max(0, width - dw)

def format_size(n):
    if n < 1024: return f"{n}B"
    if n < 1024 * 1024: return f"{n/1024:.1f}KB"
    if n < 1024 * 1024 * 1024: return f"{n/1024/1024:.1f}MB"
    return f"{n/1024/1024/1024:.1f}GB"

def clean_msg(text):
    text = re.sub(r"/[\w\-\./]+", "", text)
    text = re.sub(r"<[^>]+>", "", text)
    text = re.sub(r"^\d+[\.\)\s]+", "", text.strip())
    text = re.sub(r"\s+\d+[\.\)]\s+", " ", text)
    text = re.sub(r"\s+\d+\s+(?=[^\d])", " ", text)
    if text.startswith("This session is being continued"): return "续接会话"
    text = re.sub(r"\s+", " ", text).strip()
    return text

for f_path in sorted(files, key=lambda f: os.path.getmtime(f), reverse=True):
    mtime = datetime.fromtimestamp(os.path.getmtime(f_path)).strftime("%Y-%m-%d %H:%M")
    fsize = format_size(os.path.getsize(f_path))
    user_msg_count = 0; real_msgs = []; has_caveat = False
    custom_title = None; ai_title = None; agent_name = None
    try:
        with open(f_path) as fh:
            for line in fh:
                try:
                    d = json.loads(line)
                    t = d.get("type")
                    if t == "custom-title":
                        custom_title = d.get("customTitle", "") or d.get("title", "") or custom_title
                        continue
                    if t == "ai-title":
                        ai_title = d.get("aiTitle", "") or ai_title
                        continue
                    if t == "agent-name":
                        agent_name = d.get("agentName", "") or agent_name
                        continue
                    if t == "user":
                        if d.get("isMeta") or d.get("isSidechain"): continue
                        user_msg_count += 1
                        msg = d.get("message", {})
                        content = msg.get("content", "") if isinstance(msg, dict) else ""
                        if not isinstance(content, str): continue
                        if any(tag in content for tag in ["<command-name>", "<local-command", "Caveat:", "Unknown skill"]):
                            if "Caveat:" in content or "local-command-caveat" in content: has_caveat = True
                            continue
                        if any(tag in content for tag in ["<task-notification>", "<system-reminder>", "<tool-use-id>"]):
                            continue
                        clean = content.strip().replace("\n", " ")
                        if clean: real_msgs.append(clean)
                except: pass
    except: continue

    is_empty = (user_msg_count == 0) or (len(real_msgs) == 0)
    if is_empty and has_caveat: status = "caveat"
    elif is_empty: status = "empty"
    else: status = "ok"

    mark = "\u25cc" if status != "ok" else " "
    # 标题：完整不截断（行 1 加粗）
    if custom_title: title = custom_title
    elif ai_title: title = ai_title
    elif agent_name: title = agent_name
    elif real_msgs: title = clean_msg(real_msgs[0])
    else: title = "(无内容)"
    # 摘要：最后一条用户消息，放宽到 80 显示宽（行 2 独占）
    summary = truncate(clean_msg(real_msgs[-1]), 80) if len(real_msgs) > 1 else ""

    # 卡片式两行布局：行 1 加粗标题 + 右侧日期，行 2 灰色最后一条消息
    BOLD = "\033[1m"; DIM = "\033[2m"; RESET = "\033[0m"
    # 行 1：标题左对齐，mtime 右对齐（按显示宽度填充到 80 列）
    row_width = 80
    meta = f"· {fsize} · {mtime}"
    title_w = display_width(title)
    meta_w = display_width(meta)
    gap = max(2, row_width - title_w - meta_w - 2)
    spaces = " " * gap
    line1 = f"{mark} {BOLD}{title}{RESET}{spaces}{DIM}{meta}{RESET}"
    line2 = f"  {DIM}{summary}{RESET}"
    # 以 \0 分隔 item，item 内含 \n 实现 fzf 多行渲染
    import sys
    sys.stdout.write(f"{f_path}\t{status}\t{line1}\n{line2}\0")
'
    ;;

delete)
    FPATH="$1"
    [[ -z "$FPATH" || ! -f "$FPATH" ]] && exit 0
    rm -f "$FPATH"
    companion="${FPATH%.jsonl}"
    [[ -d "$companion" ]] && rm -rf "$companion"
    ;;

rename)
    FPATH="$1"
    [[ -z "$FPATH" || ! -f "$FPATH" ]] && exit 0
    echo -n "  新名称: "
    read -r new_title < /dev/tty
    [[ -z "$new_title" ]] && exit 0
    FPATH_ARG="$FPATH" NEW_TITLE="$new_title" python3 -c '
import json, os, tempfile
f_path = os.environ["FPATH_ARG"]
new_title = os.environ["NEW_TITLE"]
lines = []; title_exists = False
with open(f_path) as f:
    for line in f:
        try:
            d = json.loads(line)
            if d.get("type") == "custom-title":
                d["customTitle"] = new_title
                lines.append(json.dumps(d, ensure_ascii=False) + "\n")
                title_exists = True
            else: lines.append(line)
        except: lines.append(line)
if not title_exists:
    entry = {"type": "custom-title", "customTitle": new_title}
    lines.insert(1, json.dumps(entry, ensure_ascii=False) + "\n")
tmp_fd, tmp_path = tempfile.mkstemp(dir=os.path.dirname(f_path))
with os.fdopen(tmp_fd, "w") as tmp: tmp.writelines(lines)
os.replace(tmp_path, f_path)
'
    ;;

clean)
    deleted=0; subagent_deleted=0
    while IFS= read -r sd; do
        [[ -z "$sd" ]] && continue
        count=$(find "$sd" -name "*.jsonl" 2>/dev/null | wc -l | tr -d ' ')
        subagent_deleted=$((subagent_deleted + count))
        rm -rf "$sd"
    done < <(find "$SEARCH_DIR" -type d -name "subagents" 2>/dev/null)

    # 重新生成列表来找无价值的
    while IFS=$'\t' read -r fpath status display; do
        [[ -z "$fpath" ]] && continue
        [[ "$status" == "ok" ]] && continue
        rm -f "$fpath"
        companion="${fpath%.jsonl}"
        [[ -d "$companion" ]] && rm -rf "$companion"
        deleted=$((deleted + 1))
    done < <(bash "$0" list)

    echo "已清理: ${deleted} 个无价值会话, ${subagent_deleted} 个 subagent"
    ;;

view)
    FPATH="$1"
    [[ -z "$FPATH" || ! -f "$FPATH" ]] && exit 0
    FPATH_ARG="$FPATH" python3 -c '
import json, os, re
def clean_text(text):
    text = re.sub(r"<[^>]+>", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text
f_path = os.environ["FPATH_ARG"]
try:
    messages = []
    with open(f_path) as f:
        for line in f:
            try:
                d = json.loads(line)
                if d.get("type") == "user":
                    msg = d.get("message", {})
                    content = msg.get("content", "") if isinstance(msg, dict) else ""
                    if isinstance(content, str):
                        if any(tag in content for tag in ["<command-name>", "<local-command", "Caveat:"]): continue
                        clean = clean_text(content)
                        if clean: messages.append(("User", clean))
                elif d.get("type") == "assistant":
                    msg = d.get("message", {})
                    content = msg.get("content", "") if isinstance(msg, dict) else ""
                    if isinstance(content, list):
                        texts = [c.get("text","") for c in content if isinstance(c,dict) and c.get("type")=="text"]
                        content = " ".join(texts)
                    if isinstance(content, str) and content.strip():
                        messages.append(("AI", clean_text(content)))
            except: pass
    if not messages: print("(空会话)")
    else:
        for role, text in messages:
            prefix = "\033[0;36m▸ User:\033[0m" if role == "User" else "\033[0;33m▹ AI:\033[0m"
            if len(text) > 500: text = text[:500] + "..."
            print(f"{prefix} {text}")
            print()
except Exception as e:
    print(f"读取失败: {e}")
' | less -R
    ;;
esac
HELPEREOF
chmod +x "$HELPER"

# ── 主程序 ────────────────────────────────────

# helper list 用 \0 分隔 item（bash 变量无法持有 NUL，直接管道喂给 fzf）
if [[ -z "$("$HELPER" list | tr -d '\0')" ]]; then
    info "没有会话记录"
    exit 0
fi

FOOTER="↑↓ 选择   Enter 查看   Ctrl+D 删除   Ctrl+R 重命名   Ctrl+A 清理全部   Esc 退出"

# fzf 单次启动，所有操作在内部完成
"$HELPER" list | fzf \
    --ansi \
    --read0 \
    --gap=1 \
    --no-multi \
    --delimiter=$'\t' \
    --with-nth=3 \
    --no-preview \
    --border=rounded \
    --border-label=" 会话列表 " \
    --border-label-pos=2 \
    --footer="$FOOTER" \
    --prompt='  ' \
    --pointer='>' \
    --info=hidden \
    --no-scrollbar \
    --margin=0,0 \
    --padding=0,1 \
    --color='border:dim,label:dim,pointer:cyan,footer:dim' \
    --bind="enter:execute(bash $HELPER view {1})" \
    --bind="ctrl-d:execute-silent(bash $HELPER delete {1})+reload(bash $HELPER list)" \
    --bind="ctrl-r:execute(bash $HELPER rename {1})+reload(bash $HELPER list)" \
    --bind="ctrl-a:execute(bash $HELPER clean)+reload(bash $HELPER list)" \
    2>/dev/null || true

echo ""
