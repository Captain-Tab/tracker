# cleanup

跨迁移的 **阶段产物清理** 类坑。

---

## cleanup:ui-migration-stub

- **tags**: cleanup, ui-migration, phase-transition
- **severity**: medium
- **created**: 2026-04-22
- **source**: sodex-web → sodex-next vault (Overview / Depositors / Activity)

### 触发场景

`/k:ui-migration` Phase 1 产出 UI 骨架（含 mock 数据 + placeholder 组件），之后 `/k:migration` 接入真实 domain/infra。

### 典型症状

提交后代码仍残留：

- `*Placeholder` 组件（`ChartPlaceholder`、空图表占位）
- `MOCK_*` 常量（`MOCK_DEPOSITORS` / `MOCK_ACTIVITY` / `MOCK_*_TOTAL`）
- 硬编码示例数据数组（`Y_LABELS` / `X_LABELS` 等）
- 不再被引用的 `mock.ts` 文件

### 根因

/k:ui-migration Phase 1 只保证 UI 骨架可独立预览，依赖 mock；/k:migration 接入真实数据时新代码覆盖了入口，旧 mock 文件未同步清理——两阶段工具之间没有显式交接动作，残留自然发生。

### 避坑动作

verify 阶段必跑扫描：

```bash
# 搜索 mock / placeholder 残留
grep -rEn "MOCK_|Placeholder" src/features/<X>/ \
  | grep -v ".stories." \
  | grep -v ".test."
```

命中的条目逐一判断：

- 未被引用 → **删除**
- 仅用于 storybook → 文件头加中文注释说明"保留给 stories"
- 被引用但非必要 → 替换为真实数据源

### 检测建议

可以在 `verify-arch.sh` 加一条 `CHK-A6`：

```bash
# CHK-A6: ui-migration 产物清理
STUBS=$(grep -rEn "MOCK_|Placeholder" "$TARGET" | grep -vE ".stories.|.test." || true)
if [ -n "$STUBS" ]; then
  echo "⚠️ CHK-A6 残留 stub："
  echo "$STUBS"
fi
```

### 本次来源

sodex-next vault：

| 文件 | 残留 |
|---|---|
| `DepositorsTab/mock.ts` | `MOCK_DEPOSITORS` / `MOCK_DEPOSITORS_TOTAL`，未被引用（仅 `DepositorRecord` type 被 columns.tsx 使用） |
| `ChartPanel.tsx` | `ChartPlaceholder` 组件 + `Y_LABELS` / `X_LABELS` 示例数组 |
| `ActivityTab/mock.ts` | `MOCK_ACTIVITY`，未被引用 |

仅 type 被复用的情况：建议把 type 挪到更合适的位置（`./types.ts`），删除 mock 文件。
