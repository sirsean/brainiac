import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('./useAuth', () => {
  return {
    useAuth: () => ({
      loading: false,
      user: null,
      signIn: vi.fn(async () => undefined),
      signOut: vi.fn(async () => undefined),
      getIdToken: vi.fn(async () => null),
    }),
  }
})

import App from './App'

describe('App', () => {
  it('renders brainiac header', () => {
    render(<App />)

    expect(screen.getByRole('heading', { level: 1, name: 'brainiac' })).toBeInTheDocument()
  })

  it('renders sign-in button when signed out', () => {
    render(<App />)

    expect(screen.getByRole('button', { name: 'sign in' })).toBeInTheDocument()
  })
})
