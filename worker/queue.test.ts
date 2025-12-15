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
  const fetchMock = vi.fn(async () => {
    return new Response(
      JSON.stringify({
        object: 'response',
        output: [
          {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: aiOutputText }],
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

  return {
    FIREBASE_PROJECT_ID: 'proj',
    AI_TAGGER_MODEL: '@cf/openai/gpt-oss-20b',
    CLOUDFLARE_ACCOUNT_ID: 'acct',
    CLOUDFLARE_API_TOKEN: 'tok',
    DB: {} as unknown as D1Database,
    ANALYSIS_QUEUE: { send: async () => undefined } as unknown as Queue,
    AI: {} as unknown as Ai,
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

  it('retries on errors and records job error', async () => {
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
})
