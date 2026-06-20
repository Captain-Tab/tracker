# Cloudflare WARP 代理指南

> 给 VPS 出站流量套 Cloudflare IP，隐藏真实 IP。

## 架构

```
脚本 fetch  ──▶ undici ProxyAgent ──┐
                                    ├──▶ WARP 127.0.0.1:40000 ──▶ CF 节点 ──▶ Sodex
脚本 WebSocket ──▶ ws + HttpsProxyAgent ─┘       (本地代理)        (104.28.x.x)
```

Sodex 看到的是 Cloudflare 边缘节点 IP，看不到 VPS 真实 IP。

## 特点

- 免费，无需注册账号
- IP 不固定，重连可能变化（CF 共享 IP 池）
- 延迟增加 5-15ms，几乎无感
- 支持 WebSocket 长连接
- 日常 CPU 占用 < 1%，内存约 100MB

## 危险：禁止全隧道模式

`warp-cli mode warp` 会把所有流量（包括 SSH）路由到 WARP，导致 **SSH 断连**。只能用 `proxy` 模式。

如果已断连，需通过 SolusVM Console 登录修复：
```bash
warp-cli --accept-tos disconnect
warp-cli --accept-tos mode proxy
warp-cli --accept-tos proxy port 40000
warp-cli --accept-tos connect
```

## 安装（Ubuntu 24.04）

```bash
# 添加仓库
curl -fsSL https://pkg.cloudflareclient.com/pubkey.gpg | gpg --yes --dearmor --output /usr/share/keyrings/cloudflare-warp-archive-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/cloudflare-warp-archive-keyring.gpg] https://pkg.cloudflareclient.com/ noble main" | tee /etc/apt/sources.list.d/cloudflare-client.list
apt update && apt install cloudflare-warp -y

# 注册并启动（代理模式，非全隧道）
warp-cli --accept-tos registration new
warp-cli --accept-tos mode proxy
warp-cli --accept-tos proxy port 40000
warp-cli --accept-tos connect

# 开机自启
systemctl enable warp-svc
```

## 脚本依赖（VPS 上安装）

```bash
cd /root/service && npm install undici https-proxy-agent ws
```

## 常用命令

```bash
warp-cli --accept-tos status                 # 查看连接状态
warp-cli --accept-tos disconnect             # 断开
warp-cli --accept-tos connect                # 连接
systemctl status warp-svc                    # WARP 服务状态
```

## 验证 IP 是否被代理

VPS 上同时跑两个 curl：

```bash
curl -s ifconfig.me                                  # 真实 IP
curl --proxy http://127.0.0.1:40000 -s ifconfig.me    # WARP IP
```

两个 IP 不同则代理可用。脚本日志中显示 `[proxy] fetch 走代理` 和 `[proxy] WebSocket 走代理` 说明已生效。

## 故障排查

```bash
systemctl status warp-svc
journalctl -u warp-svc -n 20 --no-pager
# 重启 WARP
warp-cli --accept-tos disconnect && warp-cli --accept-tos connect
```
