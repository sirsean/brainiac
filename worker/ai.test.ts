// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ create: vi.fn(), constructor: vi.fn() }))
vi.mock('openai', () => ({ default: class {
  constructor(options: unknown) { mocks.constructor(options) }
  responses = { create: mocks.create }
} }))
import { AI_MODEL, runAiJson, runAiStream } from './ai'
const env = { OPENAI_API_KEY: 'test-key' } as Env
const messages = [{ role: 'user' as const, content: 'Synthetic journal entry' }]
beforeEach(() => { vi.clearAllMocks() })
function response(overrides = {}) {
  return { id: 'r1', status: 'completed', output_text: '{"tags":["work"]}', output: [], ...overrides }
}
function stream(events: unknown[]) {
  return { controller: { abort: vi.fn() }, async *[Symbol.asyncIterator]() { yield* events } }
}
async function collect() {
  const result = []
  for await (const delta of runAiStream(env, messages)) result.push(delta)
  return result
}
describe('OpenAI transport', () => {
  it('uses Luna and strict tagging schema without storing responses or SDK retries', async () => {
    mocks.create.mockResolvedValue(response())
    expect(await runAiJson(env, messages, 'tagging')).toEqual({ tags: ['work'] })
    expect(mocks.constructor).toHaveBeenCalledWith(expect.objectContaining({ maxRetries: 0, timeout: 120_000 }))
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      model: AI_MODEL, input: messages, store: false, reasoning: { effort: 'none' },
      text: { format: expect.objectContaining({ strict: true, name: 'tagging' }) },
    }))
  })
  it('uses a mood schema with a bounded integer score', async () => {
    mocks.create.mockResolvedValue(response({ output_text: '{"mood_score":3,"explanation":"Mixed"}' }))
    expect(await runAiJson(env, messages, 'mood')).toMatchObject({ mood_score: 3 })
    expect(mocks.create.mock.calls[0][0].text.format.schema.properties.mood_score.enum).toEqual([1,2,3,4,5])
  })
  it('rejects missing credentials before making requests', async () => {
    await expect(runAiJson({} as Env, messages, 'tagging')).rejects.toThrow('OPENAI_API_KEY')
    expect(mocks.create).not.toHaveBeenCalled()
  })
  it('rejects incomplete JSON and refusals', async () => {
    mocks.create.mockResolvedValue(response({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }))
    await expect(runAiJson(env, messages, 'tagging')).rejects.toThrow('max_output_tokens')
    mocks.create.mockResolvedValue(response({ output: [{ type: 'message', content: [{ type: 'refusal' }] }] }))
    await expect(runAiJson(env, messages, 'mood')).rejects.toThrow('declined')
  })
  it('streams text and reasoning summaries, requiring successful completion', async () => {
    const s = stream([
      { type: 'response.reasoning_summary_text.delta', delta: 'Summary' },
      { type: 'response.output_text.delta', delta: 'Report' },
      { type: 'response.completed', response: { id: 'r1' } },
    ])
    mocks.create.mockResolvedValue(s)
    expect(await collect()).toEqual([{ type: 'reasoning', text: 'Summary' }, { type: 'content', text: 'Report' }])
    expect(s.controller.abort).toHaveBeenCalled()
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ model: AI_MODEL, stream: true, store: false }))
  })
  it.each([
    [],
    [{ type: 'response.output_text.delta', delta: 'Partial report' }],
    [{ type: 'response.incomplete', response: { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } } }],
    [{ type: 'response.failed', response: { status: 'failed', error: { code: 'server_error' } } }],
    [{ type: 'response.refusal.delta', delta: 'No' }],
    [{ type: 'error', code: 'rate_limit_exceeded' }],
  ])('rejects unsuccessful stream %#', async (...events) => {
    mocks.create.mockResolvedValue(stream(events))
    await expect(collect()).rejects.toThrow()
  })
  it('propagates HTTP failures and timeouts without retrying', async () => {
    mocks.create.mockRejectedValue(new Error('429 rate limit'))
    await expect(runAiJson(env, messages, 'tagging')).rejects.toThrow('429')
    expect(mocks.create).toHaveBeenCalledTimes(1)
  })
})
