#!/bin/bash
# codex.sh - PR 审核取数（供 /k:codex 一次性核验）
# 用法: bash codex.sh <detect-pr|fetch> [PR]
#
# 关键约定:
# - 全程 unset GITHUB_TOKEN: 环境里失效的 token 会盖掉 keyring 有效 token, 否则一律 401
# - gh -q 直接走 jq 语法, 无需额外依赖
# - 监听生命周期在 codex-watch.sh, 本脚本只管取数

unset GITHUB_TOKEN

CMD="${1:-}"

detect_pr() { gh pr view --json number -q .number 2>/dev/null; }
detect_repo() { gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null; }

case "$CMD" in
  # 探测当前分支对应的 PR 号
  detect-pr)
    PR="$(detect_pr)"
    [ -z "$PR" ] && { echo "ERR: 当前分支无对应 PR" >&2; exit 1; }
    echo "$PR"
    ;;

  # 一次性取数: checks 状态 + Codex 总结 + 全部行内评论
  fetch)
    PR="${2:-$(detect_pr)}"
    REPO="$(detect_repo)"
    [ -z "$PR" ] && { echo "ERR: 无法探测当前分支对应的 PR, 请显式传入 PR 号" >&2; exit 1; }
    [ -z "$REPO" ] && { echo "ERR: 无法探测当前仓库, 请在目标仓库目录下执行" >&2; exit 1; }

    echo "### PR #$PR @ $REPO"
    echo ""
    echo "## CHECKS"
    # 只出 codex_review (本命令唯一需要的 check); 其它 CI (check/pr_quality/build/test) 一律不喂
    # —— 根因防线: 不把 CI 失败塞进模型上下文, 从源头消除"顺手报 CI"的诱因
    # 名称跨仓不一: sodex-web "codex_review" / sodex-next "codex / codex_review", 用 contains 匹配
    CODEX_BUCKET="$(gh pr checks "$PR" --json name,bucket \
      -q 'first(.[] | select(.name | contains("codex_review")) | .bucket) // empty' 2>/dev/null)"
    echo "codex_review: ${CODEX_BUCKET:-not_found}"
    echo ""
    echo "## CODEX_SUMMARY"
    gh pr view "$PR" --json comments \
      -q '.comments[] | select(.body | contains("codex-pr-review")) | .body' 2>/dev/null
    echo ""
    echo "## INLINE_COMMENTS"
    # 全部 reviewer 的行内评论 (codex / cursor[bot] / 人工), 带 file:line
    gh api "repos/$REPO/pulls/$PR/comments" \
      -q '.[] | "[\(.user.login)] \(.path):\(.line)\n\(.body)\n---"' 2>/dev/null
    ;;

  *)
    echo "用法: bash codex.sh <detect-pr|fetch> [PR]" >&2
    exit 1
    ;;
esac
