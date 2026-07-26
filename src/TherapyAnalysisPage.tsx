import { useEffect, useMemo, useState } from 'react'

import { apiFetch } from './api'
import { RangeCalendar, nextRangeSelection } from './RangeCalendar'
import { renderSimpleMarkdown } from './simpleMarkdown'
import {
  currentMonthKey,
  inclusiveDayCount,
  monthKeyFromDateKey,
  previousThursdayThroughToday,
  tzOffsetMinutesForLocalDateKey,
  tzOffsetMinutesForLocalMonthKey,
} from './therapyDates'

type PreviewMeta = {
  thought_count: number
  included_count?: number
  truncated: boolean
  tag_counts: Array<{ name: string; count: number }>
  mood_by_day: Array<{ date: string; avg: number | null; count: number }>
  mood_avg: number | null
}

type Phase = 'range' | 'running' | 'done' | 'error'

type TherapyAnalysisPageProps = {
  getIdToken: () => Promise<string | null>
  onBack: () => void
}

export function TherapyAnalysisPage(props: TherapyAnalysisPageProps) {
  const { getIdToken, onBack } = props

  const defaults = useMemo(() => previousThursdayThroughToday(), [])
  const [rangeStart, setRangeStart] = useState<string | null>(defaults.from)
  const [rangeEnd, setRangeEnd] = useState<string | null>(defaults.to)
  const [month, setMonth] = useState(() => monthKeyFromDateKey(defaults.to))
  const [dayCounts, setDayCounts] = useState<Record<string, number>>({})
  const [dayAvgMood, setDayAvgMood] = useState<Record<string, number | null>>({})
  const [phase, setPhase] = useState<Phase>('range')
  const [preview, setPreview] = useState<PreviewMeta | null>(null)
  const [previewBusy, setPreviewBusy] = useState(false)
  const [thinking, setThinking] = useState('')
  const [content, setContent] = useState('')
  const [reportId, setReportId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [streamMeta, setStreamMeta] = useState<PreviewMeta | null>(null)
  const [statusNote, setStatusNote] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const tz = String(tzOffsetMinutesForLocalMonthKey(month))
        const params = new URLSearchParams({ month, tz_offset_min: tz })
        const data = await apiFetch<{
          counts: Record<string, number>
          avg_mood?: Record<string, number | null>
        }>({
          path: `/api/thoughts/day-counts?${params}`,
          getIdToken,
        })
        if (!cancelled) {
          setDayCounts(data.counts)
          setDayAvgMood(data.avg_mood ?? {})
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [month, getIdToken])

  useEffect(() => {
    if (!rangeStart || !rangeEnd) {
      setPreview(null)
      return
    }

    let cancelled = false
    setPreviewBusy(true)
    void (async () => {
      try {
        const tz = tzOffsetMinutesForLocalDateKey(rangeStart)
        const params = new URLSearchParams({
          from: rangeStart,
          to: rangeEnd,
          tz_offset_min: String(tz),
        })
        const data = await apiFetch<PreviewMeta & { from: string; to: string }>({
          path: `/api/therapy-reports/preview?${params}`,
          getIdToken,
        })
        if (!cancelled) setPreview(data)
      } catch (e) {
        if (!cancelled) {
          setPreview(null)
          setError(e instanceof Error ? e.message : String(e))
        }
      } finally {
        if (!cancelled) setPreviewBusy(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [rangeStart, rangeEnd, getIdToken])

  function changeMonth(delta: number) {
    const m = month.match(/^(\d{4})-(\d{2})$/)
    const y = m ? Number(m[1]) : new Date().getFullYear()
    const mm = m ? Number(m[2]) - 1 : new Date().getMonth()
    const next = new Date(y, mm + delta, 1)
    setMonth(currentMonthKey(next))
  }

  function onSelectDate(date: string) {
    const next = nextRangeSelection(rangeStart, rangeEnd, date)
    setRangeStart(next.start)
    setRangeEnd(next.end)
    setError(null)
  }

  async function onGenerate() {
    if (!rangeStart || !rangeEnd) return
    setPhase('running')
    setThinking('')
    setContent('')
    setError(null)
    setReportId(null)
    setStatusNote('Connecting to model…')
    console.info('[therapy.ui] generate start', { from: rangeStart, to: rangeEnd })

    const token = await getIdToken()
    if (!token) {
      setError('Not authenticated')
      setPhase('error')
      return
    }

    const tz = tzOffsetMinutesForLocalDateKey(rangeStart)

    try {
      const res = await fetch('/api/therapy-reports/stream', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ from: rangeStart, to: rangeEnd, tz_offset_min: tz }),
      })

      if (!res.ok || !res.body) {
        let msg = `${res.status} ${res.statusText}`
        try {
          const j: unknown = await res.json()
          if (typeof j === 'object' && j !== null && 'error' in j) {
            msg = String((j as { error?: unknown }).error)
          }
        } catch {
          // ignore
        }
        throw new Error(msg)
      }

      console.info('[therapy.ui] stream response', {
        status: res.status,
        contentType: res.headers.get('content-type'),
      })

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let thinkingAcc = ''
      let contentAcc = ''
      let finished = false
      let eventCount = 0

      const handleEvent = (event: string, dataRaw: string) => {
        eventCount += 1
        let data: unknown = null
        try {
          data = JSON.parse(dataRaw) as unknown
        } catch {
          console.warn('[therapy.ui] bad SSE data', { event, dataRaw: dataRaw.slice(0, 200) })
          return
        }

        if (event === 'meta' && data && typeof data === 'object') {
          console.info('[therapy.ui] meta', data)
          setStreamMeta(data as PreviewMeta)
          if ('id' in data && typeof (data as { id?: unknown }).id === 'number') {
            setReportId((data as { id: number }).id)
          }
          setStatusNote('Model running…')
          return
        }

        if (event === 'status' && data && typeof data === 'object') {
          const d = data as { phase?: string; thinking_chars?: number; content_chars?: number; deltas?: number }
          console.info('[therapy.ui] status', d)
          if (d.phase === 'streaming') {
            setStatusNote(
              `Streaming… thinking ${d.thinking_chars ?? 0} chars · report ${d.content_chars ?? 0} chars`,
            )
          } else if (d.phase === 'model_running') {
            setStatusNote('Waiting on model tokens…')
          }
          return
        }

        if (event === 'thinking' && data && typeof data === 'object' && 'text' in data) {
          thinkingAcc += String((data as { text: unknown }).text ?? '')
          setThinking(thinkingAcc)
          return
        }

        if (event === 'content' && data && typeof data === 'object' && 'text' in data) {
          contentAcc += String((data as { text: unknown }).text ?? '')
          setContent(contentAcc)
          return
        }

        if (event === 'done') {
          finished = true
          console.info('[therapy.ui] done', data)
          setStatusNote('Complete')
          setPhase('done')
          return
        }

        if (event === 'error') {
          finished = true
          const msg =
            data && typeof data === 'object' && 'error' in data
              ? String((data as { error?: unknown }).error)
              : 'Stream failed'
          console.error('[therapy.ui] error event', msg)
          setError(msg)
          setStatusNote(null)
          setPhase('error')
        }
      }

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        const blocks = buffer.split('\n\n')
        buffer = blocks.pop() ?? ''
        for (const block of blocks) {
          const lines = block.split('\n')
          let event = 'message'
          const dataLines: string[] = []
          for (const line of lines) {
            if (line.startsWith('event:')) event = line.slice(6).trim()
            else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
          }
          if (dataLines.length) handleEvent(event, dataLines.join('\n'))
        }
      }

      if (!finished) {
        console.warn('[therapy.ui] stream ended without done', {
          eventCount,
          thinkingChars: thinkingAcc.length,
          contentChars: contentAcc.length,
        })
        if (contentAcc.trim() || thinkingAcc.trim()) {
          setPhase('done')
          setStatusNote('Complete')
        } else {
          setError((prev) => prev ?? 'Stream ended without a report')
          setPhase('error')
          setStatusNote(null)
        }
      }
    } catch (e) {
      console.error('[therapy.ui] generate failed', e)
      setError(e instanceof Error ? e.message : String(e))
      setPhase('error')
      setStatusNote(null)
    }
  }

  const meta = streamMeta ?? preview
  const canGenerate = Boolean(rangeStart && rangeEnd && (preview?.thought_count ?? 0) > 0 && phase === 'range')

  const moodStrip = (meta?.mood_by_day ?? []).filter((d) => d.avg != null)

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 px-4 py-4" aria-label="Therapy analysis">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-400/30 pb-3">
        <div>
          <div className="text-[0.65rem] uppercase tracking-[0.25em] text-amber-300/80">Analysis</div>
          <h1 className="text-lg text-amber-100">Therapy prep report</h1>
        </div>
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to thoughts"
          className="rounded border border-amber-400/50 bg-black/60 px-3 py-1.5 text-[0.7rem] uppercase tracking-[0.18em] text-amber-200 hover:border-amber-300 hover:bg-amber-500/10"
        >
          Back
        </button>
      </div>

      {phase === 'range' ? (
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_240px]">
          <div className="space-y-3">
            <p className="text-xs text-amber-200/80">
              Select a date range (click start, then end). Default is previous Thursday through today.
            </p>
            <RangeCalendar
              month={month}
              rangeStart={rangeStart}
              rangeEnd={rangeEnd}
              countsByDay={dayCounts}
              avgMoodByDay={dayAvgMood}
              onChangeMonth={changeMonth}
              onSelectDate={onSelectDate}
            />
            <div className="flex flex-wrap items-center gap-2 text-xs text-amber-200/90">
              <span className="rounded border border-amber-400/40 bg-amber-500/10 px-2 py-1">
                From: {rangeStart ?? '—'}
              </span>
              <span className="rounded border border-amber-400/40 bg-amber-500/10 px-2 py-1">
                To: {rangeEnd ?? 'pick end'}
              </span>
            </div>
          </div>

          <div className="space-y-3 rounded-lg border border-amber-400/25 bg-black/50 p-3 text-xs">
            <div className="text-[0.65rem] uppercase tracking-[0.2em] text-amber-300/80">Preview</div>
            {previewBusy ? <div className="text-amber-200/70">Loading…</div> : null}
            {preview ? (
              <>
                <div className="text-amber-100">
                  <span className="text-lg font-semibold text-amber-200">
                    {inclusiveDayCount(rangeStart!, rangeEnd!)} days, {preview.thought_count} thoughts
                  </span>
                  {preview.truncated ? (
                    <span className="ml-2 text-amber-300/70">(will truncate for model)</span>
                  ) : null}
                </div>
                {preview.mood_avg != null ? (
                  <div className="text-amber-200/80">Avg mood: {preview.mood_avg.toFixed(1)} / 5</div>
                ) : (
                  <div className="text-amber-200/50">No mood scores in range</div>
                )}
                <div className="flex flex-wrap gap-1">
                  {preview.tag_counts.slice(0, 12).map((t) => (
                    <span
                      key={t.name}
                      className="rounded border border-amber-400/40 bg-amber-500/10 px-1.5 py-0.5 text-[0.65rem] text-amber-100"
                      style={{ opacity: Math.min(1, 0.45 + t.count / 10) }}
                    >
                      {t.name} · {t.count}
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <div className="text-amber-200/50">Select a full range to preview.</div>
            )}

            <button
              type="button"
              disabled={!canGenerate}
              onClick={() => void onGenerate()}
              className="w-full rounded border border-amber-400/80 bg-amber-500/20 px-3 py-2 text-[0.7rem] uppercase tracking-[0.2em] text-amber-100 shadow-[0_0_20px_rgba(245,158,11,0.5)] hover:bg-amber-500/30 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Generate report
            </button>
          </div>
        </div>
      ) : null}

      {phase === 'running' || phase === 'done' || phase === 'error' ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3 text-xs text-amber-200/90">
            <span className="rounded border border-amber-400/40 bg-amber-500/10 px-2 py-1">
              {rangeStart} → {rangeEnd}
            </span>
            {meta ? (
              <span className="rounded border border-cyan-400/40 bg-cyan-500/10 px-2 py-1 text-cyan-100">
                {meta.thought_count} thoughts
              </span>
            ) : null}
            {reportId != null ? <span className="text-amber-300/70">report #{reportId}</span> : null}
            {phase === 'running' ? (
              <span className="animate-pulse text-amber-300">{statusNote ?? 'Analyzing…'}</span>
            ) : null}
          </div>

          {moodStrip.length > 0 ? (
            <div className="space-y-1">
              <div className="text-[0.65rem] uppercase tracking-[0.2em] text-amber-300/70">Mood over range</div>
              <div className="flex h-10 items-end gap-0.5 rounded border border-amber-400/20 bg-black/40 p-1">
                {moodStrip.map((d) => {
                  const avg = d.avg ?? 3
                  const h = `${Math.max(12, (avg / 5) * 100)}%`
                  const color =
                    avg <= 2.25 ? 'bg-red-400/80' : avg >= 3.75 ? 'bg-emerald-400/80' : 'bg-amber-400/80'
                  return (
                    <div
                      key={d.date}
                      title={`${d.date}: ${avg.toFixed(1)}`}
                      className={`min-w-[4px] flex-1 rounded-sm ${color}`}
                      style={{ height: h }}
                    />
                  )
                })}
              </div>
            </div>
          ) : null}

          {meta && meta.tag_counts.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {meta.tag_counts.slice(0, 20).map((t) => (
                <span
                  key={t.name}
                  className="rounded border border-amber-400/40 bg-amber-500/10 px-1.5 py-0.5 text-[0.65rem] text-amber-100"
                >
                  {t.name}
                </span>
              ))}
            </div>
          ) : null}

          <div className="flex flex-col gap-3">
            {content ? (
              <div className="flex flex-col rounded-lg border border-amber-400/40 bg-black/60 shadow-[0_0_24px_rgba(250,204,21,0.12)]">
                <div className="border-b border-amber-400/20 px-3 py-2 text-[0.65rem] uppercase tracking-[0.2em] text-amber-300/70">
                  Report
                </div>
                <div
                  className="p-3"
                  dangerouslySetInnerHTML={{ __html: renderSimpleMarkdown(content) }}
                />
              </div>
            ) : null}

            <div className="flex flex-col rounded-lg border border-amber-400/25 bg-black/60">
              <div className="border-b border-amber-400/20 px-3 py-2 text-[0.65rem] uppercase tracking-[0.2em] text-amber-300/70">
                Thinking
              </div>
              <pre className="whitespace-pre-wrap p-3 font-mono text-[0.7rem] leading-relaxed text-amber-200/75">
                {thinking || (phase === 'running' ? '…' : '(none)')}
              </pre>
            </div>
          </div>

          {phase === 'error' && error ? <div className="error">Error: {error}</div> : null}

          {phase === 'done' || phase === 'error' ? (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setPhase('range')
                  setThinking('')
                  setContent('')
                  setStreamMeta(null)
                  setError(null)
                }}
                className="rounded border border-amber-400/50 bg-black/50 px-3 py-1.5 text-[0.7rem] uppercase tracking-[0.18em] text-amber-200 hover:bg-amber-500/10"
              >
                New range
              </button>
              <button
                type="button"
                onClick={onBack}
                className="rounded border border-amber-400/80 bg-amber-500/20 px-3 py-1.5 text-[0.7rem] uppercase tracking-[0.18em] text-amber-100 hover:bg-amber-500/30"
              >
                Done
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {phase === 'range' && error ? <div className="error">Error: {error}</div> : null}
    </main>
  )
}
