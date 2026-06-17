#!/usr/bin/env bash
# 基于 spec 文档静态指标给出复杂度评分
# 用法: complexity-score.sh <spec-file-or-dir>
# 输出: 标准 KEY=VALUE 行 + 末尾一行 VERDICT=simple|medium|complex
#
# 评分维度（每项达阈值累加分）：
#   files       — spec 中提及的源码文件 unique count
#   modules     — spec 中提及的顶级模块目录 unique count
#   scenarios   — 验收场景数（### 场景 / Given/When/Then 块）
#   abstractions— 新增 interface/store/hook/service/api 关键词命中
#   deps        — 依赖变更命中
#
# 分档：
#   0-2 → simple
#   3-5 → medium
#   ≥ 6 → complex
#
# 红线（任一命中直接升档 complex）：
#   - 涉及鉴权/支付/migration/schema 目录
#   - 涉及 SQL DDL
#   - 涉及金额计算（calculate/decimal/BigNumber）
#   - 涉及链上签名（signMessage/eth_sign/EIP-712）

set -euo pipefail

INPUT="${1:-}"
if [ -z "$INPUT" ]; then
  echo "VERDICT=unknown" >&2
  echo "REASON=missing-input" >&2
  exit 2
fi

# 收集所有 spec 内容
if [ -d "$INPUT" ]; then
  FILES=$(find "$INPUT" -maxdepth 1 -name '*.md' -type f 2>/dev/null)
  if [ -z "$FILES" ]; then
    echo "VERDICT=unknown"
    echo "REASON=spec-empty"
    exit 0
  fi
  CONTENT=$(cat $FILES 2>/dev/null)
elif [ -f "$INPUT" ]; then
  CONTENT=$(cat "$INPUT")
else
  echo "VERDICT=unknown" >&2
  echo "REASON=input-not-found" >&2
  exit 2
fi

# 维度 1：触达文件数（跨语言扩展名）
FILE_COUNT=$( { echo "$CONTENT" | grep -oE '[a-zA-Z][a-zA-Z0-9/_-]*\.(ts|tsx|js|jsx|mjs|cjs|go|sql|py|rs|java|kt|swift|vue|rb|php|cs|scala|c|cpp|h|hpp|sh|yaml|yml|toml)' || true; } | sort -u | wc -l | tr -d ' ')

# 维度 2：触达顶级模块（覆盖各种目录布局）
#   前端：src/<mod>/, apps/<app>/src/<mod>/
#   Go：apps/<app>/internal/<mod>/, internal/<mod>/, cmd/<mod>/, pkg/<mod>/, services/<mod>/
#   通用：packages/<mod>/, libs/<mod>/, modules/<mod>/
MODULE_COUNT=$( { echo "$CONTENT" | grep -oE '(src|internal|cmd|pkg|services|packages|libs|modules|apps/[a-zA-Z0-9_-]+/(src|internal|cmd|pkg))/[a-zA-Z0-9_-]+/' || true; } | sed -E 's:.*/([a-zA-Z0-9_-]+)/:\1:' | sort -u | wc -l | tr -d ' ')

# 维度 3：验收场景数（中英双语 + Gherkin）
SCENARIO_COUNT=$( { echo "$CONTENT" | grep -cE '^(### 场景|#### 场景|## 场景|### Scenario|- \*\*Given\*\*|^Given |^场景 [0-9])' || true; } | tr -d ' ')

# 维度 4：新增抽象关键词（跨语言：interface/store/hook/service/api/context/provider/handler/repo/struct/trait）
ABSTRACTION_COUNT=$( { echo "$CONTENT" | grep -cE '(新增|新建|添加|create new).*(interface|store|hook|service|api|context|provider|handler|repo|repository|struct|trait|protocol)|(新建|新增).*[A-Z][a-zA-Z]+(Store|Service|Provider|Context|Hook|Handler|Repo|Repository)' || true; } | tr -d ' ')

# 维度 5：依赖变更（跨包管理器）
DEP_COUNT=$( { echo "$CONTENT" | grep -cE 'package\.json|go\.mod|Cargo\.toml|requirements\.txt|Pipfile|pom\.xml|build\.gradle|Gemfile|composer\.json|新增依赖|pnpm add|npm install|yarn add|go get|cargo add|pip install' || true; } | tr -d ' ')

# 评分
SCORE=0
[ "$FILE_COUNT" -ge 8 ]  && SCORE=$((SCORE+1))
[ "$FILE_COUNT" -ge 15 ] && SCORE=$((SCORE+1))
[ "$MODULE_COUNT" -ge 2 ] && SCORE=$((SCORE+1))
[ "$MODULE_COUNT" -ge 4 ] && SCORE=$((SCORE+1))
[ "$SCENARIO_COUNT" -ge 5 ]  && SCORE=$((SCORE+1))
[ "$SCENARIO_COUNT" -ge 10 ] && SCORE=$((SCORE+1))
[ "$ABSTRACTION_COUNT" -ge 1 ] && SCORE=$((SCORE+1))
[ "$ABSTRACTION_COUNT" -ge 3 ] && SCORE=$((SCORE+1))
[ "$DEP_COUNT" -ge 1 ] && SCORE=$((SCORE+1))

# 红线检测（跨栈通用：前端 / 后端 / Go / Python / Java / Rust / Web3）
REDLINE=""

# R1 鉴权/资金/计费目录 —— 路径名通用（不限 features/）
echo "$CONTENT" | grep -qiE '(^|/|"|\s)(auth|authn|authz|payment|billing|wallet|kyc|identity|session|credentials?|tokens?)/' && REDLINE="${REDLINE}auth-payment-dir "

# R2 Schema / 迁移 —— SQL DDL / ORM 迁移 / NoSQL schema
echo "$CONTENT" | grep -qiE 'CREATE TABLE|ALTER TABLE|DROP TABLE|CREATE INDEX|migration|AutoMigrate|prisma migrate|alembic|knex.*migrate|django.*migrate' && REDLINE="${REDLINE}schema-migration "

# R3 金额 / 精度计算 —— JS / Go / Python / Java
#   JS: BigNumber, calculate(), ethers.parseUnits（写入/运算）；toFixed/floorToDecimal/formatUnits 属纯展示，不计红线
#   Go: shopspring/decimal, big.Float, big.Int (金额相关)
#   Python: decimal.Decimal
#   Java: BigDecimal
#   SQL: DECIMAL( 类型声明
echo "$CONTENT" | grep -qE 'BigNumber|BigDecimal|big\.(Float|Int)|shopspring/decimal|decimal\.Decimal|calculate\(|parseUnits|DECIMAL\([0-9]+' && REDLINE="${REDLINE}money-precision "

# R4 密码学 / 链上签名 —— Web3 + 通用密码
#   Web3: signMessage, eth_sign, EIP-712, signTypedData, permit
#   通用: HMAC, RSA sign, ed25519, JWT sign（涉及 secret 派生的签名场景）
echo "$CONTENT" | grep -qiE 'signMessage|eth_sign|EIP-?712|signTypedData|permit\(|HMAC|crypto/rsa|ed25519|jwt\.(sign|Sign)' && REDLINE="${REDLINE}crypto-sign "

# R5 Secret / 凭据管理 —— API key / private key / env 文件落地变更
echo "$CONTENT" | grep -qiE '(api[_-]?key|private[_-]?key|secret[_-]?key|access[_-]?token)\s*=|\.env(\.|$)|secrets\.|vault\.read' && REDLINE="${REDLINE}secret-handling "

# R6 外部 API 契约破坏性变更 —— breaking change 关键词
echo "$CONTENT" | grep -qiE 'breaking[ -]change|不兼容变更|API 破坏性|删除字段|重命名字段|response 结构变更' && REDLINE="${REDLINE}api-breaking "

# 分档
if [ -n "$REDLINE" ]; then
  VERDICT=complex
elif [ "$SCORE" -ge 6 ]; then
  VERDICT=complex
elif [ "$SCORE" -ge 3 ]; then
  VERDICT=medium
else
  VERDICT=simple
fi

echo "FILES=$FILE_COUNT"
echo "MODULES=$MODULE_COUNT"
echo "SCENARIOS=$SCENARIO_COUNT"
echo "ABSTRACTIONS=$ABSTRACTION_COUNT"
echo "DEPS=$DEP_COUNT"
echo "SCORE=$SCORE"
echo "REDLINE=${REDLINE:-none}"
echo "VERDICT=$VERDICT"
