# Git Worktree 分支目录操作 - 参考文档

## 核心命令

### 查看当前 Worktree

```bash
git worktree list
```

### 创建新的分支目录

**方式 1: 基于当前分支创建新分支**
```bash
git worktree add ../project-name-new -b feature/new-branch
```

**方式 2: 使用现有分支**
```bash
git worktree add ../project-name-main main
```

## 实际案例

假设当前项目: `/Users/user/code/sodex-web` (分支: `feature/appkit`)

创建新的工作目录:
```bash
git worktree add ../sodex-web-appkit -b feature/appkit-worktree
```

结果:
- 原目录: `/Users/user/code/sodex-web` (feature/appkit)
- 新目录: `/Users/user/code/sodex-web-appkit` (feature/appkit-worktree)

## 创建后环境初始化

**必须完成以下步骤**:

```bash
# 进入新 worktree
cd ../sodex-web-appkit

# 1. 安装依赖
pnpm install

# 2. 复制 .claude 配置并清理
cp -r ../sodex-web/.claude .
rm -rf .claude/kit/spec/* .claude/kit/history/*
```

**一键初始化**:
```bash
ORIGINAL_DIR=$(pwd) && cd ../新目录 && \
pnpm install && \
cp -r $ORIGINAL_DIR/.claude . && \
rm -rf .claude/kit/spec/* .claude/kit/history/*
```

## 删除 Worktree

```bash
# 方式 1: 直接删除
git worktree remove ../project-name-branch

# 方式 2: 手动删除后清理
rm -rf ../project-name-branch
git worktree prune
```

## 重要说明

- ⚠️ 同一个分支不能同时被多个 worktree 使用
- ✅ 新目录与原目录共享同一个 Git 仓库
- ✅ 每个 worktree 有独立的工作区和暂存区
- ✅ 可以在不同目录独立进行 git 操作

## 常见使用场景

1. **并行开发**: 同时在多个分支工作
2. **代码对比**: 方便对比不同分支的代码
3. **快速测试**: 创建临时环境测试功能
4. **独立构建**: 在不同目录进行不同的构建配置
