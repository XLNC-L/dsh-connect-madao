/**
 * 码道传输层密码学。
 *
 * 全部参数实测自 agentkernel 内核二进制（v126.11.1）：
 *
 *   keyExchange:  ECDH 曲线 "prime256v1" (P-256)，不是 X25519。
 *                 `crypto.createECDH('prime256v1')`，publicKey 为 base64。
 *   KDF:          sessionKey = SHA256(sharedSecret)[0:16]
 *                 注意这不是 HKDF —— 就是裸 SHA256 截前 16 字节。
 *   payload:      SM4-GCM，key 16B，iv 12B，tag 16B。
 *   AAD(请求):    `${method}|${pathname}|${timestamp}`
 *   AAD(响应):    `${keyId}|${chunkIndex}` —— 与请求的 method/path/ts 无关！
 */

import { createECDH, createHash, randomBytes } from 'node:crypto'
import { sm4GcmDecrypt, sm4GcmEncrypt } from './sm4.ts'

export const CURVE = 'prime256v1'
export const SM4_ALGO = 'sm4-gcm'
export const KEY_BYTES = 16
export const IV_BYTES = 12
export const TAG_BYTES = 16

/** 一次密钥协商的结果。 */
export interface SessionKey {
  keyId: string
  /** 16 字节 SM4 密钥 */
  key: Buffer
  /** epoch ms，过期时间 */
  expiresAt: number
}

/** 12 字节随机 IV（GCM 标准长度）。 */
export function randomIv(): Buffer {
  return randomBytes(IV_BYTES)
}

/**
 * 由 ECDH 共享密钥派生 SM4 密钥。
 *
 * 内核等价实现：
 *   function GLn(n){ let u = sha256(n).digest(); return u.subarray(0,16) }
 */
export function deriveSessionKey(sharedSecret: Buffer): Buffer {
  return createHash('sha256').update(sharedSecret).digest().subarray(0, KEY_BYTES)
}

/** 构造密钥协商请求体所需的客户端 ECDH 密钥对。 */
export interface EcdhPair {
  ecdh: ReturnType<typeof createECDH>
  publicKeyB64: string
}

export function createEcdhPair(): EcdhPair {
  const ecdh = createECDH(CURVE)
  const publicKey = ecdh.generateKeys()
  return { ecdh, publicKeyB64: publicKey.toString('base64') }
}

/** 用服务端公钥算出共享密钥并派生会话密钥。 */
export function completeKeyExchange(
  pair: EcdhPair,
  serverPublicKeyB64: string,
  keyId: string,
  expiresInSec: number,
): SessionKey {
  const serverPub = Buffer.from(serverPublicKeyB64, 'base64')
  const shared = pair.ecdh.computeSecret(serverPub)
  return {
    keyId,
    key: deriveSessionKey(shared),
    expiresAt: Date.now() + (expiresInSec > 0 ? expiresInSec * 1000 : 7200_000),
  }
}

/** 请求体加密。返回加密后的字节与需要附带的头。 */
export interface EncryptedPayload {
  body: Buffer
  headers: Record<string, string>
}

export function encryptRequest(
  key: SessionKey,
  plaintext: Buffer,
  method: string,
  pathname: string,
  timestamp: number = Date.now(),
): EncryptedPayload {
  const iv = randomIv()
  const aad = Buffer.from(`${method}|${pathname}|${timestamp}`, 'utf8')

  // 用纯 TS 实现：DSH 自带 Node v24 的 OpenSSL 没有 sm4-gcm。
  const { ciphertext: ct, tag } = sm4GcmEncrypt(key.key, iv, plaintext, aad)

  // 实测：网关要求请求体是 Base64 文本，不是原始二进制。
  // iv / tag 走头，密文走 body。
  return {
    body: Buffer.from(ct.toString('base64'), 'utf8'),
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-Encrypt-Algo': SM4_ALGO,
      'X-Encrypt-Key-Id': key.keyId,
      'X-Encrypt-Iv': iv.toString('base64'),
      'X-Encrypt-Tag': tag.toString('base64'),
      'X-Encrypt-Ts': String(timestamp),
    },
  }
}

/** 单个 SSE 密文块：`iv:tag:ciphertext`，三段均为 base64。 */
export function decryptStreamChunk(
  key: SessionKey,
  block: string,
  _method: string,
  _pathname: string,
  _timestamp: number,
  chunkIndex: number,
): string {
  const parts = block.split(':')
  if (parts.length !== 3) {
    throw new Error(`Invalid encrypted SSE chunk: expected 3 fields, got ${parts.length}`)
  }
  const iv = Buffer.from(parts[0], 'base64')
  const tag = Buffer.from(parts[1], 'base64')
  const ct = Buffer.from(parts[2], 'base64')

  // 实测 AAD = `${keyId}|${chunkIndex}`，与请求无关。
  const aad = Buffer.from(`${key.keyId}|${chunkIndex}`, 'utf8')
  const plain = sm4GcmDecrypt(key.key, iv, ct, tag, aad)
  return plain.toString('utf8')
}
