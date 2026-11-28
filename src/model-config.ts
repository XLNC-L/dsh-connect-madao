/**
 * 模型选择的落地逻辑：过滤、套上下文上限，以及两条写给 DSH 的路径。
 *
 * 首选路径是 `native`：插件在 0.12 起自带 adapter，`selectModels()` 的结果
 * 直接重建 adapter 的模型目录，保存即生效，profile 里不需要再出现 `madao`。
 *
 * 兼容路径是 `applyModelSelection()`：给还没注册原生 provider 的宿主（或
 * 升级到一半的安装）用，把选择写回 profile 的 `llm-pi-ai.providers.madao`。
 * 那里只能走 `configEditor.edit()`：
 *   - 它只改 profile patch 里 `llm-pi-ai` 这一行，保留 ark-coding-plan 等其它 provider；
 *   - 写完立刻经 Loader 协调生效，不用重启 DSH；
 *   - 与 HMR、profile 的其它写入互斥，不会写坏用户文件。
 *
 * 拿不到 configEditor（例如精简宿主）时返回 unavailable，由前端如实提示，
 * 而不是假装保存成功。
 *
 * 另外提供一个一次性迁移 `removeLegacyProvider()`：原生 provider 要独占
 * `madao` 路由，旧配置里残留的 `providers.madao` 必须先删掉。
 *
 * @module dsh-connect-madao/model-config
 */

import { buildProviderModel, type ProviderModelConfig } from './host-patch.ts'
import type { ModelInfo } from './models.ts'
import type { MadaoSettings } from './settings.ts'

/** 与 native-provider / host-patch 里生成的 provider 保持一致。 */
export const PROVIDER_ID = 'madao'
const PROVIDER_DISPLAY_NAME = '码道 CodeArts'
const PROVIDER_HEADERS = { Authorization: 'Bearer bridge-local' }

export interface ProviderEntryConfig {
  displayName: string
  api: string
  baseURL: string
  headers: Record<string, string>
  models: ProviderModelConfig[]
}

export interface ModelApplyOutcome {
  mode: 'live' | 'unavailable' | 'failed'
  error?: string
  applied: number
}

/**
 * 按设置过滤模型并套用上下文上限。
 *
 * 上限只允许比网关值小：网关的 context_window 是硬限制，桥接也会按它
 * 拦截超长请求，调大只会让 DSH 少压缩一次、然后被桥接拒掉。
 */
export function selectModels(
  models: ModelInfo[],
  settings: Pick<MadaoSettings, 'hiddenModels' | 'contextCaps'>,
): ModelInfo[] {
  const hidden = new Set(settings.hiddenModels ?? [])
  const caps = settings.contextCaps ?? {}
  return models
    .filter((model) => !hidden.has(model.id))
    .map((model) => {
      const cap = caps[model.id]
      if (typeof cap !== 'number' || !Number.isFinite(cap) || cap <= 0 || cap >= model.context) {
        return model
      }
      return { ...model, context: Math.round(cap) }
    })
}

/** 生成 provider 段（models 只包含选中的模型）。 */
export function buildProviderEntry(models: ModelInfo[], port: number): ProviderEntryConfig {
  return {
    displayName: PROVIDER_DISPLAY_NAME,
    api: 'openai-completions',
    baseURL: `http://127.0.0.1:${port}/v1`,
    headers: { ...PROVIDER_HEADERS },
    models: models.map(buildProviderModel),
  }
}

/**
 * 在 llm-pi-ai 的下一份 config 里只替换 madao 这一个 provider。
 *
 * @param current   profile patch 里已有的覆盖（可能为空）
 * @param inherited 去掉覆盖后、由 bundle 层合成的配置
 */
export function mergeProviderConfig(
  current: unknown,
  inherited: unknown,
  models: ModelInfo[],
  port: number,
): Record<string, unknown> {
  const hasCurrent = typeof current === 'object' && current !== null && Object.keys(current).length > 0
  const base = (hasCurrent ? current : inherited) ?? {}
  const next = structuredClone(base) as Record<string, unknown>
  const providers =
    typeof next.providers === 'object' && next.providers !== null && !Array.isArray(next.providers)
      ? (next.providers as Record<string, unknown>)
      : {}
  next.providers = { ...providers, [PROVIDER_ID]: buildProviderEntry(models, port) }
  return next
}

interface ConfigEditorLike {
  entries?: () => Array<{ options?: { id?: string; config?: unknown } }>
  edit?: (entry: unknown, change: (current: unknown, inherited: unknown) => unknown) => Promise<unknown>
}

/**
 * 从一份 llm-pi-ai 配置里删掉旧的内置 madao provider（没有就原样返回）。
 *
 * 只删这一个 key：同一行里可能还有用户自己的 ark-coding-plan 等 provider。
 * 返回 undefined 表示“不需要改”，调用方据此跳过写盘。
 */
export function stripLegacyProvider(current: unknown): Record<string, unknown> | undefined {
  if (typeof current !== 'object' || current === null || Array.isArray(current)) return undefined
  const next = structuredClone(current) as Record<string, any>
  const providers = next.providers
  if (typeof providers !== 'object' || providers === null || !(PROVIDER_ID in providers)) return undefined
  delete providers[PROVIDER_ID]
  return next
}

/**
 * 宿主的 HMR 服务只需用到 `executing`（AsyncLocalStorage）。
 *
 * 桥接服务是在插件 apply 期间创建的，而 apply 可能发生在 HMR 事务里，
 * 于是每个 HTTP 请求的回调都继承了那个事务的 AsyncLocalStorage store。
 * config-editor 内部会调 `hmr.runExclusive()`，看到 store 还在就报
 * 「HMR transactions cannot be nested」—— 明明请求早就和那次重载无关了。
 * 用 hmr 自己的 `executing.exit()` 跳出这个陈旧的 async 上下文即可。
 */
interface HmrLike {
  executing?: {
    getStore?: () => unknown
    exit?: <T>(fn: () => T) => T
  }
}

/**
 * 把当前选择应用到 DSH。
 *
 * @param dshCtx 宿主插件 ctx（apply 收到的那个），用来拿 configEditor 服务
 */
export async function applyModelSelection(
  dshCtx: unknown,
  models: ModelInfo[],
  settings: Pick<MadaoSettings, 'hiddenModels' | 'contextCaps'>,
  port: number,
): Promise<ModelApplyOutcome> {
  const selected = selectModels(models, settings)
  if (selected.length === 0) {
    return { mode: 'failed', error: '至少要保留一个模型，否则模型选择器会整个空掉。', applied: 0 }
  }

  const ctx = dshCtx as { get?: (name: string) => unknown } | undefined
  const editor = ctx?.get?.('configEditor') as ConfigEditorLike | undefined
  if (!editor || typeof editor.entries !== 'function' || typeof editor.edit !== 'function') {
    return { mode: 'unavailable', error: '当前宿主没有提供 configEditor 服务。', applied: 0 }
  }

  let entry: { options?: { id?: string } } | undefined
  try {
    entry = editor.entries().find((candidate) => candidate?.options?.id === 'llm-pi-ai')
  } catch (e) {
    return { mode: 'failed', error: String((e as Error)?.message ?? e), applied: 0 }
  }
  if (!entry) {
    return { mode: 'unavailable', error: '当前 profile 里找不到 llm-pi-ai 这一行。', applied: 0 }
  }

  const edit = () =>
    editor.edit!(entry, (current, inherited) => mergeProviderConfig(current, inherited, selected, port))

  try {
    const hmr = ctx?.get?.('hmr') as HmrLike | undefined
    const store = hmr?.executing?.getStore?.()
    if (store && typeof hmr?.executing?.exit === 'function') {
      // 退出从插件挂载时继承下来的 HMR 事务上下文，见 HmrLike 的注释。
      await hmr.executing.exit(edit)
    } else {
      await edit()
    }
    return { mode: 'live', applied: selected.length }
  } catch (e) {
    return { mode: 'failed', error: String((e as Error)?.message ?? e), applied: 0 }
  }
}

/**
 * 把旧安装里 llm-pi-ai 的 `providers.madao` 迁走。
 *
 * 原生 provider 需要独占 `madao` 这个路由 id：pi-ai 先注册了它，我们再
 * registerAdapter 就会 DUPLICATE_DIRECTORY。删掉配置后 pi-ai 会在同一次
 * Loader 协调里把路由撤掉，之后原生 provider 才能接上。
 *
 * @returns true 表示确实写了一笔（调用方可以等等再重试注册）
 */
export async function removeLegacyProvider(dshCtx: unknown): Promise<boolean> {
  const ctx = dshCtx as { get?: (name: string) => unknown } | undefined
  const editor = ctx?.get?.('configEditor') as ConfigEditorLike | undefined
  if (!editor || typeof editor.entries !== 'function' || typeof editor.edit !== 'function') return false

  let entry: { options?: { id?: string; config?: unknown } } | undefined
  try {
    entry = editor.entries().find((candidate) => candidate?.options?.id === 'llm-pi-ai')
  } catch {
    return false
  }
  if (!entry) return false
  if (stripLegacyProvider(entry.options.config) === undefined) return false

  const edit = () =>
    editor.edit!(entry, (current, inherited) => {
      const next = stripLegacyProvider(current)
      return next ?? inherited ?? current
    })
  const hmr = ctx?.get?.('hmr') as HmrLike | undefined
  const store = hmr?.executing?.getStore?.()
  if (store && typeof hmr?.executing?.exit === 'function') await hmr.executing.exit(edit)
  else await edit()
  return true
}
