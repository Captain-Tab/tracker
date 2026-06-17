# 翻译 API 参考

## 概述

翻译脚本位于 `scripts/i18n/translate/index.js`，提供带占位符保护的翻译功能。

**v4.1.0 新增**：双 API 架构，支持主备自动切换。

## API 架构

```
主 API (优先)              备用 API (Fallback)
sosovalue.io     ───────>   Google Translate
                  失败时
```

## API 接口

### `createTranslator(options?)`

创建翻译器实例。

```javascript
const { createTranslator } = require('./scripts/i18n/translate/index.js');

const translator = createTranslator({
  apiUrl: 'custom-url',  // 可选，主 API URL
  apiKey: 'custom-key',  // 可选，主 API Key
  verbose: true          // 可选，启用详细日志（显示 fallback 信息）
});
```

### `translator.translateOne({ to, text })`

翻译单条文本。

**参数**：
- `to` (string): 目标语言代码（如 'zh', 'ja', 'es'）
- `text` (string): 待翻译文本

**返回**：`Promise<string>` - 翻译结果

**示例**：
```javascript
// 简单文本
const result1 = await translator.translateOne({
  to: 'zh',
  text: 'Welcome!'
});
// 返回: "欢迎！"

// 带单个变量
const result2 = await translator.translateOne({
  to: 'zh',
  text: 'Welcome, {{username}}!'
});
// 返回: "欢迎，{{username}}！"

// 带多个变量
const result3 = await translator.translateOne({
  to: 'zh',
  text: 'Order #{{orderId}} for {{amount}} {{coin}}'
});
// 返回: "订单 #{{orderId}}，金额 {{amount}} {{coin}}"

// 带 HTML 标签和变量
const result4 = await translator.translateOne({
  to: 'zh',
  text: 'Deposit at Least <span>{{amount}} {{coin}}</span>.'
});
// 返回: "至少存入 <span>{{amount}} {{coin}}</span>。"
```

## 语言映射

### 主 API 支持的语言

| 目录名 | API 语言代码 | 状态 |
|--------|-------------|------|
| en | en（不翻译，直接返回） | ✅ |
| zh | zh | ✅ |
| hk | tc | ✅ |
| ja | ja | ✅ |
| ko | ko | ✅ |
| es | es | ✅ |
| ru | ru | ✅ |
| vi | vi | ✅ |
| tr | tr | ✅ |
| fr | fr | ✅ |
| pt | pt | ✅ |
| id | id | ✅ |

### 备用 API (Google Translate) 额外支持

| 目录名 | Google 语言代码 | 说明 |
|--------|-----------------|------|
| de | de | 德语 |
| it | it | 意大利语 |
| nl | nl | 荷兰语 |
| pl | pl | 波兰语 |
| ar | ar | 阿拉伯语 |
| th | th | 泰语 |
| hi | hi | 印地语 |
| ... | ... | 支持 100+ 语言 |

> **注意**：当主 API 不支持目标语言时，系统自动使用 Google Translate 备用 API。

## 变量占位符保护机制

脚本自动保护 i18n 插值占位符 `{{variable}}`：

### 单个变量

```
输入:  "Welcome, {{username}}!"
       ↓ (API 调用前)
安全:  "Welcome, __I18N_VAR_0__!"
       ↓ (API 翻译)
翻译:  "欢迎，__I18N_VAR_0__！"
       ↓ (还原)
输出:  "欢迎，{{username}}！"
```

### 多个变量

```
输入:  "Order #{{orderId}} for {{amount}} {{coin}}"
       ↓ (API 调用前)
安全:  "Order #__I18N_VAR_0__ for __I18N_VAR_1__ __I18N_VAR_2__"
       ↓ (API 翻译)
翻译:  "订单 #__I18N_VAR_0__，金额 __I18N_VAR_1__ __I18N_VAR_2__"
       ↓ (还原)
输出:  "订单 #{{orderId}}，金额 {{amount}} {{coin}}"
```

### 变量 + HTML 标签

```
输入:  "Deposit at Least <span>{{amount}} {{coin}}</span>."
       ↓ (API 调用前)
安全:  "Deposit at Least <span>__I18N_VAR_0__ __I18N_VAR_1__</span>."
       ↓ (API 翻译)
翻译:  "至少存入 <span>__I18N_VAR_0__ __I18N_VAR_1__</span>。"
       ↓ (还原)
输出:  "至少存入 <span>{{amount}} {{coin}}</span>。"
```

## 缓存

翻译器按 `${lang}::${text}` 缓存结果，同一会话内避免重复 API 调用。

## 错误处理

- 空语言或空文本 → 返回空字符串
- 不支持的语言（主 API + 备用 API 都不支持） → 返回空字符串
- 主 API 错误 → 自动尝试备用 API (Google Translate)
- 主 API 不支持语言 → 自动尝试备用 API
- 所有 API 都失败 → 抛出异常

## Fallback 机制

### 触发条件

```javascript
// 以下情况会触发 Google Translate 备用 API：
1. 主 API 返回 "unsupported language" 错误
2. 主 API 返回空翻译结果
3. 主 API HTTP 请求失败
4. 目标语言不在主 API 支持列表中（如德语 de）
```

### 日志输出

启用 `verbose: true` 后，会输出 fallback 信息：

```
[translate] [primary] 失败 (de): unsupported language: de
[translate] [fallback] 使用 Google Translate (de)
[translate] [fallback] 完成 (de): "Willkommen..."
```
