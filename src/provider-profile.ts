import { isDeepStrictEqual } from 'node:util'
import type { ModelInfo } from './models.ts'

type RawConfig = Record<string, unknown>

// Structural types keep the connector independent of DSH's runtime packages.
export interface ProviderConfigEntry {
  options: { id: string; config?: unknown }
}

export interface ProviderConfigEditor {
  configuration(): Array<{ entry: ProviderConfigEntry; inherited: RawConfig }>
  edit(entry: ProviderConfigEntry, change: (current: RawConfig, inherited: RawConfig) => RawConfig): Promise<void>
}

export interface ProviderConfigContext {
  get?(name: 'configEditor'): ProviderConfigEditor | undefined
  configEditor?: ProviderConfigEditor
}

export interface ProviderSyncResult {
  updated: boolean
  conflict: boolean
}

const BRIDGE_TOKEN = 'Bearer bridge-local'

function asRecord(value: unknown): RawConfig {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as RawConfig : {}
}

/** Preserve raw schema expressions: an expression for the whole map cannot be merged safely. */
function providerMap(value: unknown): RawConfig {
  const map = asRecord(value)
  if (Object.hasOwn(map, '__jsExpr')) throw new Error('madao: providers expression cannot be merged automatically')
  return map
}

/** Build the pi-ai route profile for the current bridge model catalog. */
export function buildMadaoProviderProfile(models: ModelInfo[], port = 8765) {
  if (!Array.isArray(models) || models.length === 0) throw new TypeError('madao: at least one model is required')
  return {
    displayName: '码道 CodeArts',
    api: 'openai-completions',
    baseURL: `http://127.0.0.1:${port}/v1`,
    headers: { Authorization: BRIDGE_TOKEN },
    models: models.map(model => ({
      id: model.id,
      name: model.ratio ? `${model.name} · ${model.ratio}` : model.name,
      contextWindow: Number.isFinite(model.context) && model.context > 0
        ? Math.max(model.context, Math.round(model.context)) : model.context,
      maxTokens: model.maxOutput,
      input: model.supportsImages ? ['text', 'image'] : ['text'],
      reasoningEfforts: model.strengths.length > 0
        ? Object.fromEntries([['off', null], ...Array.from(new Set(['low', ...model.strengths]), level => [level, level])])
        : false,
    })),
  }
}

function isManagedRoute(profile: RawConfig): boolean {
  const match = typeof profile.baseURL === 'string' ? /^http:\/\/127\.0\.0\.1:(\d+)\/v1$/.exec(profile.baseURL) : null
  const port = match ? Number(match[1]) : 0
  return profile.displayName === '码道 CodeArts'
    && profile.api === 'openai-completions'
    && Number.isInteger(port) && port > 0 && port <= 65535
    && asRecord(profile.headers).Authorization === BRIDGE_TOKEN
}

/**
 * Merge the managed route through ConfigEditor, retaining both raw provider
 * layers and schema expressions. Never serialize effectiveConfig.providers:
 * DSH wraps it in a Volatile object containing get().
 */
export async function syncMadaoProviderConfig(
  ctx: ProviderConfigContext,
  models: ModelInfo[],
  port = 8765,
  isActive: () => boolean = () => true,
): Promise<ProviderSyncResult> {
  if (!isActive()) return { updated: false, conflict: false }
  const editor = ctx.get?.('configEditor') ?? ctx.configEditor
  if (!editor || typeof editor.configuration !== 'function' || typeof editor.edit !== 'function') {
    throw new Error('madao: DSH configEditor is unavailable')
  }
  const row = editor.configuration().find(item => item.entry.options.id === 'llm-pi-ai')
  if (!row) throw new Error('madao: active llm-pi-ai configuration entry was not found')
  const desired = buildMadaoProviderProfile(models, port)
  const plan = (current: RawConfig, inherited: RawConfig): ProviderSyncResult & { next?: RawConfig } => {
    if (!isActive()) return { updated: false, conflict: false }
    const providers = { ...providerMap(inherited.providers), ...providerMap(current.providers) }
    const existing = asRecord(providers.madao)
    if (Object.hasOwn(providers, 'madao') && !isManagedRoute(existing)) return { updated: false, conflict: true }
    const next = {
      ...current,
      providers: {
        ...providers,
        madao: { ...existing, ...desired, headers: { ...asRecord(existing.headers), ...desired.headers } },
      },
    }
    return { updated: !isDeepStrictEqual(current, next), conflict: false, next }
  }
  const initial = plan(asRecord(row.entry.options.config), row.inherited)
  if (!initial.updated) return { updated: false, conflict: initial.conflict }

  const skipped = new Error('madao: provider configuration update skipped')
  let result: ProviderSyncResult = { updated: false, conflict: false }
  try {
    await editor.edit(row.entry, (current, inherited) => {
      const planned = plan(current, inherited)
      result = { updated: planned.updated, conflict: planned.conflict }
      // Throw before ConfigEditor persists anything if another writer already
      // completed the merge, a user channel appeared, or the plugin unloaded.
      if (!planned.updated) throw skipped
      return planned.next!
    })
  } catch (error) {
    if (error !== skipped) throw error
  }
  return result
}
