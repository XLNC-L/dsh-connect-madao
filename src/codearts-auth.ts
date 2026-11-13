/**
 * 从码道（CodeArts Agent）的本地登录态里取临时凭证。
 *
 * 目的：让用户不必手工去华为云控制台创建 AK/SK。
 * 只要装过码道并登录过，插件就能直接用它已经换好的临时三件套。
 *
 * 凭证位置（明文存在 VS Code 的全局 state 里）：
 *
 *   %APPDATA%\codearts-agent\User\globalStorage\state.vscdb
 *
 * 里面是 SQLite，但 value 是明文 JSON，所以直接对文件做二进制搜索即可 ——
 * 不必引入 SQLite 依赖。目标片段形如：
 *
 *   { "hw001227068727036", "loginType":"codearts", "time_stamp":...,
 *     "originData": {
 *       "id": "huawei-cloud-authentication",
 *       "account": { "id": "...", "label": "hw001227068727036" },
 *       "accessKey":   "HST...",     ← 临时 AK
 *       "secretKey":   "...",        ← 临时 SK
 *       "securityToken":"hQpjbi1...",← STS
 *       "expiresAt":   "2026-11-12T14:46:35.786Z",
 *       "domainId":    "...",
 *       "stationType": "china" } }
 *
 * 注意：这些是**临时凭证**，寿命有限（几小时）。
 * 过期后需要先打开码道刷新登录态，或改用永久 AK/SK。
 */

import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

/** 标识这个 JSON 是华为云登录态。 */
const ANCHOR = '"id":"huawei-cloud-authentication"'

/** 候选的 state.vscdb 路径（不同版本/安装方式可能不同）。 */
export function candidateStateDbPaths(): string[] {
  const appData = process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming')
  const base = [
    join(appData, 'codearts-agent', 'User', 'globalStorage', 'state.vscdb'),
    join(appData, 'CodeArts Agent', 'User', 'globalStorage', 'state.vscdb'),
    join(appData, 'codearts', 'User', 'globalStorage', 'state.vscdb'),
  ]
  return base
}

export interface CodeArtsCredential {
  ak: string
  sk: string
  securityToken: string
  /** 过期时间（epoch ms），未知则 null */
  expiresAtMs: number | null
  /** 账号名，如 hw001227068727036 */
  account?: string
  /** 从哪个文件读到的 */
  sourcePath: string
}

/** 在 state.vscdb 里定位并解析登录态。找不到返回 null。 */
function parseFromRaw(raw: string, sourcePath: string): CodeArtsCredential | null {
  const at = raw.indexOf(ANCHOR)
  if (at < 0) return null

  // 不从 `{` 开始做括号配对 —— state.vscdb 是 SQLite 二进制，
  // 往前回溯很容易撞上无关的 `{` 把起点找错。结构已知，
  // 直接取锚点之后的一小段，用正则抠字段更稳。
  const seg = raw.slice(at, at + 8192)

  const grab = (key: string): string | undefined => {
    const m = new RegExp(`"${key}"\\s*:\\s*"([^"]*)"`).exec(seg)
    return m?.[1] || undefined
  }

  const ak = grab('accessKey')
  const sk = grab('secretKey')
  const sts = grab('securityToken')
  if (!ak || !sk || !sts) return null

  const expires = grab('expiresAt')
  const t = expires ? Date.parse(expires) : NaN

  // 账号名在 originData.account.label 里，也可能在锚点前的外层对象里
  const account = /"account"\s*:\s*\{[^}]*"label"\s*:\s*"([^"]+)"/.exec(seg)?.[1]

  return {
    ak,
    sk,
    securityToken: sts,
    expiresAtMs: Number.isFinite(t) ? t : null,
    account,
    sourcePath,
  }
}

/**
 * 读取码道登录态里的临时凭证。
 *
 * @param minRemainingMs 至少还要剩这么多有效期才算可用，默认 5 分钟
 * @returns 找到且未过期则返回凭证，否则 null
 */
export function readCodeArtsCredential(minRemainingMs = 5 * 60 * 1000): CodeArtsCredential | null {
  for (const p of candidateStateDbPaths()) {
    if (!existsSync(p)) continue
    let raw: string
    try {
      raw = readFileSync(p, 'utf8')
    } catch {
      continue
    }
    const cred = parseFromRaw(raw, p)
    if (!cred) continue
    if (cred.expiresAtMs !== null && cred.expiresAtMs - Date.now() < minRemainingMs) {
      // 找到了但快过期/已过期：不静默使用，交给上层决定
      continue
    }
    return cred
  }
  return null
}

/** 只报告状态，不返回可用凭证；用于诊断面板。 */
export function probeCodeArtsCredential(): {
  present: boolean
  expiresAtMs: number | null
  account?: string
  sourcePath?: string
} {
  for (const p of candidateStateDbPaths()) {
    if (!existsSync(p)) continue
    let raw: string
    try {
      raw = readFileSync(p, 'utf8')
    } catch {
      continue
    }
    const cred = parseFromRaw(raw, p)
    if (cred) return { present: true, expiresAtMs: cred.expiresAtMs, account: cred.account, sourcePath: p }
  }
  return { present: false, expiresAtMs: null }
}
