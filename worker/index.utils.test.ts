// @vitest-environment node

import { describe, expect, it } from 'vitest'

import type { AnalysisJobStatusSummaryRow } from './db'
import { parseIdsParam, summarizeJobs } from './index'

describe('summarizeJobs', () => {
  it('returns null when row is missing or total <= 0', () => {
    expect(summarizeJobs(undefined)).toBeNull()

    const row: AnalysisJobStatusSummaryRow = {
      thought_id: 1,
      total: 0,
      queued: 0,
      processing: 0,
      done: 0,
      error: 0,
      last_updated_at: 10,
    }
    expect(summarizeJobs(row)).toBeNull()
  })

  it('prioritizes error over all other statuses', () => {
    const row: AnalysisJobStatusSummaryRow = {
      thought_id: 1,
      total: 3,
      queued: 1,
      processing: 1,
      done: 0,
      error: 1,
      last_updated_at: 10,
    }

    expect(summarizeJobs(row)).toMatchObject({
      status: 'error',
      total: 3,
      queued: 1,
      processing: 1,
      done: 0,
      error: 1,
      last_updated_at: 10,
    })
  })

  it('prioritizes processing over queued and done', () => {
    const row: AnalysisJobStatusSummaryRow = {
      thought_id: 1,
      total: 3,
      queued: 2,
      processing: 1,
      done: 0,
      error: 0,
      last_updated_at: 11,
    }

    expect(summarizeJobs(row)?.status).toBe('processing')
  })

  it('returns queued when queued > 0 and not processing/error', () => {
    const row: AnalysisJobStatusSummaryRow = {
      thought_id: 1,
      total: 3,
      queued: 1,
      processing: 0,
      done: 2,
      error: 0,
      last_updated_at: 12,
    }

    expect(summarizeJobs(row)?.status).toBe('queued')
  })

  it('returns done when all jobs are complete', () => {
    const row: AnalysisJobStatusSummaryRow = {
      thought_id: 1,
      total: 2,
      queued: 0,
      processing: 0,
      done: 2,
      error: 0,
      last_updated_at: 13,
    }

    expect(summarizeJobs(row)).toMatchObject({
      status: 'done',
      total: 2,
      queued: 0,
      processing: 0,
      done: 2,
      error: 0,
      last_updated_at: 13,
    })
  })
})

describe('parseIdsParam', () => {
  it('returns [] when ids is null/empty', () => {
    expect(parseIdsParam(null)).toEqual([])
    expect(parseIdsParam('')).toEqual([])
    expect(parseIdsParam('  , ,  ')).toEqual([])
  })

  it('parses a comma-separated list of positive integer ids', () => {
    expect(parseIdsParam('1,2,3')).toEqual([1, 2, 3])
    expect(parseIdsParam(' 1, 2 , 3 ')).toEqual([1, 2, 3])
  })

  it('filters out invalid ids (non-integers, non-finite, <= 0)', () => {
    expect(parseIdsParam('1,foo,0,-5,3.14,2')).toEqual([1, 2])
  })

  it('does not deduplicate ids', () => {
    expect(parseIdsParam('1,1,2')).toEqual([1, 1, 2])
  })
})
