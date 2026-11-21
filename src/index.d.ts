/**
 * dsh-connect-madao 的类型声明。
 *
 * 宿主侧入口启动本地桥接、通过 DSH ConfigEditor 合并模型清单到现有渠道配置，
 * 并注册已认证的远程设置转发。这里的类型只描述插件自身的导出面，不导入 DSH 内部包。
 */

/** Host 侧的 Cordis 上下文；需要 connection、configEditor 和 effect。 */
export interface PluginContext {
  connection: {
    fetch: {
      register(route: {
        path: string
        methods: readonly ['POST']
        requestBody: 'streaming'
        fetch(request: Request): Promise<Response>
      }): () => Promise<void>
    }
  }
  effect: (execute: () => () => void | Promise<void>, label?: string) => unknown
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
  /** 启动时是否从网关刷新目录；false 使用兜底目录，仍合并到 DSH 渠道配置 */
  autoSyncModels?: boolean
}

/** provider 在 DSH 里的渠道键。 */
export declare const PROVIDER: 'madao'

export declare const name: 'dsh-connect-madao'

/** 必需的 Host 服务：connection（远程设置转发）和 configEditor（模型渠道合并）。 */
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