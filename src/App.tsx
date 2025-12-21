import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

import { apiFetch } from './api'
import { analysisLabel, type ThoughtAnalysisSummary } from './analysisLabel'
import { Calendar } from './Calendar'
import { useAuth } from './useAuth'

type ThoughtMood = {
  score: number
  explanation: string
  model: string | null
}

type Thought = {
  id: number
  uid: string
  body: string
  created_at: number
  updated_at: number | null
  deleted_at: number | null
  status: string
  error: string | null
  tags: string[]
  mood: ThoughtMood | null
  analysis: ThoughtAnalysisSummary | null
}

type TagStats = {
  id: number
  uid: string
  name: string
  created_at: number
  last_used_at: number | null
  thought_count: number
  most_recent_thought_at: number | null
}

function formatTs(ts: number | null | undefined): string {
  if (!ts) return ''
  return new Date(ts * 1000).toLocaleString()
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function currentMonthKey(): string {
  const d = new Date()
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`
}

function App() {
  const { loading, user, signIn, signOut, getIdToken } = useAuth()

  const [newThought, setNewThought] = useState('')
  const [thoughts, setThoughts] = useState<Thought[]>([])
  const [thoughtsCursor, setThoughtsCursor] = useState<string | null>(null)
  const [tags, setTags] = useState<TagStats[]>([])
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [selectedDate, setSelectedDate] = useState<string | null>(null) // YYYY-MM-DD (local)
  const [calendarMonth, setCalendarMonth] = useState<string>(() => currentMonthKey()) // YYYY-MM
  const [dayCounts, setDayCounts] = useState<Record<string, number>>({})
  const [dayAvgMood, setDayAvgMood] = useState<Record<string, number | null>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [navOpen, setNavOpen] = useState(false) // mounted
  const [navVisible, setNavVisible] = useState(false) // animated open/close

  const tagQuery = useMemo(() => selectedTags.join(','), [selectedTags])

  async function refreshTags() {
    const data = await apiFetch<{ tags: TagStats[] }>({
      path: '/api/tags?limit=200',
      getIdToken,
    })
    setTags(data.tags)
  }

  async function refreshThoughts(reset = true) {
    const params = new URLSearchParams()

    if (!reset && thoughtsCursor) {
      params.set('cursor', thoughtsCursor)
    }

    const tzOffsetMin = String(new Date().getTimezoneOffset())

    // If a date is selected, show that day's thoughts (optionally filtered by tags).
    if (selectedDate) {
      params.set('date', selectedDate)
      params.set('tz_offset_min', tzOffsetMin)
      params.set('limit', '200')

      if (selectedTags.length > 0) {
        params.set('tags', tagQuery)
      }

      const path = `/api/thoughts/by-day?${params.toString()}`
      const data = await apiFetch<{ thoughts: Thought[]; next_cursor: string | null }>({
        path,
        getIdToken,
      })

      if (reset) {
        setThoughts(data.thoughts)
      } else {
        setThoughts((prev) => [...prev, ...data.thoughts])
      }

      setThoughtsCursor(data.next_cursor)
      return
    }

    // Default (no date selected): keep the UI focused on the most recent few.
    params.set('limit', '5')

    if (selectedTags.length > 0) {
      params.set('tags', tagQuery)
      const path = `/api/thoughts/by-tags?${params.toString()}`
      const data = await apiFetch<{ thoughts: Thought[]; next_cursor: string | null }>({
        path,
        getIdToken,
      })

      if (reset) {
        setThoughts(data.thoughts)
      } else {
        setThoughts((prev) => [...prev, ...data.thoughts])
      }

      setThoughtsCursor(data.next_cursor)
      return
    }

    const path = `/api/thoughts?${params.toString()}`
    const data = await apiFetch<{ thoughts: Thought[]; next_cursor: string | null }>({
      path,
      getIdToken,
    })

    if (reset) {
      setThoughts(data.thoughts)
    } else {
      setThoughts((prev) => [...prev, ...data.thoughts])
    }

    setThoughtsCursor(data.next_cursor)
  }

  async function refreshDayCounts() {
    const tzOffsetMin = String(new Date().getTimezoneOffset())

    const params = new URLSearchParams()
    params.set('month', calendarMonth)
    params.set('tz_offset_min', tzOffsetMin)

    if (selectedTags.length > 0) {
      params.set('tags', tagQuery)
    }

    const path = `/api/thoughts/day-counts?${params.toString()}`
    const data = await apiFetch<{ counts: Record<string, number>; avg_mood?: Record<string, number | null> }>({
      path,
      getIdToken,
    })

    setDayCounts(data.counts)
    setDayAvgMood(data.avg_mood ?? {})
  }

  useEffect(() => {
    if (loading) return
    if (!user) return

    setError(null)
    setThoughtsCursor(null)

    void (async () => {
      try {
        await Promise.all([refreshTags(), refreshThoughts(true)])
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, user, tagQuery, selectedDate])

  useEffect(() => {
    if (loading) return
    if (!user) return

    void (async () => {
      try {
        await refreshDayCounts()
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, user, tagQuery, calendarMonth])

  const statusByThoughtIdRef = useRef<Record<number, ThoughtAnalysisSummary['status']>>({})
  const tagsByNameRef = useRef<Set<string>>(new Set())
  const tagsRefreshInFlightRef = useRef(false)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    tagsByNameRef.current = new Set(tags.map((t) => t.name))
  }, [tags])

  const pollIdsKey = useMemo(() => {
    const ids = thoughts
      .filter((t) => t.analysis && t.analysis.status !== 'done')
      .map((t) => t.id)
      .slice(0, 200)
    return ids.join(',')
  }, [thoughts])

  useEffect(() => {
    if (loading) return
    if (!user) return
    if (busy) return
    if (!pollIdsKey) return

    let stopped = false
    let inFlight = false

    async function refreshThoughtById(id: number): Promise<void> {
      try {
        const data = await apiFetch<{ thought: Thought }>({
          path: `/api/thoughts/${id}`,
          getIdToken,
        })

        if (!mountedRef.current) return

        setThoughts((prev) => prev.map((t) => (t.id === id ? data.thought : t)))

        // If the thought contains a tag we haven't loaded stats for yet, refresh tags.
        const hasUnknown = (data.thought.tags ?? []).some((name) => !tagsByNameRef.current.has(name))
        if (hasUnknown && !tagsRefreshInFlightRef.current) {
          tagsRefreshInFlightRef.current = true
          try {
            await refreshTags()
          } finally {
            tagsRefreshInFlightRef.current = false
          }
        }
      } catch {
        // ignore
      }
    }

    async function tick() {
      if (stopped) return
      if (inFlight) return
      inFlight = true
      try {
        const data = await apiFetch<{ summaries: Record<string, ThoughtAnalysisSummary | null> }>({
          path: `/api/thoughts/analysis-status?ids=${encodeURIComponent(pollIdsKey)}`,
          getIdToken,
        })

        if (stopped) return

        const idsToRefresh: number[] = []
        for (const [k, summary] of Object.entries(data.summaries)) {
          const id = Number(k)
          if (!Number.isFinite(id) || !summary) continue

          const prev = statusByThoughtIdRef.current[id]
          statusByThoughtIdRef.current[id] = summary.status

          if (prev && prev !== summary.status && (summary.status === 'done' || summary.status === 'error')) {
            idsToRefresh.push(id)
          }
        }

        setThoughts((prev) =>
          prev.map((t) => {
            const next = data.summaries[String(t.id)]
            return next === undefined ? t : { ...t, analysis: next }
          }),
        )

        for (const id of idsToRefresh) {
          await refreshThoughtById(id)
        }

        // When jobs finish (including the mood step), refresh the calendar so
        // per-day mood colors and counts stay in sync.
        if (idsToRefresh.length > 0) {
          try {
            await refreshDayCounts()
          } catch {
            // ignore calendar refresh errors during polling
          }
        }
      } catch {
        // ignore polling errors
      } finally {
        inFlight = false
      }
    }

    // Update quickly, then keep polling.
    void tick()
    const interval = window.setInterval(() => void tick(), 2500)

    return () => {
      stopped = true
      window.clearInterval(interval)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, user, busy, pollIdsKey])

  async function onCreateThought() {
    if (busy) return

    const body = newThought.trim()
    if (!body) return

    setBusy(true)
    setError(null)
    try {
      await apiFetch({
        path: '/api/thoughts',
        method: 'POST',
        body: { body },
        getIdToken,
      })
      setNewThought('')
      setThoughtsCursor(null)
      await Promise.all([refreshTags(), refreshThoughts(true), refreshDayCounts()])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function onDeleteThought(id: number) {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await apiFetch({
        path: `/api/thoughts/${id}`,
        method: 'DELETE',
        getIdToken,
      })
      setThoughts((prev) => prev.filter((t) => t.id !== id))
      await refreshTags()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function onEditThought(id: number, body: string) {
    if (busy) return
    const trimmed = body.trim()
    if (!trimmed) return

    setBusy(true)
    setError(null)
    try {
      const data = await apiFetch<{ thought: Thought }>({
        path: `/api/thoughts/${id}`,
        method: 'PATCH',
        body: { body: trimmed },
        getIdToken,
      })

      setThoughts((prev) => prev.map((t) => (t.id === id ? data.thought : t)))
      await refreshTags()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  function toggleTag(tag: string) {
    setSelectedTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]))
  }

  function changeCalendarMonth(deltaMonths: number) {
    const m = calendarMonth.match(/^(\d{4})-(\d{2})$/)
    const y = m ? Number(m[1]) : new Date().getFullYear()
    const mm = m ? Number(m[2]) - 1 : new Date().getMonth()

    const next = new Date(y, mm + deltaMonths, 1)
    setCalendarMonth(`${next.getFullYear()}-${pad2(next.getMonth() + 1)}`)
  }

  function selectDate(date: string) {
    // Calendar sends '' for clear.
    const next = date ? date : null
    setSelectedDate(next)

    // If selecting a date outside the visible month, jump the calendar.
    if (date) {
      const m = date.slice(0, 7)
      if (m !== calendarMonth) setCalendarMonth(m)
    }
  }

  // Handle slide-in/out animation for the mobile sidebar.
  useEffect(() => {
    if (navVisible) {
      // Ensure panel is mounted, then let CSS handle sliding in.
      setNavOpen(true)
      return
    }
    if (!navOpen) return
    // When hiding, wait for the transition to finish before unmounting.
    const timeout = window.setTimeout(() => setNavOpen(false), 220)
    return () => window.clearTimeout(timeout)
  }, [navVisible, navOpen])

  return (
    <div className="min-h-screen text-amber-100 font-mono flex flex-col">
      <header className="border-b border-amber-400/40 bg-black/80 backdrop-blur sticky top-0 z-20">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                setNavOpen(true)
                setTimeout(() => setNavVisible(true), 0)
              }}
              className="inline-flex h-8 w-8 items-center justify-center rounded border border-amber-400/60 bg-black/70 text-[0.65rem] uppercase tracking-[0.2em] text-amber-200 shadow-[0_0_12px_rgba(250,204,21,0.4)] hover:border-amber-300 hover:bg-amber-500/10 transition-colors md:hidden"
              aria-label="Open browse and tags panel"
            >
              ◤◢
            </button>
            <img
              src="/apple-touch-icon.png"
              alt="Brainiac logo"
              className="h-8 w-8 rounded-md border border-amber-400/70 shadow-[0_0_18px_rgba(250,204,21,0.6)]"
            />
            <span className="sr-only">brainiac</span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            {loading ? (
              <span className="text-amber-200/70">Booting…</span>
            ) : user ? (
              <>
                <span className="max-w-[30ch] truncate text-amber-100/80">
                  {user.displayName ?? user.email ?? user.uid}
                </span>
                <button
                  onClick={() => void signOut()}
                  aria-label="sign out"
                  className="rounded border border-amber-400/60 bg-black/60 px-3 py-1 text-xs uppercase tracking-wide text-amber-200 hover:border-amber-300 hover:bg-amber-400/10 transition-colors"
                >
                  Sign out
                </button>
              </>
            ) : (
              <button
                onClick={() => void signIn()}
                aria-label="sign in"
                className="rounded border border-amber-400/80 bg-amber-500/10 px-3 py-1 text-xs uppercase tracking-wide text-amber-200 shadow-[0_0_20px_rgba(245,158,11,0.5)] hover:bg-amber-500/20 hover:border-amber-300 transition-colors"
              >
                Sign in with Google
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Mobile slide-in panel for calendar + tags */}
      {navOpen && (
        <div
          className={
            'fixed inset-0 z-30 flex justify-end backdrop-blur-sm md:hidden transition-colors duration-200 ' +
            (navVisible ? 'bg-black/80' : 'bg-black/0')
          }
          onClick={() => setNavVisible(false)}
        >
          <div
            className={
              'relative h-full w-80 max-w-full border-l border-amber-400/40 bg-black/95 p-4 shadow-[0_0_40px_rgba(250,204,21,0.5)] transform transition-transform duration-200 ease-out ' +
              (navVisible ? 'translate-x-0' : 'translate-x-full')
            }
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between text-[0.7rem] uppercase tracking-[0.25em] text-amber-300/80">
              <span>Browse</span>
              <button
                type="button"
                onClick={() => setNavVisible(false)}
                className="rounded border border-amber-400/60 bg-black/60 px-2 py-0.5 text-[0.65rem] text-amber-200 hover:border-amber-300 hover:bg-amber-500/10"
                aria-label="Close browse and tags panel"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div>
                <h2 className="mb-2 text-[0.65rem] font-semibold uppercase tracking-[0.25em] text-amber-300/80">
                  Calendar
                </h2>
                <Calendar
                  month={calendarMonth}
                  selectedDate={selectedDate}
                  countsByDay={dayCounts}
                  avgMoodByDay={dayAvgMood}
                  onChangeMonth={changeCalendarMonth}
                  onSelectDate={selectDate}
                />
              </div>

              <div>
                <h2 className="mb-2 text-[0.65rem] font-semibold uppercase tracking-[0.25em] text-amber-300/80">
                  Tags
                </h2>
                <div className="flex max-h-[260px] flex-col gap-1 overflow-y-auto pr-1">
                  {tags.length === 0 ? <div className="muted">No tags yet.</div> : null}
                  {tags.map((t) => {
                    const active = selectedTags.includes(t.name)
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => toggleTag(t.name)}
                        className={
                          (active
                            ? 'border-amber-400/80 bg-amber-500/10 text-amber-100 shadow-[0_0_18px_rgba(245,158,11,0.6)] '
                            : 'border-amber-400/20 bg-black/40 text-amber-200/80 hover:border-amber-300/60 hover:bg-amber-500/10 ') +
                          'flex items-center justify-between gap-2 rounded-md border px-2 py-1 text-[0.7rem] transition-colors'
                        }
                      >
                        <span className="truncate">{t.name}</span>
                        <span className="text-[0.6rem] text-amber-300/80">{t.thought_count}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-3 px-4 py-4">
        {error ? <div className="error">Error: {error}</div> : null}

        {!loading && !user ? (
          <div className="mt-12 flex flex-1 flex-col items-center justify-center text-center text-amber-200/80">
            <img
              src="/android-chrome-512x512.png"
              alt="Brainiac neural core"
              className="mb-6 h-32 w-32 rounded-2xl border border-amber-400/80 bg-black/80 object-contain shadow-[0_0_45px_rgba(250,204,21,0.8)]"
            />
            <div className="mb-3 text-xs uppercase tracking-[0.35em] text-amber-400/80">
              // Neural capture offline
            </div>
            <p className="max-w-md text-sm text-amber-100/80">
              Jack in with Google to start streaming your thoughts into the brainiac cortex.
            </p>
          </div>
        ) : null}

        {!loading && user ? (
          <main className="grid flex-1 gap-4 md:grid-cols-[minmax(0,1fr)_260px]">
            <section className="flex flex-col gap-3">
              <div className="rounded-xl border border-amber-400/30 bg-gradient-to-br from-black/90 via-zinc-950/90 to-black/80 p-3 shadow-[0_0_45px_rgba(250,204,21,0.12)]">
                <div className="mb-2 flex items-center justify-between text-[0.7rem] uppercase tracking-[0.25em] text-amber-300/80">
                  <span>Thought input</span>
                  <span className="text-amber-400/70">Ctrl+Enter to deploy</span>
                </div>
                <textarea
                  value={newThought}
                  onChange={(e) => setNewThought(e.target.value)}
                  onKeyDown={(e) => {
                    // Submit with Ctrl+Enter (or Cmd+Enter on macOS), keep Enter for newlines.
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                      e.preventDefault()
                      void onCreateThought()
                    }
                  }}
                  placeholder="Write a thought…"
                  rows={8}
                  className="w-full min-h-[10rem] resize-y rounded-lg border border-amber-400/30 bg-black/70 px-3 py-2 text-sm text-amber-100 placeholder:text-amber-300/40 shadow-inner shadow-amber-500/10 focus:outline-none focus:ring-2 focus:ring-amber-400/70 focus:border-amber-300/80"
                />
                <div className="mt-2 flex flex-wrap gap-2 text-xs">
                  <button
                    onClick={() => void onCreateThought()}
                    disabled={busy}
                    aria-label="add thought"
                    className="rounded border border-amber-400/80 bg-amber-500/20 px-3 py-1 text-[0.7rem] uppercase tracking-[0.2em] text-amber-100 shadow-[0_0_20px_rgba(245,158,11,0.7)] transition-colors hover:bg-amber-500/30 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Add
                  </button>
                  <button
                    onClick={() =>
                      void (async () => {
                        setError(null)
                        try {
                          await Promise.all([refreshTags(), refreshThoughts(true)])
                        } catch (e) {
                          setError(e instanceof Error ? e.message : String(e))
                        }
                      })()
                    }
                    disabled={busy}
                    aria-label="refresh"
                    className="rounded border border-amber-400/40 bg-black/40 px-3 py-1 text-[0.7rem] uppercase tracking-[0.2em] text-amber-200 hover:border-amber-300/70 hover:bg-amber-500/10 transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Refresh
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  {selectedDate ? (
                    <>
                      <span className="chip bg-amber-500/10 text-amber-100 border-amber-400/70">
                        Date: {selectedDate}
                      </span>
                      <button
                        onClick={() => setSelectedDate(null)}
                        type="button"
                        className="text-amber-300/80 underline-offset-4 hover:underline"
                      >
                        Clear date
                      </button>
                    </>
                  ) : (
                    <span className="muted text-[0.7rem]">Newest first</span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {selectedTags.length > 0 ? (
                    <>
                      <span className="text-amber-300/80">Filtering by:</span>
                      {selectedTags.map((t) => (
                        <span
                          key={t}
                          className="chip border-amber-400/60 bg-amber-500/10 text-[0.7rem] uppercase tracking-[0.15em] text-amber-100"
                        >
                          {t}
                        </span>
                      ))}
                      <button
                        onClick={() => setSelectedTags([])}
                        type="button"
                        className="text-amber-300/80 underline-offset-4 hover:underline"
                      >
                        Clear tags
                      </button>
                    </>
                  ) : null}
                </div>
              </div>

              <div className="flex flex-col gap-2">
                {thoughts.length === 0 ? <div className="muted text-sm">No thoughts yet.</div> : null}
                {(selectedDate ? thoughts : thoughts.slice(0, 5)).map((t) => (
                  <ThoughtCard key={t.id} thought={t} onDelete={onDeleteThought} onEdit={onEditThought} busy={busy} />
                ))}
              </div>

              {selectedDate && thoughtsCursor ? (
                <button
                  onClick={() => void refreshThoughts(false)}
                  disabled={busy}
                  aria-label="load more"
                  type="button"
                  className="mt-2 self-start rounded border border-amber-400/50 bg-black/40 px-3 py-1 text-[0.7rem] uppercase tracking-[0.2em] text-amber-200 hover:border-amber-300/80 hover:bg-amber-500/10 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Load more
                </button>
              ) : null}
            </section>

            {/* Desktop sidebar (hidden on mobile, lives in slide-out there) */}
            <aside className="hidden space-y-4 rounded-xl border border-amber-400/30 bg-gradient-to-b from-black/80 via-zinc-950/90 to-black/80 p-3 shadow-[0_0_40px_rgba(250,204,21,0.08)] md:block">
              <div>
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.25em] text-amber-300/80">
                  Browse
                </h2>
                <Calendar
                  month={calendarMonth}
                  selectedDate={selectedDate}
                  countsByDay={dayCounts}
                  avgMoodByDay={dayAvgMood}
                  onChangeMonth={changeCalendarMonth}
                  onSelectDate={selectDate}
                />
              </div>

              <div>
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.25em] text-amber-300/80">
                  Tags
                </h2>
                <div className="flex max-h-[260px] flex-col gap-1 overflow-y-auto pr-1">
                  {tags.length === 0 ? <div className="muted">No tags yet.</div> : null}
                  {tags.map((t) => {
                    const active = selectedTags.includes(t.name)
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => toggleTag(t.name)}
                        className={
                          (active
                            ? 'border-amber-400/80 bg-amber-500/10 text-amber-100 shadow-[0_0_18px_rgba(245,158,11,0.6)] '
                            : 'border-amber-400/20 bg-black/40 text-amber-200/80 hover:border-amber-300/60 hover:bg-amber-500/10 ') +
                          'flex items-center justify-between gap-2 rounded-md border px-2 py-1 text-xs transition-colors'
                        }
                      >
                        <span className="truncate">{t.name}</span>
                        <span className="text-[0.65rem] text-amber-300/80">{t.thought_count}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            </aside>
          </main>
        ) : null}

        <footer className="mt-4 border-t border-amber-400/20 pt-3 text-[0.65rem] text-amber-200/60">
          <small>
            Tips: tags are generated by AI (for now). Edited thoughts will be re-tagged.
          </small>
        </footer>
      </div>
    </div>
  )
}

function ThoughtCard(props: {
  thought: Thought
  busy: boolean
  onDelete: (id: number) => Promise<void>
  onEdit: (id: number, body: string) => Promise<void>
}) {
  const { thought, onDelete, onEdit, busy } = props
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(thought.body)
  const [actionsOpen, setActionsOpen] = useState(false)

  useEffect(() => setDraft(thought.body), [thought.body])

  const status = analysisLabel(thought.analysis)
  const showActions = actionsOpen || editing

  const mood = thought.mood
  let moodClass = ''
  let moodLabel = ''
  if (mood && typeof mood.score === 'number') {
    const s = mood.score
    moodLabel = String(s)
    if (s <= 2) {
      moodClass = 'border-red-500/70 bg-red-500/20 text-red-100'
    } else if (s >= 4) {
      moodClass = 'border-emerald-400/80 bg-emerald-500/15 text-emerald-100'
    } else {
      moodClass = 'border-amber-400/70 bg-amber-500/15 text-amber-100'
    }
  }

  return (
    <article className="rounded-xl border border-amber-400/25 bg-black/70 p-3 shadow-[0_0_32px_rgba(250,204,21,0.08)]">
      <div className="mb-2 flex flex-wrap items-center gap-3 text-[0.7rem] text-amber-200/75">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-amber-400/80">#{thought.id}</span>
          <span className="muted">{formatTs(thought.created_at)}</span>
          {thought.updated_at ? <span className="muted">(edited {formatTs(thought.updated_at)})</span> : null}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {mood && moodClass ? (
            <span
              className={
                'chip border px-2 py-0.5 text-[0.6rem] uppercase tracking-[0.18em] ' +
                moodClass
              }
              title={
                mood.explanation
                  ? `Mood ${mood.score}: ${mood.explanation}`
                  : `Mood ${mood.score}`
              }
              aria-label={`Mood score ${mood.score}`}
            >
              {moodLabel}
            </span>
          ) : null}
          {status ? (
            <span
              className={`chip status ${status.className} border px-2 py-0.5 text-[0.65rem] uppercase tracking-[0.18em] text-amber-100`}
              title={status.title}
            >
              {status.text}
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => setActionsOpen((open) => !open)}
            disabled={busy}
            aria-label={showActions ? 'Hide actions' : 'Show actions'}
            className="rounded border border-amber-400/40 bg-black/40 px-1.5 py-0.5 text-[0.6rem] uppercase tracking-[0.18em] text-amber-200 hover:border-amber-300/80 hover:bg-amber-500/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            ···
          </button>
        </div>
      </div>

      {editing ? (
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={3}
          className="w-full resize-y rounded-md border border-amber-400/40 bg-black/80 px-3 py-2 text-sm text-amber-100 shadow-inner focus:outline-none focus:ring-2 focus:ring-amber-400/70"
        />
      ) : (
        <div className="whitespace-pre-wrap text-sm leading-relaxed text-amber-50">
          {thought.body}
        </div>
      )}

      <div className="mt-2 flex flex-wrap gap-1">
        {(thought.tags ?? []).map((tag) => (
          <span
            key={tag}
            className="chip border border-amber-400/40 bg-amber-500/10 px-2 py-0.5 text-[0.65rem] uppercase tracking-[0.15em] text-amber-100"
          >
            {tag}
          </span>
        ))}
      </div>

      <div
        className={
          'mt-3 overflow-hidden transition-all duration-200 ' +
          (showActions ? 'max-h-16 opacity-100' : 'max-h-0 opacity-0')
        }
      >
        <div className="flex flex-wrap gap-2 text-[0.7rem]">
          {editing ? (
            <>
              <button
                onClick={() =>
                  void (async () => {
                    await onEdit(thought.id, draft)
                    setEditing(false)
                  })()
                }
                disabled={busy}
                type="button"
                className="rounded border border-emerald-400/80 bg-emerald-500/10 px-3 py-1 uppercase tracking-[0.18em] text-emerald-100 hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Save
              </button>
              <button
                onClick={() => setEditing(false)}
                disabled={busy}
                type="button"
                className="rounded border border-amber-400/40 bg-black/40 px-3 py-1 uppercase tracking-[0.18em] text-amber-200 hover:border-amber-300/70 hover:bg-amber-500/10 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setEditing(true)}
                disabled={busy}
                type="button"
                className="rounded border border-amber-400/60 bg-black/40 px-3 py-1 uppercase tracking-[0.18em] text-amber-200 hover:border-amber-300/90 hover:bg-amber-500/10 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Edit
              </button>
              <button
                onClick={() => void onDelete(thought.id)}
                disabled={busy}
                type="button"
                className="rounded border border-red-500/70 bg-red-500/10 px-3 py-1 uppercase tracking-[0.18em] text-red-100 hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Delete
              </button>
            </>
          )}
        </div>
      </div>
    </article>
  )
}

export default App
