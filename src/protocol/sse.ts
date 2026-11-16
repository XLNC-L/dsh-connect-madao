/**
 * SSE 翻译层：把码道上游的事件流转成 OpenAI 的 `data: {...}` chunk 序列。
 *
 * 上游实测是 ai-sdk 风格，事件名包含：
 *   text-delta / reasoning / message.part.updated / message.updated / session.idle
 *
 * 但码道在 OpenAI 兼容路径上实际返回的是 `data: {...}` 的 choices 增量，
 * 因此这里做「宽容解析」：优先识别 OpenAI 形状，其次识别 ai-sdk 形状。
 */

/**
 * 用量。除了三个总数，还带上缓存命中数。
 *
 * cached 是输入中命中前缀缓存的 token 数。码道默认开前缀缓存，
 * 命中部分价格约为冷启动的 1/10；把这个数如实带给下游，账本才算得准。
 */
export interface UsageInfo {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  /** 输入中命中前缀缓存的 token 数；上游不给时为 undefined */
  cached_tokens?: number
  /**
   * OpenAI 标准位置：`prompt_tokens_details.cached_tokens`。
   *
   * 我们的 usage 是从上游挑字段重组的，所以要按标准形状再摆一遍 ——
   * 顶层 `cached_tokens` 虽然也有客户端认（pi-ai 就认），但标准位置
   * 兼容面更广，两个都带没有坏处。
   */
  prompt_tokens_details?: { cached_tokens: number }
}

export interface OpenAIDelta {
  role?: string
  content?: string
  reasoning_content?: string
  /**
   * 工具调用增量。上游按 index 分片下发，arguments 逐片累积，
   * 这里原样透传，由客户端（DSH）自己合并。
   *
   * 丢了它就等于丢了模型的全部实际操作意图 —— 表现是
   * `finish_reason: "tool_calls"` 但 content 为空，上层只看到
   * "有思考、没内容"，于是判定异常并中断。
   */
  tool_calls?: unknown[]
}

export interface OpenAIChunk {
  id: string
  object: 'chat.completion.chunk'
  created: number
  model: string
  choices: Array<{
    index: number
    delta: OpenAIDelta
    finish_reason: string | null
  }>
  usage?: UsageInfo
}

export function makeChunk(
  id: string,
  model: string,
  delta: OpenAIDelta,
  finishReason: string | null = null,
): OpenAIChunk {
  return {
    id,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  }
}

export function sseLine(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`
}

export const SSE_DONE = 'data: [DONE]\n\n'

export interface ParsedEvent {
  /** 已提取的文本增量 */
  text?: string
  /** 已提取的推理增量 */
  reasoning?: string
  /** 工具调用增量（原样透传） */
  toolCalls?: unknown[]
  /** 结束原因 */
  finish?: string
  /** 用量（含缓存命中数） */
  usage?: UsageInfo
  /** 是否收到结束信号 */
  done?: boolean
  /** 原始对象，供调试 */
  raw?: unknown
}

/**
 * 解析一条 SSE 事件（已去掉 `data: ` 前缀的 JSON 文本）。
 * 不认识的形状返回空对象，调用方应跳过。
 */
/**
 * 从上游 usage 对象里挑出我们认识的字段。
 *
 * 两种命名都要认：OpenAI 原生 snake_case（prompt_tokens）和
 * 某些网关的 camelCase（promptTokens）。缓存数同理，上游可能与
 * `prompt_tokens_details.cached_tokens`（OpenAI 标准位置）或
 * `cached_tokens`（扁平）两种形状出现，都试一遍。
 */
/**
 * 把上游给的值转成非负数字。
 *
 * 空字符串、布尔、NaN、负数一律视为「上游没给」，返回 null。
 * 这样下游能区分「没有缓存数据」和「缓存命中 0 个」。
 */
function toNonNegativeNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? v : null
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isFinite(n) && n >= 0 ? n : null
  }
  return null
}

export function pickUsage(raw: any): UsageInfo {
  const u = raw ?? {}
  const usage: UsageInfo = {
    prompt_tokens: u.promptTokens ?? u.prompt_tokens ?? 0,
    completion_tokens: u.completionTokens ?? u.completion_tokens ?? 0,
    total_tokens: u.totalTokens ?? u.total_tokens ?? 0,
  }
  const cached =
    u.prompt_tokens_details?.cached_tokens ??
    u.promptTokensDetails?.cached_tokens ??
    u.promptTokensDetails?.cachedTokens ??
    u.cached_tokens ??
    u.cachedTokens ??
    u.cache_read_input_tokens ??
    undefined
  // 注意 Number('') 和 Number(false) 都是 0 —— 上游万一给了空串或布尔值，
  // 不能当成「命中 0 个缓存」，那会把 undefined（上游没给）和 0（真没命中）
  // 混为一谈。这里只接受真正的数字或非空数字字符串。
  const n = toNonNegativeNumber(cached)
  if (n != null) {
    usage.cached_tokens = n
    usage.prompt_tokens_details = { cached_tokens: n }
  }
  return usage
}

export function parseUpstreamEvent(data: string): ParsedEvent {
  const trimmed = data.trim()
  if (!trimmed) return {}
  if (trimmed === '[DONE]') return { done: true }

  let obj: any
  try {
    obj = JSON.parse(trimmed)
  } catch {
    return {}
  }

  const out: ParsedEvent = { raw: obj }

  // ── OpenAI 形状 ──────────────────────────────────────────
  if (Array.isArray(obj.choices)) {
    const out: ParsedEvent = { raw: obj }

    // usage 可能出现在 choices:[] 的独立帧里（码道就是这样发的）
    if (obj.usage) {
      out.usage = pickUsage(obj.usage)
    }

    const ch = obj.choices[0]
    if (!ch) return out

    const d = ch.delta ?? ch.message ?? {}
    if (typeof d.content === 'string' && d.content) out.text = d.content
    if (typeof d.reasoning_content === 'string' && d.reasoning_content) {
      out.reasoning = d.reasoning_content
    }
    if (typeof d.reasoning === 'string' && d.reasoning) out.reasoning = d.reasoning
    // 工具调用必须原样带出去，否则调用意图整体丢失
    if (Array.isArray(d.tool_calls) && d.tool_calls.length > 0) out.toolCalls = d.tool_calls
    if (ch.finish_reason) out.finish = String(ch.finish_reason)
    return out
  }

  // ── ai-sdk 形状 ──────────────────────────────────────────
  const type = typeof obj.type === 'string' ? obj.type : ''

  if (type === 'text-delta' || type === 'text_delta') {
    out.text = obj.delta ?? obj.textDelta ?? obj.text ?? ''
    return out
  }
  if (type === 'reasoning' || type === 'reasoning-delta') {
    out.reasoning = obj.delta ?? obj.textDelta ?? obj.text ?? ''
    return out
  }
  if (type === 'finish' || type === 'finish-step') {
    out.finish = obj.finishReason ?? obj.finish_reason ?? 'stop'
    if (obj.usage) {
      out.usage = pickUsage(obj.usage)
    }
    return out
  }
  if (type === 'error') {
    out.finish = 'error'
    return out
  }
  if (type === 'message.part.updated') {
    const part = obj.part ?? obj.properties?.part ?? {}
    if (part.type === 'text' && typeof part.text === 'string') out.text = part.text
    if (part.type === 'reasoning' && typeof part.text === 'string') out.reasoning = part.text
    return out
  }

  return out
}
