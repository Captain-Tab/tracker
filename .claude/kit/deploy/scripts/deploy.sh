#!/bin/zsh
set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# 加载环境配置
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"

if [ -f "$PROJECT_ROOT/.env.production" ]; then
    source "$PROJECT_ROOT/.env.production"
fi

# Rancher 配置
RANCHER_URL="${RANCHER_URL:-https://rancher-dev.sodex.io}"
CLUSTER_ID="${RANCHER_CLUSTER_ID:-c-728ts}"
NAMESPACE="${RANCHER_NAMESPACE:-sodex-frontend}"
CONTAINER="${RANCHER_CONTAINER:-container-0}"
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

    for i in $(seq 1 38); do  # 38 * 8 = 304秒 ≈ 5分钟
        RESPONSE=$(curl -sf \
            "${RANCHER_URL}/k8s/clusters/${CLUSTER_ID}/apis/apps/v1/namespaces/${NAMESPACE}/deployments/${DEPLOYMENT}" \
            -H "Authorization: Bearer ${RANCHER_TOKEN}" 2>/dev/null) || {
            echo "   [$i/38] 获取状态失败，重试..."
            sleep 8
            continue
        }

        DESIRED=$(echo "$RESPONSE" | jq '.spec.replicas')
        AVAILABLE=$(echo "$RESPONSE" | jq '.status.availableReplicas // 0')

        echo "   [$i/38] replicas: $AVAILABLE / $DESIRED"

        if [ "$AVAILABLE" -eq "$DESIRED" ] && [ "$DESIRED" -gt 0 ]; then
            return 0  # 成功
        fi

        sleep 8
    done

    return 1  # 超时
}

# 获取当前 commit
SHA=$(git rev-parse HEAD)
SHORT_SHA=${SHA:0:7}

echo ""
echo -e "${BLUE}🎯 本地部署 - preview 环境${NC}"
echo "   Commit: $SHORT_SHA"
echo ""

# 检查 Rancher Token
if [ -z "$RANCHER_TOKEN" ]; then
    echo -e "${RED}❌ 错误: RANCHER_TOKEN 未配置${NC}"
    echo "   请在 .env.production 中添加: RANCHER_TOKEN=your_token"
    exit 1
fi

# 提示用户确保镜像已构建
echo -e "${YELLOW}📦 请确保 GitHub Actions 构建已完成${NC}"
echo ""
echo "   当前 commit: $SHORT_SHA"
echo "   镜像地址: $ECR_REGISTRY/preview/sodex-next:$SHA"
echo ""
echo "   查看构建状态: $GITHUB_ACTIONS_URL"
echo ""

# 选择部署目标
echo -e "${CYAN}📋 选择部署目标:${NC}"
echo "    1) preview-01"
echo "    2) preview-02"
echo "    3) preview-03"
echo "    4) preview-04"
echo "    5) preview-05"
echo "    6) preview-06"
echo "  * 7) preview-07"
echo "  * 8) preview-08"
echo "  * 9) preview-09"
echo "  - 10) preview-10"
echo ""
read "choice?请选择 [1-10]: "

DEPLOYMENT=$(get_deployment "$choice")
if [ -z "$DEPLOYMENT" ]; then
    echo -e "${RED}❌ 无效选择${NC}"
    exit 1
fi

TARGET_URL=$(get_url "$DEPLOYMENT")
IMAGE="$ECR_REGISTRY/preview/sodex-next:$SHA"

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
        exit 0
    fi
    
    if [ $attempt -eq 1 ]; then
        echo ""
        echo -e "${YELLOW}⚠️  第一次尝试失败，30 秒后进行第二次尝试...${NC}"
        sleep 30
    fi
done

echo ""
echo -e "${RED}════════════════════════════════════════${NC}"
echo -e "${RED}❌ 部署失败（已尝试 2 次）${NC}"
echo -e "${RED}════════════════════════════════════════${NC}"
echo ""
echo "可能的原因："
echo "   1. 镜像尚未构建完成 - 请检查 GitHub Actions"
echo "   2. 镜像拉取失败 - 检查 ECR 权限或镜像是否存在"
echo "   3. 容器启动失败 - 检查 Rancher 日志"
echo ""
echo "排查步骤："
echo "   - GitHub Actions: $GITHUB_ACTIONS_URL"
echo "   - Rancher: ${RANCHER_URL}"
echo ""
exit 1
