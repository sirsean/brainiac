import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { User } from 'firebase/auth'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const apiMocks = vi.hoisted(() => {
  return {
    apiFetch: vi.fn(),
  }
})

const authMocks = vi.hoisted(() => {
  return {
    useAuth: vi.fn(),
  }
})

vi.mock('./api', () => apiMocks)
vi.mock('./useAuth', () => authMocks)

import App, { tzOffsetMinutesForLocalDateKey, tzOffsetMinutesForLocalMonthKey } from './App'
import { analysisLabel, type ThoughtAnalysisSummary } from './analysisLabel'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.resetAllMocks()
})

describe('App', () => {
  beforeEach(() => {
    // Default to signed-out.
    authMocks.useAuth.mockReturnValue({
      loading: false,
      user: null,
      signIn: vi.fn(async () => undefined),
      signOut: vi.fn(async () => undefined),
      getIdToken: vi.fn(async () => null),
    })
  })

  it('renders brainiac header branding', () => {
    render(<App />)

    // Header uses an sr-only text label instead of a visible heading element.
    expect(screen.getByText('brainiac')).toBeInTheDocument()
  })

  it('renders sign-in button when signed out', () => {
    render(<App />)

    expect(screen.getByRole('button', { name: 'sign in' })).toBeInTheDocument()
  })
})

describe('analysisLabel', () => {
  it('returns null when analysis is null', () => {
    expect(analysisLabel(null)).toBeNull()
  })

  it('generates display text, title, and className for queued/processing/done/error', () => {
    const base: Omit<ThoughtAnalysisSummary, 'status'> = {
      total: 4,
      queued: 1,
      processing: 1,
      done: 2,
      error: 0,
      last_updated_at: 123,
    }

    const title = 'Jobs: 4 (queued 1, processing 1, done 2, error 0)'

    expect(analysisLabel({ ...base, status: 'queued' })).toEqual({
      text: 'Queued 2/4',
      title,
      className: 'status queued',
    })

    expect(analysisLabel({ ...base, status: 'processing' })).toEqual({
      text: 'Processing 2/4',
      title,
      className: 'status processing',
    })

    expect(analysisLabel({ ...base, status: 'done' })).toEqual({
      text: 'Done',
      title,
      className: 'status done',
    })

    expect(analysisLabel({ ...base, status: 'error', error: 1 })).toEqual({
      text: 'Error',
      title: 'Jobs: 4 (queued 1, processing 1, done 2, error 1)',
      className: 'status error',
    })
  })
})

describe('App composer', () => {
  beforeEach(() => {
    const fakeUser = { uid: 'u1', email: 'u1@example.com' } as unknown as User

    authMocks.useAuth.mockReturnValue({
      loading: false,
      user: fakeUser,
      signIn: vi.fn(async () => undefined),
      signOut: vi.fn(async () => undefined),
      getIdToken: vi.fn(async () => 'token'),
    })
  })

  it('submits the thought on Ctrl+Enter', async () => {
    apiMocks.apiFetch.mockImplementation(async ({ path, method }: { path: string; method?: string }) => {
      if (path === '/api/tags?limit=200') {
        return { tags: [] }
      }

      if (path.startsWith('/api/thoughts/day-counts?')) {
        return { counts: {} }
      }

      if (path.startsWith('/api/thoughts?')) {
        return { thoughts: [], next_cursor: null }
      }

      if (path === '/api/thoughts' && method === 'POST') {
        return {}
      }

      throw new Error(`Unexpected apiFetch path: ${path}`)
    })

    render(<App />)

    const textarea = screen.getByPlaceholderText('Write a thought…')

    await act(async () => {
      fireEvent.change(textarea, { target: { value: 'hello world' } })
      fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true })
      await Promise.resolve()
    })

    type ApiFetchCall = { path?: string; method?: string; body?: unknown }

    const postCall = apiMocks.apiFetch.mock.calls.find((c) => {
      const arg = c[0] as ApiFetchCall
      return arg.path === '/api/thoughts' && arg.method === 'POST'
    })

    expect(postCall).toBeTruthy()
    expect(((postCall![0] as ApiFetchCall).body as { body?: unknown } | undefined)?.body).toBe('hello world')
  })
})

describe('App polling', () => {
  beforeEach(() => {
    const fakeUser = { uid: 'u1', email: 'u1@example.com' } as unknown as User

    authMocks.useAuth.mockReturnValue({
      loading: false,
      user: fakeUser,
      signIn: vi.fn(async () => undefined),
      signOut: vi.fn(async () => undefined),
      getIdToken: vi.fn(async () => 'token'),
    })
  })

  it('updates thought analysis status based on /api/thoughts/analysis-status responses', async () => {
    vi.useFakeTimers()

    const processingSummary: ThoughtAnalysisSummary = {
      status: 'processing',
      total: 1,
      queued: 0,
      processing: 1,
      done: 0,
      error: 0,
      last_updated_at: 100,
    }

    const doneSummary: ThoughtAnalysisSummary = {
      status: 'done',
      total: 1,
      queued: 0,
      processing: 0,
      done: 1,
      error: 0,
      last_updated_at: 200,
    }

    const initialThought = {
      id: 1,
      uid: 'u1',
      body: 'hello',
      created_at: 1,
      updated_at: null,
      deleted_at: null,
      status: 'active',
      error: null,
      tags: [],
      analysis: processingSummary,
    }

    const refreshedThought = {
      ...initialThought,
      tags: ['Foo'],
      analysis: doneSummary,
    }

    let analysisCallCount = 0

    apiMocks.apiFetch.mockImplementation(async ({ path }: { path: string }) => {
      if (path === '/api/tags?limit=200') {
        return { tags: [] }
      }

      if (path.startsWith('/api/thoughts/day-counts?')) {
        return { counts: {} }
      }

      if (path.startsWith('/api/thoughts?')) {
        return { thoughts: [initialThought], next_cursor: null }
      }

      if (path.startsWith('/api/thoughts/analysis-status?ids=')) {
        analysisCallCount += 1
        if (analysisCallCount === 1) {
          return { summaries: { '1': processingSummary } }
        }
        return { summaries: { '1': doneSummary } }
      }

      if (path === '/api/thoughts/1') {
        return { thought: refreshedThought }
      }

      throw new Error(`Unexpected apiFetch path: ${path}`)
    })

    render(<App />)

    // Wait for the initial data load to populate the UI (avoids RTL async utilities under fake timers).
    await act(async () => {
      for (let i = 0; i < 50 && !screen.queryByText('Processing 0/1'); i += 1) {
        await Promise.resolve()
      }
    })

    const processingChip = screen.getByText('Processing 0/1')
    expect(processingChip).toHaveClass('status', 'processing')

    // Let the initial (immediate) poll tick run.
    await act(async () => {
      for (let i = 0; i < 10 && analysisCallCount < 1; i += 1) {
        await Promise.resolve()
      }
    })
    expect(analysisCallCount).toBe(1)

    // Advance one polling interval to transition processing -> done.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500)
      for (let i = 0; i < 10 && analysisCallCount < 2; i += 1) {
        await Promise.resolve()
      }
    })
    expect(analysisCallCount).toBe(2)

    const doneChip = screen.getByText('Done')
    expect(doneChip).toHaveClass('status', 'done')

    // Ensure we hit the polling endpoint and then refreshed the full thought on status transition.
    const calls = apiMocks.apiFetch.mock.calls.map((c) => (c[0] as { path: string }).path)
    expect(calls).toContain('/api/thoughts/analysis-status?ids=1')
    expect(calls).toContain('/api/thoughts/1')
  })
})

describe('timezone helpers', () => {
  it('tzOffsetMinutesForLocalDateKey uses the offset for the specific local date when parsable', () => {
    // Stub getTimezoneOffset to return a special value only for the target date.
    const target = new Date(2024, 2, 10, 0, 0, 0)
    const targetTime = target.getTime()

    const spy = vi.spyOn(Date.prototype, 'getTimezoneOffset').mockImplementation(function (this: Date) {
      // Use getTime() so we can distinguish the specific calendar date we care about.
      return this.getTime() === targetTime ? 480 : -60
    })

    const offset = tzOffsetMinutesForLocalDateKey('2024-03-10')
    expect(offset).toBe(480)
    expect(spy).toHaveBeenCalled()

    spy.mockRestore()
  })

  it('tzOffsetMinutesForLocalDateKey falls back to current offset when the date is invalid', () => {
    const fallback = 90
    const spy = vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(fallback)

    const offset = tzOffsetMinutesForLocalDateKey('not-a-date')
    expect(offset).toBe(fallback)
    expect(spy).toHaveBeenCalled()

    spy.mockRestore()
  })

  it('tzOffsetMinutesForLocalMonthKey uses the offset for the first day of the given month when parsable', () => {
    const target = new Date(2025, 5, 1, 0, 0, 0)
    const targetTime = target.getTime()

    const spy = vi.spyOn(Date.prototype, 'getTimezoneOffset').mockImplementation(function (this: Date) {
      return this.getTime() === targetTime ? -300 : 0
    })

    const offset = tzOffsetMinutesForLocalMonthKey('2025-06')
    expect(offset).toBe(-300)
    expect(spy).toHaveBeenCalled()

    spy.mockRestore()
  })

  it('tzOffsetMinutesForLocalMonthKey falls back to current offset when the month key is invalid', () => {
    const fallback = -15
    const spy = vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(fallback)

    const offset = tzOffsetMinutesForLocalMonthKey('bogus')
    expect(offset).toBe(fallback)
    expect(spy).toHaveBeenCalled()

    spy.mockRestore()
  })
})
