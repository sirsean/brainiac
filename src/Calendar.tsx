type CalendarProps = {
  month: string // YYYY-MM
  selectedDate: string | null // YYYY-MM-DD
  countsByDay: Record<string, number>
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
  const { month, selectedDate, countsByDay, onChangeMonth, onSelectDate } = props

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
    <div className='calendar'>
      <div className='calendarHeader'>
        <button type='button' onClick={() => onChangeMonth(-1)} aria-label='previous month'>
          ‹
        </button>
        <div className='calendarTitle'>{monthLabel(month)}</div>
        <button type='button' onClick={() => onChangeMonth(1)} aria-label='next month'>
          ›
        </button>
      </div>

      <div className='calendarGrid'>
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, idx) => (
          <div key={`${d}-${idx}`} className='calendarDow'>
            {d}
          </div>
        ))}

        {cells.map((c, idx) => {
          if (!c.date || !c.dayNum) {
            return <div key={idx} className='calendarCell empty' />
          }

          const count = countsByDay[c.date] ?? 0
          const isSelected = selectedDate === c.date
          const className = isSelected ? 'calendarCell day selected' : 'calendarCell day'

          return (
            <button key={c.date} type='button' className={className} onClick={() => onSelectDate(c.date)}>
              <span className='calendarDayNum'>{c.dayNum}</span>
              {count > 0 ? <span className='calendarCount'>{count}</span> : null}
            </button>
          )
        })}
      </div>

      {selectedDate ? (
        <div className='calendarFooter'>
          <button type='button' onClick={() => onSelectDate('')}>
            Clear date
          </button>
        </div>
      ) : null}
    </div>
  )
}
