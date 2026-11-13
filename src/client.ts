/**
 * 码道网关客户端。
 *
 * 把三件事串起来：
 *   1. SDK-HMAC-SHA256 签名（AK/SK/STS）
 *   2. P-256 ECDH 换 SM4 会话密钥（带缓存与提前续期）
 *   3. 请求体加密 / SSE 分块解密
 *
 * 网关根：https://snap-access.cn-north-4.myhuaweicloud.com
 */

import { createHash, randomUUID } from 'node:crypto'
import type { Credentials } from './protocol/sign.ts'
import { signRequest } from './protocol/sign.ts'
import type { SessionKey } from './protocol/crypto.ts'
import { completeKeyExchange, createEcdhPair, decryptStreamChunk, encryptRequest } from './protocol/crypto.ts'

export const DEFAULT_GATEWAY = 'https://snap-access.cn-north-4.myhuaweicloud.com'
export const CHAT_PATH = '/api/v2/chat/completions'
export const KEY_EXCHANGE_PATH = '/api/v1/security/key-exchange'
export const MODELS_PATH = '/v1/model/builtin'

/** 会话密钥剩余有效期低于该值时提前续期（内核用 300s）。 */
const REFRESH_MARGIN_MS = 300_000

export interface MadaoClientOptions {
  credentials: Credentials
  gateway?: string
  /** 可注入 fetch，便于测试 */
  fetch?: typeof globalThis.fetch
  /** 客户端身份头 */
  identity?: Partial<ClientIdentity>
  /** 语言，默认 zh-cn */
  language?: string
  /**
   * 码道侧会话标识（`user-session-id` 头）。
   * 不传则按 AK 生成稳定值，保证同一份凭证复用一个会话。
   */
  sessionId?: string
}

export interface ClientIdentity {
  pluginName: string
  pluginVersion: string
  ideName: string
  ideVersion: string
}

const DEFAULT_IDENTITY: ClientIdentity = {
  pluginName: 'codemate_vscode',
  pluginVersion: '26.11.100',
  ideName: 'VSCode',
  ideVersion: '26.11.100',
}

export class MadaoClient {
  private readonly gateway: string
  private readonly creds: Credentials
  private readonly fetchImpl: typeof globalThis.fetch
  private readonly identity: ClientIdentity
  private readonly language: string
  private readonly defaultSessionId: string
  private sessionKey: SessionKey | null = null
  private negotiating: Promise<SessionKey> | null = null

  constructor(opts: MadaoClientOptions) {
    this.gateway = (opts.gateway ?? DEFAULT_GATEWAY).replace(/\/+$/, '')
    this.creds = opts.credentials
    this.fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis)
    this.identity = { ...DEFAULT_IDENTITY, ...opts.identity }
    this.language = opts.language ?? 'zh-cn'
    // 网关按 user-session-id 区分会话，并发上限 3 个（TM.00001041）。
    // 早期版本没带这个头，网关把每次请求都当新会话，重启几次就把名额占满、
    // 之后所有请求都报"并发会话数已达上限"。
    // 这里给一个稳定值：同一份凭证固定复用一个会话。
    this.defaultSessionId =
      opts.sessionId ?? `madao-${createHash('sha256').update(opts.credentials.accessKeyId ?? 'default').digest('hex').slice(0, 16)}`
  }

  // ── 密钥协商 ────────────────────────────────────────────────

  /** 取可用会话密钥；过期或临期则重新协商。并发调用只会触发一次协商。 */
  async ensureSessionKey(): Promise<SessionKey> {
    if (this.sessionKey && Date.now() < this.sessionKey.expiresAt - REFRESH_MARGIN_MS) {
      return this.sessionKey
    }
    if (this.negotiating) return this.negotiating

    this.negotiating = this.negotiate().finally(() => {
      this.negotiating = null
    })
    return this.negotiating
  }

  private async negotiate(): Promise<SessionKey> {
    const url = new URL(this.gateway + KEY_EXCHANGE_PATH)
    const pair = createEcdhPair()
    const body = JSON.stringify({
      clientPublicKey: pair.publicKeyB64,
      sessionId: randomHex(16),
      timestamp: Date.now(),
    })

    const headers = signRequest({
      method: 'POST',
      url,
      contentType: 'application/json',
      body,
      credentials: this.creds,
    })

    const res = await this.fetchImpl(url, {
      method: 'POST',
      headers: { ...headers, 'User-Agent': `codearts/${this.identity.ideVersion}` },
      body,
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`key-exchange failed: HTTP ${res.status} ${text.slice(0, 300)}`)
    }

    const json = (await res.json()) as {
      keyId?: string
      serverPublicKey?: string
      expiresIn?: number
      algorithm?: string
    }
    if (!json.keyId || !json.serverPublicKey) {
      throw new Error('key-exchange response missing keyId/serverPublicKey')
    }

    this.sessionKey = completeKeyExchange(pair, json.serverPublicKey, json.keyId, json.expiresIn ?? 7200)
    return this.sessionKey
  }

  /** 丢弃缓存密钥（凭证轮换后调用）。 */
  resetSessionKey(): void {
    this.sessionKey = null
  }

  // ── chat ────────────────────────────────────────────────────

  /**
   * 发起一次加密 chat 请求，返回已解密的 SSE 文本事件流。
   *
   * @param payload 上游期望的请求体（JSON 可序列化）
   */
  async chatStream(payload: unknown, extraHeaders: Record<string, string> = {}): Promise<ReadableStream<Uint8Array>> {
    const key = await this.ensureSessionKey()
    const url = new URL(this.gateway + CHAT_PATH)
    const ts = Date.now()

    const plaintext = Buffer.from(JSON.stringify(payload), 'utf8')
    const { body, headers: encHeaders } = encryptRequest(key, plaintext, 'POST', CHAT_PATH, ts)

    // 签名必须覆盖**实际发送的字节**（加密后的二进制），
    // 且 Content-Type 用 application/octet-stream。
    const signed = signRequest({
      method: 'POST',
      url,
      contentType: encHeaders['Content-Type'],
      bodyBytes: body,
      credentials: this.creds,
    })

    const res = await this.fetchImpl(url, {
      method: 'POST',
      headers: {
        ...signed,
        ...encHeaders,
        Accept: 'text/event-stream',
        'X-Encrypt-Capable': 'sm4-gcm',
        'User-Agent': `ai-sdk/provider-utils/4.0.21 runtime/bun/1.3.14`,
        ...this.identityHeaders(),
        // 会话与消息标识：网关据此判断"还是同一个会话"。
        // 缺了这两个头，每次请求都会被算作新会话，3 个并发名额很快耗尽
        // 并持续报 TM.00001041。调用方可通过 extraHeaders 覆盖。
        'user-session-id': this.defaultSessionId,
        'user-msg-id': randomUUID(),
        ...extraHeaders,
      },
      body,
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      // 错误体同样是 SM4-GCM 加密的，不解密就只能看到一串密文，
      // 排查参数问题时毫无用处。这里尽力解出明文。
      throw new Error(`chat failed: HTTP ${res.status} ${await this.describeError(text, key)}`)
    }

    const respAlgo = res.headers.get('x-encrypt-algo')
    if (respAlgo !== 'sm4-gcm') {
      // 服务端未加密，原样透传
      return res.body as ReadableStream<Uint8Array>
    }
    return decryptSseStream(res.body as ReadableStream<Uint8Array>, key, 'POST', CHAT_PATH, ts)
  }

  // ── 只读接口（明文，无需加密） ──────────────────────────────

  /**
   * 会话心跳。标记当前会话 busy / idle。
   *
   * 网关按 `user-session-id` 计并发会话数（上限 3 个，超了报 TM.00001041）。
   * 对话结束标 idle 能让名额及时释放，不至于挂满两小时。
   *
   * 失败不抛错 —— 这只是优化项，不影响对话本身。
   */
  async heartbeat(status: 'busy' | 'idle'): Promise<boolean> {
    try {
      const path = `/snap-manager/v1/chat-session/heartbeat?status=${status}`
      const url = new URL(this.gateway + path)
      const headers = signRequest({
        method: 'PUT',
        url,
        contentType: null,
        body: '',
        credentials: this.creds,
      })
      const res = await this.fetchImpl(url, {
        method: 'PUT',
        headers: {
          ...headers,
          'User-Agent': `codearts/${this.identity.ideVersion}`,
          'Agent-Type': 'PromptCenter',
          'x-language': this.language,
          'user-session-id': this.defaultSessionId,
        },
      })
      return res.ok
    } catch {
      return false
    }
  }

  async getModels(): Promise<unknown> {
    return this.getJson(MODELS_PATH)
  }

  /** 通用 GET，供额度 / 任务等只读接口复用。 */
  async getJson(path: string): Promise<unknown> {
    const url = new URL(this.gateway + path)
    const headers = signRequest({
      method: 'GET',
      url,
      contentType: null,
      body: '',
      credentials: this.creds,
    })
    const res = await this.fetchImpl(url, {
      method: 'GET',
      headers: {
        ...headers,
        'User-Agent': `codearts/${this.identity.ideVersion}`,
        // 码道网关要求业务头，缺了报 TM.00001001
        'Agent-Type': 'PromptCenter',
        'X-Language': 'zh-cn',
      },
    })
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      throw new Error(`GET ${path} failed: HTTP ${res.status} ${t.slice(0, 200)}`)
    }
    return res.json()
  }

  /**
   * 通用 POST（JSON 明文，不加密）。
   *
   * 仅用于 `/v1/model/thinking-variants` 这类元数据接口 —— 聊天走 chatStream 的加密通道。
   */
  async postJson(path: string, payload: unknown): Promise<unknown> {
    const url = new URL(this.gateway + path)
    const body = JSON.stringify(payload)
    const headers = signRequest({
      method: 'POST',
      url,
      contentType: 'application/json',
      body,
      credentials: this.creds,
    })
    const res = await this.fetchImpl(url, {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
        'User-Agent': `codearts/${this.identity.ideVersion}`,
        'Agent-Type': 'PromptCenter',
        'X-Language': 'zh-cn',
      },
      body,
    })
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      throw new Error(`POST ${path} failed: HTTP ${res.status} ${t.slice(0, 200)}`)
    }
    return res.json()
  }

  /**
   * 尽力把错误响应解成明文。
   *
   * 网关的 4xx 响应体也是 `IV:TAG:CIPHERTEXT` 的 SM4-GCM 密文，
   * 直接打印只能看到乱码。解不出来时原样返回前 200 字符。
   */
  private async describeError(raw: string, key: SessionKey): Promise<string> {
    const text = (raw ?? '').trim()
    if (!text) return '(空响应体)'
    try {
      return decryptStreamChunk(key, text, 'POST', CHAT_PATH, Date.now(), 0)
    } catch {
      // 不是加密体（例如网关层直接返回的 JSON 错误），原样给
      return text.slice(0, 200)
    }
  }

  private identityHeaders(): Record<string, string> {
    return {
      // 码道网关必需的业务头，缺任一都会 400
      'Agent-Type': 'PromptCenter',
      'x-language': this.language,
      'plugin-name': this.identity.pluginName,
      'plugin-version': this.identity.pluginVersion,
      'ide-name': this.identity.ideName,
      'ide-version': this.identity.ideVersion,
    }
  }
}

/**
 * 逐块解密 SSE。
 *
 * 上游格式：块之间以 `\n\n` 分隔，每块是 `iv:tag:ciphertext`。
 * 解密后的明文本身就是 `data:{...}`，**不带结尾换行**，
 * 所以这里必须补回 `\n\n`，否则下游按分隔符切分会失败。
 */
export function decryptSseStream(
  upstream: ReadableStream<Uint8Array>,
  key: SessionKey,
  method: string,
  pathname: string,
  timestamp: number,
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let buffer = ''
  let chunkIndex = 0

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = upstream.getReader()
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) {
            const rest = buffer.trim()
            if (rest) {
              const plain = decryptStreamChunk(key, rest, method, pathname, timestamp, chunkIndex++)
              controller.enqueue(encoder.encode(plain.endsWith('\n\n') ? plain : `${plain}\n\n`))
            }
            controller.close()
            return
          }
          buffer += decoder.decode(value, { stream: true })

          let sep: number
          while ((sep = buffer.indexOf('\n\n')) !== -1) {
            const block = buffer.slice(0, sep).trim()
            buffer = buffer.slice(sep + 2)
            if (!block) continue
            const plain = decryptStreamChunk(key, block, method, pathname, timestamp, chunkIndex++)
            // 明文是 `data:{...}` 无换行，补回分隔符
            controller.enqueue(encoder.encode(plain.endsWith('\n\n') ? plain : `${plain}\n\n`))
          }
        }
      } catch (err) {
        controller.error(err)
      }
    },
  })
}

function randomHex(bytes: number): string {
  const b = new Uint8Array(bytes)
  globalThis.crypto.getRandomValues(b)
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
}


