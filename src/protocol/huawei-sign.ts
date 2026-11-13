/**
 * 华为云标准 AK/SK 签名（IAM / STS 用）。
 *
 * 与码道网关的 signSimple 有两点差异：
 *   1. X-Sdk-Date 相同，但 path 的尾斜杠规则：这里是**原样**，不补 "/"。
 *   2. Content-Type 参与签名时用的是实际发送值。
 *
 * 规范：
 *   CanonicalRequest =
 *     HTTPMethod \n
 *     CanonicalURI \n
 *     CanonicalQueryString \n
 *     CanonicalHeaders \n      ← 每行 "name:value\n"，按 name 字典序
 *     SignedHeaders \n
 *     HexEncode(SHA256(RequestPayload))
 *
 *   StringToSign =
 *     Algorithm \n
 *     RequestDateTime \n
 *     HexEncode(SHA256(CanonicalRequest))
 *
 *   Signature = HexEncode(HMAC-SHA256(SecretKey, StringToSign))
 */

import { createHash, createHmac } from 'node:crypto'

export function huaweiSdkDate(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T` +
    `${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
  )
}

export interface HuaweiSignOptions {
  method: string
  host: string
  /** 原样路径，不补尾斜杠 */
  path: string
  query?: string
  contentType?: string
  body?: string
  ak: string
  sk: string
  securityToken?: string
  sdkDate?: string
}

export function signHuawei(opts: HuaweiSignOptions): Record<string, string> {
  const method = opts.method.toUpperCase()
  const sdkDateVal = opts.sdkDate ?? huaweiSdkDate()
  const body = opts.body ?? ''
  const payloadHash = createHash('sha256').update(body).digest('hex')

  const headers: Record<string, string> = {
    Host: opts.host,
    'X-Sdk-Date': sdkDateVal,
  }
  if (opts.contentType) headers['Content-Type'] = opts.contentType
  if (opts.securityToken) headers['X-Security-Token'] = opts.securityToken

  // 按小写名排序
  const entries = Object.entries(headers)
    .map(([k, v]) => [k.toLowerCase(), v] as const)
    .sort((a, b) => a[0].localeCompare(b[0]))

  const canonicalHeaders = entries.map(([k, v]) => `${k}:${v.trim()}\n`).join('')
  const signedHeaders = entries.map(([k]) => k).join(';')

  const canonicalRequest = [
    method,
    opts.path,
    opts.query ?? '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n')

  const stringToSign = [
    'SDK-HMAC-SHA256',
    sdkDateVal,
    createHash('sha256').update(canonicalRequest).digest('hex'),
  ].join('\n')

  const signature = createHmac('sha256', opts.sk).update(stringToSign).digest('hex')

  return {
    ...headers,
    Authorization: `SDK-HMAC-SHA256 Access=${opts.ak}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  }
}
