import { test } from 'node:test'
import assert from 'node:assert/strict'

import { isCheckinCampaign } from '../src/server.ts'

// 真实报文取自 2026-11-17 本机实测
const REAL = [
  { campaignId: 34, title: '每日签到领100积分', type: 'USER_LOGIN', extra: { triggerEvent: 'user.login', triggerMode: 'MANUAL_CLAIM' } },
  { campaignId: 40, title: 'Skill创新赛每日签到礼', type: 'USER_LOGIN', extra: { triggerEvent: 'user.login', triggerMode: 'MANUAL_CLAIM' } },
  { campaignId: 42, title: 'Skill创新赛报名礼', type: 'USER_LOGIN', extra: { triggerEvent: 'user.login', triggerMode: 'MANUAL_CLAIM' } },
  { campaignId: 4, title: '新用户注册送 4000 积分', type: 'NEW_USER_REGISTER', extra: { triggerEvent: 'user.register', triggerMode: 'AUTO_GRANT' } },
  { campaignId: 2, title: '学生认证领积分', type: 'STUDENT_CERTIFIED', extra: { triggerEvent: 'student.certified', triggerMode: 'MANUAL_CLAIM' } },
]

test('每日签到（34）会被放行', () => {
  assert.equal(isCheckinCampaign(REAL[0]), true)
})

test('创新赛签到（40，1000分）会被放行', () => {
  assert.equal(isCheckinCampaign(REAL[1]), true)
})

test('新用户注册礼不会被放行', () => {
  assert.equal(isCheckinCampaign(REAL[3]), false)
})

test('学生认证不会被放行', () => {
  assert.equal(isCheckinCampaign(REAL[4]), false)
})

test('邀请有礼不会被放行', () => {
  assert.equal(
    isCheckinCampaign({ title: '推荐有礼', type: 'INVITE_USER', extra: { triggerEvent: 'invite.success' } }),
    false,
  )
})

test('type 缺失时靠 triggerEvent 兜底', () => {
  assert.equal(isCheckinCampaign({ title: '某活动', extra: { triggerEvent: 'user.login' } }), true)
})

test('type 和 event 都缺失时靠标题兜底', () => {
  assert.equal(isCheckinCampaign({ title: '五一每日签到' }), true)
  assert.equal(isCheckinCampaign({ title: '五一报名有礼' }), false)
})

test('标题带签到但也带报名时不放行（防"签到报名礼"这类混合活动）', () => {
  assert.equal(isCheckinCampaign({ title: '签到报名礼' }), false)
})

test('标题带签到但带认证时不放行', () => {
  assert.equal(isCheckinCampaign({ title: '签到认证礼' }), false)
})

test('完全空的条目不放行', () => {
  assert.equal(isCheckinCampaign({}), false)
  assert.equal(isCheckinCampaign(null), false)
})

test('type 大小写不敏感', () => {
  assert.equal(isCheckinCampaign({ type: 'user_login' }), true)
})
