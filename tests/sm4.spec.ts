/**
 * 用 Node v26 原生 sm4-gcm 交叉验证纯 TS 实现。
 *
 * 这是关键验证：桥接服务跑在 DSH 自带的 Node v24（无 sm4-gcm）上，
 * 所以必须用纯 JS 实现。而纯 JS 实现必须与 OpenSSL 的 sm4-gcm 字节级一致，
 * 否则码道网关解不开我们的请求。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

import { sm4GcmDecrypt, sm4GcmEncrypt } from '../src/protocol/sm4.ts'

const HAS_NATIVE = (() => {
  try {
    createCipheriv('sm4-gcm', Buffer.alloc(16), Buffer.alloc(12))
    return true
  } catch {
    return false
  }
})()

/** Node 原生实现作为参照。 */
function nativeEncrypt(key: Buffer, iv: Buffer, plaintext: Buffer, aad: Buffer) {
  const c = createCipheriv('sm4-gcm', key, iv)
  c.setAAD(aad)
  const ct = Buffer.concat([c.update(plaintext), c.final()])
  return { ciphertext: ct, tag: c.getAuthTag() }
}

function nativeDecrypt(key: Buffer, iv: Buffer, ct: Buffer, tag: Buffer, aad: Buffer) {
  const d = createDecipheriv('sm4-gcm', key, iv)
  d.setAAD(aad)
  d.setAuthTag(tag)
  return Buffer.concat([d.update(ct), d.final()])
}

test('原生 sm4-gcm 可用性（仅作参照，缺失时跳过对照）', () => {
  // 仅记录，不失败：DSH 的 Node v24 本来就没有
  assert.equal(typeof HAS_NATIVE, 'boolean')
})

test('纯 TS 实现：加密后能自己解开', () => {
  const key = randomBytes(16)
  const iv = randomBytes(12)
  const aad = Buffer.from('POST|/api/v2/chat/completions|1700000000000')
  const plain = Buffer.from('{"model":"deepseek-v4.1-flash"}', 'utf8')

  const { ciphertext, tag } = sm4GcmEncrypt(key, iv, plain, aad)
  assert.equal(tag.length, 16)
  assert.equal(ciphertext.length, plain.length)

  const out = sm4GcmDecrypt(key, iv, ciphertext, tag, aad)
  assert.deepEqual(out, plain)
})

test('纯 TS 实现：AAD 不对时解密抛错', () => {
  const key = randomBytes(16)
  const iv = randomBytes(12)
  const plain = Buffer.from('hello', 'utf8')
  const { ciphertext, tag } = sm4GcmEncrypt(key, iv, plain, Buffer.from('aad-1'))
  assert.throws(() => sm4GcmDecrypt(key, iv, ciphertext, tag, Buffer.from('aad-2')))
})

test('纯 TS 实现：密文被篡改时解密抛错', () => {
  const key = randomBytes(16)
  const iv = randomBytes(12)
  const plain = Buffer.from('hello world', 'utf8')
  const { ciphertext, tag } = sm4GcmEncrypt(key, iv, plain, Buffer.from(''))
  const bad = Buffer.from(ciphertext)
  bad[0] ^= 0x01
  assert.throws(() => sm4GcmDecrypt(key, iv, bad, tag, Buffer.from('')))
})

test('与 Node 原生 sm4-gcm 字节级一致（若原生可用）', { skip: !HAS_NATIVE }, () => {
  // 覆盖多种长度：空、1B、15B、16B、17B、64B、大报文
  const lengths = [0, 1, 15, 16, 17, 64, 1024]
  for (const len of lengths) {
    const key = randomBytes(16)
    const iv = randomBytes(12)
    const aad = randomBytes(37) // 非 16 倍数，覆盖 padding
    const plain = randomBytes(len)

    const mine = sm4GcmEncrypt(key, iv, plain, aad)
    const theirs = nativeEncrypt(key, iv, plain, aad)

    assert.deepEqual(mine.ciphertext, theirs.ciphertext, `密文不一致 (len=${len})`)
    assert.deepEqual(mine.tag, theirs.tag, `tag 不一致 (len=${len})`)

    // 反向：原生加密、纯 JS 解密
    const back = sm4GcmDecrypt(key, iv, theirs.ciphertext, theirs.tag, aad)
    assert.deepEqual(back, plain, `解原生密文失败 (len=${len})`)
  }
})

test('与 Node 原生一致：真实码道 AAD 格式', { skip: !HAS_NATIVE }, () => {
  const key = randomBytes(16)
  const iv = randomBytes(12)
  const aad = Buffer.from('POST|/api/v2/chat/completions|1794471622065', 'utf8')
  const plain = Buffer.from(
    JSON.stringify({ model: 'deepseek-v4.1-flash', messages: [{ role: 'user', content: '你好' }], stream: true }),
    'utf8',
  )

  const mine = sm4GcmEncrypt(key, iv, plain, aad)
  const theirs = nativeEncrypt(key, iv, plain, aad)
  assert.deepEqual(mine.ciphertext, theirs.ciphertext)
  assert.deepEqual(mine.tag, theirs.tag)
})
