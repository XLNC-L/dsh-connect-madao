/**
 * The bundle patch owns only the connector entry. Model routes are merged at
 * runtime through ConfigEditor; a bundle-level providers map replaces user
 * channels when configuration layers are composed.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import type { ModelInfo } from './models.ts'

/** Retain the optional catalog argument for CLI callers; never render providers. */
export function renderPatch(_models?: ModelInfo[]): string {
  return `# 由 dsh-connect-madao 自动生成，请勿手工编辑。
# 模型目录由插件通过 DSH ConfigEditor 合并到现有渠道配置。
- insert:
    - id: dsh-connect-madao
      name: dsh-connect-madao
`
}

export interface SyncResult {
  changed: boolean
  path: string
  models: number
  error?: string
}

/** Refresh the plugin entry without writing a model-provider override. */
export function syncPatch(path: string, models: ModelInfo[] = []): SyncResult {
  try {
    const next = renderPatch()
    const prev = existsSync(path) ? readFileSync(path, 'utf8') : ''
    if (prev === next) return { changed: false, path, models: models.length }
    writeFileSync(path, next, 'utf8')
    return { changed: true, path, models: models.length }
  } catch (e) {
    return { changed: false, path, models: models.length, error: String((e as Error)?.message ?? e) }
  }
}
