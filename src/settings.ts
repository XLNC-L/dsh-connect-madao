/**
 * 插件自己的界面设置（不是 DSH 的插件 config）。
 *
 * 为什么单独落一份 JSON，而不是写进 `cordis.patch.yml` 的 config：
 *
 *   - 这两个开关要求「点一下立刻生效」。写 config 意味着每次改变都要
 *     「改配置 → 重载插件」，而那会把桥接服务和在途请求一起掀掉。
 *   - `cordis.patch.yml` 属于用户和 profile，里面还有别的插件的行、注释和
 *     `!!js` 表达式；本插件不该为了一个显示开关去读写它。
 *
 * 位置：`$DSH_HOME/dsh-connect-madao-state.json`（`DSH_HOME` 未设时为 `~/.dsh`）。
 * 写盘走「临时文件 + rename」，权限 0o600 —— 读到半个 JSON 会让人以为设置丢了。
 *
 * 默认值都保持「不改变现状」：胶囊照常显示、自动签到关闭。升级后老用户
 * 界面与行为都不变，自动签到必须显式打开。
 *
 * @module dsh-connect-madao/settings
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { chatLog } from './protocol/log.ts'

/** 设置文件名（放在 `$DSH_HOME` 根下，与其它插件约定一致）。 */
const SETTINGS_FILENAME = 'dsh-connect-madao-state.json'

export interface MadaoSettings {
  schemaVersion: 1
  /** 输入框右侧的「码道」状态胶囊是否显示。 */
  composerChip: boolean
  /** 自动签到是否开启。 */
  autoCheckin: boolean
  /**
   * 不在 DSH 模型选择器里显示的模型 id。
   *
   * 存「排除项」而不是「启用项」：上游新增模型时默认可见，用户不必
   * 每次上新都回来点一遍。空数组 = 全部显示。
   */
  hiddenModels: string[]
  /**
   * 每个模型在 DSH 里展示的上下文上限（token）。
   *
   * 只能往小里改：网关的真实 context_window 是硬上限，桥接自己也会按它
   * 拦截请求，所以这里调大没有意义、还会让 DSH 少压缩一次。缺省 = 网关值。
   */
  contextCaps: Record<string, number>
}

function defaults(): MadaoSettings {
  return { schemaVersion: 1, composerChip: true, autoCheckin: false, hiddenModels: [], contextCaps: {} }
}

export const DEFAULT_SETTINGS: Readonly<MadaoSettings> = Object.freeze(defaults())

/** 归一化上下文上限表：只保留正整数，键必须是非空字符串。 */
function normalizeCaps(raw: unknown): Record<string, number> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {}
  const out: Record<string, number> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (key.length === 0) continue
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) continue
    out[key] = Math.round(value)
  }
  return out
}

/**
 * 设置文件路径。
 *
 * @param env 环境变量（测试注入用）
 */
export function settingsPath(env: NodeJS.ProcessEnv = process.env): string {
  const home =
    typeof env.DSH_HOME === 'string' && env.DSH_HOME.length > 0 ? env.DSH_HOME : join(homedir(), '.dsh')
  return join(home, SETTINGS_FILENAME)
}

/**
 * 归一化任意读到的值。
 *
 * 逐字段回落而不是整份丢弃：一份里 `composerChip` 被写坏，不该顺带把用户的
 * `autoCheckin` 也清掉。
 */
export function normalizeSettings(raw: unknown): MadaoSettings {
  if (typeof raw !== 'object' || raw === null) return defaults()
  const record = raw as Record<string, unknown>
  const hiddenModels = Array.isArray(record.hiddenModels)
    ? Array.from(
        new Set(
          record.hiddenModels.filter(
            (value): value is string => typeof value === 'string' && value.length > 0,
          ),
        ),
      )
    : []
  return {
    schemaVersion: 1,
    composerChip:
      typeof record.composerChip === 'boolean' ? record.composerChip : DEFAULT_SETTINGS.composerChip,
    autoCheckin:
      typeof record.autoCheckin === 'boolean' ? record.autoCheckin : DEFAULT_SETTINGS.autoCheckin,
    hiddenModels,
    contextCaps: normalizeCaps(record.contextCaps),
  }
}

/**
 * 读设置。文件不存在、坏 JSON、字段非法都回落到默认值（永不抛）。
 */
export async function readSettings(env: NodeJS.ProcessEnv = process.env): Promise<MadaoSettings> {
  let text: string
  try {
    text = await readFile(settingsPath(env), 'utf8')
  } catch {
    return defaults()
  }
  try {
    return normalizeSettings(JSON.parse(text))
  } catch {
    return defaults()
  }
}

/** 整份写盘（临时文件 + rename）。 */
export async function writeSettings(
  next: MadaoSettings,
  env: NodeJS.ProcessEnv = process.env,
): Promise<MadaoSettings> {
  const target = settingsPath(env)
  // `join(target, '..')` 而不是 `dirname(target)`：与其它模块的写法保持一致。
  await mkdir(join(target, '..'), { recursive: true })
  const tmp = `${target}.${process.pid}.tmp`
  await writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  await rename(tmp, target)
  return next
}

/**
 * 局部更新：只改传入的字段，其余保持原值。
 *
 * 这是面板和设置路由唯一的写入口 —— 一次只翻转一个开关，不必把整份设置
 * 回传给服务端，也就不会出现「前端传了旧值把另一项覆盖掉」。
 */
export async function patchSettings(
  patch: Partial<Pick<MadaoSettings, 'composerChip' | 'autoCheckin' | 'hiddenModels' | 'contextCaps'>>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<MadaoSettings> {
  const current = await readSettings(env)
  const next = normalizeSettings({ ...current, ...patch })
  await writeSettings(next, env)
  chatLog(
    `settings updated: composerChip=${next.composerChip} autoCheckin=${next.autoCheckin} ` +
      `hiddenModels=${next.hiddenModels.length} contextCaps=${Object.keys(next.contextCaps).length}`,
  )
  return next
}
