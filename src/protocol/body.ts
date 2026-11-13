/**
 * 码道请求体构造。
 *
 * 实测自内核 fR()：
 *   { model, messages, max_tokens, stream, temperature? }
 *
 * 即标准 OpenAI Chat Completions 形状 —— 适配层不需要做结构重写，
 * 只需把上游的 SSE 事件翻译成 OpenAI 的 chunk 形状。
 */

export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | Array<{ type: string; text?: string }>
  name?: string
  tool_call_id?: string
  tool_calls?: unknown[]
}

export interface ChatRequestBody {
  model: string
  messages: OpenAIMessage[]
  max_tokens: number
  stream: boolean
  temperature?: number
  top_p?: number
  stop?: string | string[]
  tools?: unknown[]
  tool_choice?: unknown
  /** 思考强度，如 "high" / "max"；仅部分模型支持 */
  strength?: string
  [k: string]: unknown
}

const DEFAULT_MAX_TOKENS = 65536

/**
 * 检测消息里是否夹带图片 / 非文本内容。
 *
 * 桥接目前只转发文本：`flattenContent()` 会把 image part 变成空串。
 * 与其静默丢弃（用户以为图发出去了，其实没有），不如明确报错。
 */
/**
 * 规范化 content，保留网关能处理的 part。
 *
 * 实测结论（用 8×8 纯蓝 PNG 验证，model=deepseek-v4.1-flash）：
 *   {type:"image_url", image_url:{url:"data:image/png;base64,…"}}  → 正常识别，回答"蓝色"
 *   {type:"file", filename, mime, url}（码道内部格式）              → 网关返回空
 *   {type:"image", url}                                            → 网关返回空
 *   无图基线                                                        → 回答"无法判断"
 *
 * 也就是说码道网关走的是**标准 OpenAI image_url**，所以这里原样保留它，
 * 只把网关不认识的其他 part（音频、file 等）丢掉。
 */
export function normalizeContent(content: unknown): string | Array<{ type: string }> {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''

  const parts: Array<{ type: string }> = []
  for (const raw of content as any[]) {
    if (!raw || typeof raw !== 'object') continue
    if (raw.type === 'text' && typeof raw.text === 'string') {
      parts.push({ type: 'text', text: raw.text })
    } else if (raw.type === 'image_url' && raw.image_url?.url) {
      parts.push({ type: 'image_url', image_url: { url: String(raw.image_url.url) } })
    }
  }

  // 空数组返回空字符串：上游期待字符串，给它 [] 反而可能被判非法
  if (parts.length === 0) return ''

  // 全是文本就折成字符串：更省 token，也兼容只认字符串的上游
  if (parts.every((p: any) => p.type === 'text')) {
    return (parts as any[]).map((p) => p.text).join('')
  }
  return parts
}

/** 是否存在网关不支持的内容类型（音频、file 等）。 */
export function hasUnsupportedContent(messages: OpenAIMessage[] | undefined): string | null {
  for (const m of messages ?? []) {
    if (!Array.isArray(m?.content)) continue
    for (const part of m.content as Array<{ type?: string }>) {
      const t = part?.type
      if (typeof t === 'string' && t !== 'text' && t !== 'image_url') return t
    }
  }
  return null
}



/**
 * 规范化发往码道的请求体。
 *
 * - messages 的 content 统一成字符串
 * - 强制 stream=true（本插件只做流式；非流式由上层聚合）
 * - 补 max_tokens 默认值
 */
export function buildUpstreamBody(req: ChatRequestBody, overrides: Partial<ChatRequestBody> = {}): ChatRequestBody {
  const messages = (req.messages ?? []).map((m) => ({
    // 网关不认 `developer` 角色。
    // OpenAI 新规范里 DSH 用 developer 承载系统提示，而码道网关只接受
    // system/user/assistant/tool —— 遇到 developer 会**静默返回空响应**
    // （HTTP 200、finish=stop、content 为空），上层只能看到 EMPTY_RESPONSE，
    // 完全看不出原因。这里统一降级成 system。
    role: m.role === 'developer' ? 'system' : m.role,
    content: normalizeContent(m.content),
    ...(m.name ? { name: m.name } : {}),
    ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
    ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
  }))

  const body: ChatRequestBody = {
    model: req.model,
    messages: messages as OpenAIMessage[],
    max_tokens: req.max_tokens ?? DEFAULT_MAX_TOKENS,
    stream: true,
    ...(typeof req.temperature === 'number' ? { temperature: req.temperature } : {}),
    ...(typeof req.top_p === 'number' ? { top_p: req.top_p } : {}),
    ...(req.stop ? { stop: req.stop } : {}),
    ...(req.tools ? { tools: req.tools } : {}),
    ...(req.tool_choice ? { tool_choice: req.tool_choice } : {}),
    // 思考强度：取值来自 POST /v1/model/thinking-variants 的 strengths
    // （目前只有 GLM-5.2 / glm-5.2-sft-harmony 支持 high|max）
    // 思考强度。
    //
    // 网关认的是 **`reasoning_effort`**，不是 `strength` —— 之前一直发
    // `strength` 字段，网关当未知字段忽略，所以界面上换档位毫无效果。
    //
    // 实测（GLM-5.2，同一道题各跑 3 次取平均）：
    //   reasoning_effort=high → reasoning 1014 字
    //   不传                  → reasoning 1254 字
    //   reasoning_effort=max  → reasoning 1323 字
    // 组内波动 σ≈75，组间差异 240/69，确认字段真的生效。
    //
    // `off` 走网关的 `none`（内核里 forceReasoningNone 也是这么发的）。
    ...(typeof req.strength === 'string' && req.strength
      ? { reasoning_effort: req.strength === 'off' ? 'none' : req.strength }
      : {}),
  }

  return { ...body, ...overrides }
}


