import { strict as assert } from 'node:assert'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { test } from 'node:test'
import { bridgeJson, bridgePost } from '../src/client/bridge.ts'
import { createRemoteBridgeHandler, registerRemoteBridge, type RemoteBridgeContext } from '../src/remote-bridge.ts'

function post(payload: unknown, headers = {}) {
  return new Request('http://dsh.invalid/api/madao-bridge', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(payload),
  })
}

async function listen(t: { after(fn: () => Promise<void>): void }, handler: (req: IncomingMessage, res: ServerResponse) => void) {
  const server = createServer(handler)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())))
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  return address.port
}

test('Host proxies a real local GET and POST with only the JSON headers', { timeout: 5000 }, async t => {
  const seen: Array<{ method?: string; url?: string; auth?: string; cookie?: string; body: string }> = []
  const port = await listen(t, (req, res) => {
    let body = ''
    req.setEncoding('utf8').on('data', data => { body += data }).on('end', () => {
      seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, cookie: req.headers.cookie, body })
      res.writeHead(req.method === 'POST' ? 503 : 200, {
        'content-type': 'application/json; charset=utf-8',
        'set-cookie': 'discard-me=1',
      }).end(JSON.stringify({ ok: req.method === 'GET' }))
    })
  })
  const handler = createRemoteBridgeHandler({ port })
  const get = await handler(post({ method: 'GET', path: '/v1/models' }, { cookie: 'private=1', authorization: 'Bearer unused' }))
  assert.equal(get.status, 200)
  assert.deepEqual(await get.json(), { ok: true })
  assert.equal(get.headers.get('cache-control'), 'no-store')
  assert.equal(get.headers.get('set-cookie'), null)
  const body = { fixture: 'test-only' }
  const save = await handler(post({ method: 'POST', path: '/diag/credentials', body }))
  assert.equal(save.status, 503)
  assert.deepEqual(await save.json(), { ok: false })
  assert.deepEqual(seen, [
    { method: 'GET', url: '/v1/models', auth: undefined, cookie: undefined, body: '' },
    { method: 'POST', url: '/diag/credentials', auth: undefined, cookie: undefined, body: JSON.stringify(body) },
  ])
})

test('Host refuses to read or forward until its own bridge is ready and after it stops', async () => {
  let ready = false
  let calls = 0
  const handler = createRemoteBridgeHandler({
    isReady: () => ready,
    fetchImpl: async () => { calls++; return Response.json({ ok: true }) },
  })
  const credentials = { method: 'POST', path: '/diag/credentials', body: { fixture: 'test-only' } }
  const pendingRequest = post(credentials)
  assert.equal((await handler(pendingRequest)).status, 503)
  assert.equal(pendingRequest.bodyUsed, false)
  assert.equal(calls, 0)

  ready = true
  assert.equal((await handler(pendingRequest)).status, 200)
  assert.equal(calls, 1)

  ready = false
  assert.equal((await handler(post(credentials))).status, 503)
  assert.equal(calls, 1)
})

test('Host refuses to forward when its bridge stops while reading a request', async () => {
  let ready = true
  let calls = 0
  const handler = createRemoteBridgeHandler({
    isReady: () => ready,
    fetchImpl: async () => { calls++; return Response.json({ ok: true }) },
  })
  const { readable, writable } = new TransformStream<Uint8Array>()
  const writer = writable.getWriter()
  const init: RequestInit & { duplex: 'half' } = {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: readable, duplex: 'half',
  }
  const request = new Request('http://dsh.invalid/api/madao-bridge', init)
  const response = handler(request)
  assert.equal(request.bodyUsed, true)
  ready = false
  await writer.write(new TextEncoder().encode(JSON.stringify({
    method: 'POST', path: '/diag/credentials', body: { fixture: 'test-only' },
  })))
  await writer.close()
  assert.equal((await response).status, 503)
  assert.equal(calls, 0)
})

test('Host rejects unlisted operations, non-JSON types, and invalid request bodies before fetching', async () => {
  let calls = 0
  const handler = createRemoteBridgeHandler({ fetchImpl: async () => { calls++; return Response.json({ ok: true }) } })
  for (const path of ['/v1/chat/completions', 'https://example.invalid/', '//example.invalid/v1/models', '/v1/models?other=1', '/diag/../v1/models']) {
    assert.equal((await handler(post({ method: 'GET', path }))).status, 404)
  }
  assert.equal((await handler(post({ method: 'POST', path: '/v1/models' }))).status, 404)
  assert.equal((await handler(post({ method: 'GET', path: '/diag/test', body: {} }))).status, 400)
  assert.equal((await handler(post({ method: 'POST', path: '/diag/credentials', body: [] }))).status, 400)
  assert.equal((await handler(post(null))).status, 400)
  assert.equal((await handler(post({}, { 'content-type': 'text/plain' }))).status, 415)
  assert.equal((await handler(new Request('http://dsh.invalid/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' }))).status, 400)
  assert.equal((await handler(new Request('http://dsh.invalid/'))).status, 405)
  assert.equal(calls, 0)
})

test('Host checks actual UTF-8 bytes and the declared size before forwarding', async () => {
  let calls = 0
  const handler = createRemoteBridgeHandler({ fetchImpl: async () => { calls++; return Response.json({ ok: true }) } })
  const op = { method: 'POST', path: '/diag/credentials', body: { value: '界'.repeat(22000) } }
  assert.ok(JSON.stringify(op).length < 65536)
  assert.equal((await handler(post(op))).status, 413)
  assert.equal((await handler(post({}, { 'content-length': '65537' }))).status, 413)
  assert.equal(calls, 0)
})

test('Host refuses a real redirect without sending the POST body to another port', { timeout: 5000 }, async t => {
  let redirected = false
  const other = await listen(t, (_req, res) => { redirected = true; res.end('unexpected') })
  const port = await listen(t, (req, res) => {
    req.resume()
    res.writeHead(307, { location: `http://127.0.0.1:${other}/unexpected` }).end()
  })
  const handler = createRemoteBridgeHandler({ port })
  const response = await handler(post({ method: 'POST', path: '/diag/credentials', body: { fixture: 'test-only' } }))
  assert.equal(response.status, 502)
  assert.equal(response.headers.get('location'), null)
  assert.equal(redirected, false)
})

test('Host validates responses, does not echo failures, and forwards abort', async () => {
  for (const response of [
    new Response('<script>bad()</script>', { headers: { 'content-type': 'text/html' } }),
    new Response('{', { headers: { 'content-type': 'application/json' } }),
    new Response(null, { status: 204 }),
    Response.json('x'.repeat(1024 * 1024)),
  ]) {
    const handler = createRemoteBridgeHandler({ fetchImpl: async () => response })
    const result = await handler(post({ method: 'GET', path: '/healthz' }))
    assert.equal(result.status, 502)
    assert.equal(result.headers.get('cache-control'), 'no-store')
    assert.doesNotMatch(await result.text(), /<script>/)
  }
  const controller = new AbortController()
  let abortSeen = false
  const handler = createRemoteBridgeHandler({ fetchImpl: async (_url, options) => {
    controller.abort()
    abortSeen = options?.signal?.aborted === true
    throw new Error('internal error fixture')
  } })
  const response = await handler(new Request(post({ method: 'GET', path: '/healthz' }), { signal: controller.signal }))
  assert.ok(abortSeen)
  assert.equal(response.status, 502)
  assert.doesNotMatch(await response.text(), /internal error fixture/)
})

test('Host registration uses the scoped exact POST route and returns its disposer', async () => {
  const routes = new Map<string, Parameters<RemoteBridgeContext['connection']['fetch']['register']>[0]>()
  const dispose = registerRemoteBridge({ connection: { fetch: { register(route) {
    routes.set(route.path, route)
    return async () => { routes.delete(route.path) }
  } } } })
  const route = routes.get('/api/madao-bridge')
  assert.deepEqual(route?.methods, ['POST'])
  assert.equal(route?.requestBody, 'streaming')
  assert.equal((await route?.fetch(post({ method: 'GET', path: '/not-allowed' })))?.status, 404)
  await dispose()
  assert.equal(routes.size, 0)
})

test('Client prefers the shell transport for a Host on a different origin', async t => {
  const page = globalThis as typeof globalThis & { __DSH_TRANSPORT__?: { fetch?: typeof fetch } }
  const prior = Object.getOwnPropertyDescriptor(page, '__DSH_TRANSPORT__')
  t.after(() => {
    if (prior) Object.defineProperty(page, '__DSH_TRANSPORT__', prior)
    else delete page.__DSH_TRANSPORT__
  })
  const nativeFetch = t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('request should use the DSH shell transport')
  })
  let calls = 0
  Object.defineProperty(page, '__DSH_TRANSPORT__', {
    configurable: true,
    value: {
      async fetch(path: string, init: RequestInit) {
        calls++
        assert.equal(path, 'api/madao-bridge')
        assert.equal(new URL(path, 'https://host.example/dsh/').href, 'https://host.example/dsh/api/madao-bridge')
        assert.deepEqual(JSON.parse(String(init.body)), { method: 'GET', path: '/healthz' })
        return Response.json({ ok: true })
      },
    },
  })
  assert.deepEqual(await bridgeJson('/healthz'), { ok: true })
  assert.equal(calls, 1)
  assert.equal(nativeFetch.mock.callCount(), 0)
})

test('Client uses the same-origin mount-relative route and reports errors and aborts', { timeout: 5000 }, async t => {
  const mock = t.mock.method(globalThis, 'fetch', async (input: string, options: RequestInit) => {
    assert.equal(input, 'api/madao-bridge')
    assert.equal(new URL(input, 'https://host.example/prefix/').pathname, '/prefix/api/madao-bridge')
    assert.equal(options.method, 'POST')
    assert.equal(options.mode, 'same-origin')
    assert.equal(options.credentials, 'same-origin')
    assert.equal(options.redirect, 'error')
    const envelope = JSON.parse(String(options.body))
    if (envelope.path === '/healthz') {
      assert.deepEqual(envelope, { method: 'GET', path: '/healthz' })
      return Response.json({ ok: true })
    }
    assert.deepEqual(envelope, { method: 'POST', path: '/diag/test', body: { fixture: 'test-only' } })
    return Response.json({ error: { message: 'owner authentication required' } }, { status: 401 })
  })
  assert.deepEqual(await bridgeJson('/healthz'), { ok: true })
  await assert.rejects(bridgePost('/diag/test', { fixture: 'test-only' }), /HTTP 401.*owner authentication required/)
  assert.equal(mock.mock.callCount(), 2)
  mock.mock.mockImplementation(async (_input: string, options: RequestInit) => new Promise<Response>((_resolve, reject) => {
    options.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true })
  }))
  await assert.rejects(bridgeJson('/healthz', 10), /timed out/)
})
