/**
 * 自动签到。
 *
 * 码道签到是「一天一次、点按钮才领」的接口（`POST /v1/ops/claim`，campaignId=34）。
 * 本模块把它包成一个可选的定时任务，由界面上的「自动签到」开关控制。
 *
 * 三条设计约束，都是刻意的：
 *
 *   1. **默认关闭。** 签到会改变账号状态，不该由插件替用户决定。只有用户在
 *      面板里显式打开才运行。
 *   2. **节流。** 每分钟 tick 一次，但两次**真实请求之间至少间隔 15 分钟**。
 *      签到接口本身有频率限制，网络抖动时更不该连续打。
 *   3. **失败不放大。** 任何异常都吞掉并记录，绝不让调度器把宿主的桥接服务
 *      打挂；没有客户端（凭据没就绪）时安静跳过，等下一轮。
 *
 * 复用桥接服务那一份已登录的客户端（含 STS 续期），不另建一套 —— 否则
 * 两条链路会各自换 STS，撞上 IAM 的频率限制。
 *
 * @module dsh-connect-madao/auto-checkin
 */

import { claimCheckin } from './checkin.ts'
import { readSettings } from './settings.ts'
import { chatLog } from './protocol/log.ts'

/** tick 间隔：每分钟看一次「该不该跑」。 */
const TICK_MS = 60_000

/** 两次真实请求之间的最小间隔（15 分钟）。 */
const CLAIM_INTERVAL_MS = 15 * 60_000

/** 自动签到对外可见的运行状态（面板据此显示「上次：…」）。 */
export interface AutoCheckinState {
  enabled: boolean
  /** 上一次**尝试**领取的时间（epoch ms） */
  lastRunAt: number | null
  /** 上一次拿到结果的时间（epoch ms） */
  lastResultAt: number | null
  /** claimed = 领到了；already = 今天已领过；skip = 没条件跑；error = 出错 */
  lastResult: 'claimed' | 'already' | 'skip' | 'error' | null
  lastMessage: string | null
  lastAmount: number | null
  /** 累计运行轮数 */
  runs: number
  /** 累计成功领取次数 */
  claims: number
}

export function emptyAutoCheckinState(): AutoCheckinState {
  return {
    enabled: false,
    lastRunAt: null,
    lastResultAt: null,
    lastResult: null,
    lastMessage: null,
    lastAmount: null,
    runs: 0,
    claims: 0,
  }
}

/** 调度器需要的宿主能力：一个「拿到当前可用 client」的函数。 */
export interface AutoCheckinHost {
  /** 取当前可用客户端；拿不到返回 null（凭据未就绪）。 */
  getClient(): Promise<import('./client.ts').MadaoClient | null>
  /** 状态暴露给设置路由。 */
  state: AutoCheckinState
}

export interface AutoCheckinScheduler {
  /** 跑一轮（幂等，内部自带节流）。返回最新状态。 */
  tick(): Promise<AutoCheckinState>
  state(): AutoCheckinState
  /** 开始定时（重复调用无副作用）。 */
  start(): void
  /** 停止定时并标记已释放。 */
  dispose(): void
}

export function createAutoCheckinScheduler(host: AutoCheckinHost): AutoCheckinScheduler {
  let timer: ReturnType<typeof setInterval> | null = null
  let disposed = false
  let running = false
  let lastAttemptAt = 0
  /** 上一轮看到的开关值：用来识别「刚从关变开」，那种情况要立刻跑一次。 */
  let wasEnabled = false

  const state = (): AutoCheckinState => host.state

  async function tick(): Promise<AutoCheckinState> {
    if (disposed || running) return state()
    running = true
    try {
      const settings = await readSettings()
      const enabled = settings.autoCheckin === true
      host.state.enabled = enabled

      if (!enabled) {
        wasEnabled = false
        host.state.lastMessage = '自动签到已关闭'
        return state()
      }

      // 刚被打开：必须立刻跑一轮，不能让用户等到下一个 15 分钟窗口。
      const justEnabled = !wasEnabled
      wasEnabled = true
      const now = Date.now()
      if (!justEnabled && now - lastAttemptAt < CLAIM_INTERVAL_MS) return state()

      lastAttemptAt = now
      host.state.runs += 1

      const client = await host.getClient()
      if (client === null) {
        // 凭据还没就绪不是错误：桥接服务本身可能正在初始化。安静等下一轮。
        host.state.lastResult = 'skip'
        host.state.lastMessage = '桥接未就绪（凭据未加载），稍后再试'
        return state()
      }

      const r = await claimCheckin(client)
      host.state.lastRunAt = Date.now()
      host.state.lastResultAt = Date.now()

      if (r.available === false) {
        host.state.lastResult = 'skip'
        host.state.lastMessage = '福利列表里没有每日签到活动'
      } else if (r.claimed === true) {
        host.state.lastResult = 'claimed'
        host.state.lastAmount = typeof r.amount === 'number' ? r.amount : null
        host.state.lastMessage = `已自动签到，+${r.amount ?? 100} 积分`
        host.state.claims += 1
        chatLog(`auto-checkin OK amount=${r.amount ?? '-'}`)
      } else {
        // 今天已经领过（CLAIMED / CONFIRMED / CONSUMED）或当前不可领。
        host.state.lastResult = 'already'
        host.state.lastMessage = r.reason ?? '今日无需签到'
      }
    } catch (e) {
      host.state.lastRunAt = Date.now()
      host.state.lastResultAt = Date.now()
      host.state.lastResult = 'error'
      host.state.lastMessage = String((e as Error)?.message ?? e).slice(0, 200)
      chatLog(`auto-checkin ERROR ${host.state.lastMessage}`)
    } finally {
      running = false
    }
    return state()
  }

  return {
    tick,
    state,
    start() {
      if (timer !== null) return
      timer = setInterval(() => {
        void tick().catch(() => {})
      }, TICK_MS)
      // 不要为调度器把进程吊住：DSH 退出时它该跟着走。
      if (typeof timer.unref === 'function') timer.unref()
    },
    dispose() {
      disposed = true
      if (timer !== null) clearInterval(timer)
      timer = null
    },
  }
}
