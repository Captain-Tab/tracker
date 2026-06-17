建一块协同看板（SSOT）。

1. 定 topic：用户给的，或取当前底座 spec 文件名。
2. 读底座 spec：`.claude/kit/spec/<topic>.md` 或用户指定的 spec 文件，读全文。
3. 建看板：拷 `.claude/kit/cowork/templates/board.md` → `.claude/kit/spec/cowork/<topic>.md`（目录不存在则建）。
4. 填底座区：spec 源链接（指回 spec 文件）、版本=今日日期、目标/契约摘要——只放摘要，不复制 spec 全文。
5. 与用户确认任务分解：把 spec 拆成「可独立验收」的块，逐块填进任务分解表（status=todo）；过复杂 / 强依赖的块标出来，建议串行或单独处理。
6. 回一行：`已建看板 <路径>，N 个块；各会话 /k:cowork pickup 认领`

不复述看板全文。
