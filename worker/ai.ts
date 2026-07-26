export const DEFAULT_AI_MODEL = '@cf/zai-org/glm-4.7-flash' as const
export const DEFAULT_THERAPY_AI_MODEL = '@cf/moonshotai/kimi-k2.6' as const

export type RoleMessage = { role: 'system' | 'user' | 'assistant'; content: string }

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

/** Enable model thinking (therapy analysis, etc.). */
export function chatTemplateKwargsThinkingOn(model: string): Record<string, unknown> | undefined {
  if (isKimiModel(model)) return { thinking: true }
  if (isGlmModel(model)) return { thinking: { type: 'enabled' } }
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

export type AiStreamDelta = {
  type: 'reasoning' | 'content'
  text: string
}

/**
 * Stream a Workers AI chat completion with thinking enabled (no JSON response_format).
 * Yields reasoning/content text deltas as the model produces them.
 *
 * IMPORTANT: Cloudflare returns a ReadableStream that is *also* async-iterable.
 * Iterating it directly yields Uint8Array SSE fragments — not JSON objects.
 * Always decode via getReader() first.
 */
export async function* runWorkersAiStream(
  env: Env,
  model: string,
  messages: RoleMessage[],
): AsyncGenerator<AiStreamDelta> {
  if (!env.AI) {
    throw new Error('AI binding is not configured')
  }

  const templateKwargs = chatTemplateKwargsThinkingOn(model)

  console.log('[ai.stream] start', { model, messageCount: messages.length })

  const raw = await env.AI.run(model as keyof AiModels, {
    messages,
    stream: true,
    ...(templateKwargs ? { chat_template_kwargs: templateKwargs } : {}),
  })

  const meta = {
    typeof: typeof raw,
    ctor: raw?.constructor?.name ?? null,
    isAsyncIterable: isAsyncIterable(raw),
    hasGetReader: raw != null && typeof raw === 'object' && 'getReader' in (raw as object),
  }
  console.log('[ai.stream] binding returned', meta)

  // Prefer byte/SSE ReadableStream decoding (even when the stream is also async-iterable).
  if (raw && typeof raw === 'object' && 'getReader' in (raw as object)) {
    const reader = (raw as ReadableStream<Uint8Array>).getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let byteChunks = 0
    let yielded = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        byteChunks += 1
        const piece =
          typeof value === 'string'
            ? value
            : value instanceof Uint8Array
              ? decoder.decode(value, { stream: true })
              : value && typeof value === 'object' && ArrayBuffer.isView(value)
                ? decoder.decode(value as ArrayBufferView, { stream: true })
                : ''
        if (!piece) {
          // Object chunks (rare): try as structured deltas.
          if (value && typeof value === 'object' && !(value instanceof Uint8Array)) {
            for (const d of deltasFromChunk(value)) {
              yielded += 1
              yield d
            }
          }
          continue
        }
        buffer += piece
        const parts = buffer.split('\n')
        buffer = parts.pop() ?? ''
        for (const line of parts) {
          for (const d of deltasFromSseLine(line)) {
            yielded += 1
            yield d
          }
        }
      }
      buffer += decoder.decode()
      if (buffer.trim()) {
        for (const line of buffer.split('\n')) {
          for (const d of deltasFromSseLine(line)) {
            yielded += 1
            yield d
          }
        }
      }
    } finally {
      try {
        reader.releaseLock()
      } catch {
        // ignore
      }
    }
    console.log('[ai.stream] readable complete', { byteChunks, yielded })
    return
  }

  if (isAsyncIterable(raw)) {
    let n = 0
    let yielded = 0
    for await (const chunk of raw as AsyncIterable<unknown>) {
      n += 1
      if (chunk instanceof Uint8Array) {
        const text = new TextDecoder().decode(chunk)
        for (const line of text.split('\n')) {
          for (const d of deltasFromSseLine(line)) {
            yielded += 1
            yield d
          }
        }
        continue
      }
      for (const d of deltasFromChunk(chunk)) {
        yielded += 1
        yield d
      }
    }
    console.log('[ai.stream] asyncIterable complete', { chunks: n, yielded })
    return
  }

  // Non-streaming fallback: emit full text once.
  console.log('[ai.stream] non-stream fallback')
  const text = extractAiOutputText(raw)
  if (text) yield { type: 'content', text }
}

function isAsyncIterable(v: unknown): v is AsyncIterable<unknown> {
  return v != null && typeof v === 'object' && Symbol.asyncIterator in (v as object)
}

function* deltasFromSseLine(line: string): Generator<AiStreamDelta> {
  const trimmed = line.trim()
  if (!trimmed || trimmed === 'data: [DONE]') return
  const payload = trimmed.startsWith('data:') ? trimmed.slice(5).trim() : trimmed
  if (!payload || payload === '[DONE]') return
  try {
    const json = JSON.parse(payload) as unknown
    yield* deltasFromChunk(json)
  } catch {
    // ignore non-JSON keepalives / partial lines
  }
}

/** Test helper: parse one SSE `data:` line into deltas. */
export function parseWorkersAiSseDataLine(line: string): AiStreamDelta[] {
  return [...deltasFromSseLine(line)]
}

function* deltasFromChunk(chunk: unknown): Generator<AiStreamDelta> {
  if (chunk == null) return

  if (typeof chunk === 'string') {
    if (chunk.trim()) yield { type: 'content', text: chunk }
    return
  }

  if (typeof chunk !== 'object') return

  const o = chunk as {
    response?: unknown
    output_text?: unknown
    choices?: Array<{
      delta?: {
        content?: unknown
        reasoning?: unknown
        reasoning_content?: unknown
      }
      message?: ChatMessageOut | null
    }>
  }

  const delta = o.choices?.[0]?.delta
  if (delta) {
    const reasoning =
      (typeof delta.reasoning === 'string' && delta.reasoning) ||
      (typeof delta.reasoning_content === 'string' && delta.reasoning_content) ||
      ''
    if (reasoning) yield { type: 'reasoning', text: reasoning }

    const content =
      typeof delta.content === 'string'
        ? delta.content
        : textFromContentParts(delta.content)
    if (content) yield { type: 'content', text: content }
    return
  }

  const msg = o.choices?.[0]?.message
  if (msg) {
    const reasoning =
      (typeof msg.reasoning === 'string' && msg.reasoning) ||
      (typeof msg.reasoning_content === 'string' && msg.reasoning_content) ||
      ''
    if (reasoning) yield { type: 'reasoning', text: reasoning }
    const content = textFromContentParts(msg.content)
    if (content) yield { type: 'content', text: content }
    return
  }

  if (typeof o.response === 'string' && o.response) {
    yield { type: 'content', text: o.response }
  }
  if (typeof o.output_text === 'string' && o.output_text) {
    yield { type: 'content', text: o.output_text }
  }
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
