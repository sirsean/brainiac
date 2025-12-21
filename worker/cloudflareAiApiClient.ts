type CloudflareApiError = {
  code?: number
  message?: string
}

type ErrorWithDetails = Error & { details?: unknown }

export class CloudflareAiApiClient {
  private readonly accountId: string
  private readonly apiToken: string
  private readonly baseUrl: string

  constructor(opts: { accountId: string; apiToken: string; baseUrl?: string }) {
    this.accountId = opts.accountId
    this.apiToken = opts.apiToken
    this.baseUrl = (opts.baseUrl ?? 'https://api.cloudflare.com/client/v4').replace(/\/$/, '')
  }

  async run<T = unknown>(model: string, input: unknown): Promise<T> {
    // Newer Workers AI REST API supports the OpenAI Responses API format at /ai/v1/responses.
    // We pass the model in the request body.
    const url = `${this.baseUrl}/accounts/${this.accountId}/ai/v1/responses`

    const payload: Record<string, unknown> =
      input && typeof input === 'object' ? { model, ...(input as Record<string, unknown>) } : { model, input }

    // Debug-friendly preview (truncate potentially large/sensitive text fields).
    const requestBodyPreview = (() => {
      try {
        const clone = structuredClone(payload) as Record<string, unknown>

        const msgs = clone.input
        if (Array.isArray(msgs)) {
          for (const m of msgs) {
            if (!m || typeof m !== 'object') continue
            const msg = m as Record<string, unknown>

            const content = msg.content
            if (!Array.isArray(content)) continue

            for (const c of content) {
              if (!c || typeof c !== 'object') continue
              const chunk = c as Record<string, unknown>
              const text = chunk.text
              if (typeof text === 'string') {
                chunk.text = text.length > 300 ? text.slice(0, 300) + '…<truncated>' : text
              }
            }
          }
        }

        const s = JSON.stringify(clone)
        return s.length > 4000 ? s.slice(0, 4000) + '…<truncated>' : s
      } catch {
        return null
      }
    })()

    const body = JSON.stringify(payload)

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.apiToken}`,
        'content-type': 'application/json',
      },
      body,
    })

    const rawText = await res.text()

    const rawTextPreview = rawText.length > 4000 ? rawText.slice(0, 4000) + '…<truncated>' : rawText

    if (!res.ok) {
      const err: ErrorWithDetails = new Error(`Cloudflare AI API request failed (HTTP ${res.status})`)
      err.details = {
        url,
        status: res.status,
        cloudflare_errors: null,
        request_body_preview: requestBodyPreview,
        response_text_preview: rawTextPreview,
      }
      throw err
    }

    let json: unknown
    try {
      json = JSON.parse(rawText) as unknown
    } catch {
      const err: ErrorWithDetails = new Error(`Cloudflare AI API returned non-JSON response (HTTP ${res.status})`)
      err.details = {
        url,
        status: res.status,
        request_body_preview: requestBodyPreview,
        response_text_preview: rawTextPreview,
      }
      throw err
    }

    // Some Cloudflare v4 endpoints wrap errors as { success: false, errors: [...] } even when HTTP 200.
    if (json && typeof json === 'object' && 'success' in json) {
      const success = (json as { success?: unknown }).success
      if (success === false) {
        const errorsVal = (json as { errors?: unknown }).errors
        const errors = Array.isArray(errorsVal) ? (errorsVal as CloudflareApiError[]) : []

        const errMsg =
          errors.length > 0
            ? errors.map((e) => e.message ?? String(e.code ?? 'error')).join('; ')
            : `Cloudflare AI API request failed (HTTP ${res.status})`

        const err: ErrorWithDetails = new Error(errMsg)
        err.details = {
          url,
          status: res.status,
          cloudflare_errors: errors.length > 0 ? errors : null,
          request_body_preview: requestBodyPreview,
          response_text_preview: rawTextPreview,
        }
        throw err
      }
    }

    return json as T
  }
}

export function extractAiOutputText(result: unknown): string {
  if (typeof result === 'string') return result

  if (result && typeof result === 'object') {
    // Workers AI binding often returns { output_text: string }
    const r = result as { output_text?: unknown; response?: unknown; output?: unknown }

    if (typeof r.output_text === 'string') return r.output_text

    // Some non-OpenAI models return `response`.
    if (typeof r.response === 'string') return r.response

    // OpenAI Responses API style: { output: [ { type: 'message', content: [ { type: 'output_text', text: '...' } ] } ] }
    if (Array.isArray(r.output)) {
      for (const item of r.output) {
        if (!item || typeof item !== 'object') continue
        const content = (item as { content?: unknown }).content
        if (!Array.isArray(content)) continue
        for (const c of content) {
          if (!c || typeof c !== 'object') continue
          const type = (c as { type?: unknown }).type
          const text = (c as { text?: unknown }).text
          if (type === 'output_text' && typeof text === 'string') {
            return text
          }
        }
      }
    }
  }

  throw new Error('AI result missing output_text')
}
