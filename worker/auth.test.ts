// @vitest-environment node

import { describe, expect, it } from 'vitest'

import { getBearerToken } from './auth'

describe('auth', () => {
  it('getBearerToken returns null when header missing', () => {
    const req = new Request('https://example.com/api/me')
    expect(getBearerToken(req)).toBeNull()
  })

  it('getBearerToken parses Authorization: Bearer <token>', () => {
    const req = new Request('https://example.com/api/me', {
      headers: { Authorization: 'Bearer abc.def.ghi' },
    })
    expect(getBearerToken(req)).toBe('abc.def.ghi')
  })

  it('getBearerToken is case-insensitive and tolerates extra whitespace', () => {
    const req = new Request('https://example.com/api/me', {
      headers: { authorization: 'bearer   token123' },
    })
    expect(getBearerToken(req)).toBe('token123')
  })

  it('getBearerToken returns null for non-bearer schemes', () => {
    const req = new Request('https://example.com/api/me', {
      headers: { Authorization: 'Basic abc' },
    })
    expect(getBearerToken(req)).toBeNull()
  })
})
