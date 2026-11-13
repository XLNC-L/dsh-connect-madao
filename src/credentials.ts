/**
 * 凭证加载。
 *
 * 码道网关需要三件套（AK + SK + STS）。用户手上可能是：
 *
 *   A. 永久 AK/SK        → 运行时由 StsProvider 自动换 STS（最持久）
 *   B. 已换好的三件套     → 直接使用，过期需刷新
 *   C. 什么都没配         → 从码道客户端的登录态里白拿（零配置，但会过期）
 *
 * 来源优先级：
 *   1. 环境变量 MADAO_AK / MADAO_SK [/ MADAO_SECURITY_TOKEN]
 *   2. 文件 ~/.dsh-connect-madao/credentials.json
 *   3. 码道登录态 %APPDATA%\codearts-agent\User\globalStorage\state.vscdb
 *
 * 永久凭证排在登录态前面：登录态里的三件套只有几小时寿命，
 * 而永久 AK/SK 可以无限续换，不该被临时的盖掉。
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { readCodeArtsCredential } from './codearts-auth.ts'
import { dpapiDecrypt, dpapiEncrypt } from './dpapi.ts'

/**
 * 凭证文件位置。
 *
 * 为什么把写入位置放到 %APPDATA%：
 * 原先用 `~/.dsh-connect-madao/credentials.json`，但那个文件在某些机器上
 * 会变成只有 Read 权限的 ACL（实测：`XLNC'S-PC\XLNC = Read, Synchronize`），
 * 导致面板「保存」写入时抛 EPERM，`icacls` / `Set-Acl` / 删除也都被拒。
 *
 * 所以：
 *   - 写入 → 新路径（%APPDATA%\dsh-connect-madao\credentials.json）
 *   - 读取 → 新路径优先，其次旧路径（兼容已存在的配置）
 */
export const CRED_DIR = join(process.env.APPDATA || join(homedir(), '.config'), 'dsh-connect-madao')

/** 写入目标。 */
export const DEFAULT_CRED_PATH = join(CRED_DIR, 'credentials.json')

/** 加密凭证文件（首选）。 */
export const CRED_ENC_PATH = join(CRED_DIR, 'credentials.enc')

/** 旧路径，只读兼容。 */
export const LEGACY_CRED_PATH = join(homedir(), '.dsh-connect-madao', 'credentials.json')

export interface StoredKey {
  ak: string
  sk: string
  /** 可选；有则直接用，无则由 StsProvider 现换 */
  securityToken?: string
  expiresAt?: string | number
  region?: string
  account?: string
}

export class CredentialError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CredentialError'
  }
}

function fromEnv(): StoredKey | null {
  const ak = process.env.MADAO_AK?.trim()
  const sk = process.env.MADAO_SK?.trim()
  if (!ak || !sk) return null
  const token = process.env.MADAO_SECURITY_TOKEN?.trim()
  return { ak, sk, ...(token ? { securityToken: token } : {}) }
}

/** 从已解析的 JSON 对象里抽出凭证，容忍华为云 CSV 的字段名。 */
function parseStored(parsed: any, where: string): StoredKey {
  const ak = parsed.ak ?? parsed.accessKeyId ?? parsed.access_key_id ?? parsed['Access Key Id']
  const sk = parsed.sk ?? parsed.secretAccessKey ?? parsed.secret_access_key ?? parsed['Secret Access Key']
  const securityToken =
    parsed.securityToken ?? parsed.security_token ?? parsed.securitytoken ?? parsed.token

  if (!ak || !sk) {
    throw new CredentialError(`${where} 缺少 ak / sk`)
  }

  return {
    ak: String(ak).trim(),
    sk: String(sk).trim(),
    ...(securityToken ? { securityToken: String(securityToken) } : {}),
    expiresAt: parsed.expiresAt,
    region: parsed.region,
    account: parsed.account,
  }
}

/**
 * 读加密凭证（DPAPI）。
 *
 * 这是首选存储形式：密文用 Windows 账户绑定的密钥加密，
 * 拷到别的机器或别的用户下都解不开。
 */
async function fromEncryptedFile(): Promise<StoredKey | null> {
  let cipher: string
  try {
    cipher = await readFile(CRED_ENC_PATH, 'utf8')
  } catch {
    return null
  }
  const plain = dpapiDecrypt(cipher)
  if (!plain) return null
  try {
    return parseStored(JSON.parse(plain), CRED_ENC_PATH)
  } catch {
    return null
  }
}

async function fromFile(path: string): Promise<StoredKey | null> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch {
    return null
  }

  let parsed: any
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new CredentialError(`${path} 不是合法 JSON`)
  }
  return parseStored(parsed, path)
}

/**
 * 保存凭证：优先 DPAPI 加密，不可用时回退明文。
 *
 * 加密成功后会把遗留的明文文件改成 `.bak` —— 不是直接删，
 * 万一用户还想手工看一眼；但他也可以随时删掉它。
 */
export async function saveCredentials(key: { ak: string; sk: string }): Promise<{
  encrypted: boolean
  path: string
}> {
  const payload = JSON.stringify({ ak: key.ak, sk: key.sk }, null, 2)
  await mkdir(CRED_DIR, { recursive: true })

  const enc = dpapiEncrypt(payload)
  if (enc) {
    await writeFile(CRED_ENC_PATH, enc, 'utf8')
    // 明文不再需要：改名备份，避免同时留两份可读副本
    try {
      await rename(DEFAULT_CRED_PATH, `${DEFAULT_CRED_PATH}.bak`)
    } catch {
      // 不存在就算了
    }
    return { encrypted: true, path: CRED_ENC_PATH }
  }

  await writeFile(DEFAULT_CRED_PATH, payload, 'utf8')
  return { encrypted: false, path: DEFAULT_CRED_PATH }
}

export interface LoadResult {
  key: StoredKey
  source: 'env' | 'file' | 'codearts'
  path?: string
  /** source='codearts' 时：登录态里的三件套到期时间 */
  expiresAtMs?: number | null
}

/**
 * 把遗留的明文凭证就地加密（启动时调用一次）。
 *
 * 这样老用户升级后不用做任何操作，明文文件会被自动换成 DPAPI 密文，
 * 原名改成 `.bak`。失败则保持原样 —— 能读能用比"安全但跑不起来"重要。
 */
export async function migratePlaintextToEncrypted(): Promise<boolean> {
  try {
    // 已经是加密文件就不用管
    const already = await readFile(CRED_ENC_PATH, 'utf8').catch(() => null)
    if (already) return false

    const plain = await fromFile(DEFAULT_CRED_PATH)
    if (!plain) return false

    const r = await saveCredentials({ ak: plain.ak, sk: plain.sk })
    return r.encrypted
  } catch {
    return false
  }
}

/**
 * 列出**所有**可用的凭证来源，按优先级排序。
 *
 * 差异说明：`loadCredentials()` 是「取第一个存在且格式正确的」，
 * 但"存在且格式正确"不等于"真能用" —— 比如 AK 在控制台被停用后，
 * 文件还在、格式也对，实际调用却一直 0301。
 *
 * 所以启动时用这个函数拿到候选列表，逐个试着换 STS，
 * 第一个真能通的才采用。这样用户配错了凭证也不会卡死，
 * 插件会自动退到下一个来源。
 */
export interface Candidate extends LoadResult {
  /** 人类可读的来源说明，用于日志 */
  label: string
}

export async function candidateCredentials(path: string = DEFAULT_CRED_PATH): Promise<Candidate[]> {
  const out: Candidate[] = []

  const env = fromEnv()
  if (env) out.push({ key: env, source: 'env', label: '环境变量 MADAO_AK/MADAO_SK' })

  // DPAPI 加密文件优先于明文：如果两者都在，用加密的那份
  const encrypted = await fromEncryptedFile()
  if (encrypted) {
    out.push({ key: encrypted, source: 'file', path: CRED_ENC_PATH, label: `加密凭证 ${CRED_ENC_PATH}` })
  }

  const file = await fromFile(path)
  if (file) out.push({ key: file, source: 'file', path, label: `凭证文件 ${path}（明文）` })

  if (path !== LEGACY_CRED_PATH) {
    const legacy = await fromFile(LEGACY_CRED_PATH)
    if (legacy) {
      out.push({ key: legacy, source: 'file', path: LEGACY_CRED_PATH, label: `凭证文件 ${LEGACY_CRED_PATH}（旧路径）` })
    }
  }

  const borrowed = readCodeArtsCredential()
  if (borrowed) {
    out.push({
      key: {
        ak: borrowed.ak,
        sk: borrowed.sk,
        securityToken: borrowed.securityToken,
        account: borrowed.account,
        ...(borrowed.expiresAtMs ? { expiresAt: borrowed.expiresAtMs } : {}),
      },
      source: 'codearts',
      path: borrowed.sourcePath,
      expiresAtMs: borrowed.expiresAtMs,
      label: `码道客户端登录态（${borrowed.account ?? '未知账号'}）`,
    })
  }

  return out
}

export async function loadCredentials(path: string = DEFAULT_CRED_PATH): Promise<LoadResult> {
  const env = fromEnv()
  if (env) return { key: env, source: 'env' }

  // 加密文件优先于明文
  const encrypted = await fromEncryptedFile()
  if (encrypted) return { key: encrypted, source: 'file', path: CRED_ENC_PATH }

  const file = await fromFile(path)
  if (file) return { key: file, source: 'file', path }

  // 兼容旧路径（只读）：老用户已经把凭证放在 ~/.dsh-connect-madao 里
  if (path !== LEGACY_CRED_PATH) {
    const legacy = await fromFile(LEGACY_CRED_PATH)
    if (legacy) return { key: legacy, source: 'file', path: LEGACY_CRED_PATH }
  }

  // 零配置兜底：直接借码道客户端已经换好的临时三件套。
  // 用户装过码道并登录过就能用，不必去控制台创建 AK/SK。
  const borrowed = readCodeArtsCredential()
  if (borrowed) {
    return {
      key: {
        ak: borrowed.ak,
        sk: borrowed.sk,
        securityToken: borrowed.securityToken,
        account: borrowed.account,
        ...(borrowed.expiresAtMs ? { expiresAt: borrowed.expiresAtMs } : {}),
      },
      source: 'codearts',
      path: borrowed.sourcePath,
      expiresAtMs: borrowed.expiresAtMs,
    }
  }

  throw new CredentialError(
    [
      '未找到码道凭证。任选其一：',
      '  A) 环境变量 MADAO_AK / MADAO_SK',
      `  B) 写入 ${path}：{"ak":"...","sk":"..."}`,
      '  C) 打开一次码道客户端并确认已登录 —— 插件会自动借用它的临时凭证',
      'ak/sk 为华为云 IAM 访问密钥（控制台 → 我的凭证 → 访问密钥）。',
      'STS 临时令牌会在运行时自动换取，无需手填。',
    ].join('\n'),
  )
}

/** 掩码化，用于日志与界面展示。 */
export function maskKey(ak: string, sk: string): { ak: string; sk: string } {
  const m = (s: string) => (s.length <= 8 ? '***' : `${s.slice(0, 4)}…${s.slice(-4)}`)
  return { ak: m(ak), sk: m(sk) }
}

