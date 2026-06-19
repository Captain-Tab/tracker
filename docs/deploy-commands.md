# VPS 部署命令

> VPS: `root@107.172.90.184` / 路径: `/root/watch-account/`

## 本地快捷命令（项目目录下执行）

```bash
make sync      # 推送文件到 VPS
make pull      # 从 VPS 拉回文件
make logs-f    # 实时查看监听日志
make logs      # 最近 50 行日志
make status    # 查看服务运行状态
make restart   # 重启监听服务
```

## VPS 直连

```bash
ssh root@107.172.90.184
```

---

## 服务管理

### 创建 / 修改配置

```bash
vim /etc/systemd/system/watch-account.service    # 编辑服务文件（改地址/token等）
```

改完重新加载：

```bash
systemctl daemon-reload && systemctl restart watch-account
```

### 增（首次部署）

```bash
bash /root/watch-account/setup-systemd.sh
```

### 删（停止并移除服务）

```bash
systemctl stop watch-account
systemctl disable watch-account
rm /etc/systemd/system/watch-account.service
systemctl daemon-reload
```

### 改（修改配置）

```bash
vim /etc/systemd/system/watch-account.service    # 改 ExecStart 行
systemctl daemon-reload                          # 重新加载
systemctl restart watch-account                  # 重启生效
```

### 启停控制

```bash
systemctl start watch-account       # 启动
systemctl stop watch-account        # 停止
systemctl restart watch-account     # 重启
systemctl status watch-account      # 查看状态
```

### 开机自启

```bash
systemctl enable watch-account      # 开启自启
systemctl disable watch-account     # 关闭自启
systemctl is-enabled watch-account  # 查看是否已开启
```

### 日志

```bash
journalctl -u watch-account -f      # 实时
journalctl -u watch-account -n 50   # 最近 50 行
journalctl -u watch-account --since "10 min ago"  # 最近 10 分钟
```
