/**
 * 凭证供应：从永久 AK/SK 自动维护 STS，并在过期前自动续期。
 *
 * 码道网关要求三件套：AK + SK + STS token。
 * 永久 AK/SK 不能直接用（网关会以 APIG.0301 拒绝），
 * 必须先经 IAM 换成临时凭证。
 *
 * 生命周期：
 *   永久 AK/SK  ──IAM──▶  临时 AK/SK + STS  ──签名──▶  网关
 *                ↑                              │
 *                └────── 过期前 10 分钟自动续期 ──┘
 */

import { getStsFromIam, type TemporaryCredential } from './sts.ts'
import type { Credentials } from './protocol/sign.ts'

/** STS 剩余有效期低于该值时续期。 */
const REFRESH_MARGIN_MS = 10 * 60 * 1000

export interface PermanentKey {
  ak: string
  sk: string
}

/**
 * STS 供应器。线程安全：并发请求只触发一次交换。
 */
export class StsProvider {
  private current: TemporaryCredential | null = null
  private pending: Promise<TemporaryCredential> | null = null
  private readonly ak: string
  private readonly sk: string
  private readonly durationSeconds: number

  constructor(key: PermanentKey, durationSeconds = 3600) {
    this.ak = key.ak
    this.sk = key.sk
    this.durationSeconds = durationSeconds
  }

  /** 取可用的 STS 凭证；临近过期则续期。 */
  async get(): Promise<TemporaryCredential> {
    if (this.current && !this.isExpiring(this.current)) return this.current
    if (this.pending) return this.pending

    this.pending = getStsFromIam(this.ak, this.sk, this.durationSeconds)
      .then((c) => {
        this.current = c
        return c
      })
      .finally(() => {
        this.pending = null
      })

    return this.pending
  }

  /** 直接产出可签名的 Credentials。 */
  async credentials(): Promise<Credentials> {
    const c = await this.get()
    return { ak: c.ak, sk: c.sk, securityToken: c.securityToken }
  }

  /** 强制丢弃缓存，下次 get() 会重新交换。 */
  invalidate(): void {
    this.current = null
  }

  /**
   * 只读当前缓存的凭证，不触发交换。
   *
   * 面板要展示 STS 身份时需要 securityToken 明文，
   * 但又不该为了看一眼身份就多换一次 STS（IAM 有限流）。
   */
  peek(): TemporaryCredential | null {
    return this.current
  }

  /** 当前 STS 的过期时间（epoch ms），无则为 null。 */
  expiresAtMs(): number | null {
    if (!this.current?.expiresAt) return null
    const t = Date.parse(this.current.expiresAt)
    return Number.isFinite(t) ? t : null
  }

  private isExpiring(c: TemporaryCredential): boolean {
    if (!c.expiresAt) return false
    const t = Date.parse(c.expiresAt)
    if (!Number.isFinite(t)) return false
    return Date.now() > t - REFRESH_MARGIN_MS
  }
}
