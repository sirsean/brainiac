// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest'

const dbMocks = vi.hoisted(() => {
  return {
    ensureUser: vi.fn(async () => undefined),
    listThoughtsInCreatedAtRange: vi.fn(),
    getTagsForThoughtIds: vi.fn(),
    getThoughtMoodsForThoughtIds: vi.fn(),
    createTherapyReport: vi.fn(),
    markTherapyReportDone: vi.fn(async () => undefined),
    markTherapyReportError: vi.fn(async () => undefined),
    updateTherapyReportProgress: vi.fn(async () => undefined),
    getTherapyReportById: vi.fn(),
    listTherapyReports: vi.fn(),
    createAnalysisJob: vi.fn(),
    createThought: vi.fn(),
    incrementJobAttempts: vi.fn(),
    listRecentUserTagNames: vi.fn(),
    listThoughts: vi.fn(),
    listThoughtsByTagNames: vi.fn(),
    listThoughtCountsByLocalDay: vi.fn(),
    listUserTagsWithStats: vi.fn(),
    markJobDone: vi.fn(),
    markJobError: vi.fn(),
    markJobProcessing: vi.fn(),
    softDeleteThought: vi.fn(),
    updateThoughtBody: vi.fn(),
    getAnalysisJobById: vi.fn(),
    getThoughtById: vi.fn(),
    getThoughtTags: vi.fn(),
    setThoughtTagsAiOnly: vi.fn(),
    getAnalysisJobStatusSummariesForThoughtIds: vi.fn(),
    upsertThoughtMood: vi.fn(),
    getThoughtMoodByThoughtId: vi.fn(),
  }
})

const authMocks = vi.hoisted(() => ({
  getBearerToken: vi.fn(() => 'tok'),
  verifyFirebaseIdToken: vi.fn(async () => ({ uid: 'u1', email: 'a@b.c' })),
}))

const aiMocks = vi.hoisted(() => ({
  runWorkersAi: vi.fn(),
  runWorkersAiStream: vi.fn(),
  extractAiOutputText: vi.fn(),
  parseJsonObjectFromAiText: vi.fn(),
  DEFAULT_AI_MODEL: '@cf/zai-org/glm-4.7-flash',
  DEFAULT_THERAPY_AI_MODEL: '@cf/moonshotai/kimi-k2.6',
}))

vi.mock('./db', () => dbMocks)
vi.mock('./auth', () => authMocks)
vi.mock('./ai', () => aiMocks)

import handler from './index'

function makeEnv(): Env {
  return {
    FIREBASE_PROJECT_ID: 'proj',
    AI_TAGGER_MODEL: '@cf/zai-org/glm-4.7-flash',
    AI_THERAPY_MODEL: '@cf/moonshotai/kimi-k2.6',
    DB: {} as unknown as D1Database,
    ANALYSIS_QUEUE: { send: async () => undefined } as unknown as Queue,
    AI: { run: vi.fn() } as unknown as Ai,
  } as unknown as Env
}

beforeEach(() => {
  vi.resetAllMocks()
  authMocks.getBearerToken.mockReturnValue('tok')
  authMocks.verifyFirebaseIdToken.mockResolvedValue({ uid: 'u1', email: 'a@b.c' })
})

describe('therapy reports API', () => {
  it('preview returns empty stats for empty ranges', async () => {
    dbMocks.listThoughtsInCreatedAtRange.mockResolvedValue([])
    dbMocks.getTagsForThoughtIds.mockResolvedValue(new Map())
    dbMocks.getThoughtMoodsForThoughtIds.mockResolvedValue(new Map())

    const res = await handler.fetch!(
      new Request('https://example.com/api/therapy-reports/preview?from=2026-07-01&to=2026-07-07&tz_offset_min=0'),
      makeEnv(),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { thought_count: number }
    expect(body.thought_count).toBe(0)
  })

  it('stream writes SSE events and marks report done', async () => {
    dbMocks.listThoughtsInCreatedAtRange.mockResolvedValue([
      {
        id: 1,
        uid: 'u1',
        body: 'hello therapy',
        created_at: Math.floor(Date.UTC(2026, 6, 2, 12, 0, 0) / 1000),
        updated_at: null,
        deleted_at: null,
        status: 'active',
        error: null,
      },
    ])
    dbMocks.getTagsForThoughtIds.mockResolvedValue(new Map([[1, ['focus']]]))
    dbMocks.getThoughtMoodsForThoughtIds.mockResolvedValue(
      new Map([
        [
          1,
          {
            id: 1,
            thought_id: 1,
            uid: 'u1',
            mood_score: 4,
            explanation: 'ok',
            model: 'm',
            created_at: 1,
            updated_at: 1,
          },
        ],
      ]),
    )
    dbMocks.createTherapyReport.mockResolvedValue({
      id: 9,
      uid: 'u1',
      start_date: '2026-07-01',
      end_date: '2026-07-07',
      tz_offset_min: 0,
      thought_count: 1,
      model: '@cf/moonshotai/kimi-k2.6',
      status: 'running',
      thinking_text: null,
      report_markdown: null,
      meta_json: '{}',
      error: null,
      created_at: 1,
      updated_at: 1,
    })

    aiMocks.runWorkersAiStream.mockImplementation(async function* () {
      yield { type: 'reasoning', text: 'considering…' }
      yield { type: 'content', text: '## What has been on your mind\nHello' }
    })

    const res = await handler.fetch!(
      new Request('https://example.com/api/therapy-reports/stream', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ from: '2026-07-01', to: '2026-07-07', tz_offset_min: 0 }),
      }),
      makeEnv(),
    )

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/)

    const text = await res.text()
    expect(text).toContain('event: meta')
    expect(text).toContain('event: thinking')
    expect(text).toContain('considering')
    expect(text).toContain('event: content')
    expect(text).toContain('event: done')

    await vi.waitFor(() => {
      expect(dbMocks.markTherapyReportDone).toHaveBeenCalled()
    })
  })
})
