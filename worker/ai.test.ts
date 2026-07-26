// @vitest-environment node

import { describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_AI_MODEL,
  extractAiOutputText,
  isGlmModel,
  isKimiModel,
  parseJsonObjectFromAiText,
  runWorkersAi,
} from './ai'

describe('model helpers', () => {
  it('detects kimi and glm models', () => {
    expect(isKimiModel('@cf/moonshotai/kimi-k2.6')).toBe(true)
    expect(isGlmModel(DEFAULT_AI_MODEL)).toBe(true)
    expect(isGlmModel('@cf/openai/gpt-oss-20b')).toBe(false)
  })
})

describe('runWorkersAi', () => {
  it('calls env.AI.run with messages, json response_format, and GLM thinking disabled', async () => {
    const run = vi.fn(async () => ({
      choices: [{ message: { content: '{"tags":[]}' } }],
    }))

    const env = { AI: { run } } as unknown as Env
    const result = await runWorkersAi(env, DEFAULT_AI_MODEL, [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hi' },
    ])

    expect(run).toHaveBeenCalledWith(DEFAULT_AI_MODEL, {
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hi' },
      ],
      response_format: { type: 'json_object' },
      chat_template_kwargs: { thinking: { type: 'disabled' } },
    })
    expect(extractAiOutputText(result)).toBe('{"tags":[]}')
  })

  it('disables kimi thinking with boolean false', async () => {
    const run = vi.fn(async () => ({ choices: [{ message: { content: '{}' } }] }))
    const env = { AI: { run } } as unknown as Env

    await runWorkersAi(env, '@cf/moonshotai/kimi-k2.6', [{ role: 'user', content: 'hi' }])

    expect(run).toHaveBeenCalledWith(
      '@cf/moonshotai/kimi-k2.6',
      expect.objectContaining({ chat_template_kwargs: { thinking: false } }),
    )
  })

  it('throws when AI binding is missing', async () => {
    await expect(
      runWorkersAi({} as unknown as Env, DEFAULT_AI_MODEL, [{ role: 'user', content: 'hi' }]),
    ).rejects.toThrow('AI binding is not configured')
  })
})

describe('extractAiOutputText', () => {
  it('reads Responses API output_text / output arrays', () => {
    expect(extractAiOutputText({ output_text: 'a' })).toBe('a')
    expect(
      extractAiOutputText({
        output: [{ type: 'message', content: [{ type: 'output_text', text: '{"tags":[]}' }] }],
      }),
    ).toBe('{"tags":[]}')
  })

  it('reads Chat Completions choices', () => {
    expect(
      extractAiOutputText({
        choices: [{ message: { content: '{"mood_score":3,"explanation":"ok"}' } }],
      }),
    ).toBe('{"mood_score":3,"explanation":"ok"}')
  })
})

describe('parseJsonObjectFromAiText', () => {
  it('parses raw JSON', () => {
    expect(parseJsonObjectFromAiText('{"tags":["a"]}')).toEqual({ tags: ['a'] })
  })

  it('parses fenced JSON and prose-wrapped JSON', () => {
    expect(parseJsonObjectFromAiText('```json\n{"tags":["x"]}\n```')).toEqual({ tags: ['x'] })
    expect(parseJsonObjectFromAiText('Sure!\n{"tags":["y"]}\nThanks')).toEqual({ tags: ['y'] })
  })

  it('includes preview details when parsing fails', () => {
    try {
      parseJsonObjectFromAiText('not json at all')
      expect.unreachable('should throw')
    } catch (e) {
      expect(e).toBeInstanceOf(Error)
      expect((e as Error).message).toBe('AI returned non-JSON output')
      expect((e as { details?: { output_text_preview?: string } }).details?.output_text_preview).toBe(
        'not json at all',
      )
    }
  })
})
