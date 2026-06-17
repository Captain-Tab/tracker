#!/usr/bin/env node
/**
 * unfold.js - 按符号名提取函数/方法完整实现
 *
 * 优先使用项目内的 TypeScript Compiler API（精准 AST）
 * 找不到时降级到花括号计数方案
 *
 * 用法: node unfold.js <file-path> <symbol-name> [project-root]
 * 支持:
 *   functionName            顶层函数或 const 箭头函数
 *   ClassName               整个 class
 *   ClassName.methodName    class 内的方法/属性
 *   ClassName.constructor   构造函数
 */

const fs = require('fs')
const path = require('path')

const filePath = process.argv[2]
const symbolName = process.argv[3]
const projectRoot = process.argv[4] || process.cwd()

if (!filePath || !symbolName) {
  console.error('Usage: node unfold.js <file-path> <symbol-name> [project-root]')
  console.error('Examples:')
  console.error('  node unfold.js src/stores/VaultStore.ts VaultStore.deposit')
  console.error('  node unfold.js src/hooks/useVault.ts useVault')
  process.exit(1)
}

const absPath = path.isAbsolute(filePath)
  ? filePath
  : path.resolve(projectRoot, filePath)

if (!fs.existsSync(absPath)) {
  console.log(`⚠️  文件未找到: ${filePath}`)
  process.exit(0)
}

const content = fs.readFileSync(absPath, 'utf-8')
const allLines = content.split('\n')

// 解析符号: "ClassName.methodName" 或 "symbolName"
const dotIdx = symbolName.indexOf('.')
const targetClass = dotIdx !== -1 ? symbolName.slice(0, dotIdx) : null
const targetMember = dotIdx !== -1 ? symbolName.slice(dotIdx + 1) : symbolName

// ─── 尝试加载 TypeScript Compiler API ───────────────────────────────────────

let ts = null
try {
  const tsPath = require.resolve('typescript', { paths: [projectRoot] })
  ts = require(tsPath)
} catch (_) {}

// ─── TS Compiler API 方案 ────────────────────────────────────────────────────

function findWithTSCompiler() {
  const source = ts.createSourceFile(absPath, content, ts.ScriptTarget.Latest, true)

  function getLine(node) {
    return source.getLineAndCharacterOfPosition(node.getStart()).line + 1
  }

  function getEndLine(node) {
    return source.getLineAndCharacterOfPosition(node.getEnd()).line + 1
  }

  function getName(node) {
    if (!node.name) return null
    try { return node.name.getText(source) } catch (_) { return null }
  }

  let found = null

  function visitTopLevel(node) {
    if (found) return

    // 顶层 function declaration
    if (ts.isFunctionDeclaration(node) && !targetClass) {
      if (getName(node) === targetMember) {
        found = { start: getLine(node), end: getEndLine(node) }
        return
      }
    }

    // 顶层 variable (const arrow function)
    if (ts.isVariableStatement(node) && !targetClass) {
      for (const decl of node.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name)) continue
        if (decl.name.getText(source) !== targetMember) continue
        if (!decl.initializer) continue
        const init = decl.initializer
        if (
          ts.isArrowFunction(init) ||
          ts.isFunctionExpression(init) ||
          ts.isCallExpression(init)
        ) {
          found = { start: getLine(node), end: getEndLine(node) }
          return
        }
      }
    }

    // class declaration
    if (ts.isClassDeclaration(node) && getName(node) === (targetClass || targetMember)) {
      if (!targetClass) {
        // 返回整个 class
        found = { start: getLine(node), end: getEndLine(node) }
        return
      }
      // 在 class 内部找成员
      for (const member of node.members) {
        if (found) return

        if (ts.isConstructorDeclaration(member) && targetMember === 'constructor') {
          found = { start: getLine(member), end: getEndLine(member) }
          return
        }

        const mName = getName(member)
        if (!mName || mName !== targetMember) continue

        if (
          ts.isMethodDeclaration(member) ||
          ts.isGetAccessorDeclaration(member) ||
          ts.isSetAccessorDeclaration(member) ||
          ts.isPropertyDeclaration(member)
        ) {
          found = { start: getLine(member), end: getEndLine(member) }
          return
        }
      }
    }
  }

  ts.forEachChild(source, visitTopLevel)
  return found
}

// ─── 花括号计数降级方案 ──────────────────────────────────────────────────────

function findWithBraceCounting() {
  // 找包含符号名的行
  const searchName = targetMember
  let startLine = -1

  for (let i = 0; i < allLines.length; i++) {
    const line = allLines[i]
    // 匹配函数/方法定义行
    const patterns = [
      new RegExp(`\\b(function\\s+|const\\s+|async\\s+function\\s+)${searchName}\\b`),
      new RegExp(`\\b${searchName}\\s*[=:(]`),
      new RegExp(`\\b${searchName}\\s*\\(`),
    ]
    if (patterns.some(p => p.test(line))) {
      startLine = i + 1
      break
    }
  }

  if (startLine === -1) return null

  // 从 startLine 向后计数花括号找到结束行
  let depth = 0
  let started = false
  for (let i = startLine - 1; i < allLines.length; i++) {
    const line = allLines[i]
    for (const ch of line) {
      if (ch === '{') { depth++; started = true }
      else if (ch === '}') { depth-- }
    }
    if (started && depth === 0) {
      return { start: startLine, end: i + 1 }
    }
  }

  return null
}

// ─── 主逻辑 ──────────────────────────────────────────────────────────────────

const found = ts ? findWithTSCompiler() : findWithBraceCounting()

if (!found) {
  console.log(`\n⚠️  未找到符号: ${symbolName}`)
  console.log(`   提示: 先用 outline 查看可用符号`)
  console.log(`   示例: /k/context outline ${filePath}\n`)
  process.exit(0)
}

const code = allLines.slice(found.start - 1, found.end).join('\n')
const tokenEst = Math.ceil(code.length / 4)
const totalTokenEst = Math.ceil(content.length / 4)
const saved = totalTokenEst - tokenEst

console.log(`\n📌 ${symbolName}`)
console.log(`   文件: ${filePath}:L${found.start}-${found.end}`)
console.log(`   ~${tokenEst} tokens（全文 ~${totalTokenEst} tokens，节省 ~${saved} tokens）\n`)
console.log(code)
console.log('')
