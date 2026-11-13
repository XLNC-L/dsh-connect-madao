/**
 * IAM 换 STS 诊断器：一次尝试多种候选签名变体，看哪一种被接受。
 *
 * 变体维度：
 *   A. canonical URI 是否补尾斜杠
 *   B. Content-Type 是否参与签名
 *   C. 是否带 X-Security-Token
 *   D. sdk-date 用 GET/POST 两种规范
 */

import { createHash, createHmac } from 'node:crypto'

const HOST = 'iam.cn-north-4.myhuaweicloud.com'

function sdkDate(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T` +
    `${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
  )
}

interface Variant {
  name: string
  /** canonical URI */
  uri: string
  /** 是否把 content-type 纳入签名 */
  signContentType: boolean
  /** 实际发送的 content-type */
  contentType: string | null
  /** 是否附带 content-length 到签名 */
  signContentLength: boolean
}

function build(opts: {
  method: string
  uri: string
  host: string
  contentType: string | null
  signContentType: boolean
  signContentLength: boolean
  bodyLen: number
  bodyHash: string
  ak: string
  sk: string
  date: string
}) {
  const headers: Array<[string, string]> = [
    ['host', opts.host],
    ['x-sdk-date', opts.date],
  ]
  if (opts.signContentType && opts.contentType) headers.push(['content-type', opts.contentType])
  if (opts.signContentLength) headers.push(['content-length', String(opts.bodyLen)])

  headers.sort((a, b) => a[0].localeCompare(b[0]))

  const canonicalHeaders = headers.map(([k, v]) => `${k}:${v}\n`).join('')
  const signedHeaders = headers.map(([k]) => k).join(';')

  const canonicalRequest = [
    opts.method.toUpperCase(),
    opts.uri,
    '',
    canonicalHeaders,
    signedHeaders,
    opts.bodyHash,
  ].join('\n')

  const stringToSign = ['SDK-HMAC-SHA256', opts.date, createHash('sha256').update(canonicalRequest).digest('hex')].join('\n')
  const signature = createHmac('sha256', opts.sk).update(stringToSign).digest('hex')

  return {
    authorization: `SDK-HMAC-SHA256 Access=${opts.ak}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    canonicalRequest,
  }
}

async function tryVariant(ak: string, sk: string, body: string, v: Variant) {
  const date = sdkDate()
  const bodyHash = createHash('sha256').update(body).digest('hex')

  const { authorization, canonicalRequest } = build({
    method: 'POST',
    uri: v.uri,
    host: HOST,
    contentType: v.contentType,
    signContentType: v.signContentType,
    signContentLength: v.signContentLength,
    bodyLen: Buffer.byteLength(body),
    bodyHash,
    ak,
    sk,
    date,
  })

  const headers: Record<string, string> = {
    Host: HOST,
    'X-Sdk-Date': date,
    Authorization: authorization,
  }
  if (v.contentType) headers['Content-Type'] = v.contentType

  let status = 0
  let text = ''
  try {
    const res = await fetch(`https://${HOST}/v3.0/OS-CREDENTIAL/securitytokens`, {
      method: 'POST',
      headers,
      body,
    })
    status = res.status
    text = await res.text()
  } catch (err) {
    text = `ERR ${(err as Error).message}`
  }

  return { v, status, text, canonicalRequest }
}

const ak = process.argv[2]
const sk = process.argv[3]
if (!ak || !sk) {
  console.error('用法: node diag-sts.ts <AK> <SK>')
  process.exit(2)
}

const body = JSON.stringify({
  auth: { identity: { methods: ['hw_ak_sk'], hw_ak_sk: { access: { key: ak }, secret: { key: sk } } } },
  duration_seconds: 3600,
})

const variants: Variant[] = [
  { name: '1 原样路径 + CT签 + 无CL', uri: '/v3.0/OS-CREDENTIAL/securitytokens', signContentType: true, contentType: 'application/json;charset=utf8', signContentLength: false },
  { name: '2 尾斜杠 + CT签 + 无CL', uri: '/v3.0/OS-CREDENTIAL/securitytokens/', signContentType: true, contentType: 'application/json;charset=utf8', signContentLength: false },
  { name: '3 原样路径 + 不签CT + 无CL', uri: '/v3.0/OS-CREDENTIAL/securitytokens', signContentType: false, contentType: 'application/json;charset=utf8', signContentLength: false },
  { name: '4 原样路径 + CT签 + 签CL', uri: '/v3.0/OS-CREDENTIAL/securitytokens', signContentType: true, contentType: 'application/json;charset=utf8', signContentLength: true },
  { name: '5 尾斜杠 + 不签CT + 无CL', uri: '/v3.0/OS-CREDENTIAL/securitytokens/', signContentType: false, contentType: 'application/json;charset=utf8', signContentLength: false },
  { name: '6 CT=json + 原样', uri: '/v3.0/OS-CREDENTIAL/securitytokens', signContentType: true, contentType: 'application/json', signContentLength: false },
]

for (const v of variants) {
  const r = await tryVariant(ak, sk, body, v)
  const short = r.text.slice(0, 160).replace(/\n/g, ' ')
  console.log(`[${r.status}] ${v.name}`)
  console.log(`     ${short}`)
  if (r.status === 200) {
    console.log('\n★★★ 命中变体:', v.name)
    console.log(r.text.slice(0, 1200))
  }
}
