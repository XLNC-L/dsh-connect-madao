import { test } from 'node:test'
import assert from 'node:assert/strict'

import { evaluateExpiry, parseDate, formatAmount, WARN_DAYS, URGENT_DAYS } from '../src/credit-expiry.ts'
import { pickExpiring } from '../src/server.ts'

const NOW = new Date(2026, 10, 16, 12, 0, 0) // 2026-11-16 12:00 本地

function credit(patch: Record<string, unknown> = {}) {
  return {
    total: 10600,
    used: 900,
    remain: 9700,
    expiringAmount: 0,
    ...patch,
  } as any
}

test('没有到期积分时不出提醒', () => {
  const n = evaluateExpiry(credit({ expiringAmount: 0 }), NOW)
  assert.equal(n.level, 'none')
  assert.equal(n.message, '')
})

test('credit 为 null 时不抛错', () => {
  const n = evaluateExpiry(null, NOW)
  assert.equal(n.level, 'none')
})

test('到期日很远时只给 info', () => {
  const n = evaluateExpiry(credit({ expiringAmount: 5000, packageEnd: '2026-12-30' }), NOW)
  assert.equal(n.level, 'info')
  assert.match(n.message, /5,000 积分/)
  assert.match(n.message, /2026-12-30/)
})

test('7 天内升到 warn', () => {
  // 11-16 → 11-21 = 5 天
  const n = evaluateExpiry(credit({ expiringAmount: 3000, packageEnd: '2026-11-21' }), NOW)
  assert.equal(n.level, 'warn')
  assert.equal(n.daysLeft, 5)
})

test('2 天内升到 urgent', () => {
  const n = evaluateExpiry(credit({ expiringAmount: 6663.29, packageEnd: '2026-11-17' }), NOW)
  assert.equal(n.level, 'urgent')
  assert.equal(n.daysLeft, 1)
  assert.match(n.message, /6,663/)
})

test('当天到期也算 urgent', () => {
  const n = evaluateExpiry(credit({ expiringAmount: 100, packageEnd: '2026-11-16' }), NOW)
  assert.equal(n.level, 'urgent')
  assert.equal(n.daysLeft, 0)
})

test('已经过期不崩，显示已到期', () => {
  const n = evaluateExpiry(credit({ expiringAmount: 100, packageEnd: '2026-11-10' }), NOW)
  assert.equal(n.level, 'urgent')
  assert.ok(n.daysLeft != null && n.daysLeft < 0)
  assert.match(n.message, /已到期/)
})

test('有到期量但没日期时仍提醒（降级为 info）', () => {
  const n = evaluateExpiry(credit({ expiringAmount: 800, packageEnd: undefined }), NOW)
  assert.equal(n.level, 'info')
  assert.equal(n.daysLeft, null)
  assert.match(n.message, /800 积分/)
  assert.match(n.message, /即将到期/)
})

test('expiringAmount 是脏数据时不炸', () => {
  for (const bad of [NaN, Infinity, -1, 'x' as any]) {
    const n = evaluateExpiry(credit({ expiringAmount: bad }), NOW)
    assert.equal(n.level, 'none', `bad=${String(bad)}`)
  }
})

test('parseDate 认 YYYY-MM-DD，也容忍后面带时间', () => {
  assert.ok(parseDate('2026-11-17'))
  // 上游现在给纯日期，但哪天改成 ISO 串也不能瞎
  assert.ok(parseDate('2026-11-17T00:00:00Z'))
  assert.ok(parseDate('2026-11-17 23:59:59'))
  assert.equal(parseDate('2026/11/17'), null)
  assert.equal(parseDate('17-11-2026'), null)
  assert.equal(parseDate(''), null)
  assert.equal(parseDate(undefined), null)
})

test('parseDate 拒绝不合法的月份/日期（不让 JS 悄悄进位）', () => {
  // 13 月会被 JS 进位成次年 1 月，算出来的天数就是错的
  assert.equal(parseDate('2026-13-01'), null)
  assert.equal(parseDate('2026-00-10'), null)
  assert.equal(parseDate('2026-11-32'), null)
  assert.equal(parseDate('2026-11-00'), null)
})

test('formatAmount 取整并加千分位', () => {
  assert.equal(formatAmount(6663.29), '6,663')
  assert.equal(formatAmount(999), '999')
  assert.equal(formatAmount(0), '0')
})

test('阈值常量是 7 / 2', () => {
  assert.equal(WARN_DAYS, 7)
  assert.equal(URGENT_DAYS, 2)
})

test('pickExpiring 优先取汇总指标', () => {
  const list = [
    { name: 'usageBonusPackageCredit', package_credit_expiring_amount: 6163.29 },
    { name: 'usageTotalPackageCredit', package_credit_expiring_amount: 6663.29 },
  ]
  assert.equal(pickExpiring(list), 6663.29)
})

test('pickExpiring 汇总缺失时退回 bonus', () => {
  const list = [{ name: 'usageBonusPackageCredit', package_credit_expiring_amount: 6163.29 }]
  assert.equal(pickExpiring(list), 6163.29)
})

test('pickExpiring 没有该字段时返回 0 而不是 undefined', () => {
  const list = [{ name: 'usageTotalPackageCredit', package_credit_remain: 100 }]
  assert.equal(pickExpiring(list), 0)
})

test('pickExpiring 空列表返回 0', () => {
  assert.equal(pickExpiring([]), 0)
})
test('不足 1 分的残余小数不提醒（避免"0 积分要到期"）', () => {
  const n = evaluateExpiry(credit({ expiringAmount: 0.2, packageEnd: '2026-11-17' }), NOW)
  assert.equal(n.level, 'none')
})

test('0.6 分会被四舍五入成 1，仍然提醒', () => {
  const n = evaluateExpiry(credit({ expiringAmount: 0.6, packageEnd: '2026-11-17' }), NOW)
  assert.equal(n.level, 'urgent')
})
