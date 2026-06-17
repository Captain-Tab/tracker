# 更优方案备忘：系统文本扩展器（D 方案）

> 当前 `/k:cp` 走的是「Claude Code 命令式」（C 方案）。本文档记录一个**更贴近本质、但当前未采用**的方案，供以后需要时启用。

## 背景

`/k:cp <name>` 的本质就是「读一段写死的模板文字、塞进 prompt」。Claude Code 命令式只是实现手段之一，且只在 Claude Code 内有效。

## 方案 D：系统文本扩展器（espanso / macOS 键盘替换 / Raycast 片段）

**怎么用**：在任意输入框打触发词（如 `;ship`）→ **就地展开成整段文字**，可编辑后再发送。

| 维度 | 评价 |
|------|------|
| 机制 | 真·零机制，最贴「读模板文字塞进去」的本质 |
| 适用范围 | **任何地方都能用**——Claude Code / Linear / Slack / GitHub / 浏览器输入框 |
| 可编辑 | 展开后可在发送前临时修改 |
| 短板 | 配置存在系统里，**不进 soso-kit git**、换机器要重配 |

## 选型结论

- **纯自己用、不打算分享** → D 就是最优。
- **既要 D 的「到处能用」、又要版本化进 kit** → 走**杂交解**（见下）。

## 杂交解：espanso 配置文件放进仓库 + 软链

espanso 支持指定任意路径的配置文件。做法：

1. 把 espanso 的 match yaml（内容由 `prompts/*.md` 同步而来）**放进 soso-kit 仓库**，例如 `.claude/kit/cp/better/espanso/soso.yml`。
2. 软链到 espanso 配置目录：

   ```bash
   # macOS espanso 配置目录通常是 ~/Library/Application Support/espanso/match/
   ln -sf "$(git rev-parse --show-toplevel)/.claude/kit/cp/better/espanso/soso.yml" \
     "$HOME/Library/Application Support/espanso/match/soso.yml"
   ```

3. 结果：**prompt 文本进 git、可分享、可版本化，同时全系统可用**——鱼和熊掌都要就走这个。

> 启用时再补：从 `prompts/*.md` 生成 espanso yml 的小脚本（避免两处手抄），以及各 prompt 的触发词约定（建议 `;` 前缀，如 `;ship`）。

## 现状

未启用。当前以 `/k:cp <name>` 命令式为准；本文档仅作「以后可能用到」的方案存档。
