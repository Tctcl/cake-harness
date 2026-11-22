import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import App from './App.tsx'

describe('App', () => {
  it('renders the starter screen', () => {
    render(<App />)

    expect(screen.getByRole('heading', { name: 'Get started' })).toBeInTheDocument()
  })

  it('increments the counter when clicked', () => {
    render(<App />)
    const button = screen.getByRole('button')

    fireEvent.click(button)
    fireEvent.click(button)

    expect(button).toHaveTextContent('Count is 2')
  })
})
