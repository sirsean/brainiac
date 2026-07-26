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
  listThoughtsInCreatedAtRange,
  listThoughtCountsByLocalDay,
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
  getAnalysisJobStatusSummariesForThoughtIds,
  upsertThoughtMood,
  getThoughtMoodByThoughtId,
  getThoughtMoodsForThoughtIds,
  createTherapyReport,
  getTherapyReportById,
  listTherapyReports,
  markTherapyReportDone,
  markTherapyReportError,
  updateTherapyReportProgress,
  type AnalysisJobRow,
  type AnalysisJobStatusSummaryRow,
} from './db'
import {
  DEFAULT_AI_MODEL,
  DEFAULT_THERAPY_AI_MODEL,
  extractAiOutputText,
  parseJsonObjectFromAiText,
  runWorkersAi,
  runWorkersAiStream,
} from './ai'
import {
  buildTaggerSystemPrompt,
  buildTaggerUserPrompt,
  normalizeAndValidateTags,
  type TaggingAiResult,
} from './tagger'
import { buildMoodSystemPrompt, buildMoodUserPrompt, type MoodAiResult } from './mood'
import {
  buildTherapyPreviewMeta,
  packTherapyThoughts,
  type TherapyThoughtInput,
} from './therapyReport'

// NOTE: The API exposes timestamps as Unix epoch seconds in UTC (matching the DB schema).
// The frontend is responsible for converting these numeric seconds to local time for display.

type ApiErrorBody = {
  error: string
}

type AnalysisQueueMessage = {
  jobId: number
}

type ThoughtAnalysisSummary = {
  status: 'queued' | 'processing' | 'done' | 'error'
  total: number
  queued: number
  processing: number
  done: number
  error: number
  last_updated_at: number
}

export function summarizeJobs(row: AnalysisJobStatusSummaryRow | undefined): ThoughtAnalysisSummary | null {
  if (!row || row.total <= 0) return null

  let status: ThoughtAnalysisSummary['status'] = 'done'
  if (row.error > 0) status = 'error'
  else if (row.processing > 0) status = 'processing'
  else if (row.queued > 0) status = 'queued'
  else if (row.done >= row.total) status = 'done'

  return {
    status,
    total: row.total,
    queued: row.queued,
    processing: row.processing,
    done: row.done,
    error: row.error,
    last_updated_at: row.last_updated_at,
  }
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

export function parseTzOffsetMinutesParam(raw: string | null): number {
  const n = Number(raw ?? '0')
  if (!Number.isFinite(n) || !Number.isInteger(n)) return 0
  // Typical JS timezone offsets are within [-14h, +14h].
  return Math.max(-14 * 60, Math.min(14 * 60, n))
}

function parseIsoDateParam(raw: string | null): { y: number; m: number; d: number; iso: string } | undefined {
  if (!raw) return undefined
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return undefined
  const y = Number(m[1])
  const mm = Number(m[2])
  const d = Number(m[3])
  if (!Number.isFinite(y) || !Number.isFinite(mm) || !Number.isFinite(d)) return undefined
  if (mm < 1 || mm > 12) return undefined
  if (d < 1 || d > 31) return undefined
  return { y, m: mm, d, iso: raw }
}

function parseIsoMonthParam(raw: string | null): { y: number; m: number; iso: string } | undefined {
  if (!raw) return undefined
  const m = raw.match(/^(\d{4})-(\d{2})$/)
  if (!m) return undefined
  const y = Number(m[1])
  const mm = Number(m[2])
  if (!Number.isFinite(y) || !Number.isFinite(mm)) return undefined
  if (mm < 1 || mm > 12) return undefined
  return { y, m: mm, iso: raw }
}

export function utcRangeForLocalDay(opts: { y: number; m: number; d: number; tzOffsetMinutes: number }): {
  start: number
  endExclusive: number
} {
  const { y, m, d, tzOffsetMinutes } = opts
  // Local midnight converted to UTC: UTC = local + offset.
  const startMs = Date.UTC(y, m - 1, d, 0, 0, 0) + tzOffsetMinutes * 60 * 1000
  const start = Math.floor(startMs / 1000)
  return { start, endExclusive: start + 24 * 60 * 60 }
}

export function utcRangeForLocalMonth(opts: { y: number; m: number; tzOffsetMinutes: number }): {
  start: number
  endExclusive: number
} {
  const { y, m, tzOffsetMinutes } = opts
  const startMs = Date.UTC(y, m - 1, 1, 0, 0, 0) + tzOffsetMinutes * 60 * 1000
  const endMs = Date.UTC(y, m, 1, 0, 0, 0) + tzOffsetMinutes * 60 * 1000
  return { start: Math.floor(startMs / 1000), endExclusive: Math.floor(endMs / 1000) }
}

export function utcRangeForLocalDateSpan(opts: {
  from: { y: number; m: number; d: number }
  to: { y: number; m: number; d: number }
  tzOffsetMinutes: number
}): { start: number; endExclusive: number } {
  const start = utcRangeForLocalDay({ ...opts.from, tzOffsetMinutes: opts.tzOffsetMinutes }).start
  const endExclusive = utcRangeForLocalDay({ ...opts.to, tzOffsetMinutes: opts.tzOffsetMinutes }).endExclusive
  return { start, endExclusive }
}

export function localDateKeyFromUtcSeconds(utcSeconds: number, tzOffsetMinutes: number): string {
  // Invert the same offset convention as utcRangeForLocalDay (UTC = local + offset).
  const localMs = utcSeconds * 1000 - tzOffsetMinutes * 60 * 1000
  const d = new Date(localMs)
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function sseEncode(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

async function loadTherapyThoughtsForRange(
  env: Env,
  uid: string,
  from: { y: number; m: number; d: number; iso: string },
  to: { y: number; m: number; d: number; iso: string },
  tzOffsetMinutes: number,
): Promise<TherapyThoughtInput[]> {
  const range = utcRangeForLocalDateSpan({
    from: { y: from.y, m: from.m, d: from.d },
    to: { y: to.y, m: to.m, d: to.d },
    tzOffsetMinutes,
  })

  if (range.endExclusive <= range.start) {
    throw new Error('Invalid date range')
  }

  // Fetch newest-first with a high limit, then reverse to chronological for prompting.
  const rows = await listThoughtsInCreatedAtRange(env, {
    uid,
    startCreatedAt: range.start,
    endCreatedAtExclusive: range.endExclusive,
    limit: 500,
  })

  const chronological = [...rows].reverse()
  const ids = chronological.map((t) => t.id)
  const [tagMap, moodMap] = await Promise.all([
    getTagsForThoughtIds(env, ids),
    getThoughtMoodsForThoughtIds(env, uid, ids),
  ])

  return chronological.map((t) => {
    const moodRow = moodMap.get(t.id)
    return {
      id: t.id,
      created_at: t.created_at,
      body: t.body,
      tags: tagMap.get(t.id) ?? [],
      mood: moodRow
        ? { score: moodRow.mood_score, explanation: moodRow.explanation }
        : null,
      localDate: localDateKeyFromUtcSeconds(t.created_at, tzOffsetMinutes),
    }
  })
}

export function parseIdsParam(ids: string | null): number[] {
  if (!ids) return []
  const out: number[] = []
  for (const part of ids.split(',')) {
    const trimmed = part.trim()
    if (!trimmed) continue
    const n = Number(trimmed)
    if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) continue
    out.push(n)
  }
  return out
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

  if (request.method === 'GET' && url.pathname === '/api/thoughts/analysis-status') {
    const ids = parseIdsParam(url.searchParams.get('ids'))
    if (ids.length === 0) return json({ summaries: {} })
    if (ids.length > 200) return err(400, 'Too many ids (max 200)')

    const map = await getAnalysisJobStatusSummariesForThoughtIds(env, auth.uid, ids)

    const summaries: Record<number, ThoughtAnalysisSummary | null> = {}
    for (const id of ids) {
      summaries[id] = summarizeJobs(map.get(id))
    }

    return json({ summaries })
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
    const taggingJob = await createAnalysisJob(env, { uid: auth.uid, thoughtId: thought.id, step: 'tagging' })
    const moodJob = await createAnalysisJob(env, { uid: auth.uid, thoughtId: thought.id, step: 'mood' })

    await env.ANALYSIS_QUEUE.send({ jobId: taggingJob.id } satisfies AnalysisQueueMessage)
    await env.ANALYSIS_QUEUE.send({ jobId: moodJob.id } satisfies AnalysisQueueMessage)

    const lastUpdatedAt = Math.max(taggingJob.updated_at, moodJob.updated_at)

    return json({
      thought: {
        ...thought,
        tags: [] as string[],
        mood: null,
        analysis: {
          status: 'queued',
          total: 2,
          queued: 2,
          processing: 0,
          done: 0,
          error: 0,
          last_updated_at: lastUpdatedAt,
        } satisfies ThoughtAnalysisSummary,
      },
      job: { id: taggingJob.id, step: taggingJob.step, status: taggingJob.status },
      next_cursor: `${thought.created_at}:${thought.id}`,
    })
  }

  const thoughtIdMatch = url.pathname.match(/^\/api\/thoughts\/(\d+)$/)
  if (thoughtIdMatch && request.method === 'GET') {
    const id = Number(thoughtIdMatch[1])

    const thought = await getThoughtById(env, auth.uid, id)
    if (thought.deleted_at) return err(404, 'Thought not found')

    const [tags, jobSummaryMap, moodRow] = await Promise.all([
      getThoughtTags(env, thought.id),
      getAnalysisJobStatusSummariesForThoughtIds(env, auth.uid, [thought.id]),
      getThoughtMoodByThoughtId(env, auth.uid, thought.id),
    ])

    return json({
      thought: {
        ...thought,
        tags,
        mood: moodRow
          ? { score: moodRow.mood_score, explanation: moodRow.explanation, model: moodRow.model }
          : null,
        analysis: summarizeJobs(jobSummaryMap.get(thought.id)),
      },
    })
  }

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
    const taggingJob = await createAnalysisJob(env, { uid: auth.uid, thoughtId: thought.id, step: 'tagging' })
    const moodJob = await createAnalysisJob(env, { uid: auth.uid, thoughtId: thought.id, step: 'mood' })

    await env.ANALYSIS_QUEUE.send({ jobId: taggingJob.id } satisfies AnalysisQueueMessage)
    await env.ANALYSIS_QUEUE.send({ jobId: moodJob.id } satisfies AnalysisQueueMessage)

    const tags = await getThoughtTags(env, thought.id)
    const lastUpdatedAt = Math.max(taggingJob.updated_at, moodJob.updated_at)

    return json({
      thought: {
        ...thought,
        tags,
        mood: null,
        analysis: {
          status: 'queued',
          total: 2,
          queued: 2,
          processing: 0,
          done: 0,
          error: 0,
          last_updated_at: lastUpdatedAt,
        } satisfies ThoughtAnalysisSummary,
      },
      job: { id: taggingJob.id, step: taggingJob.step, status: taggingJob.status },
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

    const thoughtIds = thoughts.map((t) => t.id)
    const [tagMap, jobSummaryMap, moodMap] = await Promise.all([
      getTagsForThoughtIds(env, thoughtIds),
      getAnalysisJobStatusSummariesForThoughtIds(env, auth.uid, thoughtIds),
      getThoughtMoodsForThoughtIds(env, auth.uid, thoughtIds),
    ])

    const next = thoughts.length > 0 ? thoughts[thoughts.length - 1] : undefined

    return json({
      thoughts: thoughts.map((t) => {
        const moodRow = moodMap.get(t.id)
        return {
          ...t,
          tags: tagMap.get(t.id) ?? [],
          mood: moodRow
            ? { score: moodRow.mood_score, explanation: moodRow.explanation, model: moodRow.model }
            : null,
          analysis: summarizeJobs(jobSummaryMap.get(t.id)),
        }
      }),
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

    const thoughtIds = thoughts.map((t) => t.id)
    const [tagMap, jobSummaryMap, moodMap] = await Promise.all([
      getTagsForThoughtIds(env, thoughtIds),
      getAnalysisJobStatusSummariesForThoughtIds(env, auth.uid, thoughtIds),
      getThoughtMoodsForThoughtIds(env, auth.uid, thoughtIds),
    ])

    const next = thoughts.length > 0 ? thoughts[thoughts.length - 1] : undefined

    return json({
      thoughts: thoughts.map((t) => {
        const moodRow = moodMap.get(t.id)
        return {
          ...t,
          tags: tagMap.get(t.id) ?? [],
          mood: moodRow
            ? { score: moodRow.mood_score, explanation: moodRow.explanation, model: moodRow.model }
            : null,
          analysis: summarizeJobs(jobSummaryMap.get(t.id)),
        }
      }),
      next_cursor: next ? `${next.created_at}:${next.id}` : null,
    })
  }

  // List thoughts for a specific local day (optionally filtered by tags).
  if (request.method === 'GET' && url.pathname === '/api/thoughts/by-day') {
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? '200'), 1), 200)
    const cursor = parseCursor(url.searchParams.get('cursor'))

    const date = parseIsoDateParam(url.searchParams.get('date'))
    if (!date) return err(400, 'date is required (YYYY-MM-DD)')

    const tzOffsetMinutes = parseTzOffsetMinutesParam(url.searchParams.get('tz_offset_min'))
    const tags = parseTagsParam(url.searchParams.get('tags'))

    const range = utcRangeForLocalDay({ y: date.y, m: date.m, d: date.d, tzOffsetMinutes })

    const thoughts = await listThoughtsInCreatedAtRange(env, {
      uid: auth.uid,
      startCreatedAt: range.start,
      endCreatedAtExclusive: range.endExclusive,
      limit,
      cursor,
      tags: tags.length > 0 ? tags : undefined,
    })

    const thoughtIds = thoughts.map((t) => t.id)
    const [tagMap, jobSummaryMap, moodMap] = await Promise.all([
      getTagsForThoughtIds(env, thoughtIds),
      getAnalysisJobStatusSummariesForThoughtIds(env, auth.uid, thoughtIds),
      getThoughtMoodsForThoughtIds(env, auth.uid, thoughtIds),
    ])

    const next = thoughts.length > 0 ? thoughts[thoughts.length - 1] : undefined

    return json({
      thoughts: thoughts.map((t) => {
        const moodRow = moodMap.get(t.id)
        return {
          ...t,
          tags: tagMap.get(t.id) ?? [],
          mood: moodRow
            ? { score: moodRow.mood_score, explanation: moodRow.explanation, model: moodRow.model }
            : null,
          analysis: summarizeJobs(jobSummaryMap.get(t.id)),
        }
      }),
      next_cursor: next ? `${next.created_at}:${next.id}` : null,
    })
  }

  // Calendar helper: counts of thoughts per local day in a given month (optionally filtered by tags).
  if (request.method === 'GET' && url.pathname === '/api/thoughts/day-counts') {
    const month = parseIsoMonthParam(url.searchParams.get('month'))
    if (!month) return err(400, 'month is required (YYYY-MM)')

    const tzOffsetMinutes = parseTzOffsetMinutesParam(url.searchParams.get('tz_offset_min'))
    const tzOffsetSeconds = tzOffsetMinutes * 60
    const tags = parseTagsParam(url.searchParams.get('tags'))

    const range = utcRangeForLocalMonth({ y: month.y, m: month.m, tzOffsetMinutes })

    const rows = await listThoughtCountsByLocalDay(env, {
      uid: auth.uid,
      startCreatedAt: range.start,
      endCreatedAtExclusive: range.endExclusive,
      tzOffsetSeconds,
      tags: tags.length > 0 ? tags : undefined,
    })

    const counts: Record<string, number> = {}
    const avgMood: Record<string, number | null> = {}
    for (const r of rows) {
      counts[r.day] = Number(r.count)
      avgMood[r.day] = r.avg_mood_score == null ? null : Number(r.avg_mood_score)
    }

    return json({ counts, avg_mood: avgMood })
  }

  // Therapy prep: preview stats for a local date range (no AI).
  if (request.method === 'GET' && url.pathname === '/api/therapy-reports/preview') {
    const from = parseIsoDateParam(url.searchParams.get('from'))
    const to = parseIsoDateParam(url.searchParams.get('to'))
    if (!from || !to) return err(400, 'from and to are required (YYYY-MM-DD)')
    if (from.iso > to.iso) return err(400, 'from must be on or before to')

    const tzOffsetMinutes = parseTzOffsetMinutesParam(url.searchParams.get('tz_offset_min'))

    let thoughts: TherapyThoughtInput[]
    try {
      thoughts = await loadTherapyThoughtsForRange(env, auth.uid, from, to, tzOffsetMinutes)
    } catch (e) {
      return err(400, e instanceof Error ? e.message : 'Invalid range')
    }

    const pack = packTherapyThoughts({ from: from.iso, to: to.iso, thoughtsAsc: thoughts })
    const meta = buildTherapyPreviewMeta(thoughts)
    meta.truncated = pack.truncated
    meta.thought_ids = pack.includedThoughtIds
    meta.thought_count = thoughts.length

    return json({
      from: from.iso,
      to: to.iso,
      tz_offset_min: tzOffsetMinutes,
      ...meta,
      included_count: pack.thoughtCount,
    })
  }

  // Therapy prep: list recent reports (for later history UI).
  if (request.method === 'GET' && url.pathname === '/api/therapy-reports') {
    const limitRaw = Number(url.searchParams.get('limit') ?? '20')
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(50, Math.floor(limitRaw))) : 20
    const reports = await listTherapyReports(env, auth.uid, limit)
    return json({
      reports: reports.map((r) => ({
        id: r.id,
        start_date: r.start_date,
        end_date: r.end_date,
        thought_count: r.thought_count,
        model: r.model,
        status: r.status,
        created_at: r.created_at,
        updated_at: r.updated_at,
        error: r.error,
      })),
    })
  }

  const therapyReportMatch = url.pathname.match(/^\/api\/therapy-reports\/(\d+)$/)
  if (therapyReportMatch && request.method === 'GET') {
    const id = Number(therapyReportMatch[1])
    try {
      const report = await getTherapyReportById(env, auth.uid, id)
      return json({ report })
    } catch {
      return err(404, 'Therapy report not found')
    }
  }

  // Therapy prep: stream Kimi thinking + report over SSE, persist when done.
  if (request.method === 'POST' && url.pathname === '/api/therapy-reports/stream') {
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return err(400, 'Invalid JSON')
    }

    const fromRaw =
      typeof body === 'object' && body !== null && 'from' in body
        ? String((body as { from?: unknown }).from ?? '')
        : ''
    const toRaw =
      typeof body === 'object' && body !== null && 'to' in body
        ? String((body as { to?: unknown }).to ?? '')
        : ''
    const from = parseIsoDateParam(fromRaw)
    const to = parseIsoDateParam(toRaw)
    if (!from || !to) return err(400, 'from and to are required (YYYY-MM-DD)')
    if (from.iso > to.iso) return err(400, 'from must be on or before to')

    const tzOffsetMinutes = parseTzOffsetMinutesParam(
      typeof body === 'object' && body !== null && 'tz_offset_min' in body
        ? String((body as { tz_offset_min?: unknown }).tz_offset_min ?? '0')
        : '0',
    )

    let thoughts: TherapyThoughtInput[]
    try {
      thoughts = await loadTherapyThoughtsForRange(env, auth.uid, from, to, tzOffsetMinutes)
    } catch (e) {
      return err(400, e instanceof Error ? e.message : 'Invalid range')
    }

    if (thoughts.length === 0) {
      return err(400, 'No thoughts in the selected date range')
    }

    const pack = packTherapyThoughts({ from: from.iso, to: to.iso, thoughtsAsc: thoughts })
    const meta = buildTherapyPreviewMeta(thoughts)
    meta.truncated = pack.truncated
    meta.thought_ids = pack.includedThoughtIds

    const model =
      env.AI_THERAPY_MODEL || env.AI_TAGGER_MODEL || DEFAULT_THERAPY_AI_MODEL

    const report = await createTherapyReport(env, {
      uid: auth.uid,
      startDate: from.iso,
      endDate: to.iso,
      tzOffsetMin: tzOffsetMinutes,
      thoughtCount: thoughts.length,
      model,
      metaJson: JSON.stringify(meta),
    })

    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>()
    const writer = writable.getWriter()
    const encoder = new TextEncoder()

    const writeEvent = async (event: string, data: unknown) => {
      await writer.write(encoder.encode(sseEncode(event, data)))
    }

    void (async () => {
      let thinkingText = ''
      let reportMarkdown = ''
      let lastPersist = 0
      let deltaCount = 0

      try {
        console.log('[therapy.stream] start', {
          reportId: report.id,
          model,
          thoughtCount: thoughts.length,
          included: pack.thoughtCount,
          truncated: pack.truncated,
          from: from.iso,
          to: to.iso,
        })

        await writeEvent('meta', {
          id: report.id,
          from: from.iso,
          to: to.iso,
          model,
          ...meta,
          included_count: pack.thoughtCount,
        })
        await writeEvent('status', { phase: 'model_running' })

        for await (const delta of runWorkersAiStream(env, model, [
          { role: 'system', content: pack.system },
          { role: 'user', content: pack.user },
        ])) {
          deltaCount += 1
          if (delta.type === 'reasoning') {
            thinkingText += delta.text
            await writeEvent('thinking', { text: delta.text })
          } else {
            reportMarkdown += delta.text
            await writeEvent('content', { text: delta.text })
          }

          const now = Date.now()
          if (now - lastPersist > 2500) {
            lastPersist = now
            await updateTherapyReportProgress(env, {
              uid: auth.uid,
              id: report.id,
              thinkingText,
              reportMarkdown,
            })
            await writeEvent('status', {
              phase: 'streaming',
              thinking_chars: thinkingText.length,
              content_chars: reportMarkdown.length,
              deltas: deltaCount,
            })
          }
        }

        console.log('[therapy.stream] model finished', {
          reportId: report.id,
          deltaCount,
          thinkingChars: thinkingText.length,
          contentChars: reportMarkdown.length,
        })

        if (!reportMarkdown.trim() && thinkingText.trim()) {
          // Some models park the answer in reasoning; keep what we have.
          reportMarkdown = thinkingText
        }

        if (!reportMarkdown.trim() && !thinkingText.trim()) {
          throw new Error(
            `Model stream completed with no usable text (deltas=${deltaCount}). Check [ai.stream] logs for chunk parsing.`,
          )
        }

        await markTherapyReportDone(env, {
          uid: auth.uid,
          id: report.id,
          thinkingText,
          reportMarkdown,
        })
        await writeEvent('done', {
          id: report.id,
          thinking_chars: thinkingText.length,
          content_chars: reportMarkdown.length,
          deltas: deltaCount,
        })
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        console.error('[therapy.stream] failed', {
          reportId: report.id,
          message,
          deltaCount,
          thinkingChars: thinkingText.length,
          contentChars: reportMarkdown.length,
        })
        try {
          await markTherapyReportError(env, {
            uid: auth.uid,
            id: report.id,
            error: message,
            thinkingText,
            reportMarkdown,
          })
        } catch {
          // ignore
        }
        try {
          await writeEvent('error', { error: message, id: report.id })
        } catch {
          // ignore
        }
      } finally {
        try {
          await writer.close()
        } catch {
          // ignore
        }
      }
    })()

    return new Response(readable, {
      status: 200,
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store, no-cache',
        connection: 'keep-alive',
      },
    })
  }

  return err(404, 'Not found')
}

async function processTaggingJob(env: Env, job: AnalysisJobRow): Promise<void> {
  if (job.step !== 'tagging') return
  if (job.status === 'done') return

  await markJobProcessing(env, job.id)
  await incrementJobAttempts(env, job.id)

  const thought = await getThoughtById(env, job.uid, job.thought_id)
  if (thought.deleted_at) {
    await markJobDone(env, job.id, JSON.stringify({ skipped: 'thought_deleted' }))
    return
  }

  const existingTags = await listRecentUserTagNames(env, job.uid, 200)
  const currentTags = await getThoughtTags(env, thought.id)

  const system = buildTaggerSystemPrompt()
  const user = buildTaggerUserPrompt({ thought: thought.body, existingTags, currentTags })

  const model = env.AI_TAGGER_MODEL || DEFAULT_AI_MODEL

  const aiOut = await runWorkersAi(env, model, [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ])
  const outputText = extractAiOutputText(aiOut)
  const parsed = parseJsonObjectFromAiText(outputText) as TaggingAiResult

  const { valid, invalid } = normalizeAndValidateTags(parsed.tags)

  await setThoughtTagsAiOnly(env, { uid: job.uid, thoughtId: thought.id, tagNames: valid })

  const resultJson = JSON.stringify({
    model: env.AI_TAGGER_MODEL,
    tags: valid,
    invalid_tags_dropped: invalid,
    raw: parsed,
  })

  await markJobDone(env, job.id, resultJson)
}

async function processMoodJob(env: Env, job: AnalysisJobRow): Promise<void> {
  if (job.step !== 'mood') return
  if (job.status === 'done') return

  await markJobProcessing(env, job.id)
  await incrementJobAttempts(env, job.id)

  const thought = await getThoughtById(env, job.uid, job.thought_id)
  if (thought.deleted_at) {
    await markJobDone(env, job.id, JSON.stringify({ skipped: 'thought_deleted' }))
    return
  }

  const system = buildMoodSystemPrompt()
  const user = buildMoodUserPrompt({ thought: thought.body })

  const model = env.AI_MOOD_MODEL || env.AI_TAGGER_MODEL || DEFAULT_AI_MODEL

  const aiOut = await runWorkersAi(env, model, [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ])
  const outputText = extractAiOutputText(aiOut)
  const parsed = parseJsonObjectFromAiText(outputText) as MoodAiResult

  const score = Number(parsed.mood_score)
  if (!Number.isFinite(score) || !Number.isInteger(score) || score < 1 || score > 5) {
    throw new Error('AI returned invalid mood_score (expected integer 1-5)')
  }

  const explanation = typeof parsed.explanation === 'string' ? parsed.explanation.trim() : ''
  if (!explanation) {
    throw new Error('AI returned empty explanation')
  }

  await upsertThoughtMood(env, {
    uid: job.uid,
    thoughtId: thought.id,
    moodScore: score,
    explanation,
    model,
  })

  const resultJson = JSON.stringify({
    model,
    mood_score: score,
    explanation,
    raw: parsed,
  })

  await markJobDone(env, job.id, resultJson)
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
        const job = await getAnalysisJobById(env, body.jobId)

        if (job.step === 'tagging') {
          await processTaggingJob(env, job)
        } else if (job.step === 'mood') {
          await processMoodJob(env, job)
        } else {
          await markJobDone(env, job.id, JSON.stringify({ skipped: 'unknown_step', step: job.step }))
        }

        message.ack()
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e))
        const details = (err as { details?: unknown }).details

        const errorDetails = {
          name: err.name,
          message: err.message,
          stack: err.stack,
          details: details ?? null,
        }

        // Ensure failures show up in `npm run dev` logs.
        console.error('[analysis_jobs] job failed', {
          jobId: body.jobId,
          ...errorDetails,
        })

        // Persist error info; let the queue retry.
        try {
          await markJobError(
            env,
            body.jobId,
            {
              message: err.message,
              stack: err.stack,
              detailsJson: JSON.stringify(errorDetails),
            },
            0,
          )
        } catch {
          // ignore
        }

        message.retry({ delaySeconds: 30 })
      }
    }

    ctx.waitUntil(Promise.resolve())
  },
} satisfies ExportedHandler<Env, AnalysisQueueMessage>
