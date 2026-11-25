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
}

export const DEFAULT_SETTINGS: Readonly<MadaoSettings> = Object.freeze({
  schemaVersion: 1,
  composerChip: true,
  autoCheckin: false,
})

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
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_SETTINGS }
  const record = raw as Record<string, unknown>
  return {
    schemaVersion: 1,
    composerChip:
      typeof record.composerChip === 'boolean' ? record.composerChip : DEFAULT_SETTINGS.composerChip,
    autoCheckin:
      typeof record.autoCheckin === 'boolean' ? record.autoCheckin : DEFAULT_SETTINGS.autoCheckin,
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
    return { ...DEFAULT_SETTINGS }
  }
  try {
    return normalizeSettings(JSON.parse(text))
  } catch {
    return { ...DEFAULT_SETTINGS }
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
  patch: Partial<Pick<MadaoSettings, 'composerChip' | 'autoCheckin'>>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<MadaoSettings> {
  const current = await readSettings(env)
  const next = normalizeSettings({ ...current, ...patch })
  await writeSettings(next, env)
  chatLog(`settings updated: composerChip=${next.composerChip} autoCheckin=${next.autoCheckin}`)
  return next
}
