// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const dbMocks = vi.hoisted(() => {
  return {
    getAnalysisJobById: vi.fn(),
    markJobProcessing: vi.fn(async () => undefined),
    incrementJobAttempts: vi.fn(async () => undefined),
    getThoughtById: vi.fn(),
    listRecentUserTagNames: vi.fn(),
    getThoughtTags: vi.fn(),
    setThoughtTagsAiOnly: vi.fn(async () => undefined),
    markJobDone: vi.fn(async () => undefined),
    markJobError: vi.fn(async () => undefined),
    upsertThoughtMood: vi.fn(async () => undefined),

    // api-only exports (not used here)
    ensureUser: vi.fn(),
    createThought: vi.fn(),
    updateThoughtBody: vi.fn(),
    softDeleteThought: vi.fn(),
    createAnalysisJob: vi.fn(),
    listThoughts: vi.fn(),
    getTagsForThoughtIds: vi.fn(),
    getAnalysisJobStatusSummariesForThoughtIds: vi.fn(),
    listUserTagsWithStats: vi.fn(),
    listThoughtsByTagNames: vi.fn(),
  }
})

const authMocks = vi.hoisted(() => {
  return {
    getBearerToken: vi.fn(),
    verifyFirebaseIdToken: vi.fn(),
  }
})

vi.mock('./db', () => dbMocks)
vi.mock('./auth', () => authMocks)

import handler from './index'

function makeEnv(aiOutputText: string): Env {
  return {
    FIREBASE_PROJECT_ID: 'proj',
    AI_TAGGER_MODEL: '@cf/zai-org/glm-4.7-flash',
    DB: {} as unknown as D1Database,
    ANALYSIS_QUEUE: { send: async () => undefined } as unknown as Queue,
    AI: {
      run: vi.fn(async () => ({
        choices: [{ message: { content: aiOutputText } }],
      })),
    } as unknown as Ai,
  }
}

function makeMessage(body: unknown) {
  return {
    body,
    ack: vi.fn(),
    retry: vi.fn(),
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Worker queue consumer', () => {
  it('acks invalid message bodies', async () => {
    const env = makeEnv('{"tags":[]}')
    const msg = makeMessage({ nope: true })

    await handler.queue!({ messages: [msg] } as unknown as MessageBatch<{ jobId: number }>, env, {
      waitUntil: () => undefined,
    } as unknown as ExecutionContext)

    expect(msg.ack).toHaveBeenCalled()
  })

  it('skips deleted thoughts and marks job done', async () => {
    const env = makeEnv('{"tags":["Foo"]}')

    dbMocks.getAnalysisJobById.mockResolvedValue({
      id: 1,
      thought_id: 2,
      uid: 'u1',
      step: 'tagging',
      status: 'queued',
    })

    dbMocks.getThoughtById.mockResolvedValue({
      id: 2,
      uid: 'u1',
      body: 'x',
      created_at: 1,
      updated_at: null,
      deleted_at: 123,
      status: 'active',
      error: null,
    })

    const msg = makeMessage({ jobId: 1 })

    await handler.queue!({ messages: [msg] } as unknown as MessageBatch<{ jobId: number }>, env, {
      waitUntil: () => undefined,
    } as unknown as ExecutionContext)

    expect(dbMocks.markJobDone).toHaveBeenCalledWith(env, 1, expect.stringContaining('thought_deleted'))
    expect(msg.ack).toHaveBeenCalled()
  })

  it('drops invalid tags but still applies valid tags and marks job done', async () => {
    const env = makeEnv('{"tags":["Foo","bad tag","Bar","💥","Foo"]}')

    dbMocks.getAnalysisJobById.mockResolvedValue({
      id: 1,
      thought_id: 2,
      uid: 'u1',
      step: 'tagging',
      status: 'queued',
    })

    dbMocks.getThoughtById.mockResolvedValue({
      id: 2,
      uid: 'u1',
      body: 'hello',
      created_at: 1,
      updated_at: null,
      deleted_at: null,
      status: 'active',
      error: null,
    })

    dbMocks.listRecentUserTagNames.mockResolvedValue(['Foo'])
    dbMocks.getThoughtTags.mockResolvedValue(['Old'])

    const msg = makeMessage({ jobId: 1 })

    await handler.queue!({ messages: [msg] } as unknown as MessageBatch<{ jobId: number }>, env, {
      waitUntil: () => undefined,
    } as unknown as ExecutionContext)

    expect(dbMocks.setThoughtTagsAiOnly).toHaveBeenCalledWith(env, {
      uid: 'u1',
      thoughtId: 2,
      tagNames: ['Foo', 'Bar'],
    })

    expect(dbMocks.markJobDone).toHaveBeenCalledWith(
      env,
      1,
      expect.stringContaining('invalid_tags_dropped'),
    )

    expect(msg.ack).toHaveBeenCalled()
  })

  it('retries on errors and records job error for tagging jobs', async () => {
    const env = makeEnv('not json')

    dbMocks.getAnalysisJobById.mockResolvedValue({
      id: 1,
      thought_id: 2,
      uid: 'u1',
      step: 'tagging',
      status: 'queued',
    })

    dbMocks.getThoughtById.mockResolvedValue({
      id: 2,
      uid: 'u1',
      body: 'hello',
      created_at: 1,
      updated_at: null,
      deleted_at: null,
      status: 'active',
      error: null,
    })

    dbMocks.listRecentUserTagNames.mockResolvedValue([])
    dbMocks.getThoughtTags.mockResolvedValue([])

    const msg = makeMessage({ jobId: 1 })

    await handler.queue!({ messages: [msg] } as unknown as MessageBatch<{ jobId: number }>, env, {
      waitUntil: () => undefined,
    } as unknown as ExecutionContext)

    expect(dbMocks.markJobError).toHaveBeenCalled()
    expect(msg.retry).toHaveBeenCalledWith({ delaySeconds: 30 })
  })

  it('processes mood jobs and upserts mood then marks job done', async () => {
    const env = makeEnv('{"mood_score":4,"explanation":"Feels generally positive."}')

    dbMocks.getAnalysisJobById.mockResolvedValue({
      id: 2,
      thought_id: 3,
      uid: 'u1',
      step: 'mood',
      status: 'queued',
    })

    dbMocks.getThoughtById.mockResolvedValue({
      id: 3,
      uid: 'u1',
      body: 'Today went pretty well overall.',
      created_at: 1,
      updated_at: null,
      deleted_at: null,
      status: 'active',
      error: null,
    })

    const msg = makeMessage({ jobId: 2 })

    await handler.queue!({ messages: [msg] } as unknown as MessageBatch<{ jobId: number }>, env, {
      waitUntil: () => undefined,
    } as unknown as ExecutionContext)

    expect(dbMocks.upsertThoughtMood).toHaveBeenCalledWith(env, {
      uid: 'u1',
      thoughtId: 3,
      moodScore: 4,
      explanation: 'Feels generally positive.',
      model: '@cf/zai-org/glm-4.7-flash',
    })

    expect(dbMocks.markJobDone).toHaveBeenCalledWith(
      env,
      2,
      expect.stringContaining('mood_score'),
    )
    expect(msg.ack).toHaveBeenCalled()
  })

  it('retries on errors and records job error for mood jobs', async () => {
    const env = makeEnv('{"mood_score":99,"explanation":"way out of range"}')

    dbMocks.getAnalysisJobById.mockResolvedValue({
      id: 3,
      thought_id: 4,
      uid: 'u1',
      step: 'mood',
      status: 'queued',
    })

    dbMocks.getThoughtById.mockResolvedValue({
      id: 4,
      uid: 'u1',
      body: 'I feel strange.',
      created_at: 1,
      updated_at: null,
      deleted_at: null,
      status: 'active',
      error: null,
    })

    const msg = makeMessage({ jobId: 3 })

    await handler.queue!({ messages: [msg] } as unknown as MessageBatch<{ jobId: number }>, env, {
      waitUntil: () => undefined,
    } as unknown as ExecutionContext)

    expect(dbMocks.markJobError).toHaveBeenCalled()
    expect(msg.retry).toHaveBeenCalledWith({ delaySeconds: 30 })
  })
})
