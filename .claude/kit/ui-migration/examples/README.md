# UI Migration Examples

Few-shot 示例库：供 `/k:ui-migration` 在生成组件时作为风格锚点，替代直接加载规则文档推理。

## 使用方式

`/k:ui-migration` Step 2（Props 化改造）前，按组件类型加载对应示例：

| 组件类型 | 示例文件 | 覆盖规则 |
|---|---|---|
| 展示面板（纯 props-driven，无状态分支） | `panel.example.tsx` | shared/ui 基础替换 + CSS var 映射 + props interface |
| 表单（含状态分支 + 事件回调） | `form.example.tsx` | 条件渲染 + 事件命名（onXxx）+ 受控组件 |
| 弹窗（带壳层剥离 + openXxx 模板） | `dialog.example.tsx` | modal-component-style + openResponsive + w-full 根节点 |

**判定优先级**：有 `--modal` flag → dialog；有事件 + 分支 → form；其他 → panel。

## 示例来源

- **Phase 1（当前）**：synthetic 手工构造，基于 `.claude/rules/` 规则文档
- **Phase 2（规划）**：跑完 5 个真实迁移组件后，用成品替换 synthetic，记录在 `migrations-log.md`

## 硬约束

每份示例**必须**体现以下全部红线（否则无资格作为参考）：

- ✅ 无原生 `<button>` / `<input>` / `<select>` / `<dialog>` 等（`use-shared-ui`）
- ✅ 无 `dark:` 前缀（CSS Variables + data-theme）
- ✅ 无硬编码颜色（除白名单 `#121212` / `#1A1A1A` / `#262626` / `#A3A3A3`）
- ✅ 无 `useState` / `useEffect` 等 hook 调用（UI 层纯 props-driven）
- ✅ 无 `import` from `stores/` / `services/` / `infra/`
- ✅ 弹窗示例必须额外满足：根元素 `w-full`、无 title/padding/border 外壳、导出 `openXxxDialog`

## 维护

- 示例总数控制在 **≤5 份**，避免 token 膨胀
- 新增示例前先判断是否已被现有示例覆盖
- 规则变化时示例**必须**同步更新（规则和示例不一致时以规则为准）
