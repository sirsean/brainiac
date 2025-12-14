import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import App from './App'

describe('App', () => {
  it('renders the correct title', () => {
    render(<App />)

    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'Vite + React + Cloudflare',
      }),
    ).toBeInTheDocument()
  })

  it('renders the increment button with initial count', () => {
    render(<App />)

    const incrementButton = screen.getByRole('button', { name: 'increment' })

    expect(incrementButton).toBeInTheDocument()
    expect(incrementButton).toHaveTextContent('count is 0')
  })
})
