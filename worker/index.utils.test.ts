// @vitest-environment node

import { describe, expect, it } from 'vitest'

import type { AnalysisJobStatusSummaryRow } from './db'
import {
  parseIdsParam,
  summarizeJobs,
  parseTzOffsetMinutesParam,
  utcRangeForLocalDay,
  utcRangeForLocalMonth,
} from './index'

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

describe('parseTzOffsetMinutesParam', () => {
  it('returns 0 for null/invalid inputs', () => {
    expect(parseTzOffsetMinutesParam(null)).toBe(0)
    expect(parseTzOffsetMinutesParam('')).toBe(0)
    expect(parseTzOffsetMinutesParam('foo')).toBe(0)
    expect(parseTzOffsetMinutesParam('3.14')).toBe(0)
  })

  it('parses integer minute offsets and clamps to [-14h, +14h]', () => {
    expect(parseTzOffsetMinutesParam('0')).toBe(0)
    expect(parseTzOffsetMinutesParam('480')).toBe(480)
    expect(parseTzOffsetMinutesParam('-300')).toBe(-300)

    // Above +14h and below -14h are clamped.
    expect(parseTzOffsetMinutesParam('9000')).toBe(14 * 60)
    expect(parseTzOffsetMinutesParam('-9000')).toBe(-14 * 60)
  })
})

describe('utcRangeForLocalDay and utcRangeForLocalMonth', () => {
  it('computes a 24h UTC range for a given local day and offset', () => {
    const base = Date.UTC(2024, 0, 15, 0, 0, 0)

    // UTC timezone.
    const { start: startUtc, endExclusive: endUtc } = utcRangeForLocalDay({
      y: 2024,
      m: 1,
      d: 15,
      tzOffsetMinutes: 0,
    })
    expect(startUtc).toBe(Math.floor(base / 1000))
    expect(endUtc - startUtc).toBe(24 * 60 * 60)

    // PST-style offset (+480 minutes = UTC-8).
    const { start: startPst } = utcRangeForLocalDay({
      y: 2024,
      m: 1,
      d: 15,
      tzOffsetMinutes: 480,
    })
    expect(startPst).toBe(Math.floor((base + 480 * 60 * 1000) / 1000))

    // UTC+2-style offset (-120 minutes).
    const { start: startUtcPlus2 } = utcRangeForLocalDay({
      y: 2024,
      m: 1,
      d: 15,
      tzOffsetMinutes: -120,
    })
    expect(startUtcPlus2).toBe(Math.floor((base - 120 * 60 * 1000) / 1000))
  })

  it('computes a month-long UTC range for a given local month and offset', () => {
    const janStart = Date.UTC(2024, 0, 1, 0, 0, 0)
    const febStart = Date.UTC(2024, 1, 1, 0, 0, 0)

    const { start: startUtc, endExclusive: endUtc } = utcRangeForLocalMonth({
      y: 2024,
      m: 1,
      tzOffsetMinutes: 0,
    })
    expect(startUtc).toBe(Math.floor(janStart / 1000))
    expect(endUtc).toBe(Math.floor(febStart / 1000))

    const { start: startWithOffset, endExclusive: endWithOffset } = utcRangeForLocalMonth({
      y: 2024,
      m: 1,
      tzOffsetMinutes: 180,
    })
    expect(startWithOffset).toBe(Math.floor((janStart + 180 * 60 * 1000) / 1000))
    expect(endWithOffset).toBe(Math.floor((febStart + 180 * 60 * 1000) / 1000))
  })
})
