/**
 * dsh-connect-madao 的类型声明。
 *
 * 宿主侧入口负责：起本地桥接服务、按设置注册自己的 LLM adapter、把旧安装
 * 的 llm-pi-ai 配置迁走。模型清单在运行时从网关发现，不再写回任何 YAML。
 *
 * 这里的类型只描述插件自身的导出面；DSH 内部服务通过 {@link PluginContext}
 * 的 `get()` 获取。
 */

/** Host 侧的 Cordis 上下文；只声明插件实际用到的成员，其余按需扩展。 */
export interface PluginContext {
  effect?: (execute: () => () => void, label?: string) => void
  /** 获取宿主服务，例如 `get('settings')`、`get('configEditor')`。 */
  get?: (name: string) => unknown
  /** LLM 服务：registerAdapter / registerConfigurableProviders。 */
  llm?: unknown
  fiber?: unknown
  emit?: (event: string, ...args: unknown[]) => void
  inject?: (deps: readonly string[], callback: (child: PluginContext) => void) => void
  readonly [key: string]: unknown
}

export interface MadaoConfig {
  /** 置为 false 时不启动桥接服务，默认 true。 */
  enabled?: boolean
  /** 桥接监听端口，默认 8765。 */
  port?: number
  /** 覆盖默认网关地址。 */
  gateway?: string
  /** 直接内联永久 AK（否则读 ~/.dsh-connect-madao/credentials.json）。 */
  ak?: string
  /** 直接内联永久 SK。 */
  sk?: string
  /**
   * 启动时是否从网关拉取实时模型清单；false 时直接用内置兜底清单。
   * 默认 true。它不再写 `cordis.patch.yml`。
   */
  autoSyncModels?: boolean
}

/** settings 页使用的 schemastery schema（运行时对象，无稳定静态类型）。 */
export declare const Config: unknown

/** provider 在 DSH 里的路由 id，与旧 llm-pi-ai 配置同名。 */
export declare const PROVIDER: 'madao'

/** 原生 adapter 注册时使用的 provider id，当前与 {@link PROVIDER} 相同。 */
export declare const NATIVE_PROVIDER_ID: 'madao'

export declare const name: 'dsh-connect-madao'

/** 本插件依赖宿主的 llm 服务来注册 adapter。 */
export declare const inject: string[]

/** 凭证文件的默认位置：~/.dsh-connect-madao/credentials.json。 */
export declare const DEFAULT_CRED_PATH: string

export declare function apply(ctx: PluginContext, config?: MadaoConfig): void

export interface ModelInfo {
  id: string
  name: string
  context: number
  maxOutput: number
  /** 计费倍率，如 "0.18x" */
  ratio?: string
  /** 网关是否开放图片输入 */
  supportsImages: boolean
  /** 可选思考强度，如 ["high","max"]；空数组表示不支持 */
  strengths: string[]
  defaultStrength?: string
  description?: string
}

declare const FALLBACK_MODELS: ModelInfo[]

export declare const meta: {
  PROVIDER: typeof PROVIDER
  DEFAULT_CRED_PATH: string
  /** 兜底模型清单（网关不可达时使用） */
  models: ModelInfo[]
}
