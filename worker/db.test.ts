// @vitest-environment node

import { describe, expect, it, vi } from 'vitest'

import { getAnalysisJobStatusSummariesForThoughtIds } from './db'

describe('db', () => {
  it('getAnalysisJobStatusSummariesForThoughtIds returns empty map and does not query when ids are empty', async () => {
    const prepare = vi.fn()
    const env = {
      DB: { prepare } as unknown as D1Database,
    } as unknown as Env

    const out = await getAnalysisJobStatusSummariesForThoughtIds(env, 'u1', [])
    expect(out.size).toBe(0)
    expect(prepare).not.toHaveBeenCalled()
  })

  it('getAnalysisJobStatusSummariesForThoughtIds scopes by uid and binds uid first', async () => {
    const all = vi.fn(async () => ({
      results: [
        {
          thought_id: 10,
          total: 2,
          queued: 1,
          processing: 0,
          done: 1,
          error: 0,
          last_updated_at: 123,
        },
      ],
    }))

    const bind = vi.fn(() => ({ all }))
    const prepare = vi.fn((sql: string) => ({ bind, sql }))

    const env = {
      DB: { prepare } as unknown as D1Database,
    } as unknown as Env

    const out = await getAnalysisJobStatusSummariesForThoughtIds(env, 'u1', [10, 20, 30])

    expect(prepare).toHaveBeenCalledTimes(1)

    const sql = String((prepare.mock.calls[0] ?? [])[0])
    expect(sql).toContain('WHERE uid = ?')
    expect(sql).toContain('thought_id IN (?,?,?)')

    expect(bind).toHaveBeenCalledWith('u1', 10, 20, 30)

    expect(out.get(10)).toMatchObject({
      thought_id: 10,
      total: 2,
      queued: 1,
      processing: 0,
      done: 1,
      error: 0,
      last_updated_at: 123,
    })

    expect(out.has(20)).toBe(false)
  })

  it('getAnalysisJobStatusSummariesForThoughtIds returns a map keyed by thought_id', async () => {
    const all = vi.fn(async () => ({
      results: [
        {
          thought_id: 1,
          total: 1,
          queued: 0,
          processing: 0,
          done: 1,
          error: 0,
          last_updated_at: 5,
        },
        {
          thought_id: 2,
          total: 3,
          queued: 2,
          processing: 1,
          done: 0,
          error: 0,
          last_updated_at: 9,
        },
      ],
    }))

    const bind = vi.fn(() => ({ all }))
    const prepare = vi.fn(() => ({ bind }))

    const env = {
      DB: { prepare } as unknown as D1Database,
    } as unknown as Env

    const out = await getAnalysisJobStatusSummariesForThoughtIds(env, 'u1', [1, 2])

    expect(out.size).toBe(2)
    expect(out.get(1)?.done).toBe(1)
    expect(out.get(2)?.processing).toBe(1)
  })
})
