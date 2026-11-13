function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

export function formatLocalDateKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

/**
 * Default therapy range: previous Thursday through today.
 * If today is Thursday, start is today − 7 days (the prior Thursday).
 */
export function previousThursdayThroughToday(now: Date = new Date()): { from: string; to: string } {
  const to = formatLocalDateKey(now)
  const dow = now.getDay() // 0=Sun … 4=Thu
  const daysSinceThursday = (dow + 7 - 4) % 7
  const daysBack = daysSinceThursday === 0 ? 7 : daysSinceThursday
  const fromDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysBack)
  return { from: formatLocalDateKey(fromDate), to }
}

export function parseLocalDateKey(date: string | null): { y: number; m: number; d: number } | null {
  if (!date) return null
  const m = date.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  const y = Number(m[1])
  const mm = Number(m[2])
  const d = Number(m[3])
  if (!Number.isFinite(y) || !Number.isFinite(mm) || !Number.isFinite(d)) return null
  return { y, m: mm, d }
}

export function tzOffsetMinutesForLocalDateKey(date: string | null): number {
  const parsed = parseLocalDateKey(date)
  if (!parsed) return new Date().getTimezoneOffset()
  const d = new Date(parsed.y, parsed.m - 1, parsed.d, 0, 0, 0)
  return d.getTimezoneOffset()
}

export function monthKeyFromDateKey(date: string): string {
  return date.slice(0, 7)
}

/** Start a new range or complete the current one, swapping reversed dates. */
export function nextRangeSelection(
  prevStart: string | null,
  prevEnd: string | null,
  clicked: string,
): { start: string; end: string | null } {
  if (!prevStart || prevEnd) {
    return { start: clicked, end: null }
  }
  if (clicked < prevStart) {
    return { start: clicked, end: prevStart }
  }
  return { start: prevStart, end: clicked }
}

/** Inclusive day count between two YYYY-MM-DD local keys (order-independent). */
export function inclusiveDayCount(from: string, to: string): number {
  const a = parseLocalDateKey(from)
  const b = parseLocalDateKey(to)
  if (!a || !b) return 0
  const start = Date.UTC(a.y, a.m - 1, a.d)
  const end = Date.UTC(b.y, b.m - 1, b.d)
  const diff = Math.abs(end - start)
  return Math.floor(diff / (24 * 60 * 60 * 1000)) + 1
}
