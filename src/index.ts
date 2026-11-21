/**
 * Host plugin: start the loopback OpenAI bridge, merge its model catalog into
 * DSH through ConfigEditor while preserving existing provider routes, and
 * register the authenticated remote settings forwarder.
 */
import { startServer, type RunningServer } from './server.ts'
import { loadCredentials, DEFAULT_CRED_PATH } from './credentials.ts'
import { StsProvider } from './sts-provider.ts'
import { MadaoClient } from './client.ts'
import { discoverModels, FALLBACK_MODELS, type ModelInfo } from './models.ts'
import { syncMadaoProviderConfig } from './provider-profile.ts'
import { registerRemoteBridge } from './remote-bridge.ts'
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

export const name = 'dsh-connect-madao'
export const inject: string[] = ['connection', 'configEditor']

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

export interface MadaoConfig {
  enabled?: boolean
  port?: number
  gateway?: string
  ak?: string
  sk?: string
  /** 是否在启动时从网关刷新目录；false 使用兜底目录（默认 true） */
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
  let disposed = false
  // Only forward remote settings once this plugin's own bridge is listening, so
  // credentials are never sent to another process occupying the port.
  registerRemoteBridge(ctx, port, () => !disposed && server?.server.listening === true)

  if (config.ak && config.sk) {
    process.env.MADAO_AK = config.ak
    process.env.MADAO_SK = config.sk
  }

  ctx.effect(
    () => async () => {
      disposed = true
      const running = server
      server = undefined
      await running?.close().catch(() => {})
      diag('disposed')
    },
    'dsh-connect-madao: local OpenAI bridge',
  )

  // Discovery failure falls back to the shipped catalog without blocking the bridge.
  const discover = async (): Promise<ModelInfo[]> => {
    if (config.autoSyncModels === false) return FALLBACK_MODELS
    try {
      const loaded = await loadCredentials()
      if (disposed) return FALLBACK_MODELS
      let creds = loaded.key
      if (!creds.securityToken) {
        const sts = new StsProvider({ ak: creds.ak, sk: creds.sk })
        creds = await sts.credentials()
      }
      if (disposed) return FALLBACK_MODELS
      const client = new MadaoClient({ credentials: creds, gateway: config.gateway })
      return (await discoverModels(client)).models
    } catch (err) {
      diag(`model discovery skipped: ${String((err as Error)?.message ?? err)}`)
      return FALLBACK_MODELS
    }
  }

  void (async () => {
    try {
      const models = await discover()
      if (disposed) return
      try {
        const result = await syncMadaoProviderConfig(ctx, models, port, () => !disposed)
        if (disposed) return
        diag(result.conflict
          ? 'provider config unchanged: an existing madao route is not managed by this plugin'
          : result.updated
            ? `provider config merged (${models.length} models; existing channels preserved)`
            : `provider config unchanged (${models.length} models)`)
      } catch (err) {
        diag(`provider config sync failed: ${String((err as Error)?.message ?? err)}`)
      }
      if (disposed) return
      let hint = '未配置（请求会返回 503）'
      try {
        await loadCredentials()
        hint = '已解析'
      } catch (err) {
        diag(`loadCredentials failed: ${String(err)}`)
      }
      if (disposed) return
      const started = await startServer({ port, host: '127.0.0.1', gateway: config.gateway, models })
      // startServer itself awaits credentials and listen(); unloading during
      // those awaits must not leave a newly listening server behind.
      if (disposed) {
        await started.close()
        return
      }
      server = started
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