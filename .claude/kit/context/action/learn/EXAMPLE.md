# Learn 命令使用示例

## 概述

`/k/context learn <path>` 命令通过 AI 分析代码，自动生成符合 Context 格式的文档。适用于理解遗留代码、快速建立上下文、没有 spec 文档的场景。

## 使用场景

### 场景 1：理解遗留代码

```bash
# 场景：接手他人写的 Hook，需要快速理解
/k/context learn src/hooks/useAutoSwitchNetwork.ts

# AI 会分析并输出：
# - 核心逻辑：executeWithAutoSwitch、checkNetwork、performSwitch
# - 数据流：输入 targetChainId → 检查切换 → 执行业务操作
# - 关键组件：useAutoSwitchNetwork.ts、chainConfig.ts
# - 技术标签：custom-hook, network-switch, multi-chain, polling
```

### 场景 2：分析整个功能目录

```bash
# 场景：理解 Vault Deposit 整个流程
/k/context learn src/pages/vault/components/modals/funding/deposit/

# AI 会分析多个文件，提取：
# - 目录包含 10+ 文件
# - 入口组件：DepositModal.tsx
# - 核心逻辑：双层状态机、Bridge、Settling
# - 数据流：用户输入 → Base Chain → Value Chain → 确认
```

### 场景 3：快速建立新项目上下文

```bash
# 场景：从代码库学习关键模块
/k/context learn src/services/transaction/

# 适合：
# - 新加入项目的开发者
# - 没有文档的遗留系统
# - 需要快速了解代码结构
```

## 输出示例

### 单文件分析

```bash
$ /k/context learn src/hooks/useAutoSwitchNetwork.ts

📚 从代码学习生成 Context 文档（增强分析）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

目标路径: src/hooks/useAutoSwitchNetwork.ts

📊 代码统计：
  文件数量: 1
  代码行数: 156
  文件类型: Hook

📁 主要文件：
  src/hooks/useAutoSwitchNetwork.ts

🔍 正在读取代码内容...

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
文件内容预览:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
import { useState, useCallback } from 'react'
import { useSwitchNetwork } from 'wagmi'
import { CHAIN_CONFIG } from '@/config/chainConfig'

export function useAutoSwitchNetwork(targetChainId: number) {
  const [isSwitching, setIsSwitching] = useState(false)
  const { switchNetworkAsync } = useSwitchNetwork()

  const executeWithAutoSwitch = useCallback(async (action: () => Promise<any>) => {
    // 检查当前链
    const currentChain = await getCurrentChain()
    if (currentChain === targetChainId) {
      return await action()
    }

    // 切换网络
    setIsSwitching(true)
    try {
      await switchNetworkAsync({ chainId: targetChainId })

      // 轮询确认切换完成
      await pollNetworkSwitch(targetChainId)

      // 执行业务操作
      return await action()
    } finally {
      setIsSwitching(false)
    }
  }, [targetChainId, switchNetworkAsync])

  return { executeWithAutoSwitch, isSwitching }
}

... (后续代码)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🤖 请深入分析以上代码，提取以下结构化信息：

[分析提示输出...]
```

### AI 分析结果（JSON 格式）

```json
{
  "suggestedId": "infrastructure-network-switch-01",
  "suggestedModule": "infrastructure",
  "title": "自动网络切换 Hook",
  "summary": "提供 executeWithAutoSwitch 方法，自动检测并切换到目标链，支持轮询确认和错误处理",
  "quickRef": {
    "coreLogic": [
      "executeWithAutoSwitch(action): 包装业务操作，自动处理网络切换",
      "getCurrentChain(): 获取当前连接的链 ID",
      "pollNetworkSwitch(targetChainId): 轮询确认网络切换完成"
    ],
    "dataFlow": [
      "输入: targetChainId (目标链ID), action (待执行的业务操作)",
      "处理: 检查当前链 → 切换链（如需要）→ 轮询确认 → 执行业务操作",
      "输出: Promise<业务操作的返回值>",
      "状态: isSwitching (是否正在切换)"
    ],
    "keyComponents": [
      "useAutoSwitchNetwork.ts - 统一网络切换 Hook (导出: useAutoSwitchNetwork)",
      "chainConfig.ts - 多链配置映射 (导出: CHAIN_CONFIG, SUPPORTED_CHAINS)",
      "依赖: wagmi 的 useSwitchNetwork Hook"
    ]
  },
  "tags": ["custom-hook", "network-switch", "multi-chain", "polling", "wagmi", "async-await", "error-handling"],
  "files": [
    "src/hooks/useAutoSwitchNetwork.ts",
    "src/config/chainConfig.ts"
  ]
}
```

## 分析维度说明

### 1. 核心逻辑 (coreLogic)
- **目标**：回答"这段代码做什么？"
- **内容**：关键函数名 + 一句话描述
- **示例**：
  ```
  - executeWithAutoSwitch(action): 包装业务操作，自动处理网络切换
  - checkNetwork(): 检查当前链是否匹配目标链
  ```

### 2. 数据流 (dataFlow) ⭐ NEW
- **目标**：回答"数据如何流转？"
- **内容**：输入 → 处理步骤 → 输出
- **示例**：
  ```
  输入: targetChainId, action
  处理: 检查链 → 切换链 → 轮询确认 → 执行业务操作
  输出: Promise<业务操作的返回值>
  ```

### 3. 关键组件 (keyComponents)
- **目标**：回答"涉及哪些文件和模块？"
- **内容**：文件名 - 职责 - 导出内容
- **示例**：
  ```
  - useAutoSwitchNetwork.ts - 统一网络切换 Hook (导出: useAutoSwitchNetwork)
  - chainConfig.ts - 多链配置映射 (导出: CHAIN_CONFIG)
  ```

### 4. 技术标签 (tags)
- **目标**：回答"用了哪些技术和模式？"
- **内容**：设计模式、库、技术特征
- **示例**：
  ```
  ["custom-hook", "network-switch", "multi-chain", "polling", "wagmi"]
  ```

### 5. 功能分类建议
- **目标**：回答"应该归到哪个模块？"
- **内容**：建议的 feature-id 和 module
- **判断标准**：
  - components: 纯 UI 组件
  - features: 业务流程
  - infrastructure: 工具函数、通用 Hook
  - shared: 跨模块共享

## 对比：learn vs record

| 维度 | learn | record |
|------|-------|--------|
| **输入** | 代码文件/目录 | spec 文档 + history 文档 |
| **场景** | 理解遗留代码 | 新功能开发 |
| **流程** | 代码 → AI 分析 → Context | spec → 合并 → Context |
| **优势** | 无需 spec，快速建立上下文 | 标准化流程，信息完整 |
| **适用** | 没有文档的代码 | 有 spec 的新功能 |

## 最佳实践

### ✅ 推荐用法

1. **先 learn，再 record**
   ```bash
   # 1. 用 learn 快速理解代码
   /k/context learn src/hooks/useVaultDeposit.ts

   # 2. 基于理解，补充 spec 文档
   # (编写 spec...)

   # 3. 用 record 正式记录
   /k/context record
   ```

2. **团队协作：新人快速上手**
   ```bash
   # 新人接手项目，快速建立上下文
   /k/context learn src/pages/vault/
   /k/context learn src/hooks/useWalletConnect.ts
   /k/context learn src/services/api/
   ```

3. **定期维护：更新文档**
   ```bash
   # 代码重构后，重新生成文档
   /k/context learn src/refactored/module/
   /k/context update <feature-id>  # 更新现有文档
   ```

### ❌ 不推荐用法

1. **不要分析第三方库代码**
   ```bash
   # ❌ 不要分析 node_modules
   /k/context learn node_modules/react/
   ```

2. **不要分析配置文件**
   ```bash
   # ❌ 配置文件不适合 learn
   /k/context learn tsconfig.json
   ```

3. **不要分析测试文件**
   ```bash
   # ❌ 测试文件应该单独管理
   /k/context learn src/__tests__/
   ```

## 技巧和建议

### 1. 单文件 vs 目录

- **单文件**：适合分析独立的 Hook、工具函数
  ```bash
  /k/context learn src/hooks/useAutoSwitchNetwork.ts
  ```

- **目录**：适合分析完整功能、复杂组件
  ```bash
  /k/context learn src/pages/vault/components/modals/deposit/
  ```

### 2. 代码预览限制

- Learn 会显示**前 100 行**代码供 AI 分析
- 如果文件超过 100 行，AI 仍能访问完整文件
- 建议：复杂代码拆分成小文件，提高分析准确性

### 3. AI 分析质量

影响因素：
- ✅ 代码注释质量（有注释的代码分析更准确）
- ✅ 代码结构清晰度（模块化好的代码更容易理解）
- ✅ 命名规范（语义化命名帮助 AI 理解意图）

### 4. 后续处理

Learn 生成的文档可以：
1. 直接保存到 Context Library
2. 手动调整后再 record
3. 作为编写 spec 的参考

## 故障排除

### 问题 1：找不到代码文件

```bash
❌ 路径不存在: src/hooks/useTest.ts
```

**解决**：检查路径是否正确，使用相对路径或绝对路径

### 问题 2：未找到可分析的代码文件

```bash
❌ 未找到可分析的代码文件
```

**解决**：确保目录中有 .ts, .tsx, .js, .jsx 文件

### 问题 3：AI 分析不够准确

**解决方案**：
1. 检查代码注释是否完善
2. 尝试分析更小的代码单元
3. 手动调整 AI 输出的结果

---

**提示**：Learn 命令是快速建立代码上下文的工具，不能完全替代人工编写的文档。建议将 learn 和 record 结合使用，达到最佳效果。
