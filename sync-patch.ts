/**
 * Refresh the bundle's connector entry before packing. No credentials or
 * network access are needed: model configuration is merged by the running
 * plugin through DSH ConfigEditor, never by the bundle patch.
 */
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { syncPatch } from './src/host-patch.ts'

const target = join(dirname(fileURLToPath(import.meta.url)), 'cordis.patch.yml')
const result = syncPatch(target)
if (result.error) {
  console.error(`✗ 同步失败：${result.error}`)
  process.exitCode = 1
} else {
  console.log(`✓ cordis.patch.yml ${result.changed ? '已更新' : '已是最新'}（仅插件条目；模型由 ConfigEditor 合并）`)
}
