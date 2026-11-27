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

import { borrowClient, startServer, type RunningServer } from './server.ts'
import { createAutoCheckinScheduler, emptyAutoCheckinState } from './auto-checkin.ts'
import { loadCredentials, DEFAULT_CRED_PATH } from './credentials.ts'
import { StsProvider } from './sts-provider.ts'
import { MadaoClient } from './client.ts'
import { discoverModels, FALLBACK_MODELS, type ModelInfo } from './models.ts'
import { registerNativeProvider, type NativeProvider } from './native-provider.ts'
import { removeLegacyProvider, selectModels } from './model-config.ts'
import { readSettings } from './settings.ts'
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import z from '@deepseek-ai/schemastery'

export const name = 'dsh-connect-madao'
// `llm` 是原生 provider 注册（registerAdapter / registerConfigurableProviders）的前提。
export const inject: string[] = ['llm']

export const PROVIDER = 'madao'

/**
 * 原生 provider 的路由 id。
 *
 * 与旧的 llm-pi-ai 路由同名：迁移时先删掉 profile 里的 providers.madao，
 * 再由本插件注册，session 里已经选过的 madao/* 模型不需要改。
 */
export const NATIVE_PROVIDER_ID = 'madao'

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

/** schemastery 的 volatile 标记：改这些字段时只更新值，不重载插件。 */
function asVolatile<T>(schema: T): T {
  const candidate = schema as unknown as { volatile?: () => T }
  return typeof candidate.volatile === 'function' ? candidate.volatile() : schema
}

/**
 * 读一个配置值。
 *
 * volatile 字段在 apply 里拿到的是 `{ get(): T }` 活引用，不是普通值；
 * 直接当字符串用会得到 "[object Object]"（曾经因此把 AK 写成它）。
 */
function configValue<T>(value: T): T {
  const candidate = value as unknown as { get?: () => T }
  return value !== null && typeof value === 'object' && typeof candidate?.get === 'function'
    ? candidate.get!()
    : value
}

/**
 * 插件配置 schema。
 *
 * 它同时承担一个不太显眼但必要的职责：**让 DSH 的 settings 服务认识
 * `dsh-connect-madao` 这个命名空间**。模型设置页只渲染“命名空间存在”的
 * provider（`configured` 依赖 `state.namespaces.has(settingsNs)`），没有
 * schema 的插件，卡片会被直接过滤掉——哪怕 adapter 和目录项都注册好了。
 */
export const Config = z.object({
  enabled: asVolatile(z.boolean().default(true)),
  port: asVolatile(z.number().default(8765)),
  gateway: asVolatile(z.string()),
  ak: asVolatile(z.string()),
  sk: asVolatile(z.string()),
  autoSyncModels: asVolatile(z.boolean().default(true)),
})

export type MadaoConfig = z.infer<typeof Config>

export function apply(ctx: any, config: MadaoConfig = {}): void {
  const enabled = configValue(config.enabled)
  const port = configValue(config.port) ?? 8765
  const gateway = configValue(config.gateway)
  const ak = configValue(config.ak)
  const sk = configValue(config.sk)
  const autoSyncModels = configValue(config.autoSyncModels)
  diag(`apply() called; enabled=${enabled} port=${port}`)
  // 插件有自己的设置面板（客户端注册的整页），隐藏 settings 服务自动生成的那份。
  try {
    ctx.inject(['settings'], (child: any) => {
      child.effect(() => child.settings.configure({ auto: false }, ctx.fiber))
    })
  } catch (err) {
    diag(`settings.configure skipped: ${String(err)}`)
  }
  if (enabled === false) {
    diag('disabled, returning')
    return
  }

  let server: RunningServer | undefined
  let native: NativeProvider | undefined

  // 只接受字符串：schemastery 的 volatile 字段曾经把对象塞进 env，导致
  // 后续所有请求都拿 "[object Object]" 去换 STS。顺手清掉那次污染。
  for (const key of ['MADAO_AK', 'MADAO_SK'] as const) {
    if (process.env[key] === '[object Object]') delete process.env[key]
  }
  if (typeof ak === 'string' && typeof sk === 'string' && ak && sk) {
    process.env.MADAO_AK = ak
    process.env.MADAO_SK = sk
  }

  // 生命周期绑定：不因 effect 用法差异导致整个 apply 抛错
  try {
    if (typeof ctx?.effect === 'function') {
      ctx.effect(
        () => () => {
          try {
            server?.ctx.autoCheckin?.dispose()
          } catch {}
          try {
            native?.dispose()
          } catch {}
          native = void 0
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
    if (autoSyncModels === false) {
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
      const client = new MadaoClient({ credentials: creds, gateway })
      const found = await discoverModels(client)
      // 原生 provider 的模型来自内存里的 adapter，不再写 cordis.patch.yml：
      // 写进去反而会被 llm-pi-ai 当成第二条 madao 路由，造成重复注册。
      diag(`discovered ${found.models.length} models (source=${found.source})`)
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

      server = await startServer({ port, host: '127.0.0.1', gateway, models, dsh: ctx })
      diag(`bridge ready at ${server.url}/v1 (models=${models.length}, credentials: ${hint})`)

      // 由插件自己注册 provider：卡片不再带「自定义」，模型直接来自网关。
      // 旧安装里 llm-pi-ai 还占着 `madao`，先迁走再注册；失败只降级，不影响对话。
      try {
        const settings = await readSettings()
        const selected = selectModels(models, settings)
        try {
          if (await removeLegacyProvider(ctx)) diag('legacy llm-pi-ai providers.madao removed')
        } catch (err) {
          diag(`legacy provider migration failed: ${String((err as Error)?.message ?? err)}`)
        }
        // pi-ai 撤路由发生在同一次 Loader 协调里；给它几个 tick，避免撞上瞬时重复。
        for (let attempt = 1; ; attempt += 1) {
          try {
            native = await registerNativeProvider(ctx, {
              providerId: NATIVE_PROVIDER_ID,
              displayName: '码道 CodeArts',
              port: server.port,
              models: selected,
            })
            break
          } catch (err) {
            const message = String((err as Error)?.message ?? err)
            if (attempt >= 10 || !/DUPLICATE|already|registered/i.test(message)) throw err
            diag(`native registration attempt ${attempt} deferred: ${message}`)
            await new Promise((resolve) => setTimeout(resolve, 200))
          }
        }
        server.ctx.native = native
        server.ctx.describe = () => (ctx as any).get?.('settings')?.describe?.()
        diag(`native provider registered: ${NATIVE_PROVIDER_ID} (models=${selected.length})`)
      } catch (err) {
        diag(`native provider registration failed: ${String((err as Error)?.stack ?? err)}`)
      }

      // 自动签到：默认关闭，由 /settings 的开关控制。挂在这里而不是 startServer
      // 里，是因为它要复用桥接的 ctx（同一份客户端与 STS 续期）。
      const scheduler = createAutoCheckinScheduler({
        state: emptyAutoCheckinState(),
        getClient: () => borrowClient(server!.ctx),
      })
      server.ctx.autoCheckin = scheduler
      scheduler.start()
      // 开机补跑一次：命中「今天还没签」就当场领掉，不必等到下个 tick。
      void scheduler.tick().catch(() => {})
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
