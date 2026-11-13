// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { localDayStarts, localMonthDayStarts } from './calendarDates'

describe('Central Time calendar boundaries', () => {
  beforeEach(() => {
    vi.stubEnv('TZ', 'America/Chicago')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('places November 11 at 11:08 p.m. inside the November 11 calendar cell and day view', () => {
    const starts = localMonthDayStarts('2026-11')
    const note = Date.parse('2026-11-11T23:08:00-06:00') / 1000

    expect(starts).toHaveLength(31)
    expect(starts.slice(10, 12)).toEqual(localDayStarts('2026-11-11'))
    expect(note).toBeGreaterThanOrEqual(starts[10])
    expect(note).toBeLessThan(starts[11])
  })

  it.each([
    ['2026-03-08', 23],
    ['2026-11-01', 25],
  ])('uses the real length of %s across the clock change', (day, hours) => {
    const [start, end] = localDayStarts(day)
    expect(end - start).toBe(hours * 3600)
  })
})
