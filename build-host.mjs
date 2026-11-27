/**
 * 打包宿主侧入口：src/index.ts → lib/index.js，src/bin.ts → lib/bin.js。
 *
 * lib/ 是提交进仓库的发布产物（DSH 直接加载它，不在安装时构建），所以改完
 * src/ 必须跑一次 `npm run build`。客户端 bundle 由 build-client.mjs 负责，
 * 两者合在 `npm run build` 里。
 *
 * 用 esbuild 而不是 tsc：仓库里大量 .ts 后缀的相对导入（Node 原生 strip-types
 * 风格），tsc 会要求 allowImportingTsExtensions + 重写后缀；esbuild 直接吃掉。
 */

import { execFileSync } from 'node:child_process'
import { statSync } from 'node:fs'

import { build } from 'esbuild'

const TARGETS = [
  { entry: 'src/index.ts', outfile: 'lib/index.js' },
  { entry: 'src/bin.ts', outfile: 'lib/bin.js' },
]

for (const { entry, outfile } of TARGETS) {
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    // 宿主自带这个包；插件在运行时由 DSH 的加载器解析，避免打进第二份 schema 实现。
    external: ['@deepseek-ai/schemastery'],
    // 保留 src/bin.ts 自带的 shebang，esbuild 会把它放在输出首行。
    logLevel: 'warning',
  })
  // 语法自检：产物是要被 Node 直接执行的，别等到装进 profile 才发现写坏。
  execFileSync(process.execPath, ['--check', outfile], { stdio: 'inherit' })
  const kb = (statSync(outfile).size / 1024).toFixed(0)
  console.log(`✓ built ${outfile} (${kb} KB)`)
}