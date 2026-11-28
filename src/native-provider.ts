/**
 * 原生 provider：由本插件自己向 DSH 注册 LLM adapter。
 *
 * 为什么需要这一层：
 *   之前码道是作为 `llm-pi-ai` 的一条 provider 配置接进去的。pi-ai 会把
 *   「不在内置厂商目录里的 route」标成 `declared: true`，DSH 的模型设置页
 *   于是显示「自定义」，并给一个通用的 baseURL/模型编辑器。
 *
 *   trae / WorkBuddy 这些连接器不带这个标签，是因为它们**自己**注册 adapter
 *   和 configurable provider（`declared: false`），provider 的 profile 放在
 *   自己的 settings 命名空间里。DSH 对未知命名空间只显示「其余字段在
 *   cordis.patch.yml 中…」，也就是那张干净的卡片。
 *
 * 这里复用 `@deepseek-ai/dsh-llm-pi-ai` 导出的 `PiAiAdapter` 和 pi-ai 的
 * `createProvider`，因此流式、工具调用、思考档位等仍由上游实现，不重写。
 * 我们只负责：把网关模型映射成 pi-ai 的 Model、拼出 adapter 需要的 profile、
 * 注册路由，并在模型选择变化时重建 profile。
 *
 * 依赖是“宿主提供”的：这些包只存在于 DSH 自己的 node_modules 里，所以用
 * 变量说明符做动态 import，避免 esbuild 在打包期解析。
 *
 * @module dsh-connect-madao/native-provider
 */

import { displayName } from './host-patch.ts'
import type { ModelInfo } from './models.ts'

/** 本插件在 DSH 里的 settings 命名空间，也是卡片上显示的来源。 */
export const NATIVE_SETTINGS_NS = 'dsh-connect-madao'

/** 与桥接端口配合的 baseURL。 */
function bridgeBaseUrl(port: number): string {
  return `http://127.0.0.1:${port}/v1`
}

/**
 * 宿主包只在运行时可用，用变量说明符阻止打包器静态解析。
 * @param specifier 包名，例如 `@earendil-works/pi-ai`
 */
function hostImport(specifier: string): Promise<any> {
  return import(/* @vite-ignore */ specifier)
}

interface HostModules {
  createProvider: (input: any) => any
  openAICompletionsApi: () => any
  PiAiAdapter: new (options: any) => any
  resolveRetryPolicy: (config: unknown, path: string) => any
}

let hostPromise: Promise<HostModules> | undefined

/** 加载一次宿主模块，之后复用。 */
async function loadHost(): Promise<HostModules> {
  hostPromise ??= (async () => {
    const [piAi, lazyApi, dshPiAi, dshLlm] = await Promise.all([
      hostImport('@earendil-works/pi-ai'),
      hostImport('@earendil-works/pi-ai/api/openai-completions.lazy'),
      hostImport('@deepseek-ai/dsh-llm-pi-ai'),
      hostImport('@deepseek-ai/dsh-llm'),
    ])
    const modules: HostModules = {
      createProvider: piAi.createProvider,
      openAICompletionsApi: lazyApi.openAICompletionsApi,
      PiAiAdapter: dshPiAi.PiAiAdapter,
      resolveRetryPolicy: dshLlm.resolveRetryPolicy,
    }
    for (const [name, value] of Object.entries(modules)) {
      if (typeof value !== 'function') throw new Error(`native provider: host module is missing ${name}`)
    }
    return modules
  })()
  return hostPromise
}

/**
 * pi-ai 期望的 Model 对象。
 *
 * 字段与 llm-pi-ai 从 cordis.patch.yml 解析出来的配置一一对应：同一套
 * contextWindow / maxTokens / input / reasoningEfforts，换成 pi-ai 的拼写。
 * 两处必须同源，否则「配置里的模型」和「adapter 实际提供的模型」会漂移。
 */
export function buildPiModel(model: ModelInfo, providerId: string, baseUrl: string): Record<string, unknown> {
  const levels = new Set(model.strengths)
  const reasoning = levels.size > 0
  const entry: Record<string, unknown> = {
    id: model.id,
    name: displayName(model),
    api: 'openai-completions',
    provider: providerId,
    baseUrl,
    input: model.supportsImages ? ['text', 'image'] : ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: model.context,
    maxTokens: model.maxOutput,
    reasoning,
    compat: { supportsReasoningEffort: reasoning },
  }
  if (reasoning) {
    // DSH 的档位名 → 上游 reasoning_effort 的拼写。未声明的档位给 null，
    // 表示「这个模型不支持」，而不是硬塞一个它会拒绝的值。
    entry.thinkingLevelMap = {
      off: null,
      minimal: levels.has('minimal') ? 'minimal' : null,
      low: levels.has('low') ? 'low' : null,
      medium: levels.has('medium') ? 'medium' : null,
      high: levels.has('high') ? 'high' : null,
      xhigh: levels.has('xhigh') ? 'xhigh' : null,
      max: levels.has('max') ? 'max' : null,
    }
  }
  return entry
}

/** pi-ai 的 credential store：桥接不校验 key，给一个惰性实现即可。 */
const INERT_AUTH = {
  credentials: {
    async read() {},
    async list() {
      return []
    },
    async modify() {
      throw new Error('dsh-connect-madao has no pi-ai credential lifecycle')
    },
    async delete() {},
  },
  authContext: {
    async env() {},
    async fileExists() {
      return false
    },
  },
}

/** adapter 的 profile：字段对齐 dsh-llm-pi-ai 0.2.2 的 ResolvedPiAiProviderProfile。 */
function buildProfile(provider: any, displayNameText: string, retryPolicy: any): Record<string, unknown> {
  return {
    provider: provider.id,
    displayName: displayNameText,
    streamIdleTimeoutMs: 300_000,
    // 图片预算沿用宿主默认值；桥接目前只转发文本，但字段必须齐全。
    maxRequestImageBytes: 20 * 1024 * 1024,
    requestImagePixelBudget: 4 * 1024 * 1024,
    requestImageMaxBytes: 1024 * 1024,
    maxRequestImages: 50,
    imageOffloadCountQuantum: 10,
    retryPolicy,
    configuredMaxTokens: new Map(),
    modelErrors: new Map(),
    defaultContextWindow: 131_072,
    piProvider: provider,
  }
}

export interface NativeProviderOptions {
  providerId: string
  displayName: string
  port: number
  models: ModelInfo[]
}

export interface NativeProvider {
  providerId: string
  /** 模型选择变化后重建 profile，并通知 DSH 刷新模型目录。 */
  update(models: ModelInfo[]): void
  /** 供诊断接口调用：返回 adapter 当前对外提供的模型。 */
  listModels(): Promise<unknown[]>
  dispose(): void
}

/**
 * 注册一个由本插件拥有的 provider 路由。
 *
 * @param ctx 宿主插件 ctx（apply 的入参），用于 `ctx.llm` 与事件
 */
export async function registerNativeProvider(ctx: any, options: NativeProviderOptions): Promise<NativeProvider> {
  const host = await loadHost()
  const { providerId, displayName: providerName, port } = options
  const baseUrl = bridgeBaseUrl(port)
  const api = host.openAICompletionsApi()

  let models = options.models
  let profiles = new Map<string, unknown>()

  const rebuild = (next: ModelInfo[]): void => {
    models = next
    const piModels = next.map((model) => buildPiModel(model, providerId, baseUrl))
    const provider = {
      ...host.createProvider({
        id: providerId,
        name: providerName,
        api,
        models: piModels,
        auth: {
          apiKey: {
            name: '码道桥接',
            async resolve() {
              // 桥接服务自己持有 AK/SK，本地请求不需要真实 key。
              return { auth: { apiKey: 'bridge-local' }, source: 'dsh-connect-madao bridge' }
            },
          },
        },
      }),
      getModels: () => piModels,
    }
    const profile = buildProfile(
      provider,
      providerName,
      host.resolveRetryPolicy(undefined, 'dsh-connect-madao retryPolicy'),
    )
    profiles = new Map([[providerId, profile]])
  }

  rebuild(options.models)

  const adapter = new host.PiAiAdapter({
    profiles: () => profiles,
    auth: INERT_AUTH,
    resolveApiKey: async () => 'bridge-local',
  })

  // 先注册 adapter，再声明可配置 provider：后者是设置页列出这张卡片的依据。
  // declared: false 明确告诉 DSH「这条路由是本插件自带的」，卡片不会再带
  // 「自定义」标签；settingsPath 为空 + 未知命名空间，编辑器只显示提示。
  const adapterHandle = ctx.llm.registerAdapter([providerId], adapter)
  const directoryHandle = ctx.llm.registerConfigurableProviders([
    {
      provider: providerId,
      displayName: providerName,
      settingsNs: NATIVE_SETTINGS_NS,
      settingsPath: [],
      declared: false,
    },
  ])

  return {
    providerId,
    update(next: ModelInfo[]) {
      rebuild(next)
      // 让模型选择器重新读 adapter 的目录；事件名与 pi-ai 自己用的一致。
      try {
        ctx.emit('llm/models-updated', providerId)
      } catch {}
    },
    async listModels() {
      return adapter.listModels(providerId)
    },
    dispose() {
      try {
        directoryHandle()
      } catch {}
      try {
        adapterHandle()
      } catch {}
    },
  }
}
