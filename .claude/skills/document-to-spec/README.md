# Document to Spec Converter

将 PRD 文档（PDF、Word、Markdown）自动转换为符合项目规范的 spec 文档。

---

## 🚀 快速开始

### 1. 安装依赖

```bash
cd .claude/skills/document-to-spec
pip install -r requirements.txt
```

### 2. 准备 PRD 文档

**方式 A: 放到 startup 目录（推荐）**
```bash
# 将 PRD 文档放到 startup 目录
cp your-prd.md .claude/kit/startup/

# 然后直接运行
"使用 document-to-spec"
```

**方式 B: 指定文件路径**
```bash
# 解析 Markdown
python scripts/parse-document.py /path/to/prd.md

# 解析 PDF
python scripts/parse-document.py /path/to/prd.pdf --format json

# 解析 Word
python scripts/parse-document.py /path/to/prd.docx --max-tokens 2500
```

### 3. 在 AI 对话中使用

**默认模式（推荐）**：
```
"使用 document-to-spec"
```

AI 会自动：
1. 检查 `.claude/kit/startup` 目录
2. 如果有文件，自动读取并解析
3. 生成英文文件名的 spec 到 `.claude/kit/spec/`

**指定文件模式**：
```
"请使用 document-to-spec skill 将 docs/prd/user-auth.md 转换为 spec"
```

AI 会自动：
1. 使用指定的文件路径
2. 运行解析脚本
3. 生成英文文件名的 spec 到 `.claude/kit/spec/`

---

## 📦 功能特性

- ✅ **多格式支持**: PDF、Word (.docx)、Markdown (.md)
- ✅ **智能启动**: 默认从 `.claude/kit/startup` 读取文件
- ✅ **智能解析**: 自动识别章节结构和关键信息
- ✅ **Token 优化**: 智能截断，优先保留核心需求（节省 70-85% token）
- ✅ **自动生成**: 符合项目 spec-template.md 规范
- ✅ **英文命名**: 自动生成英文 kebab-case 文件名（如 `user-authentication.md`）

---

## 📁 目录结构

```
document-to-spec/
├── SKILL.md                 # Skill 主文档
├── README.md                # 本文件
├── requirements.txt         # Python 依赖
├── scripts/
│   └── parse-document.py    # 文档解析脚本
└── references/
    ├── spec-template-guide.md       # Spec 模板填写指南
    ├── prd-parsing-patterns.md      # PRD 解析模式参考
    └── token-optimization.md        # Token 优化策略详解
```

---

## 🔧 命令行用法

### 基础命令

```bash
python scripts/parse-document.py <文件路径> [选项]
```

### 选项说明

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `--format` | 输出格式: `json` 或 `text` | `json` |
| `--max-tokens` | 最大 token 限制 | `3000` |

### 示例

```bash
# 1. 输出 JSON（适合 AI 处理）
python scripts/parse-document.py prd.md --format json

# 2. 输出纯文本（人类可读）
python scripts/parse-document.py prd.md --format text

# 3. 限制 token 使用
python scripts/parse-document.py large-prd.pdf --max-tokens 2000

# 4. 查看帮助
python scripts/parse-document.py --help
```

---

## 🎯 使用场景

### 场景 1: 标准 PRD 转换

**输入**: `user-authentication-prd.md`（标准 PRD 格式）

**AI 处理**: 自动生成 `.claude/kit/spec/user-authentication.md`（英文文件名）

---

### 场景 3: PDF 文档转换

**准备**: 将 PDF 放到 startup 目录
```bash
cp product-spec-v2.pdf .claude/kit/startup/
```

**执行**:
```
用户: "使用 document-to-spec"
```

**输出**: `.claude/kit/spec/product-spec.md`（英文文件名）

**注意**: 
- 文本版 PDF 效果最佳
- 扫描版需要先 OCR 处理

---

### 场景 4: Word 文档转换

**准备**: 将 Word 文档放到 startup 目录
```bash
cp feature-requirements.docx .claude/kit/startup/
```

**执行**:
```
用户: "使用 document-to-spec"
```

**输出**: `.claude/kit/spec/feature-requirements.md`（英文文件名）

**优势**: 保留标题样式和段落结构

---

## 📊 Token 优化

### 为什么需要优化？

典型 PRD 文档: 15-30 页，约 10,000-20,000 tokens  
AI 处理限制: ~5,000 tokens 有效工作空间

### 优化策略

1. **章节优先级排序**: 核心章节（需求、用户故事）优先保留
2. **智能截断**: 自动限制在设定 token 范围内
3. **冗余内容过滤**: 删除技术细节、附录等对 spec 无用的内容

### 效果对比

| 优化级别 | Token 使用 | 节省比例 |
|---------|-----------|---------|
| 无优化 | 20,000 | 0% |
| 基础优化 | 5,000 | 75% |
| 完全优化 | 3,000 | 85% |

**详细说明**: 参考 `references/token-optimization.md`

---

## 📖 工作流程

### 完整流程

```
┌─────────────────┐
│  PRD 文档       │
│ (.md/.pdf/.docx)│
└────────┬────────┘
         │
         ↓
┌─────────────────┐
│ parse-document  │  ← 本地运行，0 tokens
│     .py         │
└────────┬────────┘
         │
         ↓
┌─────────────────┐
│ 结构化 JSON     │  ← 3,000 tokens（优化后）
│ 章节 + 优先级   │
└────────┬────────┘
         │
         ↓
┌─────────────────┐
│ AI 分析         │  ← 分步处理
│ • 提取用户故事  │
│ • 分类需求      │
│ • 补充边界情况  │
└────────┬────────┘
         │
         ↓
┌─────────────────┐
│ 生成 Spec       │  ← 符合 spec-template.md
│ .claude/kit/    │
│ spec/功能名.md  │
└─────────────────┘
```

---

## 🛠️ 依赖说明

### 必需依赖

```txt
pypdf>=3.0.0         # PDF 解析
python-docx>=1.0.0   # Word 解析
```

### 安装方法

```bash
# 方法 1: 直接安装
pip install pypdf python-docx

# 方法 2: 使用 requirements.txt
pip install -r requirements.txt

# 方法 3: 使用国内镜像（加速）
pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
```

### 依赖检查

脚本会自动检测依赖，如果缺失会给出提示：

```
错误: pypdf 未安装
请运行: pip install pypdf
```

---

## 🐛 故障排查

### 问题 1: 依赖安装失败

**症状**:
```
ERROR: Could not find a version that satisfies the requirement pypdf
```

**解决**:
```bash
# 更新 pip
pip install --upgrade pip

# 重新安装
pip install pypdf python-docx
```

---

### 问题 2: PDF 解析返回空内容

**可能原因**:
- PDF 是扫描件（纯图片）
- PDF 有密码保护
- PDF 使用特殊编码

**解决方案**:
1. 使用 OCR 工具转换为文本 PDF
2. 解除密码保护
3. 尝试转换为 Markdown 格式

---

### 问题 3: 中文乱码

**症状**:
```
����������
```

**解决**:
```bash
# 检查文件编码
file -I document.md

# 转换编码（如果需要）
iconv -f GBK -t UTF-8 document.md > document_utf8.md
```

---

### 问题 4: Token 使用仍然过高

**症状**:
```
Estimated tokens: 8000 (超出预期)
```

**解决**:
```bash
# 1. 降低 token 限制
python scripts/parse-document.py prd.pdf --max-tokens 2000

# 2. 检查是否包含大量技术细节
python scripts/parse-document.py prd.pdf --format text | less

# 3. 手动编辑 PRD，删除冗余章节
```

---

## 📚 参考文档

### 核心文档

1. **[SKILL.md](./SKILL.md)** - 完整的 skill 使用指南
2. **[spec-template-guide.md](./references/spec-template-guide.md)** - Spec 模板填写详解
3. **[prd-parsing-patterns.md](./references/prd-parsing-patterns.md)** - PRD 解析模式和策略
4. **[token-optimization.md](./references/token-optimization.md)** - Token 优化完整指南

### 项目文档

- `.claude/kit/templates/spec-template.md` - Spec 模板
- `.claude/kit/docs/what-is-spec-workflow.md` - Spec 工作流说明

---

## 💡 最佳实践

### ✅ 推荐做法

1. **优先使用 Markdown PRD**
   - 解析最准确
   - Token 使用最少
   - 易于维护

2. **合理设置 token 限制**
   ```bash
   # 简单功能（1-2 周）
   --max-tokens 1500
   
   # 中等复杂（2-4 周）
   --max-tokens 2500
   
   # 复杂系统（4+ 周）
   --max-tokens 3500
   ```

3. **人工审核生成结果**
   - 自动生成后检查关键章节
   - 补充边界情况
   - 完善成功指标

### ❌ 避免做法

1. **不要直接处理超大 PDF**
   - 先用脚本解析
   - 避免 token 浪费

2. **不要跳过质量检查**
   - 验证必填字段
   - 确认验收标准完整

3. **不要过度依赖自动化**
   - 复杂需求需要人工判断
   - 边界情况可能需要补充

---

## 🔄 版本历史

### v1.0.0 (2026-01-23)

- ✅ 初始版本发布
- ✅ 支持 PDF/Word/Markdown 解析
- ✅ 实现 token 优化策略（节省 70-85%）
- ✅ 自动生成 spec 文档
- ✅ 智能文件命名
- ✅ 完整参考文档

---

## 📄 许可证

MIT License - 可自由使用和修改

---

## 🤝 贡献

改进建议：

1. **增强解析能力**: 支持更多格式（HTML、纯文本）
2. **优化 AI 分析**: 更准确的需求识别
3. **扩展功能**: 批量转换、API 集成

---

## 📞 支持

遇到问题？

1. 查看 [故障排查](#-故障排查) 章节
2. 阅读 [参考文档](#-参考文档)
3. 检查 [最佳实践](#-最佳实践)

---

**享受自动化带来的效率提升！** 🎉
