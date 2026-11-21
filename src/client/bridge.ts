/** Relative to the authenticated DSH page, including a reverse-proxy mount prefix. */
const BRIDGE_ROUTE = 'api/madao-bridge'

type DshPageGlobals = typeof globalThis & {
  __DSH_TRANSPORT__?: { fetch?: (input: string | URL, init?: RequestInit) => Promise<Response> }
}

/** 带超时的 JSON 请求，失败抛错而不是静默返回 null。 */
export async function bridgeJson<T>(path: string, timeoutMs = 8000): Promise<T> {
  return request<T>('GET', path, undefined, timeoutMs)
}

/** 带 JSON body 的 POST。用于保存凭证这类写操作。 */
export async function bridgePost<T>(path: string, body: unknown, timeoutMs = 15_000): Promise<T> {
  return request<T>('POST', path, body, timeoutMs)
}

async function request<T>(method: 'GET' | 'POST', path: string, body: unknown, timeoutMs: number): Promise<T> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const transportFetch = (globalThis as DshPageGlobals).__DSH_TRANSPORT__?.fetch ?? globalThis.fetch
    const res = await transportFetch(BRIDGE_ROUTE, {
      method: 'POST',
      mode: 'same-origin',
      credentials: 'same-origin',
      redirect: 'error',
      signal: ctrl.signal,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ method, path, ...(body === undefined ? {} : { body }) }),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`HTTP ${res.status}${text ? ` ${text.slice(0, 160)}` : ''}`)
    }
    return (await res.json()) as T
  } catch (error) {
    if (ctrl.signal.aborted) throw new Error(`Local bridge request timed out after ${timeoutMs} ms`)
    throw error
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
