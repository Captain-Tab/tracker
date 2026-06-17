#!/usr/bin/env bash
# /k:check 机械验证插槽：确定性检查，AI 只读退出码裁决。
# 退出码 0 = 全过；≠0 = FAIL。新增检查在此追加。
set -uo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT" || exit 1

status=0

# satrack 契约 lint —— 仅在具备 satrack 集成的业务项目启用（如 sodex-next）
# soso-kit 自身仓库无 src/ 目录，自动跳过
if [ -f "src/shared/track/eventContract.ts" ]; then
    echo "── satrack 契约 lint ──"
    node .claude/skills/sodex-auto-satrack/scripts/lint-track.mjs "$ROOT" || status=1
fi

exit $status
