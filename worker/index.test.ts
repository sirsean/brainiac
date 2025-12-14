// @vitest-environment node

import { describe, expect, it } from 'vitest'

import handler from './index'

describe('worker fetch handler', () => {
  it('returns JSON under /api/', async () => {
    const res = await handler.fetch!(new Request('https://example.com/api/'))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ name: 'Cloudflare' })
  })

  it('returns 404 for non-API paths', async () => {
    const res = await handler.fetch!(new Request('https://example.com/'))

    expect(res.status).toBe(404)
  })
})
