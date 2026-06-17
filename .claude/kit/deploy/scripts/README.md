# 本地部署脚本

混合部署方案：云端构建（手动触发） + 本地部署（脚本）

## 架构

```
GitHub Actions（手动触发）→ 构建镜像 → 推送 ECR
        ↓ 构建完成
本地笔记本（VPN）→ 运行脚本 → 调用 Rancher API → 部署到 K8s
```

## 前置条件

### 1. 配置 Rancher Token

编辑 `.env.production`，填入 Token：

```bash
RANCHER_TOKEN=token-xxxxx:yyyyyyyy
```

Token 获取方式：Rancher → 右上角头像 → Account & API Keys → Create

### 2. 连接 VPN

确保本地能访问 `https://rancher-dev.sodex.io`

## 使用流程

### Step 1: 在 GitHub 手动触发构建

1. 打开 https://github.com/sosovalue-tech/sodex-next/actions/workflows/build.yml
2. 点击 `Run workflow`
3. 选择你的分支
4. Environment 选择 `preview`
5. 点击 `Run workflow`
6. 等待构建完成（约 2-3 分钟）

### Step 2: 运行部署脚本

```bash
./scripts/deploy/run.sh
```

脚本会：
1. 显示当前分支和 commit
2. 让你选择部署目标（preview-01/02/03）
3. 确认镜像已构建
4. 调用 Rancher API 部署
5. 等待滚动更新完成
6. 显示访问链接

## 部署目标

| 目标 | 访问地址 |
|------|---------|
| preview-01 | https://preview-01.sodex.io/trade/spot/BTC_USDC |
| preview-02 | https://preview-02.sodex.io/trade/spot/BTC_USDC |
| preview-03 | https://preview-03.sodex.io/trade/spot/BTC_USDC |

## 常见问题

### Rancher Token 未配置

```
❌ 错误: RANCHER_TOKEN 未配置
```

解决：在 `.env.production` 中添加 `RANCHER_TOKEN=xxx`

### 部署超时

```
❌ 部署超时（5分钟）
```

可能原因：
- 镜像不存在（检查 GitHub Actions 是否构建成功）
- 镜像拉取失败（检查 ECR 权限）
- 容器启动失败（检查 Rancher 日志）
