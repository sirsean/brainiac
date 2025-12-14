// @vitest-environment node

import { describe, expect, it } from 'vitest'

import handler from './index'

const env = {
  FIREBASE_PROJECT_ID: 'test',
  AI_TAGGER_MODEL: '@cf/openai/gpt-oss-20b',
  DB: {} as unknown as D1Database,
  ANALYSIS_QUEUE: { send: async () => undefined } as unknown as Queue,
  AI: { run: async () => ({ output_text: '{"tags":[]}' }) } as unknown as Ai,
} as unknown as Env

describe('worker fetch handler', () => {
  it('requires auth for API paths', async () => {
    const apiPaths = ['/api/', '/api/me', '/api/thoughts', '/api/tags', '/api/thoughts/by-tags']

    for (const path of apiPaths) {
      const res = await handler.fetch!(new Request(`https://example.com${path}`), env)

      expect(res.status).toBe(401)
      expect(res.headers.get('content-type')).toMatch(/application\/json/i)
      await expect(res.json()).resolves.toHaveProperty('error')
    }
  })

  it('returns 404 for non-API paths', async () => {
    const nonApiPaths = ['/', '/not-api', '/api']

    for (const path of nonApiPaths) {
      const res = await handler.fetch!(new Request(`https://example.com${path}`), env)

      expect(res.status).toBe(404)
    }
  })
})
