import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildProviderModel } from '../src/host-patch.ts'
import { applyModelSelection, mergeProviderConfig, selectModels, stripLegacyProvider } from '../src/model-config.ts'
import { buildPiModel } from '../src/native-provider.ts'
import { normalizeSettings } from '../src/settings.ts'
import type { ModelInfo } from '../src/models.ts'

const MODELS: ModelInfo[] = [
  {
    id: 'glm-5.3',
    name: 'GLM-5.3',
    context: 1048576,
    maxOutput: 32768,
    ratio: '0.79x',
    supportsImages: false,
    strengths: ['low', 'high'],
    defaultStrength: 'high',
  },
  {
    id: 'GLM-5.2',
    name: 'GLM-5.2',
    context: 202752,
    maxOutput: 32768,
    ratio: '0.7x',
    supportsImages: false,
    strengths: [],
  },
]

test('normalizeSettings defaults the new model fields', () => {
  const settings = normalizeSettings({ composerChip: false })
  assert.equal(settings.composerChip, false)
  assert.deepEqual(settings.hiddenModels, [])
  assert.deepEqual(settings.contextCaps, {})
})

test('normalizeSettings keeps only valid hidden ids and caps', () => {
  const settings = normalizeSettings({
    hiddenModels: ['GLM-5.2', 'GLM-5.2', '', 42, null, 'glm-5.3'],
    contextCaps: { 'glm-5.3': 262144, 'GLM-5.2': -1, broken: 'x', '': 65536 },
  })
  assert.deepEqual(settings.hiddenModels, ['GLM-5.2', 'glm-5.3'])
  assert.deepEqual(settings.contextCaps, { 'glm-5.3': 262144 })
})

test('selectModels filters hidden models and only lowers the context', () => {
  const selected = selectModels(MODELS, {
    hiddenModels: ['GLM-5.2'],
    contextCaps: { 'glm-5.3': 262144, 'GLM-5.2': 65536 },
  })
  assert.deepEqual(selected.map((model) => model.id), ['glm-5.3'])
  assert.equal(selected[0].context, 262144)
})

test('selectModels ignores a cap larger than the gateway value', () => {
  const selected = selectModels(MODELS, { hiddenModels: [], contextCaps: { 'GLM-5.2': 999999 } })
  const glm52 = selected.find((model) => model.id === 'GLM-5.2')
  assert.equal(glm52?.context, 202752)
})

test('buildProviderModel emits the same shape as the YAML patch', () => {
  const config = buildProviderModel(MODELS[0])
  assert.equal(config.name, 'GLM-5.3 · 0.79x')
  assert.equal(config.contextWindow, 1048576)
  assert.equal(config.maxTokens, 32768)
  assert.deepEqual(config.input, ['text'])
  assert.deepEqual(config.reasoningEfforts, { off: null, low: 'low', high: 'high' })

  const plain = buildProviderModel(MODELS[1])
  assert.equal(plain.reasoningEfforts, false)
})

test('mergeProviderConfig replaces only the madao provider', () => {
  const current = {
    providers: {
      'ark-coding-plan': { api: 'openai-completions', models: [{ id: 'ark' }] },
      madao: { displayName: '旧值', api: 'openai-completions', models: [{ id: 'old' }] },
    },
  }
  const next = mergeProviderConfig(current, {}, [MODELS[1]], 8765)
  const providers = next.providers as Record<string, any>
  assert.deepEqual(providers['ark-coding-plan'], current.providers['ark-coding-plan'])
  assert.equal(providers.madao.displayName, '码道 CodeArts')
  assert.equal(providers.madao.baseURL, 'http://127.0.0.1:8765/v1')
  assert.deepEqual(
    providers.madao.models.map((model: any) => model.id),
    ['GLM-5.2'],
  )
  // 输入对象不能被改写（config-editor 会拿它做比较）
  assert.equal((current.providers.madao.models[0] as any).id, 'old')
})

test('mergeProviderConfig falls back to the inherited layer when there is no override', () => {
  const inherited = { providers: { madao: { models: [{ id: 'old' }] } } }
  const next = mergeProviderConfig({}, inherited, [MODELS[0]], 8765)
  const providers = next.providers as Record<string, any>
  assert.deepEqual(
    providers.madao.models.map((model: any) => model.id),
    ['glm-5.3'],
  )
})
test('applyModelSelection writes through configEditor and reports live', async () => {
  let written: any
  const editor = {
    entries: () => [{ options: { id: 'other' } }, { options: { id: 'llm-pi-ai' } }],
    edit: async (_entry: unknown, change: (current: unknown, inherited: unknown) => unknown) => {
      written = change({ providers: { madao: { models: [{ id: 'old' }] } } }, {})
    },
  }
  const dsh = { get: (name: string) => (name === 'configEditor' ? editor : undefined) }
  const outcome = await applyModelSelection(dsh, MODELS, { hiddenModels: ['GLM-5.2'], contextCaps: {} }, 8765)
  assert.equal(outcome.mode, 'live')
  assert.equal(outcome.applied, 1)
  assert.deepEqual(
    (written.providers.madao.models as any[]).map((model) => model.id),
    ['glm-5.3'],
  )
})

test('applyModelSelection refuses to hide every model', async () => {
  const outcome = await applyModelSelection(
    { get: () => ({ entries: () => [], edit: async () => {} }) },
    MODELS,
    { hiddenModels: MODELS.map((model) => model.id), contextCaps: {} },
    8765,
  )
  assert.equal(outcome.mode, 'failed')
  assert.match(String(outcome.error), /至少要保留一个模型/)
})

test('applyModelSelection reports unavailable when the host has no configEditor', async () => {
  const outcome = await applyModelSelection(undefined, MODELS, { hiddenModels: [], contextCaps: {} }, 8765)
  assert.equal(outcome.mode, 'unavailable')
})

test('applyModelSelection escapes an inherited HMR transaction', async () => {
  let exited = false
  const editor = {
    entries: () => [{ options: { id: 'llm-pi-ai' } }],
    edit: async () => {},
  }
  const executing = {
    getStore: () => true,
    exit: <T,>(fn: () => T): T => {
      exited = true
      return fn()
    },
  }
  const dsh = {
    get: (name: string) => (name === 'configEditor' ? editor : name === 'hmr' ? { executing } : undefined),
  }
  const outcome = await applyModelSelection(dsh, MODELS, { hiddenModels: [], contextCaps: {} }, 8765)
  assert.equal(outcome.mode, 'live')
  assert.equal(exited, true)
})

test('buildPiModel：字段与 llm-pi-ai 配置同源，思考档位映射成 wire 名', () => {
  const model = MODELS.find((entry) => entry.id === 'glm-5.3')!
  const pi = buildPiModel(model, 'madao', 'http://127.0.0.1:8765/v1') as any
  assert.equal(pi.id, 'glm-5.3')
  assert.equal(pi.api, 'openai-completions')
  assert.equal(pi.provider, 'madao')
  assert.equal(pi.baseUrl, 'http://127.0.0.1:8765/v1')
  assert.deepEqual(pi.input, ['text'])
  assert.equal(pi.contextWindow, model.context)
  assert.equal(pi.maxTokens, model.maxOutput)
  assert.equal(pi.reasoning, true)
  assert.equal(pi.compat.supportsReasoningEffort, true)
  // 只声明模型真正支持的档位；其余给 null，表示“不可选”。
  assert.equal(pi.thinkingLevelMap.low, 'low')
  assert.equal(pi.thinkingLevelMap.high, 'high')
  assert.equal(pi.thinkingLevelMap.minimal, null)
  assert.equal(pi.thinkingLevelMap.off, null)
})

test('buildPiModel：不支持思考的模型不声明 thinkingLevelMap', () => {
  const model = MODELS.find((entry) => entry.strengths.length === 0)
  if (!model) return
  const pi = buildPiModel(model, 'madao', 'http://127.0.0.1:8765/v1') as any
  assert.equal(pi.reasoning, false)
  assert.equal(pi.compat.supportsReasoningEffort, false)
  assert.equal('thinkingLevelMap' in pi, false)
})

test('stripLegacyProvider：只删 madao，保留同一行的其它 provider', () => {
  const next = stripLegacyProvider({
    providers: {
      madao: { displayName: '码道 CodeArts' },
      'ark-coding-plan': { apiKeyEnv: 'ARK_KEY' },
    },
  })
  assert.ok(next)
  assert.deepEqual(Object.keys((next as any).providers), ['ark-coding-plan'])

  // 没有 madao 时返回 undefined，调用方据此跳过写盘。
  assert.equal(stripLegacyProvider({ providers: { 'ark-coding-plan': {} } }), undefined)
  assert.equal(stripLegacyProvider(undefined), undefined)
  assert.equal(stripLegacyProvider({}), undefined)
})
