import { getBearerToken, verifyFirebaseIdToken } from './auth'
import {
  createAnalysisJob,
  createThought,
  ensureUser,
  getTagsForThoughtIds,
  incrementJobAttempts,
  listRecentUserTagNames,
  listThoughts,
  listThoughtsByTagNames,
  listUserTagsWithStats,
  markJobDone,
  markJobError,
  markJobProcessing,
  softDeleteThought,
  updateThoughtBody,
  getAnalysisJobById,
  getThoughtById,
  getThoughtTags,
  setThoughtTagsAiOnly,
} from './db'
import {
  buildTaggerSystemPrompt,
  buildTaggerUserPrompt,
  normalizeAndValidateTags,
  type TaggingAiResult,
} from './tagger'

type ApiErrorBody = {
  error: string
}

type AnalysisQueueMessage = {
  jobId: number
}

function json(data: unknown, init?: ResponseInit): Response {
  return Response.json(data, {
    headers: {
      'cache-control': 'no-store',
      ...init?.headers,
    },
    ...init,
  })
}

function err(status: number, message: string): Response {
  return json({ error: message } satisfies ApiErrorBody, { status })
}

function parseCursor(cursor: string | null): { createdAt: number; id: number } | undefined {
  if (!cursor) return undefined
  const m = cursor.match(/^(\d+):(\d+)$/)
  if (!m) return undefined
  return { createdAt: Number(m[1]), id: Number(m[2]) }
}

function parseTagsParam(tags: string | null): string[] {
  if (!tags) return []
  return tags
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
}

async function requireAuth(request: Request, env: Env) {
  const token = getBearerToken(request)
  if (!token) return { ok: false as const, res: err(401, 'Missing Authorization Bearer token') }

  try {
    const auth = await verifyFirebaseIdToken({
      idToken: token,
      firebaseProjectId: env.FIREBASE_PROJECT_ID,
    })

    await ensureUser(env, auth)

    return { ok: true as const, auth }
  } catch (e) {
    return { ok: false as const, res: err(401, e instanceof Error ? e.message : 'Unauthorized') }
  }
}

async function handleApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)

  const authRes = await requireAuth(request, env)
  if (!authRes.ok) return authRes.res
  const { auth } = authRes

  // Routes
  if (request.method === 'GET' && url.pathname === '/api/me') {
    return json({ uid: auth.uid, email: auth.email, name: auth.name, picture: auth.picture })
  }

  if (request.method === 'POST' && url.pathname === '/api/thoughts') {
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return err(400, 'Invalid JSON')
    }

    const thoughtBody =
      typeof body === 'object' && body !== null && 'body' in body
        ? (body as { body?: unknown }).body
        : undefined

    if (typeof thoughtBody !== 'string' || thoughtBody.trim().length === 0) {
      return err(400, 'body is required')
    }

    const thought = await createThought(env, auth.uid, thoughtBody)
    const job = await createAnalysisJob(env, { uid: auth.uid, thoughtId: thought.id, step: 'tagging' })
    await env.ANALYSIS_QUEUE.send({ jobId: job.id } satisfies AnalysisQueueMessage)

    return json({
      thought: { ...thought, tags: [] as string[] },
      job: { id: job.id, step: job.step, status: job.status },
      next_cursor: `${thought.created_at}:${thought.id}`,
    })
  }

  const thoughtIdMatch = url.pathname.match(/^\/api\/thoughts\/(\d+)$/)
  if (thoughtIdMatch && request.method === 'PATCH') {
    const id = Number(thoughtIdMatch[1])

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return err(400, 'Invalid JSON')
    }

    const thoughtBody =
      typeof body === 'object' && body !== null && 'body' in body
        ? (body as { body?: unknown }).body
        : undefined

    if (typeof thoughtBody !== 'string' || thoughtBody.trim().length === 0) {
      return err(400, 'body is required')
    }

    const thought = await updateThoughtBody(env, auth.uid, id, thoughtBody)
    const job = await createAnalysisJob(env, { uid: auth.uid, thoughtId: thought.id, step: 'tagging' })
    await env.ANALYSIS_QUEUE.send({ jobId: job.id } satisfies AnalysisQueueMessage)

    const tags = await getThoughtTags(env, thought.id)

    return json({
      thought: { ...thought, tags },
      job: { id: job.id, step: job.step, status: job.status },
    })
  }

  if (thoughtIdMatch && request.method === 'DELETE') {
    const id = Number(thoughtIdMatch[1])
    await softDeleteThought(env, auth.uid, id)
    return json({ ok: true })
  }

  if (request.method === 'GET' && url.pathname === '/api/thoughts') {
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? '50'), 1), 200)
    const cursor = parseCursor(url.searchParams.get('cursor'))

    const thoughts = await listThoughts(env, { uid: auth.uid, limit, cursor })
    const tagMap = await getTagsForThoughtIds(
      env,
      thoughts.map((t) => t.id),
    )

    const next = thoughts.length > 0 ? thoughts[thoughts.length - 1] : undefined

    return json({
      thoughts: thoughts.map((t) => ({ ...t, tags: tagMap.get(t.id) ?? [] })),
      next_cursor: next ? `${next.created_at}:${next.id}` : null,
    })
  }

  if (request.method === 'GET' && url.pathname === '/api/tags') {
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? '100'), 1), 200)

    const cursorParam = url.searchParams.get('cursor')
    const cursorMatch = cursorParam?.match(/^(\d+):(\d+)$/)
    const cursor = cursorMatch ? { lastUsedAt: Number(cursorMatch[1]), id: Number(cursorMatch[2]) } : undefined

    const rows = await listUserTagsWithStats(env, { uid: auth.uid, limit, cursor })
    const next = rows.length > 0 ? rows[rows.length - 1] : undefined

    return json({
      tags: rows,
      next_cursor: next ? `${Math.max(0, next.last_used_at ?? 0)}:${next.id}` : null,
    })
  }

  if (request.method === 'GET' && url.pathname === '/api/thoughts/by-tags') {
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? '50'), 1), 200)
    const cursor = parseCursor(url.searchParams.get('cursor'))

    const tags = parseTagsParam(url.searchParams.get('tags'))
    if (tags.length === 0) return err(400, 'tags is required')

    const thoughts = await listThoughtsByTagNames(env, { uid: auth.uid, tags, limit, cursor })
    const tagMap = await getTagsForThoughtIds(
      env,
      thoughts.map((t) => t.id),
    )

    const next = thoughts.length > 0 ? thoughts[thoughts.length - 1] : undefined

    return json({
      thoughts: thoughts.map((t) => ({ ...t, tags: tagMap.get(t.id) ?? [] })),
      next_cursor: next ? `${next.created_at}:${next.id}` : null,
    })
  }

  return err(404, 'Not found')
}

async function processTaggingJob(env: Env, jobId: number): Promise<void> {
  const job = await getAnalysisJobById(env, jobId)
  if (job.step !== 'tagging') return
  if (job.status === 'done') return

  await markJobProcessing(env, jobId)
  await incrementJobAttempts(env, jobId)

  const thought = await getThoughtById(env, job.uid, job.thought_id)
  if (thought.deleted_at) {
    await markJobDone(env, jobId, JSON.stringify({ skipped: 'thought_deleted' }))
    return
  }

  const existingTags = await listRecentUserTagNames(env, job.uid, 200)
  const currentTags = await getThoughtTags(env, thought.id)

  const system = buildTaggerSystemPrompt()
  const user = buildTaggerUserPrompt({ thought: thought.body, existingTags, currentTags })

  const model = (env.AI_TAGGER_MODEL || '@cf/openai/gpt-oss-20b') as keyof AiModels

  const aiOut = await env.AI.run(
    model,
    {
      input: [
        {
          role: 'system',
          content: [{ type: 'input_text', text: system }],
          type: 'message',
        },
        {
          role: 'user',
          content: [{ type: 'input_text', text: user }],
          type: 'message',
        },
      ],
      text: { format: { type: 'json_object' } },
      max_output_tokens: 300,
      temperature: 0.2,
    },
    { tags: ['brainiac:tagging'] },
  )

  const outputText = aiOut.output_text
  if (typeof outputText !== 'string') {
    throw new Error('AI did not return output_text')
  }

  let parsed: TaggingAiResult
  try {
    parsed = JSON.parse(outputText) as TaggingAiResult
  } catch {
    throw new Error('AI returned non-JSON output')
  }

  const { valid, invalid } = normalizeAndValidateTags(parsed.tags)

  await setThoughtTagsAiOnly(env, { uid: job.uid, thoughtId: thought.id, tagNames: valid })

  const resultJson = JSON.stringify({
    model: env.AI_TAGGER_MODEL,
    tags: valid,
    invalid_tags_dropped: invalid,
    raw: parsed,
  })

  await markJobDone(env, jobId, resultJson)
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    if (url.pathname.startsWith('/api/')) {
      return handleApi(request, env)
    }

    return new Response(null, { status: 404 })
  },

  async queue(batch, env, ctx) {
    for (const message of batch.messages) {
      const body = message.body as AnalysisQueueMessage

      if (!body || typeof body.jobId !== 'number') {
        message.ack()
        continue
      }

      try {
        await processTaggingJob(env, body.jobId)
        message.ack()
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        // Persist error info; let the queue retry.
        try {
          await markJobError(env, body.jobId, msg, 0)
        } catch {
          // ignore
        }
        message.retry({ delaySeconds: 30 })
      }
    }

    ctx.waitUntil(Promise.resolve())
  },
} satisfies ExportedHandler<Env, AnalysisQueueMessage>
