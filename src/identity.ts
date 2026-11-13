/**
 * 从 STS 的 securityToken 里解出用户身份。
 *
 * 华为云 IAM 返回的 securitytoken 是一个 base64 编码的 JSON：
 *
 *   {
 *     "access": "...", "issued_at": ..., "timeout_at": ...,
 *     "user": {
 *       "domain": { "id": "...", "name": "hw001227068727036" },
 *       "id":   "01a1c4c18fc87f309310053dd1a7ea49",
 *       "name": "hw001227068727036",
 *       "user_type": 17
 *     }
 *   }
 *
 * 这是网关能给的**全部**身份信息 —— 没有昵称、邮箱、手机号。
 * 所以面板里只能显示华为云账号名，并额外给出 user id 便于核对。
 */

export interface StsIdentity {
  /** 华为云账号名，如 hw001227068727036 */
  accountName?: string
  /** 账号（domain）id */
  domainId?: string
  /** IAM 用户 id */
  userId?: string
  /** IAM 用户类型：17 通常表示「华为云账号」 */
  userType?: number
}

/**
 * 从首个 `{` 开始做括号配对，返回 JSON 片段的结束位置（含）。
 *
 * 不能用 lastIndexOf('}')：token 尾部还有一段二进制签名，
 * 里面会偶然出现 `}`，会把整段 JSON 截坏。
 */
function findJsonEnd(raw: string, start: number): number {
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

/** 尽力解析；解不出来返回空对象而不是抛错。 */
export function parseStsIdentity(securityToken: string | undefined): StsIdentity {
  if (!securityToken) return {}
  try {
    // securitytoken 不是纯 base64 JSON：前面有一段二进制头
    // （形如 `\x82\x0acn-north-4Q!` 再跟 JSON），尾部还有一段二进制签名。
    // 所以先解 base64，再靠括号配对精确切出 JSON。
    const raw = Buffer.from(securityToken, 'base64').toString('utf8')
    const start = raw.indexOf('{')
    if (start < 0) return {}
    const end = findJsonEnd(raw, start)
    if (end < 0) return {}
    const obj = JSON.parse(raw.slice(start, end + 1)) as any
    const user = obj?.user ?? {}
    return {
      accountName: user?.name ?? user?.domain?.name,
      domainId: user?.domain?.id,
      userId: user?.id,
      userType: typeof user?.user_type === 'number' ? user.user_type : undefined,
    }
  } catch {
    return {}
  }
}

/** 取 id 的前 8 位便于展示。 */
export function shortId(id: string | undefined): string {
  if (!id) return '—'
  return id.length > 10 ? `${id.slice(0, 8)}…` : id
}
