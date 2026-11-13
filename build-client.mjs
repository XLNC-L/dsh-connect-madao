#!/usr/bin/env node
/**
 * 构建客户端 bundle（宿主规范版）。
 *
 * 背景（见「dsh无法打开问题修复记录.md」）：
 * DSH 前端以 classic script 加载 lib/client.js，约定是
 *   window.__ModuleLoader__.load({ id, factory: (require) => { ... return module.exports } })
 * 直接输出 ESM 会报 "Cannot use import statement outside a module"，
 * 并让整个 GUI 启动失败（web boot: 1 entry did not activate）。
 *
 * 本脚本：
 *   1. esbuild 产出 ESM bundle（react / react-dom 保持 external）
 *   2. 把 import 语句转成 require 调用
 *   3. 把 export 语句转成 exports.xxx 赋值
 *   4. 包上 __ModuleLoader__ 外壳
 *
 * 产物与修复记录中手工验证通过的格式完全一致。
 */

import { build } from 'esbuild'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const out = join(root, 'lib', 'client.js')
const tmp = join(root, 'lib', '.client.esm.js')

await build({
  entryPoints: [join(root, 'src', 'client', 'index.ts')],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  external: ['react', 'react-dom', 'react/jsx-runtime'],
  jsx: 'automatic',
  loader: { '.tsx': 'tsx', '.ts': 'ts' },
  outfile: tmp,
  logLevel: 'warning',
})

let body = readFileSync(tmp, 'utf8')
unlinkSync(tmp)

// 1) import { a, b as c } from "x"  ->  const { a, b: c } = require("x")
body = body.replace(
  /^import\s*\{([^}]+)\}\s*from\s*["']([^"']+)["'];?\s*$/gm,
  (_m, names, mod) => {
    const parts = names.split(',').map((s) => s.trim()).filter(Boolean)
    const mapped = parts.map((p) => {
      const mm = p.match(/^(\S+)\s+as\s+(\S+)$/)
      return mm ? `${mm[1]}: ${mm[2]}` : p
    })
    return `const { ${mapped.join(', ')} } = require(${JSON.stringify(mod)});`
  },
)

// 2) 兜底：任何残留的 import ... from 也转成 require（避免漏网）
body = body.replace(
  /^import\s+(.+?)\s+from\s*["']([^"']+)["'];?\s*$/gm,
  (_m, spec, mod) => `const ${spec.trim()} = require(${JSON.stringify(mod)});`,
)

// 3) export { a, b, c };  ->  exports.a = a; ...
body = body.replace(
  /^export\s*\{([^}]+)\};?\s*$/gm,
  (_m, names) =>
    names
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((n) => {
        const mm = n.match(/^(\S+)\s+as\s+(\S+)$/)
        return mm ? `exports.${mm[2]} = ${mm[1]};` : `exports.${n} = ${n};`
      })
      .join('\n'),
)

const wrapped = `window.__ModuleLoader__.load({
\tid: "dsh-connect-madao",
\tfactory: (require) => {
\t\tvar module = { exports: {} };
\t\tvar exports = module.exports;
\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
${body}
\t\treturn module.exports;
\t}
});
`

writeFileSync(out, wrapped, 'utf8')

// 语法自检
const { execFileSync } = await import('node:child_process')
try {
  execFileSync(process.execPath, ['--check', out], { stdio: 'pipe' })
  console.log(`✓ built ${out} (${wrapped.length} bytes, __ModuleLoader__ CJS, node --check 通过)`)
} catch (e) {
  console.error('✗ 产物语法校验失败:', String(e.stderr ?? e))
  process.exit(1)
}
