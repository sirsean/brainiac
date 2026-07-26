export const DEFAULT_AI_MODEL = '@cf/zai-org/glm-4.7-flash' as const

type RoleMessage = { role: 'system' | 'user' | 'assistant'; content: string }

type ChatMessageOut = {
  content?: string | null | Array<{ type?: string; text?: string }>
  reasoning?: string | null
  reasoning_content?: string | null
}

/** Kimi defaults to thinking mode; without disabling it, `content` is often empty. */
export function isKimiModel(model: string): boolean {
  const m = model.toLowerCase()
  return m.includes('moonshotai/kimi') || m.includes('kimi-k2')
}

/** GLM defaults to extended thinking; `content` is often null and prose lands in `reasoning`. */
export function isGlmModel(model: string): boolean {
  return model.toLowerCase().includes('glm')
}

export function chatTemplateKwargsForModel(model: string): Record<string, unknown> | undefined {
  if (isKimiModel(model)) return { thinking: false }
  if (isGlmModel(model)) return { thinking: { type: 'disabled' } }
  return undefined
}

/**
 * Run a Workers AI text model via the `AI` binding (no API token required).
 * Locally, `remote: true` on the binding uses your Wrangler login.
 */
export async function runWorkersAi(env: Env, model: string, messages: RoleMessage[]): Promise<unknown> {
  if (!env.AI) {
    throw new Error('AI binding is not configured')
  }

  const templateKwargs = chatTemplateKwargsForModel(model)

  return await env.AI.run(model as keyof AiModels, {
    messages,
    // Ask for JSON when the model supports OpenAI-style response_format.
    response_format: { type: 'json_object' },
    ...(templateKwargs ? { chat_template_kwargs: templateKwargs } : {}),
  })
}

function textFromContentParts(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''

  const parts: string[] = []
  for (const part of content) {
    if (!part || typeof part !== 'object') continue
    const text = (part as { text?: unknown }).text
    if (typeof text === 'string' && text.length > 0) parts.push(text)
  }
  return parts.join('')
}

export function extractAiOutputText(result: unknown): string {
  if (typeof result === 'string') return result

  if (result && typeof result === 'object') {
    const r = result as {
      output_text?: unknown
      response?: unknown
      output?: unknown
      choices?: Array<{ message?: ChatMessageOut | null }>
    }

    if (typeof r.output_text === 'string') return r.output_text

    // Chat Completions style (common via env.AI.run with `messages`)
    const chatMsg = r.choices?.[0]?.message
    if (chatMsg) {
      const chatContent = textFromContentParts(chatMsg.content)
      if (chatContent.trim().length > 0) return chatContent

      if (typeof chatMsg.reasoning === 'string' && chatMsg.reasoning.trim().length > 0) {
        return chatMsg.reasoning
      }
      if (typeof chatMsg.reasoning_content === 'string' && chatMsg.reasoning_content.trim().length > 0) {
        return chatMsg.reasoning_content
      }
    }

    // Some non-OpenAI models return `response`.
    if (typeof r.response === 'string') return r.response

    // OpenAI Responses API style: { output: [ { type: 'message', content: [ { type: 'output_text', text: '...' } ] } ] }
    if (Array.isArray(r.output)) {
      for (const item of r.output) {
        if (!item || typeof item !== 'object') continue
        const content = (item as { content?: unknown }).content
        const asText = textFromContentParts(content)
        if (asText.trim().length > 0) return asText
      }
    }
  }

  throw new Error('AI result missing output text')
}

/**
 * Models often wrap JSON in markdown fences or surrounding prose.
 * Extract and parse the first JSON object found in the text.
 */
export function parseJsonObjectFromAiText(text: string): unknown {
  const trimmed = text.trim()
  if (!trimmed) throw new Error('AI returned empty output')

  const candidates: string[] = [trimmed]

  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence?.[1]) candidates.push(fence[1].trim())

  const braced = trimmed.match(/\{[\s\S]*\}/)
  if (braced?.[0]) candidates.push(braced[0])

  let lastError: unknown
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as unknown
    } catch (e) {
      lastError = e
    }
  }

  const err = new Error('AI returned non-JSON output') as Error & { details?: unknown }
  err.details = {
    output_text_preview: trimmed.length > 1000 ? trimmed.slice(0, 1000) + '…' : trimmed,
    parse_error: lastError instanceof Error ? lastError.message : String(lastError),
  }
  throw err
}
