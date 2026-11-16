/**
 * 自动签到调度器。
 *
 * 为什么要它：签到是**一天一次**的收益，而人最容易漏的正是「每天都得记得点」。
 * 之前只有设置页里一个按钮，忘了点当天那 100 积分就是白丢。
 *
 * 设计上刻意克制：
 *   - 默认**开启**（签到是纯收益且幂等）；想关的配 autoCheckin: false
 *   - 每天成功一次就停；启动时若已过设定时刻也会补跑一次
 *   - 当天已领过就什么都不做（claimable 判断 + 上游幂等，重复调用无副作用）
 *   - 失败当天最多试几次就收手，不每分钟轰炸上游
 *   - 跟 ctx.effect 绑定，插件卸载时定时器一起停
 */

import { claimAllCheckins, queryCredit } from './server.ts'
import type { MadaoClient } from './client.ts'
import { evaluateExpiry, type ExpiryNotice } from './credit-expiry.ts'

/**
 * 一天最多尝试几次。
 *
 * 没有上限的话，凭证一直没配好或上游一直报错时，每分钟一次的轮询会变成
 * 一天几百上千次请求 —— 既刷日志也打扰上游。3 次之后再等明天，用户修好
 * 凭证重启插件时会重新开始计数。
 */
export const MAX_ATTEMPTS_PER_DAY = 3

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
  /** 正在跑的时候再触发就直接跳过，避免两次检查叠在一起 */
  let running = false
  /** 本机上一次「确认过」的日期（YYYY-MM-DD），只在内存里，不落盘 */
  let lastHandledDate = ''
  /** 今天已经尝试过几次（成功了就不再涨） */
  let attemptsToday = 0
  /** 今天已经确认过的那一天，用来在跨天时把 attemptsToday 归零 */
  let attemptsDate = ''

  const todayKey = (d = new Date()) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

  /**
   * 每分钟看一眼，而不是「定一个 24 小时后的闹钟」。
   *
   * 为什么这么改：定点 setTimeout 遇到电脑合盖睡眠 / 系统改时间 / 跨天，
   * 触发时机就不可靠了 —— 合盖睡一夜第二天掀开盖子，进程没重启，
   * 那个闹钟可能已经过期也可能还要再等一天。改成每分钟轮询后，
   * 无论是睡眠醒来、跨天、还是手动改时间，最多 60 秒内自己就纠正过来了。
   * 一分钟醒一次的开销可以忽略（不联网、只比两个数字）。
   */
  const tick = async () => {
    if (stopped || running) return
    const now = new Date()
    const key = todayKey(now)
    if (key === lastHandledDate) return          // 今天已经处理过
    const due = now.getHours() * 60 + now.getMinutes() >= hour * 60 + minute
    if (!due) return                             // 还没到点
    // 跨天把重试计数归零
    if (attemptsDate !== key) {
      attemptsDate = key
      attemptsToday = 0
    }
    // 今天的重试次数用完了就收手，别每分钟往上游发一次请求
    if (attemptsToday >= MAX_ATTEMPTS_PER_DAY) return

    running = true
    try {
      attemptsToday += 1
      // 只有「今天确实不需要再试了」才记下来。凭证没就绪、网络失败这类
      // 都不记，留给下一次重试 —— 否则一次网络抖动就把整天跳过了。
      // 但重试有上限（MAX_ATTEMPTS_PER_DAY），不会无限打。
      if (await runOnce()) lastHandledDate = key
    } catch (err) {
      opts.log(`checkin scheduler run failed: ${String((err as Error)?.message ?? err)}`)
    } finally {
      running = false
    }
  }

  /** 返回 true 表示「今天不用再试了」；false 表示稍后还该重试 */
  const runOnce = async (): Promise<boolean> => {
    const client = await opts.getClient()
    if (!client) {
      opts.log('checkin scheduler skipped: no client (credentials not ready)')
      return false
    }
    let settled = true
    try {
      const r = await claimAllCheckins(client)
      if (r.claimed.length === 0) {
        const why = r.skipped.map((x) => `${x.campaignId}:${x.reason}`).join('; ')
        opts.log(`checkin scheduler: 无可领（${why || '列表为空'}）`)
      } else {
        for (const c of r.claimed) {
          opts.log(`checkin scheduler: 已领取「${c.title}」${c.amount} 积分 (campaign=${c.campaignId})`)
        }
      }
      // 有渠道报出了「稍后再试」类原因（比如明明 claimable 却领取失败），
      // 说明今天还没利索，下一分钟再瞅一眼。
      settled = !r.skipped.some((x) => /失败|异常|繁忙|稍后|重试|error|fail|timeout|超时/i.test(x.reason))
    } catch (err) {
      opts.log(`checkin scheduler claim failed: ${String((err as Error)?.message ?? err)}`)
      settled = false
    }
    await reportExpiry(client)
    return settled
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

  // 启动就检查一次：解决「10:05 关机、10:30 才开机」的情况
  void tick().catch(() => {})

  // 之后每分钟再瞄一眼（睡眠醒来 / 跨天都能自愈）
  timer = setInterval(() => void tick().catch(() => {}), 60_000)
  timer.unref?.()
  opts.log(`checkin scheduler started; will run daily after local ${hour}:${String(minute).padStart(2, '0')}`)

  return {
    stop() {
      stopped = true
      if (timer) clearInterval(timer)
      timer = undefined
      opts.log('checkin scheduler stopped')
    },
    async runNow() {
      // 跟定时器走同一套保护：正在跑就跳过，跑完也记下当天已完成。
      // 否则整点手动点「立即签到」会和定时器撞在一起，白打两次请求。
      if (stopped || running) return
      running = true
      try {
        if (await runOnce()) lastHandledDate = todayKey()
      } finally {
        running = false
      }
    },
    nextRunAt() {
      return nextRunFrom(new Date(), hour, minute)
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