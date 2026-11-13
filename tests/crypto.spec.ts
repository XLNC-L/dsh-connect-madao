/**
 * 密码层与签名规范验证。
 *
 * 这里的断言全部对应**实测确认的行为**（见 ../PROTOCOL.md），
 * 不是推测。任何一条变红都说明实现偏离了真实网关。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createCipheriv, createECDH, createHash } from 'node:crypto'

import {
  completeKeyExchange,
  createEcdhPair,
  decryptStreamChunk,
  deriveSessionKey,
  encryptRequest,
} from '../src/protocol/crypto.ts'
import { canonicalUri, formatSdkDate, signRequest } from '../src/protocol/sign.ts'
import { buildUpstreamBody, normalizeContent } from '../src/protocol/body.ts'
import { parseUpstreamEvent } from '../src/protocol/sse.ts'

// ── ECDH / KDF ────────────────────────────────────────────────

test('曲线是 P-256，双方算出同一 shared secret', () => {
  const a = createECDH('prime256v1')
  const b = createECDH('prime256v1')
  a.generateKeys()
  b.generateKeys()
  assert.deepEqual(a.computeSecret(b.getPublicKey()), b.computeSecret(a.getPublicKey()))
})

test('KDF 是裸 SHA256 截前 16 字节，不是 HKDF', () => {
  const shared = Buffer.from('0123456789abcdef0123456789abcdef', 'utf8')
  const expected = createHash('sha256').update(shared).digest().subarray(0, 16)
  assert.deepEqual(deriveSessionKey(shared), expected)
  assert.equal(deriveSessionKey(shared).length, 16)
})

test('完整握手：客户端 pair + 服务端公钥 → 会话密钥', () => {
  const pair = createEcdhPair()
  const server = createECDH('prime256v1')
  server.generateKeys()

  const sk = completeKeyExchange(pair, server.getPublicKey().toString('base64'), 'kid-1', 7200)
  const serverShared = server.computeSecret(Buffer.from(pair.publicKeyB64, 'base64'))

  assert.deepEqual(sk.key, deriveSessionKey(serverShared))
  assert.equal(sk.keyId, 'kid-1')
  assert.ok(sk.expiresAt > Date.now())
})

// ── 载荷加密 ──────────────────────────────────────────────────

test('请求体：密文以 Base64 文本发送，iv 12B / tag 16B', () => {
  const pair = createEcdhPair()
  const server = createECDH('prime256v1')
  server.generateKeys()
  const sk = completeKeyExchange(pair, server.getPublicKey().toString('base64'), 'kid', 7200)

  const plain = Buffer.from(JSON.stringify({ model: 'x', hello: '世界' }), 'utf8')
  const { body, headers } = encryptRequest(sk, plain, 'POST', '/api/v2/chat/completions', 1700000000000)

  assert.equal(headers['X-Encrypt-Algo'], 'sm4-gcm')
  assert.equal(headers['X-Encrypt-Key-Id'], 'kid')
  assert.equal(Buffer.from(headers['X-Encrypt-Iv'], 'base64').length, 12)
  assert.equal(Buffer.from(headers['X-Encrypt-Tag'], 'base64').length, 16)

  // ★ 关键：body 是 Base64 的 ASCII 文本，不是原始二进制
  const text = body.toString('utf8')
  assert.match(text, /^[A-Za-z0-9+/]+={0,2}$/)
  assert.ok(text.length > 0)
})

test('SSE 解密：AAD 是 keyId|chunkIndex，与 method/path/ts 无关', () => {
  const pair = createEcdhPair()
  const server = createECDH('prime256v1')
  server.generateKeys()
  const sk = completeKeyExchange(pair, server.getPublicKey().toString('base64'), 'kid-abc', 7200)

  const plaintexts = ['data:{"a":1}', 'data:{"a":2}', 'data:[DONE]']

  // 按实测规则造密文：AAD = `${keyId}|${index}`
  const blocks = plaintexts.map((pt, idx) => {
    const iv = Buffer.alloc(12, idx + 1)
    const c = createCipheriv('sm4-gcm', sk.key, iv)
    c.setAAD(Buffer.from(`${sk.keyId}|${idx}`, 'utf8'))
    const ct = Buffer.concat([c.update(Buffer.from(pt, 'utf8')), c.final()])
    return `${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${ct.toString('base64')}`
  })

  blocks.forEach((b, i) => {
    // 传入的 method/path/ts 全部用垃圾值，证明它们不参与 AAD
    const got = decryptStreamChunk(sk, b, 'GARBAGE', '/whatever', 0, i)
    assert.equal(got, plaintexts[i])
  })

  // chunkIndex 错位必须失败
  assert.throws(() => decryptStreamChunk(sk, blocks[0], 'POST', '/x', 0, 99))
})

// ── 签名 ──────────────────────────────────────────────────────

test('canonicalUri 逐段编码并补尾斜杠', () => {
  assert.equal(canonicalUri('/api/v2/chat/completions'), '/api/v2/chat/completions/')
  assert.equal(canonicalUri('/'), '/')
  assert.equal(canonicalUri('/a b/c'), '/a%20b/c/')
})

test('formatSdkDate 产出 YYYYMMDDTHHMMSSZ', () => {
  assert.equal(formatSdkDate(new Date(Date.UTC(2026, 10, 12, 8, 20, 22))), '20261112T082022Z')
})

test('签名只覆盖实际发送的头，且 payloadHash 是真实 body 哈希', () => {
  const url = new URL('https://snap-access.cn-north-4.myhuaweicloud.com/v1/model/builtin')
  const h = signRequest({
    method: 'GET',
    url,
    contentType: null, // GET 不发 Content-Type
    body: '',
    credentials: { ak: 'AKT', sk: 'SKT', securityToken: 'TOK' },
    sdkDate: '20261112T082022Z',
  })

  // ★ 关键：content-type 不在 SignedHeaders 里，因为请求没发它
  assert.equal(
    h.Authorization.includes('SignedHeaders=host;x-sdk-date;x-security-token'),
    true,
    `实际: ${h.Authorization}`,
  )
  assert.equal(h['Content-Type'], undefined, '不应凭空产生 Content-Type')

  // payloadHash 应为 SHA256("")，不是 UNSIGNED-PAYLOAD
  // 通过比对签名值间接验证：用相同输入重算必须得到同一签名
  const h2 = signRequest({
    method: 'GET',
    url,
    contentType: null,
    body: '',
    credentials: { ak: 'AKT', sk: 'SKT', securityToken: 'TOK' },
    sdkDate: '20261112T082022Z',
  })
  assert.equal(h.Authorization, h2.Authorization, '同样输入必须可复现')

  // 换 body 必须换签名（证明 body 参与了哈希）
  const h3 = signRequest({
    method: 'GET',
    url,
    contentType: null,
    body: '{"a":1}',
    credentials: { ak: 'AKT', sk: 'SKT', securityToken: 'TOK' },
    sdkDate: '20261112T082022Z',
  })
  assert.notEqual(h.Authorization, h3.Authorization, 'body 变化必须影响签名')
})

test('带 Content-Type 时它进入 SignedHeaders', () => {
  const url = new URL('https://x.test/a/b')
  const h = signRequest({
    method: 'POST',
    url,
    contentType: 'application/octet-stream',
    body: 'xyz',
    credentials: { ak: 'AKT', sk: 'SKT', securityToken: 'TOK' },
    sdkDate: '20260101T000000Z',
  })
  assert.equal(
    h.Authorization.includes('SignedHeaders=content-type;host;x-sdk-date;x-security-token'),
    true,
  )
  assert.equal(h['Content-Type'], 'application/octet-stream')
})

// ── 请求体与 SSE 解析 ─────────────────────────────────────────

test('请求体就是 OpenAI 形状，content 数组折成字符串', () => {
  const out = buildUpstreamBody({
    model: 'deepseek-v4.1-flash',
    messages: [{ role: 'user', content: [{ type: 'text', text: '你好' }] }],
    max_tokens: 100,
    stream: false,
  })
  assert.equal(out.model, 'deepseek-v4.1-flash')
  assert.equal(out.messages[0]?.content, '你好')
  assert.equal(out.stream, true, '本插件只走流式')
  assert.equal(out.max_tokens, 100)
})

test('normalizeContent 处理字符串/数组/空数组', () => {
  assert.equal(normalizeContent('abc'), 'abc')
  assert.equal(normalizeContent([{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }]), 'ab')
  assert.equal(normalizeContent([] as any), '')
})

test('SSE 解析识别 OpenAI chunk 的正文与推理', () => {
  const textEv = parseUpstreamEvent('{"choices":[{"index":0,"delta":{"content":"你好"},"finish_reason":null}]}')
  assert.equal(textEv.text, '你好')

  const reasonEv = parseUpstreamEvent('{"choices":[{"index":0,"delta":{"reasoning_content":"思考"}}]}')
  assert.equal(reasonEv.reasoning, '思考')

  const doneEv = parseUpstreamEvent('[DONE]')
  assert.equal(doneEv.done, true)

  const usageEv = parseUpstreamEvent(
    '{"choices":[],"usage":{"prompt_tokens":1,"completion_tokens":2,"total_tokens":3}}',
  )
  assert.deepEqual(usageEv.usage, { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 })
})
