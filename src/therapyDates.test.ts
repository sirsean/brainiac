import { describe, expect, it } from 'vitest'

import { previousThursdayThroughToday, formatLocalDateKey, inclusiveDayCount } from './therapyDates'
import { nextRangeSelection } from './RangeCalendar'

describe('previousThursdayThroughToday', () => {
  it('uses prior Thursday when today is Thursday', () => {
    // 2026-07-23 is a Thursday
    const { from, to } = previousThursdayThroughToday(new Date(2026, 6, 23, 12, 0, 0))
    expect(to).toBe('2026-07-23')
    expect(from).toBe('2026-07-16')
  })

  it('uses most recent past Thursday mid-week', () => {
    // 2026-07-26 is a Sunday
    const { from, to } = previousThursdayThroughToday(new Date(2026, 6, 26, 12, 0, 0))
    expect(to).toBe('2026-07-26')
    expect(from).toBe('2026-07-23')
  })

  it('formats local dates stably', () => {
    expect(formatLocalDateKey(new Date(2026, 0, 5))).toBe('2026-01-05')
  })

  it('counts inclusive days in a range', () => {
    expect(inclusiveDayCount('2026-07-16', '2026-07-23')).toBe(8)
    expect(inclusiveDayCount('2026-07-23', '2026-07-23')).toBe(1)
    expect(inclusiveDayCount('2026-07-23', '2026-07-16')).toBe(8)
  })
})

describe('nextRangeSelection', () => {
  it('starts a range, then completes it, then restarts', () => {
    expect(nextRangeSelection(null, null, '2026-07-10')).toEqual({ start: '2026-07-10', end: null })
    expect(nextRangeSelection('2026-07-10', null, '2026-07-12')).toEqual({
      start: '2026-07-10',
      end: '2026-07-12',
    })
    expect(nextRangeSelection('2026-07-12', null, '2026-07-10')).toEqual({
      start: '2026-07-10',
      end: '2026-07-12',
    })
    expect(nextRangeSelection('2026-07-10', '2026-07-12', '2026-07-20')).toEqual({
      start: '2026-07-20',
      end: null,
    })
  })
})
