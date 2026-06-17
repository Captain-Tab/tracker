/**
 * Figma 结构分析脚本
 * 职责：计算复杂度、匹配组件、识别图标、分析布局
 * 
 * 支持两种数据格式：
 * 1. Framelink MCP 格式（推荐）- globalVars.styles 引用
 * 2. Figma API 原始格式 - 直接属性值
 *
 * ⚠️ 注意：组件和图标匹配规则应从 ../references/components.md 读取
 * 此处的配置仅作为参考实现或脚本独立运行时的默认值
 */

// 组件匹配规则（参考实现 - 实际使用时从 components.md 读取）
const componentPatterns = [
  { pattern: /btn|button/i, component: 'Button' },
  { pattern: /card/i, component: 'Card' },
  { pattern: /input|field/i, component: 'Input' },
  { pattern: /nav|menu/i, component: 'Nav' },
  { pattern: /modal|dialog/i, component: 'Modal' },
  { pattern: /avatar/i, component: 'Avatar' },
  { pattern: /badge|tag/i, component: 'Badge' },
];

/**
 * 匹配组件
 */
function matchComponent(name) {
  for (const { pattern, component } of componentPatterns) {
    if (pattern.test(name)) return component;
  }
  return null;
}

// 图标匹配规则（@phosphor-icons/react）
const iconPatterns = {
  'arrow-right': 'ArrowRight',
  'arrow-left': 'ArrowLeft',
  'chevron-right': 'CaretRight',
  'chevron-left': 'CaretLeft',
  'chevron-down': 'CaretDown',
  'chevron-up': 'CaretUp',
  'close': 'X',
  'x': 'X',
  'search': 'MagnifyingGlass',
  'menu': 'List',
  'hamburger': 'List',
  'plus': 'Plus',
  'add': 'Plus',
  'minus': 'Minus',
  'check': 'Check',
  'user': 'User',
  'settings': 'Gear',
  'gear': 'Gear',
  'home': 'House',
  'mail': 'Envelope',
  'email': 'Envelope',
  'phone': 'Phone',
  'calendar': 'Calendar',
  'clock': 'Clock',
  'time': 'Clock',
  'trash': 'Trash',
  'delete': 'Trash',
  'edit': 'Pencil',
  'pencil': 'Pencil',
  'eye': 'Eye',
  'eye-off': 'EyeSlash',
};

/**
 * 匹配图标
 */
function matchIcon(name) {
  const lower = name.toLowerCase();
  for (const [key, icon] of Object.entries(iconPatterns)) {
    if (lower.includes(key)) return icon;
  }
  return null;
}

/**
 * 判断是否为图标节点
 */
function isIconNode(node) {
  if (node.type === 'VECTOR' || node.type === 'BOOLEAN_OPERATION') return true;
  if (/icon|ico/i.test(node.name)) return true;
  return false;
}

/**
 * 判断是否为图片节点
 */
function isImageNode(node) {
  if (node.type === 'IMAGE') return true;
  if (node.imageRef) return true;
  if (/image|photo|img|logo/i.test(node.name)) return true;
  return false;
}

/**
 * 解析 Framelink 格式的布局数据
 * @param {object} node - 节点
 * @param {object} globalVars - globalVars.styles
 */
function parseFramelinkLayout(node, globalVars) {
  if (!node.layout || !globalVars?.styles) return null;
  
  const layoutKey = node.layout;
  const layoutStyle = globalVars.styles[layoutKey];
  
  if (!layoutStyle) return null;
  
  return {
    layoutMode: layoutStyle.mode === 'row' ? 'HORIZONTAL' : 
                layoutStyle.mode === 'column' ? 'VERTICAL' : null,
    alignItems: layoutStyle.alignItems,
    justifyContent: layoutStyle.justifyContent,
    gap: layoutStyle.gap ? parseInt(layoutStyle.gap) : null,
  };
}

/**
 * 计算最大深度
 */
function getMaxDepth(node, depth = 0) {
  if (!node.children?.length) return depth;
  return Math.max(...node.children.map(c => getMaxDepth(c, depth + 1)));
}

/**
 * 计算子节点数量
 */
function countChildren(node) {
  if (!node.children) return 0;
  return node.children.reduce((sum, c) => sum + 1 + countChildren(c), 0);
}

/**
 * 计算复杂度
 * @param {object} node - 节点
 * @param {object} globalVars - Framelink globalVars（可选）
 */
function calculateComplexity(node, globalVars = null) {
  let score = 0;
  
  const depth = getMaxDepth(node);
  if (depth > 5) score += 30;
  else if (depth > 3) score += 15;
  
  const count = countChildren(node);
  if (count > 20) score += 25;
  else if (count > 10) score += 10;
  
  // 检查是否有 Auto Layout（支持两种格式）
  const layout = globalVars ? parseFramelinkLayout(node, globalVars) : null;
  const hasAutoLayout = layout?.layoutMode || node.layoutMode;
  if (!hasAutoLayout) score += 20;
  
  let level = 'simple';
  if (score >= 60) level = 'complex';
  else if (score >= 30) level = 'medium';
  
  return { score, level };
}

/**
 * 分析节点（支持 Framelink 格式）
 * @param {object} node - 节点
 * @param {object} globalVars - Framelink globalVars（可选）
 */
function analyzeNode(node, globalVars = null) {
  const layout = globalVars ? parseFramelinkLayout(node, globalVars) : null;
  
  return {
    id: node.id,
    name: node.name,
    type: node.type,
    component: matchComponent(node.name),
    isIcon: isIconNode(node),
    isImage: isImageNode(node),
    icon: matchIcon(node.name),
    hasAutoLayout: !!(layout?.layoutMode || node.layoutMode),
    layoutDirection: layout?.layoutMode || node.layoutMode || null,
    gap: layout?.gap || node.itemSpacing || null,
    text: node.text || node.characters || null,
  };
}

/**
 * 分析整棵树（支持 Framelink 格式）
 * @param {object} data - Framelink 返回的完整数据或单个节点
 */
function analyzeTree(data) {
  // 判断是 Framelink 格式还是原始格式
  const isFramelinkFormat = !!(data.nodes && data.globalVars);
  
  const rootNode = isFramelinkFormat ? data.nodes[0] : data;
  const globalVars = isFramelinkFormat ? data.globalVars : null;
  
  const result = {
    format: isFramelinkFormat ? 'framelink' : 'figma-api',
    root: analyzeNode(rootNode, globalVars),
    complexity: calculateComplexity(rootNode, globalVars),
    stats: {
      totalNodes: countChildren(rootNode) + 1,
      maxDepth: getMaxDepth(rootNode),
      textNodes: 0,
      imageNodes: 0,
    },
    components: [],
    icons: [],
    images: [],
  };

  function collect(n) {
    // 组件匹配
    const comp = matchComponent(n.name);
    if (comp && !result.components.includes(comp)) {
      result.components.push(comp);
    }
    
    // 图标匹配
    if (isIconNode(n)) {
      const icon = matchIcon(n.name);
      if (icon && !result.icons.includes(icon)) {
        result.icons.push(icon);
      }
    }
    
    // 图片识别
    if (isImageNode(n)) {
      result.images.push({ id: n.id, name: n.name });
      result.stats.imageNodes++;
    }
    
    // 文本统计
    if (n.type === 'TEXT') {
      result.stats.textNodes++;
    }
    
    // 递归处理子节点
    n.children?.forEach(collect);
  }
  
  collect(rootNode);
  return result;
}

/**
 * 生成结构树字符串
 * @param {object} node - 节点
 * @param {object} globalVars - Framelink globalVars
 * @param {string} prefix - 缩进前缀
 * @param {boolean} isLast - 是否是最后一个节点
 */
function generateStructureTree(node, globalVars = null, prefix = '', isLast = true) {
  const connector = isLast ? '└── ' : '├── ';
  const childPrefix = prefix + (isLast ? '    ' : '│   ');
  
  // 构建节点描述
  let desc = `${node.name} (${node.type})`;
  
  if (node.text) {
    desc += ` - "${node.text}"`;
  }
  
  // 获取颜色（Framelink 格式）
  if (node.fills && globalVars?.styles) {
    const fillStyle = globalVars.styles[node.fills];
    if (fillStyle && Array.isArray(fillStyle)) {
      desc += ` ${fillStyle[0]}`;
    }
  }
  
  // 标记特殊节点
  if (isImageNode(node)) desc += ' - 需导出';
  if (matchComponent(node.name)) desc += ` - 可匹配 ${matchComponent(node.name)} 组件`;
  
  let tree = prefix + connector + desc + '\n';
  
  // 递归处理子节点
  if (node.children?.length) {
    node.children.forEach((child, index) => {
      const childIsLast = index === node.children.length - 1;
      tree += generateStructureTree(child, globalVars, childPrefix, childIsLast);
    });
  }
  
  return tree;
}

module.exports = {
  matchComponent,
  matchIcon,
  isIconNode,
  isImageNode,
  parseFramelinkLayout,
  calculateComplexity,
  analyzeNode,
  analyzeTree,
  generateStructureTree,
};

// CLI 入口
if (require.main === module) {
  const fs = require('fs');
  const input = process.argv[2];
  if (!input) {
    console.error('用法: node analyze.js <figma-data.json>');
    console.error('支持 Framelink MCP 格式和 Figma API 原始格式');
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(input, 'utf-8'));
  const result = analyzeTree(data);
  console.log(JSON.stringify(result, null, 2));
  
  // 输出结构树
  if (data.nodes && data.globalVars) {
    console.log('\n--- 结构树 ---\n');
    console.log(generateStructureTree(data.nodes[0], data.globalVars, '', true));
  }
}
