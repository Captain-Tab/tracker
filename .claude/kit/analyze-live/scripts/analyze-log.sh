#!/usr/bin/env bash
# 用法: analyze-log.sh <log-path> [filter-substring]
# 例:   analyze-log.sh /path/to/debug.log findPage
#
# 解析 debug.log，提取 [CAPTURE:XHR]/[CAPTURE:FETCH] 条目，按 (method, url-without-query) 去重，
# 输出 Markdown 格式的接口清单：URL / Method / 所有唯一 Request Body / Response 首行预览 / 调用次数。

set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Usage: $0 <log-path> [filter-substring]" >&2
  exit 1
fi

LOG="$1"
FILTER="${2:-}"

if [ ! -f "$LOG" ]; then
  echo "❌ log not found: $LOG" >&2
  exit 1
fi

python3 - "$LOG" "$FILTER" <<'PY'
import json, sys, collections

log_path = sys.argv[1]
filter_sub = sys.argv[2] if len(sys.argv) > 2 else ""

groups = collections.OrderedDict()
total = 0
for line in open(log_path):
    try:
        e = json.loads(line)
    except Exception:
        continue
    if e.get("tag") not in ("[CAPTURE:XHR]", "[CAPTURE:FETCH]"):
        continue
    d = e.get("data") or {}
    url = d.get("url", "")
    if filter_sub and filter_sub not in url:
        continue
    total += 1
    key = (d.get("method"), url.split("?")[0])
    groups.setdefault(key, []).append(d)

print(f"# 实测 API 调用清单\n")
print(f"- 日志: `{log_path}`")
if filter_sub:
    print(f"- 过滤: `{filter_sub}`")
print(f"- 总条数: {total}")
print(f"- 唯一接口数: {len(groups)}\n")

for i, ((method, path), arr) in enumerate(groups.items(), 1):
    sample = arr[0]
    print(f"## #{i} {method} {path}  (×{len(arr)})\n")
    # 唯一 request body 形态
    bodies = []
    for x in arr:
        b = x.get("requestBody")
        s = json.dumps(b, ensure_ascii=False) if b else "(none)"
        if s not in bodies:
            bodies.append(s)
    print(f"**唯一 Request 形态 ({len(bodies)} 种)**:")
    for b in bodies[:5]:
        print(f"```json")
        print(b[:600])
        print(f"```")
    if len(bodies) > 5:
        print(f"... 还有 {len(bodies) - 5} 种")
    print()
    # response 样本
    rp = sample.get("responsePreview", "")
    if rp:
        print(f"**Response 样本** (status={sample.get('status')}):")
        print(f"```json")
        print(rp[:800])
        print(f"```")
    print()
PY
