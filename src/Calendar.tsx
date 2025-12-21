type CalendarProps = {
  month: string // YYYY-MM
  selectedDate: string | null // YYYY-MM-DD
  countsByDay: Record<string, number>
  avgMoodByDay?: Record<string, number | null>
  onChangeMonth: (deltaMonths: number) => void
  onSelectDate: (date: string) => void
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function formatLocalDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function monthLabel(month: string): string {
  const m = month.match(/^(\d{4})-(\d{2})$/)
  if (!m) return month
  const y = Number(m[1])
  const mm = Number(m[2])
  const d = new Date(y, mm - 1, 1)
  return d.toLocaleString(undefined, { month: 'long', year: 'numeric' })
}

export function Calendar(props: CalendarProps) {
  const { month, selectedDate, countsByDay, avgMoodByDay, onChangeMonth, onSelectDate } = props

  const m = month.match(/^(\d{4})-(\d{2})$/)
  const year = m ? Number(m[1]) : new Date().getFullYear()
  const monthIndex = m ? Number(m[2]) - 1 : new Date().getMonth()

  const firstOfMonth = new Date(year, monthIndex, 1)
  const firstDow = firstOfMonth.getDay() // 0=Sun
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate()

  // Build a 6-week grid.
  const cells: Array<{ date: string | null; dayNum: number | null }> = []
  for (let i = 0; i < 42; i += 1) {
    const dayNum = i - firstDow + 1
    if (dayNum < 1 || dayNum > daysInMonth) {
      cells.push({ date: null, dayNum: null })
      continue
    }

    const date = formatLocalDate(new Date(year, monthIndex, dayNum))
    cells.push({ date, dayNum })
  }

  return (
    <div className="w-full rounded-lg border border-amber-400/30 bg-black/60 p-2 text-amber-100 shadow-[0_0_24px_rgba(250,204,21,0.12)]">
      <div className="mb-2 grid grid-cols-[1.5rem_1fr_1.5rem] items-center gap-1 text-xs text-amber-200/80">
        <button
          type="button"
          onClick={() => onChangeMonth(-1)}
          aria-label="previous month"
          className="inline-flex h-6 w-6 items-center justify-center rounded border border-amber-400/40 bg-black/60 text-amber-200 hover:border-amber-300/70 hover:bg-amber-500/10"
        >
          ‹
        </button>
        <div className="text-center text-[0.7rem] font-medium uppercase tracking-[0.18em] text-amber-300/80">
          {monthLabel(month)}
        </div>
        <button
          type="button"
          onClick={() => onChangeMonth(1)}
          aria-label="next month"
          className="inline-flex h-6 w-6 items-center justify-center rounded border border-amber-400/40 bg-black/60 text-amber-200 hover:border-amber-300/70 hover:bg-amber-500/10"
        >
          ›
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, idx) => (
          <div key={`${d}-${idx}`} className="pb-1 text-center text-[0.6rem] text-amber-300/70">
            {d}
          </div>
        ))}

        {cells.map((c, idx) => {
          if (!c.date || !c.dayNum) {
            return <div key={idx} className="min-h-[2.25rem] rounded-md border border-transparent" />
          }

          const count = countsByDay[c.date] ?? 0
          const isSelected = selectedDate === c.date
          const avgMood = avgMoodByDay?.[c.date] ?? null

          let variantClass: string
          if (isSelected) {
            variantClass =
              'border-amber-400/90 bg-amber-500/20 text-amber-50 shadow-[0_0_18px_rgba(245,158,11,0.7)]'
          } else if (avgMood != null) {
            if (avgMood <= 2.25) {
              variantClass = 'border-red-500/70 bg-red-500/20 text-red-50'
            } else if (avgMood >= 3.75) {
              variantClass = 'border-emerald-400/70 bg-emerald-500/15 text-emerald-50'
            } else {
              variantClass = 'border-amber-400/40 bg-amber-500/10 text-amber-100'
            }
          } else {
            variantClass =
              'border-amber-400/20 bg-black/40 text-amber-100 hover:border-amber-300/70 hover:bg-amber-500/10'
          }

          return (
            <button
              key={c.date}
              type="button"
              onClick={() => onSelectDate(c.date!)}
              className={
                'flex min-h-[2.25rem] flex-col items-center justify-start rounded-md border px-1 py-1 text-xs transition-colors ' +
                variantClass
              }
            >
              <span className="text-[0.7rem] leading-none">{c.dayNum}</span>
              <span
                className={
                  'mt-1 rounded-full border border-amber-400/80 px-1 text-[0.55rem] text-amber-100 min-w-[1.5rem] text-center ' +
                  (count > 0 ? '' : 'opacity-0')
                }
              >
                {count || 0}
              </span>
            </button>
          )
        })}
      </div>

      {selectedDate ? (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => onSelectDate('')}
            className="w-full rounded border border-amber-400/40 bg-black/40 px-2 py-1 text-[0.65rem] uppercase tracking-[0.18em] text-amber-200 hover:border-amber-300/70 hover:bg-amber-500/10"
          >
            Clear date
          </button>
        </div>
      ) : null}
    </div>
  )
}
