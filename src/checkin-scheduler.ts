/**
 * 自动签到调度器。
 *
 * 为什么要它：签到是**一天一次**的收益，而人最容易漏的正是「每天都得记得点」。
 * 之前只有设置页里一个按钮，忘了点当天那 100 积分就是白丢。
 *
 * 设计上刻意克制：
 *   - 默认**关闭**，用户显式打开才算（安静地替人花钱/改状态不是好默认）
 *   - 每天只在本地时间的一个钟点跑一次，不在开机时突击
 *   - 当天已领过就什么都不做（claimable 判断 + 上游幂等，重复调用无副作用）
 *   - 失败只记日志，不重试轰炸上游，也不影响桥接服务
 *   - 跟 ctx.effect 绑定，插件卸载时定时器一起停
 */

import { claimAllCheckins, queryCredit } from './server.ts'
import type { MadaoClient } from './client.ts'
import { evaluateExpiry, type ExpiryNotice } from './credit-expiry.ts'

export interface SchedulerOptions {
  /** 每日执行时刻（本地时间，0-23），默认 10 点 */
  hour?: number
  /** 每日执行分钟（0-59），默认 5 分 */
  minute?: number
  /**
   * 依赖注入：取一个**当前有效**的 client；拿不到就本轮跳过。
   *
   * 允许返回 Promise 是故意的 —— 调用方需要先刷新 STS 才能拿到能用的
   * client，而 STS 只有 1 小时有效期，缓存 client 快照必然失效。
   */
  getClient: () => MadaoClient | null | Promise<MadaoClient | null>
  /** 日志回调 */
  log: (line: string) => void
}

export interface Scheduler {
  stop(): void
  /** 立刻跑一轮（给「立即签」按钮 / 启动补偿用） */
  runNow(): Promise<void>
  /** 下一次计划执行时间，供 UI 显示 */
  nextRunAt(): Date
  /** 最近一次到期预警；没查过或没有到期积分时为 null */
  lastExpiry(): ExpiryNotice | null
}

/** 算出下一次该跑的时刻。当前时间已过今天的点，就顺延到明天。 */
export function nextRunFrom(now: Date, hour: number, minute: number): Date {
  const next = new Date(now.getTime())
  next.setHours(hour, minute, 0, 0)
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1)
  return next
}

/**
 * 启动调度器。返回的 stop() 必须被调用（绑定到 ctx.effect 的清理函数）。
 *
 * 注意：用的是**墙钟对齐**而不是「每隔 24 小时」—— 后者会随着每次重启
 * 不断漂移，最后跑到半夜三点去签到。
 */
export function startCheckinScheduler(opts: SchedulerOptions): Scheduler {
  const hour = clamp(opts.hour ?? 10, 0, 23)
  const minute = clamp(opts.minute ?? 5, 0, 59)
  let timer: NodeJS.Timeout | undefined
  let stopped = false
  let lastExpiry: ExpiryNotice | null = null
  let nextAt = nextRunFrom(new Date(), hour, minute)

  const arm = () => {
    if (stopped) return
    nextAt = nextRunFrom(new Date(), hour, minute)
    const delay = Math.max(1000, nextAt.getTime() - Date.now())
    timer = setTimeout(() => {
      void tick()
    }, delay)
    // 不要因为定时器还挂着就让进程不退出
    timer.unref?.()
    opts.log(`checkin scheduler armed; next at ${nextAt.toISOString()} (local ${hour}:${String(minute).padStart(2, '0')})`)
  }

  const tick = async (skipRearm = false) => {
    if (stopped) return
    try {
      await runOnce()
    } catch (err) {
      opts.log(`checkin scheduler run failed: ${String((err as Error)?.message ?? err)}`)
    } finally {
      if (!skipRearm) arm()
    }
  }

  const runOnce = async () => {
    const client = await opts.getClient()
    if (!client) {
      opts.log('checkin scheduler skipped: no client (credentials not ready)')
      return
    }
    try {
      // 一次把所有可领的签到都扫一遍：码道的签到不止「每日 100 分」那一个，
      // 还有按活动上线的签到礼（实测见过每天 1000 分的，额度是前者十倍）。
      // 只盯 34 号那个的话，大头的天天漏。
      const r = await claimAllCheckins(client)
      if (r.claimed.length === 0) {
        const why = r.skipped.map((x) => `${x.campaignId}:${x.reason}`).join('; ')
        opts.log(`checkin scheduler: 无可领（${why || '列表为空'}）`)
        return
      }
      for (const c of r.claimed) {
        opts.log(`checkin scheduler: 已领取「${c.title}」${c.amount} 积分 (campaign=${c.campaignId})`)
      }
    } catch (err) {
      opts.log(`checkin scheduler claim failed: ${String((err as Error)?.message ?? err)}`)
    }
    // 顺带看一眼有没有积分要到期 —— 签到是「赚」的一侧，这个管「会丢」的一侧。
    // 放在同一个 tick 里是因为它俩本来就是一件事：今天该不该动账号。
    await reportExpiry(client)
  }

  const reportExpiry = async (client: MadaoClient) => {
    try {
      const credit = await queryCredit(client)
      if (!credit) return
      const notice = evaluateExpiry(credit)
      if (notice.level === 'none') return
      const tag = notice.level === 'urgent' ? 'URGENT' : notice.level === 'warn' ? 'WARN' : 'INFO'
      opts.log(`[expiry ${tag}] ${notice.message}`)
      lastExpiry = notice
    } catch (err) {
      opts.log(`expiry check failed: ${String((err as Error)?.message ?? err)}`)
    }
  }

  arm()

  // 启动补偿 —— 这是「自动签到」能不能真正生效的关键。
  //
  // 只靠 arm() 的话：用户 10:05 关机，10:30 开机，定时器要等到**明天**
  // 10:05 才动，今天这一轮就彻底错过了。所以启动时先立刻跑一轮：
  // 当天已签的话 runOnce 里的 status 检查会直接跳过（只发一个 GET），
  // 没签就顺手补上。代价极小，收益是「开机即补」。
  void tick(/* skipRearm */ true).catch(() => {})

  return {
    stop() {
      stopped = true
      if (timer) clearTimeout(timer)
      timer = undefined
      opts.log('checkin scheduler stopped')
    },
    async runNow() {
      await runOnce()
    },
    nextRunAt() {
      return nextAt
    },
    lastExpiry() {
      return lastExpiry
    },
  }
}

function clamp(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo
  return Math.min(hi, Math.max(lo, Math.trunc(v)))
}