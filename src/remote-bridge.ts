const MAX_REQUEST_BYTES = 64 * 1024
const MAX_RESPONSE_BYTES = 1024 * 1024
const ROUTE = '/api/madao-bridge'

const ALLOWED = new Set([
  'GET /healthz',
  'GET /diag/account',
  'GET /diag/credit',
  'GET /diag/checkin',
  'GET /diag/test',
  'GET /v1/models',
  'POST /diag/checkin',
  'POST /diag/checkin/all',
  'POST /diag/credentials',
  'POST /diag/test',
])

// Structural subset of DSH's HostConnectionHandle; no runtime DSH dependency.
export interface RemoteBridgeContext {
  connection: {
    fetch: {
      register(route: {
        path: string
        methods: readonly ['POST']
        requestBody: 'streaming'
        fetch(request: Request): Promise<Response>
      }): () => Promise<void>
    }
  }
}

function jsonError(message: string, status: number): Response {
  return Response.json({ error: { message } }, { status, headers: { 'cache-control': 'no-store' } })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isJson(headers: Headers): boolean {
  return headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() === 'application/json'
}

class BodyTooLarge extends Error {}

/** Decode only a bounded number of UTF-8 bytes; do not wait for the rest of an oversized stream. */
async function readJsonText(message: Request | Response, maxBytes: number): Promise<string> {
  if (Number(message.headers.get('content-length')) > maxBytes) throw new BodyTooLarge()
  if (message.body === null) return ''
  const reader = message.body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let bytes = 0
  let text = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return text + decoder.decode()
      bytes += value.byteLength
      if (bytes > maxBytes) throw new BodyTooLarge()
      text += decoder.decode(value, { stream: true })
    }
  } finally {
    reader.releaseLock()
  }
}

type RemoteBridgeOptions = {
  port?: number
  fetchImpl?: typeof globalThis.fetch
  isReady?: () => boolean
}

/** Forward only known settings operations to the same host's loopback bridge. */
export function createRemoteBridgeHandler({ port = 8765, fetchImpl = globalThis.fetch, isReady = () => true }: RemoteBridgeOptions = {}) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new RangeError('invalid local bridge port')
  const base = `http://127.0.0.1:${port}`

  return async (request: Request): Promise<Response> => {
    if (request.method !== 'POST') return jsonError('method not allowed', 405)
    if (!isReady()) return jsonError('local bridge is not ready', 503)
    if (!isJson(request.headers)) return jsonError('content type must be application/json', 415)

    let payload: unknown
    try {
      payload = JSON.parse(await readJsonText(request, MAX_REQUEST_BYTES))
    } catch (error) {
      return error instanceof BodyTooLarge
        ? jsonError('request body too large', 413)
        : jsonError('request body is not valid JSON', 400)
    }
    if (!isRecord(payload)) return jsonError('request body must be a JSON object', 400)

    const { method, path, body } = payload
    if ((method !== 'GET' && method !== 'POST') || typeof path !== 'string' || !ALLOWED.has(`${method} ${path}`)) {
      return jsonError('bridge operation is not allowed', 404)
    }
    if ((method === 'GET' && body !== undefined) || (body !== undefined && !isRecord(body))) {
      return jsonError('bridge body must be a JSON object for POST and omitted for GET', 400)
    }

    // The plugin can unload while the client's streaming body is being read.
    if (!isReady()) return jsonError('local bridge is not ready', 503)
    let upstream: Response | undefined
    try {
      request.signal.throwIfAborted()
      upstream = await fetchImpl(`${base}${path}`, {
        method,
        headers: {
          accept: 'application/json',
          ...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
        },
        ...(method === 'POST' ? { body: JSON.stringify(body ?? {}) } : {}),
        // Refuse redirects rather than forwarding outside the fixed origin (including 307/308 with a body).
        redirect: 'error',
        signal: request.signal,
      })
      if (upstream.status >= 300 && upstream.status < 400) return jsonError('local bridge redirect refused', 502)
      if (!isJson(upstream.headers)) return jsonError('local bridge did not return JSON', 502)
      const text = await readJsonText(upstream, MAX_RESPONSE_BYTES)
      JSON.parse(text)
      return new Response(text, {
        status: upstream.status,
        headers: {
          'cache-control': 'no-store',
          'content-type': 'application/json; charset=utf-8',
          'x-content-type-options': 'nosniff',
        },
      })
    } catch (error) {
      if (request.signal.aborted) return jsonError('local bridge request aborted', 502)
      return error instanceof BodyTooLarge
        ? jsonError('local bridge response too large', 502)
        : jsonError('local bridge unavailable or returned invalid JSON', 502)
    } finally {
      // Close any rejected response without copying upstream headers or draining a large body.
      if (upstream?.body && !upstream.body.locked) void upstream.body.cancel().catch(() => {})
    }
  }
}

/** DSH provides admission, owner authorization, and Context-scoped disposal. */
export function registerRemoteBridge(ctx: RemoteBridgeContext, port = 8765, isReady?: () => boolean): () => Promise<void> {
  return ctx.connection.fetch.register({
    path: ROUTE,
    methods: ['POST'],
    // Enforce this route's small byte cap before the carrier buffers the request.
    requestBody: 'streaming',
    fetch: createRemoteBridgeHandler({ port, isReady }),
  })
}
