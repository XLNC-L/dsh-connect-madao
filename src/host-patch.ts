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
export function displayName(m: ModelInfo): string {
  return m.ratio ? `${m.name} · ${m.ratio}` : m.name
}

/**
 * 报给 DSH 的上下文窗口放大系数。
 *
 * DSH 的 pi-ai 在发请求前会自己估算上下文，超了 contextWindow 就直接抛
 * `CONTEXT_WINDOW_EXCEEDED`，请求根本不会发到桥接。
 *
 * 问题在于它的估算把 `tools` 的 JSON schema 按接近 1 token/字符来算，
 * 而那是英文+JSON 为主的内容，真实只有 1/3 左右。DSH 自带几百个工具，
 * 光 tools 就被估成十几二十万 token —— 于是 202752 的 GLM-5.2 被判超限，
 * 但实测同一个请求打到码道网关是能正常返回的。
 *
 * ── 系数为什么从 2.5 降到 1.6 ──────────────────────────────
 *
 * 2.5 太大了，副作用很实际：
 *   · 界面显示 GLM-5.2 是 495K，用户以为能装下 330K 的会话
 *   · 实际网关只接受 196608，于是撞上
 *     `81001.400 Prompt length exceeds 196608`
 *   · DSH 的自动压缩也按这个大窗口算，压不到真正需要的程度，
 *     于是「压缩失败」
 *
 * 1.6 足够抵消 tools 的虚高（实测偏差 1.15–2.0×，取中位），
 * 又不会把显示值吹到离谱。真正防超限的检查留在桥接里（用网关的
 * 真实 context_window − 4096 判断），不依赖这个显示值。
 */
const CONTEXT_DISPLAY_FACTOR = 1.0

function displayContextWindow(real: number): number {
  if (!Number.isFinite(real) || real <= 0) return real
  // 至少保留真实值，绝不低于它 —— 否则 DSH 会把能跑的请求也拦掉
  return Math.max(real, Math.round(real * CONTEXT_DISPLAY_FACTOR))
}

/**
 * pi-ai provider 里一条模型配置的运行时对象形态。
 *
 * 与 YAML patch 里的字段一一对应。设置页保存模型选择时，直接把这份对象
 * 交给 config-editor 写进 profile，因此它必须和 renderModel 生成的 YAML
 * 完全同源 —— 两边分别手写字段，迟早会漂移。
 */
export interface ProviderModelConfig {
  id: string
  name: string
  contextWindow: number
  maxTokens: number
  input: string[]
  reasoningEfforts: false | Record<string, string | null>
}

/** 由 ModelInfo 生成 pi-ai provider 需要的模型配置（含展示名、图片、思考档位）。 */
export function buildProviderModel(m: ModelInfo): ProviderModelConfig {
  const config: ProviderModelConfig = {
    id: m.id,
    name: displayName(m),
    contextWindow: displayContextWindow(m.context),
    maxTokens: m.maxOutput,
    // 声明 image 输入，让 DSH 自己把「支持图片」的标记画在它管理的右侧位置，
    // 而不是把 👁 拼进 name（那样位置会随名字长度浮动，还容易被截断）。
    //
    // 代价：DSH 会允许附图。但桥接的 flattenContent 只转发文本，
    // 所以 server 侧对带图片的请求会返回明确错误，而不是静默丢弃 ——
    // 见 assertTextOnly()。
    input: m.supportsImages ? ['text', 'image'] : ['text'],
    reasoningEfforts: false,
  }
  if (m.strengths.length > 0) {
    // 补齐 DSH 会显示的档位，避免「选中未声明档位 → 校验失败」
    const levels = Array.from(new Set(['low', ...m.strengths]))
    config.reasoningEfforts = Object.fromEntries([['off', null], ...levels.map((lv) => [lv, lv])])
  }
  return config
}

function renderModel(m: ModelInfo): string {
  const config = buildProviderModel(m)
  const lines: string[] = []
  lines.push(`          - id: ${q(config.id)}`)
  lines.push(`            name: ${q(config.name)}`)
  lines.push(`            contextWindow: ${config.contextWindow}`)
  lines.push(`            maxTokens: ${config.maxTokens}`)
  lines.push(`            input: [ ${config.input.join(', ')} ]`)

  if (config.reasoningEfforts === false) {
    lines.push('            reasoningEfforts: false')
  } else {
    lines.push('            reasoningEfforts:')
    for (const [level, value] of Object.entries(config.reasoningEfforts)) {
      lines.push(`              ${level}: ${value === null ? 'null' : q(String(value))}`)
    }
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

    // 内容不同就重写。这里**不能**做"看起来差不多就跳过"的优化：
    // npm 包自带一份构建时的 cordis.patch.yml，每次 `pnpm add` 安装
    // 新版本都会用它覆盖运行时生成的那份。如果那份模板过期（比如上游
    // 新增了思考档位），就会退化成"模型没有档位"，DSH 报
    // UNSUPPORTED_REASONING_EFFORT。
    writeFileSync(path, next, 'utf8')
    return { changed: true, path, models: models.length }
  } catch (e) {
    return { changed: false, path, models: models.length, error: String((e as Error)?.message ?? e) }
  }
}

