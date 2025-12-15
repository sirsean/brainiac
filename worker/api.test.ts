// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest'

const authMocks = vi.hoisted(() => {
  return {
    getBearerToken: vi.fn<(req: Request) => string | null>(),
    verifyFirebaseIdToken: vi.fn<
      (opts: { idToken: string; firebaseProjectId: string }) => Promise<{
        uid: string
        email?: string
        name?: string
        picture?: string
        raw: Record<string, unknown>
      }>
    >(),
  }
})

const dbMocks = vi.hoisted(() => {
  return {
    ensureUser: vi.fn<(env: Env, auth: unknown) => Promise<void>>(),

    createThought: vi.fn<(env: Env, uid: string, body: string) => Promise<unknown>>(),
    updateThoughtBody: vi.fn<(env: Env, uid: string, id: number, body: string) => Promise<unknown>>(),
    softDeleteThought: vi.fn<(env: Env, uid: string, id: number) => Promise<void>>(),

    createAnalysisJob: vi.fn<
      (env: Env, opts: { uid: string; thoughtId: number; step: string }) => Promise<unknown>
    >(),

    listThoughts: vi.fn<
      (env: Env, opts: { uid: string; limit: number; cursor?: { createdAt: number; id: number } }) => Promise<unknown[]>
    >(),
    getTagsForThoughtIds: vi.fn<(env: Env, thoughtIds: number[]) => Promise<Map<number, string[]>>>(),
    getAnalysisJobStatusSummariesForThoughtIds: vi.fn<(env: Env, uid: string, thoughtIds: number[]) => Promise<Map<number, unknown>>>(),
    getThoughtTags: vi.fn<(env: Env, thoughtId: number) => Promise<string[]>>(),

    listUserTagsWithStats: vi.fn<
      (env: Env, opts: { uid: string; limit: number; cursor?: { lastUsedAt: number; id: number } }) => Promise<unknown[]>
    >(),

    listThoughtsByTagNames: vi.fn<
      (env: Env, opts: { uid: string; tags: string[]; limit: number; cursor?: { createdAt: number; id: number } }) => Promise<unknown[]>
    >(),

    // queue-only exports (not used here)
    getAnalysisJobById: vi.fn(),
    getThoughtById: vi.fn(),
    listRecentUserTagNames: vi.fn(),
    markJobDone: vi.fn(),
    markJobError: vi.fn(),
    markJobProcessing: vi.fn(),
    incrementJobAttempts: vi.fn(),
    setThoughtTagsAiOnly: vi.fn(),
  }
})

vi.mock('./auth', () => authMocks)
vi.mock('./db', () => dbMocks)

import handler from './index'

function makeEnv(): Env {
  return {
    FIREBASE_PROJECT_ID: 'proj',
    AI_TAGGER_MODEL: '@cf/openai/gpt-oss-20b',
    DB: {} as unknown as D1Database,
    ANALYSIS_QUEUE: {
      send: vi.fn(async () => undefined),
    } as unknown as Queue,
    AI: {
      run: vi.fn(async () => ({ output_text: '{"tags":[]}' })),
    } as unknown as Ai,
  }
}

beforeEach(() => {
  vi.resetAllMocks()

  authMocks.getBearerToken.mockReturnValue('token')
  authMocks.verifyFirebaseIdToken.mockResolvedValue({ uid: 'u1', raw: {} })
  dbMocks.ensureUser.mockResolvedValue()
})

describe('Worker API', () => {
  it('returns 401 when missing bearer token', async () => {
    const env = makeEnv()
    authMocks.getBearerToken.mockReturnValue(null)

    const res = await handler.fetch!(new Request('https://example.com/api/me'), env)
    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toMatchObject({ error: expect.any(String) })
  })

  it('POST /api/thoughts validates JSON body', async () => {
    const env = makeEnv()

    const res = await handler.fetch!(
      new Request('https://example.com/api/thoughts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ wrong: true }),
      }),
      env,
    )

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: expect.any(String) })
  })

  it('POST /api/thoughts creates thought and enqueues tagging job', async () => {
    const env = makeEnv()

    dbMocks.createThought.mockResolvedValue({
      id: 123,
      uid: 'u1',
      body: 'hello',
      created_at: 100,
      updated_at: null,
      deleted_at: null,
      status: 'active',
      error: null,
    })

    dbMocks.createAnalysisJob.mockResolvedValue({
      id: 77,
      thought_id: 123,
      uid: 'u1',
      step: 'tagging',
      status: 'queued',
      updated_at: 100,
    })

    const res = await handler.fetch!(
      new Request('https://example.com/api/thoughts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body: 'hello' }),
      }),
      env,
    )

    expect(res.status).toBe(200)
    const json: unknown = await res.json()
    expect(json).toMatchObject({
      thought: { id: 123 },
      job: { id: 77 },
      next_cursor: '100:123',
    })

    expect(dbMocks.createThought).toHaveBeenCalledWith(env, 'u1', 'hello')
    expect(dbMocks.createAnalysisJob).toHaveBeenCalledWith(env, { uid: 'u1', thoughtId: 123, step: 'tagging' })

    const send = (env.ANALYSIS_QUEUE as unknown as { send: ReturnType<typeof vi.fn> }).send
    expect(send).toHaveBeenCalledWith({ jobId: 77 })
  })

  it('PATCH /api/thoughts/:id updates thought and enqueues tagging job', async () => {
    const env = makeEnv()

    dbMocks.updateThoughtBody.mockResolvedValue({
      id: 5,
      uid: 'u1',
      body: 'edited',
      created_at: 100,
      updated_at: 101,
      deleted_at: null,
      status: 'active',
      error: null,
    })

    dbMocks.createAnalysisJob.mockResolvedValue({
      id: 88,
      thought_id: 5,
      uid: 'u1',
      step: 'tagging',
      status: 'queued',
      updated_at: 101,
    })

    dbMocks.getThoughtTags.mockResolvedValue(['Foo'])

    const res = await handler.fetch!(
      new Request('https://example.com/api/thoughts/5', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body: 'edited' }),
      }),
      env,
    )

    expect(res.status).toBe(200)
    const json: unknown = await res.json()
    expect(json).toMatchObject({ thought: { id: 5, tags: ['Foo'] } })

    expect(dbMocks.updateThoughtBody).toHaveBeenCalledWith(env, 'u1', 5, 'edited')
    expect(dbMocks.createAnalysisJob).toHaveBeenCalledWith(env, { uid: 'u1', thoughtId: 5, step: 'tagging' })

    const send = (env.ANALYSIS_QUEUE as unknown as { send: ReturnType<typeof vi.fn> }).send
    expect(send).toHaveBeenCalledWith({ jobId: 88 })
  })

  it('DELETE /api/thoughts/:id soft-deletes', async () => {
    const env = makeEnv()
    dbMocks.softDeleteThought.mockResolvedValue()

    const res = await handler.fetch!(new Request('https://example.com/api/thoughts/9', { method: 'DELETE' }), env)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true })

    expect(dbMocks.softDeleteThought).toHaveBeenCalledWith(env, 'u1', 9)
  })

  it('GET /api/thoughts returns thoughts with tags and next_cursor', async () => {
    const env = makeEnv()

    dbMocks.listThoughts.mockResolvedValue([
      {
        id: 2,
        uid: 'u1',
        body: 'b',
        created_at: 101,
        updated_at: null,
        deleted_at: null,
        status: 'active',
        error: null,
      },
      {
        id: 1,
        uid: 'u1',
        body: 'a',
        created_at: 100,
        updated_at: null,
        deleted_at: null,
        status: 'active',
        error: null,
      },
    ])

    dbMocks.getTagsForThoughtIds.mockResolvedValue(new Map([[1, ['Foo']], [2, []]]))
    dbMocks.getAnalysisJobStatusSummariesForThoughtIds.mockResolvedValue(new Map())

    const res = await handler.fetch!(new Request('https://example.com/api/thoughts?limit=50'), env)
    expect(res.status).toBe(200)

    const json: unknown = await res.json()
    expect(json).toMatchObject({
      next_cursor: '100:1',
      thoughts: [
        { id: 2, tags: [] },
        { id: 1, tags: ['Foo'] },
      ],
    })

    expect(dbMocks.listThoughts).toHaveBeenCalledWith(env, { uid: 'u1', limit: 50, cursor: undefined })
  })

  it('GET /api/thoughts/by-tags requires tags param', async () => {
    const env = makeEnv()

    const res = await handler.fetch!(new Request('https://example.com/api/thoughts/by-tags?limit=50'), env)
    expect(res.status).toBe(400)
  })

  it('GET /api/tags returns tag stats and next_cursor', async () => {
    const env = makeEnv()

    dbMocks.listUserTagsWithStats.mockResolvedValue([
      {
        id: 10,
        uid: 'u1',
        name: 'Foo',
        created_at: 1,
        last_used_at: 200,
        thought_count: 3,
        most_recent_thought_at: 201,
      },
    ])

    const res = await handler.fetch!(new Request('https://example.com/api/tags?limit=100'), env)
    expect(res.status).toBe(200)

    const json: unknown = await res.json()
    expect(json).toMatchObject({
      next_cursor: '200:10',
      tags: [{ id: 10, name: 'Foo', thought_count: 3 }],
    })
  })
})
