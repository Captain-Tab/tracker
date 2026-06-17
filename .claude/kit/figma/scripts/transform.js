/**
 * Figma 数值到 Tailwind 转换脚本
 * 职责：颜色、间距、字体、阴影等值的映射
 * 
 * 支持两种数据格式：
 * 1. Framelink MCP 格式（推荐）- globalVars.styles 引用
 * 2. Figma API 原始格式 - 直接数值
 *
 * ⚠️ 注意：映射规则应从 ../references/specification.md 读取
 * 此处的配置仅作为参考实现或脚本独立运行时的默认值
 */

// 颜色映射（参考实现）
const colorMap = {
  '#000000': 'black',
  '#ffffff': 'white',
  '#f5f5f5': 'gray-100',
  '#e5e5e5': 'gray-200',
  '#d4d4d4': 'gray-300',
  '#a3a3a3': 'gray-400',
  '#737373': 'gray-500',
  '#525252': 'gray-600',
  '#404040': 'gray-700',
  '#262626': 'gray-800',
  '#171717': 'gray-900',
};

// 间距映射（参考实现）
const spacingMap = {
  0: '0', 1: '0.5', 2: '0.5', 4: '1', 6: '1.5', 8: '2', 10: '2.5',
  12: '3', 14: '3.5', 16: '4', 20: '5', 24: '6', 28: '7', 32: '8',
  36: '9', 40: '10', 44: '11', 48: '12', 56: '14', 64: '16', 72: '18',
  80: '20', 96: '24',
};

// 字号映射
const fontSizeMap = {
  10: 'xs', 12: 'xs', 13: 'sm', 14: 'sm', 15: 'base', 16: 'base',
  18: 'lg', 20: 'xl', 24: '2xl', 28: '3xl', 30: '3xl', 32: '3xl',
  36: '4xl', 40: '4xl', 48: '5xl', 60: '6xl',
};

// 字重映射
const fontWeightMap = {
  100: 'thin', 200: 'extralight', 300: 'light', 400: 'normal',
  500: 'medium', 600: 'semibold', 700: 'bold', 800: 'extrabold', 900: 'black',
};

// 圆角映射
const radiusMap = {
  0: 'rounded-none', 2: 'rounded-sm', 4: 'rounded', 6: 'rounded-md',
  8: 'rounded-lg', 12: 'rounded-xl', 16: 'rounded-2xl', 24: 'rounded-3xl',
  9999: 'rounded-full',
};

/**
 * 计算颜色距离（欧式距离）
 */
function colorDistance(hex1, hex2) {
  const r1 = parseInt(hex1.slice(1, 3), 16);
  const g1 = parseInt(hex1.slice(3, 5), 16);
  const b1 = parseInt(hex1.slice(5, 7), 16);
  const r2 = parseInt(hex2.slice(1, 3), 16);
  const g2 = parseInt(hex2.slice(3, 5), 16);
  const b2 = parseInt(hex2.slice(5, 7), 16);
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
}

/**
 * 转换颜色（三层策略）
 * 1. 精确匹配
 * 2. 近似匹配（阈值内）
 * 3. 任意值回退
 */
function transformColor(value, threshold = 30) {
  if (!value) return null;
  
  // 标准化为 hex
  let hex = value;
  if (typeof value === 'object' && value.r !== undefined) {
    hex = rgbaToHex(value);
  }
  hex = hex.toLowerCase();
  
  // 1. 精确匹配
  if (colorMap[hex]) {
    return colorMap[hex];
  }
  
  // 2. 近似匹配
  let closest = null;
  let minDist = Infinity;
  for (const [mapHex, tw] of Object.entries(colorMap)) {
    const dist = colorDistance(hex, mapHex);
    if (dist < minDist) {
      minDist = dist;
      closest = tw;
    }
  }
  if (minDist < threshold) {
    return closest;
  }
  
  // 3. 任意值回退
  return `[${hex}]`;
}

/**
 * RGBA 对象转 hex
 */
function rgbaToHex(rgba) {
  const r = Math.round(rgba.r * 255);
  const g = Math.round(rgba.g * 255);
  const b = Math.round(rgba.b * 255);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

/**
 * 转换间距
 */
function transformSpacing(px) {
  if (px == null) return null;
  const num = typeof px === 'string' ? parseInt(px) : px;
  
  // 精确匹配
  if (spacingMap[num] !== undefined) {
    return spacingMap[num];
  }
  
  // 近似匹配（±2px）
  for (const [key, val] of Object.entries(spacingMap)) {
    if (Math.abs(parseInt(key) - num) <= 2) {
      return val;
    }
  }
  
  // 任意值回退
  return `[${num}px]`;
}

/**
 * 转换字号
 */
function transformFontSize(px) {
  if (px == null) return null;
  const num = typeof px === 'string' ? parseInt(px) : px;
  
  // 精确匹配
  if (fontSizeMap[num]) {
    return fontSizeMap[num];
  }
  
  // 近似匹配
  for (const [key, val] of Object.entries(fontSizeMap)) {
    if (Math.abs(parseInt(key) - num) <= 1) {
      return val;
    }
  }
  
  // 任意值回退
  return `[${num}px]`;
}

/**
 * 转换字重
 */
function transformFontWeight(weight) {
  if (weight == null) return null;
  const num = typeof weight === 'string' ? parseInt(weight) : weight;
  
  return fontWeightMap[num] || `[${num}]`;
}

/**
 * 转换圆角
 */
function transformRadius(px) {
  if (px == null) return null;
  const num = typeof px === 'string' ? parseInt(px) : px;
  
  // 精确匹配
  if (radiusMap[num]) {
    return radiusMap[num];
  }
  
  // 近似匹配
  for (const [key, val] of Object.entries(radiusMap)) {
    if (Math.abs(parseInt(key) - num) <= 2) {
      return val;
    }
  }
  
  // 任意值回退
  return `rounded-[${num}px]`;
}

/**
 * 解析 Framelink 样式引用
 * @param {string} styleRef - 样式引用键
 * @param {object} globalStyles - globalVars.styles
 */
function resolveFramelinkStyle(styleRef, globalStyles) {
  if (!styleRef || !globalStyles) return null;
  return globalStyles[styleRef] || null;
}

/**
 * 从 Framelink 格式节点提取并转换样式
 * @param {object} node - 节点
 * @param {object} globalVars - Framelink globalVars
 */
function transformFramelinkNode(node, globalVars) {
  const styles = globalVars?.styles || {};
  const classes = [];
  
  // 处理填充色
  if (node.fills) {
    const fill = resolveFramelinkStyle(node.fills, styles);
    if (fill && Array.isArray(fill) && fill[0]) {
      const color = transformColor(fill[0]);
      if (color) classes.push(`bg-${color}`);
    }
  }
  
  // 处理文本颜色
  if (node.type === 'TEXT' && node.fills) {
    const fill = resolveFramelinkStyle(node.fills, styles);
    if (fill && Array.isArray(fill) && fill[0]) {
      const color = transformColor(fill[0]);
      if (color) classes.push(`text-${color}`);
    }
  }
  
  // 处理边框
  if (node.strokes) {
    const stroke = resolveFramelinkStyle(node.strokes, styles);
    if (stroke && Array.isArray(stroke) && stroke[0]) {
      const color = transformColor(stroke[0]);
      if (color) classes.push(`border border-${color}`);
    }
  }
  
  // 处理布局
  if (node.layout) {
    const layout = resolveFramelinkStyle(node.layout, styles);
    if (layout) {
      if (layout.mode === 'row') classes.push('flex flex-row');
      else if (layout.mode === 'column') classes.push('flex flex-col');
      
      if (layout.gap) {
        const gap = transformSpacing(parseInt(layout.gap));
        if (gap) classes.push(`gap-${gap}`);
      }
      
      // 对齐
      if (layout.alignItems) {
        const alignMap = {
          'flex-start': 'items-start',
          'center': 'items-center',
          'flex-end': 'items-end',
          'stretch': 'items-stretch',
        };
        if (alignMap[layout.alignItems]) classes.push(alignMap[layout.alignItems]);
      }
      
      if (layout.justifyContent) {
        const justifyMap = {
          'flex-start': 'justify-start',
          'center': 'justify-center',
          'flex-end': 'justify-end',
          'space-between': 'justify-between',
          'space-around': 'justify-around',
          'space-evenly': 'justify-evenly',
        };
        if (justifyMap[layout.justifyContent]) classes.push(justifyMap[layout.justifyContent]);
      }
    }
  }
  
  // 处理尺寸
  if (node.size) {
    const size = resolveFramelinkStyle(node.size, styles);
    if (size) {
      if (size.width) {
        const w = transformSpacing(parseInt(size.width));
        if (w) classes.push(`w-${w}`);
      }
      if (size.height) {
        const h = transformSpacing(parseInt(size.height));
        if (h) classes.push(`h-${h}`);
      }
    }
  }
  
  // 处理圆角
  if (node.cornerRadius != null) {
    const radius = transformRadius(node.cornerRadius);
    if (radius) classes.push(radius);
  }
  
  // 处理文本样式
  if (node.type === 'TEXT') {
    if (node.fontSize) {
      const size = transformFontSize(node.fontSize);
      if (size) classes.push(`text-${size}`);
    }
    if (node.fontWeight) {
      const weight = transformFontWeight(node.fontWeight);
      if (weight) classes.push(`font-${weight}`);
    }
  }
  
  return classes.join(' ');
}

/**
 * 转换整棵树
 * @param {object} data - Framelink 返回的完整数据或单个节点
 */
function transformTree(data) {
  // 判断是 Framelink 格式还是原始格式
  const isFramelinkFormat = !!(data.nodes && data.globalVars);
  
  const rootNode = isFramelinkFormat ? data.nodes[0] : data;
  const globalVars = isFramelinkFormat ? data.globalVars : null;
  
  const results = [];
  
  function walk(node) {
    const classes = isFramelinkFormat 
      ? transformFramelinkNode(node, globalVars)
      : transformLegacyNode(node);
    
    results.push({
      id: node.id,
      name: node.name,
      type: node.type,
      classes,
    });
    
    node.children?.forEach(walk);
  }
  
  walk(rootNode);
  return {
    format: isFramelinkFormat ? 'framelink' : 'figma-api',
    nodes: results,
  };
}

/**
 * 转换旧格式节点（Figma API 原始格式）
 */
function transformLegacyNode(node) {
  const classes = [];
  
  // 处理填充
  if (node.fills?.length && node.fills[0]?.color) {
    const color = transformColor(node.fills[0].color);
    if (color) classes.push(`bg-${color}`);
  }
  
  // 处理布局
  if (node.layoutMode === 'HORIZONTAL') classes.push('flex flex-row');
  if (node.layoutMode === 'VERTICAL') classes.push('flex flex-col');
  
  if (node.itemSpacing) {
    const gap = transformSpacing(node.itemSpacing);
    if (gap) classes.push(`gap-${gap}`);
  }
  
  // 处理圆角
  if (node.cornerRadius) {
    const radius = transformRadius(node.cornerRadius);
    if (radius) classes.push(radius);
  }
  
  return classes.join(' ');
}

module.exports = {
  colorDistance,
  transformColor,
  transformSpacing,
  transformFontSize,
  transformFontWeight,
  transformRadius,
  resolveFramelinkStyle,
  transformFramelinkNode,
  transformTree,
};

// CLI 入口
if (require.main === module) {
  const fs = require('fs');
  const input = process.argv[2];
  if (!input) {
    console.error('用法: node transform.js <figma-data.json>');
    console.error('支持 Framelink MCP 格式和 Figma API 原始格式');
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(input, 'utf-8'));
  const result = transformTree(data);
  console.log(JSON.stringify(result, null, 2));
}
