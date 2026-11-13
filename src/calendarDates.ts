export function currentMonthKey(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

// Include the next midnight so that each local day has its own UTC range.
export function localDayStarts(date: string, dayCount = 1): number[] {
  const [year, month, day] = date.split('-').map(Number)
  return Array.from({ length: dayCount + 1 }, (_, i) =>
    new Date(year, month - 1, day + i).getTime() / 1000,
  )
}

export function localMonthDayStarts(month: string): number[] {
  const [year, monthNumber] = month.split('-').map(Number)
  const dayCount = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()
  return localDayStarts(`${month}-01`, dayCount)
}
