#!/usr/bin/env python3
"""
文档解析脚本 - 支持 PDF、Word、Markdown 格式
功能：提取文档内容并输出为结构化文本
优化：减少 token 使用，只保留关键信息
"""

import sys
import os
import json
import re
from pathlib import Path
from typing import Dict, List, Optional

def extract_markdown(file_path: str) -> Dict:
    """提取 Markdown 文档内容"""
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # 提取标题结构
    sections = {}
    current_section = "前言"
    sections[current_section] = []
    
    for line in content.split('\n'):
        # 检测标题
        if line.startswith('#'):
            current_section = line.lstrip('#').strip()
            sections[current_section] = []
        else:
            if line.strip():
                sections[current_section].append(line.strip())
    
    return {
        'type': 'markdown',
        'file': os.path.basename(file_path),
        'sections': sections,
        'raw_content': content[:2000]  # 只保留前 2000 字符作为备用
    }

def extract_pdf(file_path: str) -> Dict:
    """提取 PDF 文档内容"""
    try:
        import pypdf
        
        sections = {}
        current_section = "内容"
        sections[current_section] = []
        
        with open(file_path, 'rb') as f:
            reader = pypdf.PdfReader(f)
            full_text = []
            
            for page_num, page in enumerate(reader.pages, 1):
                text = page.extract_text()
                if text.strip():
                    full_text.append(f"--- 第 {page_num} 页 ---")
                    full_text.append(text.strip())
            
            # 简单分段：按空行分割
            content = '\n'.join(full_text)
            paragraphs = [p.strip() for p in content.split('\n\n') if p.strip()]
            sections[current_section] = paragraphs[:50]  # 最多保留 50 段
        
        return {
            'type': 'pdf',
            'file': os.path.basename(file_path),
            'page_count': len(reader.pages),
            'sections': sections,
            'summary': '已提取 PDF 文档前 50 段内容'
        }
    
    except ImportError:
        return {
            'type': 'pdf',
            'file': os.path.basename(file_path),
            'error': 'pypdf 未安装，请运行: pip install pypdf',
            'fallback': 'PDF 解析需要安装依赖'
        }

def extract_word(file_path: str) -> Dict:
    """提取 Word 文档内容"""
    try:
        from docx import Document
        
        doc = Document(file_path)
        sections = {}
        current_section = "内容"
        sections[current_section] = []
        
        # 提取段落
        for para in doc.paragraphs:
            text = para.text.strip()
            if not text:
                continue
            
            # 检测标题样式
            if para.style.name.startswith('Heading'):
                current_section = text
                sections[current_section] = []
            else:
                sections[current_section].append(text)
        
        # 限制内容长度
        for section in sections:
            sections[section] = sections[section][:30]  # 每个章节最多 30 段
        
        return {
            'type': 'word',
            'file': os.path.basename(file_path),
            'paragraph_count': len(doc.paragraphs),
            'sections': sections,
            'summary': f'已提取 {len(sections)} 个章节'
        }
    
    except ImportError:
        return {
            'type': 'word',
            'file': os.path.basename(file_path),
            'error': 'python-docx 未安装，请运行: pip install python-docx',
            'fallback': 'Word 解析需要安装依赖'
        }

def smart_truncate(sections: Dict[str, List[str]], max_tokens: int = 3000) -> Dict[str, List[str]]:
    """
    智能截断：保留关键信息，减少 token 使用
    优先保留：问题描述、解决方案、需求列表、验收标准
    """
    priority_keywords = [
        '问题', '背景', '目标', '需求', '功能', '解决方案',
        '用户故事', '验收', '标准', '成功', '指标',
        'problem', 'background', 'goal', 'requirement', 'feature',
        'solution', 'user story', 'acceptance', 'criteria', 'success'
    ]
    
    # 优先级排序
    sorted_sections = []
    for section_name, content in sections.items():
        priority = 0
        section_lower = section_name.lower()
        
        # 计算优先级
        for keyword in priority_keywords:
            if keyword in section_lower:
                priority += 10
        
        # 检查内容中的关键词
        content_text = ' '.join(content).lower()
        for keyword in priority_keywords:
            if keyword in content_text:
                priority += 1
        
        sorted_sections.append((priority, section_name, content))
    
    sorted_sections.sort(reverse=True, key=lambda x: x[0])
    
    # 估算 token（约 1 token = 4 字符）
    result = {}
    estimated_tokens = 0
    
    for priority, section_name, content in sorted_sections:
        section_text = '\n'.join(content)
        section_tokens = len(section_text) // 4
        
        if estimated_tokens + section_tokens > max_tokens:
            # 截断内容
            remaining_tokens = max_tokens - estimated_tokens
            truncated_content = section_text[:remaining_tokens * 4]
            result[section_name] = [truncated_content + '\n...[内容已截断]']
            break
        
        result[section_name] = content
        estimated_tokens += section_tokens
    
    return result

def parse_document(file_path: str, max_tokens: int = 3000) -> Dict:
    """
    主解析函数：根据文件类型调用相应解析器
    """
    file_path = os.path.abspath(file_path)
    
    if not os.path.exists(file_path):
        return {
            'error': f'文件不存在: {file_path}',
            'success': False
        }
    
    ext = Path(file_path).suffix.lower()
    
    # 根据扩展名选择解析器
    if ext == '.md':
        result = extract_markdown(file_path)
    elif ext == '.pdf':
        result = extract_pdf(file_path)
    elif ext in ['.docx', '.doc']:
        result = extract_word(file_path)
    else:
        return {
            'error': f'不支持的文件格式: {ext}',
            'supported': ['.md', '.pdf', '.docx', '.doc'],
            'success': False
        }
    
    # 如果解析成功，应用智能截断
    if 'sections' in result and 'error' not in result:
        result['sections'] = smart_truncate(result['sections'], max_tokens)
        result['success'] = True
    else:
        result['success'] = False
    
    return result

def format_output(data: Dict, format_type: str = 'json') -> str:
    """
    格式化输出
    format_type: 'json' | 'text'
    """
    if format_type == 'json':
        return json.dumps(data, ensure_ascii=False, indent=2)
    
    # 文本格式输出
    output = []
    output.append(f"=== 文档解析结果 ===")
    output.append(f"文件: {data.get('file', 'unknown')}")
    output.append(f"类型: {data.get('type', 'unknown')}")
    output.append("")
    
    if 'error' in data:
        output.append(f"错误: {data['error']}")
        if 'fallback' in data:
            output.append(f"说明: {data['fallback']}")
        return '\n'.join(output)
    
    sections = data.get('sections', {})
    for section_name, content in sections.items():
        output.append(f"## {section_name}")
        output.append("")
        for line in content:
            output.append(line)
        output.append("")
    
    return '\n'.join(output)

def main():
    """命令行入口"""
    if len(sys.argv) < 2:
        print("用法: python parse-document.py <文件路径> [--format json|text] [--max-tokens 3000]")
        print("")
        print("支持格式: .md, .pdf, .docx, .doc")
        print("")
        print("示例:")
        print("  python parse-document.py prd.md")
        print("  python parse-document.py prd.pdf --format text")
        print("  python parse-document.py prd.docx --max-tokens 2000")
        sys.exit(1)
    
    file_path = sys.argv[1]
    format_type = 'json'
    max_tokens = 3000
    
    # 解析参数
    if '--format' in sys.argv:
        idx = sys.argv.index('--format')
        if idx + 1 < len(sys.argv):
            format_type = sys.argv[idx + 1]
    
    if '--max-tokens' in sys.argv:
        idx = sys.argv.index('--max-tokens')
        if idx + 1 < len(sys.argv):
            max_tokens = int(sys.argv[idx + 1])
    
    # 解析文档
    result = parse_document(file_path, max_tokens)
    
    # 输出结果
    print(format_output(result, format_type))
    
    # 返回退出码
    sys.exit(0 if result.get('success', False) else 1)

if __name__ == '__main__':
    main()
