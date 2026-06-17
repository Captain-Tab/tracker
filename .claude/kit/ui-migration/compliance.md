# 红线合规方案（待执行）

> 本文档记录 `/k:ui-migration` 红线合规方案的完整设计，**当前未执行**，留作后续改进参考。
>
> 触发执行时机：跑完 5+ 个真实组件后，如发现红线违规率 >10%，按本方案落地。

---

## 背景

`/k:ui-migration` 当前依赖模型读取规则文档（`.claude/rules/*.md`）自行推理合规。存在问题：

- token 消耗高（每次加载 ~1300 tokens 规则）
- 推理易漏条（6 条以上红线同时满足时稳定性下降）
- 返工率约 30%（合规 check 失败后重跑）

**目标**：把"读规则推理"转为"机械查表 + 生成后硬校验"，降低 token + 提升稳定性。

---

## 方案：三层防御

```
Layer 1: 机械映射（上游预防）    —— 规则查表替换，0 模型推理
Layer 2: 示例模仿（生成驱动）    —— few-shot 隐式约束（已执行，见 examples/）
Layer 3: grep 校验（下游兜底）   —— 生成后硬失败，零宽容
```

三层独立生效，叠加提升合规率。

---

## Layer 1: 机械映射表

### 思路

把规则中**可机械查表的部分**抽成 JSON，生成前塞入 prompt，模型按表替换而非自由发挥。

### 文件规划

```
.claude/kit/ui-migration/mappings/
  ├── color-map.json         # figma 颜色/变量 → Tailwind class
  ├── shared-ui-map.json     # 原生标签 → shared/ui 组件
  └── modal-shell-strip.json # 弹窗壳层剥离规则
```

### color-map.json 示例

```json
{
  "colorHex": {
    "#18B36B": { "bg": "bg-status-up", "text": "text-status-up" },
    "#F24237": { "bg": "bg-status-down", "text": "text-status-down" },
    "#F19D38": { "bg": "bg-warning-primary", "text": "text-warning-primary" }
  },
  "figmaVariablePatterns": {
    "text-text-primary-*": "text-white",
    "bg-background-secondary-*": "bg-[#1A1A1A]",
    "text-success-*": "text-status-up"
  }
}
```

来源：`.claude/rules/figma-style-mapping.md` 的映射表，转为可机械读取的 JSON。

### shared-ui-map.json 示例

```json
{
  "button": { "to": "Button", "import": "@/shared/components/ui/Button" },
  "input[type=text]": { "to": "Input", "import": "@/shared/components/ui/Input" },
  "input[type=checkbox]": { "to": "Checkbox", "import": "@/shared/components/ui/Checkbox" },
  "select": { "to": "Select", "import": "@/shared/components/ui/Select" },
  "img": { "to": "Image", "import": "@/shared/components/ui/Image" },
  "hr": { "to": "Divider", "import": "@/shared/components/ui/Divider" }
}
```

### modal-shell-strip.json 示例

```json
{
  "applyWhen": "--modal flag 或组件名以 Dialog/Drawer/Modal 结尾",
  "stripFromRoot": {
    "classPatterns": ["^p-\\d+", "^border", "^rounded", "^bg-bg-black-"],
    "reason": "壳层由 Shell 提供"
  },
  "requireRootClass": "w-full",
  "requireExports": {
    "component": "只接 props，不含壳层",
    "openFn": "open{ComponentName}: 封装 openResponsive 调用，title 通过 options 传入"
  }
}
```

### 使用方式

`/k:ui-migration` Step 2 前加载这些 JSON（合计 ~400 tokens），作为**显式替换规则**塞入 prompt：

> "遇到 `#18B36B` 必须输出 `bg-status-up`，遇到 `<button>` 必须替换为 `<Button>` 并 import from '@/shared/components/ui/Button'"

### 收益估算

- token：比读规则文档省 **~800 tokens**
- 准确性：机械替换规则 100% 遵守，不再依赖模型推理

---

## Layer 2: 示例驱动（已执行）

### 现状

已落地到 `.claude/kit/ui-migration/examples/`：
- `panel.example.tsx` — 展示面板
- `form.example.tsx` — 表单含状态分支
- `dialog.example.tsx` — 弹窗含壳层剥离 + openXxx

### 机制

ui-migration Step 2 按组件类型加载对应示例作为 few-shot 参考，模型模式匹配而非规则推理。

### 与 Layer 1 的关系

示例本身就**实际体现**了 Layer 1 的映射结果——模型看到示例中 `bg-status-up` 就知道正确写法，无需查 mapping。Layer 1 是显式规则，Layer 2 是隐式示范，互补。

---

## Layer 3: grep 校验兜底

### 思路

生成后立即跑脚本，不合规**硬失败**不允许落地。

### 文件规划

```
.claude/kit/ui-migration/scripts/
  └── lint-compliance.sh
```

### 脚本内容

```bash
#!/bin/bash
# 落地前红线校验，任何一条失败即 exit 1

FILE="$1"
FAIL=0

# 红线 1: 原生标签
NATIVE=$(grep -nE '<(button|input|select|dialog|table|hr|img)\b' "$FILE")
[ -n "$NATIVE" ] && { echo "❌ 原生标签未替换: $NATIVE"; FAIL=1; }

# 红线 2: dark: 前缀
DARK=$(grep -n 'dark:' "$FILE")
[ -n "$DARK" ] && { echo "❌ 禁用 dark: 前缀: $DARK"; FAIL=1; }

# 红线 3: 硬编码颜色（白名单外）
HEX=$(grep -nE '(bg|text)-\[#[0-9A-Fa-f]{3,8}\]' "$FILE" \
  | grep -vE '#(121212|1A1A1A|262626|A3A3A3)')
[ -n "$HEX" ] && { echo "❌ 硬编码颜色未映射 CSS var: $HEX"; FAIL=1; }

# 红线 4: UI 层 hook 调用
HOOKS=$(grep -nE '\buse[A-Z]\w+\s*\(' "$FILE")
[ -n "$HOOKS" ] && { echo "❌ UI 组件禁用 hook: $HOOKS"; FAIL=1; }

# 红线 5: 禁止 import stores/services/infra
BAD_IMPORT=$(grep -nE "from ['\"].*(/stores/|/services/|/infra/)" "$FILE")
[ -n "$BAD_IMPORT" ] && { echo "❌ UI 禁止 import stores/services/infra: $BAD_IMPORT"; FAIL=1; }

exit $FAIL
```

### 集成点

ui-migration.md Step 3（落地）前调用：

```bash
bash .claude/kit/ui-migration/scripts/lint-compliance.sh <generated-file>
[ $? -ne 0 ] && { echo "合规校验失败，返回 Step 2 修正"; exit 1; }
```

### 已知坑点（落地时必须处理）

- **注释误报**：JSDoc / 行注释中若提到 `<button>` / `<input>` / `dark:` 等字面量会被 grep 命中。实测 synthetic 示例时已踩过一次——注释里的规则说明触发误报。
  - **对策**：脚本落地时先剥注释（`sed '/^\s*\*/d' | sed 's|//.*||'`）再 grep；或用 AST 工具（eslint/typescript）替代 grep。

### 收益

- 规则明确，误报可控（处理注释剥离后趋近零）
- 防止"看起来对但违规"的产物落地
- 为后续 ESLint 规则化提供蓝本

---

## 执行优先级

| 阶段 | 内容 | 状态 |
|---|---|---|
| Phase 1.1 | Layer 3 grep 校验脚本 | ⏸ 待执行（触发时机见下方） |
| Phase 1.2 | Layer 1 三份 mapping JSON | ⏸ 待执行 |
| Phase 2 | 真实组件替换 synthetic 示例 | ⏸ 需先跑 5 个真实组件 |

---

## 触发执行的条件

不要为了优化而优化。**满足以下任一条件**再落地本方案：

1. 跑完 5+ 个真实组件后，合规违规率 > 10%
2. 用户反馈生成产物需要频繁手修红线
3. ui-migration token 消耗超预算（单次 > 10000）

条件不满足时，保持当前"规则文档 + 示例库"的组合，**不预先落地**本方案以避免增加维护成本。

---

## 维护提醒

本文档和 `.claude/rules/*.md` 存在内容重叠。**规则变化时以 rules/ 为准**，本文档的映射表必须同步更新，否则会误导模型。

后续如真落地 Layer 1 JSON，建议在 `.claude/rules/figma-style-mapping.md` 顶部加一行：

```
> 机械化映射表见 .claude/kit/ui-migration/mappings/color-map.json（二者必须保持一致）
```

避免双事实源漂移。
