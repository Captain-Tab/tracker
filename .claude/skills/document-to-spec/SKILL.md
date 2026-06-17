---
name: document-to-spec
description: 将 PRD 文档（PDF、Word、Markdown）转换为符合项目规范的 spec 文档。支持智能解析、需求提取、token 优化，自动生成标准化 spec。
---

# Document to Spec Converter

将各种格式的 PRD 文档转换为标准化的 spec 文档。

## 功能特性

✅ **多格式支持**: PDF、Word (.docx)、Markdown (.md)  
✅ **智能解析**: 自动识别章节结构和关键信息  
✅ **Token 优化**: 智能截断，优先保留核心需求  
✅ **自动生成**: 符合项目 spec-template.md 规范  
✅ **命名规范**: 自动生成简洁的文件名

---

## 使用方法

### 快速开始

```bash
# 1. 安装依赖（首次使用）
cd .claude/skills/document-to-spec
pip install -r requirements.txt

# 2. 解析文档
python scripts/parse-document.py /path/to/prd.md

# 3. 在 AI 对话中使用
"请使用 document-to-spec skill 将 prd.pdf 转换为 spec"

# 或者直接提供文字描述
"请使用 document-to-spec 将以下需求转换为 spec：[需求描述]"
```

### 智能启动模式

skill 会自动检测输入类型和文件来源：

**模式 A: 默认启动（无文件路径）**
```
用户: "使用 document-to-spec"

AI 自动:
1. 检查 .claude/kit/startup 目录
2. 如果有文件 → 读取并解析
3. 如果无文件 → 提示用户提供需求描述
4. 生成 spec（英文文件名）
```

**模式 B: 指定文件路径**
```
用户: "使用 document-to-spec 转换 docs/prd/feature.md"

AI 自动:
1. 使用指定的文件路径
2. 运行 parse-document.py
3. 生成 spec（英文文件名）
```

**模式 C: 文字输入**
```
用户: "使用 document-to-spec 转换: 为用户提供邮箱登录功能，支持密码重置"

AI 自动:
1. 检测到纯文字描述
2. 直接分析需求
3. 生成 spec（英文文件名）
```

### 命令行用法

```bash
# 基础用法
python scripts/parse-document.py <文件路径>

# 指定输出格式
python scripts/parse-document.py prd.pdf --format text

# 限制 token 使用
python scripts/parse-document.py prd.docx --max-tokens 2000

# JSON 输出（适合 AI 处理）
python scripts/parse-document.py prd.md --format json
```

---

## 工作流程

### 阶段 1: 文档解析

```
输入文档 → parse-document.py → 结构化数据
```

**脚本功能**:
- 📄 Markdown: 按标题层级提取章节
- 📕 PDF: 按页提取内容，智能分段
- 📘 Word: 按段落样式提取，识别标题

**Token 优化策略**:
1. **优先级排序**: 关键章节（问题、需求、验收标准）优先保留
2. **智能截断**: 自动限制在 3000 tokens 以内
3. **内容压缩**: 去除冗余格式和空白

### 阶段 2: AI 分析与转换

```
结构化数据 → AI 分析 → spec 文档
```

**AI 处理流程**:

1. **需求识别**
   - 提取用户故事
   - 识别功能需求（MUST/SHOULD/MAY）
   - 提取验收标准

2. **结构映射**
   - 匹配 spec-template.md 章节
   - 填充对应内容
   - 补充缺失部分

3. **质量检查**
   - 验证必填字段
   - 检查边界情况
   - 确认成功指标

### 阶段 3: 生成 Spec

```
spec 文档 → .claude/kit/spec/ → 简洁文件名
```

**输出规范**:
- 位置: `.claude/kit/spec/[english-name].md`
- 格式: 符合 `spec-template.md` 结构
- 命名: 英文 kebab-case 格式（如: `user-authentication.md`）

---

## 使用示例

### 示例 1: Markdown PRD 转换

```bash
# 输入文件: prd-user-auth.md
python scripts/parse-document.py prd-user-auth.md --format json
```

**输出（JSON 片段）**:
```json
{
  "type": "markdown",
  "file": "prd-user-auth.md",
  "sections": {
    "问题背景": [
      "当前系统缺少用户认证机制",
      "需要支持邮箱和第三方登录"
    ],
    "功能需求": [
      "FR-001: 邮箱密码登录",
      "FR-002: OAuth 第三方登录"
    ]
  },
  "success": true
}
```

### 示例 2: AI 对话转换

```
用户: 使用 document-to-spec 将 prd.pdf 转换为 spec

AI 执行流程:
1. 运行 parse-document.py prd.pdf --format json
2. 读取 JSON 输出
3. 分析需求结构
4. 匹配 spec-template.md
5. 生成 .claude/kit/spec/[功能名].md
6. 报告完成状态
```

**生成的 spec 文件**:
- 路径: `.claude/kit/spec/user-payment.md`（英文文件名）
- 内容: 完整的 spec 文档，包含用户故事、功能需求、成功指标

---

## Token 优化详解

### 问题: PRD 文档通常很长，直接读取会消耗大量 token

### 解决方案: 三级优化策略

#### 1️⃣ 章节优先级排序

**高优先级**（必须保留）:
- 问题/背景
- 目标/需求
- 功能列表
- 验收标准
- 成功指标

**低优先级**（可截断）:
- 附录
- 详细技术方案（spec 阶段不需要）
- 冗长的背景描述

#### 2️⃣ 关键词识别

自动检测包含以下关键词的内容：
```python
priority_keywords = [
    '问题', '目标', '需求', '功能', '验收', '标准',
    'problem', 'goal', 'requirement', 'acceptance'
]
```

#### 3️⃣ 智能截断

```
估算 token → 排序章节 → 截断低优先级内容 → 保持在限制内
```

**效果对比**:
- 原始 PRD: ~10,000 tokens
- 优化后: ~2,500 tokens（保留 80% 核心信息）

---

## 依赖管理

### 必需依赖

```txt
# requirements.txt
pypdf>=3.0.0        # PDF 解析
python-docx>=1.0.0  # Word 解析
```

### 安装方法

```bash
# 方法 1: 使用 pip
pip install pypdf python-docx

# 方法 2: 使用 requirements.txt
pip install -r requirements.txt
```

### 依赖检查

脚本会自动检测依赖，如果缺失会给出安装提示：

```
错误: pypdf 未安装
请运行: pip install pypdf
```

---

## AI 使用指南

### 触发条件

当用户提到以下内容时，激活此 skill：
- "将 PRD 转换为 spec"
- "解析这个文档"
- "生成 spec 文档"
- "document-to-spec"
- "使用 document-to-spec [文件路径/文字描述]"

### 输入类型和文件来源检测

skill 会自动识别输入类型并确定文件来源：

```python
def detect_input_source(user_input: str) -> dict:
    """
    检测用户输入类型和文件来源
    返回: {'type': 'startup' | 'file' | 'text', 'path': str | None}
    """
    # 1. 检查是否指定了文件路径
    file_patterns = [
        r'\.(md|pdf|docx|doc)$',  # 文件扩展名
        r'/',                      # 包含路径分隔符
        r'^\.',                    # 以 . 开头（相对路径）
        r'^~',                     # 以 ~ 开头（用户目录）
    ]
    
    for pattern in file_patterns:
        if re.search(pattern, user_input):
            return {'type': 'file', 'path': extract_path(user_input)}
    
    # 2. 检查 startup 目录
    startup_dir = '.claude/kit/startup'
    if os.path.exists(startup_dir):
        # 查找文档文件
        for ext in ['*.md', '*.pdf', '*.docx']:
            files = glob.glob(f'{startup_dir}/{ext}')
            if files:
                return {'type': 'startup', 'path': files[0]}
    
    # 3. 默认为文字描述
    return {'type': 'text', 'path': None}
```

**判断优先级**:
1. 用户明确指定文件路径 → 使用指定路径
2. 未指定但 `.claude/kit/startup` 有文件 → 使用 startup 文件
3. 都没有 → 使用 prompt 文字描述

### 标准执行流程

#### 流程 1: 默认模式（startup 目录）

```markdown
1. **检测文件来源**
   用户: "使用 document-to-spec"
   AI: 检查 .claude/kit/startup 目录

2. **查找文档文件**
   搜索顺序: *.md → *.pdf → *.docx
   找到: .claude/kit/startup/feature-prd.md

3. **执行解析脚本**
   Shell: python scripts/parse-document.py .claude/kit/startup/feature-prd.md --format json
   
4. **读取 JSON 输出**
   解析结构化数据，提取关键信息

5. **分析需求**
   - 识别用户故事
   - 提取功能需求
   - 确定验收标准
   - 设定成功指标（业务目标导向）

6. **生成英文文件名**
   从需求中提取关键词 → 翻译为英文
   示例: "用户认证功能" → "user-authentication.md"

7. **生成 spec**
   - 读取 spec-template.md
   - 填充提取的信息
   - 补充缺失部分（如边界情况）

8. **写入文件**
   Write: .claude/kit/spec/user-authentication.md
   
9. **报告结果**
   输出文件路径、章节摘要、需要用户确认的部分
```

#### 流程 2: 指定文件路径模式

```markdown
1. **检测输入类型**
   用户: "转换 docs/prd/user-feature.md"
   AI: 识别为文件路径

2. **验证文件存在**
   检查文件是否存在，获取绝对路径

3. **执行解析脚本**
   Shell: python scripts/parse-document.py <path> --format json
   
4-9. [同流程 1 的步骤 4-9]
```

#### 流程 3: 文字转换模式

```markdown
1. **检测输入类型**
   用户: "转换以下需求: 为用户提供邮箱登录功能"
   AI: 识别为纯文字描述

2. **直接分析需求**
   - 理解需求背景
   - 推导用户故事
   - 识别核心功能
   - 推导验收标准

3. **补充完整信息**
   - 推导边界情况
   - 设定合理的成功指标
   - 分类功能需求（MUST/SHOULD/MAY）

4. **生成英文文件名**
   从需求中提取关键词 → 翻译为英文
   示例: "邮箱登录功能" → "email-login.md"

5. **生成 spec**
   - 使用 spec-template.md
   - 填充分析结果

6. **写入文件**
   Write: .claude/kit/spec/email-login.md
   
7. **报告结果**
   标注哪些部分是推导的，提示用户审核
```

### 处理不同格式

#### 文件模式: Markdown (.md)
```bash
用户: "使用 document-to-spec 转换 prd.md"

AI 执行:
python scripts/parse-document.py prd.md --format json
```
- ✅ 章节结构完整
- ✅ 格式保留良好
- ✅ Token 使用最少

#### 文件模式: PDF (.pdf)
```bash
用户: "使用 document-to-spec 转换 prd.pdf"

AI 执行:
python scripts/parse-document.py prd.pdf --max-tokens 2500
```
- ⚠️ 可能丢失格式
- ⚠️ 需要更多 token
- ✅ 支持扫描件

#### 文件模式: Word (.docx)
```bash
用户: "使用 document-to-spec 转换 prd.docx"

AI 执行:
python scripts/parse-document.py prd.docx --format json
```
- ✅ 保留标题样式
- ✅ 段落结构清晰
- ⚠️ 需要安装 python-docx

#### 文字模式: 纯文本描述
```bash
用户: "使用 document-to-spec 转换: 为用户提供邮箱登录功能，
      支持密码重置和账户锁定"

AI 执行:
- 不调用解析脚本（节省时间）
- 直接分析文字内容
- 推导完整 spec 结构
```
- ✅ 无需文件，快速启动
- ✅ Token 使用极少
- ⚠️ 需要人工补充细节

---

## 文件命名规范（英文）

### 自动命名逻辑

```python
def generate_spec_filename(content: Dict) -> str:
    """
    从文档内容提取关键词，翻译为英文，生成文件名
    """
    # 1. 查找标题/主题（中文）
    title = extract_title(content)
    # 示例: "用户认证功能"
    
    # 2. 提取关键功能词（中文）
    keywords = extract_keywords(content)
    # 示例: ["用户", "认证", "登录"]
    
    # 3. 翻译为英文
    english_keywords = translate_to_english(keywords)
    # 示例: ["user", "authentication", "login"]
    
    # 4. 组合生成（kebab-case 格式）
    filename = '-'.join(english_keywords[:3]) + '.md'
    # 示例: "user-authentication.md"
    
    return filename
```

### 命名规则

- ✅ **小写字母**：全部小写
- ✅ **连字符**：单词间用 `-` 连接（kebab-case）
- ✅ **简洁**：2-4 个单词
- ✅ **描述性**：清晰表达功能
- ❌ **避免**：下划线 `_`、空格、中文

### 命名示例

| PRD 主题（中文） | 生成文件名（英文） |
|-----------------|-------------------|
| 用户登录和注册功能 PRD | `user-authentication.md` |
| 支付系统技术方案 | `payment-system.md` |
| 订单管理模块需求文档 | `order-management.md` |
| 商品搜索功能 | `product-search.md` |
| 文件上传组件 | `file-upload.md` |

---

## 质量检查清单

生成 spec 后，自动检查以下项：

- [ ] **概述**: 一句话描述功能价值
- [ ] **用户故事**: 至少 1 个主要故事 (P1 + MVP 标记)
- [ ] **功能需求**: 区分 MUST/SHOULD/MAY
- [ ] **验收标准**: 每个用户故事都有明确的验收条件
- [ ] **边界情况**: 列出至少 2 个边界或异常场景
- [ ] **成功指标**: 至少 1 个可量化的指标

如有缺失，提示用户补充。

---

## 参考文档

- `references/spec-template-guide.md` - Spec 模板填写指南
- `references/prd-parsing-patterns.md` - PRD 解析模式参考
- `references/token-optimization.md` - Token 优化策略详解

---

## 故障排查

### 问题 1: 依赖未安装

**症状**: 
```
错误: pypdf 未安装
```

**解决**:
```bash
pip install pypdf python-docx
```

### 问题 2: PDF 解析失败

**症状**: 
```
PDF 解析返回空内容
```

**可能原因**:
- PDF 是扫描件（纯图片）
- PDF 有密码保护
- PDF 使用特殊编码

**解决**:
1. 转换为文本 PDF
2. 使用 OCR 工具先转文字
3. 手动创建 Markdown 版本

### 问题 3: Token 超限

**症状**: 
```
AI 响应: 内容过长，请减少输入
```

**解决**:
```bash
# 降低 token 限制
python scripts/parse-document.py prd.pdf --max-tokens 1500
```

---

## 最佳实践

### ✅ 推荐做法

1. **优先使用 Markdown**
   - 解析最准确
   - Token 使用最少
   - 易于维护

2. **合理设置 token 限制**
   - 简单功能: 1500 tokens
   - 中等复杂: 2500 tokens
   - 复杂系统: 3500 tokens

3. **人工审核**
   - 自动生成后，人工检查关键章节
   - 补充边界情况
   - 完善成功指标

### ❌ 避免做法

1. **不要直接读取大型 PDF**
   - 先用脚本解析
   - 避免 token 浪费

2. **不要跳过质量检查**
   - 必须验证必填字段
   - 确认验收标准完整

3. **不要过度依赖自动化**
   - 复杂需求需要人工判断
   - 边界情况可能需要补充

---

## 更新日志

### v1.0.0 (2026-01-23)
- ✅ 初始版本发布
- ✅ 支持 PDF/Word/Markdown 解析
- ✅ Token 优化策略
- ✅ 自动生成 spec 文档
- ✅ 智能文件命名

---

## 贡献指南

改进此 skill 的方法：

1. **增强解析能力**
   - 支持更多格式（如 HTML、纯文本）
   - 改进 PDF OCR 识别

2. **优化 AI 分析**
   - 更准确的需求识别
   - 更智能的章节映射

3. **扩展功能**
   - 支持批量转换
   - 集成 Notion/JIRA API

---

## 许可证

MIT License - 可自由使用和修改
