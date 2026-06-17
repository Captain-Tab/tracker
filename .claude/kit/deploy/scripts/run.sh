#!/bin/zsh
set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# 加载 Rancher 常量配置 + 通知模块
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/../const.sh"
source "$SCRIPT_DIR/notify.sh"

# Rancher 配置
CLUSTER_ID="$RANCHER_CLUSTER_ID"
NAMESPACE="$RANCHER_NAMESPACE"
CONTAINER="$RANCHER_CONTAINER"
ECR_REGISTRY="110427924033.dkr.ecr.ap-northeast-1.amazonaws.com"
GITHUB_ACTIONS_URL="https://github.com/sosovalue-tech/sodex-next/actions/workflows/build.yml"

# 获取部署目标
get_deployment() {
    case "$1" in
        1)  echo "preview-01" ;;
        2)  echo "preview-02" ;;
        3)  echo "preview-03" ;;
        4)  echo "preview-04" ;;
        5)  echo "preview-05" ;;
        6)  echo "preview-06" ;;
        7)  echo "preview-07" ;;
        8)  echo "preview-08" ;;
        9)  echo "preview-09" ;;
        10) echo "preview-10" ;;
        *) echo "" ;;
    esac
}

# 获取访问 URL
get_url() {
    case "$1" in
        preview-01) echo "https://preview-01.sodex.io/trade/spot/BTC_USDC" ;;
        preview-02) echo "https://preview-02.sodex.io/trade/spot/BTC_USDC" ;;
        preview-03) echo "https://preview-03.sodex.io/trade/spot/BTC_USDC" ;;
        preview-04) echo "https://preview-04.sodex.io/trade/spot/BTC_USDC" ;;
        preview-05) echo "https://preview-05.sodex.io/trade/spot/BTC_USDC" ;;
        preview-06) echo "https://preview-06.sodex.io/trade/spot/BTC_USDC" ;;
        preview-07) echo "https://preview-07.sodex.io/trade/spot/BTC_USDC" ;;
        preview-08) echo "https://preview-08.sodex.io/trade/spot/BTC_USDC" ;;
        preview-09) echo "https://preview-09.sodex.io/trade/spot/BTC_USDC" ;;
        preview-10) echo "https://preview-10.sodex.io/trade/spot/BTC_USDC" ;;
    esac
}

# 查询某个环境当前部署信息：分支 + 短SHA + commit message
# 输出格式："branch|short_sha|message"
get_deployed_branch() {
    local deployment=$1
    local response image sha branch short_sha msg
    response=$(curl -sf \
        "${RANCHER_URL}/k8s/clusters/${CLUSTER_ID}/apis/apps/v1/namespaces/${NAMESPACE}/deployments/${deployment}" \
        -H "Authorization: Bearer ${RANCHER_TOKEN}" 2>/dev/null) || { echo "?||"; return; }

    image=$(echo "$response" | jq -r '.spec.template.spec.containers[0].image // ""')
    sha=$(echo "${image##*:}" | tr -d '[:space:]')

    if [ -z "$sha" ] || [ "$sha" = "$image" ]; then
        echo "?||"
        return
    fi

    short_sha="${sha:0:7}"

    if [ -d "$SODEX_NEXT_REPO" ]; then
        branch=$(git -C "$SODEX_NEXT_REPO" branch -r --contains "$sha" 2>/dev/null \
            | grep -v 'HEAD' \
            | sed 's|[[:space:]]*origin/||' \
            | head -1 \
            | xargs) || true
        msg=$(git -C "$SODEX_NEXT_REPO" log -1 --format="%s" "$sha" 2>/dev/null) || true
    fi

    echo "${branch:-$short_sha}|${short_sha}|${msg}"
}

# 部署函数（支持重试）
do_deploy() {
    local attempt=$1
    
    echo ""
    echo -e "${BLUE}🚀 部署到 $DEPLOYMENT (尝试 $attempt/2)${NC}"
    echo "   镜像: ...sodex-next:$SHORT_SHA"
    echo ""

    # 调用 Rancher API 更新 deployment
    echo -e "${BLUE}📡 调用 Rancher API...${NC}"

    RESPONSE=$(curl -sf -X PATCH \
        "${RANCHER_URL}/k8s/clusters/${CLUSTER_ID}/apis/apps/v1/namespaces/${NAMESPACE}/deployments/${DEPLOYMENT}" \
        -H "Authorization: Bearer ${RANCHER_TOKEN}" \
        -H "Content-Type: application/strategic-merge-patch+json" \
        -d "{\"spec\":{\"template\":{\"spec\":{\"containers\":[{\"name\":\"${CONTAINER}\",\"image\":\"${IMAGE}\"}]}}}}" \
        2>&1) || {
        echo -e "${RED}❌ API 调用失败${NC}"
        echo "$RESPONSE"
        return 1
    }

    echo -e "${GREEN}✅ Patch 已发送${NC}"
    echo ""

    # 等待滚动更新完成（间隔 8 秒）
    echo -e "${BLUE}⏳ 等待滚动更新...${NC}"

    for i in $(seq 1 60); do  # 60 * 8 = 480秒 = 8分钟，覆盖 K8s ImagePullBackOff 完整重试周期
        RESPONSE=$(curl -sf \
            "${RANCHER_URL}/k8s/clusters/${CLUSTER_ID}/apis/apps/v1/namespaces/${NAMESPACE}/deployments/${DEPLOYMENT}" \
            -H "Authorization: Bearer ${RANCHER_TOKEN}" 2>/dev/null) || {
            echo "   [$i/60] 获取状态失败，重试..."
            sleep 8
            continue
        }

        DESIRED=$(echo "$RESPONSE" | jq '.spec.replicas')
        AVAILABLE=$(echo "$RESPONSE" | jq '.status.availableReplicas // 0')

        echo "   [$i/60] replicas: $AVAILABLE / $DESIRED"

        if [ "$AVAILABLE" -eq "$DESIRED" ] && [ "$DESIRED" -gt 0 ]; then
            return 0  # 成功
        fi

        sleep 8
    done

    return 1  # 超时
}


# 获取当前分支和 commit
BRANCH=$(git branch --show-current 2>/dev/null || true)
SHA=$(git rev-parse HEAD 2>/dev/null || true)
if [ -z "$SHA" ]; then
    echo -e "${RED}❌ 无法获取 HEAD SHA（当前目录非 git 仓库）${NC}"
    exit 1
fi
SHORT_SHA=${SHA:0:7}

echo ""
echo -e "${BLUE}🚀 部署脚本 - preview 环境${NC}"
echo "   分支: $BRANCH"
echo "   Commit: $SHORT_SHA"
echo ""

# 检查本地 commit 是否已推送到远程
UNPUSHED=$(git log origin/$BRANCH..HEAD --oneline 2>/dev/null || true)
if [ -n "$UNPUSHED" ]; then
    echo -e "${RED}⚠️  警告: 以下 commit 尚未推送到远程${NC}"
    echo "$UNPUSHED" | while IFS= read -r line; do
        echo "   • $line"
    done
    echo ""
    echo -e "${YELLOW}   GitHub Actions 无法构建未推送的 commit，部署将使用旧镜像${NC}"
    echo ""
    read "confirm?是否仍然继续？[y/N]: "
    if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
        echo "已取消，请先 git push 后再部署"
        exit 1
    fi
    echo ""
fi

# 自动打开 GitHub Actions 页面
echo -e "${CYAN}🌐 打开 GitHub Actions 页面...${NC}"
open "$GITHUB_ACTIONS_URL" 2>/dev/null || true
echo ""

# 检查前置条件
if [ -z "$RANCHER_TOKEN" ] || [ "$RANCHER_TOKEN" = "your_rancher_token_here" ]; then
    echo -e "${RED}❌ 错误: RANCHER_TOKEN 未配置${NC}"
    echo "   请在 soso-kit/.claude/kit/deploy/const.sh 中填写真实 Token"
    exit 1
fi

# 并行查询所有环境当前部署的分支
echo -e "${BLUE}⏳ 查询各环境当前分支...${NC}"
# 先同步 sodex-next 远程分支信息
if [ -d "$SODEX_NEXT_REPO" ]; then
    git -C "$SODEX_NEXT_REPO" fetch --all --quiet 2>/dev/null || true
fi
_BRANCH_TMP=$(mktemp -d)
for _i in $(seq 1 10); do
    (get_deployed_branch "$(get_deployment $_i)" > "$_BRANCH_TMP/$_i" 2>/dev/null) &
done
wait || true  # 防止 set -e 因子 shell 非零退出而终止脚本

# 解析 "branch|short_sha|message" 格式
_B=(); _S=(); _M=()
for _i in $(seq 1 10); do
    _raw=$(cat "$_BRANCH_TMP/$_i" 2>/dev/null || echo "?||")
    _B[$_i]="${_raw%%|*}"
    _rest="${_raw#*|}"
    _S[$_i]="${_rest%%|*}"
    _M[$_i]="${_rest#*|}"
done
rm -rf "$_BRANCH_TMP"

# 打印单行部署信息
print_env_line() {
    local prefix=$1 idx=$2 name=$3
    local branch="${_B[$idx]}" sha="${_S[$idx]}" msg="${_M[$idx]}"
    printf "%s%-2d) %-12s  \033[0;36m%-40s\033[0m \033[0;33m%s\033[0m \033[0;90m%s\033[0m\n" \
        "$prefix" "$idx" "$name" "$branch" "$sha" "$msg"
}

# Step 1: 选择部署目标
echo -e "${CYAN}📋 选择部署目标:${NC}"
print_env_line "    "  1 "preview-01"
print_env_line "    "  2 "preview-02"
print_env_line "    "  3 "preview-03"
print_env_line "    "  4 "preview-04"
print_env_line "    "  5 "preview-05"
print_env_line "    "  6 "preview-06"
print_env_line "  * "  7 "preview-07"
print_env_line "  * "  8 "preview-08"
print_env_line "  * "  9 "preview-09"
print_env_line "  - " 10 "preview-10"
echo ""
read "choice?请选择 [1-10]: "

DEPLOYMENT=$(get_deployment "$choice")
if [ -z "$DEPLOYMENT" ]; then
    echo -e "${RED}❌ 无效选择${NC}"
    exit 1
fi

TARGET_URL=$(get_url "$DEPLOYMENT")
IMAGE="$ECR_REGISTRY/preview/sodex-next:$SHA"

echo ""
echo -e "${YELLOW}📦 镜像信息${NC}"
echo "   Commit: $SHORT_SHA"
echo "   镜像: ...preview/sodex-next:$SHORT_SHA"
echo ""
read "CHANGE_NOTE?📝 本次改动（可留空）: "
echo ""
echo -e "${CYAN}选择操作:${NC}"
echo "   1) 直接部署（镜像已就绪）"
echo "   2) 等待 3 分钟后部署（刚触发构建，Rancher 重试窗口已自动延长到 8 分钟）"
echo "   3) 取消"
echo ""
read "action?请选择 [1-3]: "

case "$action" in
    1)
        echo -e "${GREEN}✅ 直接部署${NC}"
        ;;
    2)
        echo ""
        echo -e "${BLUE}⏳ 等待 3 分钟...${NC}"
        for i in $(seq 180 -5 5); do
            printf "\r   剩余 %3d 秒 (%d 分钟)" $i $((i/60))
            sleep 5
        done
        echo ""
        echo -e "${GREEN}✅ 等待完成，开始部署（Rancher 将自动重试拉取直至镜像就绪）${NC}"
        ;;
    *)
        echo "已取消"
        exit 0
        ;;
esac

# 部署后验证：确认环境镜像已更新为当前 commit
verify_deploy() {
    echo -e "${BLUE}🔍 验证部署结果...${NC}"
    local raw
    raw=$(get_deployed_branch "$DEPLOYMENT" 2>/dev/null) || true

    local actual_branch actual_sha actual_msg
    actual_branch="${raw%%|*}"
    local rest="${raw#*|}"
    actual_sha="${rest%%|*}"
    actual_msg="${rest#*|}"

    echo ""
    if [ "$actual_sha" = "$SHORT_SHA" ]; then
        echo -e "${GREEN}✅ 验证通过${NC}"
        printf "   分支: \033[0;36m%s\033[0m\n" "$actual_branch"
        printf "   SHA:  \033[0;33m%s\033[0m  %s\n" "$actual_sha" "$actual_msg"
    else
        echo -e "${YELLOW}⚠️  验证不符${NC}"
        printf "   期望: \033[0;36m%s\033[0m \033[0;33m%s\033[0m\n" "$BRANCH" "$SHORT_SHA"
        printf "   实际: \033[0;36m%s\033[0m \033[0;33m%s\033[0m  %s\n" "$actual_branch" "$actual_sha" "$actual_msg"
        echo ""
        echo -e "${YELLOW}   镜像可能尚未更新，请检查 GitHub Actions 构建状态${NC}"
    fi
    echo ""
}

# 尝试部署（最多 2 次）
for attempt in 1 2; do
    if do_deploy $attempt; then
        echo ""
        echo -e "${GREEN}════════════════════════════════════════${NC}"
        echo -e "${GREEN}✅ 部署完成！${NC}"
        echo -e "${GREEN}════════════════════════════════════════${NC}"
        echo ""
        echo -e "🔗 访问地址:"
        echo -e "   ${CYAN}${TARGET_URL}${NC}"
        echo ""
        verify_deploy
        notify_lark_success \
            "$(git log -1 --format='%s')" \
            "$BRANCH" \
            "$TARGET_URL" \
            "Tab" \
            "${CHANGE_NOTE:-}"
        exit 0
    fi
    
    if [ $attempt -eq 1 ]; then
        echo ""
        echo -e "${YELLOW}⚠️  第一次尝试失败，30 秒后重试...${NC}"
        sleep 30
    fi
done

echo ""
echo -e "${RED}❌ 部署失败（已尝试 2 次）${NC}"
echo ""
echo "可能的原因："
echo "   - 镜像尚未构建完成"
echo "   - 镜像拉取失败"
echo "   - 容器启动失败"
echo ""
echo "请检查 GitHub Actions 和 Rancher 日志"
exit 1
