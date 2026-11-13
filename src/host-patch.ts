/**
 * 自动生成 `cordis.patch.yml`。
 *
 * 为什么需要它：
 *   pi-ai 的 provider 配置要求 `models` 静态列出（空数组会直接报
 *   "resolves no models"），它不会去请求 `/v1/models` 自动发现。
 *   所以模型清单不可能"运行时动态"，只能"启动时拉取、写盘、下次启动生效"。
 *
 * 设计取舍：
 *   - 写的是**插件自带的 patch**（包内 cordis.patch.yml），不动用户 profile
 *   - 内容与上次一致时不重写，避免无意义抖动
 *   - 支持思考强度的模型才声明 reasoningEfforts，避免 DSH 给不支持的模型显示强度选择
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import type { ModelInfo } from './models.ts'

const BRIDGE_PORT = 8765

/** YAML 字符串转义（这里只会出现模型名、倍率这类简单文本）。 */
function q(s: string): string {
  return `'${String(s).replace(/'/g, "''")}'`
}

/**
 * 模型在选择器里显示的名字。
 *
 * DSH 的模型选择器自己负责：右侧上下文长度（198K / 1M）、
 * 思考等级的 ✦、以及**图片能力图标**（由 `input` 含 image 触发）。
 * 所以名字里只需要接上倍率，不要拼图标 —— 拼了会和 DSH 画的重复。
 */
function displayName(m: ModelInfo): string {
  return m.ratio ? `${m.name} · ${m.ratio}` : m.name
}

/**
 * 报给 DSH 的上下文窗口放大系数。
 *
 * DSH 的 pi-ai 在发请求前会自己估算上下文，超了 contextWindow 就直接抛
 * `CONTEXT_WINDOW_EXCEEDED`，请求根本不会发到桥接。
 *
 * 问题在于它的估算把 `tools` 的 JSON schema 按接近 1 token/字符来算，
 * 而那是英文+JSON 为主的内容，真实只有 1/3 左右。DSH 自带 377 个工具，
 * 光 tools 就被估成 20 多万 token —— 于是 202752 的 GLM-5.2 永远被判超限，
 * 但实测同一个请求（228 KB）打到码道网关是能正常返回的。
 *
 * 所以这里给 DSH 报一个放宽后的窗口：它按虚高的数字放行，
 * 而真正防超限的检查留在桥接里（用网关给的真实 contextWindow 判断）。
 */
const CONTEXT_DISPLAY_FACTOR = 2.5

function displayContextWindow(real: number): number {
  if (!Number.isFinite(real) || real <= 0) return real
  return Math.round(real * CONTEXT_DISPLAY_FACTOR)
}

function renderModel(m: ModelInfo): string {
  const lines: string[] = []
  lines.push(`          - id: ${q(m.id)}`)
  lines.push(`            name: ${q(displayName(m))}`)
  lines.push(`            contextWindow: ${displayContextWindow(m.context)}`)
  lines.push(`            maxTokens: ${m.maxOutput}`)
  // 声明 image 输入，让 DSH 自己把「支持图片」的标记画在它管理的右侧位置，
  // 而不是把 👁 拼进 name（那样位置会随名字长度浮动，还容易被截断）。
  //
  // 代价：DSH 会允许附图。但桥接的 flattenContent 只转发文本，
  // 所以 server 侧对带图片的请求会返回明确错误，而不是静默丢弃 ——
  // 见 assertTextOnly()。
  lines.push(`            input: [ ${m.supportsImages ? 'text, image' : 'text'} ]`)

  if (m.strengths.length > 0) {
    // 补齐 DSH 会显示的档位，避免「选中未声明档位 → 校验失败」
    const levels = Array.from(new Set(['low', ...m.strengths]))
    lines.push('            reasoningEfforts:')
    lines.push('              off: null')
    for (const lv of levels) lines.push(`              ${lv}: ${q(lv)}`)
  } else {
    lines.push('            reasoningEfforts: false')
  }
  return lines.join('\n')
}

/** 生成完整 patch 内容。 */
export function renderPatch(models: ModelInfo[]): string {
  const header = `# 由 dsh-connect-madao 自动生成，请勿手工编辑。
# 模型清单在插件启动时从码道网关拉取；上游上新或调价后重启 DSH 即自动同步。
# 想强制刷新：删除本文件后重启，或运行 \`dsh-connect-madao models --write\`。
- insert:
    - id: dsh-connect-madao
      name: dsh-connect-madao
- id: llm-pi-ai
  config:
    providers:
      madao:
        displayName: ${q('码道 CodeArts')}
        api: openai-completions
        baseURL: http://127.0.0.1:${BRIDGE_PORT}/v1
        headers:
          Authorization: ${q('Bearer bridge-local')}
        models:
`

  const body = models.map(renderModel).join('\n')
  return `${header}${body}\n`
}

export interface SyncResult {
  changed: boolean
  path: string
  models: number
  error?: string
}

/**
 * 把模型清单同步到 patch 文件。
 *
 * @param path   patch 文件绝对路径
 * @param models 最新清单
 */
export function syncPatch(path: string, models: ModelInfo[]): SyncResult {
  try {
    const next = renderPatch(models)
    const prev = existsSync(path) ? readFileSync(path, 'utf8') : ''
    if (prev === next) return { changed: false, path, models: models.length }
    writeFileSync(path, next, 'utf8')
    return { changed: true, path, models: models.length }
  } catch (e) {
    return { changed: false, path, models: models.length, error: String((e as Error)?.message ?? e) }
  }
}
