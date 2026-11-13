/**
 * 桥接服务地址。
 *
 * 前端组件跑在 DSH 的 GUI 源（如 http://127.0.0.1:55211），
 * 桥接服务在另一个端口（默认 8765），所以必须用绝对地址，
 * 不能用相对路径 —— 相对路径会打到 DSH 自己的 web server 上，
 * 结果是 404 或 HTML，表现为「状态 offline」。
 *
 * 端口与 profile 的 cordis.patch.yml 里 dsh-connect-madao.port 保持一致。
 */
export const BRIDGE_PORT = 8765

export const BRIDGE_BASE = `http://127.0.0.1:${BRIDGE_PORT}`

/** 带超时的 JSON 请求，失败抛错而不是静默返回 null。 */
export async function bridgeJson<T>(path: string, timeoutMs = 8000): Promise<T> {
  return request<T>('GET', path, undefined, timeoutMs)
}

/** 带 JSON body 的 POST。用于保存凭证这类写操作。 */
export async function bridgePost<T>(path: string, body: unknown, timeoutMs = 15_000): Promise<T> {
  return request<T>('POST', path, body, timeoutMs)
}

async function request<T>(method: string, path: string, body: unknown, timeoutMs: number): Promise<T> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(`${BRIDGE_BASE}${path}`, {
      method,
      signal: ctrl.signal,
      headers: {
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`HTTP ${res.status} ${text.slice(0, 160)}`)
    }
    return (await res.json()) as T
  } finally {
    clearTimeout(timer)
  }
}

export interface HealthPayload {
  ok: boolean
  stage?: string
  error?: string
  credentials?: { source: string; ak: string; sk: string }
  sts?: { expiresAt: string } | string
  sessionKey?: { keyId: string; ttlSec: number }
  models?: number
}
