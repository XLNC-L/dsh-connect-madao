/**
 * 模型发现。
 *
 * 码道网关有两份清单需要合并：
 *   1. `GET  /v1/model/builtin`        —— 模型、上下文、max_tokens、是否支持图片、计费倍率
 *   2. `POST /v1/model/thinking-variants` —— 每个模型可选的思考强度
 *
 * 合并结果用于三处：
 *   - `/v1/models`（给 DSH 前端与诊断用）
 *   - 自动生成的 `cordis.patch.yml`（给 pi-ai 的 provider 配置）
 *   - 设置面板的模型表
 *
 * 这样用户装完插件即可用，不必手写十几个模型的 YAML。
 */

import type { MadaoClient } from './client.ts'

interface RawModel {
  model_id: string
  model_name: string
  model_category?: string
  enable?: boolean
  display_enabled?: boolean
  model_desc?: string
  supports_images?: boolean
  max_tokens?: number
  context_window?: number
  credit?: Array<{ ratio_display?: string; ratio?: string }>
}

interface ThinkingVariants {
  variants?: Record<string, { strengths?: string[]; default_strength?: string }>
}

export interface ModelInfo {
  id: string
  /** 网关给的显示名，与码道 UI 一致 */
  name: string
  context: number
  maxOutput: number
  /** 计费倍率，如 "0.18x"；仅供展示 */
  ratio?: string
  /** 是否支持图片输入 */
  supportsImages: boolean
  /** 可选思考强度，如 ["high","max"]；空数组表示不支持 */
  strengths: string[]
  /** 默认思考强度 */
  defaultStrength?: string
  /** 一句描述，面板里做 tooltip */
  description?: string
}

/**
 * 单次输出上限的封顶值。
 *
 * DSH 的压缩策略按 `contextWindow - maxTokens - headroomTokens` 算可用空间，
 * 其中 headroomTokens 默认就是 65536。网关给所有模型都标 65536 的 max_tokens，
 * 直接照抄等于把窗口的一大半锁死在「预留输出」上 —— 202752 的 GLM-5.2 只剩
 * 约 71k 可用，切模型时就报 `compaction still above threshold`。
 *
 * 32768 token 约 2.4 万汉字，日常够用；让出来的窗口更值钱。
 */
const MAX_OUTPUT_CAP = 32768

function clampMaxOutput(fromGateway: number | undefined, fallback: number | undefined): number {
  const base = fromGateway && fromGateway > 0 ? fromGateway : (fallback ?? MAX_OUTPUT_CAP)
  return Math.min(base, MAX_OUTPUT_CAP)
}

/**
 * 兜底清单。只在网关不可达时使用（例如首次启动还没配 AK/SK）。
 *
 * 正常情况下以网关返回为准 —— 上游调价或上新模型都会自动跟上。
 * `speed` 的 model_name 是「智速模式」，它是独立 model_id，
 * 内部自动挑模型并优化 Agent 执行，不是套在别模型上的计费开关。
 */
export const FALLBACK_MODELS: ModelInfo[] = [
  { id: 'deepseek-v4.1-flash', name: 'DeepSeek-V4.1-Flash', context: 1048576, maxOutput: 32768, ratio: '0.18x', supportsImages: true, strengths: [] },
  { id: 'deepseek-v4.1-flash-1017', name: 'DeepSeek-V4.1-Flash-1017', context: 1048576, maxOutput: 32768, ratio: '0.18x', supportsImages: true, strengths: [] },
  { id: 'glm-5.3', name: 'GLM-5.3', context: 1048576, maxOutput: 32768, ratio: '0.79x', supportsImages: false, strengths: [] },
  { id: 'glm-5.3-flash', name: 'GLM-5.3-Flash', context: 1048576, maxOutput: 32768, ratio: '0.08x', supportsImages: true, strengths: [] },
  { id: 'GLM-5.2', name: 'GLM-5.2', context: 202752, maxOutput: 32768, ratio: '0.7x', supportsImages: false, strengths: ['high', 'max'], defaultStrength: 'high' },
  { id: 'glm-5.2-sft-harmony', name: 'GLM-5.2-ArkTS-SPARK', context: 202752, maxOutput: 32768, ratio: '0.7x', supportsImages: false, strengths: ['high', 'max'], defaultStrength: 'high' },
  { id: 'kimi-k3', name: 'Kimi-K3', context: 1048576, maxOutput: 32768, ratio: '2.38x', supportsImages: true, strengths: [] },
  { id: 'kimi-k3.1-pro', name: 'Kimi-K3.1-Pro', context: 1048576, maxOutput: 32768, ratio: '1.63x', supportsImages: true, strengths: [] },
  { id: 'openpangu-2.0-pro', name: 'OpenPangu-2.0-Pro', context: 524288, maxOutput: 32768, ratio: '0.7x', supportsImages: false, strengths: [] },
  { id: 'openpangu-2.0-flash', name: 'OpenPangu-2.0-Flash', context: 524288, maxOutput: 32768, ratio: '0.32x', supportsImages: false, strengths: [] },
  { id: 'speed', name: '智速模式', context: 1048576, maxOutput: 32768, ratio: '0.18x', supportsImages: false, strengths: [] },
]

/** 从网关拉取并合并模型清单。任何一步失败都退回兜底清单。 */
export async function discoverModels(client: MadaoClient): Promise<{ models: ModelInfo[]; source: 'gateway' | 'fallback'; error?: string }> {
  try {
    const raw = (await client.getJson('/v1/model/builtin')) as { builtinModels?: RawModel[] }
    const list = raw?.builtinModels ?? []
    if (list.length === 0) return { models: FALLBACK_MODELS, source: 'fallback', error: '网关返回空清单' }

    // 思考强度单独一个接口；失败不影响主清单
    let variants: Record<string, { strengths?: string[]; default_strength?: string }> = {}
    try {
      const tv = (await client.postJson('/v1/model/thinking-variants', {
        model_names: list.map((m) => m.model_id),
      })) as ThinkingVariants
      variants = tv?.variants ?? {}
    } catch {
      // 静默忽略：强度是附加能力，拿不到就当不支持
    }

    const models = list
      .filter((m) => m.model_id && m.enable !== false)
      .map((m): ModelInfo => {
        const v = variants[m.model_id]
        const fb = FALLBACK_MODELS.find((f) => f.id === m.model_id)
        return {
          id: m.model_id,
          name: m.model_name || m.model_id,
          context: m.context_window ?? fb?.context ?? 0,
          // 单次输出上限不能照抄网关的 max_tokens。DSH 的压缩逻辑会把它
          // 当作 reservedCompletionTokens 从窗口里扣掉，同时还会再扣一份
          // headroomTokens（默认 65536）。照抄 65536 的话，202752 的窗口
          // 只剩 ~71k 可用，稍微长一点的会话就切不过去。
          // 这里封顶 MAX_OUTPUT_CAP，把剩下的还给对话上下文。
          maxOutput: clampMaxOutput(m.max_tokens, fb?.maxOutput),
          ratio: m.credit?.[0]?.ratio_display,
          supportsImages: m.supports_images === true,
          strengths: v?.strengths ?? [],
          defaultStrength: v?.default_strength || undefined,
          description: m.model_desc,
        }
      })

    return { models, source: 'gateway' }
  } catch (e) {
    return { models: FALLBACK_MODELS, source: 'fallback', error: String((e as Error)?.message ?? e) }
  }
}

