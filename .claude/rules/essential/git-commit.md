---
description: Git Commit 规范 - 遵循 Conventional Commits 标准
globs: ["**/*"]
---

# Git Commit 规范

遵循 [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/) 规范。

## Commit 格式

```
<type>(<scope>): <description>
```

**要求**:
- 一行完成，不换行
- description 限制：中文 ≤50字，英文 ≤50字符
- 使用祈使句（动词开头）

## Type 类型

| Type | 说明 | 示例 |
|------|------|------|
| `feat` | 新功能 | feat(auth): 添加用户登录功能 |
| `fix` | 修复 Bug | fix(api): 修复请求超时问题 |
| `docs` | 文档变更 | docs(readme): 更新安装说明 |
| `style` | 代码格式 | style(lint): 格式化代码 |
| `refactor` | 重构 | refactor(utils): 重构工具函数 |
| `perf` | 性能优化 | perf(render): 优化列表渲染 |
| `test` | 测试 | test(unit): 添加单元测试 |
| `chore` | 构建/工具 | chore(deps): 更新依赖版本 |

## Scope 范围

从改动的主要目录或模块提取：

| 目录/模块 | Scope 示例 |
|-----------|------------|
| components/ | `component`, `modal`, `button` |
| utils/ | `utils`, `helper` |
| api/ | `api`, `request` |
| hooks/ | `hooks`, `useXxx` |
| styles/ | `style`, `css` |
| config/ | `config`, `env` |
| .claude/ | `claude`, `kit`, `skill` |

## 示例

### 中文版

```
feat(modal): 添加响应式弹窗组件
fix(form): 修复表单验证失败问题
docs(readme): 更新项目说明文档
refactor(api): 重构请求封装逻辑
perf(list): 优化长列表渲染性能
chore(kit): 添加 Skills 执行系统
```

### English

```
feat(modal): add responsive modal component
fix(form): fix form validation failure
docs(readme): update project documentation
refactor(api): refactor request wrapper
perf(list): optimize long list rendering
chore(kit): add skills execution system
```

## 破坏性变更

如有破坏性变更，在 type 后加 `!`：

```
feat(api)!: 重构接口返回格式
feat(api)!: refactor API response format
```

## 检查清单

- [ ] type 正确（feat/fix/docs/style/refactor/perf/test/chore）
- [ ] scope 准确反映改动范围
- [ ] description 简洁明了
- [ ] 一行完成，未超过字符限制
- [ ] 使用祈使句（动词开头）
