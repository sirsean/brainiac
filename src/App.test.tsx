import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import App from './App'

describe('App', () => {
  it('renders the title', () => {
    render(<App />)

    expect(
      screen.getByRole('heading', { name: /vite \+ react \+ cloudflare/i }),
    ).toBeInTheDocument()
  })

  it('renders the count button', () => {
    render(<App />)

    const incrementButton = screen.getByRole('button', { name: /increment/i })

    expect(incrementButton).toBeInTheDocument()
    expect(incrementButton).toHaveTextContent(/count is 0/i)
  })
})
