#!/usr/bin/env bash

# spec-create.sh <topic>
# 在 .claude/kit/spec/ 创建命名规范的 spec 文件（YYYY-MM-DD-<slug>.md）
# 用法: bash spec-create.sh "add dark mode"
# 输出: 创建的文件绝对路径

TOPIC="${1:-untitled}"

# 规范化 slug：小写 + 空格转连字符 + 只保留字母数字连字符
SLUG=$(echo "$TOPIC" | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | tr -cd 'a-z0-9-')
DATE=$(date +%Y-%m-%d)

KIT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
SPEC_DIR="$KIT_ROOT/.claude/kit/spec"
FILENAME="${DATE}-${SLUG}.md"
FILEPATH="$SPEC_DIR/$FILENAME"

# 创建目录（如不存在）
mkdir -p "$SPEC_DIR"

# 如文件已存在，不覆盖
if [ -f "$FILEPATH" ]; then
    echo "ALREADY_EXISTS:$FILEPATH"
    exit 0
fi

# 写入模板
cat > "$FILEPATH" << 'TEMPLATE'
# [功能名称]

## 背景与目的

> 为什么做这件事，解决什么问题

## 选定方案

> 选择了哪个方案，核心理由

## 设计概要

> 架构思路、核心逻辑、关键数据结构

## 边界与约束

**包含：**
-

**不包含：**
-

**已知限制：**
-

## 集成点

> 涉及的现有文件 / 模块 / API

## 验收标准

- [ ]
- [ ]
- [ ]
TEMPLATE

echo "CREATED:$FILEPATH"
