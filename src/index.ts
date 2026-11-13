/**
 * 宿主侧（Node）插件入口。
 *
 * 职责两条：
 *   1. 起一个本地 OpenAI 兼容桥接服务
 *   2. 启动时从码道网关拉模型清单，自动重写插件自带的 cordis.patch.yml
 *
 *   DSH (dsh-llm-pi-ai, openai-completions)
 *     └─▶ http://127.0.0.1:8765/v1        ← 本插件
 *           └─▶ 码道网关（SDK-HMAC + P-256 + SM4-GCM）
 *
 * 用户侧零配置：装上插件、填 AK/SK 即可。模型清单不需要手写，
 * 上游上新模型或调价后重启 DSH 会自动同步。
 */

import { startServer, type RunningServer } from './server.ts'
import { loadCredentials, DEFAULT_CRED_PATH } from './credentials.ts'
import { StsProvider } from './sts-provider.ts'
import { MadaoClient } from './client.ts'
import { discoverModels, FALLBACK_MODELS, type ModelInfo } from './models.ts'
import { syncPatch } from './host-patch.ts'
import { appendFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

export const name = 'dsh-connect-madao'
export const inject: string[] = []

export const PROVIDER = 'madao'

/** 启动诊断落盘，便于在没有 console 的宿主环境里定位问题。 */
function diag(line: string): void {
  const dir = join(homedir(), '.dsh-connect-madao')
  try {
    mkdirSync(dir, { recursive: true })
    appendFileSync(join(dir, 'host.log'), `${new Date().toISOString()} ${line}\n`, 'utf8')
  } catch {}
  try {
    console.log(`[dsh-connect-madao] ${line}`)
  } catch {}
}

/**
 * 插件自带的 patch 文件位置。
 *
 * 打包后本文件是 `lib/index.js`，patch 在包根目录，所以上跳一层。
 * 找不到时退回 cwd 下的同名文件。
 */
function patchPath(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url))
    const candidate = join(here, '..', 'cordis.patch.yml')
    if (existsSync(candidate) || existsSync(dirname(candidate))) return candidate
  } catch {}
  return join(process.cwd(), 'cordis.patch.yml')
}

export interface MadaoConfig {
  enabled?: boolean
  port?: number
  gateway?: string
  ak?: string
  sk?: string
  /** 是否在启动时把模型清单写回 patch（默认 true） */
  autoSyncModels?: boolean
}

export function apply(ctx: any, config: MadaoConfig = {}): void {
  diag(`apply() called; enabled=${config.enabled} port=${config.port ?? 8765}`)
  if (config.enabled === false) {
    diag('disabled, returning')
    return
  }

  const port = config.port ?? 8765
  let server: RunningServer | undefined

  if (config.ak && config.sk) {
    process.env.MADAO_AK = config.ak
    process.env.MADAO_SK = config.sk
  }

  // 生命周期绑定：不因 effect 用法差异导致整个 apply 抛错
  try {
    if (typeof ctx?.effect === 'function') {
      ctx.effect(
        () => () => {
          void server?.close().catch(() => {})
          server = void 0
          diag('disposed')
        },
        'dsh-connect-madao: local OpenAI bridge',
      )
      diag('ctx.effect registered')
    } else {
      diag('ctx.effect unavailable (no disposal hook)')
    }
  } catch (err) {
    diag(`ctx.effect threw: ${String(err)}`)
  }

  // 启动时拉一次清单并写回 patch。失败一律降级，绝不阻断桥接服务。
  const syncModels = async (): Promise<ModelInfo[]> => {
    if (config.autoSyncModels === false) {
      diag('autoSyncModels disabled, keep patch as-is')
      return FALLBACK_MODELS
    }
    try {
      const loaded = await loadCredentials()
      let creds = loaded.key
      if (!creds.securityToken) {
        const sts = new StsProvider({ ak: creds.ak, sk: creds.sk })
        creds = await sts.credentials()
      }
      const client = new MadaoClient({ credentials: creds, gateway: config.gateway })
      const found = await discoverModels(client)
      const target = patchPath()
      const r = syncPatch(target, found.models)
      if (r.error) diag(`patch sync error: ${r.error}`)
      else if (r.changed) diag(`patch updated: ${r.models} models → ${r.path}（重启 DSH 后生效）`)
      else diag(`patch unchanged (${r.models} models, source=${found.source})`)
      return found.models
    } catch (err) {
      diag(`model discovery skipped: ${String((err as Error)?.message ?? err)}`)
      return FALLBACK_MODELS
    }
  }

  void (async () => {
    try {
      const models = await syncModels()

      let hint = '未配置（请求会返回 503）'
      try {
        await loadCredentials()
        hint = '已解析'
      } catch (err) {
        diag(`loadCredentials failed: ${String(err)}`)
      }

      server = await startServer({ port, host: '127.0.0.1', gateway: config.gateway, models })
      diag(`bridge ready at ${server.url}/v1 (models=${models.length}, credentials: ${hint})`)
    } catch (err) {
      diag(`bridge failed to start: ${String((err as Error)?.stack ?? err)}`)
    }
  })()
}

export const meta = {
  PROVIDER,
  DEFAULT_CRED_PATH,
  models: FALLBACK_MODELS,
}
