/**
 * 华为云 APIG 的 SDK-HMAC-SHA256 签名（码道网关用）。
 *
 * 每一步都用真实网关验证过，规则如下：
 *
 *   CanonicalRequest =
 *     METHOD \n
 *     CanonicalURI \n            ← **补尾斜杠**（实际请求路径不补）
 *     "" \n                      ← CanonicalQueryString
 *     CanonicalHeaders \n        ← "小写名:值\n"，按名排序，只含实际发送的头
 *     SignedHeaders \n
 *     HexEncode(SHA256(body))    ← **真实 body 哈希**，不是 UNSIGNED-PAYLOAD
 *
 *   StringToSign =
 *     "SDK-HMAC-SHA256" \n
 *     X-Sdk-Date \n
 *     HexEncode(SHA256(CanonicalRequest))
 *
 *   Signature = HexEncode(HMAC-SHA256(SK, StringToSign))
 *
 * ⚠ 四个坑，全部实测确认：
 *
 *   1. **路径**：签名用带尾斜杠的 `/a/b/c/`，请求发不带斜杠的 `/a/b/c`。
 *   2. **payloadHash 用真实 body 的 SHA256**，不是 `UNSIGNED-PAYLOAD`。
 *      GET 请求 body 为空，即 SHA256("")。
 *   3. **SignedHeaders 必须与实际发送的头一一对应**，多签少签都 401。
 *   4. **不要签 `x-sdk-content-sha256`**，多签会 401。
 */

import { createHash, createHmac } from 'node:crypto'

export const SIGN_ALGO = 'SDK-HMAC-SHA256'

export interface Credentials {
  ak: string
  sk: string
  securityToken: string
}

export interface SignInput {
  method: string
  url: URL
  /** 传 null 表示请求不发送 Content-Type（如 GET） */
  contentType: string | null
  /** 请求体原文；GET 传空串。参与哈希计算 */
  body?: string
  /** 二进制请求体（优先于 body），用于加密后的载荷 */
  bodyBytes?: Buffer
  credentials: Credentials
  /** 可注入固定时间，便于测试 */
  sdkDate?: string
}

/** 生成 `YYYYMMDDTHHMMSSZ`（UTC）。 */
export function formatSdkDate(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T` +
    `${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
  )
}

/** CanonicalURI：签名时补尾斜杠。 */
export function canonicalUri(pathname: string): string {
  const encoded = pathname.split('/').map((seg) => encodeURIComponent(seg)).join('/')
  return encoded.endsWith('/') ? encoded : `${encoded}/`
}

function canonicalHeaders(headers: Record<string, string>): { block: string; signed: string } {
  const lower = new Map<string, string>()
  for (const [k, v] of Object.entries(headers)) lower.set(k.toLowerCase(), v)

  const names = [...lower.keys()].sort((a, b) => a.localeCompare(b))
  const block = names.map((n) => `${n}:${(lower.get(n) ?? '').replace(/[\r\n]/g, ' ').trim()}\n`).join('')
  return { block, signed: names.join(';') }
}

/**
 * 返回的头**必须原样附加到请求上**——签名与发送的头集合要一一对应。
 */
export interface SignedHeaders extends Record<string, string> {
  Host: string
  'X-Sdk-Date': string
  'X-Security-Token': string
  Authorization: string
  'Content-Type'?: string
}

/** 产出签名头。调用方把这些头原样发出，不要增删。 */
export function signRequest(input: SignInput): SignedHeaders {
  const { method, url, contentType, credentials } = input
  const sdkDate = input.sdkDate ?? formatSdkDate()
  const payloadHash = input.bodyBytes
    ? createHash('sha256').update(input.bodyBytes).digest('hex')
    : createHash('sha256').update(input.body ?? '').digest('hex')

  const host =
    url.port && !isDefaultPort(url.protocol, url.port) ? `${url.hostname}:${url.port}` : url.hostname

  const toSign: Record<string, string> = {
    Host: host,
    'X-Sdk-Date': sdkDate,
    'X-Security-Token': credentials.securityToken,
  }
  if (contentType) toSign['Content-Type'] = contentType

  const { block, signed } = canonicalHeaders(toSign)
  const canonicalRequest = [
    method.toUpperCase(),
    canonicalUri(url.pathname),
    url.search ? url.search.slice(1) : '',
    block,
    signed,
    payloadHash,
  ].join('\n')

  const stringToSign = [
    SIGN_ALGO,
    sdkDate,
    createHash('sha256').update(canonicalRequest).digest('hex'),
  ].join('\n')

  const signature = createHmac('sha256', credentials.sk).update(stringToSign).digest('hex')

  const out: SignedHeaders = {
    Host: host,
    'X-Sdk-Date': sdkDate,
    'X-Security-Token': credentials.securityToken,
    Authorization: `${SIGN_ALGO} Access=${credentials.ak}, SignedHeaders=${signed}, Signature=${signature}`,
  }
  if (contentType) out['Content-Type'] = contentType
  return out
}

function isDefaultPort(protocol: string, port: string): boolean {
  return (protocol === 'https:' && port === '443') || (protocol === 'http:' && port === '80')
}
