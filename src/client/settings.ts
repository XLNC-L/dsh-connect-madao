/**
 * 客户端侧的设置 store。
 *
 * 面板和输入框胶囊都要读同一份设置（胶囊要据此决定显不显示），但它们是
 * 两个独立的 slot 组件，没有共同父组件。所以这里放一个极小的
 * 「发布-订阅」store：
 *
 *   - 谁先读到数据，就 `applySettingsPayload` 广播一次，另一个立刻跟上；
 *   - `localStorage` 只做**首屏缓存**，让胶糖在第一次 /settings 回来之前
 *     不会闪一下（例如用户关了胶囊，刷新页面时不该先闪出一个再消失）。
 *
 * 权威数据永远在宿主侧（`$DSH_HOME/dsh-connect-madao-state.json`），
 * localStorage 只是镜像；两者不一致时以桥接 `/settings` 为准。
 *
 * @module dsh-connect-madao/client/settings
 */

import { bridgeJson, bridgePost } from './bridge.ts'

/** 胶囊显隐的本地缓存键 */
const CHIP_CACHE_KEY = 'dsh-connect-madao:composerChip'
/** 自动签到的本地缓存键（仅用于首屏，避免开关先闪成关） */
const AUTO_CACHE_KEY = 'dsh-connect-madao:autoCheckin'

export interface SettingsPayload {
  composerChip: boolean
  autoCheckin: boolean
  /** 不在 DSH 模型选择器里显示的模型 id。 */
  hiddenModels: string[]
  /** 每个模型在 DSH 里展示的上下文上限；缺省用网关值。 */
  contextCaps: Record<string, number>
}

/** 宿主是否把模型选择真正应用到了 llm-pi-ai 配置。 */
export type ModelApplyMode = 'live' | 'unavailable' | 'failed' | null

/** 宿主返回的自动签到运行状态（与 src/auto-checkin.ts 的 AutoCheckinState 对应）。 */
export interface AutoCheckinState {
  enabled: boolean
  lastRunAt: number | null
  lastResultAt: number | null
  lastResult: 'claimed' | 'already' | 'skip' | 'error' | null
  lastMessage: string | null
  lastAmount: number | null
  runs: number
  claims: number
}

interface SettingsResponse {
  ok?: boolean
  settings?: Partial<SettingsPayload>
  autoCheckin?: AutoCheckinState | null
  modelApply?: ModelApplyMode
  modelApplyError?: string
}

function readCachedBool(key: string): boolean | null {
  try {
    const raw = window.localStorage.getItem(key)
    if (raw === '0') return false
    if (raw === '1') return true
  } catch {}
  return null
}

function writeCachedBool(key: string, value: boolean): void {
  try {
    window.localStorage.setItem(key, value ? '1' : '0')
  } catch {}
}

let current: SettingsPayload = {
  composerChip: readCachedBool(CHIP_CACHE_KEY) ?? true,
  autoCheckin: readCachedBool(AUTO_CACHE_KEY) ?? false,
  hiddenModels: [],
  contextCaps: {},
}

/** 最近一次拿到的自动签到运行状态（可能为 null：还没问过宿主）。 */
let autoState: AutoCheckinState | null = null

const listeners = new Set<(next: SettingsPayload) => void>()

export function getSettings(): SettingsPayload {
  return current
}

export function getAutoCheckinState(): AutoCheckinState | null {
  return autoState
}

export function subscribeSettings(listener: (next: SettingsPayload) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function emit(next: SettingsPayload): void {
  current = next
  writeCachedBool(CHIP_CACHE_KEY, next.composerChip)
  writeCachedBool(AUTO_CACHE_KEY, next.autoCheckin)
  for (const listener of [...listeners]) {
    try {
      listener(next)
    } catch {}
  }
}

/**
 * 把宿主的一份 `/settings` 响应并入 store。
 *
 * 只覆盖响应里**明确给出**的字段：某个字段缺失时保留原值，这样旧版宿主
 * （没有 autoCheckin）也不会把用户已开的自动签到读成关闭。
 */
function applyPayload(payload: SettingsResponse | null | undefined): void {
  if (!payload) return
  const next: SettingsPayload = { ...current }
  const settings = payload.settings
  if (settings) {
    if (typeof settings.composerChip === 'boolean') next.composerChip = settings.composerChip
    if (typeof settings.autoCheckin === 'boolean') next.autoCheckin = settings.autoCheckin
    if (Array.isArray(settings.hiddenModels)) {
      next.hiddenModels = settings.hiddenModels.filter(
        (value): value is string => typeof value === 'string' && value.length > 0,
      )
    }
    if (typeof settings.contextCaps === 'object' && settings.contextCaps !== null) {
      const caps: Record<string, number> = {}
      for (const [key, value] of Object.entries(settings.contextCaps)) {
        if (typeof value === 'number' && Number.isFinite(value) && value > 0) caps[key] = value
      }
      next.contextCaps = caps
    }
  }
  if (payload.autoCheckin && typeof payload.autoCheckin === 'object') {
    autoState = payload.autoCheckin
  }
  emit(next)
}

/** 从宿主读一次设置（失败时保留当前值，不抛）。 */
export async function loadSettings(): Promise<SettingsPayload> {
  try {
    applyPayload(await bridgeJson<SettingsResponse>('/settings', 8_000))
  } catch {}
  return current
}

/**
 * 保存一项或几项设置。
 *
 * 宿主回包里带着最新的运行状态，所以调用方不需要再单独问一次。
 */
export async function saveSettings(patch: Partial<SettingsPayload>): Promise<SettingsSaveResult> {
  const response = await bridgePost<SettingsResponse>('/settings', patch, 30_000)
  applyPayload(response)
  return {
    settings: current,
    modelApply: response.modelApply ?? null,
    modelApplyError: response.modelApplyError,
  }
}

export interface SettingsSaveResult {
  settings: SettingsPayload
  modelApply: ModelApplyMode
  modelApplyError?: string
}
