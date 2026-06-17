#!/usr/bin/env node
/**
 * outline.js - TypeScript/TSX 文件符号骨架提取
 *
 * 优先使用项目内的 TypeScript Compiler API（精准 AST）
 * 找不到时自动降级到正则方案（零依赖）
 *
 * 用法: node outline.js <file-path> [project-root]
 */

const fs = require('fs')
const path = require('path')

const filePath = process.argv[2]
const projectRoot = process.argv[3] || process.cwd()

if (!filePath) {
  console.error('Usage: node outline.js <file-path> [project-root]')
  process.exit(1)
}

// 解析文件绝对路径
const absPath = path.isAbsolute(filePath)
  ? filePath
  : path.resolve(projectRoot, filePath)

if (!fs.existsSync(absPath)) {
  console.log(`⚠️  文件未找到: ${filePath}`)
  process.exit(0)
}

const content = fs.readFileSync(absPath, 'utf-8')
const lines = content.split('\n')
const totalLines = lines.length
const tokenEst = Math.ceil(content.length / 4)

// ─── 尝试加载 TypeScript Compiler API ───────────────────────────────────────

let ts = null
try {
  const tsPath = require.resolve('typescript', { paths: [projectRoot] })
  ts = require(tsPath)
} catch (_) {
  // 降级到正则方案
}

// ─── TS Compiler API 方案 ────────────────────────────────────────────────────

function extractWithTSCompiler() {
  const scriptTarget = ts.ScriptTarget.Latest
  const source = ts.createSourceFile(absPath, content, scriptTarget, true)

  const exported = []
  const internal = []

  function getLine(node) {
    return source.getLineAndCharacterOfPosition(node.getStart()).line + 1
  }

  function getEndLine(node) {
    return source.getLineAndCharacterOfPosition(node.getEnd()).line + 1
  }

  function isExported(node) {
    return (
      node.modifiers &&
      node.modifiers.some(
        m => m.kind === ts.SyntaxKind.ExportKeyword
      )
    )
  }

  function isAsync(node) {
    return (
      node.modifiers &&
      node.modifiers.some(m => m.kind === ts.SyntaxKind.AsyncKeyword)
    )
  }

  function isStatic(node) {
    return (
      node.modifiers &&
      node.modifiers.some(m => m.kind === ts.SyntaxKind.StaticKeyword)
    )
  }

  function isPrivate(node) {
    return (
      node.modifiers &&
      node.modifiers.some(m => m.kind === ts.SyntaxKind.PrivateKeyword)
    )
  }

  function getParamTypes(node) {
    if (!node.parameters) return ''
    const params = node.parameters.map(p => {
      const name = p.name.getText(source)
      const type = p.type ? ': ' + p.type.getText(source) : ''
      return name + type
    })
    return '(' + params.join(', ') + ')'
  }

  function getReturnType(node) {
    if (node.type) return ': ' + node.type.getText(source)
    return ''
  }

  // 提取 class 成员列表
  function extractClassMembers(classNode, target) {
    classNode.members.forEach(member => {
      const mLine = getLine(member)
      const mEnd = getEndLine(member)
      const mRange = mLine === mEnd ? `L${mLine}` : `L${mLine}-${mEnd}`
      const stat = isStatic(member) ? 'static ' : ''
      const priv = isPrivate(member) ? '(private) ' : ''

      if (ts.isConstructorDeclaration(member)) {
        const params = getParamTypes(member)
        target.push(`     ƒ constructor${params}  ${mRange}`)
      } else if (ts.isMethodDeclaration(member) && member.name) {
        const mName = member.name.getText(source)
        const async = isAsync(member) ? 'async ' : ''
        const params = getParamTypes(member)
        const ret = getReturnType(member)
        target.push(`     ƒ ${priv}${stat}${async}${mName}${params}${ret}  ${mRange}`)
      } else if (ts.isGetAccessorDeclaration(member) && member.name) {
        const mName = member.name.getText(source)
        const ret = getReturnType(member)
        target.push(`     ⊙ get ${priv}${stat}${mName}${ret}  ${mRange}`)
      } else if (ts.isSetAccessorDeclaration(member) && member.name) {
        const mName = member.name.getText(source)
        const params = getParamTypes(member)
        target.push(`     ⊙ set ${priv}${stat}${mName}${params}  ${mRange}`)
      } else if (ts.isPropertyDeclaration(member) && member.name) {
        const mName = member.name.getText(source)
        const init = member.initializer
        const isFn = init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))
        if (isFn) {
          const params = getParamTypes(init)
          const ret = getReturnType(init)
          target.push(`     ƒ ${priv}${stat}${mName}${params}${ret}  ${mRange}`)
        } else {
          const typeStr = member.type ? ': ' + member.type.getText(source).slice(0, 40) : ''
          target.push(`     ○ ${priv}${stat}${mName}${typeStr}  ${mRange}`)
        }
      }
    })
  }

  ts.forEachChild(source, node => {
    const lineStart = getLine(node)
    const lineEnd = getEndLine(node)
    const range = lineStart === lineEnd ? `L${lineStart}` : `L${lineStart}-${lineEnd}`
    const exp = isExported(node)

    // function declaration
    if (ts.isFunctionDeclaration(node) && node.name) {
      const name = node.name.getText(source)
      const asyncTag = isAsync(node) ? 'async ' : ''
      const params = getParamTypes(node)
      const ret = getReturnType(node)
      const sig = `${asyncTag}function ${name}${params}${ret}`
      const entry = `  ƒ ${name}${exp ? ' [exported]' : ''}  ${range}  ${sig}`
      exp ? exported.push(entry) : internal.push(entry)
      return
    }

    // class declaration — 深入提取成员
    if (ts.isClassDeclaration(node) && node.name) {
      const name = node.name.getText(source)
      const memberCount = node.members ? node.members.length : 0
      const entry = `  ◆ ${name}${exp ? ' [exported]' : ''}  ${range}  (${memberCount} members)`
      const target = exp ? exported : internal
      target.push(entry)
      extractClassMembers(node, target)
      return
    }

    // interface declaration
    if (ts.isInterfaceDeclaration(node)) {
      const name = node.name.getText(source)
      exported.push(`  ◇ ${name} [exported]  ${range}`)
      return
    }

    // type alias
    if (ts.isTypeAliasDeclaration(node)) {
      const name = node.name.getText(source)
      exported.push(`  ◇ ${name} [exported]  ${range}`)
      return
    }

    // enum
    if (ts.isEnumDeclaration(node)) {
      const name = node.name.getText(source)
      exported.push(`  ▣ ${name} [exported]  ${range}`)
      return
    }

    // variable statement: export const name = ...
    if (ts.isVariableStatement(node) && exp) {
      node.declarationList.declarations.forEach(decl => {
        if (!ts.isIdentifier(decl.name)) return
        const name = decl.name.getText(source)
        const init = decl.initializer

        if (!init) {
          exported.push(`  ○ ${name} [exported]  ${range}`)
          return
        }

        const isFn =
          ts.isArrowFunction(init) ||
          ts.isFunctionExpression(init) ||
          // React.memo(fn), forwardRef(fn), etc.
          (ts.isCallExpression(init) &&
            init.arguments.some(
              a => ts.isArrowFunction(a) || ts.isFunctionExpression(a)
            ))

        if (isFn) {
          // Get params from the actual function
          const fnNode = ts.isCallExpression(init)
            ? init.arguments.find(a => ts.isArrowFunction(a) || ts.isFunctionExpression(a))
            : init
          const params = fnNode ? getParamTypes(fnNode) : ''
          const ret = fnNode ? getReturnType(fnNode) : ''
          exported.push(`  ƒ ${name} [exported]  ${range}  ${name}${params}${ret}`)
        } else {
          exported.push(`  ○ ${name} [exported]  ${range}`)
        }
      })
      return
    }

    // top-level non-exported variable with function
    if (ts.isVariableStatement(node) && !exp) {
      node.declarationList.declarations.forEach(decl => {
        if (!ts.isIdentifier(decl.name)) return
        const name = decl.name.getText(source)
        const init = decl.initializer
        if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
          internal.push(`  ƒ ${name}  ${range}`)
        }
      })
    }
  })

  return { exported, internal }
}

// ─── 正则降级方案 ────────────────────────────────────────────────────────────

function extractWithRegex() {
  const exported = []
  const internal = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lineNum = i + 1
    const trimmed = line.trimStart()

    // 跳过注释行
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue

    let m

    // export (async) function name(
    m = line.match(/^export\s+(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)/)
    if (m) {
      const sig = line.replace(/\s*\{?\s*$/, '').trim().slice(0, 90)
      exported.push(`  ƒ ${m[1]} [exported]  L${lineNum}  ${sig}`)
      continue
    }

    // export default function (name?)
    m = line.match(/^export\s+default\s+(?:async\s+)?function\s*([A-Za-z_$][A-Za-z0-9_$]*)/)
    if (m) {
      exported.push(`  ƒ ${m[1] || '(default)'} [exported]  L${lineNum}`)
      continue
    }

    // export const name = ... (function or value)
    m = line.match(/^export\s+const\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*[=:]/)
    if (m) {
      const rest = line.slice(line.indexOf(m[1]) + m[1].length)
      const isFn = /=\s*(async\s+)?\(|=\s*(async\s+)?[A-Za-z_$].*=>|:\s*React\.FC|:\s*FC<|\bforwardRef\b|\bmemo\b/.test(rest)
      exported.push(isFn
        ? `  ƒ ${m[1]} [exported]  L${lineNum}`
        : `  ○ ${m[1]} [exported]  L${lineNum}`)
      continue
    }

    // export class
    m = line.match(/^export\s+(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][A-Za-z0-9_$]*)/)
    if (m) {
      exported.push(`  ◆ ${m[1]} [exported]  L${lineNum}`)
      continue
    }

    // export interface
    m = line.match(/^export\s+interface\s+([A-Za-z_$][A-Za-z0-9_$<]*)/)
    if (m) {
      exported.push(`  ◇ ${m[1]} [exported]  L${lineNum}`)
      continue
    }

    // export type
    m = line.match(/^export\s+type\s+([A-Za-z_$][A-Za-z0-9_$<]*)/)
    if (m) {
      exported.push(`  ◇ ${m[1]} [exported]  L${lineNum}`)
      continue
    }

    // export enum
    m = line.match(/^export\s+enum\s+([A-Za-z_$][A-Za-z0-9_$]*)/)
    if (m) {
      exported.push(`  ▣ ${m[1]} [exported]  L${lineNum}`)
      continue
    }

    // 内部顶层 function
    m = line.match(/^(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)/)
    if (m) {
      internal.push(`  ƒ ${m[1]}  L${lineNum}`)
      continue
    }

    // 内部顶层 const arrow function
    m = line.match(/^const\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:async\s+)?\(/)
    if (m) {
      internal.push(`  ƒ ${m[1]}  L${lineNum}`)
    }
  }

  return { exported, internal }
}

// ─── 主逻辑 ──────────────────────────────────────────────────────────────────

const method = ts ? 'TS Compiler API' : 'regex fallback'
const { exported, internal } = ts ? extractWithTSCompiler() : extractWithRegex()

console.log(`\n📁 ${filePath} (${totalLines} 行, ~${tokenEst} tokens 如全量读取)`)
console.log(`   解析方式: ${method}\n`)

if (exported.length > 0) {
  console.log('Exports:')
  exported.forEach(s => console.log(s))
}

if (internal.length > 0) {
  if (exported.length > 0) console.log('')
  console.log('Internal:')
  internal.forEach(s => console.log(s))
}

if (exported.length === 0 && internal.length === 0) {
  console.log('(未检测到顶层函数/类型，可能是数据文件或配置文件)')
}

console.log('')
