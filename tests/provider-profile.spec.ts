import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { buildMadaoProviderProfile, syncMadaoProviderConfig, type ProviderConfigEditor } from '../src/provider-profile.ts'
import { renderPatch, syncPatch } from '../src/host-patch.ts'
import type { ModelInfo } from '../src/models.ts'

type Config = Record<string, any>
const models: ModelInfo[] = [{ id: 'sample', name: 'Sample', context: 202752, maxOutput: 32768, supportsImages: true, strengths: ['high', 'max'] }]

function fixture(current: Config = {}, inherited: Config = {}, beforeEdit?: (entry: { options: { id: string; config: Config } }) => void) {
  const entry = {
    options: { id: 'llm-pi-ai', config: structuredClone(current) },
    fiber: { effectiveConfig: { providers: { get: () => entry.options.config.providers } } },
  }
  let writes = 0
  const editor: ProviderConfigEditor = {
    configuration: () => [{ entry, inherited: structuredClone(inherited) }],
    async edit(target, change) {
      assert.equal(target, entry)
      beforeEdit?.(entry)
      const next = change(structuredClone(entry.options.config), structuredClone(inherited))
      assert.doesNotThrow(() => structuredClone(next))
      entry.options.config = structuredClone(next)
      writes++
    },
  }
  return { ctx: { get: () => editor }, entry, writes: () => writes }
}

test('preserves inherited/current channels and raw expressions; never serializes Volatile.get', async () => {
  const a = { baseURL: { __jsExpr: 'process.env.PROVIDER_URL' } }
  const b = { baseURL: 'https://b.invalid/v1' }
  const f = fixture({ providers: { a }, other: { __jsExpr: 'process.env.OTHER' } }, { providers: { b }, inheritedOnly: true })
  assert.deepEqual(await syncMadaoProviderConfig(f.ctx, models), { updated: true, conflict: false })
  assert.deepEqual(f.entry.options.config.providers.a, a)
  assert.deepEqual(f.entry.options.config.providers.b, b)
  assert.deepEqual(f.entry.options.config.other, { __jsExpr: 'process.env.OTHER' })
  assert.equal(Object.hasOwn(f.entry.options.config, 'inheritedOnly'), false)
  assert.deepEqual(await syncMadaoProviderConfig(f.ctx, models), { updated: false, conflict: false })
  assert.equal(f.writes(), 1)
})

test('preserves managed channel settings while updating model metadata', async () => {
  const madao = { ...buildMadaoProviderProfile(models), timeoutMs: 12345, headers: { Authorization: 'Bearer bridge-local', 'X-Custom': 'keep' } }
  const f = fixture({ providers: { madao } })
  await syncMadaoProviderConfig(f.ctx, [{ ...models[0], name: 'Updated' }])
  assert.equal(f.entry.options.config.providers.madao.models[0].name, 'Updated')
  assert.equal(f.entry.options.config.providers.madao.timeoutMs, 12345)
  assert.equal(f.entry.options.config.providers.madao.headers['X-Custom'], 'keep')
})

test('refuses unmanaged channels in either configuration layer', async () => {
  for (const madao of [{ baseURL: 'https://user.invalid/v1' }, {}, { __jsExpr: 'process.env.MY_ROUTE' }]) {
    for (const f of [fixture({ providers: { madao } }), fixture({}, { providers: { madao } })]) {
      assert.deepEqual(await syncMadaoProviderConfig(f.ctx, models), { updated: false, conflict: true })
      assert.equal(f.writes(), 0)
    }
  }
})

test('keeps current channel changes made while waiting for the editor lock', async () => {
  const f = fixture({}, {}, entry => {
    entry.options.config.providers = {
      a: { baseURL: 'https://latest.invalid/v1' },
      madao: { ...buildMadaoProviderProfile(models), timeoutMs: 67890 },
    }
  })
  await syncMadaoProviderConfig(f.ctx, [{ ...models[0], name: 'Updated' }])
  assert.equal(f.entry.options.config.providers.madao.timeoutMs, 67890)
  assert.equal(f.entry.options.config.providers.a.baseURL, 'https://latest.invalid/v1')
})

test('aborts if a conflicting channel appears while waiting for the editor lock', async () => {
  const f = fixture({}, {}, entry => { entry.options.config.providers = { madao: { baseURL: 'https://user.invalid/v1' } } })
  assert.deepEqual(await syncMadaoProviderConfig(f.ctx, models), { updated: false, conflict: true })
  assert.equal(f.writes(), 0)
})

test('skips writing if another writer already installed the same catalog', async () => {
  const f = fixture({}, {}, entry => { entry.options.config.providers = { madao: buildMadaoProviderProfile(models) } })
  assert.deepEqual(await syncMadaoProviderConfig(f.ctx, models), { updated: false, conflict: false })
  assert.equal(f.writes(), 0)
})

test('propagates editor rejection without reporting success', async () => {
  const f = fixture()
  f.ctx.get().edit = async () => { throw new Error('overridden by a higher layer') }
  await assert.rejects(syncMadaoProviderConfig(f.ctx, models), /higher layer/)
})

test('moves a managed channel to the new bridge port', async () => {
  const f = fixture({ providers: { madao: buildMadaoProviderProfile(models, 8765) } })
  assert.deepEqual(await syncMadaoProviderConfig(f.ctx, models, 9876), { updated: true, conflict: false })
  assert.equal(f.entry.options.config.providers.madao.baseURL, 'http://127.0.0.1:9876/v1')
  assert.deepEqual(await syncMadaoProviderConfig(f.ctx, models, 9876), { updated: false, conflict: false })
  assert.equal(f.writes(), 1)
})

test('does not treat non-loopback or malformed routes as managed', async () => {
  for (const baseURL of ['http://other.invalid:8765/v1', 'http://127.0.0.1:0/v1', 'http://127.0.0.1:99999/v1', 'http://127.0.0.1:8765/v1?custom=1']) {
    const f = fixture({ providers: { madao: { ...buildMadaoProviderProfile(models), baseURL } } })
    assert.deepEqual(await syncMadaoProviderConfig(f.ctx, models), { updated: false, conflict: true })
    assert.equal(f.writes(), 0)
  }
})

test('reports missing services and empty catalogs', async () => {
  await assert.rejects(syncMadaoProviderConfig({}, models), /configEditor is unavailable/)
  await assert.rejects(syncMadaoProviderConfig({ configEditor: { configuration: () => [], async edit() {} } }, models), /configuration entry was not found/)
  assert.throws(() => buildMadaoProviderProfile([]), /at least one model/)
})

test('refuses whole-map expressions instead of overwriting them', async () => {
  const f = fixture({ providers: { __jsExpr: 'process.env.ROUTES' } })
  await assert.rejects(syncMadaoProviderConfig(f.ctx, models), /providers expression/)
  assert.equal(f.writes(), 0)
})

test('does not begin configuration work after disposal', async () => {
  assert.deepEqual(await syncMadaoProviderConfig({}, models, 8765, () => false), { updated: false, conflict: false })
})

test('cancels a queued configuration write when the plugin unloads', async () => {
  let active = true
  const f = fixture({}, {}, () => { active = false })
  assert.deepEqual(await syncMadaoProviderConfig(f.ctx, models, 8765, () => active), { updated: false, conflict: false })
  assert.equal(f.writes(), 0)
})

test('renders only the plugin entry and removes stale provider overrides idempotently', () => {
  const dir = mkdtempSync(join(tmpdir(), 'madao-provider-patch-'))
  try {
    const target = join(dir, 'cordis.patch.yml')
    writeFileSync(target, '- id: llm-pi-ai\n  config:\n    providers: {}\n')
    assert.equal(syncPatch(target, models).changed, true)
    assert.equal(readFileSync(target, 'utf8'), renderPatch())
    assert.match(renderPatch(), /id: dsh-connect-madao/)
    assert.doesNotMatch(renderPatch(models), /llm-pi-ai|providers:/)
    assert.equal(syncPatch(target, models).changed, false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('release sync script runs without credentials and cannot regenerate provider overrides', () => {
  const dir = mkdtempSync(join(tmpdir(), 'madao-release-patch-'))
  try {
    // Copy just the generator into an isolated package fixture; it must not
    // import credentials, contact the gateway, or touch this checkout's patch.
    const script = readFileSync(new URL('../sync-patch.ts', import.meta.url), 'utf8')
      .replace("'./src/host-patch.ts'", JSON.stringify(new URL('../src/host-patch.ts', import.meta.url).href))
    const target = join(dir, 'sync-patch.mts')
    writeFileSync(target, script)
    const result = spawnSync(process.execPath, ['--experimental-strip-types', target], { encoding: 'utf8', timeout: 10000 })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(readFileSync(join(dir, 'cordis.patch.yml'), 'utf8'), renderPatch())
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
