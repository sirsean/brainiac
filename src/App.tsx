import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

import { apiFetch } from './api'
import { analysisLabel, type ThoughtAnalysisSummary } from './analysisLabel'
import { Calendar } from './Calendar'
import { useAuth } from './useAuth'

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
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

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
    const data = await apiFetch<{ counts: Record<string, number> }>({
      path,
      getIdToken,
    })

    setDayCounts(data.counts)
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
      await Promise.all([refreshTags(), refreshThoughts(true)])
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

  return (
    <div className='app'>
      <header className='topbar'>
        <h1>brainiac</h1>
        <div className='auth'>
          {loading ? (
            <span>Loading…</span>
          ) : user ? (
            <>
              <span className='user'>{user.displayName ?? user.email ?? user.uid}</span>
              <button onClick={() => void signOut()} aria-label='sign out'>
                Sign out
              </button>
            </>
          ) : (
            <button onClick={() => void signIn()} aria-label='sign in'>
              Sign in with Google
            </button>
          )}
        </div>
      </header>

      {error ? <div className='error'>Error: {error}</div> : null}

      {!loading && !user ? (
        <div className='empty'>Sign in to start capturing thoughts.</div>
      ) : null}

      {!loading && user ? (
        <main className='layout'>
          <aside className='sidebar'>
            <h2>Browse</h2>

            <Calendar
              month={calendarMonth}
              selectedDate={selectedDate}
              countsByDay={dayCounts}
              onChangeMonth={changeCalendarMonth}
              onSelectDate={selectDate}
            />

            <h2>Tags</h2>
            <div className='tagList'>
              {tags.length === 0 ? <div className='muted'>No tags yet.</div> : null}
              {tags.map((t) => (
                <button
                  key={t.id}
                  className={selectedTags.includes(t.name) ? 'tag active' : 'tag'}
                  onClick={() => toggleTag(t.name)}
                  type='button'
                >
                  <span>{t.name}</span>
                  <span className='tagMeta'>{t.thought_count}</span>
                </button>
              ))}
            </div>
          </aside>

          <section className='content'>
            <div className='composer'>
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
                placeholder='Write a thought…'
                rows={8}
              />
              <div className='composerActions'>
                <button onClick={() => void onCreateThought()} disabled={busy} aria-label='add thought'>
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
                  aria-label='refresh'
                >
                  Refresh
                </button>
              </div>
            </div>

            <div className='filters'>
              <div>
                {selectedDate ? (
                  <>
                    <span className='chip'>Date: {selectedDate}</span>
                    <button onClick={() => setSelectedDate(null)} type='button'>
                      Clear date
                    </button>
                  </>
                ) : (
                  <span className='muted'>Newest first</span>
                )}
              </div>

              <div>
                {selectedTags.length > 0 ? (
                  <>
                    Filtering by: {selectedTags.map((t) => (
                      <span key={t} className='chip'>
                        {t}
                      </span>
                    ))}
                    <button onClick={() => setSelectedTags([])} type='button'>
                      Clear tags
                    </button>
                  </>
                ) : null}
              </div>
            </div>

            <div className='thoughtList'>
              {thoughts.length === 0 ? <div className='muted'>No thoughts yet.</div> : null}
              {(selectedDate ? thoughts : thoughts.slice(0, 5)).map((t) => (
                <ThoughtCard key={t.id} thought={t} onDelete={onDeleteThought} onEdit={onEditThought} busy={busy} />
              ))}
            </div>

            {selectedDate && thoughtsCursor ? (
              <button onClick={() => void refreshThoughts(false)} disabled={busy} aria-label='load more' type='button'>
                Load more
              </button>
            ) : null}
          </section>
        </main>
      ) : null}

      <footer className='footer'>
        <small className='muted'>
          Tips: tags are generated by AI (for now). Edited thoughts will be re-tagged.
        </small>
      </footer>
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

  useEffect(() => setDraft(thought.body), [thought.body])

  const status = analysisLabel(thought.analysis)

  return (
    <article className='thought'>
      <div className='thoughtMeta'>
        <span className='muted'>#{thought.id}</span>
        <span className='muted'>{formatTs(thought.created_at)}</span>
        {thought.updated_at ? <span className='muted'>(edited {formatTs(thought.updated_at)})</span> : null}
        {status ? (
          <span className={`chip ${status.className}`} title={status.title}>
            {status.text}
          </span>
        ) : null}
      </div>

      {editing ? (
        <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={3} />
      ) : (
        <div className='thoughtBody'>{thought.body}</div>
      )}

      <div className='thoughtTags'>
        {(thought.tags ?? []).map((tag) => (
          <span key={tag} className='chip'>
            {tag}
          </span>
        ))}
      </div>

      <div className='thoughtActions'>
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
              type='button'
            >
              Save
            </button>
            <button onClick={() => setEditing(false)} disabled={busy} type='button'>
              Cancel
            </button>
          </>
        ) : (
          <>
            <button onClick={() => setEditing(true)} disabled={busy} type='button'>
              Edit
            </button>
            <button onClick={() => void onDelete(thought.id)} disabled={busy} type='button'>
              Delete
            </button>
          </>
        )}
      </div>
    </article>
  )
}

export default App
