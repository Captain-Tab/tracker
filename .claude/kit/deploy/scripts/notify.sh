# sosokit-deploy 通知模块 —— 被 run.sh source 使用
# 当前仅支持 Lark 自定义机器人；未来如需 Slack / 钉钉 / 邮件，统一加在此文件

# 从 branch 名提取所有 Linear issue ID（按分隔符切片，杜绝长单词中"挖"假 ID）
# 规则：按 / 和 - 切片，每段必须整体是 [A-Z]{2,5}，紧跟纯数字段，归一化为大写后去重
# 例: feat/sod-95-fix → SOD-95；bugfix/sod-189-sod-204 → SOD-189\nSOD-204；feat/sod-189-doable-1 → SOD-189（不误命中 OABLE-1）
_extract_linear_ids() {
    local branch=$1
    echo "$branch" \
        | tr '[:lower:]' '[:upper:]' \
        | sed 's|[/-]|\n|g' \
        | awk '
            /^[A-Z]{2,5}$/ {prev=$0; next}
            /^[0-9]+$/ {if(prev!="") print prev"-"$0; prev=""; next}
            {prev=""}
        ' \
        | awk '!seen[$0]++'
}

# 查 Linear API 获取 issue 标题 + URL
# 用法: _linear_lookup <issue_id>
# 输出: 成功 → "title|url"；失败/未配置/不存在 → 空字符串
# 行为:
#   - LINEAR_API_KEY 未配置 → 空（静默跳过）
#   - API 调用错误 / issue 不存在 → 空（不阻塞通知）
_linear_lookup() {
    local issue_id=$1
    [ -z "${LINEAR_API_KEY:-}" ] && return 0
    [ -z "$issue_id" ] && return 0

    local resp
    resp=$(curl -sS -m 10 -X POST https://api.linear.app/graphql \
        -H "Authorization: ${LINEAR_API_KEY}" \
        -H "Content-Type: application/json" \
        -d "$(jq -nc --arg id "$issue_id" \
            '{query:"query($id:String!){issue(id:$id){title url}}",variables:{id:$id}}')" \
        2>/dev/null) || return 0

    # issue 不存在 → .data.issue 为 null，jq 返回 "null"
    local title url
    title=$(echo "$resp" | jq -r '.data.issue.title // empty' 2>/dev/null)
    url=$(echo "$resp" | jq -r '.data.issue.url // empty' 2>/dev/null)
    [ -z "$title" ] || [ -z "$url" ] && return 0

    printf '%s|%s' "$title" "$url"
}

# 部署成功通知到 Lark 群机器人（post 富文本模式，支持超链接）
# 用法: notify_lark_success <commit_msg> <branch> <target_url> <pusher> [change_note]
# 行为:
#   - $LARK_WEBHOOK_URL 未设置 → 静默跳过
#   - branch 含 Linear ID 且 LINEAR_API_KEY 有效 → 显示「Linear Issue」可点击行
#   - change_note 为空 → 省略「本次改动」行
#   - 推送失败 → 仅 warning，不阻塞部署
notify_lark_success() {
    local commit_msg=$1
    local branch=$2
    local target_url=$3
    local pusher=$4
    local change_note=${5:-}

    [ -z "${LARK_WEBHOOK_URL:-}" ] && return 0

    # Linear 多 ID 查询（容错：未配置 / branch 无匹配 / 单个 ID 查不到 → 跳过对应行）
    local linears_json="[]"
    local ids
    ids=$(_extract_linear_ids "$branch")
    if [ -n "$ids" ]; then
        local id combo title url
        while IFS= read -r id; do
            [ -z "$id" ] && continue
            combo=$(_linear_lookup "$id")
            [ -z "$combo" ] && continue
            title="${combo%%|*}"
            url="${combo#*|}"
            linears_json=$(echo "$linears_json" | jq -c \
                --arg id "$id" --arg title "$title" --arg url "$url" \
                '. + [{id:$id, title:$title, url:$url}]')
        done <<< "$ids"
    fi

    # 用 jq 构建 post content；$linears[] 展开为多行 Linear 项
    local content_json
    content_json=$(jq -nc \
        --arg change_note "$change_note" \
        --argjson linears "$linears_json" \
        --arg commit_msg "$commit_msg" \
        --arg branch "$branch" \
        --arg target_url "$target_url" \
        --arg pusher "$pusher" \
        '[
          ( if $change_note != "" then [{"tag":"text","text":("本次改动: "+$change_note)}] else empty end ),
          ( $linears[] | [{"tag":"text","text":"Linear Issue: "},{"tag":"a","text":(.id+" - "+.title),"href":.url}] ),
          [{"tag":"text","text":("提交: "+$commit_msg)}],
          [{"tag":"text","text":("分支: "+$branch)}],
          [{"tag":"text","text":"部署环境: "},{"tag":"a","text":$target_url,"href":$target_url}],
          [{"tag":"text","text":("推送人: "+$pusher)}]
        ]')

    local payload
    payload=$(jq -nc \
        --argjson content "$content_json" \
        '{
          msg_type:"post",
          content:{post:{zh_cn:{title:"✅ Preview 测试 部署成功",content:$content}}}
        }')

    local resp
    resp=$(curl -sS -m 10 -X POST -H "Content-Type: application/json" \
        -d "$payload" "$LARK_WEBHOOK_URL" 2>&1) || {
        echo -e "${YELLOW:-}⚠️  Lark 通知推送失败（不影响部署）${NC:-}"
        echo "   $resp" | head -2
        return 0
    }

    if echo "$resp" | grep -q '"code":0'; then
        echo -e "${GREEN:-}📣 已推送部署通知到 Lark${NC:-}"
    else
        echo -e "${YELLOW:-}⚠️  Lark 通知返回异常（不影响部署）${NC:-}"
        echo "   $resp" | head -2
    fi
}
