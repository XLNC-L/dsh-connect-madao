/**
 * dsh-connect-madao 的类型声明。
 *
 * 宿主侧入口只做两件事：起本地桥接服务、把模型清单同步进插件自带的
 * cordis.patch.yml。它不 import 任何 DSH 内部包，所以这里的类型只描述
 * 插件自身的导出面。
 */

/** Host 侧的 Cordis 上下文；只用到 effect，其余按需扩展。 */
export interface PluginContext {
  effect?: (execute: () => () => void, label?: string) => void
  readonly [key: string]: unknown
}

export interface MadaoConfig {
  /** 置为 false 时不启动桥接服务 */
  enabled?: boolean
  /** 桥接监听端口，默认 8765 */
  port?: number
  /** 覆盖默认网关地址 */
  gateway?: string
  /** 直接内联永久 AK（否则读 ~/.dsh-connect-madao/credentials.json） */
  ak?: string
  /** 直接内联永久 SK */
  sk?: string
  /** 启动时是否把网关模型清单写回 cordis.patch.yml，默认 true */
  autoSyncModels?: boolean
}

/** provider 在 DSH 里的名字，与 cordis.patch.yml 中的键一致。 */
export declare const PROVIDER: 'madao'

export declare const name: 'dsh-connect-madao'

/** 本插件不依赖其它 Cordis 服务，因此为空数组。 */
export declare const inject: string[]

/** 凭证文件默认位置：~/.dsh-connect-madao/credentials.json */
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

export declare const meta: {
  PROVIDER: typeof PROVIDER
  DEFAULT_CRED_PATH: string
  /** 兜底模型清单（网关不可达时使用） */
  models: ModelInfo[]
}
