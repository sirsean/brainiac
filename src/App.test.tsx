import { cleanup, render, screen } from '@testing-library/react'
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

import App, { analysisLabel } from './App'

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

  it('renders brainiac header', () => {
    render(<App />)

    expect(screen.getByRole('heading', { level: 1, name: 'brainiac' })).toBeInTheDocument()
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
    const base = {
      total: 4,
      queued: 1,
      processing: 1,
      done: 2,
      error: 0,
      last_updated_at: 123,
    } as const

    const title = 'Jobs: 4 (queued 1, processing 1, done 2, error 0)'

    expect(analysisLabel({ ...base, status: 'queued' } as any)).toEqual({
      text: 'Queued 2/4',
      title,
      className: 'status queued',
    })

    expect(analysisLabel({ ...base, status: 'processing' } as any)).toEqual({
      text: 'Processing 2/4',
      title,
      className: 'status processing',
    })

    expect(analysisLabel({ ...base, status: 'done' } as any)).toEqual({
      text: 'Done',
      title,
      className: 'status done',
    })

    expect(analysisLabel({ ...base, status: 'error', error: 1 } as any)).toEqual({
      text: 'Error',
      title: 'Jobs: 4 (queued 1, processing 1, done 2, error 1)',
      className: 'status error',
    })
  })
})

describe('App polling', () => {
  beforeEach(() => {
    authMocks.useAuth.mockReturnValue({
      loading: false,
      user: { uid: 'u1', email: 'u1@example.com' } as any,
      signIn: vi.fn(async () => undefined),
      signOut: vi.fn(async () => undefined),
      getIdToken: vi.fn(async () => 'token'),
    })
  })

  it('updates thought analysis status based on /api/thoughts/analysis-status responses', async () => {
    vi.useFakeTimers()

    const processingSummary = {
      status: 'processing',
      total: 1,
      queued: 0,
      processing: 1,
      done: 0,
      error: 0,
      last_updated_at: 100,
    } as const

    const doneSummary = {
      status: 'done',
      total: 1,
      queued: 0,
      processing: 0,
      done: 1,
      error: 0,
      last_updated_at: 200,
    } as const

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
