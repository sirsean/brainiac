import OpenAI from 'openai'

export const AI_MODEL = 'gpt-6-luna' as const
export type RoleMessage = { role: 'system' | 'user' | 'assistant'; content: string }
export type AiStreamDelta = { type: 'reasoning' | 'content'; text: string }

export const TAG_SCHEMA = {
  type: 'object',
  properties: { tags: { type: 'array', items: { type: 'string' } } },
  required: ['tags'],
  additionalProperties: false,
}
export const MOOD_SCHEMA = {
  type: 'object',
  properties: {
    mood_score: { type: 'integer', enum: [1, 2, 3, 4, 5] },
    explanation: { type: 'string' },
  },
  required: ['mood_score', 'explanation'],
  additionalProperties: false,
}

function client(env: Env): OpenAI {
  if (!env.OPENAI_API_KEY?.trim()) throw new Error('OPENAI_API_KEY is not configured')
  // Queue retries own tagging/mood retry behavior. Do not replay partial report streams.
  return new OpenAI({ apiKey: env.OPENAI_API_KEY, maxRetries: 0, timeout: 120_000 })
}

export async function runAiJson(
  env: Env,
  messages: RoleMessage[],
  kind: 'tagging' | 'mood',
): Promise<unknown> {
  const response = await client(env).responses.create({
    model: AI_MODEL,
    input: messages,
    reasoning: { effort: 'none' },
    store: false,
    max_output_tokens: 2048,
    text: { format: {
      type: 'json_schema', name: kind, strict: true,
      schema: kind === 'tagging' ? TAG_SCHEMA : MOOD_SCHEMA,
    } },
  })
  console.info('[ai.json]', { kind, model: AI_MODEL, responseId: response.id, usage: response.usage })
  if (response.status !== 'completed') throw new Error(`AI response ${response.status}: ${response.incomplete_details?.reason ?? response.error?.code ?? 'no completion'}`)
  for (const item of response.output) {
    if (item.type === 'message' && item.content.some((part) => part.type === 'refusal')) {
      throw new Error('AI declined the analysis request')
    }
  }
  if (!response.output_text.trim()) throw new Error('AI response contains no output text')
  return JSON.parse(response.output_text)
}

export async function* runAiStream(env: Env, messages: RoleMessage[]): AsyncGenerator<AiStreamDelta> {
  const stream = await client(env).responses.create({
    model: AI_MODEL,
    input: messages,
    reasoning: { effort: 'medium', summary: 'auto' },
    store: false,
    stream: true,
    max_output_tokens: 16_384,
  })
  let completed = false
  try {
    for await (const event of stream) {
      switch (event.type) {
        case 'response.output_text.delta':
          yield { type: 'content', text: event.delta }
          break
        case 'response.reasoning_summary_text.delta':
          yield { type: 'reasoning', text: event.delta }
          break
        case 'response.refusal.delta':
          throw new Error('AI declined the report request')
        case 'response.completed':
          completed = true
          console.info('[ai.stream]', { model: AI_MODEL, responseId: event.response.id, usage: event.response.usage })
          break
        case 'response.failed':
        case 'response.incomplete':
          throw new Error(`AI response ${event.response.status}: ${event.response.error?.code ?? event.response.incomplete_details?.reason ?? 'no completion'}`)
        case 'error':
          throw new Error(`OpenAI stream error: ${event.code ?? 'unknown'}`)
      }
    }
    if (!completed) throw new Error('AI stream ended before completion')
  } finally {
    stream.controller.abort()
  }
}
