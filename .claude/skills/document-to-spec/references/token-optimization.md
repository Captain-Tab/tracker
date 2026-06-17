# Token 优化策略详解

如何在文档转换过程中减少 token 使用，提高效率。

---

## 为什么需要 Token 优化？

### 问题场景

```
典型 PRD 文档:
- 标准 PRD: 15-30 页，约 10,000-20,000 tokens
- 技术 PRD: 20-40 页，约 15,000-30,000 tokens
- Epic 文档: 5-10 页，约 5,000-10,000 tokens

AI 上下文限制:
- 单次请求限制: ~8,000 tokens（输入+输出）
- 有效工作空间: ~5,000 tokens（扣除系统提示）
```

**结论**: 大型 PRD 无法直接处理，必须优化。

---

## 三级优化策略

### 级别 1: 预处理阶段（parse-document.py）

在文档解析时就减少 token 使用。

#### 策略 1.1: 章节优先级排序

**原理**: 并非所有章节都同等重要

**实现**:
```python
def calculate_section_priority(section_name: str, content: List[str]) -> int:
    """
    计算章节优先级分数
    """
    priority = 0
    section_lower = section_name.lower()
    
    # 高优先级关键词
    high_priority_keywords = [
        '问题', '目标', '需求', '功能', '用户故事', 
        '验收', '标准', '成功', '指标',
        'problem', 'goal', 'requirement', 'feature',
        'user story', 'acceptance', 'criteria', 'success'
    ]
    
    # 章节名称匹配
    for keyword in high_priority_keywords:
        if keyword in section_lower:
            priority += 10
    
    # 内容关键词密度
    content_text = ' '.join(content).lower()
    for keyword in high_priority_keywords:
        priority += content_text.count(keyword)
    
    # 结构化内容加分（列表、表格）
    for line in content:
        if line.strip().startswith('-') or line.strip().startswith('|'):
            priority += 1
    
    return priority
```

**效果**:
```
排序前: 按文档顺序读取所有章节
排序后: 核心章节优先，附录最后（可截断）

节省 token: 30-40%
```

#### 策略 1.2: 智能截断

**原理**: 当 token 接近限制时，截断低优先级内容

**实现**:
```python
def smart_truncate(sections: Dict, max_tokens: int = 3000) -> Dict:
    """
    智能截断：保留高优先级内容
    """
    # 1. 排序章节
    sorted_sections = sorted(
        sections.items(),
        key=lambda x: calculate_section_priority(x[0], x[1]),
        reverse=True
    )
    
    # 2. 估算 token（1 token ≈ 4 字符）
    result = {}
    estimated_tokens = 0
    
    for section_name, content in sorted_sections:
        section_text = '\n'.join(content)
        section_tokens = len(section_text) // 4
        
        # 3. 检查是否超限
        if estimated_tokens + section_tokens > max_tokens:
            # 部分截断
            remaining_tokens = max_tokens - estimated_tokens
            truncated_text = section_text[:remaining_tokens * 4]
            result[section_name] = [truncated_text + '\n...[已截断]']
            break
        
        result[section_name] = content
        estimated_tokens += section_tokens
    
    return result
```

**效果**:
```
输入: 10,000 tokens PRD
输出: 3,000 tokens（保留核心内容）

节省 token: 70%
```

#### 策略 1.3: 冗余内容过滤

**原理**: 删除对 spec 生成无用的内容

**过滤规则**:
```python
# 1. 技术细节章节
skip_sections = [
    '技术架构', '实现方案', '数据库设计', '接口文档',
    'technical architecture', 'implementation', 'database design', 'api spec'
]

# 2. 附录和参考
skip_sections += [
    '附录', '参考资料', '历史记录', '会议纪要',
    'appendix', 'reference', 'history', 'meeting notes'
]

# 3. 冗余格式
def remove_redundant_formatting(text: str) -> str:
    # 删除多余空行
    text = re.sub(r'\n{3,}', '\n\n', text)
    
    # 删除装饰线
    text = re.sub(r'^[=\-*]{3,}$', '', text, flags=re.MULTILINE)
    
    # 删除 HTML 注释
    text = re.sub(r'<!--.*?-->', '', text, flags=re.DOTALL)
    
    return text
```

**效果**:
```
节省 token: 10-20%（取决于文档质量）
```

---

### 级别 2: AI 处理阶段

在 AI 分析时优化提示词和处理流程。

#### 策略 2.1: 分步处理

**原理**: 不要一次性处理所有内容，分阶段处理

**流程**:
```
第 1 步: 提取概述和用户故事（消耗 1,000 tokens）
第 2 步: 提取功能需求（消耗 800 tokens）
第 3 步: 补充边界情况和指标（消耗 500 tokens）
第 4 步: 生成完整 spec（消耗 300 tokens）

总计: 2,600 tokens（比一次性处理节省 40%）
```

**实现**:
```python
# 不好的做法
full_prd_text = read_entire_prd()
spec = ai.analyze(full_prd_text)  # 10,000 tokens

# 好的做法
summary = ai.extract_summary(parsed_data['sections']['概述'])  # 500 tokens
stories = ai.extract_stories(parsed_data['sections']['用户故事'])  # 800 tokens
requirements = ai.classify_requirements(parsed_data['sections']['需求'])  # 600 tokens
spec = ai.generate_spec(summary, stories, requirements)  # 700 tokens
# 总计: 2,600 tokens
```

#### 策略 2.2: 精简提示词

**原理**: 提示词也消耗 token

**优化前**:
```
请仔细阅读以下 PRD 文档，理解用户需求，提取用户故事，
识别功能需求并分类为 MUST/SHOULD/MAY，补充验收标准，
推导边界情况，设定成功指标，最后生成符合 spec-template.md
格式的完整规范文档。

[完整 PRD 文档...]
```
消耗: 100 tokens（提示词）+ 10,000 tokens（PRD）= 10,100 tokens

**优化后**:
```
基于以下结构化数据生成 spec：

概述: [...]
用户故事: [...]
功能需求: [...]

按 spec-template.md 格式输出。
```
消耗: 30 tokens（提示词）+ 2,500 tokens（数据）= 2,530 tokens

**节省**: 75%

#### 策略 2.3: 使用结构化输出

**原理**: JSON 比自然语言更紧凑

**对比**:

**自然语言**（消耗 ~500 tokens）:
```
用户故事 1: 邮箱登录
场景: 作为已注册用户，我想要使用邮箱和密码登录，以便快速访问我的账户
优先级: P1
MVP: 是
验收标准:
- 当输入正确的邮箱和密码时，成功登录并跳转到首页
- 当输入错误的密码时，显示"密码错误"提示
```

**JSON 格式**（消耗 ~200 tokens）:
```json
{
  "title": "邮箱登录",
  "role": "已注册用户",
  "action": "使用邮箱和密码登录",
  "benefit": "快速访问账户",
  "priority": "P1",
  "mvp": true,
  "acceptance": [
    "输入正确凭据时成功登录并跳转首页",
    "输入错误密码时显示错误提示"
  ]
}
```

**节省**: 60%

---

### 级别 3: 输出阶段

生成 spec 文档时优化。

#### 策略 3.1: 增量生成

**原理**: 分章节生成，避免一次性输出过长

**实现**:
```python
# 不好的做法
spec_content = generate_full_spec()  # 一次性生成 5,000 tokens

# 好的做法
sections = []
sections.append(generate_header())  # 100 tokens
sections.append(generate_overview())  # 200 tokens
sections.append(generate_user_stories())  # 1,500 tokens
sections.append(generate_requirements())  # 800 tokens
sections.append(generate_metrics())  # 400 tokens

spec_content = '\n\n---\n\n'.join(sections)  # 总计 3,000 tokens
```

#### 策略 3.2: 模板复用

**原理**: 使用固定模板结构，只填充变量

**模板**（token 固定）:
```markdown
# 功能规范: {{title}}

**分支**: `{{branch}}` | **日期**: {{date}} | **状态**: 草稿

## 概述

{{overview}}

---

## 用户故事

{{user_stories}}

---

## 功能需求

**必须 (MUST)**:
{{must_requirements}}

**应该 (SHOULD)**:
{{should_requirements}}

**可选 (MAY)**:
{{may_requirements}}
```

**效果**:
- 模板: 100 tokens（固定）
- 变量: 2,000 tokens（可变）
- 总计: 2,100 tokens

vs. 自由生成: 3,500 tokens

**节省**: 40%

---

## 实战案例

### 案例 1: 处理 30 页 PRD

**原始方案**:
```
1. 读取完整 PRD: 20,000 tokens
2. AI 分析: 2,000 tokens（输出）
3. 生成 spec: 3,000 tokens（输出）

总计: 25,000 tokens
成本: 高，可能超出限制
```

**优化方案**:
```
1. parse-document.py 解析: 0 tokens（本地运行）
2. 优先级排序和截断: 提取 3,000 tokens 关键内容
3. AI 分步处理:
   - 提取概述: 500 tokens
   - 提取用户故事: 800 tokens
   - 分类需求: 600 tokens
   - 补充边界情况: 400 tokens
4. 模板生成 spec: 700 tokens（输出）

总计: 3,000 tokens（输入）+ 700 tokens（输出）= 3,700 tokens
成本: 降低 85%
```

### 案例 2: 批量处理多个 PRD

**场景**: 10 个 PRD 文档需要转换为 spec

**原始方案**:
```
10 × 25,000 tokens = 250,000 tokens
时间: 很长（可能超时）
```

**优化方案**:
```
1. 批量解析（本地）: 0 tokens
2. 提取共性模式: 2,000 tokens（一次性）
3. 每个 PRD: 3,700 tokens

总计: 2,000 + (10 × 3,700) = 39,000 tokens
成本: 降低 84%
```

---

## Token 估算工具

### 字符数到 Token 转换

**经验公式**:
```
英文: 1 token ≈ 4 字符
中文: 1 token ≈ 1.5 字符（中文 token 化效率更高）
混合: 1 token ≈ 2-3 字符
```

### 快速估算方法

```python
def estimate_tokens(text: str) -> int:
    """
    估算文本 token 数
    """
    # 统计中文和英文字符
    chinese_chars = len(re.findall(r'[\u4e00-\u9fff]', text))
    english_chars = len(text) - chinese_chars
    
    # 分别估算
    chinese_tokens = chinese_chars / 1.5
    english_tokens = english_chars / 4
    
    return int(chinese_tokens + english_tokens)

# 示例
text = "为用户提供邮箱登录功能 User email login feature"
tokens = estimate_tokens(text)  # 约 15 tokens
```

---

## 优化效果对比

### 不同优化级别的效果

| 优化级别 | Token 使用 | 节省比例 | 适用场景 |
|---------|-----------|---------|---------|
| **无优化** | 20,000 | 0% | 不推荐 |
| **级别 1** | 12,000 | 40% | 中型 PRD |
| **级别 2** | 5,000 | 75% | 大型 PRD |
| **级别 3** | 3,000 | 85% | 超大型 PRD |

### ROI 分析

```
假设 API 成本: $0.01 / 1K tokens

不优化:
- Token 使用: 20,000
- 成本: $0.20

完全优化:
- Token 使用: 3,000
- 成本: $0.03
- 节省: $0.17（85%）

批量处理 100 个 PRD:
- 节省成本: $17
- 节省时间: 显著（避免超时）
```

---

## 最佳实践总结

### ✅ 推荐做法

1. **始终使用 parse-document.py**
   - 本地解析，不消耗 token
   - 智能截断，只提取关键内容

2. **设置合理的 token 限制**
   ```bash
   # 简单功能
   python parse-document.py prd.md --max-tokens 1500
   
   # 中等复杂
   python parse-document.py prd.md --max-tokens 2500
   
   # 复杂系统
   python parse-document.py prd.md --max-tokens 3500
   ```

3. **分步处理，不要一次性**
   - 先提取概述和用户故事
   - 再处理功能需求
   - 最后补充边界情况

4. **使用结构化数据**
   - JSON 格式优于自然语言
   - 模板化输出节省 token

### ❌ 避免做法

1. **直接读取大型 PRD**
   ```python
   # 错误
   with open('huge_prd.pdf', 'r') as f:
       ai.analyze(f.read())  # 可能 50,000+ tokens
   ```

2. **冗长的提示词**
   ```python
   # 错误
   prompt = """
   请你非常仔细地阅读以下文档...（500 字提示词）
   """
   ```

3. **重复处理相同内容**
   ```python
   # 错误
   ai.extract_stories(full_prd)  # 10,000 tokens
   ai.extract_requirements(full_prd)  # 又 10,000 tokens
   ```

---

## 监控和调试

### Token 使用日志

```python
import logging

def log_token_usage(operation: str, tokens: int):
    """记录 token 使用情况"""
    logging.info(f"{operation}: {tokens} tokens")
    
    # 累计统计
    total_tokens = get_session_total()
    logging.info(f"Session total: {total_tokens} tokens")
    
    # 成本估算
    cost = total_tokens * 0.00001  # $0.01 / 1K
    logging.info(f"Estimated cost: ${cost:.4f}")

# 使用
log_token_usage("Parse PRD", 3000)
log_token_usage("Generate Spec", 700)
```

### 优化建议输出

```python
def analyze_and_suggest(estimated_tokens: int):
    """根据 token 使用给出优化建议"""
    if estimated_tokens > 10000:
        print("⚠️ Token 使用过高，建议:")
        print("1. 降低 --max-tokens 限制")
        print("2. 使用分步处理")
        print("3. 检查是否包含冗余章节")
    elif estimated_tokens > 5000:
        print("⚠️ Token 使用偏高，可以:")
        print("1. 进一步截断低优先级内容")
        print("2. 使用结构化输出")
    else:
        print("✅ Token 使用合理")
```

---

## 未来优化方向

1. **智能分块**: 自动将超大 PRD 分成多个子 spec
2. **缓存机制**: 相似 PRD 复用解析结果
3. **增量更新**: 只处理变更部分
4. **压缩算法**: 更高效的内容压缩

---

## 总结

**核心原则**:
1. **预处理优先**: 在 AI 调用前尽可能减少内容
2. **分步处理**: 不要一次性处理所有内容
3. **结构化优于自然语言**: JSON > Markdown > 纯文本
4. **监控和优化**: 持续跟踪 token 使用，不断改进

**效果**:
- Token 使用减少 70-85%
- 处理速度提升 3-5 倍
- 成本降低 80%+

**投资回报**:
- 初期投入: 开发解析脚本（已完成）
- 长期收益: 每次转换节省 $0.15-0.20
- 批量处理: 节省显著（100 个 PRD 节省 $15-20）
