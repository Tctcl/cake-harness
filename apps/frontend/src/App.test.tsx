import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import App from './App.tsx'

describe('App', () => {
  it('renders the top nav and both sidebars', () => {
    render(<App />)

    expect(screen.getByText('topnav')).toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: 'left sidebar' })).toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: 'right sidebar' })).toBeInTheDocument()
  })

  it('collapses the top nav to a strip and restores it', () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: 'Collapse top nav' }))
    expect(screen.queryByText('topnav')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Expand top nav' }))
    expect(screen.getByText('topnav')).toBeInTheDocument()
  })

  it('collapses a sidebar to a rail and restores it', () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: 'Collapse left sidebar' }))
    expect(screen.queryByRole('complementary', { name: 'left sidebar' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Expand left sidebar' }))
    expect(screen.getByRole('complementary', { name: 'left sidebar' })).toBeInTheDocument()
  })
})
