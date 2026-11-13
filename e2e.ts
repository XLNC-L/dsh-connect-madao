/**
 * 端到端联调：真实凭证 → STS → 密钥协商 → chat 加密 → SSE 解密。
 *
 * 用法：
 *   node --experimental-strip-types e2e.ts <AK> <SK> [model] [prompt]
 */

import { StsProvider } from './src/sts-provider.ts'
import { MadaoClient } from './src/client.ts'
import { buildUpstreamBody } from './src/protocol/body.ts'
import { parseUpstreamEvent } from './src/protocol/sse.ts'

const [, , ak, sk, modelArg, promptArg] = process.argv
if (!ak || !sk) {
  console.error('用法: node --experimental-strip-types e2e.ts <AK> <SK> [model] [prompt]')
  process.exit(2)
}

const model = modelArg ?? 'deepseek-v4.1-flash'
const prompt = promptArg ?? '只回复两个字：你好'

function log(step: string, msg: string) {
  console.log(`[${step}] ${msg}`)
}

async function main() {
  log('1/5', '换取 STS 临时凭证…')
  const provider = new StsProvider({ ak, sk }, 3600)
  const creds = await provider.credentials()
  log('1/5', `✓ AK=${creds.ak}  STS长度=${creds.securityToken.length}`)

  log('2/5', 'P-256 密钥协商…')
  const client = new MadaoClient({ credentials: creds })
  const key = await client.ensureSessionKey()
  log('2/5', `✓ keyId=${key.keyId}  TTL=${Math.round((key.expiresAt - Date.now()) / 1000)}s`)

  log('3/5', '拉取模型清单…')
  try {
    const models = (await client.getModels()) as any
    const list = models?.builtinModels ?? []
    log('3/5', `✓ ${list.length} 个模型：${list.map((m: any) => m.model_id).join(', ')}`)
  } catch (err) {
    log('3/5', `⚠ ${String((err as Error).message).slice(0, 160)}`)
  }

  log('4/5', `发起 chat：model=${model}`)
  const body = buildUpstreamBody({
    model,
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 256,
    stream: true,
    temperature: 0.3,
  })

  const stream = await client.chatStream(body)
  const reader = stream.getReader()
  const decoder = new TextDecoder()

  let text = ''
  let reasoning = ''
  let buf = ''
  let events = 0
  let done = false
  let usage: any = null

  for (;;) {
    const { done: eof, value } = await reader.read()
    if (eof) break
    buf += decoder.decode(value, { stream: true })
    let sep: number
    while ((sep = buf.indexOf('\n\n')) !== -1) {
      const block = buf.slice(0, sep)
      buf = buf.slice(sep + 2)
      for (const line of block.split('\n')) {
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (payload === '[DONE]') {
          done = true
          continue
        }
        events++
        const ev = parseUpstreamEvent(payload)
        if (ev.reasoning) reasoning += ev.reasoning
        if (ev.text) text += ev.text
        if (ev.usage) usage = ev.usage
      }
    }
  }

  console.log()
  log('5/5', `SSE 事件 ${events} 个，收到 [DONE]: ${done}`)
  if (reasoning) log('推理', reasoning.slice(0, 200) + (reasoning.length > 200 ? '…' : ''))
  log('正文', JSON.stringify(text))
  if (usage) log('用量', JSON.stringify(usage))
  console.log()
  console.log(text.trim() ? '★★★ 端到端打通 ★★★' : '⚠ 未取到正文')
}

main().catch((err) => {
  console.error('\n✗ 失败:', (err as Error).message)
  process.exit(1)
})
