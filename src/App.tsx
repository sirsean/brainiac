import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

import { apiFetch } from './api'
import { useAuth } from './useAuth'

type ThoughtAnalysisSummary = {
  status: 'queued' | 'processing' | 'done' | 'error'
  total: number
  queued: number
  processing: number
  done: number
  error: number
  last_updated_at: number
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

function App() {
  const { loading, user, signIn, signOut, getIdToken } = useAuth()

  const [newThought, setNewThought] = useState('')
  const [thoughts, setThoughts] = useState<Thought[]>([])
  const [thoughtsCursor, setThoughtsCursor] = useState<string | null>(null)
  const [tags, setTags] = useState<TagStats[]>([])
  const [selectedTags, setSelectedTags] = useState<string[]>([])
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
    params.set('limit', '50')

    if (!reset && thoughtsCursor) {
      params.set('cursor', thoughtsCursor)
    }

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
  }, [loading, user, tagQuery])

  const statusByThoughtIdRef = useRef<Record<number, ThoughtAnalysisSummary['status']>>({})
  const tagsByNameRef = useRef<Set<string>>(new Set())
  const tagsRefreshInFlightRef = useRef(false)

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

        if (stopped) return

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
                placeholder='Write a thought…'
                rows={3}
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
              {selectedTags.length > 0 ? (
                <div>
                  Filtering by: {selectedTags.map((t) => (
                    <span key={t} className='chip'>
                      {t}
                    </span>
                  ))}
                  <button onClick={() => setSelectedTags([])} type='button'>
                    Clear
                  </button>
                </div>
              ) : (
                <div className='muted'>Newest first</div>
              )}
            </div>

            <div className='thoughtList'>
              {thoughts.length === 0 ? <div className='muted'>No thoughts yet.</div> : null}
              {thoughts.map((t) => (
                <ThoughtCard key={t.id} thought={t} onDelete={onDeleteThought} onEdit={onEditThought} busy={busy} />
              ))}
            </div>

            {thoughtsCursor ? (
              <button
                onClick={() => void refreshThoughts(false)}
                disabled={busy}
                aria-label='load more'
                type='button'
              >
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

export function analysisLabel(a: ThoughtAnalysisSummary | null): { text: string; title: string; className: string } | null {
  if (!a) return null

  const progress = `${a.done}/${a.total}`
  const title = `Jobs: ${a.total} (queued ${a.queued}, processing ${a.processing}, done ${a.done}, error ${a.error})`

  if (a.status === 'error') return { text: 'Error', title, className: 'status error' }
  if (a.status === 'processing') return { text: `Processing ${progress}`, title, className: 'status processing' }
  if (a.status === 'queued') return { text: `Queued ${progress}`, title, className: 'status queued' }
  return { text: 'Done', title, className: 'status done' }
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
