#!/usr/bin/env node
/**
 * dsh-connect-madao — 把华为云码道（CodeArts Agent）模型接入 DeepSeek Harness。
 *
 * 子命令：
 *   serve     启动 OpenAI 兼容服务（默认 127.0.0.1:8765）
 *   doctor    自检：凭证 → STS → 密钥协商 → 模型清单
 *   models    打印内置模型表
 */

import { startServer } from './server.ts'
import { loadCredentials, maskKey } from './credentials.ts'
import { StsProvider } from './sts-provider.ts'
import { MadaoClient } from './client.ts'

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1]
  return fallback
}

async function cmdServe(): Promise<void> {
  const port = Number(arg('port', '8765'))
  const host = arg('host', '127.0.0.1')!
  const gateway = arg('gateway')

  const srv = await startServer({ port, host, gateway })
  console.log(`dsh-connect-madao listening on ${srv.url}`)
  console.log(`  OpenAI base URL : ${srv.url}/v1`)
  console.log(`  health          : ${srv.url}/healthz`)

  const shutdown = async () => {
    await srv.close()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

async function cmdDoctor(): Promise<void> {
  console.log('== dsh-connect-madao doctor ==\n')

  // 1) 凭证
  let loaded
  try {
    loaded = await loadCredentials()
  } catch (err) {
    console.error('✗ 凭证加载失败')
    console.error(String((err as Error).message))
    process.exit(1)
  }
  const m = maskKey(loaded.key.ak, loaded.key.sk)
  console.log('✓ 凭证已加载')
  console.log(`  来源: ${loaded.source}${loaded.path ? ` (${loaded.path})` : ''}`)
  console.log(`  AK: ${m.ak}   SK: ${m.sk}`)
  console.log(`  STS: ${loaded.key.securityToken ? '已直接提供' : '待换取'}\n`)

  // 2) STS
  let creds: { ak: string; sk: string; securityToken: string }
  if (loaded.key.securityToken) {
    creds = { ak: loaded.key.ak, sk: loaded.key.sk, securityToken: loaded.key.securityToken }
    console.log('✓ 使用已提供的 STS\n')
  } else {
    console.log('== 换取 STS ==')
    try {
      const sts = new StsProvider({ ak: loaded.key.ak, sk: loaded.key.sk })
      creds = await sts.credentials()
      const exp = sts.expiresAtMs()
      console.log('✓ 成功')
      console.log(`  临时 AK: ${creds.ak}`)
      console.log(`  STS 长度: ${creds.securityToken.length}`)
      if (exp) console.log(`  过期: ${new Date(exp).toISOString()}`)
      console.log()
    } catch (err) {
      console.error('✗ 失败')
      console.error(String((err as Error).message).slice(0, 600))
      process.exit(1)
    }
  }

  // 3) 密钥协商
  console.log('== 密钥协商 ==')
  const client = new MadaoClient({ credentials: creds })
  try {
    const key = await client.ensureSessionKey()
    console.log('✓ 成功')
    console.log(`  keyId: ${key.keyId}`)
    console.log(`  TTL: ${Math.round((key.expiresAt - Date.now()) / 1000)}s\n`)
  } catch (err) {
    console.error('✗ 失败')
    console.error(String((err as Error).message).slice(0, 600))
    process.exit(1)
  }

  // 4) 模型清单
  console.log('== 模型清单 ==')
  try {
    const models = (await client.getModels()) as any
    const list = models?.builtinModels ?? []
    console.log(`✓ ${list.length} 个模型`)
    for (const it of list) console.log(`  - ${it.model_id}  (${it.model_category ?? ''})`)
  } catch (err) {
    console.warn('⚠ 拉取失败（不影响 chat）:', String((err as Error).message).slice(0, 200))
  }
}

/**
 * 打印模型清单。
 *
 * 默认打网关实时结果（与 DSH 里看到的完全一致）；
 * 加 `--write` 则顺手把清单写回插件自带的 cordis.patch.yml。
 */
async function cmdModels(): Promise<void> {
  const write = process.argv.includes('--write')
  const { loadCredentials } = await import('./credentials.ts')
  const { StsProvider } = await import('./sts-provider.ts')
  const { MadaoClient } = await import('./client.ts')
  const { discoverModels } = await import('./models.ts')
  const { syncPatch } = await import('./host-patch.ts')
  const { dirname, join } = await import('node:path')
  const { fileURLToPath } = await import('node:url')

  try {
    const loaded = await loadCredentials()
    let creds = loaded.key
    if (!creds.securityToken) creds = await new StsProvider({ ak: creds.ak, sk: creds.sk }).credentials()
    const client = new MadaoClient({ credentials: creds })
    const found = await discoverModels(client)

    if (found.source === 'fallback') {
      console.log(`网关不可达，以下为兜底清单：${found.error ?? ''}`)
    }
    for (const m of found.models) {
      const tags = [m.supportsImages ? '🖼' : '', m.strengths.length ? `思考:${m.strengths.join('/')}` : '']
        .filter(Boolean)
        .join(' ')
      console.log(
        `${m.id.padEnd(26)} ${m.name.padEnd(22)} ctx=${String(m.context).padEnd(8)} max=${String(m.maxOutput).padEnd(6)} ${(m.ratio ?? '-').padEnd(7)} ${tags}`,
      )
    }

    if (write) {
      const here = dirname(fileURLToPath(import.meta.url))
      const target = join(here, '..', 'cordis.patch.yml')
      const r = syncPatch(target, found.models)
      console.log(r.error ? `\n写回失败：${r.error}` : `\n${r.changed ? '已写入' : '无变化'} → ${r.path}`)
    }
  } catch (e) {
    console.error(`读取模型清单失败：${String((e as Error)?.message ?? e)}`)
    process.exitCode = 1
  }
}

const cmd = process.argv[2] ?? 'serve'
const table: Record<string, () => Promise<void>> = {
  serve: cmdServe,
  doctor: cmdDoctor,
  models: cmdModels,
}

const fn = table[cmd]
if (!fn) {
  console.error(`未知子命令: ${cmd}\n可用: ${Object.keys(table).join(', ')}`)
  process.exit(2)
}
fn().catch((err) => {
  console.error(String(err?.stack ?? err))
  process.exit(1)
})

