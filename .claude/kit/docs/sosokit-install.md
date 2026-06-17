# sosokit 命令使用指南

## 全局命令一览

| 命令 | 方向 | 说明 |
|------|------|------|
| `sosokit-install` | soso-kit → 其他项目 | 安装/更新 .cursor 到目标项目 |
| `sosokit-sync` | 其他项目 → soso-kit | 将修改推回 soso-kit |

## 典型工作流

```
sosokit-install    # 1. 从 soso-kit 获取最新 .cursor
→ 修改 .cursor 内容
→ sosokit-sync     # 2. 推回 soso-kit 作为新基准
→ sosokit-install  # 3. 分发到其他项目
```

---

## sosokit-install

### 原理

复制整个 soso-kit `.cursor/` 到目标项目，根据目标是否已有 `.cursor/` 判断模式。

### 两种模式

**首次安装（目标无 `.cursor/`）**
1. 完整复制 soso-kit 的 `.cursor/` 到目标项目
2. 清空 `kit/spec/*.md`（项目独有，初始为空）

**更新（目标已有 `.cursor/`）**
1. 备份目标项目的 `kit/spec/*.md`
2. 完整覆盖 `.cursor/`
3. 恢复 `kit/spec/*.md`

### 共享 vs 保留

| 内容 | 行为 | 说明 |
|------|------|------|
| `commands/`、`rules/`、`skills/` | 每次更新 | 共享工具 |
| `kit/context/library/` | 每次更新 | 共享知识库 |
| `kit/spec/scripts/` | 每次更新 | spec 工具脚本 |
| `kit/spec/*.md` | 更新时保留 | 项目独有文档 |

### 用法

```bash
sosokit-install                  # 安装/更新到当前目录
sosokit-install --dry-run        # 预览模式
sosokit-install ~/code/project   # 安装到指定项目
sosokit-install ~/code/a ~/code/b  # 批量安装
```

---

## sosokit-sync

### 原理

`sosokit-install` 的反向操作，将当前项目的 `.cursor/` 推回 soso-kit，清空 `kit/spec/*.md` 和 `.soso-kit-version`（不污染 soso-kit 源）。

### 用法

```bash
sosokit-sync             # 推回 soso-kit（在修改了 .cursor 的项目执行）
sosokit-sync --dry-run   # 预览模式
```

---

## 全局命令安装

```bash
sudo ln -sf /Users/soso/Documents/code/soso-kit/.cursor/kit/install.sh /usr/local/bin/sosokit-install
sudo ln -sf /Users/soso/Documents/code/soso-kit/.cursor/kit/sync.sh /usr/local/bin/sosokit-sync
```

## 配置

默认 soso-kit 路径在 `.cursor/kit/config.sh` 中：

```bash
DEFAULT_SOSO_KIT_ROOT="$HOME/Documents/code/soso-kit"
```

也可通过环境变量覆盖：

```bash
SOSO_KIT_ROOT=~/other/path/soso-kit sosokit-install
```
