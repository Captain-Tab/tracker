#!/usr/bin/env bash
# 架构检查脚本 — 检查迁移后代码是否符合 sodex-next 5 层架构约束
# 用法: bash verify-arch.sh <feature-dir>

FEATURE_DIR="$1"

if [ -z "$FEATURE_DIR" ]; then
  echo "用法: bash verify-arch.sh <feature-dir>"
  echo "  feature-dir: 新功能的目录路径（如 src/features/trade-transfer）"
  exit 1
fi

if [ ! -d "$FEATURE_DIR" ]; then
  echo "错误: 目录不存在 — $FEATURE_DIR"
  exit 1
fi

PASS=0
FAIL=0
TOTAL=6

echo ""
echo "🏗️ 架构检查：$FEATURE_DIR"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# CHK-A1: Import 方向 — UI 文件不应 import services/ 或 infra/
echo ""
A1_VIOLATIONS=""
UI_DIRS="$FEATURE_DIR/components $FEATURE_DIR/ui"
for dir in $UI_DIRS; do
  if [ -d "$dir" ]; then
    while IFS= read -r line; do
      A1_VIOLATIONS="$A1_VIOLATIONS$line"$'\n'
    done < <(grep -rn "from ['\"].*\(services\|infra\)/" "$dir" 2>/dev/null || true)
  fi
done

if [ -z "$A1_VIOLATIONS" ]; then
  echo "✅ CHK-A1: Import 方向正确"
  PASS=$((PASS + 1))
else
  echo "⚠️ CHK-A1: UI 层不应直接 import services/ 或 infra/"
  echo "$A1_VIOLATIONS" | while IFS= read -r v; do
    [ -n "$v" ] && echo "   - $v"
  done
  FAIL=$((FAIL + 1))
fi

# CHK-A2: 旧代码残留 — 不应 import 旧 MobX Store
echo ""
A2_VIOLATIONS=""
while IFS= read -r line; do
  A2_VIOLATIONS="$A2_VIOLATIONS$line"$'\n'
done < <(grep -rn "from ['\"].*models/" "$FEATURE_DIR" 2>/dev/null || true)
while IFS= read -r line; do
  A2_VIOLATIONS="$A2_VIOLATIONS$line"$'\n'
done < <(grep -rn "observer(" "$FEATURE_DIR" 2>/dev/null || true)

# 去除空行
A2_VIOLATIONS=$(echo "$A2_VIOLATIONS" | sed '/^$/d')

if [ -z "$A2_VIOLATIONS" ]; then
  echo "✅ CHK-A2: 无旧代码残留"
  PASS=$((PASS + 1))
else
  echo "⚠️ CHK-A2: 发现旧代码残留"
  echo "$A2_VIOLATIONS" | while IFS= read -r v; do
    [ -n "$v" ] && echo "   - $v"
  done
  FAIL=$((FAIL + 1))
fi

# CHK-A3: 数据转换位置 — normalize/toXxx 函数应在 domain/ 下
echo ""
A3_VIOLATIONS=""
NON_DOMAIN_DIRS="$FEATURE_DIR/components $FEATURE_DIR/ui $FEATURE_DIR/containers $FEATURE_DIR/infra $FEATURE_DIR/services"
for dir in $NON_DOMAIN_DIRS; do
  if [ -d "$dir" ]; then
    while IFS= read -r line; do
      A3_VIOLATIONS="$A3_VIOLATIONS$line"$'\n'
    done < <(grep -rn "^\(export \)\?\(function\|const\) \(normalize\|to[A-Z]\)" "$dir" 2>/dev/null || true)
  fi
done

A3_VIOLATIONS=$(echo "$A3_VIOLATIONS" | sed '/^$/d')

if [ -z "$A3_VIOLATIONS" ]; then
  echo "✅ CHK-A3: 数据转换位置正确"
  PASS=$((PASS + 1))
else
  echo "⚠️ CHK-A3: normalize/toXxx 函数应放在 domain/ 层"
  echo "$A3_VIOLATIONS" | while IFS= read -r v; do
    [ -n "$v" ] && echo "   - $v"
  done
  FAIL=$((FAIL + 1))
fi

# CHK-A4: 文件命名契约
echo ""
A4_VIOLATIONS=""

# infra 层: 应为 *Api.ts 或 *Rpc.ts
if [ -d "$FEATURE_DIR/infra" ]; then
  while IFS= read -r f; do
    basename=$(basename "$f")
    case "$basename" in
      *Api.ts|*Api.tsx|*Rpc.ts|*Rpc.tsx|index.ts|index.tsx|*.test.ts|*.test.tsx|*.d.ts) ;;
      *) A4_VIOLATIONS="$A4_VIOLATIONS   - infra/ 命名不符: $f (应为 *Api.ts 或 *Rpc.ts)"$'\n' ;;
    esac
  done < <(find "$FEATURE_DIR/infra" -name "*.ts" -o -name "*.tsx" 2>/dev/null | grep -v node_modules || true)
fi

# containers 层: 应为 use*Query.ts 或 use*ViewModel.ts
if [ -d "$FEATURE_DIR/containers" ]; then
  while IFS= read -r f; do
    basename=$(basename "$f")
    case "$basename" in
      use*Query.ts|use*Query.tsx|use*ViewModel.ts|use*ViewModel.tsx|index.ts|index.tsx|*.test.ts|*.test.tsx|*.d.ts) ;;
      *) A4_VIOLATIONS="$A4_VIOLATIONS   - containers/ 命名不符: $f (应为 use*Query.ts 或 use*ViewModel.ts)"$'\n' ;;
    esac
  done < <(find "$FEATURE_DIR/containers" -name "*.ts" -o -name "*.tsx" 2>/dev/null | grep -v node_modules || true)
fi

# domain 层: 应为 normalize*.ts 或 types.ts
if [ -d "$FEATURE_DIR/domain" ]; then
  while IFS= read -r f; do
    basename=$(basename "$f")
    case "$basename" in
      normalize*.ts|normalize*.tsx|types.ts|types.tsx|index.ts|index.tsx|*.test.ts|*.test.tsx|*.d.ts) ;;
      *) A4_VIOLATIONS="$A4_VIOLATIONS   - domain/ 命名不符: $f (应为 normalize*.ts 或 types.ts)"$'\n' ;;
    esac
  done < <(find "$FEATURE_DIR/domain" -name "*.ts" -o -name "*.tsx" 2>/dev/null | grep -v node_modules || true)
fi

A4_VIOLATIONS=$(echo "$A4_VIOLATIONS" | sed '/^$/d')

if [ -z "$A4_VIOLATIONS" ]; then
  echo "✅ CHK-A4: 文件命名符合契约"
  PASS=$((PASS + 1))
else
  echo "⚠️ CHK-A4: 文件命名不符合层级契约"
  echo "$A4_VIOLATIONS"
  FAIL=$((FAIL + 1))
fi

# CHK-A5: 导出合规 — feature index.ts 只导出 types + page + container hooks
echo ""
INDEX_FILE="$FEATURE_DIR/index.ts"
if [ ! -f "$INDEX_FILE" ]; then
  INDEX_FILE="$FEATURE_DIR/index.tsx"
fi

if [ ! -f "$INDEX_FILE" ]; then
  echo "⚠️ CHK-A5: 未找到 feature index.ts/index.tsx"
  FAIL=$((FAIL + 1))
else
  A5_VIOLATIONS=""
  while IFS= read -r line; do
    # 允许: 导出 types, page, container hooks (use*)
    case "$line" in
      *types*|*page*|*Page*|*use*|*export\ type*) ;;
      *) A5_VIOLATIONS="$A5_VIOLATIONS$line"$'\n' ;;
    esac
  done < <(grep "^export" "$INDEX_FILE" 2>/dev/null || true)

  A5_VIOLATIONS=$(echo "$A5_VIOLATIONS" | sed '/^$/d')

  if [ -z "$A5_VIOLATIONS" ]; then
    echo "✅ CHK-A5: 导出合规"
    PASS=$((PASS + 1))
  else
    echo "⚠️ CHK-A5: index.ts 导出了不合规的内容（只允许 types + page + container hooks）"
    echo "$A5_VIOLATIONS" | while IFS= read -r v; do
      [ -n "$v" ] && echo "   - $v"
    done
    FAIL=$((FAIL + 1))
  fi
fi

# CHK-A6: TODO 扫尾门禁 — feature 内不应残留 TODO/FIXME/XXX/HACK
# 迁移途中常见占位(如 "TODO: 改为链上读"),execute 完成后必须清理
echo ""
A6_VIOLATIONS=""
while IFS= read -r line; do
  A6_VIOLATIONS="$A6_VIOLATIONS$line"$'\n'
done < <(grep -rniE "TODO|FIXME|XXX|HACK" "$FEATURE_DIR" \
  --include="*.ts" --include="*.tsx" 2>/dev/null \
  | grep -v "\.test\.ts" | grep -v "\.test\.tsx" || true)

A6_VIOLATIONS=$(echo "$A6_VIOLATIONS" | sed '/^$/d')

if [ -z "$A6_VIOLATIONS" ]; then
  echo "✅ CHK-A6: 无 TODO/FIXME 残留"
  PASS=$((PASS + 1))
else
  echo "⚠️ CHK-A6: 发现 TODO/FIXME/XXX/HACK 残留(须修复或显式标注延后理由)"
  echo "$A6_VIOLATIONS" | while IFS= read -r v; do
    [ -n "$v" ] && echo "   - $v"
  done
  FAIL=$((FAIL + 1))
fi

# 总结
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "结果：$PASS/$TOTAL 通过，$FAIL 项需处理"
echo ""

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
