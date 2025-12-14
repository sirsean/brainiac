// @vitest-environment node

import { describe, expect, it } from 'vitest'

import handler from './index'

describe('worker fetch handler', () => {
  it('returns JSON response for API paths', async () => {
    const apiPaths = ['/api/', '/api/anything']

    for (const path of apiPaths) {
      const res = await handler.fetch!(new Request(`https://example.com${path}`))

      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toMatch(/application\/json/i)
      await expect(res.json()).resolves.toEqual({ name: 'Cloudflare' })
    }
  })

  it('returns 404 for non-API paths', async () => {
    const nonApiPaths = ['/', '/not-api', '/api']

    for (const path of nonApiPaths) {
      const res = await handler.fetch!(new Request(`https://example.com${path}`))

      expect(res.status).toBe(404)
    }
  })
})
