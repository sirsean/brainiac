import type { AuthContext } from './auth'

export type ThoughtRow = {
  id: number
  uid: string
  body: string
  created_at: number
  updated_at: number | null
  deleted_at: number | null
  status: string
  error: string | null
}

export type TagRow = {
  id: number
  uid: string
  name: string
  created_at: number
  last_used_at: number | null
}

export type AnalysisJobRow = {
  id: number
  thought_id: number
  uid: string
  step: string
  status: string
  attempts: number
  created_at: number
  updated_at: number
  error: string | null
  error_stack: string | null
  error_details_json: string | null
  result_json: string | null
}

export async function ensureUser(env: Env, auth: AuthContext) {
  await env.DB.prepare(
    `INSERT INTO users(uid, email, display_name, photo_url, last_seen_at)
     VALUES (?, ?, ?, ?, unixepoch())
     ON CONFLICT(uid) DO UPDATE SET
       email = excluded.email,
       display_name = excluded.display_name,
       photo_url = excluded.photo_url,
       last_seen_at = unixepoch()`
  )
    .bind(auth.uid, auth.email ?? null, auth.name ?? null, auth.picture ?? null)
    .run()
}

export async function createThought(env: Env, uid: string, body: string): Promise<ThoughtRow> {
  const res = await env.DB.prepare(
    `INSERT INTO thoughts(uid, body, created_at)
     VALUES (?, ?, unixepoch())`
  )
    .bind(uid, body)
    .run()

  const id = Number(res.meta.last_row_id)
  return await getThoughtById(env, uid, id)
}

export async function updateThoughtBody(env: Env, uid: string, id: number, body: string): Promise<ThoughtRow> {
  await env.DB.prepare(
    `UPDATE thoughts
     SET body = ?, updated_at = unixepoch(), error = NULL
     WHERE id = ? AND uid = ? AND deleted_at IS NULL`
  )
    .bind(body, id, uid)
    .run()

  return await getThoughtById(env, uid, id)
}

export async function softDeleteThought(env: Env, uid: string, id: number): Promise<void> {
  await env.DB.prepare(
    `UPDATE thoughts
     SET deleted_at = unixepoch()
     WHERE id = ? AND uid = ? AND deleted_at IS NULL`
  )
    .bind(id, uid)
    .run()
}

export async function getThoughtById(env: Env, uid: string, id: number): Promise<ThoughtRow> {
  const { results } = await env.DB.prepare(
    `SELECT id, uid, body, created_at, updated_at, deleted_at, status, error
     FROM thoughts
     WHERE id = ? AND uid = ?`
  )
    .bind(id, uid)
    .all<ThoughtRow>()

  const row = results[0]
  if (!row) throw new Error('Thought not found')
  return row
}

export async function listThoughts(env: Env, opts: {
  uid: string
  limit: number
  cursor?: { createdAt: number; id: number }
}): Promise<ThoughtRow[]> {
  const { uid, limit, cursor } = opts

  if (!cursor) {
    const { results } = await env.DB.prepare(
      `SELECT id, uid, body, created_at, updated_at, deleted_at, status, error
       FROM thoughts
       WHERE uid = ? AND deleted_at IS NULL
       ORDER BY created_at DESC, id DESC
       LIMIT ?`
    )
      .bind(uid, limit)
      .all<ThoughtRow>()
    return results
  }

  const { results } = await env.DB.prepare(
    `SELECT id, uid, body, created_at, updated_at, deleted_at, status, error
     FROM thoughts
     WHERE uid = ?
       AND deleted_at IS NULL
       AND (created_at < ? OR (created_at = ? AND id < ?))
     ORDER BY created_at DESC, id DESC
     LIMIT ?`
  )
    .bind(uid, cursor.createdAt, cursor.createdAt, cursor.id, limit)
    .all<ThoughtRow>()

  return results
}

export async function getThoughtTags(env: Env, thoughtId: number): Promise<string[]> {
  const { results } = await env.DB.prepare(
    `SELECT t.name AS name
     FROM thought_tags tt
     JOIN tags t ON t.id = tt.tag_id
     WHERE tt.thought_id = ?
     ORDER BY t.name ASC`
  )
    .bind(thoughtId)
    .all<{ name: string }>()

  return results.map((r) => r.name)
}

export async function getTagsForThoughtIds(env: Env, thoughtIds: number[]): Promise<Map<number, string[]>> {
  const out = new Map<number, string[]>()
  for (const id of thoughtIds) out.set(id, [])
  if (thoughtIds.length === 0) return out

  const placeholders = thoughtIds.map(() => '?').join(',')
  const { results } = await env.DB.prepare(
    `SELECT tt.thought_id AS thought_id, t.name AS name
     FROM thought_tags tt
     JOIN tags t ON t.id = tt.tag_id
     WHERE tt.thought_id IN (${placeholders})
     ORDER BY tt.thought_id ASC, t.name ASC`
  )
    .bind(...thoughtIds)
    .all<{ thought_id: number; name: string }>()

  for (const row of results) {
    const arr = out.get(row.thought_id)
    if (!arr) continue
    arr.push(row.name)
  }

  return out
}

export type TagWithStatsRow = TagRow & {
  thought_count: number
  most_recent_thought_at: number | null
}

export async function listUserTagsWithStats(env: Env, opts: {
  uid: string
  limit: number
  cursor?: { lastUsedAt: number; id: number }
}): Promise<TagWithStatsRow[]> {
  const { uid, limit, cursor } = opts

  const baseSelect =
    `SELECT
      t.id, t.uid, t.name, t.created_at, t.last_used_at,
      COUNT(th.id) AS thought_count,
      MAX(th.created_at) AS most_recent_thought_at
     FROM tags t
     LEFT JOIN thought_tags tt ON tt.tag_id = t.id
     LEFT JOIN thoughts th ON th.id = tt.thought_id AND th.deleted_at IS NULL
     WHERE t.uid = ?`

  const baseGroupOrder =
    `GROUP BY t.id
     ORDER BY COALESCE(t.last_used_at, 0) DESC, t.id DESC
     LIMIT ?`

  if (!cursor) {
    const { results } = await env.DB.prepare(`${baseSelect}\n${baseGroupOrder}`)
      .bind(uid, limit)
      .all<TagWithStatsRow>()
    return results
  }

  const { results } = await env.DB.prepare(
    `${baseSelect}
     AND (
       COALESCE(t.last_used_at, 0) < ?
       OR (COALESCE(t.last_used_at, 0) = ? AND t.id < ?)
     )
     ${baseGroupOrder}`
  )
    .bind(uid, cursor.lastUsedAt, cursor.lastUsedAt, cursor.id, limit)
    .all<TagWithStatsRow>()

  return results
}

export async function listThoughtsByTagNames(env: Env, opts: {
  uid: string
  tags: string[]
  limit: number
  cursor?: { createdAt: number; id: number }
}): Promise<ThoughtRow[]> {
  const { uid, tags, limit, cursor } = opts

  if (tags.length === 0) return []

  const tagPlaceholders = tags.map(() => '?').join(',')
  const havingCount = tags.length

  const cursorClause = cursor
    ? 'AND (th.created_at < ? OR (th.created_at = ? AND th.id < ?))'
    : ''

  const sql =
    `SELECT th.id, th.uid, th.body, th.created_at, th.updated_at, th.deleted_at, th.status, th.error
     FROM thoughts th
     JOIN thought_tags tt ON tt.thought_id = th.id
     JOIN tags tg ON tg.id = tt.tag_id
     WHERE th.uid = ?
       AND th.deleted_at IS NULL
       AND tg.uid = ?
       AND tg.name IN (${tagPlaceholders})
       ${cursorClause}
     GROUP BY th.id
     HAVING COUNT(DISTINCT tg.name) = ?
     ORDER BY th.created_at DESC, th.id DESC
     LIMIT ?`

  const bindings: unknown[] = [uid, uid, ...tags]
  if (cursor) bindings.push(cursor.createdAt, cursor.createdAt, cursor.id)
  bindings.push(havingCount, limit)

  const { results } = await env.DB.prepare(sql).bind(...bindings).all<ThoughtRow>()
  return results
}

export async function createAnalysisJob(env: Env, opts: {
  uid: string
  thoughtId: number
  step: string
}): Promise<AnalysisJobRow> {
  const res = await env.DB.prepare(
    `INSERT INTO analysis_jobs(thought_id, uid, step, status, attempts, created_at, updated_at)
     VALUES (?, ?, ?, 'queued', 0, unixepoch(), unixepoch())`
  )
    .bind(opts.thoughtId, opts.uid, opts.step)
    .run()

  const id = Number(res.meta.last_row_id)
  return await getAnalysisJobById(env, id)
}

export async function getAnalysisJobById(env: Env, id: number): Promise<AnalysisJobRow> {
  const { results } = await env.DB.prepare(
    `SELECT id, thought_id, uid, step, status, attempts, created_at, updated_at,
            error, error_stack, error_details_json, result_json
     FROM analysis_jobs
     WHERE id = ?`
  )
    .bind(id)
    .all<AnalysisJobRow>()

  const row = results[0]
  if (!row) throw new Error('Analysis job not found')
  return row
}

export async function markJobProcessing(env: Env, id: number): Promise<void> {
  await env.DB.prepare(
    `UPDATE analysis_jobs
     SET status = 'processing', updated_at = unixepoch()
     WHERE id = ? AND status != 'done'`
  )
    .bind(id)
    .run()
}

export async function markJobDone(env: Env, id: number, resultJson: string): Promise<void> {
  await env.DB.prepare(
    `UPDATE analysis_jobs
     SET status = 'done', updated_at = unixepoch(), error = NULL, result_json = ?
     WHERE id = ?`
  )
    .bind(resultJson, id)
    .run()
}

export async function markJobError(
  env: Env,
  id: number,
  error: {
    message: string
    stack?: string | null
    detailsJson?: string | null
  },
  attemptsDelta = 1,
): Promise<void> {
  await env.DB.prepare(
    `UPDATE analysis_jobs
     SET status = 'error', updated_at = unixepoch(),
         error = ?,
         error_stack = ?,
         error_details_json = ?,
         attempts = attempts + ?,
         result_json = COALESCE(result_json, '')
     WHERE id = ?`
  )
    .bind(error.message, error.stack ?? null, error.detailsJson ?? null, attemptsDelta, id)
    .run()
}

export async function incrementJobAttempts(env: Env, id: number): Promise<void> {
  await env.DB.prepare(
    `UPDATE analysis_jobs
     SET attempts = attempts + 1, updated_at = unixepoch()
     WHERE id = ?`
  )
    .bind(id)
    .run()
}

export async function upsertTags(env: Env, uid: string, tagNames: string[]): Promise<Map<string, number>> {
  // Insert any missing tags.
  for (const name of tagNames) {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO tags(uid, name, created_at)
       VALUES (?, ?, unixepoch())`
    )
      .bind(uid, name)
      .run()
  }

  // Fetch ids for all tags.
  const placeholders = tagNames.map(() => '?').join(',')
  const { results } = await env.DB.prepare(
    `SELECT id, name
     FROM tags
     WHERE uid = ? AND name IN (${placeholders})`
  )
    .bind(uid, ...tagNames)
    .all<{ id: number; name: string }>()

  const map = new Map<string, number>()
  for (const r of results) map.set(r.name, r.id)
  return map
}

export async function setThoughtTagsAiOnly(env: Env, opts: {
  uid: string
  thoughtId: number
  tagNames: string[]
}): Promise<void> {
  const { uid, thoughtId, tagNames } = opts

  const current = await getThoughtTags(env, thoughtId)
  const next = new Set(tagNames)

  const toRemove = current.filter((t) => !next.has(t))
  const toAdd = tagNames.filter((t) => !current.includes(t))

  if (toAdd.length > 0) {
    const ids = await upsertTags(env, uid, toAdd)

    for (const name of toAdd) {
      const tagId = ids.get(name)
      if (!tagId) continue

      await env.DB.prepare(
        `INSERT OR IGNORE INTO thought_tags(thought_id, tag_id, created_at)
         VALUES (?, ?, unixepoch())`
      )
        .bind(thoughtId, tagId)
        .run()

      await env.DB.prepare(
        `UPDATE tags
         SET last_used_at = unixepoch()
         WHERE id = ?`
      )
        .bind(tagId)
        .run()
    }
  }

  if (toRemove.length > 0) {
    const placeholders = toRemove.map(() => '?').join(',')

    // Delete links for removed tags.
    await env.DB.prepare(
      `DELETE FROM thought_tags
       WHERE thought_id = ?
         AND tag_id IN (
           SELECT id FROM tags WHERE uid = ? AND name IN (${placeholders})
         )`
    )
      .bind(thoughtId, uid, ...toRemove)
      .run()
  }
}

export async function listRecentUserTagNames(env: Env, uid: string, limit: number): Promise<string[]> {
  const { results } = await env.DB.prepare(
    `SELECT name
     FROM tags
     WHERE uid = ?
     ORDER BY COALESCE(last_used_at, 0) DESC, id DESC
     LIMIT ?`
  )
    .bind(uid, limit)
    .all<{ name: string }>()

  return results.map((r) => r.name)
}
