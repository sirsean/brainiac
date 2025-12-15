// @vitest-environment node

import { describe, expect, it, vi } from 'vitest'

import { CloudflareAiApiClient, extractAiOutputText } from './cloudflareAiApiClient'

describe('CloudflareAiApiClient', () => {
  it('POSTs to /accounts/:id/ai/v1/responses and returns result', async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          object: 'response',
          output: [
            {
              type: 'message',
              role: 'assistant',
              content: [{ type: 'output_text', text: '{"tags":[]}' }],
            },
          ],
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      )
    })

    vi.stubGlobal('fetch', fetchMock)

    const client = new CloudflareAiApiClient({ accountId: 'acct', apiToken: 'tok', baseUrl: 'https://api.cloudflare.com/client/v4' })

    const result = await client.run('@cf/openai/gpt-oss-20b', { input: [] })

    // Ensure model is sent in the request body.
    const body = (((fetchMock as any).mock.calls[0]?.[1] as { body?: unknown } | undefined)?.body)
    expect(typeof body).toBe('string')
    expect(body as string).toContain('"model":"@cf/openai/gpt-oss-20b"')

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.cloudflare.com/client/v4/accounts/acct/ai/v1/responses',
      expect.objectContaining({ method: 'POST' }),
    )

    expect(extractAiOutputText(result)).toBe('{"tags":[]}')
  })

  it('throws when Cloudflare returns success=false', async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ success: false, errors: [{ message: 'nope' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })

    vi.stubGlobal('fetch', fetchMock)

    const client = new CloudflareAiApiClient({ accountId: 'acct', apiToken: 'tok' })

    await expect(client.run('@cf/openai/gpt-oss-20b', { input: [] })).rejects.toThrow('nope')
  })
})
