# 同步 Data Map

当新增、删除或重命名 `features/*/containers/` 下的 hook 文件时，必须同步更新 `docs/data-map.md`：

- 新增 hook → 在对应数据类别表格中添加一行
- 删除 hook → 移除对应行
- 重命名 hook → 更新 hook 名称和说明
- 新增 `xxxLogic.ts` → 更新「交互逻辑文件」表格

如果新 hook 不属于任何现有类别，新建一个类别小节。
