/**
 * 积分到期预警。
 *
 * 为什么单独一个文件：这是**纯计算**，不碰网络也不碰 UI，
 * 可以单独测；而且以后如果上游又加新字段，改这一个文件就够。
 *
 * 背景：码道的体验版 / 活动赠送积分是**按批次到期**的，
 * 过期直接清零。上游在额度接口里给了 `package_credit_expiring_amount`
 * （即将到期的数量）和 `end_date`（套餐周期结束日），但之前插件
 * 一个都没读 —— 用户只能等某天突然发现余额少了一大截。
 */

import type { CreditInfo } from './server.ts'

/** 预警等级。none 表示没什么可提醒的。 */
export type ExpiryLevel = 'none' | 'info' | 'warn' | 'urgent'

export interface ExpiryNotice {
  level: ExpiryLevel
  /** 一句话给用户看 */
  message: string
  /** 即将到期的积分数 */
  expiringAmount: number
  /** 距到期的天数；无法确定时为 null */
  daysLeft: number | null
  /** 到期日（YYYY-MM-DD），无法确定时为 null */
  dueDate: string | null
}

/** 提前几天开始提醒。三档提高紧迫度。 */
export const WARN_DAYS = 7
export const URGENT_DAYS = 2

/**
 * 从 CreditInfo 算出一条提醒。没有可到期积分就返回 level='none'。
 *
 * 说明：上游只给了「多少积分要到期」和一个**套餐周期**结束日，
 * 没给「每一批积分各自哪一天到期」。所以这里用 end_date 作为
 * 最接近的到期参照 —— 宁可提醒得保守一点，也不要报一个错的精确日期。
 */
export function evaluateExpiry(credit: CreditInfo | null, now: Date = new Date()): ExpiryNotice {
  if (!credit) return { level: 'none', message: '', expiringAmount: 0, daysLeft: null, dueDate: null }

  const expiring = Number(credit.expiringAmount ?? 0)
  // 不足 1 分的残余小数（比如 0.2）四舍五入后是 0，提醒「0 积分要到期」
  // 只会让用户困惑，直接忽略。
  if (!Number.isFinite(expiring) || Math.round(expiring) <= 0) {
    return { level: 'none', message: '', expiringAmount: 0, daysLeft: null, dueDate: null }
  }

  const due = parseDate(credit.packageEnd)
  // 用 round 而不是 ceil：夏令时切换那天一昼夜只有 23 小时，ceil 会多算一天
  const daysLeft = due ? Math.round((due.getTime() - startOfDay(now).getTime()) / 86400000) : null

  let level: ExpiryLevel = 'info'
  if (daysLeft != null) {
    if (daysLeft <= URGENT_DAYS) level = 'urgent'
    else if (daysLeft <= WARN_DAYS) level = 'warn'
  } else {
    // 没日期但有到期量 —— 至少提醒一次，别静默
    level = 'info'
  }

  const amount = formatAmount(expiring)
  const when =
    daysLeft == null
      ? '即将到期'
      : daysLeft <= 0
        ? '已到期'
        : `还有 ${daysLeft} 天到期（${credit.packageEnd}）`

  return {
    level,
    expiringAmount: expiring,
    daysLeft,
    dueDate: credit.packageEnd ?? null,
    message: `${amount} 积分${when}，过期即清零`,
  }
}

function startOfDay(d: Date): Date {
  const x = new Date(d.getTime())
  x.setHours(0, 0, 0, 0)
  return x
}

/** 解析 YYYY-MM-DD 为本地时间当天 0 点；格式不对返回 null。 */
export function parseDate(s: string | undefined | null): Date | null {
  if (!s) return null
  // 只取开头的 YYYY-MM-DD，后面跟时间或者时区后缀都容忍
  // （上游现在给纯日期，但哪天改成 ISO 时间串也不能瞎）。
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/.exec(String(s).trim())
  if (!m) return null
  const month = Number(m[2])
  const day = Number(m[3])
  // 月份 13、日期 32 这种不合法值，JS 会悄悄进位到别的日子，算出来的
  // 天数就是错的。直接当解析失败。
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const d = new Date(Number(m[1]), month - 1, day)
  return Number.isNaN(d.getTime()) ? null : d
}

/** 6663.29 → "6,663"；小数部分是上游的记账误差，别拿来吓人。 */
export function formatAmount(n: number): string {
  return Math.round(n).toLocaleString('zh-CN')
}