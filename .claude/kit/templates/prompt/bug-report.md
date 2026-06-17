# Bug Report 模板

> 使用方式：复制此模板，填写后直接发给 AI。
> 填写越完整，修复越精准，避免反复猜测。

---

## 🐛 Bug Report

### 现象（What）
> 一句话描述看到了什么

[填写：例如 "点击 Stake 后，Enable Trading 弹窗在 StakeSosoDialog 关闭后仍然出现"]

---

### 复现步骤（Steps to Reproduce）

**前置条件：**
- [ ] 钱包已连接
- [ ] accountId 为空（新用户）/ 非空（老用户）
- [ ] 网络：ValueChain / Base / 其他
- [ ] 其他：___

**操作步骤：**
1. 打开 [页面/弹窗]
2. 点击 [按钮名]
3. 输入 [值]（如有）
4. 点击 [按钮名]

**实际结果：**
[描述看到了什么]

**期望结果：**
[描述应该看到什么]

---

### 问题分类（Type）

选择最符合的类型（可多选）：

- [ ] **UI 样式** — 颜色/间距/字体/圆角不对
- [ ] **UI 布局** — 元素位置/顺序不对
- [ ] **交互/流程** — 点击顺序、弹窗层级、页面跳转、状态切换
- [ ] **数据/计算** — 数值错误、公式错误、精度问题
- [ ] **时序/并发** — Toast 消失、状态不更新、动画丢失、弹窗残留
- [ ] **Auth 流程** — Enable Trading、连接钱包、签名、Session

---

### 参考实现（Reference）

> 新项目中是否有相似功能已正确实现？

- 参考文件：`src/features/[feature]/[file].tsx`（如果知道）
- 参考逻辑：[一句话描述]

**常见参考位置速查：**
| 场景 | 参考文件 |
|------|---------|
| Enable Trading 按钮 | `vault/components/dialogs/VaultWithdrawDialog/VaultWithdrawButton.tsx` |
| Mutation toast 时序 | `vault/containers/useSubmitVaultDeposit.ts` |
| Auth 闸门 | `auth/components/AuthStepsModal/index.tsx` |
| Dialog 层级/关闭 | `shared/infra/modalManager/api.ts` |

---

### 已排查（Ruled Out）

> 已确认不是这些原因导致的（避免 AI 重复检查）：

- 不是 [xxx] 问题，因为 [理由]
- 不是 [xxx] 问题，因为 [理由]

---

### 截图对比（Screenshot）

| 当前（错误） | 期望（正确）/老项目 |
|-------------|-------------------|
| [截图或描述] | [截图或描述] |

---

### 补充信息（Optional）

- 控制台报错：[粘贴报错信息]
- 相关文件：`src/features/[feature]/[file].ts`
- 最近改动：[最近改了什么可能相关]

---

## 🔍 快速根因判断（AI 填写）

> 收到 Bug Report 后，AI 在动手前先完成以下判断：

| 问题类型 | 快速诊断方向 |
|---------|------------|
| 交互/流程 | 先搜新项目参考实现，再读老项目逻辑 |
| 时序/并发 | 优先怀疑 React 18 批量更新（flushSync）/ TanStack Query 回调顺序 |
| Toast 消失 | 检查 onSuccess vs onSettled 顺序，closeNotify 调用位置 |
| 弹窗残留 | 检查 mutation in-flight 取消机制（cancelledRef vs reset） |
| 数值偏差 | 确认数据源（链上/API/本地计算），核对老项目公式 |

**第二次修复失败 → 强制 /k:debug 插桩，禁止继续猜测。**
