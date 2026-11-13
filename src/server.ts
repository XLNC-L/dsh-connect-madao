/**
 * OpenAI 兼容 HTTP 服务。
 *
 * 暴露：
 *   POST /v1/chat/completions   对话（流式/非流式）
 *   GET  /v1/models             模型清单
 *   GET  /healthz               自检：凭证 → STS → 密钥协商
 *
 * 只监听 127.0.0.1。
 */

import { randomUUID } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import { MadaoClient } from './client.ts'
import { StsProvider } from './sts-provider.ts'
import { buildUpstreamBody, hasUnsupportedContent, type ChatRequestBody } from './protocol/body.ts'
import { makeChunk, parseUpstreamEvent, sseLine, SSE_DONE } from './protocol/sse.ts'
import { DEFAULT_CRED_PATH, candidateCredentials, loadCredentials, maskKey, migratePlaintextToEncrypted, saveCredentials, type LoadResult } from './credentials.ts'
import { FALLBACK_MODELS, type ModelInfo } from './models.ts'
import { parseStsIdentity } from './identity.ts'

export interface ServerOptions {
  port?: number
  host?: string
  gateway?: string
  credentialPath?: string
  /** 启动时已发现的模型清单；不传则用兜底清单 */
  models?: ModelInfo[]
}

export interface RunningServer {
  server: Server
  port: number
  url: string
  close(): Promise<void>
}

/** 码道可用模型（实测自 /v1/model/builtin）。 */

interface Ctx {
  client: MadaoClient | null
  sts: StsProvider | null
  loaded: LoadResult | null
  loadError: string | null
  /** 当前生效的模型清单（网关发现结果，或兜底） */
  models: ModelInfo[]
  /** 上次用于构造 client 的凭证引用，用于判断是否需要重建 */
  lastCreds?: unknown
}

/**
 * 确保 client 用的是**当前有效**的 STS。
 *
 * 踩过的坑：MadaoClient 构造时接收的是凭证快照，之后不会再更新。
 * STS 有效期只有 1 小时，过期后客户端仍拿旧 token 签名，网关直接回
 * `APIG.0602 Bad request: the security token has expired`。
 *
 * StsProvider.get() 自带缓存与提前 10 分钟续期，未过期时返回**同一个引用**，
 * 所以这里用引用比较判断是否需要重建客户端 —— 成本几乎为零。
 */
async function ensureFreshClient(ctx: Ctx): Promise<void> {
  if (!ctx.sts || !ctx.loaded) return
  // 直接用登录态三件套时无法续期，只能等它过期
  if (ctx.loaded.key.securityToken) return
  try {
    const creds = await ctx.sts.get()
    if (ctx.lastCreds !== creds) {
      ctx.client = new MadaoClient({ credentials: creds })
      ctx.lastCreds = creds
      chatLog('client rebuilt with refreshed STS')
    }
  } catch (e) {
    chatLog(`STS refresh failed: ${String((e as Error)?.message ?? e).slice(0, 160)}`)
  }
}

export async function startServer(opts: ServerOptions = {}): Promise<RunningServer> {
  const port = opts.port ?? 8765
  const host = opts.host ?? '127.0.0.1'

  const ctx: Ctx = { client: null, sts: null, loaded: null, loadError: null, models: opts.models ?? FALLBACK_MODELS }

  try {
    // 按优先级列出所有候选来源，逐个验证，用第一个**真能连上**的。
    // 只看"文件存在"是不够的：AK 被停用后文件还在、格式也对，
    // 但换 STS 会一直 0301，用户就会被卡在一个用不了的来源上。
    // 老用户升级后自动把明文凭证换成 DPAPI 密文，无需手动操作
    if (await migratePlaintextToEncrypted()) {
      chatLog('credentials: 已把明文凭证迁移为 DPAPI 加密')
    }

    const candidates = await candidateCredentials(opts.credentialPath)
    if (candidates.length === 0) {
      throw new Error('未找到任何可用凭证来源（环境变量 / 凭证文件 / 码道登录态）')
    }

    const failures: string[] = []
    for (const c of candidates) {
      try {
        if (c.key.securityToken) {
          // 已有三件套：用它建 client，并做一次轻量验证（协商会话密钥）
          const probe = new MadaoClient({
            credentials: { ak: c.key.ak, sk: c.key.sk, securityToken: c.key.securityToken },
            gateway: opts.gateway,
          })
          await probe.ensureSessionKey()
          ctx.loaded = c
          ctx.client = probe
          chatLog(`credentials: 采用 ${c.label}（三件套）`)
          break
        }

        // 只有 AK/SK：换一次 STS，成功才算这个来源可用
        const sts = new StsProvider({ ak: c.key.ak, sk: c.key.sk })
        const creds = await sts.credentials()
        ctx.loaded = c
        ctx.sts = sts
        ctx.client = new MadaoClient({ credentials: creds, gateway: opts.gateway })
        ctx.lastCreds = creds
        chatLog(`credentials: 采用 ${c.label}（已换 STS）`)
        break
      } catch (e) {
        const msg = String((e as Error)?.message ?? e).slice(0, 200)
        failures.push(`${c.label} → ${msg}`)
        chatLog(`credentials: 跳过 ${c.label}（${msg}）`)
      }
    }

    if (!ctx.client) {
      throw new Error(`所有凭证来源都不可用：\n${failures.map((f) => `  ${f}`).join('\n')}`)
    }
  } catch (err) {
    ctx.loadError = err instanceof Error ? err.message : String(err)
  }

  const server = createServer((req, res) => {
    handle(req, res, ctx).catch((err) => {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: { message: String(err?.message ?? err), type: 'internal_error' } }))
        return
      }
      try {
        res.end()
      } catch {}
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => resolve())
  })

  const addr = server.address()
  const actualPort = typeof addr === 'object' && addr ? addr.port : port

  return {
    server,
    port: actualPort,
    url: `http://${host}:${actualPort}`,
    close: () => new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  }
}

async function handle(req: IncomingMessage, res: ServerResponse, ctx: Ctx): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`)

  // DSH 的 GUI 跑在另一个端口（如 55211），前端组件要访问本桥接服务必须跨源。
  // 只监听 127.0.0.1，所以放开本地来源是安全的。
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin ?? '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.setHeader('Access-Control-Max-Age', '600')
  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  if (req.method === 'GET' && url.pathname === '/healthz') {
    return json(res, 200, await healthz(ctx))
  }

  // 浮层用：账号 + 额度（额度每次现查）
  if (req.method === 'GET' && (url.pathname === '/diag/account' || url.pathname === '/diag/credit')) {
    return json(res, 200, await accountInfo(ctx))
  }

  // 「测试」按钮：STS → 协商 → 模型 → 额度 全链路自检。
  // 自检是幂等的，GET / POST 都接受 —— 前端浮层用的是 bridgeJson（GET），
  // 只注册 POST 会让「测试并刷新额度」报 HTTP 404。
  if ((req.method === 'POST' || req.method === 'GET') && url.pathname === '/diag/test') {
    return json(res, 200, await runSelfTest(ctx))
  }

  // 每日签到：查询状态（GET，安全）与执行领取（POST，一天只有一次）
  //
  // 接口是从码道客户端抓出来的（extension.js 里 welfareClaimUrl 拼的是
  // ${policyCenterDomain}/v1/ops/claim，policyCenterDomain 就是网关域名）：
  //   列表  GET  /v1/ops/delivery?channel=IDE
  //   领取  POST /v1/ops/claim  { campaignId, idempotentKey, channel:"IDE" }
  // 每日签到固定是 campaignId=34（USER_LOGIN / MANUAL_CLAIM）。
  if (url.pathname === '/diag/checkin' && (req.method === 'GET' || req.method === 'POST')) {
    await ensureFreshClient(ctx)
    if (!ctx.client) {
      return json(res, 503, { error: { message: ctx.loadError ?? '凭证未加载', type: 'credentials_error' } })
    }
    try {
      const d = (await ctx.client.getJson('/v1/ops/delivery?channel=IDE')) as any
      const items: any[] = d?.data?.items ?? []
      const daily = items.find((x) => x?.campaignId === 34)
      if (!daily) {
        return json(res, 200, {
          ok: true,
          available: false,
          reason: '网关的福利列表里没有每日签到活动（campaignId=34）',
        })
      }

      const state = {
        campaignId: 34,
        title: daily.title,
        status: daily.status,
        claimable: daily.claimable === true,
        pendingAmount: daily.pendingTotalAmount ?? 0,
        unit: daily.benefitUnit ?? 'CREDIT',
        expireAt: daily.expireAt ?? null,
      }

      // GET 只查不领 —— 签到一天一次，绝不因为"打开了面板"就替用户点掉
      if (req.method === 'GET') {
        return json(res, 200, { ok: true, available: true, ...state })
      }

      if (!state.claimable || daily.status !== 'ELIGIBLE') {
        return json(res, 200, { ok: true, available: true, claimed: false, ...state, reason: '当前不可领取' })
      }

      const r = (await ctx.client.postJson('/v1/ops/claim', {
        campaignId: 34,
        idempotentKey: randomUUID(),
        channel: 'IDE',
      })) as any
      const claimed = r?.code === 0
      chatLog(`checkin ${claimed ? 'OK' : 'FAIL'} campaign=34 ${JSON.stringify(r?.data ?? r).slice(0, 200)}`)
      return json(res, 200, {
        ok: true,
        available: true,
        claimed,
        ...state,
        status: r?.data?.status ?? state.status,
        amount: r?.data?.totalAmount ?? state.pendingAmount,
        claimedAt: r?.data?.claimedAt ?? null,
        ...(claimed ? {} : { reason: String(r?.message ?? '领取失败') }),
      })
    } catch (e) {
      chatLog(`checkin ERROR ${String((e as Error)?.message ?? e).slice(0, 200)}`)
      return json(res, 502, {
        error: { message: `签到接口调用失败：${String((e as Error)?.message ?? e)}`, type: 'checkin_error' },
      })
    }
  }

  // 保存 AK/SK 到 credentials.json。
  //
  // 之前面板上的「保存」按钮只改本地 React state，什么都没写盘 —— 用户以为存好了，
  // 重启后凭证还是旧的。这里补上真正的持久化。
  if (req.method === 'POST' && url.pathname === '/diag/credentials') {
    let payload: any = {}
    try {
      payload = JSON.parse(await readBody(req))
    } catch {
      return json(res, 400, { error: { message: '请求体不是合法 JSON' } })
    }
    const ak = String(payload.ak ?? '').trim()
    const sk = String(payload.sk ?? '').trim()
    if (!ak || !sk) {
      return json(res, 400, { error: { message: 'Access Key ID 与 Secret Access Key 都不能为空' } })
    }
    let saved: { encrypted: boolean; path: string }
    try {
      // saveCredentials 内部优先用 DPAPI 加密存储，不可用时才回退明文
      saved = await saveCredentials({ ak, sk })
      chatLog(
        `credentials saved via panel → ${saved.path}` +
          ` (${saved.encrypted ? 'DPAPI 加密' : '⚠ 明文，DPAPI 不可用'}, ak=${ak.slice(0, 4)}…)`,
      )
    } catch (e) {
      return json(res, 500, {
        error: {
          message:
            `保存凭证失败：${String((e as Error)?.message ?? e)}` +
            `\n可改用环境变量 MADAO_AK / MADAO_SK。`,
        },
      })
    }

    // 立即用新凭证重建客户端，不重启也生效
    try {
      const reloaded = await loadCredentials()
      ctx.loaded = reloaded
      ctx.loadError = null
      if (reloaded.key.securityToken) {
        ctx.client = new MadaoClient({
          credentials: {
            ak: reloaded.key.ak,
            sk: reloaded.key.sk,
            securityToken: reloaded.key.securityToken,
          },
        })
        ctx.sts = null
      } else {
        const sts = new StsProvider({ ak: reloaded.key.ak, sk: reloaded.key.sk })
        const creds = await sts.credentials()
        ctx.sts = sts
        ctx.client = new MadaoClient({ credentials: creds })
        ctx.lastCreds = creds
      }
      chatLog(`credentials reloaded after save (source=${reloaded.source})`)
    } catch (e) {
      return json(res, 200, {
        ok: true,
        warning: `已写入，但立即加载失败（重启 DSH 后生效）：${String((e as Error)?.message ?? e)}`,
      })
    }
    return json(res, 200, { ok: true, source: ctx.loaded?.source })
  }

  if (req.method === 'GET' && url.pathname === '/v1/models') {
    return json(res, 200, {
      object: 'list',
      data: ctx.models.map((m) => ({
        id: m.id,
        object: 'model',
        owned_by: 'huawei-codearts',
        name: m.name,
        // 下划线是 OpenAI 生态的惯例，驼峰给前端面板用。
        // 之前只给了下划线，而面板读 m.context / m.maxOutput / m.supportsImages，
        // 结果三列全是 undefined —— `m.context.toLocaleString()` 直接抛错，
        // 模型 tab 一打开就崩。
        context_window: m.context,
        max_output_tokens: m.maxOutput,
        supports_images: m.supportsImages,
        default_strength: m.defaultStrength,
        context: m.context,
        maxOutput: m.maxOutput,
        supportsImages: m.supportsImages,
        defaultStrength: m.defaultStrength,
        ratio: m.ratio,
        strengths: m.strengths,
        description: m.description,
      })),
    })
  }

  if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
    // STS 只有 1 小时寿命，每次对话前确保客户端拿的是最新凭证，
    // 否则会以 APIG.0602（security token expired）失败。
    await ensureFreshClient(ctx)
    if (!ctx.client) {
      return json(res, 503, { error: { message: ctx.loadError ?? '凭证未加载', type: 'credentials_error' } })
    }

    // 借用码道登录态时，三件套有明确到期时间，过点就必然 APIG.0602。
    // 与其让用户看到一行英文原始错误，不如提前拦住并告诉他该做什么。
    if (ctx.loaded?.source === 'codearts') {
      const exp = typeof ctx.loaded.key.expiresAt === 'number' ? ctx.loaded.key.expiresAt : ctx.loaded.expiresAtMs
      if (typeof exp === 'number' && Date.now() > exp) {
        const mins = Math.max(1, Math.round((Date.now() - exp) / 60000))
        chatLog(`chat REJECT codearts credential expired ${mins}min ago`)
        return json(res, 401, {
          error: {
            message:
              `码道登录态的临时凭证已经过期（过期约 ${mins} 分钟）。\n` +
              `这不是模型故障：临时凭证只有几小时寿命，插件无法替你续期。\n` +
              `恢复办法：打开一次码道客户端让它刷新登录态 → 回到这里点「测试连接」。\n` +
              `想一劳永逸，就在账号页填永久 AK/SK（插件会自动换 STS 并续期）。`,
            type: 'credentials_expired',
          },
        })
      }
    }
    const raw = await readBody(req)
    let body: ChatRequestBody
    try {
      body = JSON.parse(raw) as ChatRequestBody
    } catch {
      return json(res, 400, { error: { message: '请求体不是合法 JSON', type: 'invalid_request_error' } })
    }
    return chatCompletion(res, ctx.client, body, ctx.models)
  }

  json(res, 404, { error: { message: `未知路径 ${url.pathname}`, type: 'not_found' } })
}

/**
 * 归一化上游请求参数。
 *
 * 1. model id 大小写：清单里 `GLM-5.2` 是大写，传小写时网关**静默返回空内容**
 *    （不是报错，只是没有任何 delta）—— 必须纠正成清单里的写法。
 * 2. 思考强度：DSH / OpenAI 侧用 `reasoning_effort`，
 *    码道上游用 `strength`，这里统一映射。
 */
/**
 * 对话请求日志。只记元数据，不记消息内容。
 *
 * 空响应（`EMPTY_RESPONSE`）这类问题，光看 DSH 的报错完全定位不了：
 * 可能是显示名没还原、max_tokens 太小、或者上游限流。把实际发出去的
 * model / 强度 / 预算记下来，下次一眼就能看出是哪一类。
 */
function chatLog(line: string): void {
  try {
    const dir = join(homedir(), '.dsh-connect-madao')
    mkdirSync(dir, { recursive: true })
    appendFileSync(join(dir, 'chat.log'), `${new Date().toISOString()} ${line}\n`, 'utf8')
  } catch {}
}

/**
 * 粗估一段内容的 token 数。
 *
 * 系数是用网关返回的真实 `prompt_tokens` 校准过的（实测 5 组样本）：
 *
 *   请求                 旧算法(cjk/1.5,other/3.5)   网关真实   旧算法偏差
 *   无工具                       593                   306      1.94×
 *   377 工具/短 desc            76825                 63619      1.21×
 *   377 工具/中 desc           160225                110974      1.44×
 *   377 工具/长 desc           311025                197029      1.58×
 *   纯中文 250K 字符            71450                 35734      2.00×
 *
 * 旧系数系统性高估 1.2–2 倍，导致本该放行的请求被拦（GLM-5.2 就是这样被误拦的）。
 * 这里换成校准后的系数：CJK≈2.5 字符/token，其余≈5 字符/token。
 *
 * 仍会有误差，所以宁可**低估**（漏拦）也不要高估（误拦）：
 * 误拦会让模型完全不可用，漏拦只是让网关返回空内容，而空内容现在会被日志和
 * SSE error 事件标记出来，可诊断。
 */
function estimateTokens(value: unknown): number {
  let cjk = 0
  let other = 0
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '')
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0
    // CJK 统一表意文字 + 扩展 A + 兼容表意 + 全角标点
    if (
      (c >= 0x4e00 && c <= 0x9fff) ||
      (c >= 0x3400 && c <= 0x4dbf) ||
      (c >= 0xf900 && c <= 0xfaff) ||
      (c >= 0x3000 && c <= 0x303f) ||
      (c >= 0xff00 && c <= 0xffef)
    ) {
      cjk++
    } else {
      other++
    }
  }
  return Math.ceil(cjk / 2.5 + other / 5)
}

/**
 * 把客户端传来的 model 值还原成网关认识的 model_id。
 *
 * DSH 在模型选择器里显示的是 `displayName(m)` = `名称 · 倍率`（如 `GLM-5.2 · 0.7x`），
 * 上层很可能把这个显示名原样塞进请求体。网关不认显示名 —— 实测 `GLM-5.2 · 0.7x`
 * 会返回 HTTP 200 但 content 为空，表现成 `EMPTY_RESPONSE`，很难查。
 *
 * 所以这里按 id → 名称 → 去掉倍率后缀，逐级回退。
 */
function resolveModelId(input: string, models: ModelInfo[]): string | null {
  const raw = String(input ?? '').trim()
  if (!raw) return null
  const low = raw.toLowerCase()

  // 1. model_id 精确（忽略大小写）—— 网关要求大写时这一步就纠正了
  const byId = models.find((m) => m.id.toLowerCase() === low)
  if (byId) return byId.id

  // 2. 显示名精确（`名称 · 倍率`）
  const shown = (m: ModelInfo) => (m.ratio ? `${m.name} · ${m.ratio}` : m.name)
  const byShown = models.find((m) => shown(m) === raw || m.name === raw)
  if (byShown) return byShown.id

  // 3. 忽略大小写的显示名
  const byShownCi = models.find((m) => shown(m).toLowerCase() === low || m.name.toLowerCase() === low)
  if (byShownCi) return byShownCi.id

  // 4. 砍掉 ` · 倍率` 尾巴再试（倍率可能被上层改写过）
  const stripped = raw.split('·')[0].trim()
  if (stripped && stripped !== raw) {
    const s = stripped.toLowerCase()
    const byStrip = models.find((m) => m.id.toLowerCase() === s || m.name.toLowerCase() === s)
    if (byStrip) return byStrip.id
  }

  // 找不到就返回 null。绝不能原样透传 —— 网关遇到不认识的模型名同样会
  // 返回 HTTP 200 + 空 content，上层只能看到 EMPTY_RESPONSE，没法查。
  return null
}

function normalizeRequest(body: ChatRequestBody, models: ModelInfo[]): ChatRequestBody {
  const out: ChatRequestBody = { ...body }

  const resolved = resolveModelId(String(body.model ?? ''), models)
  // 解析失败时置空，由调用方给出明确报错（而不是透传给网关换来一个空响应）
  out.model = resolved ?? ''

  const effort = body.strength ?? (body.reasoning_effort as string | undefined)
  if (typeof effort === 'string' && effort) out.strength = effort

  return out
}

async function chatCompletion(res: ServerResponse, client: MadaoClient, rawBody: ChatRequestBody, ctxModels: ModelInfo[]): Promise<void> {
  // 桥接只转发文本。带上图片就明确拒绝，避免 flattenContent 静默吃掉。
  // 图片（image_url）现在是支持的：网关实测能真正看到图。
  // 只有音频、file 这类网关不认的 part 才拒绝，避免静默丢内容。
  const unsupported = hasUnsupportedContent(rawBody.messages)
  if (unsupported) {
    return json(res, 400, {
      error: {
        message:
          `不支持的内容类型：${unsupported}。` +
          `桥接目前转发 text 与 image_url（图片），其他类型（音频、file 等）网关不认。`,
        type: 'unsupported_content',
      },
    })
  }

  const body = normalizeRequest(rawBody, ctxModels)
  const wantStream = body.stream !== false
  const upstreamBody = buildUpstreamBody(body)
  const id = `chatcmpl-${Date.now().toString(36)}`
  const model = body.model

  // 未知模型直接拒绝。
  // 网关遇到不认识的 model 名会返回 HTTP 200 + 空 content，上层只看到
  // EMPTY_RESPONSE，完全不知道是模型名写错了。这里提前给出可用清单。
  if (!model) {
    const requestId = String(rawBody.model ?? '')
    chatLog(`chat REJECT unknown model ${JSON.stringify(requestId)}`)
    return json(res, 400, {
      error: {
        message:
          `未知模型：${JSON.stringify(requestId)}\n` +
          `可用模型（model_id 或界面上的显示名都可）：\n` +
          ctxModels.map((m) => `  ${m.id}${m.ratio ? `（显示名 ${m.name} · ${m.ratio}）` : ''}`).join('\n'),
        type: 'model_not_found',
      },
    })
  }

  // 上下文超窗口必须在这里挡住。
  // 实测：请求超过模型窗口时，网关**不报错**，而是正常返回一个 content 为空的流，
  // DSH 只能显示 `EMPTY_RESPONSE: returned a completed response with no content`，
  // 完全看不出真正原因（比如 294k 的会话塞给只有 202752 窗口的 GLM-5.2）。
  const info = ctxModels.find((m) => m.id === model)
  // 估算要覆盖整个请求体（含 tools）——DSH 会带几百个工具定义，
  // 只算 messages 会严重低估，真超限时拦不住。
  const estMessages = estimateTokens(rawBody.messages)
  const toolCount = Array.isArray((rawBody as any).tools) ? (rawBody as any).tools.length : 0
  // 没有 tools 时直接记 0 —— estimateTokens([]) 会把 "[]" 这两个字符也算出来
  const estTools = toolCount > 0 ? estimateTokens((rawBody as any).tools) : 0
  const estTokens = estMessages + estTools
  if (info && info.context > 0) {
    // 闸门放在窗口的 1.2 倍，而不是 0.9 倍。
    //
    // 原因：估算没有 tokenizer，实测偏差 1.15–2.0×（内容越重复、英文越多，偏差越大）。
    // 曾经按 0.9 倍拦，结果 GLM-5.2 的 377 工具请求被误判为超限，但用网关官方计数
    // 复核只有 172491 tokens（窗口 202752），本来完全能跑。
    //
    // 两害相权：误拦会让模型彻底不可用，漏拦只是网关返回空内容 —— 而空响应现在
    // 会被日志标记，且请求体落盘可复查。所以宁可放松。
    const limit = Math.floor(info.context * 1.2)
    if (estTokens > limit) {
      const bigger = ctxModels
        .filter((m) => m.context * 0.9 > estTokens)
        .sort((a, b) => a.context - b.context)
        .slice(0, 4)
        .map((m) => `${m.name}（${m.context}）`)
      chatLog(
        `chat REJECT context ${estTokens} (msgs ${estMessages} + tools ${estTools}/${toolCount}) > ${limit} for ${model}`,
      )
      // 把被拦下的请求体落盘，便于事后用真实请求直接打网关复核估算是否准确。
      // 只保留最后一次，避免堆积。
      try {
        writeFileSync(join(homedir(), '.dsh-connect-madao', 'last-rejected.json'), JSON.stringify(rawBody), 'utf8')
        chatLog('chat REJECT 请求体已存至 ~/.dsh-connect-madao/last-rejected.json')
      } catch {}
      // 工具定义往往是主要占用。如果光 tools 就超窗口，那就不是"压缩会话"能解决的，
      // 必须换模型或减少插件/MCP —— 这点要说清楚，否则用户会以为是对话历史太长。
      const toolsAloneExceed = estTools > limit
      return json(res, 400, {
        error: {
          message:
            `上下文超出「${info.name}」的窗口 ${info.context}（可用约 ${limit}）：\n` +
            `  工具定义 ${estTools}（${toolCount} 个）\n` +
            `  对话与系统提示 ${estMessages}\n` +
            `  合计 ${estTokens} tokens\n` +
            (toolsAloneExceed
              ? `\n注意：光工具定义就超过了该模型整个窗口，所以哪怕新开会话、只发一个字也装不下。\n` +
                `这不是对话历史太长，压缩会话没有用 —— 需要换窗口更大的模型，或者禁用一些插件/MCP 服务器来减少工具数量。\n`
              : `\n可以压缩会话、开新对话，或换窗口更大的模型。\n`) +
            (bigger.length ? `窗口够用的模型：${bigger.join('、')}` : `请减少工具数量或换更大的模型。`),
          type: 'context_length_exceeded',
        },
      })
    }
  }

  // 记录实际发往网关的关键参数，便于排查空响应
  const rb = rawBody as any
  const msgBrief = (rb.messages ?? [])
    .map((m: any) => `${m.role}:${typeof m.content === 'string' ? m.content.length : Array.isArray(m.content) ? 'arr' + m.content.length : typeof m.content}`)
    .join(',')
  chatLog(
    `chat in=${JSON.stringify(String(rawBody.model ?? ''))} → out=${JSON.stringify(model)}` +
      ` strength=${JSON.stringify(body.strength ?? null)}` +
      ` max_tokens=${rb.max_tokens ?? '未传'} max_completion_tokens=${rb.max_completion_tokens ?? '未传'}` +
      ` → 实际发给网关=${(upstreamBody as any).max_tokens}` +
      ` stream=${wantStream} est_tokens=${estTokens}` +
      ` msgs=[${msgBrief}] tools=${Array.isArray(rb.tools) ? rb.tools.length : 0}` +
      ` 顶层字段=${Object.keys(rb).join('|')}`,
  )

  // 标 busy / idle 让码道的并发名额及时释放（上限 3 个）。
  // 失败静默：心跳只是优化，不能影响对话本身。
  void client.heartbeat('busy')
  const markIdle = () => {
    void client.heartbeat('idle')
  }

  const up = await client.chatStream(upstreamBody)
  const reader = up.getReader()
  const decoder = new TextDecoder()

  /** 逐事件解析上游流。 */
  async function* events(): AsyncGenerator<ReturnType<typeof parseUpstreamEvent>> {
    let buf = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) {
        if (buf.trim()) {
          for (const line of buf.split('\n')) {
            if (line.startsWith('data:')) yield parseUpstreamEvent(line.slice(5))
          }
        }
        return
      }
      buf += decoder.decode(value, { stream: true })
      let sep: number
      while ((sep = buf.indexOf('\n\n')) !== -1) {
        const block = buf.slice(0, sep)
        buf = buf.slice(sep + 2)
        for (const line of block.split('\n')) {
          if (line.startsWith('data:')) yield parseUpstreamEvent(line.slice(5))
        }
      }
    }
  }

  if (!wantStream) {
    let text = ''
    let reasoning = ''
    let finish: string | null = null
    let usage: any
    // 非流式要把分片的 tool_calls 按 index 合并成完整调用再返回
    const mergedCalls: any[] = []
    for await (const ev of events()) {
      if (ev.reasoning) reasoning += ev.reasoning
      if (ev.text) text += ev.text
      if (ev.toolCalls) {
        for (const tc of ev.toolCalls as any[]) {
          const idx = typeof tc?.index === 'number' ? tc.index : mergedCalls.length
          const cur = mergedCalls[idx] ?? { id: '', type: 'function', function: { name: '', arguments: '' } }
          if (tc.id) cur.id = tc.id
          if (tc.type) cur.type = tc.type
          if (tc.function?.name) cur.function.name += tc.function.name
          if (tc.function?.arguments) cur.function.arguments += tc.function.arguments
          mergedCalls[idx] = cur
        }
      }
      if (ev.finish) finish = ev.finish
      if (ev.usage) usage = ev.usage
    }
    chatLog(
      `chat done model=${model} content_len=${text.length} reasoning_len=${reasoning.length}` +
        ` tool_calls=${mergedCalls.length} finish=${finish ?? 'stop'}` +
        (text.length === 0 && mergedCalls.length === 0 ? '  ⚠ content 为空且无工具调用' : ''),
    )
    markIdle()
    return json(res, 200, {
      id,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: text,
            ...(reasoning ? { reasoning_content: reasoning } : {}),
            ...(mergedCalls.length > 0 ? { tool_calls: mergedCalls.filter(Boolean) } : {}),
          },
          finish_reason: finish ?? 'stop',
        },
      ],
      ...(usage ? { usage } : {}),
    })
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-store, max-age=0, must-revalidate',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
  res.write(sseLine(makeChunk(id, model, { role: 'assistant' })))

  let finish: string | null = null
  let usage: any
  // 流式路径也要统计正文/思考的字数 —— 否则 content 为空时日志里什么都看不出来，
  // 只能看到一句 finish=stop，和 DSH 的 EMPTY_RESPONSE 对不上。
  let contentChars = 0
  let reasoningChars = 0
  let textEvents = 0
  let reasoningEvents = 0
  let toolCallEvents = 0
  try {
    for await (const ev of events()) {
      if (ev.reasoning) {
        reasoningChars += ev.reasoning.length
        reasoningEvents++
        res.write(sseLine(makeChunk(id, model, { reasoning_content: ev.reasoning })))
      }
      if (ev.text) {
        contentChars += ev.text.length
        textEvents++
        res.write(sseLine(makeChunk(id, model, { content: ev.text })))
      }
      // 工具调用帧原样透传。上游按 index 分片下发 arguments，
      // 由 DSH 自己累积成完整调用 —— 这里绝不能丢，否则模型的
      // 操作意图整体消失，表现为「有思考没内容」然后中断。
      if (ev.toolCalls) {
        toolCallEvents++
        res.write(sseLine(makeChunk(id, model, { tool_calls: ev.toolCalls })))
      }
      if (ev.finish) finish = ev.finish
      if (ev.usage) usage = ev.usage
    }
  } catch (err) {
    res.write(sseLine({ error: { message: String((err as Error)?.message ?? err), type: 'upstream_error' } }))
    chatLog(`chat stream ERROR model=${model} ${String((err as Error)?.message ?? err).slice(0, 160)}`)
  }

  if (usage) {
    res.write(sseLine({ id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model, choices: [], usage }))
  }
  res.write(sseLine(makeChunk(id, model, {}, finish ?? 'stop')))
  res.write(SSE_DONE)
  res.end()
  chatLog(
    `chat done stream model=${model} finish=${finish ?? 'stop'}` +
      ` content=${contentChars}(${textEvents}段) reasoning=${reasoningChars}(${reasoningEvents}段)` +
      ` tool_calls=${toolCallEvents}帧` +
      // 有工具调用时 content 为空是正常的（模型在调工具，不是产文本），不能报"空响应"
      (contentChars === 0 && toolCallEvents === 0
        ? reasoningChars === 0
          ? '  ⚠ 完全空响应'
          : '  ⚠ content 为空'
        : ''),
  )
  markIdle()
}

async function healthz(ctx: Ctx): Promise<unknown> {
  if (!ctx.loaded || !ctx.client) {
    return { ok: false, stage: 'credentials', error: ctx.loadError }
  }
  const masked = maskKey(ctx.loaded.key.ak, ctx.loaded.key.sk)
  try {
    const key = await ctx.client.ensureSessionKey()
    const stsExpiry = ctx.sts?.expiresAtMs() ?? null
    return {
      ok: true,
      stage: 'ready',
      credentials: { source: ctx.loaded.source, ...masked },
      sts: stsExpiry ? { expiresAt: new Date(stsExpiry).toISOString() } : 'provided',
      sessionKey: { keyId: key.keyId, ttlSec: Math.round((key.expiresAt - Date.now()) / 1000) },
      models: ctx.models.length,
    }
  } catch (err) {
    return {
      ok: false,
      stage: 'handshake',
      error: String((err as Error)?.message ?? err),
      credentials: { source: ctx.loaded.source, ...masked },
    }
  }
}

/** 积分额度。字段取自 /snap-manager/v1/statistics/plugin 的 metrics。 */
export interface CreditInfo {
  /** 套餐总额度 */
  total: number
  used: number
  remain: number
  /** 基础包 */
  basic?: { amount: number; used: number; remain: number }
  /** 赠送包 */
  bonus?: { amount: number; used: number; remain: number }
  /** 按需付费包 */
  onDemand?: { amount: number; used: number; remain: number }
  /** 累计消耗 token */
  totalTokens?: number
}

function pickMetric(list: any[], name: string): any | undefined {
  return list.find((m) => m?.name === name)
}

/** 读积分额度。失败返回 null，不影响其它诊断项。 */
async function queryCredit(client: MadaoClient): Promise<CreditInfo | null> {
  try {
    const r = (await client.getJson('/snap-manager/v1/statistics/plugin')) as { metrics?: any[] }
    const list = r?.metrics ?? []
    const total = pickMetric(list, 'usageTotalPackageCredit')
    if (!total) return null
    const pkg = (m: any) =>
      m ? { amount: Number(m.package_credit_amount ?? 0), used: Number(m.package_credit_used ?? 0), remain: Number(m.package_credit_remain ?? 0) } : undefined
    const tokens = pickMetric(list, 'usageTokenChatMessages')
    return {
      total: Number(total.package_credit_amount ?? 0),
      used: Number(total.package_credit_used ?? 0),
      remain: Number(total.package_credit_remain ?? 0),
      basic: pkg(pickMetric(list, 'usageBasicPackageCredit')),
      bonus: pkg(pickMetric(list, 'usageBonusPackageCredit')),
      onDemand: pkg(pickMetric(list, 'usageOnDemandPackageCredit')),
      totalTokens: tokens ? Number(tokens.usage_token_num ?? 0) : undefined,
    }
  } catch {
    return null
  }
}

/**
 * 账号与额度详情。给输入框的「码道」浮层用。
 *
 * 额度每次都现查（有缓存副作用就不叫"刷新额度"了）。
 */
async function accountInfo(ctx: Ctx): Promise<unknown> {
  if (!ctx.loaded || !ctx.client) {
    return { ok: false, stage: 'credentials', error: ctx.loadError }
  }
  const masked = maskKey(ctx.loaded.key.ak, ctx.loaded.key.sk)
  // 身份来自 securityToken。直接用三件套时它在 loaded 里；
  // 只配 AK/SK 时看 STS 缓存，缓存为空才真去换一次。
  let token = ctx.loaded.key.securityToken ?? ctx.sts?.peek()?.securityToken
  if (!token && ctx.sts) {
    try {
      token = (await ctx.sts.get()).securityToken
    } catch {}
  }
  const identity = parseStsIdentity(token)
  // 借码道登录态时拿到的是临时三件套，会把到期时间一起带出来，
  // 面板要据此提示"还剩几分钟 / 已过期"。
  const borrowedExpiry =
    ctx.loaded.source === 'codearts'
      ? (typeof ctx.loaded.key.expiresAt === 'number'
          ? ctx.loaded.key.expiresAt
          : (ctx.loaded.expiresAtMs ?? null))
      : null
  const base: any = {
    ak: masked.ak,
    sk: masked.sk,
    source: ctx.loaded.source,
    account: identity.accountName,
    userId: identity.userId,
    /** 码道登录态借来的临时凭证到期时间（epoch ms）；永久 AK/SK 为 null */
    expiresAtMs: borrowedExpiry,
    /** 是否为临时凭证 —— 面板据此显示过期提示 */
    temporary: ctx.loaded.source === 'codearts',
  }
  try {
    const key = await ctx.client.ensureSessionKey()
    const stsExpiry = ctx.sts?.expiresAtMs() ?? null
    base.sts = stsExpiry ? { expiresAt: new Date(stsExpiry).toISOString(), ttlSec: Math.round((stsExpiry - Date.now()) / 1000) } : 'provided'
    base.sessionKey = { keyId: key.keyId, ttlSec: Math.round((key.expiresAt - Date.now()) / 1000) }

    const credit = await queryCredit(ctx.client)
    if (credit) base.credit = credit

    // 角色信息拿不到也无所谓，纯展示
    try {
      const roles = (await ctx.client.getJson('/snap-manager/v1/member/roles')) as any
      base.roles = roles?.enterprise_roles ?? []
    } catch {}

    return { ok: true, stage: 'ready', ...base }
  } catch (err) {
    return { ok: false, stage: 'handshake', error: String((err as Error)?.message ?? err), ...base }
  }
}

/**
 * 「测试」按钮：把整条链路走一遍。
 *
 * 1. 重新换 STS（失败即账号异常）
 * 2. 丢弃旧会话密钥重新协商
 * 3. 拉模型清单
 * 4. 读一次额度
 *
 * 每步单独记结果，方便看出卡在哪。
 */
async function runSelfTest(ctx: Ctx): Promise<unknown> {
  if (!ctx.loaded) return { ok: false, steps: [{ name: '凭证', ok: false, detail: ctx.loadError ?? '未加载' }] }

  const steps: Array<{ name: string; ok: boolean; detail?: string; ms?: number }> = []

  const step = async (name: string, fn: () => Promise<string | void>) => {
    const t0 = Date.now()
    try {
      const detail = await fn()
      steps.push({ name, ok: true, detail: detail || undefined, ms: Date.now() - t0 })
      return true
    } catch (e) {
      steps.push({ name, ok: false, detail: String((e as Error)?.message ?? e).slice(0, 200), ms: Date.now() - t0 })
      return false
    }
  }

  // 1) 强制刷新凭证：优先重读码道登录态（零配置场景下这是唯一来源）
  const stsOk = await step('凭证就绪', async () => {
    // 重新加载一次，能捡到用户在码道里刚刷新过的登录态
    let reloaded: LoadResult | null = null
    try {
      reloaded = await loadCredentials()
    } catch {}
    if (reloaded) {
      ctx.loaded = reloaded
      ctx.loadError = null
      if (!reloaded.key.securityToken && !ctx.sts) {
        try {
          ctx.sts = new StsProvider({ ak: reloaded.key.ak, sk: reloaded.key.sk })
        } catch {}
      }
    }

    const l = ctx.loaded
    if (!l) throw new Error(ctx.loadError ?? '未加载')

    if (l.key.securityToken) {
      const left = typeof l.key.expiresAt === 'number' ? Math.round((l.key.expiresAt - Date.now()) / 60000) : null
      const from = l.source === 'codearts' ? '码道登录态' : l.source
      return `${from} · 临时凭证${left !== null ? `，剩 ${left} 分钟` : ''}`
    }

    const sts = new StsProvider({ ak: l.key.ak, sk: l.key.sk })
    const creds = await sts.credentials()
    ctx.sts = sts
    ctx.client = new MadaoClient({ credentials: creds })
    return `永久 AK/SK · 已换 STS，有效至 ${new Date(sts.expiresAtMs() ?? 0).toLocaleTimeString()}`
  })
  if (!stsOk) return { ok: false, steps }

  // 2) 重新协商会话密钥（换模型也靠这个，避免用旧 key）
  await step('密钥协商', async () => {
    ctx.client!.resetSessionKey()
    const k = await ctx.client!.ensureSessionKey()
    return `keyId ${k.keyId.slice(0, 8)} · TTL ${Math.round((k.expiresAt - Date.now()) / 1000)}s`
  })

  // 3) 拉模型清单
  await step('模型清单', async () => {
    const { discoverModels } = await import('./models.ts')
    const found = await discoverModels(ctx.client!)
    if (found.source === 'gateway') {
      ctx.models = found.models
      return `${found.models.length} 个模型`
    }
    throw new Error(found.error ?? '网关未返回清单')
  })

  // 4) 额度
  await step('积分额度', async () => {
    const c = await queryCredit(ctx.client!)
    if (!c) throw new Error('额度接口无返回')
    return `剩余 ${c.remain} / 共 ${c.total}`
  })

  const ok = steps.every((s) => s.ok)
  return { ok, steps }
}

function readBody(req: IncomingMessage): Promise<string> {  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(Buffer.from(c)))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function json(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) })
  res.end(body)
}










