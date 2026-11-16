import { test } from 'node:test'
import assert from 'node:assert/strict'

import { pickUsage, parseUpstreamEvent } from '../src/protocol/sse.ts'

test('pickUsage 认 OpenAI 原生位置 prompt_tokens_details.cached_tokens', () => {
  const u = pickUsage({
    prompt_tokens: 1436,
    completion_tokens: 16,
    total_tokens: 1452,
    prompt_tokens_details: { cached_tokens: 1024 },
  })
  assert.equal(u.prompt_tokens, 1436)
  assert.equal(u.cached_tokens, 1024)
})

test('pickUsage 认扁平 cached_tokens', () => {
  const u = pickUsage({ prompt_tokens: 100, completion_tokens: 1, total_tokens: 101, cached_tokens: 64 })
  assert.equal(u.cached_tokens, 64)
})

test('pickUsage 认 Anthropic 风格 cache_read_input_tokens', () => {
  const u = pickUsage({ prompt_tokens: 50, completion_tokens: 1, total_tokens: 51, cache_read_input_tokens: 32 })
  assert.equal(u.cached_tokens, 32)
})

test('pickUsage 认 camelCase 字段名', () => {
  const u = pickUsage({
    promptTokens: 10,
    completionTokens: 2,
    totalTokens: 12,
    promptTokensDetails: { cached_tokens: 8 },
  })
  assert.equal(u.prompt_tokens, 10)
  assert.equal(u.completion_tokens, 2)
  assert.equal(u.cached_tokens, 8)
})

test('上游不给缓存字段时 cached_tokens 是 undefined 而不是 0', () => {
  const u = pickUsage({ prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 })
  assert.equal(u.cached_tokens, undefined)
})

test('pickUsage 拿到脏数据不炸', () => {
  const u = pickUsage({ prompt_tokens: 1, prompt_tokens_details: { cached_tokens: 'nope' } })
  assert.equal(u.cached_tokens, undefined)
})

test('pickUsage 空对象全部归零', () => {
  const u = pickUsage({})
  assert.deepEqual(u, { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 })
})

test('pickUsage null/undefined 安全', () => {
  assert.deepEqual(pickUsage(null), { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 })
  assert.deepEqual(pickUsage(undefined), { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 })
})

test('parseUpstreamEvent 会把缓存字段解析出来（choices 为空的独立 usage 帧）', () => {
  const ev = parseUpstreamEvent(
    JSON.stringify({
      id: 'x',
      object: 'chat.completion.chunk',
      choices: [],
      usage: {
        prompt_tokens: 1436,
        completion_tokens: 16,
        total_tokens: 1452,
        prompt_tokens_details: { cached_tokens: 1024 },
      },
    }),
  )
  assert.ok(ev.usage)
  assert.equal(ev.usage.cached_tokens, 1024)
})

test('缓存数大于 prompt_tokens 时不篡改（交给上层判断）', () => {
  // 上游理论上不该这样，但真出现时我们如实透传，不悄悄 clamp
  const u = pickUsage({ prompt_tokens: 100, completion_tokens: 1, total_tokens: 101, cached_tokens: 500 })
  assert.equal(u.cached_tokens, 500)
})
test('空字符串不能当成"命中 0 个缓存"', () => {
  // Number('') === 0，不挡住的话会把「上游没给」变成「命中 0 个」
  const u = pickUsage({ prompt_tokens: 10, completion_tokens: 1, total_tokens: 11, cached_tokens: '' })
  assert.equal(u.cached_tokens, undefined)
})

test('布尔值不能当成缓存数', () => {
  // Number(false) === 0
  const u = pickUsage({ prompt_tokens: 10, cached_tokens: false as any })
  assert.equal(u.cached_tokens, undefined)
  const u2 = pickUsage({ prompt_tokens: 10, cached_tokens: true as any })
  assert.equal(u2.cached_tokens, undefined)
})

test('负数缓存数视为无效', () => {
  const u = pickUsage({ prompt_tokens: 10, cached_tokens: -5 })
  assert.equal(u.cached_tokens, undefined)
})

test('数字字符串可以接受', () => {
  const u = pickUsage({ prompt_tokens: 100, cached_tokens: '64' })
  assert.equal(u.cached_tokens, 64)
})

test('认全驼峰 promptTokensDetails.cachedTokens', () => {
  const u = pickUsage({
    promptTokens: 100,
    promptTokensDetails: { cachedTokens: 80 },
  })
  assert.equal(u.cached_tokens, 80)
})

test('真命中 0 个时保留 0（与"没给"区分开）', () => {
  const u = pickUsage({ prompt_tokens: 100, cached_tokens: 0 })
  assert.equal(u.cached_tokens, 0)
})
