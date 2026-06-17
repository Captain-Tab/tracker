---
module: figma-mcp-restore
type: skillsmp
version: 3.1.0
released: 2026-02-15
versioning: semver
status: active
source: .claude/skillsmp/figma-mcp-restore/
---

# Changelog

所有 figma-mcp-restore Skill 的重要变更都会记录在此文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

---

## [3.1.0] - 2026-02-15

### 移除
- **移除 Step 8 截图验证**：该步骤为 AI 自我验证，属于循环论证，实际价值有限

### 变更
- 执行流程从 9 步简化为 8 步
- 原 Step 9 输出结果 → 现 Step 8 输出结果

---

## [3.0.0] - 2026-02-15

### 新增
- **双 MCP 协作架构**：官方 Figma MCP（截图）+ Framelink MCP（结构数据）
- **结构确认流程**：Step 3 新增用户确认环节，确保 AI 理解正确
- **图片处理选项**：支持统一下载、占位符、跳过三种模式

### 变更
- 重构执行流程
- 优化 MCP 工具调用文档
- 完善使用示例（单设计稿、结构修正、响应式双设计稿）

### 修复
- 明确 nodeId 格式要求（URL 中 `1-2` 需转换为 `1:2`）

---

## [2.0.0] - 2026-01-20

### 新增
- 支持 Framelink Figma MCP 获取结构化数据
- `references/specification.md` 设计令牌映射规则
- `references/components.md` 组件库映射规则
- 三层颜色匹配策略（精确 → 近似 → 任意值）

### 变更
- 从纯截图方案迁移到结构数据 + 截图混合方案
- 优化 Tailwind CSS 类名映射逻辑

---

## [1.0.0] - 2025-12-01

### 新增
- 初始版本
- 基于官方 Figma MCP 截图的代码生成
- 基础的 React + Tailwind CSS 输出
- 项目组件库扫描匹配

---

## 版本说明

| 版本 | 主要特性 |
|-----|---------|
| 3.x | 双 MCP + 用户确认流程 |
| 2.x | Framelink 结构数据支持 |
| 1.x | 基础截图转代码 |
